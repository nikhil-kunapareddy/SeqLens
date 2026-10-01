import { describe, expect, it } from 'vitest';
import { alignPairwise, alignmentIdentity, type PairwiseOptions } from './pairwise';
import { BLOSUM62, identityMatrix, nucleotideMatrix, score } from './matrices';
import { createRng } from '../parsers/hash';

const nt: PairwiseOptions = {
  mode: 'global',
  matrix: nucleotideMatrix(2, -1),
  gapOpen: 5,
  gapExtend: 2,
};

/**
 * Brute-force affine-gap alignment reference.
 *
 * Enumerates every possible alignment of two short sequences and returns the
 * best score. Exponential, so only usable up to about eight residues per side,
 * but it depends on none of the DP machinery under test, which is exactly what
 * makes it a useful oracle for the Gotoh recurrences.
 */
function bruteForceGlobal(a: string, b: string, options: PairwiseOptions): number {
  const { matrix, gapOpen, gapExtend } = options;
  let best = -Infinity;

  // state: 0 = last column was a match, 1 = gap in b, 2 = gap in a
  const walk = (i: number, j: number, total: number, lastState: number): void => {
    if (i === a.length && j === b.length) {
      if (total > best) best = total;
      return;
    }
    if (i < a.length && j < b.length) {
      walk(i + 1, j + 1, total + score(matrix, a.charCodeAt(i), b.charCodeAt(j)), 0);
    }
    if (i < a.length) {
      const cost = lastState === 1 ? gapExtend : gapOpen + gapExtend;
      walk(i + 1, j, total - cost, 1);
    }
    if (j < b.length) {
      const cost = lastState === 2 ? gapExtend : gapOpen + gapExtend;
      walk(i, j + 1, total - cost, 2);
    }
  };

  walk(0, 0, 0, -1);
  return best;
}

/** Recomputes an alignment's score from its aligned strings. */
function rescore(alignedA: string, alignedB: string, options: PairwiseOptions): number {
  const { matrix, gapOpen, gapExtend } = options;
  let total = 0;
  let state = -1;
  for (let k = 0; k < alignedA.length; k += 1) {
    const ca = alignedA[k];
    const cb = alignedB[k];
    if (ca === '-') {
      total -= state === 2 ? gapExtend : gapOpen + gapExtend;
      state = 2;
    } else if (cb === '-') {
      total -= state === 1 ? gapExtend : gapOpen + gapExtend;
      state = 1;
    } else {
      total += score(matrix, ca.charCodeAt(0), cb.charCodeAt(0));
      state = 0;
    }
  }
  return total;
}

describe('alignPairwise (global, affine gaps)', () => {
  it('aligns identical sequences without gaps', () => {
    const result = alignPairwise('ACGTACGT', 'ACGTACGT', nt);
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACGTACGT');
    expect(result.gaps).toBe(0);
    expect(result.matches).toBe(8);
    expect(result.identity).toBe(1);
    expect(result.score).toBe(16);
  });

  it('places a single gap for a one-base deletion', () => {
    const result = alignPairwise('ACGTACGT', 'ACGACGT', nt);
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACG-ACGT');
    expect(result.gaps).toBe(1);
    expect(result.matches).toBe(7);
  });

  it('prefers one long gap over several short ones', () => {
    // A five-base insertion: affine gaps should produce a single run.
    const result = alignPairwise('ACGTAAAAACGTACGT', 'ACGTACGTACGT', nt);
    const runs = result.alignedB.match(/-+/g) ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(4);
  });

  it('produces aligned strings of equal length whose score matches the reported score', () => {
    const rng = createRng(20260917);
    const bases = 'ACGT';
    for (let trial = 0; trial < 60; trial += 1) {
      const m = 1 + Math.floor(rng() * 7);
      const n = 1 + Math.floor(rng() * 7);
      let a = '';
      let b = '';
      for (let i = 0; i < m; i += 1) a += bases[Math.floor(rng() * 4)];
      for (let i = 0; i < n; i += 1) b += bases[Math.floor(rng() * 4)];

      const result = alignPairwise(a, b, nt);
      expect(result.alignedA.length).toBe(result.alignedB.length);
      // The traceback must reconstruct the sequences exactly.
      expect(result.alignedA.replace(/-/g, '')).toBe(a);
      expect(result.alignedB.replace(/-/g, '')).toBe(b);
      // The reported score must equal the brute-force optimum...
      expect(result.score).toBe(bruteForceGlobal(a, b, nt));
      // ...and the traced alignment must actually achieve it.
      expect(rescore(result.alignedA, result.alignedB, nt)).toBe(result.score);
    }
  });

  it('handles empty input on either side', () => {
    const left = alignPairwise('', 'ACGT', nt);
    expect(left.alignedA).toBe('----');
    expect(left.alignedB).toBe('ACGT');
    const right = alignPairwise('ACGT', '', nt);
    expect(right.alignedA).toBe('ACGT');
    expect(right.alignedB).toBe('----');
  });

  it('scores protein alignments with BLOSUM62', () => {
    const options: PairwiseOptions = {
      mode: 'global',
      matrix: BLOSUM62,
      gapOpen: 11,
      gapExtend: 1,
    };
    const result = alignPairwise('MKWVTFISLL', 'MKWVTFISLL', options);
    expect(result.identity).toBe(1);
    // Sum of the diagonal for these ten residues.
    const expected = 'MKWVTFISLL'
      .split('')
      .reduce((sum, ch) => sum + score(BLOSUM62, ch.charCodeAt(0), ch.charCodeAt(0)), 0);
    expect(result.score).toBe(expected);
  });
});

