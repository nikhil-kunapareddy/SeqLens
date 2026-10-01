import { BASE_CODE, CODE_BASE } from '../alphabets';

/** Largest k for which a dense count table is used (4^11 * 4 bytes = 16 MB). */
export const MAX_DENSE_K = 11;

/** Largest k that fits in a 32-bit packed code at 2 bits per base. */
export const MAX_PACKED_K = 15;

/** Decodes a packed 2-bit k-mer code back to residues. */
export function decodeKmer(code: number, k: number): string {
  let out = '';
  for (let i = k - 1; i >= 0; i -= 1) {
    out += CODE_BASE[(code >>> (2 * i)) & 3];
  }
  return out;
}

/** Packs a residue string into a 2-bit code, or -1 if it contains non-ACGTU. */
export function encodeKmer(kmer: string): number {
  let code = 0;
  for (let i = 0; i < kmer.length; i += 1) {
    const base = BASE_CODE[kmer.charCodeAt(i)];
    if (base === 255) return -1;
    code = ((code << 2) | base) >>> 0;
  }
  return code;
}

/**
 * Reverse complement of a packed k-mer code.
 * Complementing a 2-bit base is `3 - code`, i.e. a bitwise NOT of the two bits.
 */
export function reverseComplementCode(code: number, k: number): number {
  let out = 0;
  let value = code;
  for (let i = 0; i < k; i += 1) {
    out = ((out << 2) | (3 - (value & 3))) >>> 0;
    value >>>= 2;
  }
  return out;
}

/** Canonical form: the numerically smaller of a k-mer and its complement. */
export const canonicalCode = (code: number, k: number): number => {
  const rc = reverseComplementCode(code, k);
  return rc < code ? rc : code;
};

/** Counting backend: a dense typed array or a sparse map of packed codes. */
export interface NucleotideKmerCounts {
  k: number;
  dense: Uint32Array | null;
  sparse: Map<number, number> | null;
  /** Number of k-mer positions counted. */
  total: number;
  /** k-mer windows skipped because they contained an ambiguous base. */
  skipped: number;
  canonical: boolean;
}

export function createNucleotideCounts(k: number, canonical = false): NucleotideKmerCounts {
  if (k < 1 || k > MAX_PACKED_K) {
    throw new Error(`k must be between 1 and ${MAX_PACKED_K}; received ${k}.`);
  }
  const useDense = k <= MAX_DENSE_K;
  return {
    k,
    dense: useDense ? new Uint32Array(4 ** k) : null,
    sparse: useDense ? null : new Map<number, number>(),
    total: 0,
    skipped: 0,
    canonical,
  };
}

/**
 * Counts k-mers in one sequence using a rolling 2-bit code.
 *
 * The window is rebuilt from scratch whenever a non-ACGTU character appears,
 * which is the standard treatment: a k-mer spanning an N is not a k-mer of any
 * known sequence, so counting it as `NNN` or substituting a base would both be
 * wrong. The number of windows skipped this way is tracked and surfaced, since
 * it is large for gapped assemblies and tells the reader why the counts are
 * lower than `length - k + 1` per sequence.
 */
export function countKmers(residues: string, counts: NucleotideKmerCounts): void {
  const k = counts.k;
  const n = residues.length;
  if (n < k) return;

  const mask = (4 ** k - 1) >>> 0;
  let code = 0;
  let valid = 0;
  let counted = 0;
  const dense = counts.dense;
  const sparse = counts.sparse;
  const canonical = counts.canonical;

  for (let i = 0; i < n; i += 1) {
    const charCode = residues.charCodeAt(i);
    const base = charCode < 128 ? BASE_CODE[charCode] : 255;
    if (base === 255) {
      valid = 0;
      code = 0;
      continue;
    }
    code = (((code << 2) | base) & mask) >>> 0;
    if (valid < k) valid += 1;
    if (valid < k) continue;

    const key = canonical ? canonicalCode(code, k) : code;
    if (dense !== null) dense[key] += 1;
    else sparse!.set(key, (sparse!.get(key) ?? 0) + 1);
    counted += 1;
  }

  counts.total += counted;
  // Windows that straddled an ambiguous base, and so belong to no known k-mer.
  counts.skipped += n - k + 1 - counted;
}

/** Count entries as (code, count) pairs, skipping zeros. */
export function* iterateCounts(counts: NucleotideKmerCounts): Generator<[number, number]> {
  if (counts.dense !== null) {
    const dense = counts.dense;
    for (let code = 0; code < dense.length; code += 1) {
      if (dense[code] !== 0) yield [code, dense[code]];
    }
    return;
  }
  yield* counts.sparse!.entries();
}

/** Number of distinct k-mers with a non-zero count. */
export function distinctCount(counts: NucleotideKmerCounts): number {
  if (counts.sparse !== null) return counts.sparse.size;
  const dense = counts.dense!;
  let distinct = 0;
  for (let i = 0; i < dense.length; i += 1) {
    if (dense[i] !== 0) distinct += 1;
  }
  return distinct;
}

/* -------------------------------------------------------------------------- */
/* Protein / arbitrary-alphabet counting                                       */
/* -------------------------------------------------------------------------- */

export interface StringKmerCounts {
  k: number;
  counts: Map<string, number>;
  total: number;
  skipped: number;
}

export function createStringCounts(k: number): StringKmerCounts {
  return { k, counts: new Map(), total: 0, skipped: 0 };
}

/**
 * Counts k-mers over an arbitrary alphabet using substring keys.
 *
 * Proteins have a 20+ letter alphabet, so packing into fixed-width integers
 * would need 5 bits per residue and would still not cover the ambiguity codes.
 * Substring keys are slower but correct, and protein datasets are typically
 * orders of magnitude smaller in total residues than read sets.
 */
export function countStringKmers(
  residues: string,
  counts: StringKmerCounts,
  skipAmbiguous = 'XBZJ*-.',
): void {
  const k = counts.k;
  const n = residues.length;
  if (n < k) return;
  const skipSet = new Set(skipAmbiguous);

  for (let i = 0; i + k <= n; i += 1) {
    let ok = true;
    for (let j = 0; j < k; j += 1) {
      if (skipSet.has(residues[i + j])) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      counts.skipped += 1;
      continue;
    }
    const kmer = residues.slice(i, i + k);
    counts.counts.set(kmer, (counts.counts.get(kmer) ?? 0) + 1);
    counts.total += 1;
  }
}
