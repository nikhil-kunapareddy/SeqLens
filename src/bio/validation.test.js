import { describe, expect, it } from 'vitest';
import { detectQualityEncoding, detectSequenceType, isValidNucleotideSequence, isValidProteinSequence, validateResidues, } from './validation';
import { detectFormatFromContent, fileExtensions, isGzipMagic } from './parsers/detect';
describe('validateResidues', () => {
    it('accepts clean DNA', () => {
        const report = validateResidues('ACGTACGT', 'dna');
        expect(report.valid).toBe(true);
        expect(report.invalidCount).toBe(0);
        expect(report.ambiguousCount).toBe(0);
        expect(report.firstInvalidAt).toBe(-1);
    });
    it('accepts every IUPAC nucleotide code', () => {
        expect(validateResidues('ACGTURYSWKMBDHVN', 'dna').valid).toBe(true);
    });
    it('counts ambiguous nucleotides without invalidating the sequence', () => {
        const report = validateResidues('ACGTNNRY', 'dna');
        expect(report.valid).toBe(true);
        expect(report.ambiguousCount).toBe(4);
    });
    it('rejects amino-acid-only letters in DNA', () => {
        const report = validateResidues('ACGTEFIL', 'dna');
        expect(report.valid).toBe(false);
        expect(report.invalidCount).toBe(4);
        expect(report.invalidCharacters.sort()).toEqual(['E', 'F', 'I', 'L']);
        expect(report.firstInvalidAt).toBe(4);
    });
    it('accepts standard amino acids', () => {
        expect(validateResidues('ACDEFGHIKLMNPQRSTVWY', 'protein').valid).toBe(true);
    });
    it('accepts extended amino acid codes', () => {
        expect(validateResidues('UOBZJX*', 'protein').valid).toBe(true);
    });
    it('counts ambiguous amino acids', () => {
        const report = validateResidues('ACDXBZJ', 'protein');
        expect(report.ambiguousCount).toBe(4);
    });
    it('counts gaps separately from ambiguity', () => {
        const report = validateResidues('AC-GT.AC', 'dna');
        expect(report.valid).toBe(true);
        expect(report.gapCount).toBe(2);
        expect(report.ambiguousCount).toBe(0);
    });
    it('rejects non-ASCII characters, which signal a binary file', () => {
        const report = validateResidues('ACGTÿĀ', 'dna');
        expect(report.valid).toBe(false);
        expect(report.invalidCount).toBe(2);
    });
    it('rejects digits and whitespace', () => {
        const report = validateResidues('ACGT 123', 'dna');
        expect(report.valid).toBe(false);
        expect(report.invalidCount).toBe(4);
    });
    it('caps the reported distinct invalid characters', () => {
        const junk = '!@#$%^&*()_+{}|:"<>?';
        const report = validateResidues(junk, 'dna');
        expect(report.invalidCharacters.length).toBeLessThanOrEqual(16);
        expect(report.invalidCount).toBe(junk.length);
    });
    it('accepts an empty sequence', () => {
        expect(validateResidues('', 'dna').valid).toBe(true);
    });
    it('is case-insensitive', () => {
        expect(validateResidues('acgtACGT', 'dna').valid).toBe(true);
        expect(validateResidues('mkwvtfisll', 'protein').valid).toBe(true);
    });
    it('exposes convenience predicates', () => {
        expect(isValidNucleotideSequence('ACGT')).toBe(true);
        expect(isValidNucleotideSequence('ACGTZ')).toBe(false);
        expect(isValidProteinSequence('MKWV')).toBe(true);
        expect(isValidProteinSequence('MKWV1')).toBe(false);
    });
});
describe('detectSequenceType', () => {
    it('detects DNA', () => {
        const result = detectSequenceType('ATGGCGCGATCGATTAGCCGATCGATCGAT');
        expect(result.type).toBe('dna');
        expect(result.confidence).toBe(1);
    });
    it('detects DNA with ambiguity codes', () => {
        expect(detectSequenceType('ATGGCNNNNNCGATCGATTAGCCGATCGAT').type).toBe('dna');
    });
    it('detects RNA when U dominates', () => {
        const result = detectSequenceType('AUGGCGCGAUCGAUUAGCCGAUCGAUCGAU');
        expect(result.type).toBe('rna');
    });
    it('does not call RNA when T dominates', () => {
        expect(detectSequenceType('ATGGCGCGATCGATTAGCCGATCGATCGAT').type).toBe('dna');
    });
    it('detects protein', () => {
        const result = detectSequenceType('MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGEENFKALVLIAFAQ');
        expect(result.type).toBe('protein');
        expect(result.confidence).toBeGreaterThan(0.9);
    });
    it('detects protein even when nucleotide letters are common', () => {
        // Heavy in A/C/G/T but with unmistakable protein residues.
        expect(detectSequenceType('ACGTACGTACGTPEILQWACGTACGTACGT').type).toBe('protein');
    });
    it('returns unknown for an empty sample', () => {
        const result = detectSequenceType('');
        expect(result.type).toBe('unknown');
        expect(result.confidence).toBe(0);
    });
    it('returns unknown for non-sequence text', () => {
        expect(detectSequenceType('This is not a sequence, it is prose. 12345!').type).toBe('unknown');
    });
    it('ignores gap characters when sampling', () => {
        expect(detectSequenceType('ACGT----ACGT----ACGTACGTACGT').type).toBe('dna');
    });
    it('explains its decision', () => {
        expect(detectSequenceType('ACGTACGTACGTACGTACGT').reason).toMatch(/nucleotide/i);
        expect(detectSequenceType('MKWVTFISLLFLFSSAYSRGVFRRDAHKSEV').reason).toMatch(/amino acid/i);
    });
    it('reports a short ambiguous peptide as DNA but is not claimed to be certain', () => {
        // GATTACA is a valid peptide and valid DNA; composition alone cannot tell.
        const result = detectSequenceType('GATTACA');
        expect(result.type).toBe('dna');
        expect(result.confidence).toBeLessThanOrEqual(1);
    });
});
describe('detectQualityEncoding', () => {
    it('detects Phred+33 from low-range characters', () => {
        const result = detectQualityEncoding('!!!###$$$IIIJJJ');
        expect(result.encoding).toBe('phred33');
        expect(result.confident).toBe(true);
    });
    it('detects Phred+64 from high-range characters', () => {
        const result = detectQualityEncoding('hhhiiijjjkkk');
        expect(result.encoding).toBe('phred64');
        expect(result.confident).toBe(true);
    });
    it('defaults to Phred+33 in the ambiguous band', () => {
        const result = detectQualityEncoding('@ABCDEFGHIJ');
        expect(result.encoding).toBe('phred33');
        expect(result.confident).toBe(false);
    });
    it('handles an empty sample', () => {
        const result = detectQualityEncoding('');
        expect(result.encoding).toBe('phred33');
        expect(result.confident).toBe(false);
    });
});
describe('file extension parsing', () => {
    it('extracts a plain extension', () => {
        expect(fileExtensions('reads.fastq')).toEqual({ extension: 'fastq', compression: null });
    });
    it('looks past a gzip suffix', () => {
        expect(fileExtensions('reads.fastq.gz')).toEqual({ extension: 'fastq', compression: 'gz' });
        expect(fileExtensions('genome.fa.bgz')).toEqual({ extension: 'fa', compression: 'bgz' });
    });
    it('handles a name with no extension', () => {
        expect(fileExtensions('README')).toEqual({ extension: '', compression: null });
    });
    it('is case-insensitive', () => {
        expect(fileExtensions('READS.FASTQ.GZ')).toEqual({ extension: 'fastq', compression: 'gz' });
    });
});
describe('detectFormatFromContent', () => {
    it('detects FASTA from a > header', () => {
        const result = detectFormatFromContent('>seq1\nACGT\n', 'unknown.txt');
        expect(result.format).toBe('fasta');
        expect(result.gzipped).toBe(false);
    });
    it('detects FASTQ from a @ header plus a + separator', () => {
        const result = detectFormatFromContent('@r\nACGT\n+\nIIII\n', 'reads.txt');
        expect(result.format).toBe('fastq');
        expect(result.reason).toMatch(/separator/);
    });
    it('lets content override a misleading extension', () => {
        // A FASTQ file named .fasta must still be parsed as FASTQ.
        expect(detectFormatFromContent('@r\nACGT\n+\nIIII\n', 'reads.fasta').format).toBe('fastq');
        // ...and a FASTA file named .fastq as FASTA.
        expect(detectFormatFromContent('>s\nACGT\n', 'reads.fastq').format).toBe('fasta');
    });
    it('flags a gzipped filename', () => {
        expect(detectFormatFromContent('>s\nACGT\n', 'genome.fa.gz').gzipped).toBe(true);
    });
    it('notes when the extension implies protein', () => {
        expect(detectFormatFromContent('>s\nMKWV\n', 'proteins.faa').extensionSuggestsProtein).toBe(true);
        expect(detectFormatFromContent('>s\nACGT\n', 'genome.fna').extensionSuggestsProtein).toBe(false);
    });
    it('skips leading blank and comment lines', () => {
        expect(detectFormatFromContent('\n\n; comment\n>s\nACGT\n', 'x.fa').format).toBe('fasta');
    });
    it('returns unknown for unrecognised content', () => {
        const result = detectFormatFromContent('PKbinary junk', 'archive.zip');
        expect(result.format).toBe('unknown');
        expect(result.reason).toMatch(/neither/);
    });
    it('falls back to the extension for an empty file', () => {
        expect(detectFormatFromContent('', 'reads.fastq').format).toBe('fastq');
        expect(detectFormatFromContent('', 'genome.fasta').format).toBe('fasta');
        expect(detectFormatFromContent('', 'mystery.bin').format).toBe('unknown');
    });
    it('recognises gzip magic bytes', () => {
        expect(isGzipMagic(Uint8Array.from([0x1f, 0x8b, 0x08]))).toBe(true);
        expect(isGzipMagic(Uint8Array.from([0x50, 0x4b]))).toBe(false);
        expect(isGzipMagic(Uint8Array.from([0x1f]))).toBe(false);
    });
});
