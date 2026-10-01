import { describe, expect, it } from 'vitest';
import {
  canonicalCode,
  countKmers,
  countStringKmers,
  createNucleotideCounts,
  createStringCounts,
  decodeKmer,
  encodeKmer,
  iterateCounts,
  reverseComplementCode,
} from './counter';
import { buildNucleotideSpectrum, buildStringSpectrum, kmerFrequencyVector } from './spectrum';
import { reverseComplement } from '../statistics/composition';

const countsToMap = (counts: ReturnType<typeof createNucleotideCounts>) => {
  const map = new Map<string, number>();
  for (const [code, count] of iterateCounts(counts)) {
    map.set(decodeKmer(code, counts.k), count);
  }
  return map;
};

describe('k-mer encoding', () => {
  it('round-trips through encode and decode', () => {
    for (const kmer of ['A', 'ACGT', 'GGGG', 'TTTTTTT', 'ACGTACGTACG']) {
      expect(decodeKmer(encodeKmer(kmer), kmer.length)).toBe(kmer);
    }
  });

  it('treats U as T', () => {
    expect(encodeKmer('ACGU')).toBe(encodeKmer('ACGT'));
  });

  it('returns -1 for a k-mer with an ambiguous base', () => {
    expect(encodeKmer('ACGN')).toBe(-1);
    expect(encodeKmer('AC-T')).toBe(-1);
  });

  it('complements a packed code consistently with string reverse complement', () => {
    for (const kmer of ['ACGT', 'AAAA', 'GGCC', 'ATGCATGC']) {
      const code = encodeKmer(kmer);
      const complementCode = reverseComplementCode(code, kmer.length);
      expect(decodeKmer(complementCode, kmer.length)).toBe(reverseComplement(kmer));
    }
  });

  it('canonicalises a k-mer and its complement to the same code', () => {
    const forward = encodeKmer('ACGGT');
    const reverse = encodeKmer(reverseComplement('ACGGT'));
    expect(canonicalCode(forward, 5)).toBe(canonicalCode(reverse, 5));
  });
});

describe('countKmers', () => {
  it('counts every window of a clean sequence', () => {
    const counts = createNucleotideCounts(3);
    countKmers('ACGTACGT', counts);
    // 8 - 3 + 1 = 6 windows
    expect(counts.total).toBe(6);
    expect(counts.skipped).toBe(0);
    const map = countsToMap(counts);
    expect(map.get('ACG')).toBe(2);
    expect(map.get('CGT')).toBe(2);
    expect(map.get('GTA')).toBe(1);
    expect(map.get('TAC')).toBe(1);
  });

  it('counts a homopolymer as one repeated k-mer', () => {
    const counts = createNucleotideCounts(4);
    countKmers('AAAAAAA', counts);
    expect(counts.total).toBe(4);
    expect(countsToMap(counts)).toEqual(new Map([['AAAA', 4]]));
  });

  it('skips windows containing an ambiguous base', () => {
    const counts = createNucleotideCounts(3);
    countKmers('ACGNACG', counts);
    // Windows ACG, CGN, GNA, NAC, ACG -> only the two ACG are countable.
    expect(counts.total).toBe(2);
    expect(counts.skipped).toBe(3);
    expect(countsToMap(counts)).toEqual(new Map([['ACG', 2]]));
  });

  it('counts nothing when the sequence is shorter than k', () => {
    const counts = createNucleotideCounts(6);
    countKmers('ACGT', counts);
    expect(counts.total).toBe(0);
  });

  it('accumulates across multiple sequences', () => {
    const counts = createNucleotideCounts(2);
    countKmers('ACAC', counts);
    countKmers('ACAC', counts);
    expect(countsToMap(counts).get('AC')).toBe(4);
  });

  it('merges reverse-complement pairs in canonical mode', () => {
    const plain = createNucleotideCounts(3, false);
    countKmers('AAATTT', plain);
    const canonical = createNucleotideCounts(3, true);
    countKmers('AAATTT', canonical);

    // AAA, AAT, ATT, TTT -> canonical collapses AAA/TTT and AAT/ATT.
    expect(countsToMap(plain).size).toBe(4);
    const canonicalMap = countsToMap(canonical);
    expect(canonicalMap.size).toBe(2);
    expect(canonicalMap.get('AAA')).toBe(2);
    expect(canonicalMap.get('AAT')).toBe(2);
  });

  it('uses a dense table for small k and a sparse map for large k', () => {
    expect(createNucleotideCounts(8).dense).not.toBeNull();
    expect(createNucleotideCounts(8).sparse).toBeNull();
    expect(createNucleotideCounts(13).dense).toBeNull();
    expect(createNucleotideCounts(13).sparse).not.toBeNull();
  });

  it('produces identical counts from the dense and sparse backends', () => {
    const sequence = 'ATGGCGCGATCGATTAGCCATGGCGCGATCGATTAGCCAT';
    const dense = createNucleotideCounts(6);
    countKmers(sequence, dense);
    // Force the sparse backend at the same k.
    const sparse = { ...createNucleotideCounts(6), dense: null, sparse: new Map<number, number>() };
    countKmers(sequence, sparse);
    expect(countsToMap(sparse)).toEqual(countsToMap(dense));
    expect(sparse.total).toBe(dense.total);
  });

  it('rejects k outside the supported range', () => {
    expect(() => createNucleotideCounts(0)).toThrow(/between 1 and/);
    expect(() => createNucleotideCounts(16)).toThrow(/between 1 and/);
  });
});

