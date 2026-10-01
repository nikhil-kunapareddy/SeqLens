/**
 * Alphabets, complement tables, and residue property tables.
 *
 * Everything in this module is a constant lookup. Hot loops elsewhere index
 * into the pre-built `Uint8Array`/`Float64Array` tables rather than doing string
 * or object lookups, which is the single biggest win when scanning hundreds of
 * megabytes of residues.
 */

export const DNA_CANONICAL = 'ACGT';
export const RNA_CANONICAL = 'ACGU';

/** IUPAC nucleotide ambiguity codes and the bases each one stands for. */
export const IUPAC_NUCLEOTIDE: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'U',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
  '-': '',
  '.': '',
};

/** The 20 standard amino acids in alphabetical single-letter order. */
export const STANDARD_AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';

/**
 * Amino acid codes SeqLens accepts. Beyond the standard 20 this includes
 * selenocysteine (U), pyrrolysine (O), the ambiguity codes B (D/N), Z (E/Q),
 * J (I/L), the wildcard X, the stop symbol *, and gap characters.
 */
export const IUPAC_AMINO_ACID = 'ACDEFGHIKLMNPQRSTVWYUOBZJX*-.';

export const AMBIGUOUS_NUCLEOTIDES = 'RYSWKMBDHVN';
export const AMBIGUOUS_AMINO_ACIDS = 'BZJX';
export const GAP_CHARACTERS = '-.';

/** Full single-letter to three-letter amino acid names. */
export const AMINO_ACID_NAMES: Record<string, string> = {
  A: 'Ala',
  C: 'Cys',
  D: 'Asp',
  E: 'Glu',
  F: 'Phe',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  K: 'Lys',
  L: 'Leu',
  M: 'Met',
  N: 'Asn',
  P: 'Pro',
  Q: 'Gln',
  R: 'Arg',
  S: 'Ser',
  T: 'Thr',
  V: 'Val',
  W: 'Trp',
  Y: 'Tyr',
  U: 'Sec',
  O: 'Pyl',
  B: 'Asx',
  Z: 'Glx',
  J: 'Xle',
  X: 'Xaa',
  '*': 'Ter',
};

/** Kyte & Doolittle (1982) hydropathy index. */
export const KYTE_DOOLITTLE: Record<string, number> = {
  A: 1.8,
  R: -4.5,
  N: -3.5,
  D: -3.5,
  C: 2.5,
  Q: -3.5,
  E: -3.5,
  G: -0.4,
  H: -3.2,
  I: 4.5,
  L: 3.8,
  K: -3.9,
  M: 1.9,
  F: 2.8,
  P: -1.6,
  S: -0.8,
  T: -0.7,
  W: -0.9,
  Y: -1.3,
  V: 4.2,
  U: 2.5,
  O: -3.9,
};

/** Average isotopic residue masses in daltons (monomer minus water). */
export const RESIDUE_MASS: Record<string, number> = {
  A: 71.0788,
  R: 156.1875,
  N: 114.1038,
  D: 115.0886,
  C: 103.1388,
  E: 129.1155,
  Q: 128.1307,
  G: 57.0519,
  H: 137.1411,
  I: 113.1594,
  L: 113.1594,
  K: 128.1741,
  M: 131.1926,
  F: 147.1766,
  P: 97.1167,
  S: 87.0782,
  T: 101.1051,
  W: 186.2132,
  Y: 163.176,
  V: 99.1326,
  U: 150.0379,
  O: 237.3018,
};

export const WATER_MASS = 18.01528;

/**
 * EMBOSS pKa values, as used by the classic `iep` program. Terminal values
 * apply to the free alpha-amino and alpha-carboxyl groups.
 */
export const PKA = {
  cTerminus: 3.65,
  nTerminus: 8.2,
  /** Side chains that lose a proton (acidic). */
  acidic: { D: 3.9, E: 4.07, C: 8.37, Y: 10.46 } as Record<string, number>,
  /** Side chains that gain a proton (basic). */
  basic: { H: 6.04, K: 10.54, R: 12.48 } as Record<string, number>,
} as const;

