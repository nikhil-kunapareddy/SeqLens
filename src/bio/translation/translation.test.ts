import { describe, expect, it } from 'vitest';
import {
  GENETIC_CODES,
  codonCode,
  codonFromCode,
  getGeneticCode,
} from './geneticCode';
import { findOrfs, longestOrf, sixFrameTranslation, translate } from './translate';
import { reverseComplement } from '../statistics/composition';
import { DEFAULT_CONFIG } from '../defaults';
import type { OrfConfig } from '@/types';

const orfConfig = (overrides: Partial<OrfConfig> = {}): OrfConfig => ({
  ...DEFAULT_CONFIG.orf,
  ...overrides,
});

describe('genetic code tables', () => {
  it('ships every table with exactly 64 codons', () => {
    for (const table of GENETIC_CODES) {
      expect(table.aminoAcids, table.name).toHaveLength(64);
      expect(table.starts, table.name).toHaveLength(64);
    }
  });

  it('round-trips codon codes', () => {
    for (const codon of ['ATG', 'TAA', 'GGG', 'ACT', 'TTT']) {
      expect(codonFromCode(codonCode(codon))).toBe(codon);
    }
  });

  it('returns -1 for an ambiguous codon', () => {
    expect(codonCode('ATN')).toBe(-1);
    expect(codonCode('N--')).toBe(-1);
  });

  it('assigns the standard code correctly', () => {
    const code = getGeneticCode(1);
    const aaFor = (codon: string) => String.fromCharCode(code.aminoAcids[codonCode(codon)]);
    expect(aaFor('ATG')).toBe('M');
    expect(aaFor('TGG')).toBe('W');
    expect(aaFor('TTT')).toBe('F');
    expect(aaFor('GGG')).toBe('G');
    expect(aaFor('TAA')).toBe('*');
    expect(aaFor('TAG')).toBe('*');
    expect(aaFor('TGA')).toBe('*');
  });

  it('lists the three standard stop codons', () => {
    expect(getGeneticCode(1).stopCodons.sort()).toEqual(['TAA', 'TAG', 'TGA']);
  });

  it('lists the standard alternative start codons', () => {
    expect(getGeneticCode(1).startCodons.sort()).toEqual(['ATG', 'CTG', 'TTG']);
  });

  it('applies mitochondrial reassignments in table 2', () => {
    const code = getGeneticCode(2);
    const aaFor = (codon: string) => String.fromCharCode(code.aminoAcids[codonCode(codon)]);
    // TGA is tryptophan, not a stop, in vertebrate mitochondria.
    expect(aaFor('TGA')).toBe('W');
    // AGA and AGG become stops.
    expect(aaFor('AGA')).toBe('*');
    expect(aaFor('AGG')).toBe('*');
    // ATA becomes methionine.
    expect(aaFor('ATA')).toBe('M');
  });

  it('reassigns AGA and AGG to serine in table 5', () => {
    const code = getGeneticCode(5);
    expect(String.fromCharCode(code.aminoAcids[codonCode('AGA')])).toBe('S');
    expect(String.fromCharCode(code.aminoAcids[codonCode('AGG')])).toBe('S');
  });

  it('keeps table 11 amino acids identical to the standard code', () => {
    const standard = getGeneticCode(1);
    const bacterial = getGeneticCode(11);
    expect([...bacterial.aminoAcids]).toEqual([...standard.aminoAcids]);
    // ...but with more permitted start codons.
    expect(bacterial.startCodons.length).toBeGreaterThan(standard.startCodons.length);
  });

  it('falls back to the standard code for an unknown table id', () => {
    expect(getGeneticCode(999).id).toBe(1);
  });
});

