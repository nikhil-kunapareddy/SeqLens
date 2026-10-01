import { splitHeader } from './fasta';
import { IssueLog } from './types';
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
export class FastqParser {
    buffer = '';
    state = 'await-header';
    header = '';
    headerLine = 0;
    seqChunks = [];
    qualChunks = [];
    seqLength = 0;
    qualLength = 0;
    lineNumber = 0;
    count = 0;
    log = new IssueLog();
    uppercase;
    constructor(options = {}) {
        this.uppercase = options.uppercase ?? true;
    }
    get issues() {
        return this.log.issues;
    }
    get recordCount() {
        return this.count;
    }
    push(chunk, sink) {
        const text = this.buffer + chunk;
        this.buffer = '';
        let start = 0;
        while (true) {
            const newline = text.indexOf('\n', start);
            if (newline === -1)
                break;
            let end = newline;
            if (end > start && text.charCodeAt(end - 1) === 13)
                end -= 1;
            this.consumeLine(text, start, end, sink);
            start = newline + 1;
        }
        this.buffer = start === 0 ? text : text.slice(start);
    }
    end(sink) {
        if (this.buffer.length > 0) {
            let end = this.buffer.length;
            if (end > 0 && this.buffer.charCodeAt(end - 1) === 13)
                end -= 1;
            this.consumeLine(this.buffer, 0, end, sink);
            this.buffer = '';
        }
        if (this.state !== 'await-header') {
            // A record was still open when the stream ended.
            this.log.add({
                kind: 'truncated-record',
                line: this.headerLine,
                sequenceId: splitHeader(this.header).id,
                message: 'The file ended in the middle of a FASTQ record. The incomplete record was not imported; the file may have been truncated during download or copy.',
            });
            this.reset();
        }
    }
    consumeLine(text, from, to, sink) {
        this.lineNumber += 1;
        switch (this.state) {
            case 'await-header': {
                if (to <= from)
                    return; // blank separator line
                if (text.charCodeAt(from) !== 64 /* @ */) {
                    this.log.add({
                        kind: 'missing-header',
                        line: this.lineNumber,
                        message: 'Expected a FASTQ record to start with "@" but found other text. The line was skipped. If this file is FASTA, re-import it with the format set to FASTA.',
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
                            message: 'A FASTQ record contained no residues between its header and separator lines. It was imported with length 0 and is flagged in QC.',
                        });
                        this.emit(sink);
                    }
                    return;
                }
                if (to <= from)
                    return;
                let line = text.slice(from, to);
                if (this.uppercase)
                    line = line.toUpperCase();
                this.seqChunks.push(line);
                this.seqLength += line.length;
                return;
            }
            case 'quality': {
                if (to <= from && this.qualLength < this.seqLength)
                    return;
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
                        message: 'A record had more quality characters than residues. The extra characters were discarded. This usually means the "+" separator line was mistaken for a quality line in an upstream tool.',
                    });
                }
                else {
                    this.qualChunks.push(line);
                    this.qualLength += line.length;
                }
                if (this.qualLength >= this.seqLength)
                    this.emit(sink);
                return;
            }
        }
    }
    emit(sink) {
        const residues = this.seqChunks.length === 1 ? this.seqChunks[0] : this.seqChunks.join('');
        const quality = this.qualChunks.length === 1 ? this.qualChunks[0] : this.qualChunks.join('');
        const { id, description } = splitHeader(this.header);
        const headerLine = this.headerLine;
        this.reset();
        this.count += 1;
        sink({ id, description, residues, quality, line: headerLine });
    }
    reset() {
        this.state = 'await-header';
        this.header = '';
        this.seqChunks = [];
        this.qualChunks = [];
        this.seqLength = 0;
        this.qualLength = 0;
    }
}
/** Parses a complete FASTQ string. Convenience wrapper for tests. */
export function parseFastq(text, options) {
    const parser = new FastqParser(options);
    const records = [];
    const sink = (record) => records.push(record);
    parser.push(text, sink);
    parser.end(sink);
    return records;
}
/**
 * Decodes a FASTQ quality string to Phred scores.
 * Scores are clamped to 0..60, the range every current instrument emits.
 */
export function decodeQuality(quality, offset, out) {
    const scores = out && out.length >= quality.length ? out : new Uint8Array(quality.length);
    for (let i = 0; i < quality.length; i += 1) {
        const score = quality.charCodeAt(i) - offset;
        scores[i] = score < 0 ? 0 : score > 60 ? 60 : score;
    }
    return scores;
}
/** Mean Phred score of a quality string. Returns 0 for an empty string. */
export function meanPhred(quality, offset) {
    if (quality.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < quality.length; i += 1) {
        const score = quality.charCodeAt(i) - offset;
        sum += score < 0 ? 0 : score > 60 ? 60 : score;
    }
    return sum / quality.length;
}
/** Converts a Phred score to the error probability it encodes. */
export const phredToErrorProbability = (score) => 10 ** (-score / 10);
