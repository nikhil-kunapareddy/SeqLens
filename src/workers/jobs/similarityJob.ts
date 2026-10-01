import {
  alignmentIdentity,
  buildDendrogram,
  condensedLength,
  confirmDuplicates,
  createRng,
  cutDendrogram,
  estimateJaccard,
  findDuplicateCandidates,
  getPair,
  matrixStats,
  nucleotideMatrix,
  BLOSUM62,
  setPair,
  sketchNucleotide,
  sketchProtein,
  type Sketch,
} from '@/bio';
import {
  datasetRepository,
  forEachBlock,
  gcPercentFromIndex,
  getSequencesByIndices,
  idFromIndex,
} from '@/storage';
import type {
  ClusterAssignment,
  SimilarityJobRequest,
  SimilarityMember,
  SimilarityPair,
  SimilarityResult,
} from '@/types';
import { AnalysisError, type JobContext } from '../context';

/** Top pairs retained for the table. */
const MAX_TOP_PAIRS = 300;

/**
 * Hard cap on matrix size regardless of configuration.
 *
 * The condensed matrix is n(n-1)/2 floats and the clustering is O(n^3). At
 * n = 1500 that is 4.5 MB and roughly three billion comparisons - minutes of
 * work. The cap keeps a misconfigured run from appearing to hang.
 */
const ABSOLUTE_MAX_MATRIX = 1_200;

/**
 * All-pairs similarity, clustering, and redundancy detection.
 *
 * The cost structure drives the design. An exact all-pairs comparison of n
 * sequences is O(n^2) alignments, which is minutes of compute at n = 1000 and
 * hours at n = 10,000. SeqLens does not attempt it. Instead:
 *
 *  1. Exact duplicates are found from the import hashes in O(n log n) and
 *     confirmed by residue comparison. This is exhaustive over the whole
 *     dataset, however large, because it is cheap.
 *  2. Every sequence gets a fixed-size MinHash sketch in one streaming pass.
 *  3. If the dataset exceeds `exactMaxSequences`, a deterministic stratified
 *     sample is taken for the matrix, and the result is marked `sampled` so no
 *     reader mistakes it for exhaustive.
 *  4. Jaccard is estimated for every pair in the (possibly sampled) set from
 *     the sketches - integer comparisons, not alignments.
 *  5. Optionally, the highest-scoring pairs are re-scored by real alignment,
 *     capped at `maxRefinedPairs`, to convert k-mer overlap into identity.
 *
 * The distinction between an estimate and a measurement is preserved
 * throughout: `jaccard` is always a sketch estimate, `identity` is present only
 * where an alignment actually ran.
 */