describe('buildNucleotideSpectrum', () => {
  it('summarises a simple spectrum', () => {
    const counts = createNucleotideCounts(2);
    countKmers('ACACACAC', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 5, rareMaxCount: 1 });

    expect(spectrum.k).toBe(2);
    expect(spectrum.total).toBe(7);
    expect(spectrum.possible).toBe(16);
    expect(spectrum.distinct).toBe(2);
    expect(spectrum.top[0]).toEqual({ kmer: 'AC', count: 4, frequency: 4 / 7 });
    expect(spectrum.exact).toBe(true);
  });

  it('reports zero entropy for a single repeated k-mer', () => {
    const counts = createNucleotideCounts(3);
    countKmers('AAAAAA', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 5, rareMaxCount: 0 });
    expect(spectrum.entropy).toBe(0);
    expect(spectrum.normalizedEntropy).toBe(0);
  });

  it('reports maximum entropy when every k-mer appears once', () => {
    const counts = createNucleotideCounts(1);
    countKmers('ACGT', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 4, rareMaxCount: 0 });
    expect(spectrum.entropy).toBeCloseTo(2, 10);
    expect(spectrum.normalizedEntropy).toBeCloseTo(1, 10);
  });

  it('identifies rare k-mers', () => {
    const counts = createNucleotideCounts(2);
    // AA appears 3 times; AC, CG, GT once each.
    countKmers('AAAACGT', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 10, rareMaxCount: 1 });
    expect(spectrum.rareCount).toBe(3);
    expect(spectrum.rare.map((entry) => entry.kmer).sort()).toEqual(['AC', 'CG', 'GT']);
  });

  it('limits the top list to topN entries sorted descending', () => {
    const counts = createNucleotideCounts(3);
    countKmers('ATGGCGCGATCGATTAGCCGGATCGATCGATCG', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 3, rareMaxCount: 1 });
    expect(spectrum.top).toHaveLength(3);
    expect(spectrum.top[0].count).toBeGreaterThanOrEqual(spectrum.top[1].count);
    expect(spectrum.top[1].count).toBeGreaterThanOrEqual(spectrum.top[2].count);
  });

  it('selects the true top-N even when the table is large', () => {
    const counts = createNucleotideCounts(4);
    // Plant a dominant k-mer amid varied background.
    countKmers('ACGT'.repeat(50) + 'GGGG'.repeat(200), counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 2, rareMaxCount: 1 });
    expect(spectrum.top[0].kmer).toBe('GGGG');
  });

  it('sums top frequencies to at most 1', () => {
    const counts = createNucleotideCounts(3);
    countKmers('ATGGCGCGATCGATTAGCCG', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 100, rareMaxCount: 0 });
    const total = spectrum.top.reduce((sum, entry) => sum + entry.frequency, 0);
    expect(total).toBeLessThanOrEqual(1.0000001);
    expect(total).toBeCloseTo(1, 6);
  });

  it('halves the possible count in canonical mode', () => {
    const counts = createNucleotideCounts(3, true);
    countKmers('ACGTACGT', counts);
    const spectrum = buildNucleotideSpectrum(counts, { topN: 5, rareMaxCount: 0 });
    expect(spectrum.possible).toBe(32);
    expect(spectrum.canonical).toBe(true);
  });
});

