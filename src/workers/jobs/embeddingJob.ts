import { ProviderUnavailableError, getProvider, kmeans, pca, umap } from '@/bio';
import { datasetRepository, forEachBlock, gcPercentFromIndex } from '@/storage';
import type { EmbeddingJobRequest, EmbeddingPoint, EmbeddingResult } from '@/types';
import { AnalysisError, type JobContext } from '../context';
import { stratifiedSample } from './similarityJob';

/**
 * Hard cap on embedded sequences.
 *
 * UMAP's neighbour search here is exact brute force, so it is O(n^2 * d). At
 * n = 4000 and d = 256 that is four billion multiply-adds, which is tens of
 * seconds. Above that the run stops being interactive.
 */
const ABSOLUTE_MAX_SEQUENCES = 4_000;

/**
 * Sequence embedding and 2-D projection.
 *
 * The pipeline is provider-driven: sequences go to a registered embedding
 * provider, the resulting vectors are reduced to two dimensions by PCA or UMAP,
 * and k-means over the full-dimensional vectors supplies the cluster colouring.
 *
 * A provider that cannot run on this device fails here with its own
 * explanation rather than silently falling back to another. That matters: if
 * the user asked for a protein language model and got k-mer counts instead,
 * every conclusion they draw from the plot would be about the wrong thing.
 */