export async function runSimilarityJob(
  request: SimilarityJobRequest,
  context: JobContext,
): Promise<SimilarityResult> {
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
  if (index.count === 0) {
    throw new AnalysisError({
      code: 'no-data',
      message: 'This dataset contains no sequences to compare.',
      suggestion: 'Check the import summary for parse errors.',
    });
  }
  if (index.count === 1) {
    throw new AnalysisError({
      code: 'no-data',
      message: 'Similarity analysis needs at least two sequences; this dataset has one.',
      suggestion:
        'Import a multi-sequence file, or use the Alignment module to compare this sequence against another dataset.',
    });
  }

  const notes: string[] = [];
  const isProtein = dataset.sequenceType === 'protein';

  /* ------------------------- exact duplicates ----------------------------- */

  context.report({ id: 'duplicates', label: 'Finding exact duplicates', value: 0.2 }, true);
  const candidates = findDuplicateCandidates(index.hashLow, index.hashHigh, index.lengths);
  const candidateIndices: number[] = [];
  for (const run of candidates.runs) {
    for (let i = run.start; i < run.end; i += 1) candidateIndices.push(candidates.order[i]);
  }

  const residuesByIndex = new Map<number, string>();
  if (candidateIndices.length > 0) {
    for (const sequence of await getSequencesByIndices(datasetId, candidateIndices)) {
      residuesByIndex.set(sequence.index, sequence.residues);
    }
  }
  context.checkCancelled();

  const duplicates = confirmDuplicates(
    candidates,
    index.hashLow,
    index.hashHigh,
    index.lengths,
    (i) => idFromIndex(index, i),
    (i) => residuesByIndex.get(i) ?? '',
    { maxGroups: 200 },
  );
  residuesByIndex.clear();
  context.complete(
    'duplicates',
    'Finding exact duplicates',
    `${duplicates.duplicateGroups.toLocaleString()} groups`,
  );

  /* ---------------------------- member selection -------------------------- */

  const requestedMax = Math.min(
    config.exactMaxSequences > 0 ? config.exactMaxSequences : index.count,
    ABSOLUTE_MAX_MATRIX,
  );
  const sampled = index.count > requestedMax;
  const targetSize = sampled
    ? Math.min(config.sampleSize > 0 ? config.sampleSize : requestedMax, requestedMax)
    : index.count;

  const memberIndices = sampled
    ? stratifiedSample(index.lengths, targetSize, 20_260_917)
    : Array.from({ length: index.count }, (_, i) => i);

  if (sampled) {
    notes.push(
      `The dataset has ${index.count.toLocaleString()} sequences, above the ${requestedMax.toLocaleString()}-sequence matrix limit. ` +
        `A deterministic sample of ${memberIndices.length.toLocaleString()} sequences, stratified by length so the full length range is represented, was compared instead. ` +
        'Exact duplicate detection above still covers every sequence in the dataset.',
    );
  }

  const members: SimilarityMember[] = memberIndices.map((position) => ({
    index: position,
    id: idFromIndex(index, position),
    length: index.lengths[position],
    gcPercent: gcPercentFromIndex(index, position),
  }));

  /* ------------------------------ sketching ------------------------------- */

  context.report({ id: 'sketch', label: 'Building k-mer sketches', value: 0 }, true);

  const memberSet = new Set(memberIndices);
  const sketches = new Map<number, Sketch>();
  const sketchK = Math.max(2, Math.min(config.sketchK, isProtein ? 5 : 15));
  if (sketchK !== config.sketchK) {
    notes.push(`Sketch k was clamped from ${config.sketchK} to ${sketchK} for this alphabet.`);
  }

  let sketched = 0;
  await forEachBlock(datasetId, async ({ block, blockIndex, totalBlocks }) => {
    context.checkCancelled();
    for (let local = 0; local < block.count; local += 1) {
      const position = block.startIndex + local;
      if (!memberSet.has(position)) continue;
      const residues = block.residues.slice(block.offsets[local], block.offsets[local + 1]);
      sketches.set(
        position,
        isProtein
          ? sketchProtein(residues, sketchK, config.sketchSize)
          : sketchNucleotide(residues, sketchK, config.sketchSize),
      );
      sketched += 1;
    }
    context.report({
      id: 'sketch',
      label: 'Building k-mer sketches',
      value: totalBlocks === 0 ? 1 : (blockIndex + 1) / totalBlocks,
      detail: `${sketched.toLocaleString()} of ${members.length.toLocaleString()} sequences`,
    });
    // Once every member is sketched there is no reason to read further blocks.
    return sketched < members.length;
  });
  context.complete('sketch', 'Building k-mer sketches');

  const underfilled = members.filter(
    (member) => (sketches.get(member.index)?.hashes.length ?? 0) < config.sketchSize,
  ).length;
  if (underfilled > 0) {
    notes.push(
      `${underfilled.toLocaleString()} sequences are short enough that their sketch holds fewer than ${config.sketchSize} hashes. Their Jaccard estimates are noisier than the rest.`,
    );
  }

  /* ------------------------------- matrix --------------------------------- */

  const n = members.length;
  const matrix = new Float32Array(condensedLength(n));
  const totalPairs = condensedLength(n);

  context.report({
    id: 'matrix',
    label: 'Building similarity matrix',
    value: 0,
    detail: `${totalPairs.toLocaleString()} pairs`,
  }, true);

  let pairsDone = 0;
  const pairHeap: SimilarityPair[] = [];

  for (let i = 0; i < n; i += 1) {
    const sketchA = sketches.get(members[i].index);
    for (let j = i + 1; j < n; j += 1) {
      const sketchB = sketches.get(members[j].index);
      const jaccard =
        sketchA && sketchB ? estimateJaccard(sketchA, sketchB) : 0;
      setPair(matrix, n, i, j, jaccard);
      pairsDone += 1;
      if (jaccard > 0) pairHeap.push({ a: i, b: j, jaccard });
    }

    if ((i & 15) === 0) {
      context.checkCancelled();
      context.report({
        id: 'matrix',
        label: 'Building similarity matrix',
        value: totalPairs === 0 ? 1 : pairsDone / totalPairs,
        detail: `${pairsDone.toLocaleString()} of ${totalPairs.toLocaleString()} pairs`,
      });
    }
  }
  context.complete('matrix', 'Building similarity matrix', `${totalPairs.toLocaleString()} pairs`);

  pairHeap.sort((a, b) => b.jaccard - a.jaccard);
  const topPairs = pairHeap.slice(0, MAX_TOP_PAIRS);

  /* --------------------------- alignment refinement ----------------------- */

  let pairsRefined = 0;
  if (config.refineWithAlignment && topPairs.length > 0) {
    const refineCount = Math.min(config.maxRefinedPairs, topPairs.length);
    context.report({ id: 'refine', label: 'Refining with alignment', value: 0 }, true);

    // Load only the sequences the refined pairs actually need.
    const needed = new Set<number>();
    for (let p = 0; p < refineCount; p += 1) {
      needed.add(members[topPairs[p].a].index);
      needed.add(members[topPairs[p].b].index);
    }
    const loaded = new Map<number, string>();
    for (const sequence of await getSequencesByIndices(datasetId, [...needed])) {
      loaded.set(sequence.index, sequence.residues);
    }

    const options = {
      mode: 'global' as const,
      matrix: isProtein ? BLOSUM62 : nucleotideMatrix(2, -1),
      gapOpen: isProtein ? 11 : 5,
      gapExtend: isProtein ? 1 : 2,
    };
    // Pairs whose product of lengths exceeds this are skipped: the linear-memory
    // identity routine is O(m*n) in time even though it is O(n) in space.
    const maxCells = 12_000_000;
    let skippedForSize = 0;

    for (let p = 0; p < refineCount; p += 1) {
      context.checkCancelled();
      const pair = topPairs[p];
      const a = loaded.get(members[pair.a].index);
      const b = loaded.get(members[pair.b].index);
      if (a === undefined || b === undefined) continue;
      if (a.length * b.length > maxCells) {
        skippedForSize += 1;
        continue;
      }
      const refined = alignmentIdentity(a, b, options);
      pair.identity = refined.identity;
      pair.alignedLength = refined.alignedLength;
      pairsRefined += 1;

      if ((p & 7) === 0) {
        context.report({
          id: 'refine',
          label: 'Refining with alignment',
          value: (p + 1) / refineCount,
          detail: `${pairsRefined.toLocaleString()} of ${refineCount.toLocaleString()} pairs aligned`,
        });
      }
    }

    context.complete('refine', 'Refining with alignment', `${pairsRefined.toLocaleString()} pairs`);
    notes.push(
      `Alignment identity was computed for the ${pairsRefined.toLocaleString()} highest-scoring pairs. Every other pair shows only the sketch-based Jaccard estimate.`,
    );
    if (skippedForSize > 0) {
      notes.push(
        `${skippedForSize} pair${skippedForSize === 1 ? '' : 's'} were too long to align exactly and kept their Jaccard estimate only.`,
      );
    }
  }

  /* ----------------------------- clustering ------------------------------- */

  context.report({ id: 'cluster', label: 'Clustering', value: 0.1 }, true);
  const dendrogram = buildDendrogram(matrix, n, config.linkage, (i) => members[i].id);
  context.checkCancelled();

  const clusterGroups = cutDendrogram(dendrogram, config.clusterThreshold);
  const clusters: ClusterAssignment[] = clusterGroups.map((memberPositions, clusterId) => {
    // The representative is the longest member: for redundancy reduction the
    // longest sequence retains the most information of the group.
    let representative = memberPositions[0];
    for (const position of memberPositions) {
      if (members[position].length > members[representative].length) representative = position;
    }

    let similaritySum = 0;
    let pairCount = 0;
    for (let i = 0; i < memberPositions.length; i += 1) {
      for (let j = i + 1; j < memberPositions.length; j += 1) {
        similaritySum += getPair(matrix, n, memberPositions[i], memberPositions[j]);
        pairCount += 1;
      }
    }

    return {
      clusterId,
      memberIndices: memberPositions,
      representativeIndex: representative,
      representativeId: members[representative].id,
      meanSimilarity: pairCount === 0 ? 1 : similaritySum / pairCount,
    };
  });
  clusters.sort((a, b) => b.memberIndices.length - a.memberIndices.length);
  context.complete('cluster', 'Clustering', `${clusters.length.toLocaleString()} clusters`);

  const stats = matrixStats(matrix);
  const redundantMembers = n - clusters.length;

  notes.push(
    `Jaccard values are MinHash estimates from ${config.sketchSize}-hash sketches of ${sketchK}-mers. The standard error is about ${(Math.sqrt(0.25 / config.sketchSize)).toFixed(3)} at a true similarity of 0.5, so small differences between pairs are not meaningful.`,
  );
  notes.push(
    `Clusters were formed by cutting ${config.linkage === 'average' ? 'an' : 'a'} ${config.linkage}-linkage tree at a Jaccard of ${config.clusterThreshold.toFixed(2)}. ${redundantMembers.toLocaleString()} of ${n.toLocaleString()} compared sequences are non-representative members of a cluster.`,
  );

  return {
    kind: 'similarity',
    datasetId,
    computedAt: Date.now(),
    configSnapshot: config,
    members,
    sampled,
    totalSequences: index.count,
    matrix,
    matrixSize: n,
    topPairs,
    clusters,
    dendrogram,
    exactDuplicateGroups: duplicates.groups,
    stats: {
      meanJaccard: stats.mean,
      medianJaccard: stats.median,
      maxJaccard: stats.max,
      pairsCompared: totalPairs,
      pairsRefined,
      redundantFraction: n === 0 ? 0 : redundantMembers / n,
    },
    notes,
  };
}

/**
 * Deterministic length-stratified sample.
 *
 * A uniform random sample of a read set drawn from an assembly would be almost
 * entirely short reads and would miss the long contigs that carry the
 * interesting redundancy. Sorting by length, dividing into as many strata as
 * the target size, and drawing one sequence per stratum guarantees the full
 * length range appears. The PRNG is seeded, so the same dataset always yields
 * the same sample and the result is reproducible.
 */
export function stratifiedSample(
  lengths: Uint32Array,
  target: number,
  seed: number,
): number[] {
  const n = lengths.length;
  if (target >= n) return Array.from({ length: n }, (_, i) => i);

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  const rng = createRng(seed);
  const picked: number[] = [];
  const strideSize = n / target;

  for (let stratum = 0; stratum < target; stratum += 1) {
    const from = Math.floor(stratum * strideSize);
    const to = Math.min(n, Math.floor((stratum + 1) * strideSize));
    if (to <= from) continue;
    picked.push(order[from + Math.floor(rng() * (to - from))]);
  }

  // Sorting by index keeps the block reads sequential.
  return [...new Set(picked)].sort((a, b) => a - b);
}
