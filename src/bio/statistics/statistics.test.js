import { describe, expect, it } from 'vitest';
import { buildLengthHistogram, computeLengthStats, percentile, topLengths, } from './lengths';
import { entropyFromCounts, findHomopolymers, findLowComplexityRegions, linguisticComplexity, longestHomopolymer, sequenceEntropy, } from './entropy';
import { PositionalComposition, ResidueCounter, complement, countAmbiguous, countGc, cpgStatistics, gcContent, reverseComplement, strandSkew, transcribe, } from './composition';
import { gravy, isoelectricPoint, molecularWeight, netCharge, proteinProperties, tallyResidues, } from './protein';
import { confirmDuplicates, findDuplicateCandidates, uniquePercent } from './duplicates';
import { hash64 } from '../parsers/hash';
describe('computeLengthStats', () => {
    it('returns zeros for an empty dataset', () => {
        const stats = computeLengthStats([]);
        expect(stats).toMatchObject({ count: 0, total: 0, n50: 0, n90: 0, mean: 0 });
    });
    it('computes basic statistics', () => {
        const stats = computeLengthStats([10, 20, 30, 40]);
        expect(stats.count).toBe(4);
        expect(stats.total).toBe(100);
        expect(stats.min).toBe(10);
        expect(stats.max).toBe(40);
        expect(stats.mean).toBe(25);
        expect(stats.median).toBe(25);
    });
    it('computes the median for an odd count', () => {
        expect(computeLengthStats([1, 5, 9]).median).toBe(5);
    });
    it('computes N50 by the standard cumulative definition', () => {
        // Sorted descending: 100, 80, 60, 40, 20. Total 300, half 150.
        // 100 -> 100 (< 150); +80 -> 180 (>= 150), so N50 = 80 and L50 = 2.
        const stats = computeLengthStats([20, 40, 60, 80, 100]);
        expect(stats.n50).toBe(80);
        expect(stats.l50).toBe(2);
    });
    it('computes N90', () => {
        // Cumulative from largest: 100, 180, 240, 280, 300. 90% of 300 is 270.
        // The sequence crossing 270 is the 40, so N90 = 40.
        const stats = computeLengthStats([20, 40, 60, 80, 100]);
        expect(stats.n90).toBe(40);
        expect(stats.l90).toBe(4);
    });
    it('reports N50 equal to the single length for a uniform dataset', () => {
        const stats = computeLengthStats(new Array(1000).fill(150));
        expect(stats.n50).toBe(150);
        expect(stats.n90).toBe(150);
        expect(stats.mean).toBe(150);
    });
    it('handles a single sequence', () => {
        const stats = computeLengthStats([500]);
        expect(stats.n50).toBe(500);
        expect(stats.n90).toBe(500);
        expect(stats.l50).toBe(1);
    });
    it('does not modify the input array', () => {
        const lengths = Uint32Array.from([30, 10, 20]);
        computeLengthStats(lengths);
        expect([...lengths]).toEqual([30, 10, 20]);
    });
    it('satisfies N50 >= N90 for random datasets', () => {
        for (let trial = 0; trial < 20; trial += 1) {
            const lengths = Array.from({ length: 50 }, () => 1 + Math.floor(Math.random() * 10000));
            const stats = computeLengthStats(lengths);
            expect(stats.n50).toBeGreaterThanOrEqual(stats.n90);
            expect(stats.l50).toBeLessThanOrEqual(stats.l90);
            expect(stats.min).toBeLessThanOrEqual(stats.n90);
            expect(stats.n50).toBeLessThanOrEqual(stats.max);
        }
    });
});
describe('buildLengthHistogram', () => {
    it('uses one bin per distinct length for a narrow range', () => {
        const { bins, scale } = buildLengthHistogram([10, 10, 11, 12, 12, 12]);
        expect(scale).toBe('exact');
        expect(bins).toEqual([
            { from: 10, to: 11, count: 2 },
            { from: 11, to: 12, count: 1 },
            { from: 12, to: 13, count: 3 },
        ]);
    });
    it('uses log bins when the dynamic range is wide', () => {
        const lengths = [10, 100, 1000, 10000, 100000];
        const { scale, bins } = buildLengthHistogram(lengths, 20);
        expect(scale).toBe('log');
        const total = bins.reduce((sum, bin) => sum + bin.count, 0);
        expect(total).toBe(lengths.length);
    });
    it('places every sequence in exactly one bin', () => {
        const lengths = Array.from({ length: 500 }, (_, i) => 100 + i * 3);
        const { bins } = buildLengthHistogram(lengths, 40);
        expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(500);
    });
    it('returns no bins for an empty dataset', () => {
        expect(buildLengthHistogram([]).bins).toEqual([]);
    });
});
describe('topLengths and percentile', () => {
    it('ranks the most frequent lengths', () => {
        const result = topLengths([100, 100, 100, 200, 200, 300], 2);
        expect(result).toEqual([
            { length: 100, count: 3 },
            { length: 200, count: 2 },
        ]);
    });
    it('interpolates percentiles', () => {
        expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
        expect(percentile([1, 2, 3, 4], 0)).toBe(1);
        expect(percentile([1, 2, 3, 4], 100)).toBe(4);
        expect(percentile([], 50)).toBe(0);
    });
});
describe('GC content', () => {
    it('computes GC percentage', () => {
        expect(gcContent('GGCC').percent).toBe(100);
        expect(gcContent('AATT').percent).toBe(0);
        expect(gcContent('ACGT').percent).toBe(50);
    });
    it('excludes ambiguous bases from the denominator', () => {
        // 2 GC, 2 AT, 4 N: GC% is over the 4 unambiguous bases only.
        const result = gcContent('GCATNNNN');
        expect(result.unambiguous).toBe(4);
        expect(result.percent).toBe(50);
    });
    it('returns 0 when there are no unambiguous bases', () => {
        expect(gcContent('NNNN').percent).toBe(0);
        expect(gcContent('').percent).toBe(0);
    });
    it('treats U as an AT-class base for RNA', () => {
        expect(gcContent('ACGU').percent).toBe(50);
    });
    it('is case-insensitive', () => {
        expect(gcContent('acgt').percent).toBe(50);
        expect(gcContent('GgCc').percent).toBe(100);
    });
    it('honours an explicit range', () => {
        expect(gcContent('AAAAGGGG', 4, 8).percent).toBe(100);
    });
    it('agrees with countGc over unambiguous input', () => {
        const residues = 'ACGTACGTGGCCATAT';
        expect(countGc(residues)).toBe(gcContent(residues).gc);
    });
});
describe('composition metrics', () => {
    it('computes strand skew', () => {
        expect(strandSkew({ a: 10, c: 10, g: 30, t: 10 })).toEqual({ gcSkew: 0.5, atSkew: 0 });
        expect(strandSkew({ a: 0, c: 0, g: 0, t: 0 })).toEqual({ gcSkew: 0, atSkew: 0 });
    });
    it('counts CpG dinucleotides', () => {
        // CGCGCG has CG at positions 1, 3, 5.
        expect(cpgStatistics('CGCGCG').count).toBe(3);
        // No CpG when G never follows C.
        expect(cpgStatistics('GCGCGC').count).toBe(2);
        expect(cpgStatistics('AAAA').count).toBe(0);
    });
    it('computes the CpG observed/expected ratio', () => {
        // 'CG' repeated: C count 5, G count 5, length 10, expected = 2.5, observed 5.
        const result = cpgStatistics('CGCGCGCGCG');
        expect(result.count).toBe(5);
        expect(result.observedExpected).toBeCloseTo(2, 6);
    });
    it('counts ambiguous residues for nucleotides', () => {
        expect(countAmbiguous('ACGTN', 'dna')).toBe(1);
        expect(countAmbiguous('ACGTRYSWKM', 'dna')).toBe(6);
        expect(countAmbiguous('ACGT', 'dna')).toBe(0);
        expect(countAmbiguous('AC-GT', 'dna')).toBe(0); // gaps are not ambiguity
    });
    it('counts ambiguous residues for proteins', () => {
        expect(countAmbiguous('ACDEFX', 'protein')).toBe(1);
        expect(countAmbiguous('BZJX', 'protein')).toBe(4);
    });
    it('accumulates residue counts', () => {
        const counter = new ResidueCounter();
        counter.add('AACCGGTT');
        counter.add('AA');
        expect(counter.total).toBe(10);
        expect(counter.get('A')).toBe(4);
        expect(counter.get('C')).toBe(2);
        expect(counter.toRecord()).toEqual({ A: 4, C: 2, G: 2, T: 2 });
    });
    it('builds positional composition percentages', () => {
        const positional = new PositionalComposition(4);
        positional.add('AAAA');
        positional.add('ACGT');
        const rows = positional.toRows();
        expect(rows).toHaveLength(4);
        expect(rows[0]).toMatchObject({ position: 1, A: 100 });
        expect(rows[1].A).toBe(50);
        expect(rows[1].C).toBe(50);
    });
    it('caps positional composition at the configured width', () => {
        const positional = new PositionalComposition(3);
        positional.add('ACGTACGT');
        expect(positional.toRows()).toHaveLength(3);
    });
});
describe('reverseComplement', () => {
    it('reverse complements DNA', () => {
        expect(reverseComplement('ACGT')).toBe('ACGT');
        expect(reverseComplement('AAAA')).toBe('TTTT');
        expect(reverseComplement('ATGGCC')).toBe('GGCCAT');
    });
    it('is its own inverse', () => {
        const residues = 'ATGGCGCGATCGATTAGCCNNRYKM';
        expect(reverseComplement(reverseComplement(residues))).toBe(residues);
    });
    it('complements ambiguity codes correctly', () => {
        expect(reverseComplement('R')).toBe('Y');
        expect(reverseComplement('Y')).toBe('R');
        expect(reverseComplement('B')).toBe('V');
        expect(reverseComplement('V')).toBe('B');
        expect(reverseComplement('D')).toBe('H');
        expect(reverseComplement('N')).toBe('N');
        expect(reverseComplement('S')).toBe('S');
        expect(reverseComplement('W')).toBe('W');
    });
    it('preserves gaps and length', () => {
        expect(reverseComplement('AC-GT')).toBe('AC-GT');
        expect(reverseComplement('ACGT@#')).toHaveLength(6);
    });
    it('maps unknown characters to N rather than dropping them', () => {
        expect(reverseComplement('AC?GT')).toBe('ACNGT');
    });
    it('uses U for RNA', () => {
        expect(reverseComplement('ACGU', 'rna')).toBe('ACGU');
        expect(reverseComplement('AAAA', 'rna')).toBe('UUUU');
    });
    it('complements without reversing', () => {
        expect(complement('AAAA')).toBe('TTTT');
        expect(complement('ATGC')).toBe('TACG');
    });
    it('handles sequences longer than the decode chunk size', () => {
        const long = 'ACGT'.repeat(20000); // 80,000 bases
        const result = reverseComplement(long);
        expect(result).toHaveLength(80000);
        expect(result.slice(0, 4)).toBe('ACGT');
        expect(reverseComplement(result)).toBe(long);
    });
    it('transcribes DNA to RNA', () => {
        expect(transcribe('ACGT')).toBe('ACGU');
    });
    it('returns an empty string for empty input', () => {
        expect(reverseComplement('')).toBe('');
    });
});
describe('entropy', () => {
    it('is 2 bits for an even DNA distribution', () => {
        expect(sequenceEntropy('ACGT')).toBeCloseTo(2, 10);
        expect(sequenceEntropy('ACGTACGTACGT')).toBeCloseTo(2, 10);
    });
    it('is 0 for a homopolymer', () => {
        expect(sequenceEntropy('AAAAAAAA')).toBe(0);
    });
    it('is 1 bit for two equally frequent symbols', () => {
        expect(sequenceEntropy('ATAT')).toBeCloseTo(1, 10);
    });
    it('ignores order', () => {
        expect(sequenceEntropy('AACCGGTT')).toBeCloseTo(sequenceEntropy('ACGTACGT'), 10);
    });
    it('excludes gap characters', () => {
        expect(sequenceEntropy('A-C-G-T-')).toBeCloseTo(2, 10);
    });
    it('is 0 for an empty sequence', () => {
        expect(sequenceEntropy('')).toBe(0);
    });
    it('computes entropy from counts', () => {
        expect(entropyFromCounts([1, 1, 1, 1])).toBeCloseTo(2, 10);
        expect(entropyFromCounts([1, 0, 0, 0])).toBe(0);
        expect(entropyFromCounts([])).toBe(0);
        expect(entropyFromCounts([0, 0])).toBe(0);
    });
    it('approaches log2(20) for a uniform protein composition', () => {
        const residues = 'ACDEFGHIKLMNPQRSTVWY';
        expect(sequenceEntropy(residues)).toBeCloseTo(Math.log2(20), 10);
    });
});
describe('low-complexity detection', () => {
    it('finds a poly-A region', () => {
        const residues = `ACGTACGTACGTACGTACGT${'A'.repeat(80)}ACGTACGTACGTACGTACGT`;
        const regions = findLowComplexityRegions(residues, 32, 0.5);
        expect(regions.length).toBeGreaterThan(0);
        expect(regions[0].dominantResidue).toBe('A');
        // The poly-A run starts at 1-based position 21.
        expect(regions[0].start).toBeGreaterThanOrEqual(21 - 32);
        expect(regions[0].end).toBeGreaterThanOrEqual(80);
    });
    it('finds nothing in balanced sequence', () => {
        const residues = 'ACGT'.repeat(50);
        expect(findLowComplexityRegions(residues, 32, 0.5)).toEqual([]);
    });
    it('returns nothing when the sequence is shorter than the window', () => {
        expect(findLowComplexityRegions('AAAA', 32)).toEqual([]);
    });
    it('merges adjacent low-complexity windows into one region', () => {
        const residues = 'T'.repeat(200);
        const regions = findLowComplexityRegions(residues, 32, 0.5);
        expect(regions).toHaveLength(1);
        expect(regions[0].start).toBe(1);
        expect(regions[0].end).toBe(200);
    });
});
describe('homopolymers', () => {
    it('finds the longest run', () => {
        // ACG then six T at 1-based positions 4..9, then ACGT.
        expect(longestHomopolymer('ACGTTTTTTACGT')).toEqual({ residue: 'T', start: 4, length: 6 });
    });
    it('handles a run at the end of the sequence', () => {
        expect(longestHomopolymer('ACGTAAAAA')).toEqual({ residue: 'A', start: 5, length: 5 });
    });
    it('handles a run at the start', () => {
        expect(longestHomopolymer('GGGGACGT')).toEqual({ residue: 'G', start: 1, length: 4 });
    });
    it('returns a length-1 run for a sequence with no repeats', () => {
        expect(longestHomopolymer('ACGT')?.length).toBe(1);
    });
    it('returns null for an empty sequence', () => {
        expect(longestHomopolymer('')).toBeNull();
    });
    it('finds all runs at or above a minimum length', () => {
        const runs = findHomopolymers('AAAACGTTTTTTTGC', 4);
        expect(runs).toEqual([
            { residue: 'A', start: 1, length: 4 },
            { residue: 'T', start: 7, length: 7 },
        ]);
    });
    it('finds no runs when none reach the minimum', () => {
        expect(findHomopolymers('ACGTACGT', 3)).toEqual([]);
    });
});
describe('linguisticComplexity', () => {
    it('is low for a tandem repeat and high for varied sequence', () => {
        const repeat = linguisticComplexity('ATATATATATATATATATAT', 3);
        const varied = linguisticComplexity('ATGGCGCGATCGATTAGCCG', 3);
        expect(repeat).toBeLessThan(varied);
    });
    it('is 0 when the sequence is shorter than k', () => {
        expect(linguisticComplexity('AC', 3)).toBe(0);
    });
});
describe('protein properties', () => {
    it('computes molecular weight of a known peptide', () => {
        // Insulin A chain: GIVEQCCTSICSLYQLENYCN, ~2383.7 Da reduced.
        const tally = tallyResidues('GIVEQCCTSICSLYQLENYCN');
        expect(molecularWeight(tally.counts)).toBeCloseTo(2383.7, 0);
    });
    it('computes a positive GRAVY for a hydrophobic peptide', () => {
        expect(gravy(tallyResidues('IIIILLLLVVVV').counts)).toBeGreaterThan(3);
    });
    it('computes a negative GRAVY for a charged peptide', () => {
        expect(gravy(tallyResidues('KKKKRRRRDDDD').counts)).toBeLessThan(-3);
    });
    it('gives an acidic pI to a poly-glutamate peptide', () => {
        const pi = isoelectricPoint(tallyResidues('EEEEEEEEEE').counts);
        expect(pi).toBeGreaterThan(3);
        expect(pi).toBeLessThan(4.5);
    });
    it('gives a basic pI to a poly-lysine peptide', () => {
        const pi = isoelectricPoint(tallyResidues('KKKKKKKKKK').counts);
        expect(pi).toBeGreaterThan(10);
    });
    it('produces a net charge of about zero at the isoelectric point', () => {
        const tally = tallyResidues('MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGEENFKALVLIAFAQ');
        const pi = isoelectricPoint(tally.counts);
        expect(Math.abs(netCharge(tally.counts, pi))).toBeLessThan(0.01);
    });
    it('has net charge decreasing monotonically with pH', () => {
        const tally = tallyResidues('ACDEFGHIKLMNPQRSTVWY');
        let previous = Infinity;
        for (let pH = 0; pH <= 14; pH += 0.5) {
            const charge = netCharge(tally.counts, pH);
            expect(charge).toBeLessThan(previous);
            previous = charge;
        }
    });
    it('counts charged and aromatic residues', () => {
        const properties = proteinProperties('KRHDEFWY');
        expect(properties.positiveResidues).toBe(3);
        expect(properties.negativeResidues).toBe(2);
        expect(properties.aromaticResidues).toBe(3);
    });
    it('computes the extinction coefficient from W, Y, and C', () => {
        // 1 W (5500) + 1 Y (1490) + 1 C (125)
        expect(proteinProperties('WYC').extinctionCoefficient).toBe(7115);
    });
    it('returns zeros for an empty sequence', () => {
        const properties = proteinProperties('');
        expect(properties.molecularWeight).toBe(0);
        expect(properties.isoelectricPoint).toBe(0);
        expect(properties.gravy).toBe(0);
    });
    it('skips residues with no defined mass', () => {
        const withX = tallyResidues('AAAXAAA');
        const without = tallyResidues('AAAAAA');
        expect(molecularWeight(withX.counts)).toBeCloseTo(molecularWeight(without.counts), 6);
    });
});
describe('duplicate detection', () => {
    /** Builds the hash and length arrays the index would hold for a sequence list. */
    const indexFor = (sequences) => {
        const n = sequences.length;
        const hashLow = new Uint32Array(n);
        const hashHigh = new Uint32Array(n);
        const lengths = new Uint32Array(n);
        sequences.forEach((residues, i) => {
            const digest = hash64(residues);
            hashLow[i] = digest.low;
            hashHigh[i] = digest.high;
            lengths[i] = residues.length;
        });
        return { hashLow, hashHigh, lengths };
    };
    const analyze = (sequences) => {
        const { hashLow, hashHigh, lengths } = indexFor(sequences);
        const candidates = findDuplicateCandidates(hashLow, hashHigh, lengths);
        return confirmDuplicates(candidates, hashLow, hashHigh, lengths, (i) => `seq${i}`, (i) => sequences[i]);
    };
    it('finds no duplicates in a unique set', () => {
        const result = analyze(['ACGT', 'TTTT', 'GGGG', 'CCCC']);
        expect(result.duplicateSequences).toBe(0);
        expect(result.duplicateGroups).toBe(0);
        expect(result.groups).toEqual([]);
    });
    it('finds an exact duplicate pair', () => {
        const result = analyze(['ACGTACGT', 'TTTTTTTT', 'ACGTACGT']);
        expect(result.duplicateGroups).toBe(1);
        expect(result.duplicateSequences).toBe(1);
        expect(result.groups[0].count).toBe(2);
        expect(result.groups[0].ids).toEqual(['seq0', 'seq2']);
        expect(result.groups[0].representativeIndex).toBe(0);
        expect([...result.redundantIndices]).toEqual([2]);
    });
    it('counts copies beyond the first as redundant', () => {
        const result = analyze(['AAAA', 'AAAA', 'AAAA', 'AAAA']);
        expect(result.duplicateGroups).toBe(1);
        expect(result.duplicateSequences).toBe(3);
        expect(result.groups[0].count).toBe(4);
    });
    it('handles several independent duplicate groups', () => {
        const result = analyze(['AAAA', 'CCCC', 'AAAA', 'CCCC', 'GGGG']);
        expect(result.duplicateGroups).toBe(2);
        expect(result.duplicateSequences).toBe(2);
    });
    it('excludes empty sequences from duplicate grouping', () => {
        const result = analyze(['', '', '', 'ACGT']);
        expect(result.duplicateGroups).toBe(0);
    });
    it('builds a copy-count histogram', () => {
        const result = analyze(['A', 'A', 'B', 'B', 'B', 'C']);
        expect(result.histogram).toEqual([
            { copies: 2, groups: 1, sequences: 2 },
            { copies: 3, groups: 1, sequences: 3 },
        ]);
    });
    it('sorts groups by copy count descending', () => {
        const result = analyze(['A', 'A', 'B', 'B', 'B', 'B']);
        expect(result.groups[0].count).toBe(4);
        expect(result.groups[1].count).toBe(2);
    });
    it('separates sequences that share a hash but differ in residues', () => {
        // Force a collision by supplying identical hashes for different residues.
        const sequences = ['ACGTACGT', 'TTTTTTTT'];
        const hashLow = Uint32Array.from([7, 7]);
        const hashHigh = Uint32Array.from([9, 9]);
        const lengths = Uint32Array.from([8, 8]);
        const candidates = findDuplicateCandidates(hashLow, hashHigh, lengths);
        expect(candidates.runs).toHaveLength(1);
        const result = confirmDuplicates(candidates, hashLow, hashHigh, lengths, (i) => `seq${i}`, (i) => sequences[i]);
        expect(result.duplicateGroups).toBe(0);
        expect(result.hashCollisions).toBe(1);
    });
    it('computes unique percentage', () => {
        expect(uniquePercent(100, 25)).toBe(75);
        expect(uniquePercent(0, 0)).toBe(0);
    });
});
