import type { LengthHistogramBin } from '@/types';

export interface LengthStats {
  count: number;
  total: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  n50: number;
  n90: number;
  /** Number of sequences needed to reach the N50 point. */
  l50: number;
  /** Number of sequences needed to reach the N90 point. */
  l90: number;
}

/**
 * Computes length statistics including the NX family.
 *
 * NX is the length L such that sequences of length >= L account for X% of all
 * residues. The definition is implemented by sorting descending and walking the
 * cumulative residue total, which is the same procedure QUAST and assembly-stats
 * use, so the numbers are directly comparable.
 *
 * The input array is copied before sorting: callers pass the dataset's shared
 * length index, and reordering it would break every other view.
 */
export function computeLengthStats(lengths: ArrayLike<number>): LengthStats {
  const count = lengths.length;
  if (count === 0) {
    return { count: 0, total: 0, min: 0, max: 0, mean: 0, median: 0, n50: 0, n90: 0, l50: 0, l90: 0 };
  }

  const sorted = Uint32Array.from(lengths as ArrayLike<number>);
  sorted.sort(); // ascending

  let total = 0;
  for (let i = 0; i < count; i += 1) total += sorted[i];

  const median =
    count % 2 === 1
      ? sorted[(count - 1) >> 1]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;

  // Walk descending (from the end of the ascending array) for the NX family.
  const half = total * 0.5;
  const ninety = total * 0.9;
  let running = 0;
  let n50 = 0;
  let n90 = 0;
  let l50 = 0;
  let l90 = 0;
  for (let i = count - 1; i >= 0; i -= 1) {
    running += sorted[i];
    const consumed = count - i;
    if (n50 === 0 && running >= half) {
      n50 = sorted[i];
      l50 = consumed;
    }
    if (n90 === 0 && running >= ninety) {
      n90 = sorted[i];
      l90 = consumed;
      break;
    }
  }

  return {
    count,
    total,
    min: sorted[0],
    max: sorted[count - 1],
    mean: total / count,
    median,
    n50,
    n90,
    l50,
    l90,
  };
}

/**
 * Bins lengths for the distribution chart.
 *
 * Sequence length distributions are heavily skewed (millions of 150 bp reads, or
 * a handful of contigs spanning four orders of magnitude), so the binning
 * adapts: a narrow observed range gets one bin per distinct length, and a wide
 * range gets logarithmic bins. Linear bins across a wide range would put
 * everything in the first bucket.
 */
export function buildLengthHistogram(
  lengths: ArrayLike<number>,
  targetBins = 40,
): { bins: LengthHistogramBin[]; scale: 'linear' | 'log' | 'exact' } {
  const count = lengths.length;
  if (count === 0) return { bins: [], scale: 'exact' };

  let min = Infinity;
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    const value = lengths[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) min = 0;

  const span = max - min;

  // Few distinct values: one bin each, which is what fixed-length read sets want.
  if (span < targetBins) {
    const bins: LengthHistogramBin[] = [];
    const counts = new Uint32Array(span + 1);
    for (let i = 0; i < count; i += 1) counts[lengths[i] - min] += 1;
    for (let i = 0; i <= span; i += 1) {
      if (counts[i] > 0) bins.push({ from: min + i, to: min + i + 1, count: counts[i] });
    }
    return { bins, scale: 'exact' };
  }

  // Wide dynamic range: log-spaced bins.
  if (min > 0 && max / min > 100) {
    const logMin = Math.log10(min);
    const logMax = Math.log10(max + 1);
    const step = (logMax - logMin) / targetBins;
    const counts = new Uint32Array(targetBins);
    for (let i = 0; i < count; i += 1) {
      const idx = Math.min(targetBins - 1, Math.floor((Math.log10(lengths[i]) - logMin) / step));
      counts[idx < 0 ? 0 : idx] += 1;
    }
    const bins: LengthHistogramBin[] = [];
    for (let i = 0; i < targetBins; i += 1) {
      bins.push({
        from: Math.round(10 ** (logMin + i * step)),
        to: Math.round(10 ** (logMin + (i + 1) * step)),
        count: counts[i],
      });
    }
    return { bins, scale: 'log' };
  }

  const step = Math.max(1, Math.ceil(span / targetBins));
  const binCount = Math.ceil((span + 1) / step);
  const counts = new Uint32Array(binCount);
  for (let i = 0; i < count; i += 1) {
    counts[Math.min(binCount - 1, Math.floor((lengths[i] - min) / step))] += 1;
  }
  const bins: LengthHistogramBin[] = [];
  for (let i = 0; i < binCount; i += 1) {
    bins.push({ from: min + i * step, to: min + (i + 1) * step, count: counts[i] });
  }
  return { bins, scale: 'linear' };
}

/** The `topN` most frequent exact lengths, descending by frequency. */
export function topLengths(
  lengths: ArrayLike<number>,
  topN = 15,
): { length: number; count: number }[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < lengths.length; i += 1) {
    const value = lengths[i];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([length, count]) => ({ length, count }))
    .sort((a, b) => b.count - a.count || b.length - a.length)
    .slice(0, topN);
}

/** Percentile of a numeric array using linear interpolation. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const rank = (p / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}