export async function runEmbeddingJob(
  request: EmbeddingJobRequest,
  context: JobContext,
): Promise<EmbeddingResult> {
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
  if (index.count < 3) {
    throw new AnalysisError({
      code: 'no-data',
      message: `Embedding needs at least three sequences; this dataset has ${index.count}.`,
      suggestion: 'Import a dataset with more sequences.',
    });
  }

  const provider = getProvider(config.providerId);
  if (!provider) {
    throw new AnalysisError({
      code: 'provider-unavailable',
      message: `No embedding provider is registered under the id "${config.providerId}".`,
      suggestion: 'Choose a provider from the list in the Embeddings panel.',
    });
  }

  const availability = await provider.probe();
  if (availability.status === 'unavailable') {
    throw new AnalysisError({
      code: 'provider-unavailable',
      message: `"${provider.info.name}" cannot run on this device.`,
      suggestion: availability.reason,
      location: provider.info.locality,
    });
  }

  if (!provider.info.supports.includes(dataset.sequenceType)) {
    throw new AnalysisError({
      code: 'wrong-sequence-type',
      message: `"${provider.info.name}" does not support ${dataset.sequenceType} sequences.`,
      suggestion: `It supports: ${provider.info.supports.join(', ')}.`,
    });
  }

  const notes: string[] = [];
  if (availability.status === 'experimental') {
    notes.push(`This provider is marked experimental: ${availability.reason}`);
  }

  /* --------------------------- sequence selection ------------------------- */

  const cap = Math.min(
    config.maxSequences > 0 ? config.maxSequences : index.count,
    ABSOLUTE_MAX_SEQUENCES,
  );
  const sampled = index.count > cap;
  const selected = sampled
    ? stratifiedSample(index.lengths, cap, config.seed)
    : Array.from({ length: index.count }, (_, i) => i);

  if (sampled) {
    notes.push(
      `${selected.length.toLocaleString()} of ${index.count.toLocaleString()} sequences were embedded, sampled deterministically from seed ${config.seed} and stratified by length. The same seed always produces the same sample.`,
    );
  }

  context.report({ id: 'load', label: 'Loading sequences', value: 0 }, true);

  const wanted = new Set(selected);
  const inputs: { index: number; id: string; residues: string }[] = [];
  await forEachBlock(datasetId, async ({ block, blockIndex, totalBlocks }) => {
    context.checkCancelled();
    for (let local = 0; local < block.count; local += 1) {
      const position = block.startIndex + local;
      if (!wanted.has(position)) continue;
      inputs.push({
        index: position,
        id: block.ids[local],
        residues: block.residues.slice(block.offsets[local], block.offsets[local + 1]),
      });
    }
    context.report({
      id: 'load',
      label: 'Loading sequences',
      value: totalBlocks === 0 ? 1 : (blockIndex + 1) / totalBlocks,
      detail: `${inputs.length.toLocaleString()} of ${selected.length.toLocaleString()} sequences`,
    });
    return inputs.length < selected.length;
  });
  context.complete('load', 'Loading sequences');

  if (inputs.length < 3) {
    throw new AnalysisError({
      code: 'no-data',
      message: 'Fewer than three sequences could be read for embedding.',
      suggestion: 'Reload the dataset, or re-import the file.',
    });
  }

  /* ------------------------------ embedding ------------------------------- */

  context.report({ id: 'embed', label: `Embedding with ${provider.info.name}`, value: 0 }, true);

  let batch;
  try {
    batch = await provider.embed(inputs, {
      sequenceType: dataset.sequenceType,
      k: config.k,
      onProgress: (completed, total) => {
        if (context.isCancelled) return false;
        context.report({
          id: 'embed',
          label: `Embedding with ${provider.info.name}`,
          value: total === 0 ? 1 : completed / total,
          detail: `${completed.toLocaleString()} of ${total.toLocaleString()} sequences`,
        });
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      throw new AnalysisError({
        code: 'provider-unavailable',
        message: `"${provider.info.name}" could not produce embeddings.`,
        suggestion: error.reason,
      });
    }
    throw error;
  }

  context.checkCancelled();
  context.complete('embed', `Embedding with ${provider.info.name}`, `${batch.dimensions} dimensions`);
  notes.push(...batch.notes);
  notes.push(`${provider.info.description} ${provider.info.locality}`);

  /* ------------------------------ reduction ------------------------------- */

  context.report({ id: 'reduce', label: `Reducing to 2-D (${config.reduction.toUpperCase()})`, value: 0.1 }, true);

  const pcaResult = pca(batch.vectors, inputs.length, batch.dimensions, 2);
  let coordinates = pcaResult.projection;
  let explainedVariance = pcaResult.explainedVariance;

  if (config.reduction === 'umap') {
    const umapResult = umap(batch.vectors, inputs.length, batch.dimensions, {
      nNeighbors: config.umapNeighbors,
      minDist: config.umapMinDist,
      epochs: config.umapEpochs,
      seed: config.seed,
      // PCA initialisation makes the layout reproducible and speeds convergence.
      init: pcaResult.projection,
      onProgress: (epoch, total) => {
        if (context.isCancelled) return false;
        context.report({
          id: 'reduce',
          label: 'Reducing to 2-D (UMAP)',
          value: total === 0 ? 1 : epoch / total,
          detail: `epoch ${epoch} of ${total}`,
        });
        return true;
      },
    });
    coordinates = umapResult.embedding;
    // UMAP axes are not variance-ordered, so explained variance does not apply.
    explainedVariance = [];
    notes.push(
      `UMAP with ${umapResult.neighbors} neighbours, minimum distance ${config.umapMinDist}, ${config.umapEpochs} epochs, seed ${config.seed}. Axes have no units: relative proximity of points is meaningful, absolute positions and distances between well-separated clusters are not.`,
    );
  } else {
    notes.push(
      `PCA on the ${batch.dimensions}-dimensional vectors. The two axes capture ${((explainedVariance[0] ?? 0) * 100).toFixed(1)}% and ${((explainedVariance[1] ?? 0) * 100).toFixed(1)}% of total variance, so ${(100 - ((explainedVariance[0] ?? 0) + (explainedVariance[1] ?? 0)) * 100).toFixed(1)}% of the structure is not visible in this projection.`,
    );
  }
  context.complete('reduce', `Reducing to 2-D (${config.reduction.toUpperCase()})`);

  /* ------------------------------ clustering ------------------------------ */

  context.report({ id: 'cluster', label: 'Clustering in embedding space', value: 0.3 }, true);
  const clusterCount = Math.max(1, Math.min(config.clusterCount, inputs.length));
  const clustering = kmeans(
    batch.vectors,
    inputs.length,
    batch.dimensions,
    clusterCount,
    config.seed,
  );
  context.complete('cluster', 'Clustering in embedding space', `${clusterCount} clusters`);

  if (clustering.emptyClusters > 0) {
    notes.push(
      `${clustering.emptyClusters} of the ${clusterCount} requested clusters ended up empty, which usually means the data has fewer distinct groups than requested.`,
    );
  }
  notes.push(
    `Clusters come from k-means on the full ${batch.dimensions}-dimensional vectors, not on the 2-D projection, so a cluster can appear split in the plot. k-means always returns the number of clusters asked for, whether or not the data has that many.`,
  );

  /* -------------------------------- points -------------------------------- */

  const points: EmbeddingPoint[] = inputs.map((input, i) => ({
    index: input.index,
    id: input.id,
    length: input.residues.length,
    gcPercent: gcPercentFromIndex(index, input.index),
    x: coordinates[i * 2],
    y: coordinates[i * 2 + 1],
    cluster: clustering.assignments[i],
  }));

  const clusterSummary: EmbeddingResult['clusterSummary'] = [];
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const members = points.filter((point) => point.cluster === cluster);
    if (members.length === 0) {
      clusterSummary.push({ cluster, size: 0, meanGc: 0, meanLength: 0 });
      continue;
    }
    clusterSummary.push({
      cluster,
      size: members.length,
      meanGc: members.reduce((sum, p) => sum + p.gcPercent, 0) / members.length,
      meanLength: members.reduce((sum, p) => sum + p.length, 0) / members.length,
    });
  }

  return {
    kind: 'embedding',
    datasetId,
    computedAt: Date.now(),
    configSnapshot: config,
    providerId: provider.info.id,
    providerName: provider.info.name,
    dimensions: batch.dimensions,
    reduction: config.reduction,
    points,
    vectors: batch.vectors,
    explainedVariance,
    clusterSummary,
    sampled,
    totalSequences: index.count,
    notes,
  };
}