describe('translate', () => {
  it('translates a simple coding sequence', () => {
    expect(translate('ATGGCCATTGTAATG')).toBe('MAIVM');
  });

  it('emits * for stop codons', () => {
    expect(translate('ATGTAA')).toBe('M*');
    expect(translate('TAATAGTGA')).toBe('***');
  });

  it('stops at the first stop codon when asked', () => {
    expect(translate('ATGGCCTAAATGGCC', { stopAtFirstStop: true })).toBe('MA');
  });

  it('ignores trailing bases that do not complete a codon', () => {
    expect(translate('ATGGC')).toBe('M');
    expect(translate('ATGG')).toBe('M');
  });

  it('emits X for a codon with an ambiguous base', () => {
    expect(translate('ATGNNNGCC')).toBe('MXA');
    expect(translate('ATGANTGCC')).toBe('MXA');
  });

  it('honours the frame offset', () => {
    expect(translate('GATGGCCATT', { offset: 1 })).toBe('MAI');
  });

  it('accepts RNA input', () => {
    expect(translate('AUGGCCAUU')).toBe('MAI');
  });

  it('is case-insensitive', () => {
    expect(translate('atggccatt')).toBe('MAI');
  });

  it('returns an empty string for input shorter than one codon', () => {
    expect(translate('AT')).toBe('');
    expect(translate('')).toBe('');
  });

  it('uses the requested genetic code', () => {
    expect(translate('TGA', { geneticCode: 1 })).toBe('*');
    expect(translate('TGA', { geneticCode: 2 })).toBe('W');
  });
});

describe('sixFrameTranslation', () => {
  const sequence = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG';

  it('returns exactly six frames', () => {
    const frames = sixFrameTranslation(sequence);
    expect(frames).toHaveLength(6);
    expect(frames.map((f) => `${f.strand}${f.frame}`)).toEqual([
      '+1',
      '+2',
      '+3',
      '-1',
      '-2',
      '-3',
    ]);
  });

  it('translates forward frame 1 from offset 0', () => {
    const frames = sixFrameTranslation(sequence);
    expect(frames[0].protein).toBe(translate(sequence, { offset: 0 }));
    expect(frames[1].protein).toBe(translate(sequence, { offset: 1 }));
    expect(frames[2].protein).toBe(translate(sequence, { offset: 2 }));
  });

  it('translates reverse frames from the reverse complement', () => {
    const frames = sixFrameTranslation(sequence);
    const reverse = reverseComplement(sequence);
    expect(frames[3].protein).toBe(translate(reverse, { offset: 0 }));
    expect(frames[4].protein).toBe(translate(reverse, { offset: 1 }));
    expect(frames[5].protein).toBe(translate(reverse, { offset: 2 }));
  });

  it('counts stop codons per frame', () => {
    const frames = sixFrameTranslation('TAATAATAA');
    expect(frames[0].stopCount).toBe(3);
    expect(frames[0].longestStretch).toBe(0);
  });

  it('reports the longest stop-free stretch', () => {
    // Nine codons of alanine, then a stop, then two more alanines.
    const frames = sixFrameTranslation(`${'GCC'.repeat(9)}TAA${'GCC'.repeat(2)}`);
    expect(frames[0].longestStretch).toBe(9);
  });

  it('handles frames with no stop codons', () => {
    const frames = sixFrameTranslation('GCC'.repeat(10));
    expect(frames[0].stopCount).toBe(0);
    expect(frames[0].longestStretch).toBe(10);
  });
});

