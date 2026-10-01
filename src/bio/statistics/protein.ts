import {
  AROMATIC_RESIDUES,
  EXTINCTION_280,
  HYDROPATHY_TABLE,
  MASS_TABLE,
  NEGATIVE_RESIDUES,
  PKA,
  POSITIVE_RESIDUES,
  WATER_MASS,
} from '../alphabets';
import type { ProteinProperties } from '@/types';

/** Residue tallies needed by every downstream protein calculation. */
export interface ResidueTally {
  counts: Float64Array;
  /** Residues with a defined mass and hydropathy value. */
  standard: number;
  /** All non-gap residues. */
  total: number;
}

export function tallyResidues(residues: string, into?: ResidueTally): ResidueTally {
  const tally = into ?? { counts: new Float64Array(128), standard: 0, total: 0 };
  for (let i = 0; i < residues.length; i += 1) {
    const code = residues.charCodeAt(i);
    if (code > 127) continue;
    if (code === 45 || code === 46) continue; // gaps
    tally.counts[code] += 1;
    tally.total += 1;
    if (!Number.isNaN(MASS_TABLE[code])) tally.standard += 1;
  }
  return tally;
}

/**
 * Net charge of a polypeptide at a given pH, from the Henderson-Hasselbalch
 * equation applied to the two termini and the seven ionisable side chains.
 *
 * Acidic groups (C-terminus, D, E, C, Y) contribute a negative fraction that
 * rises with pH; basic groups (N-terminus, H, K, R) contribute a positive
 * fraction that falls with pH.
 */
export function netCharge(counts: Float64Array, pH: number, chains = 1): number {
  let charge = 0;

  // Termini: one pair per polypeptide chain.
  charge += chains * (1 / (1 + 10 ** (pH - PKA.nTerminus)));
  charge -= chains * (1 / (1 + 10 ** (PKA.cTerminus - pH)));

  for (const [residue, pKa] of Object.entries(PKA.basic)) {
    const n = counts[residue.charCodeAt(0)];
    if (n > 0) charge += n * (1 / (1 + 10 ** (pH - pKa)));
  }
  for (const [residue, pKa] of Object.entries(PKA.acidic)) {
    const n = counts[residue.charCodeAt(0)];
    if (n > 0) charge -= n * (1 / (1 + 10 ** (pKa - pH)));
  }

  return charge;
}

/**
 * Isoelectric point by bisection on the net-charge curve.
 *
 * Net charge is monotonically decreasing in pH, so bisection over pH 0-14
 * converges without any risk of a local minimum. Fifty iterations put the
 * answer well inside the 0.01 pH unit that is worth reporting.
 */
export function isoelectricPoint(counts: Float64Array, chains = 1): number {
  let low = 0;
  let high = 14;
  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2;
    if (netCharge(counts, mid, chains) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Molecular weight in daltons: residue masses plus one water. */
export function molecularWeight(counts: Float64Array, chains = 1): number {
  let mass = 0;
  let standard = 0;
  for (let code = 0; code < 128; code += 1) {
    const n = counts[code];
    if (n === 0) continue;
    const residueMass = MASS_TABLE[code];
    if (Number.isNaN(residueMass)) continue;
    mass += n * residueMass;
    standard += n;
  }
  return standard === 0 ? 0 : mass + WATER_MASS * chains;
}

/** GRAVY: mean Kyte-Doolittle hydropathy over residues with a defined value. */
export function gravy(counts: Float64Array): number {
  let sum = 0;
  let n = 0;
  for (let code = 0; code < 128; code += 1) {
    const count = counts[code];
    if (count === 0) continue;
    const value = HYDROPATHY_TABLE[code];
    if (Number.isNaN(value)) continue;
    sum += count * value;
    n += count;
  }
  return n === 0 ? 0 : sum / n;
}

/** Extinction coefficient at 280 nm (Pace et al. 1995), cysteines reduced. */
export function extinctionCoefficient(counts: Float64Array): number {
  let total = 0;
  for (const [residue, value] of Object.entries(EXTINCTION_280)) {
    total += counts[residue.charCodeAt(0)] * value;
  }
  return total;
}

const countOf = (counts: Float64Array, residues: string): number => {
  let total = 0;
  for (const residue of residues) total += counts[residue.charCodeAt(0)];
  return total;
};

/** Every protein property SeqLens reports, from a residue tally. */
export function proteinPropertiesFromTally(tally: ResidueTally, chains = 1): ProteinProperties {
  const { counts } = tally;
  let hydrophobic = 0;
  let hydropathyDenominator = 0;
  for (let code = 0; code < 128; code += 1) {
    const count = counts[code];
    if (count === 0) continue;
    const value = HYDROPATHY_TABLE[code];
    if (Number.isNaN(value)) continue;
    hydropathyDenominator += count;
    if (value > 0) hydrophobic += count;
  }

  return {
    gravy: gravy(counts),
    molecularWeight: molecularWeight(counts, chains),
    isoelectricPoint: tally.standard === 0 ? 0 : isoelectricPoint(counts, chains),
    netChargeAtPh7: tally.standard === 0 ? 0 : netCharge(counts, 7, chains),
    positiveResidues: countOf(counts, POSITIVE_RESIDUES),
    negativeResidues: countOf(counts, NEGATIVE_RESIDUES),
    aromaticResidues: countOf(counts, AROMATIC_RESIDUES),
    hydrophobicFraction: hydropathyDenominator === 0 ? 0 : hydrophobic / hydropathyDenominator,
    extinctionCoefficient: extinctionCoefficient(counts),
  };
}

/** Convenience wrapper for a single sequence. */
export function proteinProperties(residues: string): ProteinProperties {
  return proteinPropertiesFromTally(tallyResidues(residues));
}

/**
 * Per-position hydropathy smoothed over a sliding window.
 * A window of 19 is the classic Kyte-Doolittle setting for spotting
 * membrane-spanning segments; 7-9 highlights shorter hydrophobic patches.
 */
export function hydropathyProfile(residues: string, window = 9): number[] {
  const n = residues.length;
  if (n === 0) return [];
  const values = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const value = HYDROPATHY_TABLE[residues.charCodeAt(i)];
    values[i] = Number.isNaN(value) ? 0 : value;
  }
  const half = Math.floor(window / 2);
  const profile: number[] = new Array(n);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(n, half + 1); i += 1) {
    sum += values[i];
    count += 1;
  }
  for (let i = 0; i < n; i += 1) {
    profile[i] = count === 0 ? 0 : sum / count;
    const drop = i - half;
    const add = i + half + 1;
    if (drop >= 0) {
      sum -= values[drop];
      count -= 1;
    }
    if (add < n) {
      sum += values[add];
      count += 1;
    }
  }
  return profile;
}

/** Per-position charge (+1 for K/R, -1 for D/E, +0.1 for H at pH 7). */
export function chargeProfile(residues: string, window = 9): number[] {
  const n = residues.length;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    switch (residues[i]) {
      case 'K':
      case 'R':
        values[i] = 1;
        break;
      case 'H':
        values[i] = 0.1;
        break;
      case 'D':
      case 'E':
        values[i] = -1;
        break;
      default:
        values[i] = 0;
    }
  }
  const half = Math.floor(window / 2);
  const profile: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j += 1) {
      sum += values[j];
      count += 1;
    }
    profile[i] = count === 0 ? 0 : sum / count;
  }
  return profile;
}
