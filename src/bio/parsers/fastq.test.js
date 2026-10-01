import { describe, expect, it } from 'vitest';
import { FastqParser, decodeQuality, meanPhred, parseFastq, phredToErrorProbability, } from './fastq';
const SIMPLE = '@read1 sample\nACGTACGT\n+\nIIIIIIII\n@read2\nTTTTGGGG\n+\n!!!!####\n';
describe('parseFastq', () => {
    it('parses standard four-line records', () => {
        const records = parseFastq(SIMPLE);
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({
            id: 'read1',
            description: 'sample',
            residues: 'ACGTACGT',
            quality: 'IIIIIIII',
            line: 1,
        });
        expect(records[1]).toMatchObject({ id: 'read2', residues: 'TTTTGGGG', quality: '!!!!####' });
    });
    it('handles CRLF line endings', () => {
        const records = parseFastq('@r\r\nACGT\r\n+\r\nIIII\r\n');
        expect(records[0]).toMatchObject({ residues: 'ACGT', quality: 'IIII' });
    });
    it('parses wrapped sequence and quality lines', () => {
        const records = parseFastq('@r\nACGT\nACGT\n+\nIIII\nJJJJ\n');
        expect(records).toHaveLength(1);
        expect(records[0].residues).toBe('ACGTACGT');
        expect(records[0].quality).toBe('IIIIJJJJ');
    });
    it('accepts a quality line that begins with @', () => {
        // '@' is Q31 in Phred+33 and appears in real quality strings.
        const records = parseFastq('@r\nACGT\n+\n@@@@\n@r2\nTTTT\n+\nIIII\n');
        expect(records).toHaveLength(2);
        expect(records[0].quality).toBe('@@@@');
        expect(records[1].id).toBe('r2');
    });
    it('accepts a quality line that begins with +', () => {
        // '+' is Q10 in Phred+33.
        const records = parseFastq('@r\nACGTACGT\n+\n++++++++\n');
        expect(records).toHaveLength(1);
        expect(records[0].quality).toBe('++++++++');
    });
    it('keeps the description on the separator line out of the record', () => {
        const records = parseFastq('@r desc\nACGT\n+r desc\nIIII\n');
        expect(records).toHaveLength(1);
        expect(records[0].description).toBe('desc');
        expect(records[0].quality).toBe('IIII');
    });
    it('returns nothing for empty input', () => {
        expect(parseFastq('')).toEqual([]);
        expect(parseFastq('\n\n')).toEqual([]);
    });
    it('uppercases residues but never the quality string', () => {
        const records = parseFastq('@r\nacgt\n+\nabcd\n');
        expect(records[0].residues).toBe('ACGT');
        expect(records[0].quality).toBe('abcd');
    });
});
describe('FastqParser malformed input handling', () => {
    it('reports a truncated final record and does not emit it', () => {
        const parser = new FastqParser();
        const records = [];
        const sink = (r) => records.push(r);
        parser.push('@good\nACGT\n+\nIIII\n@truncated\nACGT\n+\nII', sink);
        parser.end(sink);
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe('good');
        const issue = parser.issues.find((i) => i.kind === 'truncated-record');
        expect(issue).toBeDefined();
        expect(issue?.sequenceId).toBe('truncated');
    });
    it('discards surplus quality characters and reports the mismatch', () => {
        const parser = new FastqParser();
        const records = [];
        const sink = (r) => records.push(r);
        parser.push('@r\nACGT\n+\nIIIIIIIIII\n', sink);
        parser.end(sink);
        expect(records).toHaveLength(1);
        expect(records[0].quality).toHaveLength(4);
        expect(parser.issues.some((i) => i.kind === 'quality-length-mismatch')).toBe(true);
    });
    it('skips a line where a header was expected and keeps parsing', () => {
        const parser = new FastqParser();
        const records = [];
        const sink = (r) => records.push(r);
        parser.push('garbage line\n@r\nACGT\n+\nIIII\n', sink);
        parser.end(sink);
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe('r');
        expect(parser.issues.some((i) => i.kind === 'missing-header')).toBe(true);
    });
    it('reports an empty record and still emits it', () => {
        const parser = new FastqParser();
        const records = [];
        const sink = (r) => records.push(r);
        parser.push('@empty\n+\n\n@r\nACGT\n+\nIIII\n', sink);
        parser.end(sink);
        expect(records.map((r) => r.id)).toEqual(['empty', 'r']);
        expect(records[0].residues).toBe('');
        expect(parser.issues.some((i) => i.kind === 'empty-sequence')).toBe(true);
    });
});
describe('FastqParser streaming', () => {
    it('produces identical records regardless of chunk boundaries', () => {
        const expected = parseFastq(SIMPLE);
        for (let chunkSize = 1; chunkSize <= SIMPLE.length + 2; chunkSize += 1) {
            const parser = new FastqParser();
            const records = [];
            const sink = (r) => records.push(r);
            for (let i = 0; i < SIMPLE.length; i += chunkSize) {
                parser.push(SIMPLE.slice(i, i + chunkSize), sink);
            }
            parser.end(sink);
            expect(records, `chunk size ${chunkSize}`).toEqual(expected);
            expect(parser.issues, `chunk size ${chunkSize}`).toEqual([]);
        }
    });
});
describe('quality decoding', () => {
    it('decodes Phred+33 scores', () => {
        const scores = decodeQuality('!5I', 33);
        expect([...scores]).toEqual([0, 20, 40]);
    });
    it('decodes Phred+64 scores', () => {
        const scores = decodeQuality('@Th', 64);
        expect([...scores]).toEqual([0, 20, 40]);
    });
    it('clamps out-of-range characters into 0..60', () => {
        const scores = decodeQuality('~', 33);
        expect(scores[0]).toBe(0);
        expect(scores[1]).toBe(60);
    });
    it('reuses a supplied output buffer', () => {
        const buffer = new Uint8Array(8);
        const scores = decodeQuality('III', 33, buffer);
        expect(scores).toBe(buffer);
        expect(scores[0]).toBe(40);
    });
    it('computes the mean Phred score', () => {
        expect(meanPhred('IIII', 33)).toBe(40);
        expect(meanPhred('!I', 33)).toBe(20);
        expect(meanPhred('', 33)).toBe(0);
    });
    it('converts Phred to error probability', () => {
        expect(phredToErrorProbability(10)).toBeCloseTo(0.1, 10);
        expect(phredToErrorProbability(20)).toBeCloseTo(0.01, 10);
        expect(phredToErrorProbability(30)).toBeCloseTo(0.001, 10);
    });
});
