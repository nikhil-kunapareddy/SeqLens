import { createRng } from '../parsers/hash';

export interface KMeansResult {
  /** Cluster id per sample. */
  assignments: Int32Array;
  /** Centroids, row-major `k * dimensions`. */
  centroids: Float32Array;
  /** Within-cluster sum of squares. */
  inertia: number;
  iterations: number;
  /** Clusters that ended up with no members are reported rather than dropped. */
  emptyClusters: number;
}

/**
 * k-means with k-means++ seeding.
 *
 * k-means++ is used rather than random seeding because random initialisation on
 * embedding data regularly produces a run where two centroids land inside one
 * dense cluster and a real cluster goes unclaimed. The seeding is driven by the
 * supplied PRNG seed so results are reproducible.
 *
 * k-means assumes roughly spherical, similarly sized clusters and always
 * returns exactly k of them, whether or not the data has that structure. In the
 * embedding explorer the cluster colouring is a visual aid for spotting
 * structure, not a claim that the groups are biologically meaningful.
 */
export function kmeans(
  data: Float32Array,
  sampleCount: number,
  dimensions: number,
  k: number,
  seed = 42,
  maxIterations = 100,
): KMeansResult {
  const clusters = Math.max(1, Math.min(k, sampleCount));
  const assignments = new Int32Array(sampleCount);
  const centroids = new Float32Array(clusters * dimensions);

  if (sampleCount === 0 || dimensions === 0) {
    return { assignments, centroids, inertia: 0, iterations: 0, emptyClusters: 0 };
  }

  const rng = createRng(seed);

  // k-means++ seeding.
  const firstIndex = Math.floor(rng() * sampleCount);
  centroids.set(data.subarray(firstIndex * dimensions, (firstIndex + 1) * dimensions), 0);

  const closestDistance = new Float64Array(sampleCount).fill(Infinity);
  for (let c = 1; c < clusters; c += 1) {
    let total = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const d = squaredDistance(data, centroids, dimensions, i, c - 1);
      if (d < closestDistance[i]) closestDistance[i] = d;
      total += closestDistance[i];
    }
    let pick = rng() * total;
    let chosen = sampleCount - 1;
    for (let i = 0; i < sampleCount; i += 1) {
      pick -= closestDistance[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.set(
      data.subarray(chosen * dimensions, (chosen + 1) * dimensions),
      c * dimensions,
    );
  }

  const sums = new Float64Array(clusters * dimensions);
  const counts = new Int32Array(clusters);
  let iterations = 0;
  let inertia = 0;

  for (; iterations < maxIterations; iterations += 1) {
    let changed = false;
    inertia = 0;
    sums.fill(0);
    counts.fill(0);

    for (let i = 0; i < sampleCount; i += 1) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < clusters; c += 1) {
        const d = squaredDistance(data, centroids, dimensions, i, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
      inertia += bestDistance;
      counts[best] += 1;
      const offset = i * dimensions;
      const centroidOffset = best * dimensions;
      for (let d = 0; d < dimensions; d += 1) {
        sums[centroidOffset + d] += data[offset + d];
      }
    }

    for (let c = 0; c < clusters; c += 1) {
      if (counts[c] === 0) continue;
      const centroidOffset = c * dimensions;
      for (let d = 0; d < dimensions; d += 1) {
        centroids[centroidOffset + d] = sums[centroidOffset + d] / counts[c];
      }
    }

    if (!changed) {
      iterations += 1;
      break;
    }
  }

  let emptyClusters = 0;
  for (let c = 0; c < clusters; c += 1) {
    if (counts[c] === 0) emptyClusters += 1;
  }

  return { assignments, centroids, inertia, iterations, emptyClusters };
}

function squaredDistance(
  data: Float32Array,
  centroids: Float32Array,
  dimensions: number,
  sample: number,
  centroid: number,
): number {
  const a = sample * dimensions;
  const b = centroid * dimensions;
  let sum = 0;
  for (let d = 0; d < dimensions; d += 1) {
    const diff = data[a + d] - centroids[b + d];
    sum += diff * diff;
  }
  return sum;
}

/**
 * Nearest neighbours of one sample in the full-dimensional space.
 *
 * Neighbours are computed on the original vectors rather than the 2-D
 * projection: two points can land close together in a UMAP layout without being
 * close in the embedding space, and it is the embedding space that carries the
 * signal.
 */
export function nearestNeighbors(
  data: Float32Array,
  sampleCount: number,
  dimensions: number,
  queryIndex: number,
  count: number,
  metric: 'cosine' | 'euclidean' = 'cosine',
): { index: number; distance: number; similarity: number }[] {
  const results: { index: number; distance: number; similarity: number }[] = [];
  if (queryIndex < 0 || queryIndex >= sampleCount) return results;

  const queryOffset = queryIndex * dimensions;
  let queryNorm = 0;
  for (let d = 0; d < dimensions; d += 1) {
    queryNorm += data[queryOffset + d] * data[queryOffset + d];
  }
  queryNorm = Math.sqrt(queryNorm);

  for (let i = 0; i < sampleCount; i += 1) {
    if (i === queryIndex) continue;
    const offset = i * dimensions;
    if (metric === 'cosine') {
      let dot = 0;
      let norm = 0;
      for (let d = 0; d < dimensions; d += 1) {
        dot += data[queryOffset + d] * data[offset + d];
        norm += data[offset + d] * data[offset + d];
      }
      norm = Math.sqrt(norm);
      const similarity = queryNorm === 0 || norm === 0 ? 0 : dot / (queryNorm * norm);
      results.push({ index: i, distance: 1 - similarity, similarity });
    } else {
      let sum = 0;
      for (let d = 0; d < dimensions; d += 1) {
        const diff = data[queryOffset + d] - data[offset + d];
        sum += diff * diff;
      }
      const distance = Math.sqrt(sum);
      results.push({ index: i, distance, similarity: 1 / (1 + distance) });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, count);
}