export const POSITIVE_RESIDUES = 'KRH';
export const NEGATIVE_RESIDUES = 'DE';
export const AROMATIC_RESIDUES = 'FWY';

/** Molar extinction coefficients at 280 nm (Pace et al. 1995), reduced Cys. */
export const EXTINCTION_280: Record<string, number> = { W: 5500, Y: 1490, C: 125 };

/* -------------------------------------------------------------------------- */
/* Fast lookup tables                                                         */
/* -------------------------------------------------------------------------- */

const buildCharTable = (spec: Record<string, string>): Uint8Array => {
  const table = new Uint8Array(128);
  for (const [from, to] of Object.entries(spec)) {
    table[from.charCodeAt(0)] = to.charCodeAt(0);
    const lower = from.toLowerCase();
    if (lower !== from) table[lower.charCodeAt(0)] = to.charCodeAt(0);
  }
  return table;
};

/** DNA complement, preserving ambiguity codes and gaps. */
export const DNA_COMPLEMENT_TABLE = buildCharTable({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
  '-': '-',
  '.': '.',
});

/** RNA complement: A pairs with U rather than T. */
export const RNA_COMPLEMENT_TABLE = buildCharTable({
  A: 'U',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
  '-': '-',
  '.': '.',
});

const buildMembership = (chars: string): Uint8Array => {
  const table = new Uint8Array(128);
  for (const ch of chars) {
    table[ch.charCodeAt(0)] = 1;
    table[ch.toLowerCase().charCodeAt(0)] = 1;
  }
  return table;
};

export const IS_NUCLEOTIDE = buildMembership(Object.keys(IUPAC_NUCLEOTIDE).join(''));
export const IS_AMINO_ACID = buildMembership(IUPAC_AMINO_ACID);
export const IS_CANONICAL_DNA = buildMembership('ACGT');
export const IS_CANONICAL_RNA = buildMembership('ACGU');
export const IS_AMBIGUOUS_NUCLEOTIDE = buildMembership(AMBIGUOUS_NUCLEOTIDES);
export const IS_AMBIGUOUS_AMINO_ACID = buildMembership(AMBIGUOUS_AMINO_ACIDS);
export const IS_GC = buildMembership('GCSgcs');
export const IS_GAP = buildMembership(GAP_CHARACTERS);

/**
 * 2-bit code per base for k-mer packing: A=0, C=1, G=2, T/U=3.
 * Any other character maps to 255 and breaks the current k-mer window.
 */
export const BASE_CODE = (() => {
  const table = new Uint8Array(128).fill(255);
  const assign = (ch: string, code: number) => {
    table[ch.charCodeAt(0)] = code;
    table[ch.toLowerCase().charCodeAt(0)] = code;
  };
  assign('A', 0);
  assign('C', 1);
  assign('G', 2);
  assign('T', 3);
  assign('U', 3);
  return table;
})();

export const CODE_BASE = 'ACGT';

/** Uppercase map covering the full ASCII range; avoids `toUpperCase()` calls. */
export const UPPERCASE_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    table[i] = i >= 97 && i <= 122 ? i - 32 : i;
  }
  return table;
})();

/** Kyte-Doolittle values indexed by char code, NaN for unknown residues. */
export const HYDROPATHY_TABLE = (() => {
  const table = new Float64Array(128).fill(Number.NaN);
  for (const [residue, value] of Object.entries(KYTE_DOOLITTLE)) {
    table[residue.charCodeAt(0)] = value;
    table[residue.toLowerCase().charCodeAt(0)] = value;
  }
  return table;
})();

/** Residue masses indexed by char code, NaN for unknown residues. */
export const MASS_TABLE = (() => {
  const table = new Float64Array(128).fill(Number.NaN);
  for (const [residue, value] of Object.entries(RESIDUE_MASS)) {
    table[residue.charCodeAt(0)] = value;
    table[residue.toLowerCase().charCodeAt(0)] = value;
  }
  return table;
})();