describe('findOrfs', () => {
  /** ATG + 60 alanine codons + TAA = a 61-codon ORF with a clean stop. */
  const coding = `ATG${'GCC'.repeat(60)}TAA`;

  it('finds a forward ORF with correct coordinates', () => {
    const orfs = findOrfs(coding, 0, 'seq1', orfConfig({ minAminoAcids: 10, searchReverseStrand: false }));
    expect(orfs.length).toBeGreaterThanOrEqual(1);
    const orf = orfs[0];
    expect(orf.strand).toBe('+');
    expect(orf.frame).toBe(1);
    expect(orf.start).toBe(1);
    expect(orf.end).toBe(coding.length); // includes the stop codon
    expect(orf.startCodon).toBe('ATG');
    expect(orf.stopCodon).toBe('TAA');
    expect(orf.partial).toBe(false);
    expect(orf.aminoAcidLength).toBe(61);
    expect(orf.nucleotideLength).toBe(186);
    expect(orf.protein).toBe(`M${'A'.repeat(60)}`);
    expect(orf.protein).toHaveLength(orf.aminoAcidLength);
  });

  it('finds the same ORF on the reverse strand when the sequence is flipped', () => {
    const flipped = reverseComplement(coding);
    const orfs = findOrfs(flipped, 0, 'seq1', orfConfig({ minAminoAcids: 10 }));
    const reverseOrf = orfs.find((orf) => orf.strand === '-');
    expect(reverseOrf).toBeDefined();
    expect(reverseOrf?.aminoAcidLength).toBe(61);
    expect(reverseOrf?.protein).toBe(`M${'A'.repeat(60)}`);
    // Coordinates are expressed on the forward strand of the input.
    expect(reverseOrf?.start).toBe(1);
    expect(reverseOrf?.end).toBe(flipped.length);
  });

  it('reports reverse-strand coordinates that map back to the right residues', () => {
    // Put the coding sequence's reverse complement in the middle of a padded
    // sequence so the coordinates have to be non-trivial.
    const padded = `TTTTTTTTTT${reverseComplement(coding)}CCCCCCCCCC`;
    const orfs = findOrfs(padded, 0, 'seq1', orfConfig({ minAminoAcids: 50 }));
    const orf = orfs.find((o) => o.strand === '-' && o.aminoAcidLength === 61);
    expect(orf).toBeDefined();
    // Extract the span the ORF claims and verify it re-translates identically.
    const span = padded.slice(orf!.start - 1, orf!.end);
    expect(reverseComplement(span).slice(0, 3)).toBe('ATG');
    expect(translate(reverseComplement(span), { stopAtFirstStop: true })).toBe(orf!.protein);
  });

  it('respects the minimum length', () => {
    const orfs = findOrfs(coding, 0, 'seq1', orfConfig({ minAminoAcids: 200 }));
    expect(orfs).toEqual([]);
  });

  it('finds no ORF without a start codon when one is required', () => {
    const noStart = `GCC${'GCC'.repeat(60)}TAA`;
    expect(findOrfs(noStart, 0, 's', orfConfig({ minAminoAcids: 10 }))).toEqual([]);
  });

  it('finds stop-to-stop ORFs when no start codon is required', () => {
    const noStart = `${'GCC'.repeat(60)}TAA`;
    const orfs = findOrfs(
      noStart,
      0,
      's',
      orfConfig({ minAminoAcids: 10, requireStartCodon: false, searchReverseStrand: false }),
    );
    const frame1 = orfs.find((orf) => orf.frame === 1 && orf.strand === '+');
    expect(frame1?.aminoAcidLength).toBe(60);
    expect(frame1?.stopCodon).toBe('TAA');
  });

  it('skips the reverse strand when configured to', () => {
    const orfs = findOrfs(coding, 0, 's', orfConfig({ minAminoAcids: 10, searchReverseStrand: false }));
    expect(orfs.every((orf) => orf.strand === '+')).toBe(true);
  });

  it('excludes partial ORFs by default and includes them on request', () => {
    // A start codon with no in-frame stop before the sequence ends.
    const noStop = `ATG${'GCC'.repeat(60)}`;
    expect(
      findOrfs(noStop, 0, 's', orfConfig({ minAminoAcids: 10, searchReverseStrand: false })),
    ).toEqual([]);

    const partial = findOrfs(
      noStop,
      0,
      's',
      orfConfig({ minAminoAcids: 10, allowPartialOrfs: true, searchReverseStrand: false }),
    );
    expect(partial).toHaveLength(1);
    expect(partial[0].partial).toBe(true);
    expect(partial[0].stopCodon).toBeNull();
    expect(partial[0].aminoAcidLength).toBe(61);
  });

  it('reports only the longest ORF per stop codon', () => {
    // Two in-frame ATGs sharing one stop: only the first should be reported.
    const nested = `ATG${'GCC'.repeat(20)}ATG${'GCC'.repeat(20)}TAA`;
    const orfs = findOrfs(
      nested,
      0,
      's',
      orfConfig({ minAminoAcids: 10, searchReverseStrand: false }),
    );
    const frame1 = orfs.filter((orf) => orf.frame === 1 && orf.strand === '+');
    expect(frame1).toHaveLength(1);
    expect(frame1[0].start).toBe(1);
  });

  it('starts a new ORF after a stop codon', () => {
    const two = `ATG${'GCC'.repeat(20)}TAAATG${'GCC'.repeat(20)}TAA`;
    const orfs = findOrfs(
      two,
      0,
      's',
      orfConfig({ minAminoAcids: 10, searchReverseStrand: false }),
    ).filter((orf) => orf.frame === 1 && orf.strand === '+');
    expect(orfs).toHaveLength(2);
  });

  it('breaks an ORF at an ambiguous codon', () => {
    const withN = `ATG${'GCC'.repeat(20)}NNN${'GCC'.repeat(20)}TAA`;
    const orfs = findOrfs(
      withN,
      0,
      's',
      orfConfig({ minAminoAcids: 10, searchReverseStrand: false }),
    ).filter((orf) => orf.frame === 1 && orf.strand === '+');
    // The ORF through the N is discarded; nothing else in frame 1 qualifies.
    expect(orfs).toEqual([]);
  });

  it('never reports a protein containing a stop codon', () => {
    const orfs = findOrfs(
      `ATG${'GCC'.repeat(30)}TAAATG${'GGG'.repeat(30)}TGA`,
      0,
      's',
      orfConfig({ minAminoAcids: 5 }),
    );
    for (const orf of orfs) {
      expect(orf.protein).not.toContain('*');
      expect(orf.protein).toHaveLength(orf.aminoAcidLength);
    }
  });

  it('keeps every ORF within the sequence bounds', () => {
    const orfs = findOrfs(coding, 0, 's', orfConfig({ minAminoAcids: 5 }));
    for (const orf of orfs) {
      expect(orf.start).toBeGreaterThanOrEqual(1);
      expect(orf.end).toBeLessThanOrEqual(coding.length);
      expect(orf.end).toBeGreaterThan(orf.start);
    }
  });

  it('returns nothing for sequences shorter than a codon', () => {
    expect(findOrfs('AT', 0, 's', orfConfig())).toEqual([]);
    expect(findOrfs('', 0, 's', orfConfig())).toEqual([]);
  });

  it('sorts results longest first', () => {
    const orfs = findOrfs(
      `ATG${'GCC'.repeat(40)}TAAATG${'GCC'.repeat(15)}TAA`,
      0,
      's',
      orfConfig({ minAminoAcids: 5 }),
    );
    for (let i = 1; i < orfs.length; i += 1) {
      expect(orfs[i - 1].aminoAcidLength).toBeGreaterThanOrEqual(orfs[i].aminoAcidLength);
    }
  });

  it('finds the longest ORF', () => {
    const orfs = findOrfs(coding, 0, 's', orfConfig({ minAminoAcids: 5 }));
    expect(longestOrf(orfs)?.aminoAcidLength).toBe(61);
    expect(longestOrf([])).toBeNull();
  });

  it('uses alternative start codons from the selected table', () => {
    const gtgStart = `GTG${'GCC'.repeat(60)}TAA`;
    // The standard code does not treat GTG as a start...
    expect(
      findOrfs(gtgStart, 0, 's', orfConfig({ minAminoAcids: 10, searchReverseStrand: false, geneticCode: 1 })),
    ).toEqual([]);
    // ...but the bacterial code does.
    const bacterial = findOrfs(
      gtgStart,
      0,
      's',
      orfConfig({ minAminoAcids: 10, searchReverseStrand: false, geneticCode: 11 }),
    );
    expect(bacterial).toHaveLength(1);
    // The initiator is translated literally rather than rewritten to M.
    expect(bacterial[0].protein[0]).toBe('V');
    expect(bacterial[0].startCodon).toBe('GTG');
  });
});
