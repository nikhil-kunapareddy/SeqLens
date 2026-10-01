import type { ParseIssue } from '@/types';

/** A record emitted by an incremental parser. */
export interface ParsedRecord {
  id: string;
  description: string;
  residues: string;
  /** Raw FASTQ quality string; undefined for FASTA. */
  quality?: string;
  /** 1-based line number of the record's header. */
  line: number;
}

export type RecordSink = (record: ParsedRecord) => void;

/**
 * Incremental parser contract.
 *
 * `push` may be called with arbitrary chunk boundaries, including boundaries
 * that fall in the middle of a line or a record. `end` flushes whatever record
 * is still buffered. Parsers never throw on malformed input: they emit what can
 * be recovered and record the problem in `issues`, because a single bad record
 * in the middle of a 4 GB file should not discard the other 12 million.
 */
export interface IncrementalParser {
  push(chunk: string, sink: RecordSink): void;
  end(sink: RecordSink): void;
  readonly issues: ParseIssue[];
  readonly recordCount: number;
}

/** Accumulates issues, collapsing repeats of the same kind into one entry. */
export class IssueLog {
  readonly issues: ParseIssue[] = [];
  private readonly byKind = new Map<string, ParseIssue>();

  add(issue: Omit<ParseIssue, 'count'>): void {
    const existing = this.byKind.get(issue.kind);
    if (existing) {
      existing.count += 1;
      return;
    }
    const entry: ParseIssue = { ...issue, count: 1 };
    this.byKind.set(issue.kind, entry);
    this.issues.push(entry);
  }

  get total(): number {
    let sum = 0;
    for (const issue of this.issues) sum += issue.count;
    return sum;
  }
}
