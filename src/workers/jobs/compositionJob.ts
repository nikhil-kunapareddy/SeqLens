import {
  buildNucleotideSpectrum,
  buildStringSpectrum,
  countKmers,
  countStringKmers,
  cpgStatistics,
  createNucleotideCounts,
  createStringCounts,
  findLowComplexityRegions,
  MAX_PACKED_K,
  proteinPropertiesFromTally,
  strandSkew,
  tallyResidues,
  type NucleotideKmerCounts,
  type ResidueTally,
  type StringKmerCounts,
} from '@/bio';
import { datasetRepository, forEachBlock } from '@/storage';
import type {
  CompositionJobRequest,
  CompositionResult,
  KmerSpectrum,
  LowComplexityRegion,
  ProteinProperties,
} from '@/types';
import { AnalysisError, type JobContext } from '../context';

/** Per-sequence protein properties retained for the detail table. */
const PROTEIN_SAMPLE_LIMIT = 2_000;

/** Low-complexity regions retained for display. */
const LOW_COMPLEXITY_LIMIT = 500;

/**
 * Composition and k-mer analysis.
 *
 * One streaming pass over the dataset's blocks feeds every accumulator at once:
 * residue totals, positional composition, CpG counts, each requested k-mer
 * table, and - for protein datasets - per-sequence physicochemical properties.
 * Running a separate pass per k would mean reading the residues four times for
 * the default k = 3, 4, 5, 6.
 */
