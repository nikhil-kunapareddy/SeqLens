import {
  buildLengthHistogram,
  computeLengthStats,
  findOrfs,
  getGeneticCode,
  sixFrameTranslation,
} from '@/bio';
import { datasetRepository, forEachBlock, getSequence } from '@/storage';
import type {
  Orf,
  OrfJobRequest,
  OrfResult,
  TranslateJobRequest,
  TranslateJobResult,
} from '@/types';
import { AnalysisError, type JobContext } from '../context';

/** ORFs retained for display and export. */
const MAX_ORFS = 20_000;

/**
 * ORF detection across a dataset.
 *
 * Each sequence is scanned in up to six frames and the results aggregated. The
 * expensive part is the reverse complement: it allocates a string as long as
 * the sequence, so for a large assembly the peak memory is two copies of the
 * longest contig plus the ORF list, not the whole dataset.
 *
 * The ORF list is capped. Twenty thousand ORFs is already more than any table
 * can usefully show, and the summary statistics are accumulated separately so
 * they still describe every ORF found rather than only the retained ones.
 */
export async function runOrfJob(request: OrfJobRequest, context: JobContext): Promise<OrfResult> {
  const { datasetId, config } = request;

  const [dataset, index] = await Promise.all([
    datasetRepository.get(datasetId),
    datasetRepository.getIndex(datasetId),
  ]);

  if (!dataset || !index) {
    throw new AnalysisError({
      code: 'dataset-missing',
      message: 'This dataset is no longer in local storage.',
      suggestion: 'Re-import the file, or pick a different dataset.',
    });
  }

  if (dataset.sequenceType === 'protein') {
    throw new AnalysisError({
      code: 'wrong-sequence-type',
      message: 'ORF detection needs nucleotide sequences, but this dataset is protein.',
      suggestion:
        'Open ORF analysis on a DNA or RNA dataset. If this file really is nucleotide data that was detected as protein, re-import it with the sequence type set manually.',
      location: dataset.fileName,
    });
  }

  const code = getGeneticCode(config.geneticCode);
  const notes: string[] = [];
  const orfs: Orf[] = [];

  // Aggregates over every ORF found, including any beyond the display cap.
  const allLengths: number[] = [];
  const perFrame = new Map<string, number>();
  const startCodons = new Map<string, number>();
  const stopCodons = new Map<string, number>();
  let orfCount = 0;
  let sequencesWithOrf = 0;
  let sequencesScanned = 0;
  let totalCodingBases = 0;
  let totalBasesScanned = 0;

  const limit = config.maxSequences > 0 ? Math.min(config.maxSequences, index.count) : index.count;
  if (limit < index.count) {
    notes.push(
      `ORFs were detected in the first ${limit.toLocaleString()} of ${index.count.toLocaleString()} sequences. Raise the limit in the configuration panel to scan all of them.`,
    );
  }

  context.report({ id: 'orf', label: 'Scanning reading frames', value: 0 }, true);

  await forEachBlock(datasetId, async ({ block, blockIndex, totalBlocks }) => {
    context.checkCancelled();

    for (let local = 0; local < block.count; local += 1) {
      if (sequencesScanned >= limit) return false;
      const residues = block.residues.slice(block.offsets[local], block.offsets[local + 1]);
      sequencesScanned += 1;
      totalBasesScanned += residues.length;
      if (residues.length < 3) continue;

      const found = findOrfs(residues, block.startIndex + local, block.ids[local], config);
      if (found.length > 0) sequencesWithOrf += 1;

      for (const orf of found) {
        orfCount += 1;
        allLengths.push(orf.aminoAcidLength);
        totalCodingBases += orf.nucleotideLength;
        const frameKey = `${orf.strand}${orf.frame}`;
        perFrame.set(frameKey, (perFrame.get(frameKey) ?? 0) + 1);
        startCodons.set(orf.startCodon, (startCodons.get(orf.startCodon) ?? 0) + 1);
        if (orf.stopCodon) {
          stopCodons.set(orf.stopCodon, (stopCodons.get(orf.stopCodon) ?? 0) + 1);
        }
        if (orfs.length < MAX_ORFS) orfs.push(orf);
      }
    }

    context.report({
      id: 'orf',
      label: 'Scanning reading frames',
      value: totalBlocks === 0 ? 1 : (blockIndex + 1) / totalBlocks,
      detail: `${orfCount.toLocaleString()} ORFs in ${sequencesScanned.toLocaleString()} sequences`,
    });
    return true;
  });

  context.complete('orf', 'Scanning reading frames', `${orfCount.toLocaleString()} ORFs`);

  if (orfs.length < orfCount) {
    notes.push(
      `${orfCount.toLocaleString()} ORFs were found; the ${MAX_ORFS.toLocaleString()} longest are listed. Summary statistics cover all of them.`,
    );
  }
  if (orfCount === 0) {
    notes.push(
      `No ORFs of at least ${config.minAminoAcids} amino acids were found under genetic code ${config.geneticCode}${config.requireStartCodon ? ' with a required start codon' : ' (stop-to-stop)'}. Lowering the minimum length or clearing the start-codon requirement will find shorter and partial reading frames.`,
    );
  }

  orfs.sort((a, b) => b.aminoAcidLength - a.aminoAcidLength);
  const lengthStats = computeLengthStats(allLengths);

  notes.push(
    `Coordinates are 1-based, inclusive, and on the forward strand of each input sequence. Reverse-strand ORFs are reported with strand "-" but with forward-strand coordinates, so they can be drawn on one axis.`,
  );
  if (config.requireStartCodon) {
    notes.push(
      `Start codons for genetic code ${config.geneticCode} are ${code.startCodons.join(', ')}. One ORF is reported per stop codon, beginning at the first start codon after the previous stop.`,
    );
  }

  return {
    kind: 'orf',
    datasetId,
    computedAt: Date.now(),
    configSnapshot: config,
    orfs,
    stats: {
      sequencesScanned,
      sequencesWithOrf,
      orfCount,
      meanOrfLength: lengthStats.mean,
      medianOrfLength: lengthStats.median,
      maxOrfLength: lengthStats.max,
      totalCodingBases,
      codingFraction: totalBasesScanned === 0 ? 0 : totalCodingBases / totalBasesScanned,
    },
    lengthHistogram: buildLengthHistogram(allLengths, 30).bins,
    perFrameCounts: [...perFrame.entries()]
      .map(([frame, value]) => ({ frame, count: value }))
      .sort((a, b) => a.frame.localeCompare(b.frame)),
    startCodonUsage: [...startCodons.entries()]
      .map(([codon, value]) => ({ codon, count: value }))
      .sort((a, b) => b.count - a.count),
    stopCodonUsage: [...stopCodons.entries()]
      .map(([codon, value]) => ({ codon, count: value }))
      .sort((a, b) => b.count - a.count),
    notes,
  };
}