describe('protein k-mer counting', () => {
  it('counts substring k-mers', () => {
    const counts = createStringCounts(2);
    countStringKmers('MKWMKW', counts);
    expect(counts.total).toBe(5);
    expect(counts.counts.get('MK')).toBe(2);
    expect(counts.counts.get('KW')).toBe(2);
    expect(counts.counts.get('WM')).toBe(1);
  });

  it('skips windows containing ambiguous residues', () => {
    const counts = createStringCounts(2);
    countStringKmers('MKXWM', counts);
    // MK, KX, XW, WM -> KX and XW are skipped.
    expect(counts.total).toBe(2);
    expect(counts.skipped).toBe(2);
  });

  it('builds a protein spectrum with the 20-letter alphabet size', () => {
    const counts = createStringCounts(2);
    countStringKmers('ACDEACDE', counts);
    const spectrum = buildStringSpectrum(counts, { topN: 5, rareMaxCount: 1 });
    expect(spectrum.possible).toBe(400);
    expect(spectrum.distinct).toBe(4);
    expect(spectrum.top[0].count).toBe(2);
  });
});

describe('kmerFrequencyVector', () => {
  it('produces a unit-norm vector', () => {
    const counts = createNucleotideCounts(3);
    countKmers('ATGGCGCGATCGATTAGCCG', counts);
    const vector = kmerFrequencyVector(counts);
    let norm = 0;
    for (const value of vector) norm += value * value;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 6);
  });

  it('is scale-invariant when the k-mer ratio is preserved', () => {
    // ACACA has AC=2, CA=2; ACACACACA has AC=4, CA=4. Same direction, so
    // normalisation makes the two vectors identical despite the 2x length.
    const short = createNucleotideCounts(2);
    countKmers('ACACA', short);
    const long = createNucleotideCounts(2);
    countKmers('ACACACACA', long);
    const a = kmerFrequencyVector(short);
    const b = kmerFrequencyVector(long);
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
    expect(dot).toBeCloseTo(1, 6);
  });

  it('shows the boundary effect for sequences whose k-mer ratio differs', () => {
    // ACAC has AC=2, CA=1; the longer repeat approaches AC=CA. The vectors stay
    // highly similar but are not identical, which is the expected behaviour: a
    // short sequence cannot reach its own asymptotic k-mer composition.
    const short = createNucleotideCounts(2);
    countKmers('ACAC', short);
    const long = createNucleotideCounts(2);
    countKmers('ACACACACACAC', long);
    const a = kmerFrequencyVector(short);
    const b = kmerFrequencyVector(long);
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
    expect(dot).toBeGreaterThan(0.97);
    expect(dot).toBeLessThan(1);
  });

  it('produces an all-zero vector for a sequence shorter than k', () => {
    const counts = createNucleotideCounts(5);
    countKmers('ACG', counts);
    const vector = kmerFrequencyVector(counts);
    expect(vector.every((value) => value === 0)).toBe(true);
  });
});