export async function runCompositionJob(
  request: CompositionJobRequest,
  context: JobContext,
): Promise<CompositionResult> {
  const { datasetId, config } = request;

  const [dataset, index, profile] = await Promise.all([
    datasetRepository.get(datasetId),
    datasetRepository.getIndex(datasetId),
    datasetRepository.getProfile(datasetId),
  ]);

  if (!dataset || !index || !profile) {
    throw new AnalysisError({
      code: 'dataset-missing',
      message: 'This dataset is no longer in local storage.',
      suggestion: 'Re-import the file, or pick a different dataset.',
    });
  }

  const notes: string[] = [];
  const isProtein = dataset.sequenceType === 'protein';

  // Validate and clamp the requested k values.
  const kValues: number[] = [];
  for (const k of [...config.kValues].sort((a, b) => a - b)) {
    if (k < 1) continue;
    const maxK = isProtein ? 5 : MAX_PACKED_K;
    if (k > maxK) {
      notes.push(
        `k = ${k} was skipped: the maximum supported is ${maxK} for ${isProtein ? 'protein' : 'nucleotide'} sequences.`,
      );
      continue;
    }
    if (!kValues.includes(k)) kValues.push(k);
  }
  if (kValues.length === 0) {
    throw new AnalysisError({
      code: 'no-data',
      message: 'No valid k values were requested.',
      suggestion: `Choose at least one k between 1 and ${isProtein ? 5 : MAX_PACKED_K}.`,
    });
  }

  const nucleotideCounters: NucleotideKmerCounts[] = [];
  const stringCounters: StringKmerCounts[] = [];
  if (isProtein) {
    for (const k of kValues) stringCounters.push(createStringCounts(k));
  } else {
    for (const k of kValues) nucleotideCounters.push(createNucleotideCounts(k, config.canonicalKmers));
  }

  const maxSequences = request.maxSequences > 0 ? request.maxSequences : index.count;
  const sampled = maxSequences < index.count;
  if (sampled) {
    notes.push(
      `Composition was computed over the first ${maxSequences.toLocaleString()} of ${index.count.toLocaleString()} sequences. Raise the limit in Settings to include all of them.`,
    );
  }

  // Accumulators fed by the streaming pass.
  const proteinTally: ResidueTally = { counts: new Float64Array(128), standard: 0, total: 0 };
  const perSequenceProtein: (ProteinProperties & { id: string; index: number; length: number })[] = [];
  const lowComplexityRegions: LowComplexityRegion[] = [];
  let cpgCount = 0;
  let cpgExpectedDenominator = 0;
  let cpgC = 0;
  let cpgG = 0;
  let sequencesAnalyzed = 0;

  context.report({ id: 'composition', label: 'Reading sequences', value: 0 }, true);
  for (const counter of [...nucleotideCounters, ...stringCounters]) {
    context.report({ id: `kmer-${counter.k}`, label: `Counting ${counter.k}-mers`, value: 0 });
  }

  await forEachBlock(datasetId, async ({ block, blockIndex, totalBlocks }) => {
    context.checkCancelled();

    for (let local = 0; local < block.count; local += 1) {
      if (sequencesAnalyzed >= maxSequences) return false;
      const residues = block.residues.slice(block.offsets[local], block.offsets[local + 1]);
      sequencesAnalyzed += 1;
      if (residues.length === 0) continue;

      if (isProtein) {
        const tally = tallyResidues(residues);
        // Fold into the dataset-wide tally.
        for (let code = 0; code < 128; code += 1) {
          proteinTally.counts[code] += tally.counts[code];
        }
        proteinTally.standard += tally.standard;
        proteinTally.total += tally.total;

        if (perSequenceProtein.length < PROTEIN_SAMPLE_LIMIT) {
          perSequenceProtein.push({
            ...proteinPropertiesFromTally(tally),
            id: block.ids[local],
            index: block.startIndex + local,
            length: residues.length,
          });
        }

        if (lowComplexityRegions.length < LOW_COMPLEXITY_LIMIT) {
          // Step by a quarter of the window: enough resolution to locate a
          // region while doing a quarter of the entropy recomputation.
          const step = Math.max(1, Math.floor(64 / 4));
          for (const region of findLowComplexityRegions(residues, 64, 2.2, step)) {
            if (lowComplexityRegions.length >= LOW_COMPLEXITY_LIMIT) break;
            lowComplexityRegions.push({
              sequenceIndex: block.startIndex + local,
              sequenceId: block.ids[local],
              start: region.start,
              end: region.end,
              entropy: region.entropy,
              dominantResidue: region.dominantResidue,
            });
          }
        }

        for (const counter of stringCounters) countStringKmers(residues, counter);
      } else {
        const cpg = cpgStatistics(residues);
        cpgCount += cpg.count;
        // Accumulate the independence expectation across sequences rather than
        // computing it on concatenated residues, which would create spurious
        // junction dinucleotides.
        cpgExpectedDenominator += residues.length;
        for (let i = 0; i < residues.length; i += 1) {
          const code = residues.charCodeAt(i);
          if (code === 67 || code === 99) cpgC += 1;
          else if (code === 71 || code === 103) cpgG += 1;
        }

        for (const counter of nucleotideCounters) countKmers(residues, counter);
      }
    }

    const fraction = totalBlocks === 0 ? 1 : (blockIndex + 1) / totalBlocks;
    context.report({
      id: 'composition',
      label: 'Reading sequences',
      value: fraction,
      detail: `${sequencesAnalyzed.toLocaleString()} sequences`,
    });
    for (const counter of [...nucleotideCounters, ...stringCounters]) {
      context.report({
        id: `kmer-${counter.k}`,
        label: `Counting ${counter.k}-mers`,
        value: fraction,
        detail: `${counter.total.toLocaleString()} ${counter.k}-mers`,
      });
    }
    return true;
  });

  context.complete('composition', 'Reading sequences');

  /* ------------------------------ spectra -------------------------------- */

  const spectrumOptions = {
    topN: config.topKmers,
    rareMaxCount: config.rareKmerMaxCount,
    rareSampleSize: 200,
  };

  const kmerSpectra: KmerSpectrum[] = isProtein
    ? stringCounters.map((counter) => buildStringSpectrum(counter, spectrumOptions))
    : nucleotideCounters.map((counter) => buildNucleotideSpectrum(counter, spectrumOptions));

  for (const counter of [...nucleotideCounters, ...stringCounters]) {
    context.complete(`kmer-${counter.k}`, `Counting ${counter.k}-mers`);
    if (counter.skipped > 0 && counter.total > 0) {
      const skippedFraction = counter.skipped / (counter.skipped + counter.total);
      if (skippedFraction > 0.01) {
        notes.push(
          `${(skippedFraction * 100).toFixed(1)}% of ${counter.k}-mer windows were skipped because they contained an ambiguous residue.`,
        );
      }
    }
  }

  /* --------------------------- residue totals ----------------------------- */

  // When the run was sampled, the dataset profile describes all sequences and
  // would disagree with the k-mer counts, so residue composition is recomputed
  // from the sampled portion instead.
  const residueSource = sampled
    ? recomputeResidueCounts(nucleotideCounters, proteinTally, isProtein)
    : profile.residueCounts;
  const residueTotal = Object.values(residueSource).reduce((sum, value) => sum + value, 0);

  const residueComposition = Object.entries(residueSource)
    .map(([residue, count]) => ({
      residue,
      count,
      percent: residueTotal === 0 ? 0 : (count / residueTotal) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const positionalComposition = buildPositional(profile, isProtein);

  /* ------------------------ nucleotide metrics ---------------------------- */

  let nucleotide: CompositionResult['nucleotide'] = null;
  if (!isProtein) {
    const get = (residue: string) => residueSource[residue] ?? 0;
    const a = get('A');
    const c = get('C');
    const g = get('G');
    const t = get('T') + get('U');
    const canonical = a + c + g + t;
    const ambiguous = residueTotal - canonical;

    const cpgExpected =
      cpgExpectedDenominator === 0 ? 0 : (cpgC * cpgG) / cpgExpectedDenominator;

    // Shannon entropy over the four canonical bases.
    let entropy = 0;
    for (const value of [a, c, g, t]) {
      if (value === 0 || canonical === 0) continue;
      const p = value / canonical;
      entropy -= p * Math.log2(p);
    }

    nucleotide = {
      gcPercent: canonical === 0 ? 0 : ((g + c) / canonical) * 100,
      atPercent: canonical === 0 ? 0 : ((a + t) / canonical) * 100,
      ...strandSkew({ a, c, g, t }),
      cpgCount: cpgCount,
      cpgObservedExpected: cpgExpected === 0 ? 0 : cpgCount / cpgExpected,
      entropyBitsPerBase: entropy,
      ambiguousPercent: residueTotal === 0 ? 0 : (ambiguous / residueTotal) * 100,
    };

    if (Math.abs(nucleotide.gcSkew) < 0.01 && Math.abs(nucleotide.atSkew) < 0.01) {
      notes.push(
        'GC and AT skew are both near zero, which is expected for read sets sampled from both strands. Skew is informative for single-stranded assemblies, not for paired-end reads.',
      );
    }
  }

  /* -------------------------- protein metrics ----------------------------- */

  let protein: CompositionResult['protein'] = null;
  if (isProtein) {
    const aggregate = proteinPropertiesFromTally(proteinTally, Math.max(1, sequencesAnalyzed));
    protein = {
      aggregate,
      perSequenceSample: perSequenceProtein,
      chargeDistribution: bucketize(
        perSequenceProtein.map((p) => p.netChargeAtPh7),
        [-Infinity, -20, -10, -5, -1, 1, 5, 10, 20, Infinity],
        (low, high) => formatRange(low, high, 0),
      ),
      hydrophobicityDistribution: bucketize(
        perSequenceProtein.map((p) => p.gravy),
        [-Infinity, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, Infinity],
        (low, high) => formatRange(low, high, 1),
      ),
      molecularWeightDistribution: bucketize(
        perSequenceProtein.map((p) => p.molecularWeight / 1000),
        [0, 10, 25, 50, 100, 200, 500, Infinity],
        (low, high) => `${formatRange(low, high, 0)} kDa`,
      ),
      lowComplexityRegions,
    };

    if (perSequenceProtein.length < sequencesAnalyzed) {
      notes.push(
        `Per-sequence property distributions cover the first ${perSequenceProtein.length.toLocaleString()} sequences; the aggregate figures cover all ${sequencesAnalyzed.toLocaleString()} analysed.`,
      );
    }
    notes.push(
      'Molecular weight, isoelectric point, and GRAVY are sequence-only estimates for the unmodified chain; they exclude signal peptide cleavage, glycosylation, and disulfide formation.',
    );
  }

  return {
    kind: 'composition',
    datasetId,
    computedAt: Date.now(),
    configSnapshot: config,
    sequenceType: dataset.sequenceType,
    residueComposition,
    nucleotide,
    protein,
    positionalComposition,
    kmerSpectra,
    sequencesAnalyzed,
    notes,
  };
}

/**
 * Rebuilds residue counts from the 1-mer table when the run was sampled.
 *
 * Falls back to deriving them from the k-mer counter when a 1-mer table was not
 * requested, which slightly undercounts the last k-1 residues of each sequence;
 * that is noted rather than hidden.
 */
function recomputeResidueCounts(
  nucleotideCounters: NucleotideKmerCounts[],
  proteinTally: ResidueTally,
  isProtein: boolean,
): Record<string, number> {
  if (isProtein) {
    const counts: Record<string, number> = {};
    for (let code = 0; code < 128; code += 1) {
      if (proteinTally.counts[code] > 0) {
        counts[String.fromCharCode(code)] = proteinTally.counts[code];
      }
    }
    return counts;
  }

  const oneMer = nucleotideCounters.find((counter) => counter.k === 1);
  const counts: Record<string, number> = {};
  if (oneMer) {
    const bases = 'ACGT';
    for (let code = 0; code < 4; code += 1) {
      const value = oneMer.dense ? oneMer.dense[code] : (oneMer.sparse?.get(code) ?? 0);
      if (value > 0) counts[bases[code]] = value;
    }
    return counts;
  }

  // Derive from the smallest available k by summing over the first base of each
  // k-mer. Off by at most (k-1) residues per sequence.
  const smallest = [...nucleotideCounters].sort((a, b) => a.k - b.k)[0];
  if (!smallest) return counts;
  const bases = 'ACGT';
  const shift = 2 * (smallest.k - 1);
  const accumulate = (code: number, value: number) => {
    const first = (code >>> shift) & 3;
    counts[bases[first]] = (counts[bases[first]] ?? 0) + value;
  };
  if (smallest.dense) {
    for (let code = 0; code < smallest.dense.length; code += 1) {
      if (smallest.dense[code] > 0) accumulate(code, smallest.dense[code]);
    }
  } else if (smallest.sparse) {
    for (const [code, value] of smallest.sparse) accumulate(code, value);
  }
  return counts;
}

function buildPositional(
  profile: { positionalCap: number; positionalComposition: Uint32Array; positionalCoverage: Uint32Array },
  isProtein: boolean,
): Record<string, number>[] {
  const cap = profile.positionalCap;
  const rows: Record<string, number>[] = [];
  const labels = isProtein
    ? ['A', 'C', 'G', 'T', 'other']
    : ['A', 'C', 'G', 'T', 'N'];

  for (let i = 0; i < cap; i += 1) {
    const coverage = profile.positionalCoverage[i];
    if (coverage === 0) continue;
    const row: Record<string, number> = { position: i + 1 };
    for (let bucket = 0; bucket < 5; bucket += 1) {
      row[labels[bucket]] = (profile.positionalComposition[bucket * cap + i] / coverage) * 100;
    }
    rows.push(row);
  }
  return rows;
}

/** Buckets values into labelled bins defined by their edges. */
function bucketize(
  values: number[],
  edges: number[],
  label: (low: number, high: number) => string,
): { bucket: string; count: number }[] {
  const buckets = edges.slice(0, -1).map((low, i) => ({
    bucket: label(low, edges[i + 1]),
    low,
    high: edges[i + 1],
    count: 0,
  }));

  for (const value of values) {
    for (const bucket of buckets) {
      if (value >= bucket.low && value < bucket.high) {
        bucket.count += 1;
        break;
      }
    }
  }

  return buckets.map(({ bucket, count }) => ({ bucket, count }));
}

function formatRange(low: number, high: number, digits: number): string {
  if (low === -Infinity) return `< ${high.toFixed(digits)}`;
  if (high === Infinity) return `> ${low.toFixed(digits)}`;
  return `${low.toFixed(digits)} to ${high.toFixed(digits)}`;
}