/**
 * Six-frame translation plus ORFs for one sequence, for the detail viewer.
 *
 * Kept as its own job so that inspecting a single 5 Mbp contig does not go
 * through the whole-dataset path, and so the main thread stays responsive while
 * the six translations are produced.
 */
export async function runTranslateJob(
  request: TranslateJobRequest,
  context: JobContext,
): Promise<TranslateJobResult> {
  const { datasetId, sequenceIndex, config } = request;

  const dataset = await datasetRepository.get(datasetId);
  if (!dataset) {
    throw new AnalysisError({
      code: 'dataset-missing',
      message: 'This dataset is no longer in local storage.',
      suggestion: 'Re-import the file, or pick a different dataset.',
    });
  }
  if (dataset.sequenceType === 'protein') {
    throw new AnalysisError({
      code: 'wrong-sequence-type',
      message: 'Translation needs nucleotide sequences, but this dataset is protein.',
      suggestion: 'Open a DNA or RNA dataset to translate it.',
    });
  }

  context.report({ id: 'load', label: 'Loading sequence', value: 0.2 }, true);
  const sequence = await getSequence(datasetId, sequenceIndex);
  if (!sequence) {
    throw new AnalysisError({
      code: 'no-data',
      message: `Sequence ${sequenceIndex + 1} could not be read from local storage.`,
      suggestion: 'Reload the dataset, or re-import the file.',
    });
  }
  context.complete('load', 'Loading sequence');

  context.report({ id: 'translate', label: 'Translating six frames', value: 0.3 }, true);
  const frames = sixFrameTranslation(
    sequence.residues,
    config.geneticCode,
    dataset.sequenceType === 'rna' ? 'rna' : 'dna',
  );
  context.checkCancelled();
  context.complete('translate', 'Translating six frames');

  context.report({ id: 'orf', label: 'Finding ORFs', value: 0.6 }, true);
  const orfs = findOrfs(sequence.residues, sequenceIndex, sequence.id, config);
  context.complete('orf', 'Finding ORFs', `${orfs.length} ORFs`);

  return {
    sequenceId: sequence.id,
    length: sequence.residues.length,
    frames,
    orfs,
  };
}
