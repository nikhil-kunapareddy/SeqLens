/** Serialises one record as FASTA, wrapping at `lineWidth` (default 70). */
export function formatFastaRecord(id, description, residues, options = {}) {
    const width = options.lineWidth ?? 70;
    const includeDescription = options.includeDescription ?? true;
    const header = includeDescription && description ? `>${id} ${description}\n` : `>${id}\n`;
    if (width <= 0 || residues.length <= width)
        return `${header}${residues}\n`;
    const lines = [header];
    for (let i = 0; i < residues.length; i += width) {
        lines.push(residues.slice(i, i + width), '\n');
    }
    return lines.join('');
}
/** Serialises one record as FASTQ. Quality is padded with '!' (Q0) if short. */
export function formatFastqRecord(id, description, residues, quality) {
    let qual = quality;
    if (qual.length < residues.length)
        qual = qual.padEnd(residues.length, '!');
    else if (qual.length > residues.length)
        qual = qual.slice(0, residues.length);
    const header = description ? `@${id} ${description}` : `@${id}`;
    return `${header}\n${residues}\n+\n${qual}\n`;
}
/** Serialises a list of sequences to FASTA text. */
export function writeFasta(sequences, options) {
    return sequences
        .map((s) => formatFastaRecord(s.id, s.description, s.residues, options))
        .join('');
}
/** Serialises a list of sequences to FASTQ text. Records without quality are skipped. */
export function writeFastq(sequences) {
    return sequences
        .filter((s) => typeof s.quality === 'string')
        .map((s) => formatFastqRecord(s.id, s.description, s.residues, s.quality))
        .join('');
}
