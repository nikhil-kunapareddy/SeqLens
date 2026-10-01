import {
  METRIC_DOCS,
  buildLengthHistogram,
  computeLengthStats,
  confirmDuplicates,
  findDuplicateCandidates,
  longestHomopolymer,
  sequenceEntropy,
  topLengths,
  uniquePercent,
  validateResidues,
} from '@/bio';
import { datasetRepository, forEachBlock, getSequencesByIndices, idFromIndex } from '@/storage';
import type {
  Dataset,
  QCCheck,
  QCJobRequest,
  QCResult,
  QCStatus,
  QCThresholds,
  SequenceFlag,
  SequenceFlagKind,
  SequenceIndex,
} from '@/types';
import { AnalysisError, type JobContext } from '../context';

/** Cap on flagged sequences retained for display. */
const MAX_FLAGGED = 500;

/** Cap on duplicate groups retained for display. */
const MAX_DUPLICATE_GROUPS = 200;

/**
 * FASTQC-style quality control, plus dataset-level assembly metrics.
 *
 * The work is split by what each metric needs:
 *
 *  - Length, GC, ambiguity, and quality statistics come from the compact index
 *    built at import, so they cost nothing to recompute when a threshold
 *    changes. Adjusting a slider re-derives verdicts without touching residues.
 *  - Duplicate detection groups candidates by hash from the index, then reads
 *    residues for only the candidate groups to confirm them exactly.
 *  - Homopolymer, low-complexity, and invalid-character checks need residues,
 *    so they stream the blocks once.
 *
 * Every verdict cites the threshold that produced it. A QC tool that says
 * "WARNING" without saying "because duplicates are 24% and your warning
 * threshold is 20%" is asking to be trusted rather than read.
 */
