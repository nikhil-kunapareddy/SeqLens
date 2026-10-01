/**
 * 64-bit FNV-1a implemented as two 32-bit halves.
 *
 * Used to group candidate duplicate sequences. A 64-bit digest gives a
 * collision probability below 1e-9 for ten million sequences, and duplicate
 * detection still confirms every candidate group by comparing residues, so a
 * collision costs a wasted comparison rather than a wrong answer.
 */

const OFFSET_LOW = 0x84222325;
const OFFSET_HIGH = 0xcbf29ce4;

export interface Hash64 {
  low: number;
  high: number;
}

/**
 * Multiplies the 64-bit accumulator by the FNV prime, modulo 2^64.
 *
 * The prime 0x100000001b3 decomposes into 16-bit limbs as
 * `435 + 0*2^16 + 256*2^32`, so the schoolbook product needs only three partial
 * terms. Every intermediate stays below 2^25, well inside the 53-bit
 * exact-integer range of a JavaScript number, which is why this is done with
 * numbers rather than BigInt: BigInt would be roughly 30x slower on the hot
 * per-residue path.
 */
function fnvMultiply(low: number, high: number): Hash64 {
  const a0 = low & 0xffff;
  const a1 = low >>> 16;
  const a2 = high & 0xffff;
  const a3 = high >>> 16;

  let r0 = a0 * 435;
  let r1 = a1 * 435;
  let r2 = a2 * 435 + a0 * 256;
  let r3 = a3 * 435 + a1 * 256;

  r1 += Math.floor(r0 / 0x10000);
  r0 &= 0xffff;
  r2 += Math.floor(r1 / 0x10000);
  r1 &= 0xffff;
  r3 += Math.floor(r2 / 0x10000);
  r2 &= 0xffff;
  r3 &= 0xffff;

  return { low: ((r1 << 16) | r0) >>> 0, high: ((r3 << 16) | r2) >>> 0 };
}

/** Hashes a string as UTF-16 code units. Residues are ASCII so this is exact. */
export function hash64(text: string, from = 0, to = text.length): Hash64 {
  let low = OFFSET_LOW;
  let high = OFFSET_HIGH;
  for (let i = from; i < to; i += 1) {
    low = (low ^ text.charCodeAt(i)) >>> 0;
    const next = fnvMultiply(low, high);
    low = next.low;
    high = next.high;
  }
  return { low, high };
}

/** Stable hexadecimal rendering of a 64-bit digest. */
export const formatHash = ({ low, high }: Hash64): string =>
  high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');

/**
 * 32-bit integer mixer (MurmurHash3 finalizer). Used for MinHash sketching and
 * for hashing k-mer codes, where speed matters more than digest width.
 */
export function mix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 32-bit hash of an arbitrary string (config fingerprints). */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = mix32(h1);
  h2 = mix32(h2);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** xorshift128 PRNG: reproducible randomness for sampling and UMAP/k-means. */
export function createRng(seed: number): () => number {
  let s0 = mix32(seed || 1) || 1;
  let s1 = mix32(s0 ^ 0x9e3779b9) || 2;
  let s2 = mix32(s1 ^ 0x85ebca6b) || 3;
  let s3 = mix32(s2 ^ 0xc2b2ae35) || 4;
  return () => {
    const t = (s1 << 9) >>> 0;
    let r = (Math.imul(s1, 5) >>> 0) as number;
    r = ((r << 7) | (r >>> 25)) >>> 0;
    r = (Math.imul(r, 9) >>> 0) as number;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return r / 4294967296;
  };
}
