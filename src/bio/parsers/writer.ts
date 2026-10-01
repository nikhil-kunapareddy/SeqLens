import type { Sequence } from '@/types';

export interface FastaWriteOptions {
  /** Residues per line; 0 writes each sequence on a single line. */
  lineWidth?: number;
  /** Include the description after the identifier. */
  includeDescription?: boolean;
}

/** Serialises one record as FASTA, wrapping at `lineWidth` (default 70). */
export function formatFastaRecord(
  id: string,
  description: string,
  residues: string,
  options: FastaWriteOptions = {},
): string {
  const width = options.lineWidth ?? 70;
  const includeDescription = options.includeDescription ?? true;
  const header =
    includeDescription && description ? `>${id} ${description}\n` : `>${id}\n`;
  if (width <= 0 || residues.length <= width) return `${header}${residues}\n`;

  const lines: string[] = [header];
  for (let i = 0; i < residues.length; i += width) {
    lines.push(residues.slice(i, i + width), '\n');
  }
  return lines.join('');
}

/** Serialises one record as FASTQ. Quality is padded with '!' (Q0) if short. */
export function formatFastqRecord(
  id: string,
  description: string,
  residues: string,
  quality: string,
): string {
  let qual = quality;
  if (qual.length < residues.length) qual = qual.padEnd(residues.length, '!');
  else if (qual.length > residues.length) qual = qual.slice(0, residues.length);
  const header = description ? `@${id} ${description}` : `@${id}`;
  return `${header}\n${residues}\n+\n${qual}\n`;
}

/** Serialises a list of sequences to FASTA text. */
export function writeFasta(sequences: Sequence[], options?: FastaWriteOptions): string {
  return sequences
    .map((s) => formatFastaRecord(s.id, s.description, s.residues, options))
    .join('');
}

/** Serialises a list of sequences to FASTQ text. Records without quality are skipped. */
export function writeFastq(sequences: Sequence[]): string {
  return sequences
    .filter((s) => typeof s.quality === 'string')
    .map((s) => formatFastqRecord(s.id, s.description, s.residues, s.quality as string))
    .join('');
}