export async function runQCJob(request: QCJobRequest, context: JobContext): Promise<QCResult> {
  const { datasetId, thresholds } = request;

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
  if (index.count === 0) {
    throw new AnalysisError({
      code: 'no-data',
      message: 'This dataset contains no sequences.',
      suggestion: 'Check the import summary for parse errors.',
    });
  }

  const notes: string[] = [];
  context.report({ id: 'stats', label: 'Computing dataset statistics', value: 0.1 }, true);

  const lengthStats = computeLengthStats(index.lengths);
  const histogram = buildLengthHistogram(index.lengths, 44);
  if (histogram.scale === 'log') {
    notes.push(
      'Sequence lengths span more than two orders of magnitude, so the length distribution uses logarithmic bins.',
    );
  }

  // GC and ambiguity over the whole dataset.
  let totalGc = 0;
  let totalAmbiguous = 0;
  let totalUnambiguous = 0;
  let emptyCount = 0;
  let tooShort = 0;
  let tooLong = 0;
  let ambiguousSequences = 0;

  for (let i = 0; i < index.count; i += 1) {
    const length = index.lengths[i];
    const ambiguous = index.ambiguousCounts[i];
    totalGc += index.gcCounts[i];
    totalAmbiguous += ambiguous;
    totalUnambiguous += length - ambiguous;
    if (length === 0) emptyCount += 1;
    else if (length <= thresholds.minLength) tooShort += 1;
    if (length >= thresholds.maxLength) tooLong += 1;
    if (length > 0 && ambiguous / length >= thresholds.ambiguousWarn) ambiguousSequences += 1;
  }

  const isProtein = dataset.sequenceType === 'protein';
  const gcPercent = totalUnambiguous === 0 ? 0 : (totalGc / totalUnambiguous) * 100;
  const ambiguousPercent =
    profile.totalResidues === 0 ? 0 : (totalAmbiguous / profile.totalResidues) * 100;

  context.complete('stats', 'Computing dataset statistics');

  /* ---------------------------- duplicates ------------------------------- */

  context.report({ id: 'duplicates', label: 'Detecting duplicates', value: 0.1 }, true);
  const candidates = findDuplicateCandidates(index.hashLow, index.hashHigh, index.lengths);

  // Load residues for candidate sequences only.
  const candidateIndices: number[] = [];
  for (const run of candidates.runs) {
    for (let i = run.start; i < run.end; i += 1) candidateIndices.push(candidates.order[i]);
  }

  context.report({
    id: 'duplicates',
    label: 'Detecting duplicates',
    value: 0.4,
    detail: `${candidateIndices.length.toLocaleString()} candidates in ${candidates.runs.length.toLocaleString()} hash groups`,
  });

  const residuesByIndex = new Map<number, string>();
  if (candidateIndices.length > 0) {
    const sequences = await getSequencesByIndices(datasetId, candidateIndices);
    for (const sequence of sequences) residuesByIndex.set(sequence.index, sequence.residues);
  }
  context.checkCancelled();

  const duplicates = confirmDuplicates(
    candidates,
    index.hashLow,
    index.hashHigh,
    index.lengths,
    (i) => idFromIndex(index, i),
    (i) => residuesByIndex.get(i) ?? '',
    { maxGroups: MAX_DUPLICATE_GROUPS },
  );

  if (duplicates.hashCollisions > 0) {
    notes.push(
      `${duplicates.hashCollisions} hash collision${duplicates.hashCollisions === 1 ? '' : 's'} were resolved by comparing residues directly, so the duplicate count is exact.`,
    );
  }
  context.complete(
    'duplicates',
    'Detecting duplicates',
    `${duplicates.duplicateGroups.toLocaleString()} groups`,
  );

  /* ------------------------- residue-level scan --------------------------- */

  const flagCounts: Record<SequenceFlagKind, number> = {
    'invalid-characters': 0,
    empty: emptyCount,
    'too-short': tooShort,
    'too-long': tooLong,
    ambiguous: ambiguousSequences,
    homopolymer: 0,
    'low-complexity': 0,
    duplicate: duplicates.duplicateSequences,
  };

  const flagged = new Map<number, SequenceFlag>();

  const addFlag = (
    position: number,
    kind: SequenceFlagKind,
    extra?: Partial<SequenceFlag>,
  ): void => {
    const existing = flagged.get(position);
    if (existing) {
      if (!existing.flags.includes(kind)) existing.flags.push(kind);
      Object.assign(existing, extra);
      return;
    }
    if (flagged.size >= MAX_FLAGGED) return;
    flagged.set(position, {
      index: position,
      id: idFromIndex(index, position),
      length: index.lengths[position],
      flags: [kind],
      ...extra,
    });
  };

  // Index-derived flags first, so the display set is populated even if the
  // residue scan is cut short on a very large dataset.
  for (let i = 0; i < index.count && flagged.size < MAX_FLAGGED; i += 1) {
    const length = index.lengths[i];
    if (length === 0) addFlag(i, 'empty');
    else if (length <= thresholds.minLength) addFlag(i, 'too-short');
    if (length >= thresholds.maxLength) addFlag(i, 'too-long');
    const ambiguous = index.ambiguousCounts[i];
    if (length > 0 && ambiguous / length >= thresholds.ambiguousWarn) {
      addFlag(i, 'ambiguous', { ambiguousFraction: ambiguous / length });
    }
  }
  for (const position of duplicates.redundantIndices) {
    if (flagged.size >= MAX_FLAGGED) break;
    addFlag(position, 'duplicate');
  }

  context.report({ id: 'scan', label: 'Scanning residues', value: 0 }, true);

  await forEachBlock(datasetId, async ({ block, blockIndex, totalBlocks, sequencesSoFar }) => {
    context.checkCancelled();

    for (let local = 0; local < block.count; local += 1) {
      const position = block.startIndex + local;
      const residues = block.residues.slice(block.offsets[local], block.offsets[local + 1]);
      if (residues.length === 0) continue;

      const run = longestHomopolymer(residues);
      if (run !== null && run.length >= thresholds.homopolymerMinRun) {
        flagCounts.homopolymer += 1;
        addFlag(position, 'homopolymer', { longestRun: run.length, runResidue: run.residue });
      }

      // Whole-sequence entropy is the cheap screen; it flags compositionally
      // biased sequences. The sliding-window scan that finds localised
      // low-complexity regions runs in the Composition module, where its cost
      // is opted into rather than paid on every QC run.
      const entropy = sequenceEntropy(residues);
      const maxEntropy = isProtein ? Math.log2(20) : 2;
      if (entropy <= thresholds.lowComplexityEntropy * (maxEntropy / 2)) {
        flagCounts['low-complexity'] += 1;
        addFlag(position, 'low-complexity', { entropy });
      }

      const validation = validateResidues(residues, dataset.sequenceType);
      if (!validation.valid) {
        flagCounts['invalid-characters'] += 1;
        addFlag(position, 'invalid-characters', {
          invalidCharacters: validation.invalidCharacters,
        });
      }
    }

    context.report({
      id: 'scan',
      label: 'Scanning residues',
      value: totalBlocks === 0 ? 1 : (blockIndex + 1) / totalBlocks,
      detail: `${sequencesSoFar.toLocaleString()} of ${index.count.toLocaleString()} sequences`,
    });
  });

  context.complete('scan', 'Scanning residues');

  /* --------------------------- quality profile ---------------------------- */

  const hasQuality = dataset.format === 'fastq' && index.meanQuality.length > 0;
  let meanQuality: number | null = null;
  if (hasQuality) {
    let sum = 0;
    for (let i = 0; i < index.meanQuality.length; i += 1) sum += index.meanQuality[i];
    meanQuality = sum / index.meanQuality.length;
  }

  const perPositionQuality: QCResult['perPositionQuality'] = [];
  if (hasQuality) {
    for (let i = 0; i < profile.positionalCap; i += 1) {
      const coverage = profile.positionalCoverage[i];
      if (coverage === 0) continue;
      perPositionQuality.push({
        position: i + 1,
        mean: profile.positionalQualitySum[i] / coverage,
        coverage,
      });
    }
  }

  const readQualityHistogram: QCResult['readQualityHistogram'] = [];
  if (hasQuality) {
    for (let score = 0; score <= 60; score += 1) {
      if (profile.readQualityHistogram[score] > 0) {
        readQualityHistogram.push({ score, count: profile.readQualityHistogram[score] });
      }
    }
  }

  /* --------------------------- derived tables ----------------------------- */

  const residueComposition = Object.entries(profile.residueCounts)
    .map(([residue, count]) => ({
      residue,
      count,
      percent: profile.totalResidues === 0 ? 0 : (count / profile.totalResidues) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const gcHistogram: QCResult['gcHistogram'] = [];
  for (let gc = 0; gc <= 100; gc += 1) {
    if (profile.gcHistogram[gc] > 0) gcHistogram.push({ gc, count: profile.gcHistogram[gc] });
  }

  const positionalComposition: QCResult['positionalComposition'] = [];
  const cap = profile.positionalCap;
  for (let i = 0; i < cap; i += 1) {
    const coverage = profile.positionalCoverage[i];
    if (coverage === 0) continue;
    positionalComposition.push({
      position: i + 1,
      A: (profile.positionalComposition[i] / coverage) * 100,
      C: (profile.positionalComposition[cap + i] / coverage) * 100,
      G: (profile.positionalComposition[2 * cap + i] / coverage) * 100,
      T: (profile.positionalComposition[3 * cap + i] / coverage) * 100,
      N: (profile.positionalComposition[4 * cap + i] / coverage) * 100,
    });
  }

  const ambiguousHistogram = buildAmbiguousHistogram(index);

  const duplicateFraction = index.count === 0 ? 0 : duplicates.duplicateSequences / index.count;

  const checks = buildChecks({
    dataset,
    thresholds,
    isProtein,
    hasQuality,
    stats: {
      sequenceCount: index.count,
      totalResidues: profile.totalResidues,
      gcPercent,
      ambiguousPercent,
      duplicateFraction,
      duplicateSequences: duplicates.duplicateSequences,
      duplicateGroups: duplicates.duplicateGroups,
      meanQuality,
      emptyCount,
      tooShort,
      tooLong,
      homopolymer: flagCounts.homopolymer,
      lowComplexity: flagCounts['low-complexity'],
      invalidCharacters: flagCounts['invalid-characters'],
      minLength: lengthStats.min,
      maxLength: lengthStats.max,
      n50: lengthStats.n50,
    },
  });

  if (dataset.truncated) {
    notes.push(
      'This dataset was truncated at import, so every statistic here describes only the imported portion of the file.',
    );
  }
  if (isProtein) {
    notes.push(
      'GC content and nucleotide composition do not apply to protein sequences and are omitted.',
    );
  }
  if (positionalComposition.length === cap && lengthStats.max > cap) {
    notes.push(
      `Positional profiles cover the first ${cap} positions. Beyond that, coverage falls to a handful of the longest sequences and the per-position values stop being representative.`,
    );
  }

  const overallStatus = worstStatus(checks.map((check) => check.status));

  return {
    kind: 'qc',
    datasetId,
    computedAt: Date.now(),
    configSnapshot: thresholds,
    overallStatus,
    checks,
    stats: {
      sequenceCount: index.count,
      totalResidues: profile.totalResidues,
      minLength: lengthStats.min,
      maxLength: lengthStats.max,
      meanLength: lengthStats.mean,
      medianLength: lengthStats.median,
      n50: lengthStats.n50,
      n90: lengthStats.n90,
      l50: lengthStats.l50,
      gcPercent,
      ambiguousPercent,
      duplicateSequences: duplicates.duplicateSequences,
      duplicateGroups: duplicates.duplicateGroups,
      uniquePercent: uniquePercent(index.count, duplicates.duplicateSequences),
      meanQuality,
    },
    lengthHistogram: histogram.bins,
    gcHistogram,
    nucleotideComposition: residueComposition,
    ambiguousHistogram,
    duplicateHistogram: duplicates.histogram,
    topLengths: topLengths(index.lengths, 12),
    duplicateGroups: duplicates.groups,
    flaggedSequences: [...flagged.values()].sort((a, b) => b.flags.length - a.flags.length || a.index - b.index),
    flagCounts,
    perPositionQuality,
    readQualityHistogram,
    positionalComposition,
    notes,
  };
}

/** Buckets sequences by their ambiguous-residue fraction. */
function buildAmbiguousHistogram(index: SequenceIndex): { bucket: string; count: number }[] {
  const buckets = [
    { bucket: 'none', test: (f: number) => f === 0, count: 0 },
    { bucket: '0-1%', test: (f: number) => f > 0 && f <= 0.01, count: 0 },
    { bucket: '1-5%', test: (f: number) => f > 0.01 && f <= 0.05, count: 0 },
    { bucket: '5-10%', test: (f: number) => f > 0.05 && f <= 0.1, count: 0 },
    { bucket: '10-25%', test: (f: number) => f > 0.1 && f <= 0.25, count: 0 },
    { bucket: '>25%', test: (f: number) => f > 0.25, count: 0 },
  ];

  for (let i = 0; i < index.count; i += 1) {
    const length = index.lengths[i];
    const fraction = length === 0 ? 0 : index.ambiguousCounts[i] / length;
    for (const bucket of buckets) {
      if (bucket.test(fraction)) {
        bucket.count += 1;
        break;
      }
    }
  }

  return buckets.map(({ bucket, count }) => ({ bucket, count }));
}

interface CheckInput {
  dataset: Dataset;
  thresholds: QCThresholds;
  isProtein: boolean;
  hasQuality: boolean;
  stats: {
    sequenceCount: number;
    totalResidues: number;
    gcPercent: number;
    ambiguousPercent: number;
    duplicateFraction: number;
    duplicateSequences: number;
    duplicateGroups: number;
    meanQuality: number | null;
    emptyCount: number;
    tooShort: number;
    tooLong: number;
    homopolymer: number;
    lowComplexity: number;
    invalidCharacters: number;
    minLength: number;
    maxLength: number;
    n50: number;
  };
}

const percent = (value: number): string => `${value.toFixed(2)}%`;
const count = (value: number): string => value.toLocaleString();
const plural = (value: number, noun: string): string => (value === 1 ? noun : `${noun}s`);

/**
 * Turns measurements into PASS / WARNING / REVIEW verdicts.
 *
 * 'REVIEW' rather than 'FAIL' is deliberate: SeqLens cannot know whether a
 * 60% duplicate rate is a ruined library or a correctly sequenced amplicon
 * panel. The status says how strongly the number deviates from the configured
 * expectation, and the accompanying text says what would make that deviation
 * normal.
 */
function buildChecks(input: CheckInput): QCCheck[] {
  const { thresholds, stats, isProtein, hasQuality } = input;
  const checks: QCCheck[] = [];

  checks.push({
    id: 'sequence-count',
    label: 'Sequence count',
    status: stats.sequenceCount === 0 ? 'review' : 'pass',
    value: count(stats.sequenceCount),
    explanation: `${count(stats.sequenceCount)} records totalling ${count(stats.totalResidues)} ${isProtein ? 'residues' : 'bases'}.`,
    thresholdNote: 'Informational; no threshold applies.',
  });

  checks.push({
    id: 'empty-sequences',
    label: 'Empty sequences',
    status: stats.emptyCount === 0 ? 'pass' : 'review',
    value: count(stats.emptyCount),
    explanation:
      'Records with a header but no residues. These usually indicate a truncated write or an over-aggressive filtering step upstream.',
    thresholdNote: 'Any empty record is reported.',
    affected: stats.emptyCount,
  });

  checks.push({
    id: 'invalid-characters',
    label: 'Invalid characters',
    status: stats.invalidCharacters === 0 ? 'pass' : 'review',
    value: count(stats.invalidCharacters),
    explanation: `Sequences containing characters outside the ${isProtein ? 'amino acid' : 'IUPAC nucleotide'} alphabet. A high count often means the sequence type was detected incorrectly.`,
    thresholdNote: `Checked against the ${isProtein ? 'amino acid' : 'IUPAC nucleotide'} alphabet; any offending sequence is reported.`,
    affected: stats.invalidCharacters,
  });

  checks.push({
    id: 'length-range',
    label: 'Length range',
    status:
      stats.tooShort === 0 && stats.tooLong === 0
        ? 'pass'
        : stats.tooShort + stats.tooLong > stats.sequenceCount * 0.1
          ? 'review'
          : 'warning',
    value: `${count(stats.minLength)} - ${count(stats.maxLength)}`,
    explanation: `${count(stats.tooShort)} ${plural(stats.tooShort, 'sequence')} at or below ${count(thresholds.minLength)} and ${count(stats.tooLong)} at or above ${count(thresholds.maxLength)}. Short records are often adapter-only reads or fragments; the acceptable floor depends entirely on the assay.`,
    thresholdNote: `Short below ${count(thresholds.minLength)}, long above ${count(thresholds.maxLength)}. REVIEW when more than 10% of sequences fall outside the range.`,
    affected: stats.tooShort + stats.tooLong,
  });

  checks.push({
    id: 'n50',
    label: METRIC_DOCS.n50.label,
    status: 'pass',
    value: count(stats.n50),
    explanation: `${METRIC_DOCS.n50.what} ${METRIC_DOCS.n50.caveat}`,
    thresholdNote: 'Informational; a meaningful target depends on the expected genome or transcriptome size.',
  });

  if (!isProtein) {
    const gcOutside = stats.gcPercent < thresholds.gcLowWarn || stats.gcPercent > thresholds.gcHighWarn;
    checks.push({
      id: 'gc-content',
      label: METRIC_DOCS.gc.label,
      status: gcOutside ? 'warning' : 'pass',
      value: percent(stats.gcPercent),
      explanation: `${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}`,
      thresholdNote: `Warns outside ${thresholds.gcLowWarn}-${thresholds.gcHighWarn}%. This band is a generic sanity check, not an expectation for any particular organism.`,
    });
  }

  const ambiguousFraction = stats.ambiguousPercent / 100;
  checks.push({
    id: 'ambiguous-bases',
    label: METRIC_DOCS.ambiguous.label,
    status:
      ambiguousFraction >= thresholds.ambiguousReview
        ? 'review'
        : ambiguousFraction >= thresholds.ambiguousWarn
          ? 'warning'
          : 'pass',
    value: percent(stats.ambiguousPercent),
    explanation: `${METRIC_DOCS.ambiguous.what} ${METRIC_DOCS.ambiguous.caveat}`,
    thresholdNote: `Warns at ${(thresholds.ambiguousWarn * 100).toFixed(1)}%, flags for review at ${(thresholds.ambiguousReview * 100).toFixed(1)}%.`,
  });

  checks.push({
    id: 'duplicates',
    label: METRIC_DOCS.duplicates.label,
    status:
      stats.duplicateFraction >= thresholds.duplicateReview
        ? 'review'
        : stats.duplicateFraction >= thresholds.duplicateWarn
          ? 'warning'
          : 'pass',
    value: `${percent(stats.duplicateFraction * 100)} (${count(stats.duplicateSequences)} in ${count(stats.duplicateGroups)} groups)`,
    explanation: `${METRIC_DOCS.duplicates.what} ${METRIC_DOCS.duplicates.caveat}`,
    thresholdNote: `Warns at ${(thresholds.duplicateWarn * 100).toFixed(0)}%, flags for review at ${(thresholds.duplicateReview * 100).toFixed(0)}%.`,
    affected: stats.duplicateSequences,
  });

  checks.push({
    id: 'homopolymers',
    label: 'Homopolymer runs',
    status:
      stats.homopolymer === 0
        ? 'pass'
        : stats.homopolymer > stats.sequenceCount * 0.25
          ? 'warning'
          : 'pass',
    value: count(stats.homopolymer),
    explanation: `Sequences containing a run of ${count(thresholds.homopolymerMinRun)} or more identical residues. Long homopolymers are genuine genomic features and are also where nanopore and ion semiconductor chemistries make the most length errors.`,
    thresholdNote: `Runs of ${count(thresholds.homopolymerMinRun)}+ are counted; warns when more than a quarter of sequences contain one.`,
    affected: stats.homopolymer,
  });

  checks.push({
    id: 'low-complexity',
    label: 'Low-complexity sequences',
    status:
      stats.lowComplexity === 0
        ? 'pass'
        : stats.lowComplexity > stats.sequenceCount * 0.1
          ? 'warning'
          : 'pass',
    value: count(stats.lowComplexity),
    explanation: `Sequences whose overall residue entropy is low, meaning their composition is dominated by a few residues. ${METRIC_DOCS.entropy.caveat}`,
    thresholdNote: `Flagged below ${thresholds.lowComplexityEntropy.toFixed(2)} bits per residue (scaled to the alphabet); warns when more than 10% of sequences qualify.`,
    affected: stats.lowComplexity,
  });

  if (hasQuality && stats.meanQuality !== null) {
    checks.push({
      id: 'mean-quality',
      label: 'Mean read quality',
      status:
        stats.meanQuality < thresholds.meanQualityReview
          ? 'review'
          : stats.meanQuality < thresholds.meanQualityWarn
            ? 'warning'
            : 'pass',
      value: `Q${stats.meanQuality.toFixed(1)}`,
      explanation: `Mean Phred score across every base of every read, decoded with the ${input.dataset.qualityEncoding === 'phred64' ? 'Phred+64' : 'Phred+33'} offset. Q20 is a 1-in-100 error rate and Q30 is 1-in-1000. ${METRIC_DOCS.perBaseQuality.caveat}`,
      thresholdNote: `Warns below Q${thresholds.meanQualityWarn}, flags for review below Q${thresholds.meanQualityReview}.`,
    });
  } else {
    checks.push({
      id: 'mean-quality',
      label: 'Mean read quality',
      status: 'not-applicable',
      value: '-',
      explanation: 'FASTA files carry no per-base quality scores.',
      thresholdNote: 'Applies to FASTQ input only.',
    });
  }

  return checks;
}

const SEVERITY: Record<QCStatus, number> = {
  'not-applicable': 0,
  pass: 1,
  warning: 2,
  review: 3,
};

/** The most severe status in a list, which becomes the dataset's verdict. */
export function worstStatus(statuses: QCStatus[]): QCStatus {
  let worst: QCStatus = 'pass';
  for (const status of statuses) {
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}