describe('alignPairwise (local)', () => {
  const local: PairwiseOptions = { ...nt, mode: 'local' };

  it('extracts only the matching core', () => {
    const result = alignPairwise('TTTTTACGTACGTTTTTT', 'GGGGACGTACGTGGGG', local);
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACGTACGT');
    expect(result.identity).toBe(1);
    expect(result.score).toBe(16);
  });

  it('never reports a negative score', () => {
    const result = alignPairwise('AAAAAA', 'TTTTTT', local);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('reports the coordinates of the aligned region', () => {
    const result = alignPairwise('NNNNACGTACGT', 'ACGTACGT', local);
    expect(result.aStart).toBe(4);
    expect(result.aEnd).toBe(12);
    expect(result.bStart).toBe(0);
    expect(result.bEnd).toBe(8);
  });
});

describe('alignmentIdentity (linear memory)', () => {
  it('agrees with the full traceback implementation on random pairs', () => {
    const rng = createRng(4242);
    const bases = 'ACGT';
    for (let trial = 0; trial < 40; trial += 1) {
      const m = 2 + Math.floor(rng() * 40);
      const n = 2 + Math.floor(rng() * 40);
      let a = '';
      let b = '';
      for (let i = 0; i < m; i += 1) a += bases[Math.floor(rng() * 4)];
      for (let i = 0; i < n; i += 1) b += bases[Math.floor(rng() * 4)];

      for (const mode of ['global', 'local'] as const) {
        const options: PairwiseOptions = { ...nt, mode };
        const full = alignPairwise(a, b, options);
        const linear = alignmentIdentity(a, b, options);
        expect(linear.score).toBeCloseTo(full.score, 6);
        expect(linear.alignedLength).toBe(full.length);
        expect(linear.identity).toBeCloseTo(full.identity, 9);
      }
    }
  });

  it('reports full identity for identical sequences', () => {
    const result = alignmentIdentity('ACGTACGTAC', 'ACGTACGTAC', nt);
    expect(result.identity).toBe(1);
    expect(result.alignedLength).toBe(10);
  });
});

describe('scoring matrices', () => {
  it('scores N against any base as neutral', () => {
    const matrix = nucleotideMatrix(2, -1);
    expect(score(matrix, 'N'.charCodeAt(0), 'A'.charCodeAt(0))).toBe(0);
    expect(score(matrix, 'A'.charCodeAt(0), 'N'.charCodeAt(0))).toBe(0);
  });

  it('treats T and U as equivalent', () => {
    const matrix = nucleotideMatrix(2, -1);
    expect(score(matrix, 'T'.charCodeAt(0), 'U'.charCodeAt(0))).toBe(2);
  });

  it('is case-insensitive', () => {
    const matrix = nucleotideMatrix(2, -1);
    expect(score(matrix, 'a'.charCodeAt(0), 'A'.charCodeAt(0))).toBe(2);
    expect(score(BLOSUM62, 'w'.charCodeAt(0), 'W'.charCodeAt(0))).toBe(11);
  });

  it('is symmetric for BLOSUM62', () => {
    const alphabet = 'ARNDCQEGHILKMFPSTWYV';
    for (const a of alphabet) {
      for (const b of alphabet) {
        expect(score(BLOSUM62, a.charCodeAt(0), b.charCodeAt(0))).toBe(
          score(BLOSUM62, b.charCodeAt(0), a.charCodeAt(0)),
        );
      }
    }
  });

  it('gives the identity matrix +1 on the diagonal only', () => {
    const matrix = identityMatrix();
    expect(score(matrix, 'X'.charCodeAt(0), 'X'.charCodeAt(0))).toBe(1);
    expect(score(matrix, 'X'.charCodeAt(0), 'Y'.charCodeAt(0))).toBe(-1);
  });
});
