import { describe, expect, it } from 'vitest';
import { FastaParser, parseFasta, splitHeader } from './fasta';
import type { ParsedRecord } from './types';

describe('splitHeader', () => {
  it('splits at the first whitespace run', () => {
    expect(splitHeader('sp|P69905|HBA_HUMAN Hemoglobin subunit alpha')).toEqual({
      id: 'sp|P69905|HBA_HUMAN',
      description: 'Hemoglobin subunit alpha',
    });
  });

  it('handles a header with no description', () => {
    expect(splitHeader('contig_1')).toEqual({ id: 'contig_1', description: '' });
  });

  it('handles tab-separated headers', () => {
    expect(splitHeader('gene1\tdescription here')).toEqual({
      id: 'gene1',
      description: 'description here',
    });
  });

  it('collapses leading and repeated whitespace', () => {
    expect(splitHeader('  id   spaced  out ')).toEqual({
      id: 'id',
      description: 'spaced  out',
    });
  });

  it('returns an empty id for an empty header', () => {
    expect(splitHeader('')).toEqual({ id: '', description: '' });
  });
});

describe('parseFasta', () => {
  it('parses a single record', () => {
    const records = parseFasta('>seq1 first\nACGTACGT\n');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'seq1',
      description: 'first',
      residues: 'ACGTACGT',
      line: 1,
    });
  });

  it('joins wrapped sequence lines', () => {
    const records = parseFasta('>seq1\nACGT\nACGT\nAC\n');
    expect(records[0].residues).toBe('ACGTACGTAC');
  });

  it('parses multiple records', () => {
    const records = parseFasta('>a\nAAAA\n>b\nCCCC\n>c\nGGGG\n');
    expect(records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(records.map((r) => r.residues)).toEqual(['AAAA', 'CCCC', 'GGGG']);
  });

  it('handles a missing trailing newline', () => {
    const records = parseFasta('>a\nACGT');
    expect(records).toHaveLength(1);
    expect(records[0].residues).toBe('ACGT');
  });

  it('handles CRLF line endings', () => {
    const records = parseFasta('>a desc\r\nACGT\r\nACGT\r\n>b\r\nTTTT\r\n');
    expect(records).toHaveLength(2);
    expect(records[0].residues).toBe('ACGTACGT');
    expect(records[0].description).toBe('desc');
    expect(records[1].residues).toBe('TTTT');
  });

  it('skips blank lines between and within records', () => {
    const records = parseFasta('>a\n\nACGT\n\n\nACGT\n\n>b\nTTTT\n');
    expect(records).toHaveLength(2);
    expect(records[0].residues).toBe('ACGTACGT');
  });

  it('ignores legacy semicolon comment lines', () => {
    const records = parseFasta('; a comment\n>a\n; another\nACGT\n');
    expect(records).toHaveLength(1);
    expect(records[0].residues).toBe('ACGT');
  });

  it('uppercases residues by default and preserves case when asked', () => {
    expect(parseFasta('>a\nacgt\n')[0].residues).toBe('ACGT');
    expect(parseFasta('>a\nacgt\n', { uppercase: false })[0].residues).toBe('acgt');
  });

  it('strips gap characters when requested', () => {
    expect(parseFasta('>a\nAC-GT..AC\n', { stripGaps: true })[0].residues).toBe('ACGTAC');
    expect(parseFasta('>a\nAC-GT..AC\n')[0].residues).toBe('AC-GT..AC');
  });

  it('records line numbers of headers', () => {
    const records = parseFasta('>a\nACGT\nACGT\n>b\nTT\n');
    expect(records[0].line).toBe(1);
    expect(records[1].line).toBe(4);
  });

  it('returns nothing for an empty input', () => {
    expect(parseFasta('')).toEqual([]);
    expect(parseFasta('\n\n\n')).toEqual([]);
  });
});

describe('FastaParser malformed input handling', () => {
  it('reports a header with no residues and still emits the record', () => {
    const parser = new FastaParser();
    const records: ParsedRecord[] = [];
    const sink = (r: ParsedRecord) => records.push(r);
    parser.push('>empty\n>next\nACGT\n', sink);
    parser.end(sink);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: 'empty', residues: '' });
    const issue = parser.issues.find((i) => i.kind === 'empty-sequence');
    expect(issue).toBeDefined();
    expect(issue?.sequenceId).toBe('empty');
  });

  it('recovers residues that appear before any header', () => {
    const parser = new FastaParser();
    const records: ParsedRecord[] = [];
    const sink = (r: ParsedRecord) => records.push(r);
    parser.push('ACGTACGT\n>real\nTTTT\n', sink);
    parser.end(sink);

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe('unnamed_1');
    expect(records[0].residues).toBe('ACGTACGT');
    expect(records[1].id).toBe('real');
    expect(parser.issues.some((i) => i.kind === 'missing-header')).toBe(true);
  });

  it('collapses repeated issues of the same kind into one entry with a count', () => {
    const parser = new FastaParser();
    const sink = () => {};
    parser.push('>a\n>b\n>c\n>d\nACGT\n', sink);
    parser.end(sink);

    const issues = parser.issues.filter((i) => i.kind === 'empty-sequence');
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(3);
  });
});

describe('FastaParser streaming', () => {
  const fixture =
    '>seq1 alpha\nACGTACGTAC\nGTACGTACGT\n>seq2 beta\nTTTTGGGGCC\n>seq3\nAAAA\n';

  /** Feeds the same text in every possible chunk size and checks the result. */
  it('produces identical records regardless of chunk boundaries', () => {
    const expected = parseFasta(fixture);

    for (let chunkSize = 1; chunkSize <= fixture.length + 2; chunkSize += 1) {
      const parser = new FastaParser();
      const records: ParsedRecord[] = [];
      const sink = (r: ParsedRecord) => records.push(r);
      for (let i = 0; i < fixture.length; i += chunkSize) {
        parser.push(fixture.slice(i, i + chunkSize), sink);
      }
      parser.end(sink);

      expect(records, `chunk size ${chunkSize}`).toEqual(expected);
    }
  });

  it('handles a CRLF pair split across a chunk boundary', () => {
    const text = '>a\r\nACGT\r\n>b\r\nTTTT\r\n';
    const splitAt = text.indexOf('\r\n') + 1; // between CR and LF
    const parser = new FastaParser();
    const records: ParsedRecord[] = [];
    const sink = (r: ParsedRecord) => records.push(r);
    parser.push(text.slice(0, splitAt), sink);
    parser.push(text.slice(splitAt), sink);
    parser.end(sink);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: 'a', residues: 'ACGT' });
    expect(records[1]).toMatchObject({ id: 'b', residues: 'TTTT' });
  });

  it('counts records as they are emitted', () => {
    const parser = new FastaParser();
    const sink = () => {};
    parser.push('>a\nACGT\n>b\nTTTT\n', sink);
    expect(parser.recordCount).toBe(1); // second record is still buffered
    parser.end(sink);
    expect(parser.recordCount).toBe(2);
  });
});
