/**
 * Substitution matrices, transcribed from the NCBI distributions.
 *
 * Both matrices use the same 24-symbol row/column order, which is the order
 * NCBI ships them in. The compiled form is a flat 128x128 `Int8Array` indexed
 * by ASCII code pairs, so scoring a cell in the alignment inner loop is a
 * single array read with no string or map lookups.
 */

export const MATRIX_ORDER = 'ARNDCQEGHILKMFPSTWYVBZX*';

/** BLOSUM62: the default for protein alignment since Henikoff & Henikoff 1992. */
const BLOSUM62_ROWS = [
  [4, -1, -2, -2, 0, -1, -1, 0, -2, -1, -1, -1, -1, -2, -1, 1, 0, -3, -2, 0, -2, -1, 0, -4],
  [-1, 5, 0, -2, -3, 1, 0, -2, 0, -3, -2, 2, -1, -3, -2, -1, -1, -3, -2, -3, -1, 0, -1, -4],
  [-2, 0, 6, 1, -3, 0, 0, 0, 1, -3, -3, 0, -2, -3, -2, 1, 0, -4, -2, -3, 3, 0, -1, -4],
  [-2, -2, 1, 6, -3, 0, 2, -1, -1, -3, -4, -1, -3, -3, -1, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [0, -3, -3, -3, 9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4],
  [-1, 1, 0, 0, -3, 5, 2, -2, 0, -3, -2, 1, 0, -3, -1, 0, -1, -2, -1, -2, 0, 3, -1, -4],
  [-1, 0, 0, 2, -4, 2, 5, -2, 0, -3, -3, 1, -2, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -2, 0, -1, -3, -2, -2, 6, -2, -4, -4, -2, -3, -3, -2, 0, -2, -2, -3, -3, -1, -2, -1, -4],
  [-2, 0, 1, -1, -3, 0, 0, -2, 8, -3, -3, -1, -2, -1, -2, -1, -2, -2, 2, -3, 0, 0, -1, -4],
  [-1, -3, -3, -3, -1, -3, -3, -4, -3, 4, 2, -3, 1, 0, -3, -2, -1, -3, -1, 3, -3, -3, -1, -4],
  [-1, -2, -3, -4, -1, -2, -3, -4, -3, 2, 4, -2, 2, 0, -3, -2, -1, -2, -1, 1, -4, -3, -1, -4],
  [-1, 2, 0, -1, -3, 1, 1, -2, -1, -3, -2, 5, -1, -3, -1, 0, -1, -3, -2, -2, 0, 1, -1, -4],
  [-1, -1, -2, -3, -1, 0, -2, -3, -2, 1, 2, -1, 5, 0, -2, -1, -1, -1, -1, 1, -3, -1, -1, -4],
  [-2, -3, -3, -3, -2, -3, -3, -3, -1, 0, 0, -3, 0, 6, -4, -2, -2, 1, 3, -1, -3, -3, -1, -4],
  [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4, 7, -1, -1, -4, -3, -2, -2, -1, -2, -4],
  [1, -1, 1, 0, -1, 0, 0, 0, -1, -2, -2, 0, -1, -2, -1, 4, 1, -3, -2, -2, 0, 0, 0, -4],
  [0, -1, 0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1, 1, 5, -2, -2, 0, -1, -1, 0, -4],
  [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1, 1, -4, -3, -2, 11, 2, -3, -4, -3, -2, -4],
  [-2, -2, -2, -3, -2, -1, -2, -3, 2, -1, -1, -2, -1, 3, -3, -2, -2, 2, 7, -1, -3, -2, -1, -4],
  [0, -3, -3, -3, -1, -2, -2, -3, -3, 3, 1, -2, 1, -1, -2, -2, 0, -3, -1, 4, -3, -2, -1, -4],
  [-2, -1, 3, 4, -3, 0, 1, -1, 0, -3, -4, 0, -3, -3, -2, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [-1, 0, 0, 1, -3, 3, 4, -2, 0, -3, -3, 1, -1, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2, 0, 0, -2, -1, -1, -1, -1, -1, -4],
  [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, 1],
];

/** PAM250: useful for distant homologues, where BLOSUM62 under-scores. */
const PAM250_ROWS = [
  [2, -2, 0, 0, -2, 0, 0, 1, -1, -1, -2, -1, -1, -3, 1, 1, 1, -6, -3, 0, 0, 0, 0, -8],
  [-2, 6, 0, -1, -4, 1, -1, -3, 2, -2, -3, 3, 0, -4, 0, 0, -1, 2, -4, -2, -1, 0, -1, -8],
  [0, 0, 2, 2, -4, 1, 1, 0, 2, -2, -3, 1, -2, -3, 0, 1, 0, -4, -2, -2, 2, 1, 0, -8],
  [0, -1, 2, 4, -5, 2, 3, 1, 1, -2, -4, 0, -3, -6, -1, 0, 0, -7, -4, -2, 3, 3, -1, -8],
  [-2, -4, -4, -5, 12, -5, -5, -3, -3, -2, -6, -5, -5, -4, -3, 0, -2, -8, 0, -2, -4, -5, -3, -8],
  [0, 1, 1, 2, -5, 4, 2, -1, 3, -2, -2, 1, -1, -5, 0, -1, -1, -5, -4, -2, 1, 3, -1, -8],
  [0, -1, 1, 3, -5, 2, 4, 0, 1, -2, -3, 0, -2, -5, -1, 0, 0, -7, -4, -2, 3, 3, -1, -8],
  [1, -3, 0, 1, -3, -1, 0, 5, -2, -3, -4, -2, -3, -5, 0, 1, 0, -7, -5, -1, 0, 0, -1, -8],
  [-1, 2, 2, 1, -3, 3, 1, -2, 6, -2, -2, 0, -2, -2, 0, -1, -1, -3, 0, -2, 1, 2, -1, -8],
  [-1, -2, -2, -2, -2, -2, -2, -3, -2, 5, 2, -2, 2, 1, -2, -1, 0, -5, -1, 4, -2, -2, -1, -8],
  [-2, -3, -3, -4, -6, -2, -3, -4, -2, 2, 6, -3, 4, 2, -3, -3, -2, -2, -1, 2, -3, -3, -1, -8],
  [-1, 3, 1, 0, -5, 1, 0, -2, 0, -2, -3, 5, 0, -5, -1, 0, 0, -3, -4, -2, 1, 0, -1, -8],
  [-1, 0, -2, -3, -5, -1, -2, -3, -2, 2, 4, 0, 6, 0, -2, -2, -1, -4, -2, 2, -2, -2, -1, -8],
  [-3, -4, -3, -6, -4, -5, -5, -5, -2, 1, 2, -5, 0, 9, -5, -3, -3, 0, 7, -1, -4, -5, -2, -8],
  [1, 0, 0, -1, -3, 0, -1, 0, 0, -2, -3, -1, -2, -5, 6, 1, 0, -6, -5, -1, -1, 0, -1, -8],
  [1, 0, 1, 0, 0, -1, 0, 1, -1, -1, -3, 0, -2, -3, 1, 2, 1, -2, -3, -1, 0, 0, 0, -8],
  [1, -1, 0, 0, -2, -1, 0, 0, -1, 0, -2, 0, -1, -3, 0, 1, 3, -5, -3, 0, 0, -1, 0, -8],
  [-6, 2, -4, -7, -8, -5, -7, -7, -3, -5, -2, -3, -4, 0, -6, -2, -5, 17, 0, -6, -5, -6, -4, -8],
  [-3, -4, -2, -4, 0, -4, -4, -5, 0, -1, -1, -4, -2, 7, -5, -3, -3, 0, 10, -2, -3, -4, -2, -8],
  [0, -2, -2, -2, -2, -2, -2, -1, -2, 4, 2, -2, 2, -1, -1, -1, 0, -6, -2, 4, -2, -2, -1, -8],
  [0, -1, 2, 3, -4, 1, 3, 0, 1, -2, -3, 1, -2, -4, -1, 0, 0, -5, -3, -2, 3, 2, -1, -8],
  [0, 0, 1, 3, -5, 3, 3, 0, 2, -2, -3, 0, -2, -5, 0, 0, -1, -6, -4, -2, 2, 3, -1, -8],
  [0, -1, 0, -1, -3, -1, -1, -1, -1, -1, -1, -1, -1, -2, -1, 0, 0, -4, -2, -1, -1, -1, -1, -8],
  [-8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, 1],
];

export interface ScoringMatrix {
  id: string;
  name: string;
  /** Flat 128*128 table indexed by `codeA * 128 + codeB`. */
  table: Int8Array;
  /** Score used when a residue is outside the matrix alphabet. */
  fallback: number;
}

function compileMatrix(id: string, name: string, rows: number[][]): ScoringMatrix {
  if (rows.length !== MATRIX_ORDER.length) {
    throw new Error(`Matrix ${id} has ${rows.length} rows but the alphabet has ${MATRIX_ORDER.length}.`);
  }
  const table = new Int8Array(128 * 128).fill(-1);
  for (let i = 0; i < MATRIX_ORDER.length; i += 1) {
    if (rows[i].length !== MATRIX_ORDER.length) {
      throw new Error(`Matrix ${id} row ${MATRIX_ORDER[i]} has ${rows[i].length} entries.`);
    }
    const a = MATRIX_ORDER.charCodeAt(i);
    const aLower = MATRIX_ORDER[i].toLowerCase().charCodeAt(0);
    for (let j = 0; j < MATRIX_ORDER.length; j += 1) {
      const b = MATRIX_ORDER.charCodeAt(j);
      const bLower = MATRIX_ORDER[j].toLowerCase().charCodeAt(0);
      const score = rows[i][j];
      table[a * 128 + b] = score;
      table[aLower * 128 + b] = score;
      table[a * 128 + bLower] = score;
      table[aLower * 128 + bLower] = score;
    }
  }
  return { id, name, table, fallback: -1 };
}

export const BLOSUM62 = compileMatrix('blosum62', 'BLOSUM62', BLOSUM62_ROWS);
export const PAM250 = compileMatrix('pam250', 'PAM250', PAM250_ROWS);

/**
 * Builds a match/mismatch matrix for nucleotide alignment.
 *
 * Every IUPAC nucleotide code is included so that ambiguous positions score as
 * mismatches rather than falling through to the fallback, and `N` against
 * anything scores 0: an unknown base is neither evidence for nor against
 * homology.
 */
export function nucleotideMatrix(match: number, mismatch: number): ScoringMatrix {
  const alphabet = 'ACGTUNRYSWKMBDHV';
  const table = new Int8Array(128 * 128).fill(mismatch);
  for (const a of alphabet) {
    for (const b of alphabet) {
      let score: number;
      if (a === 'N' || b === 'N') score = 0;
      else if (a === b) score = match;
      else if ((a === 'T' && b === 'U') || (a === 'U' && b === 'T')) score = match;
      else score = mismatch;
      for (const ca of [a, a.toLowerCase()]) {
        for (const cb of [b, b.toLowerCase()]) {
          table[ca.charCodeAt(0) * 128 + cb.charCodeAt(0)] = score;
        }
      }
    }
  }
  return { id: 'nucleotide', name: `Match ${match} / mismatch ${mismatch}`, table, fallback: mismatch };
}

/** Identity matrix: +1 for a match, -1 otherwise, for any alphabet. */
export function identityMatrix(): ScoringMatrix {
  const table = new Int8Array(128 * 128).fill(-1);
  for (let code = 0; code < 128; code += 1) table[code * 128 + code] = 1;
  // Case-insensitive identity.
  for (let code = 65; code <= 90; code += 1) {
    table[code * 128 + (code + 32)] = 1;
    table[(code + 32) * 128 + code] = 1;
  }
  return { id: 'identity', name: 'Identity', table, fallback: -1 };
}

/** Looks up the score for a residue pair. */
export const score = (matrix: ScoringMatrix, a: number, b: number): number =>
  a < 128 && b < 128 ? matrix.table[a * 128 + b] : matrix.fallback;
