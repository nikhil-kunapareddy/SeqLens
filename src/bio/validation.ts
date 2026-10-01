import {
  IS_AMBIGUOUS_AMINO_ACID,
  IS_AMBIGUOUS_NUCLEOTIDE,
  IS_AMINO_ACID,
  IS_CANONICAL_DNA,
  IS_CANONICAL_RNA,
  IS_GAP,
  IS_NUCLEOTIDE,
} from './alphabets';
import type { SequenceType } from '@/types';

export interface ValidationReport {
  /** True when every residue belongs to the alphabet for `type`. */
  valid: boolean;
  /** Distinct characters that fall outside the alphabet, in first-seen order. */
  invalidCharacters: string[];
  /** Total number of offending residues. */
  invalidCount: number;
  /** Residues that are valid but ambiguous (N, R, Y ... or X, B, Z, J). */
  ambiguousCount: number;
  /** Gap characters, which are valid in alignments but not in raw input. */
  gapCount: number;
  /** Position of the first offending residue, 0-based, or -1. */
  firstInvalidAt: number;
}

/**
 * Validates residues against the IUPAC alphabet for the given molecule type.
 *
 * Characters are checked against a 128-entry lookup table, so a non-ASCII
 * residue (which occurs when a binary file is mistaken for FASTA) is reported
 * as invalid rather than silently accepted.
 */
export function validateResidues(residues: string, type: SequenceType): ValidationReport {
  const isValid = type === 'protein' ? IS_AMINO_ACID : IS_NUCLEOTIDE;
  const isAmbiguous = type === 'protein' ? IS_AMBIGUOUS_AMINO_ACID : IS_AMBIGUOUS_NUCLEOTIDE;

  const invalidSet = new Set<string>();
  let invalidCount = 0;
  let ambiguousCount = 0;
  let gapCount = 0;
  let firstInvalidAt = -1;

  for (let i = 0; i < residues.length; i += 1) {
    const code = residues.charCodeAt(i);
    if (code > 127 || isValid[code] === 0) {
      invalidCount += 1;
      if (firstInvalidAt === -1) firstInvalidAt = i;
      if (invalidSet.size < 16) invalidSet.add(residues[i]);
      continue;
    }
    if (IS_GAP[code] === 1) {
      gapCount += 1;
    } else if (isAmbiguous[code] === 1) {
      ambiguousCount += 1;
    }
  }

  return {
    valid: invalidCount === 0,
    invalidCharacters: [...invalidSet],
    invalidCount,
    ambiguousCount,
    gapCount,
    firstInvalidAt,
  };
}

export const isValidNucleotideSequence = (residues: string): boolean =>
  validateResidues(residues, 'dna').valid;

export const isValidProteinSequence = (residues: string): boolean =>
  validateResidues(residues, 'protein').valid;

export interface TypeDetection {
  type: SequenceType;
  /** Share of sampled residues consistent with the chosen alphabet, 0..1. */
  confidence: number;
  /** Human-readable justification, surfaced in the import summary. */
  reason: string;
}

/**
 * Infers the molecule type from a residue sample.
 *
 * The rule is deliberately conservative and stated explicitly so it can be
 * overridden in the UI:
 *
 *  1. If at least 85% of residues are A/C/G/T/U/N it is a nucleic acid; the
 *     presence of U with no T makes it RNA.
 *  2. Otherwise, if at least 85% of residues are valid amino acids it is
 *     protein.
 *  3. Otherwise the type is unknown.
 *
 * The 85% floor exists because short nucleotide records with heavy ambiguity
 * coding, and protein records padded with X, both dip below a stricter bar.
 * Note that a short peptide made only of A/C/G/T-letter residues (for example
 * "GATTACA") is indistinguishable from DNA by composition alone; the detection
 * reports its confidence so the caller can present the ambiguity.
 */
export function detectSequenceType(sample: string): TypeDetection {
  let total = 0;
  let nucleotideLike = 0;
  let aminoLike = 0;
  let tCount = 0;
  let uCount = 0;
  let ambiguousNucleotide = 0;
  let proteinOnly = 0;

  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code > 127) {
      total += 1;
      continue;
    }
    if (IS_GAP[code] === 1) continue;
    total += 1;

    const canonicalNucleotide = IS_CANONICAL_DNA[code] === 1 || IS_CANONICAL_RNA[code] === 1;
    if (canonicalNucleotide || code === 78 || code === 110) {
      nucleotideLike += 1;
    } else if (IS_AMBIGUOUS_NUCLEOTIDE[code] === 1) {
      ambiguousNucleotide += 1;
    }

    if (IS_AMINO_ACID[code] === 1) {
      aminoLike += 1;
      // Residues that exist only in the amino acid alphabet.
      if (!IS_NUCLEOTIDE[code]) proteinOnly += 1;
    }

    if (code === 84 || code === 116) tCount += 1;
    if (code === 85 || code === 117) uCount += 1;
  }

  if (total === 0) {
    return { type: 'unknown', confidence: 0, reason: 'No residues were available to sample.' };
  }

  const nucleotideFraction = (nucleotideLike + ambiguousNucleotide) / total;
  const aminoFraction = aminoLike / total;
  const proteinOnlyFraction = proteinOnly / total;

  // A strong presence of protein-only residues outweighs nucleotide-like
  // composition: real DNA does not contain E, F, I, L, P, Q, or Z.
  if (proteinOnlyFraction > 0.05 && aminoFraction >= 0.85) {
    return {
      type: 'protein',
      confidence: aminoFraction,
      reason: `${(proteinOnlyFraction * 100).toFixed(1)}% of residues occur only in the amino acid alphabet.`,
    };
  }

  if (nucleotideFraction >= 0.85) {
    const isRna = uCount > 0 && uCount > tCount;
    return {
      type: isRna ? 'rna' : 'dna',
      confidence: nucleotideFraction,
      reason: isRna
        ? `${(nucleotideFraction * 100).toFixed(1)}% nucleotide characters with U present and no dominant T.`
        : `${(nucleotideFraction * 100).toFixed(1)}% of residues are nucleotide characters.`,
    };
  }

  if (aminoFraction >= 0.85) {
    return {
      type: 'protein',
      confidence: aminoFraction,
      reason: `${(aminoFraction * 100).toFixed(1)}% of residues are valid amino acid codes.`,
    };
  }

  return {
    type: 'unknown',
    confidence: Math.max(nucleotideFraction, aminoFraction),
    reason:
      'Residues match neither the nucleotide nor the amino acid alphabet closely enough to call. The file may not be a sequence file.',
  };
}

/**
 * Detects the Phred offset of a FASTQ quality sample.
 *
 * Phred+33 spans ASCII 33-74 and Phred+64 spans 64-105. Characters below 59
 * are unique to Phred+33; characters above 74 are unique to Phred+64. Files
 * whose sample falls entirely in the shared 64-74 band are reported as
 * Phred+33, which is correct for every instrument shipped since 2011.
 */
export function detectQualityEncoding(sample: string): {
  encoding: 'phred33' | 'phred64';
  confident: boolean;
} {
  let min = 255;
  let max = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code < min) min = code;
    if (code > max) max = code;
  }
  if (min === 255) return { encoding: 'phred33', confident: false };
  if (min < 59) return { encoding: 'phred33', confident: true };
  if (max > 74) return { encoding: 'phred64', confident: true };
  return { encoding: 'phred33', confident: false };
}
