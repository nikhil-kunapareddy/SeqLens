import { IS_GAP } from '../alphabets';

const LOG2 = Math.LN2;

/**
 * Shannon entropy of a symbol-count distribution, in bits.
 * Zero counts contribute nothing (the limit of p*log2(p) as p goes to 0).
 */
export function entropyFromCounts(counts: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < counts.length; i += 1) total += counts[i];
  if (total === 0) return 0;

  let entropy = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i];
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * (Math.log(p) / LOG2);
  }
  return entropy;
}

/** Shannon entropy of a count map, in bits. */
export function entropyFromMap(counts: Map<unknown, number> | Record<string, number>): number {
  const values = counts instanceof Map ? [...counts.values()] : Object.values(counts);
  return entropyFromCounts(values);
}

/**
 * Per-residue Shannon entropy of a sequence, in bits.
 *
 * This measures compositional diversity only; it is blind to order, so
 * `ACGTACGTACGT` and a shuffled sequence with the same base counts score
 * identically at 2.0 bits. Use `findLowComplexityRegions` when order matters.
 */
export function sequenceEntropy(residues: string, from = 0, to = residues.length): number {
  const counts = new Uint32Array(128);
  let total = 0;
  for (let i = from; i < to; i += 1) {
    const code = residues.charCodeAt(i);
    if (code > 127 || IS_GAP[code] === 1) continue;
    counts[code] += 1;
    total += 1;
  }
  if (total === 0) return 0;

  let entropy = 0;
  for (let code = 0; code < 128; code += 1) {
    const count = counts[code];
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * (Math.log(p) / LOG2);
  }
  return entropy;
}

export interface Region {
  start: number;
  end: number;
  entropy: number;
  dominantResidue: string;
}

/**
 * Finds low-complexity regions with a sliding window.
 *
 * Windows whose entropy falls at or below `maxEntropy` are merged into maximal
 * regions. A rolling count array makes this O(n) rather than O(n * window):
 * each step adds one residue and removes one, and entropy is recomputed from
 * the counts, which touches at most 128 slots.
 *
 * Coordinates in the returned regions are 1-based and inclusive, matching the
 * convention used everywhere else in SeqLens.
 */
export function findLowComplexityRegions(
  residues: string,
  window = 64,
  maxEntropy = 1.2,
  step = 1,
): Region[] {
  const n = residues.length;
  if (n < window || window <= 0) return [];

  const counts = new Uint32Array(128);
  let inWindow = 0;
  for (let i = 0; i < window; i += 1) {
    const code = residues.charCodeAt(i);
    if (code <= 127) {
      counts[code] += 1;
      inWindow += 1;
    }
  }

  const regions: Region[] = [];
  let openStart = -1;
  let openEnd = -1;
  let openEntropySum = 0;
  let openWindows = 0;

  const windowEntropy = (): number => {
    if (inWindow === 0) return 0;
    let entropy = 0;
    for (let code = 65; code < 123; code += 1) {
      const count = counts[code];
      if (count === 0) continue;
      const p = count / inWindow;
      entropy -= p * (Math.log(p) / LOG2);
    }
    return entropy;
  };

  const dominant = (): string => {
    let best = 0;
    let bestCode = 78; // 'N'
    for (let code = 65; code < 123; code += 1) {
      if (counts[code] > best) {
        best = counts[code];
        bestCode = code;
      }
    }
    return String.fromCharCode(bestCode);
  };

  const closeRegion = (dominantResidue: string) => {
    if (openStart === -1) return;
    regions.push({
      start: openStart + 1,
      end: openEnd + 1,
      entropy: openWindows > 0 ? openEntropySum / openWindows : 0,
      dominantResidue,
    });
    openStart = -1;
    openEnd = -1;
    openEntropySum = 0;
    openWindows = 0;
  };

  let lastDominant = 'N';

  for (let start = 0; start + window <= n; start += step) {
    if (start > 0) {
      for (let i = start - step; i < start; i += 1) {
        const code = residues.charCodeAt(i);
        if (code <= 127) {
          counts[code] -= 1;
          inWindow -= 1;
        }
      }
      for (let i = start + window - step; i < start + window; i += 1) {
        const code = residues.charCodeAt(i);
        if (code <= 127) {
          counts[code] += 1;
          inWindow += 1;
        }
      }
    }

    const entropy = windowEntropy();
    if (entropy <= maxEntropy) {
      if (openStart === -1) openStart = start;
      openEnd = start + window - 1;
      openEntropySum += entropy;
      openWindows += 1;
      lastDominant = dominant();
    } else if (openStart !== -1) {
      closeRegion(lastDominant);
    }
  }
  closeRegion(lastDominant);

  return regions;
}

export interface HomopolymerRun {
  residue: string;
  start: number;
  length: number;
}

/**
 * Finds the longest run of a single repeated residue.
 * Returns null for an empty sequence. Coordinates are 1-based.
 */
export function longestHomopolymer(residues: string): HomopolymerRun | null {
  if (residues.length === 0) return null;
  let bestStart = 0;
  let bestLength = 1;
  let bestCode = residues.charCodeAt(0);

  let runStart = 0;
  let runCode = residues.charCodeAt(0);

  for (let i = 1; i <= residues.length; i += 1) {
    const code = i < residues.length ? residues.charCodeAt(i) : -1;
    if (code !== runCode) {
      const length = i - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
        bestCode = runCode;
      }
      runStart = i;
      runCode = code;
    }
  }

  return {
    residue: String.fromCharCode(bestCode),
    start: bestStart + 1,
    length: bestLength,
  };
}

/** Every homopolymer run at or above `minRun`. Coordinates are 1-based. */
export function findHomopolymers(residues: string, minRun: number): HomopolymerRun[] {
  const runs: HomopolymerRun[] = [];
  if (residues.length === 0 || minRun < 1) return runs;

  let runStart = 0;
  let runCode = residues.charCodeAt(0);

  for (let i = 1; i <= residues.length; i += 1) {
    const code = i < residues.length ? residues.charCodeAt(i) : -1;
    if (code !== runCode) {
      const length = i - runStart;
      if (length >= minRun) {
        runs.push({ residue: String.fromCharCode(runCode), start: runStart + 1, length });
      }
      runStart = i;
      runCode = code;
    }
  }
  return runs;
}

/**
 * Linguistic complexity: distinct k-mers observed divided by the number
 * possible for a sequence of this length.
 *
 * Unlike Shannon entropy this is order-sensitive, so a tandem repeat scores
 * low. Values approach 1.0 for random sequence and fall toward 0 for repeats.
 */
export function linguisticComplexity(residues: string, k = 3): number {
  const n = residues.length;
  if (n < k) return 0;
  const seen = new Set<string>();
  for (let i = 0; i + k <= n; i += 1) seen.add(residues.slice(i, i + k));
  const possible = Math.min(n - k + 1, 4 ** k);
  return possible === 0 ? 0 : seen.size / possible;
}
