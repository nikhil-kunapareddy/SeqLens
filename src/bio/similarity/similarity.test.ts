import { describe, expect, it } from 'vitest';
import {
  estimateJaccard,
  exactJaccard,
  kmerSet,
  mashDistance,
  sketchNucleotide,
  sketchProtein,
} from './minhash';
import { condensedLength, getPair, matrixStats, pairIndex, setPair, toDense } from './matrix';
import {
  buildDendrogram,
  collectLeaves,
  cutDendrogram,
  dendrogramHeight,
  greedyCluster,
  leafOrder,
} from './clustering';
import { createRng } from '../parsers/hash';
import { reverseComplement } from '../statistics/composition';

const randomSequence = (length: number, rng: () => number): string => {
  const bases = 'ACGT';
  let out = '';
  for (let i = 0; i < length; i += 1) out += bases[Math.floor(rng() * 4)];
  return out;
};

/** Introduces substitutions at the given rate. */
const mutate = (sequence: string, rate: number, rng: () => number): string => {
  const bases = 'ACGT';
  let out = '';
  for (const base of sequence) {
    if (rng() < rate) out += bases[Math.floor(rng() * 4)];
    else out += base;
  }
  return out;
};

describe('MinHash sketching', () => {
  it('produces a sketch no larger than the requested size', () => {
    const sketch = sketchNucleotide(randomSequence(5000, createRng(1)), 8, 128);
    expect(sketch.hashes.length).toBe(128);
    expect(sketch.k).toBe(8);
    expect(sketch.kmerCount).toBe(5000 - 8 + 1);
  });

  it('produces a sorted, distinct sketch', () => {
    const sketch = sketchNucleotide(randomSequence(2000, createRng(2)), 6, 64);
    for (let i = 1; i < sketch.hashes.length; i += 1) {
      expect(sketch.hashes[i]).toBeGreaterThan(sketch.hashes[i - 1]);
    }
  });

  it('under-fills the sketch for short sequences', () => {
    const sketch = sketchNucleotide('ACGTACGTAC', 8, 128);
    expect(sketch.hashes.length).toBeLessThan(128);
    expect(sketch.hashes.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const sequence = randomSequence(1000, createRng(3));
    expect([...sketchNucleotide(sequence, 8, 64).hashes]).toEqual([
      ...sketchNucleotide(sequence, 8, 64).hashes,
    ]);
  });

  it('sketches a sequence and its reverse complement identically', () => {
    // Canonical k-mers mean strand orientation does not matter.
    const sequence = randomSequence(2000, createRng(4));
    const forward = sketchNucleotide(sequence, 8, 128);
    const reverse = sketchNucleotide(reverseComplement(sequence), 8, 128);
    expect(estimateJaccard(forward, reverse)).toBe(1);
  });

  it('skips k-mers spanning ambiguous bases', () => {
    const clean = sketchNucleotide('ACGTACGTACGTACGT', 4, 32);
    const gapped = sketchNucleotide('ACGTACGTNNNNACGTACGTACGT', 4, 32);
    expect(gapped.kmerCount).toBeLessThan(24 - 4 + 1);
    expect(clean.kmerCount).toBe(13);
  });

  it('sketches proteins', () => {
    const sketch = sketchProtein('MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGE', 3, 32);
    expect(sketch.hashes.length).toBeGreaterThan(0);
    expect(sketch.kmerCount).toBe(38);
  });
});

describe('estimateJaccard', () => {
  it('returns 1 for identical sequences', () => {
    const sequence = randomSequence(3000, createRng(5));
    const sketch = sketchNucleotide(sequence, 8, 128);
    expect(estimateJaccard(sketch, sketch)).toBe(1);
  });

  it('returns a low value for unrelated sequences', () => {
    const rng = createRng(6);
    const a = sketchNucleotide(randomSequence(3000, rng), 8, 128);
    const b = sketchNucleotide(randomSequence(3000, rng), 8, 128);
    expect(estimateJaccard(a, b)).toBeLessThan(0.05);
  });

  it('returns 0 when either sketch is empty', () => {
    const empty = sketchNucleotide('', 8, 128);
    const full = sketchNucleotide(randomSequence(500, createRng(7)), 8, 128);
    expect(estimateJaccard(empty, full)).toBe(0);
    expect(estimateJaccard(empty, empty)).toBe(0);
  });

  it('is symmetric', () => {
    const rng = createRng(8);
    const source = randomSequence(2000, rng);
    const a = sketchNucleotide(source, 8, 128);
    const b = sketchNucleotide(mutate(source, 0.05, rng), 8, 128);
    expect(estimateJaccard(a, b)).toBe(estimateJaccard(b, a));
  });

  it('decreases monotonically as divergence increases', () => {
    const rng = createRng(9);
    const source = randomSequence(5000, rng);
    const reference = sketchNucleotide(source, 8, 256);

    let previous = 1.01;
    for (const rate of [0.01, 0.03, 0.05, 0.1, 0.2]) {
      const estimate = estimateJaccard(
        reference,
        sketchNucleotide(mutate(source, rate, rng), 8, 256),
      );
      expect(estimate, `rate ${rate}`).toBeLessThan(previous);
      previous = estimate;
    }
  });

  it('approximates the exact Jaccard within the expected sketch error', () => {
    const rng = createRng(10);
    const sketchSize = 512;
    for (let trial = 0; trial < 12; trial += 1) {
      const source = randomSequence(4000, rng);
      const other = mutate(source, 0.02 + trial * 0.02, rng);

      const exact = exactJaccard(kmerSet(source, 8), kmerSet(other, 8));
      const estimate = estimateJaccard(
        sketchNucleotide(source, 8, sketchSize),
        sketchNucleotide(other, 8, sketchSize),
      );

      // Standard error is sqrt(j(1-j)/s); allow four of them plus a floor.
      const tolerance = 4 * Math.sqrt((exact * (1 - exact)) / sketchSize) + 0.02;
      expect(Math.abs(estimate - exact), `exact ${exact}`).toBeLessThan(tolerance);
    }
  });
});

describe('exactJaccard and kmerSet', () => {
  it('returns 1 for two empty sets', () => {
    expect(exactJaccard(new Set(), new Set())).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(exactJaccard(new Set([1, 2]), new Set([3, 4]))).toBe(0);
  });

  it('computes the set overlap', () => {
    expect(exactJaccard(new Set([1, 2, 3]), new Set([2, 3, 4]))).toBeCloseTo(2 / 4, 10);
  });

  it('collapses reverse-complement k-mers into one canonical set', () => {
    const forward = kmerSet('ACGTTTGCA', 4);
    const reverse = kmerSet(reverseComplement('ACGTTTGCA'), 4);
    expect(exactJaccard(forward, reverse)).toBe(1);
  });
});

describe('mashDistance', () => {
  it('is 0 at perfect similarity and 1 at none', () => {
    expect(mashDistance(1, 8)).toBe(0);
    expect(mashDistance(0, 8)).toBe(1);
  });

  it('increases as Jaccard falls', () => {
    expect(mashDistance(0.9, 8)).toBeLessThan(mashDistance(0.5, 8));
    expect(mashDistance(0.5, 8)).toBeLessThan(mashDistance(0.1, 8));
  });

  it('approximates the true substitution rate', () => {
    const rng = createRng(11);
    const source = randomSequence(20000, rng);
    const rate = 0.05;
    const jaccard = estimateJaccard(
      sketchNucleotide(source, 16, 1024),
      sketchNucleotide(mutate(source, rate, rng), 16, 1024),
    );
    // With k = 16, the Mash distance should land near the true rate.
    expect(mashDistance(jaccard, 16)).toBeGreaterThan(rate * 0.5);
    expect(mashDistance(jaccard, 16)).toBeLessThan(rate * 2);
  });
});

describe('condensed matrix', () => {
  it('computes the condensed length', () => {
    expect(condensedLength(1)).toBe(0);
    expect(condensedLength(2)).toBe(1);
    expect(condensedLength(4)).toBe(6);
    expect(condensedLength(100)).toBe(4950);
  });

  it('maps every pair to a unique index', () => {
    const n = 12;
    const seen = new Set<number>();
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const index = pairIndex(n, i, j);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(condensedLength(n));
        expect(seen.has(index)).toBe(false);
        seen.add(index);
      }
    }
    expect(seen.size).toBe(condensedLength(n));
  });

  it('is order-independent', () => {
    expect(pairIndex(10, 3, 7)).toBe(pairIndex(10, 7, 3));
  });

  it('returns -1 on the diagonal', () => {
    expect(pairIndex(10, 4, 4)).toBe(-1);
  });

  it('stores and retrieves values with 1 on the diagonal', () => {
    const n = 5;
    const matrix = new Float32Array(condensedLength(n));
    setPair(matrix, n, 1, 3, 0.75);
    expect(getPair(matrix, n, 1, 3)).toBeCloseTo(0.75, 6);
    expect(getPair(matrix, n, 3, 1)).toBeCloseTo(0.75, 6);
    expect(getPair(matrix, n, 2, 2)).toBe(1);
  });

  it('computes matrix statistics', () => {
    const stats = matrixStats(Float32Array.from([0.1, 0.5, 0.9]));
    expect(stats.mean).toBeCloseTo(0.5, 6);
    expect(stats.median).toBeCloseTo(0.5, 6);
    expect(stats.max).toBeCloseTo(0.9, 6);
    expect(stats.min).toBeCloseTo(0.1, 6);
    expect(stats.count).toBe(3);
  });

  it('handles an empty matrix', () => {
    expect(matrixStats(new Float32Array(0))).toMatchObject({ mean: 0, count: 0 });
  });

  it('expands to a symmetric dense matrix', () => {
    const n = 3;
    const matrix = new Float32Array(condensedLength(n));
    setPair(matrix, n, 0, 1, 0.5);
    setPair(matrix, n, 0, 2, 0.25);
    setPair(matrix, n, 1, 2, 0.75);
    const dense = toDense(matrix, n);
    for (let i = 0; i < n; i += 1) {
      expect(dense[i * n + i]).toBe(1);
      for (let j = 0; j < n; j += 1) {
        expect(dense[i * n + j]).toBeCloseTo(dense[j * n + i], 6);
      }
    }
    expect(dense[0 * n + 1]).toBeCloseTo(0.5, 6);
  });
});

