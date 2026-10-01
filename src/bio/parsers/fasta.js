import { IssueLog } from './types';
/**
 * Streaming FASTA parser.
 *
 * Handles the variations that show up in real files:
 *  - LF, CRLF, and lone CR line endings
 *  - wrapped sequence lines of any width, including 1 bp and unwrapped
 *  - blank lines inside and between records
 *  - `;` comment lines from pre-1990 FASTA
 *  - a header with no sequence (emitted as an empty record plus an issue)
 *  - residues appearing before any header (recovered under the id `unnamed_1`)
 *  - a chunk boundary falling anywhere, including inside a header line
 *
 * Sequence lines are collected into an array and joined once per record. That
 * matters: repeated `str += line` on a 250 Mbp chromosome produces quadratic
 * rope flattening in V8, while a single `join('')` is linear.
 */
export class FastaParser {
    buffer = '';
    header = null;
    chunks = [];
    headerLine = 0;
    lineNumber = 0;
    unnamedCount = 0;
    log = new IssueLog();
    count = 0;
    uppercase;
    stripGaps;
    constructor(options = {}) {
        this.uppercase = options.uppercase ?? true;
        this.stripGaps = options.stripGaps ?? false;
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
            // Trim a trailing CR from CRLF files.
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
        this.flush(sink);
    }
    consumeLine(text, from, to, sink) {
        this.lineNumber += 1;
        if (to <= from)
            return; // blank line
        const first = text.charCodeAt(from);
        if (first === 62 /* > */) {
            this.flush(sink);
            this.header = text.slice(from + 1, to);
            this.headerLine = this.lineNumber;
            return;
        }
        if (first === 59 /* ; */)
            return; // legacy comment line
        if (this.header === null && this.chunks.length === 0) {
            // Residues before any header: recover rather than discard.
            this.unnamedCount += 1;
            this.header = `unnamed_${this.unnamedCount}`;
            this.headerLine = this.lineNumber;
            this.log.add({
                kind: 'missing-header',
                line: this.lineNumber,
                message: 'Sequence data appeared before any ">" header line. The records were imported under generated identifiers (unnamed_1, unnamed_2, ...).',
            });
        }
        let line = text.slice(from, to);
        if (this.uppercase)
            line = line.toUpperCase();
        if (this.stripGaps && (line.includes('-') || line.includes('.'))) {
            line = line.replace(/[-.]/g, '');
        }
        if (line.length > 0)
            this.chunks.push(line);
    }
    flush(sink) {
        if (this.header === null)
            return;
        const header = this.header;
        const residues = this.chunks.length === 1 ? this.chunks[0] : this.chunks.join('');
        this.header = null;
        this.chunks = [];
        const { id, description } = splitHeader(header);
        if (residues.length === 0) {
            this.log.add({
                kind: 'empty-sequence',
                line: this.headerLine,
                sequenceId: id,
                message: 'One or more records have a header but no residues. They were imported with length 0 and are flagged in QC.',
            });
        }
        this.count += 1;
        sink({ id, description, residues, line: this.headerLine });
    }
}
/**
 * Splits a FASTA/FASTQ header into an identifier and a free-text description at
 * the first run of whitespace, matching NCBI and EMBL conventions.
 */
export function splitHeader(header) {
    const trimmed = header.trimStart();
    let i = 0;
    while (i < trimmed.length) {
        const code = trimmed.charCodeAt(i);
        if (code === 32 || code === 9)
            break;
        i += 1;
    }
    if (i === trimmed.length)
        return { id: trimmed, description: '' };
    return { id: trimmed.slice(0, i), description: trimmed.slice(i + 1).trim() };
}
/** Parses a complete FASTA string. Convenience wrapper for tests and demo data. */
export function parseFasta(text, options) {
    const parser = new FastaParser(options);
    const records = [];
    const sink = (record) => records.push(record);
    parser.push(text, sink);
    parser.end(sink);
    return records;
}
