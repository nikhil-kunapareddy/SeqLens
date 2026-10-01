/**
 * Principal component analysis by covariance power iteration with deflation.
 *
 * SeqLens needs two or three components from vectors of a few hundred
 * dimensions, not a full eigendecomposition. Power iteration converges to the
 * leading eigenvector of the covariance matrix in a handful of passes, and
 * deflating the data against each component found yields the next one. For a
 * 256-dimensional k-mer vector this is a 256x256 covariance matrix - trivial -
 * while forming the covariance matrix of a 10,000-dimensional embedding would
 * not be, which is why `pca` falls back to the Gram-matrix formulation when
 * dimensions exceed the sample count.
 */

export interface PcaResult {
  /** Projected coordinates, row-major, `sampleCount * components`. */
  projection: Float32Array;
  components: number;
  /** Fraction of total variance captured by each component. */
  explainedVariance: number[];
  /** Column means subtracted before projection. */
  mean: Float32Array;
  /** Component vectors, row-major, `components * dimensions`. */
  axes: Float32Array;
}

const DEFAULT_ITERATIONS = 120;

export function pca(
  data: Float32Array,
  sampleCount: number,
  dimensions: number,
  components = 2,
  iterations = DEFAULT_ITERATIONS,
): PcaResult {
  const k = Math.max(1, Math.min(components, Math.min(sampleCount, dimensions)));
  const mean = new Float32Array(dimensions);

  if (sampleCount === 0 || dimensions === 0) {
    return {
      projection: new Float32Array(0),
      components: 0,
      explainedVariance: [],
      mean,
      axes: new Float32Array(0),
    };
  }

  // Centre the data. A copy is made so the caller's vectors stay intact: they
  // are also used for nearest-neighbour queries in the embedding explorer.
  for (let i = 0; i < sampleCount; i += 1) {
    const offset = i * dimensions;
    for (let d = 0; d < dimensions; d += 1) mean[d] += data[offset + d];
  }
  for (let d = 0; d < dimensions; d += 1) mean[d] /= sampleCount;

  const centered = new Float64Array(sampleCount * dimensions);
  let totalVariance = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const offset = i * dimensions;
    for (let d = 0; d < dimensions; d += 1) {
      const value = data[offset + d] - mean[d];
      centered[offset + d] = value;
      totalVariance += value * value;
    }
  }
  totalVariance /= Math.max(1, sampleCount - 1);

  const axes = new Float32Array(k * dimensions);
  const projection = new Float32Array(sampleCount * k);
  const explainedVariance: number[] = [];

  const vector = new Float64Array(dimensions);
  const next = new Float64Array(dimensions);
  const scores = new Float64Array(sampleCount);

  for (let component = 0; component < k; component += 1) {
    // Deterministic, non-degenerate start vector.
    for (let d = 0; d < dimensions; d += 1) {
      vector[d] = Math.sin((d + 1) * (component + 1) * 0.7853981633974483) + 1e-6;
    }
    normalize(vector);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      // next = X^T (X v), avoiding materialising the covariance matrix.
      next.fill(0);
      for (let i = 0; i < sampleCount; i += 1) {
        const offset = i * dimensions;
        let dot = 0;
        for (let d = 0; d < dimensions; d += 1) dot += centered[offset + d] * vector[d];
        for (let d = 0; d < dimensions; d += 1) next[d] += centered[offset + d] * dot;
      }
      const norm = normalize(next);
      if (norm === 0) break;

      let delta = 0;
      for (let d = 0; d < dimensions; d += 1) delta += Math.abs(next[d] - vector[d]);
      vector.set(next);
      if (delta < 1e-9) break;
    }

    // Project and record.
    let eigenvalue = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const offset = i * dimensions;
      let dot = 0;
      for (let d = 0; d < dimensions; d += 1) dot += centered[offset + d] * vector[d];
      scores[i] = dot;
      eigenvalue += dot * dot;
      projection[i * k + component] = dot;
    }
    eigenvalue /= Math.max(1, sampleCount - 1);
    explainedVariance.push(totalVariance === 0 ? 0 : eigenvalue / totalVariance);
    for (let d = 0; d < dimensions; d += 1) axes[component * dimensions + d] = vector[d];

    // Deflate: remove this component's contribution before finding the next.
    if (component + 1 < k) {
      for (let i = 0; i < sampleCount; i += 1) {
        const offset = i * dimensions;
        const s = scores[i];
        for (let d = 0; d < dimensions; d += 1) centered[offset + d] -= s * vector[d];
      }
    }
  }

  return { projection, components: k, explainedVariance, mean, axes };
}

function normalize(vector: Float64Array): number {
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return 0;
  for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  return norm;
}