describe('hierarchical clustering', () => {
  /** Two tight groups: {0,1,2} mutually 0.9, {3,4} mutually 0.9, across 0.1. */
  const twoGroups = () => {
    const n = 5;
    const matrix = new Float32Array(condensedLength(n));
    const groupA = [0, 1, 2];
    const groupB = [3, 4];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const sameGroup =
          (groupA.includes(i) && groupA.includes(j)) || (groupB.includes(i) && groupB.includes(j));
        setPair(matrix, n, i, j, sameGroup ? 0.9 : 0.1);
      }
    }
    return { matrix, n };
  };

  it('returns null for an empty matrix', () => {
    expect(buildDendrogram(new Float32Array(0), 0, 'average')).toBeNull();
  });

  it('returns a single leaf for one sequence', () => {
    const root = buildDendrogram(new Float32Array(0), 1, 'average');
    expect(root).toMatchObject({ size: 1, height: 0, memberIndex: 0 });
  });

  it('builds a tree whose leaves cover every member exactly once', () => {
    const { matrix, n } = twoGroups();
    for (const linkage of ['single', 'complete', 'average'] as const) {
      const root = buildDendrogram(matrix, n, linkage);
      const leaves = collectLeaves(root!).sort((a, b) => a - b);
      expect(leaves, linkage).toEqual([0, 1, 2, 3, 4]);
      expect(root!.size, linkage).toBe(n);
    }
  });

  it('produces monotonically non-decreasing merge heights for average linkage', () => {
    const { matrix, n } = twoGroups();
    const root = buildDendrogram(matrix, n, 'average');
    const check = (node: typeof root): void => {
      if (!node?.children) return;
      for (const child of node.children) {
        expect(child.height).toBeLessThanOrEqual(node.height + 1e-9);
        check(child);
      }
    };
    check(root);
  });

  it('recovers the two groups when cut at the right threshold', () => {
    const { matrix, n } = twoGroups();
    const root = buildDendrogram(matrix, n, 'average');
    const clusters = cutDendrogram(root, 0.5).map((c) => c.sort((a, b) => a - b));
    expect(clusters).toHaveLength(2);
    const sorted = clusters.sort((a, b) => b.length - a.length);
    expect(sorted[0]).toEqual([0, 1, 2]);
    expect(sorted[1]).toEqual([3, 4]);
  });

  it('produces one cluster at a permissive threshold', () => {
    const { matrix, n } = twoGroups();
    const root = buildDendrogram(matrix, n, 'average');
    expect(cutDendrogram(root, 0)).toHaveLength(1);
  });

  it('produces singletons at a strict threshold', () => {
    const { matrix, n } = twoGroups();
    const root = buildDendrogram(matrix, n, 'average');
    const clusters = cutDendrogram(root, 0.999);
    expect(clusters).toHaveLength(5);
    expect(clusters.every((c) => c.length === 1)).toBe(true);
  });

  it('returns no clusters for a null tree', () => {
    expect(cutDendrogram(null, 0.5)).toEqual([]);
  });

  it('orders leaves so that cluster members are adjacent', () => {
    const { matrix, n } = twoGroups();
    const order = leafOrder(buildDendrogram(matrix, n, 'average'));
    expect(order).toHaveLength(n);
    // The three members of group A must occupy three consecutive slots.
    const positions = [0, 1, 2].map((member) => order.indexOf(member)).sort((a, b) => a - b);
    expect(positions[2] - positions[0]).toBe(2);
  });

  it('reports the tree height', () => {
    const { matrix, n } = twoGroups();
    const root = buildDendrogram(matrix, n, 'average');
    expect(dendrogramHeight(root)).toBeCloseTo(0.9, 5);
    expect(dendrogramHeight(null)).toBe(0);
  });

  it('gives single linkage a height no greater than complete linkage', () => {
    const { matrix, n } = twoGroups();
    const single = dendrogramHeight(buildDendrogram(matrix, n, 'single'));
    const complete = dendrogramHeight(buildDendrogram(matrix, n, 'complete'));
    expect(single).toBeLessThanOrEqual(complete + 1e-9);
  });

  it('handles a matrix where everything is identical', () => {
    const n = 6;
    const matrix = new Float32Array(condensedLength(n)).fill(1);
    const root = buildDendrogram(matrix, n, 'average');
    expect(collectLeaves(root!)).toHaveLength(n);
    expect(dendrogramHeight(root)).toBeCloseTo(0, 6);
  });
});

describe('greedyCluster', () => {
  it('groups members above the threshold', () => {
    // 0 and 1 are similar; 2 is alone.
    const similarity = (a: number, b: number) => (a < 2 && b < 2 ? 0.9 : 0.1);
    const clusters = greedyCluster(3, similarity, 0.5);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].members).toEqual([0, 1]);
    expect(clusters[1].members).toEqual([2]);
  });

  it('produces one cluster per member at a strict threshold', () => {
    expect(greedyCluster(4, () => 0.1, 0.9)).toHaveLength(4);
  });

  it('produces a single cluster at a permissive threshold', () => {
    expect(greedyCluster(4, () => 1, 0.5)).toHaveLength(1);
  });

  it('honours the supplied processing order', () => {
    const similarity = (a: number, b: number) => (Math.abs(a - b) === 1 ? 0.9 : 0.1);
    const clusters = greedyCluster(3, similarity, 0.5, [2, 1, 0]);
    expect(clusters[0].representative).toBe(2);
  });

  it('returns nothing for an empty input', () => {
    expect(greedyCluster(0, () => 1, 0.5)).toEqual([]);
  });
});
