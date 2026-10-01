import { splitHeader } from './fasta';
import { IssueLog, type IncrementalParser, type ParsedRecord, type RecordSink } from './types';

export interface FastqParserOptions {
  uppercase?: boolean;
}

type State = 'await-header' | 'sequence' | 'quality';

/**
 * Streaming FASTQ parser.
 *
 * The common case is the strict four-line record, but the format permits
 * wrapped sequence and quality lines, and a quality line may legitimately begin
 * with `@` or `+`. Splitting on line count alone therefore corrupts wrapped
 * files. This parser instead tracks state: sequence lines accumulate until a
 * line beginning with `+`, then quality characters accumulate until their count
 * matches the sequence length. That rule is unambiguous regardless of wrapping.
 */
export class FastqParser implements IncrementalParser {
  private buffer = '';
  private state: State = 'await-header';
  private header = '';
  private headerLine = 0;
  private seqChunks: string[] = [];
  private qualChunks: string[] = [];
  private seqLength = 0;
  private qualLength = 0;
  private lineNumber = 0;
  private count = 0;
  private readonly log = new IssueLog();
  private readonly uppercase: boolean;

  constructor(options: FastqParserOptions = {}) {
    this.uppercase = options.uppercase ?? true;
  }

  get issues() {
    return this.log.issues;
  }

  get recordCount() {
    return this.count;
  }

  push(chunk: string, sink: RecordSink): void {
    const text = this.buffer + chunk;
    this.buffer = '';
    let start = 0;

    while (true) {
      const newline = text.indexOf('\n', start);
      if (newline === -1) break;
      let end = newline;
      if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
      this.consumeLine(text, start, end, sink);
      start = newline + 1;
    }

    this.buffer = start === 0 ? text : text.slice(start);
  }

  end(sink: RecordSink): void {
    if (this.buffer.length > 0) {
      let end = this.buffer.length;
      if (end > 0 && this.buffer.charCodeAt(end - 1) === 13) end -= 1;
      this.consumeLine(this.buffer, 0, end, sink);
      this.buffer = '';
    }

    if (this.state !== 'await-header') {
      // A record was still open when the stream ended.
      this.log.add({
        kind: 'truncated-record',
        line: this.headerLine,
        sequenceId: splitHeader(this.header).id,
        message:
          'The file ended in the middle of a FASTQ record. The incomplete record was not imported; the file may have been truncated during download or copy.',
      });
      this.reset();
    }
  }

  private consumeLine(text: string, from: number, to: number, sink: RecordSink): void {
    this.lineNumber += 1;

    switch (this.state) {
      case 'await-header': {
        if (to <= from) return; // blank separator line
        if (text.charCodeAt(from) !== 64 /* @ */) {
          this.log.add({
            kind: 'missing-header',
            line: this.lineNumber,
            message:
              'Expected a FASTQ record to start with "@" but found other text. The line was skipped. If this file is FASTA, re-import it with the format set to FASTA.',
          });
          return;
        }
        this.header = text.slice(from + 1, to);
        this.headerLine = this.lineNumber;
        this.state = 'sequence';
        return;
      }

      case 'sequence': {
        // A '+' at the start of a line closes the sequence section. Inside the
        // sequence section '+' is not a legal residue, so this is unambiguous.
        if (to > from && text.charCodeAt(from) === 43 /* + */) {
          this.state = 'quality';
          if (this.seqLength === 0) {
            this.log.add({
              kind: 'empty-sequence',
              line: this.headerLine,
              sequenceId: splitHeader(this.header).id,
              message:
                'A FASTQ record contained no residues between its header and separator lines. It was imported with length 0 and is flagged in QC.',
            });
            this.emit(sink);
          }
          return;
        }
        if (to <= from) return;
        let line = text.slice(from, to);
        if (this.uppercase) line = line.toUpperCase();
        this.seqChunks.push(line);
        this.seqLength += line.length;
        return;
      }

      case 'quality': {
        if (to <= from && this.qualLength < this.seqLength) return;
        const line = text.slice(from, to);
        const remaining = this.seqLength - this.qualLength;
        if (line.length > remaining) {
          // More quality characters than residues: keep what lines up and warn.
          this.qualChunks.push(line.slice(0, remaining));
          this.qualLength = this.seqLength;
          this.log.add({
            kind: 'quality-length-mismatch',
            line: this.lineNumber,
            sequenceId: splitHeader(this.header).id,
            message:
              'A record had more quality characters than residues. The extra characters were discarded. This usually means the "+" separator line was mistaken for a quality line in an upstream tool.',
          });
        } else {
          this.qualChunks.push(line);
          this.qualLength += line.length;
        }
        if (this.qualLength >= this.seqLength) this.emit(sink);
        return;
      }
    }
  }

  private emit(sink: RecordSink): void {
    const residues = this.seqChunks.length === 1 ? this.seqChunks[0] : this.seqChunks.join('');
    const quality = this.qualChunks.length === 1 ? this.qualChunks[0] : this.qualChunks.join('');
    const { id, description } = splitHeader(this.header);
    const headerLine = this.headerLine;
    this.reset();
    this.count += 1;
    sink({ id, description, residues, quality, line: headerLine });
  }

  private reset(): void {
    this.state = 'await-header';
    this.header = '';
    this.seqChunks = [];
    this.qualChunks = [];
    this.seqLength = 0;
    this.qualLength = 0;
  }
}

/** Parses a complete FASTQ string. Convenience wrapper for tests. */
export function parseFastq(text: string, options?: FastqParserOptions): ParsedRecord[] {
  const parser = new FastqParser(options);
  const records: ParsedRecord[] = [];
  const sink: RecordSink = (record) => records.push(record);
  parser.push(text, sink);
  parser.end(sink);
  return records;
}

/**
 * Decodes a FASTQ quality string to Phred scores.
 * Scores are clamped to 0..60, the range every current instrument emits.
 */
export function decodeQuality(quality: string, offset: number, out?: Uint8Array): Uint8Array {
  const scores = out && out.length >= quality.length ? out : new Uint8Array(quality.length);
  for (let i = 0; i < quality.length; i += 1) {
    const score = quality.charCodeAt(i) - offset;
    scores[i] = score < 0 ? 0 : score > 60 ? 60 : score;
  }
  return scores;
}

/** Mean Phred score of a quality string. Returns 0 for an empty string. */
export function meanPhred(quality: string, offset: number): number {
  if (quality.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < quality.length; i += 1) {
    const score = quality.charCodeAt(i) - offset;
    sum += score < 0 ? 0 : score > 60 ? 60 : score;
  }
  return sum / quality.length;
}

/** Converts a Phred score to the error probability it encodes. */
export const phredToErrorProbability = (score: number): number => 10 ** (-score / 10);
