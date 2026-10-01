const FASTA_EXTENSIONS = new Set(['fasta', 'fa', 'fna', 'faa', 'ffn', 'frn', 'mpfa', 'seq', 'txt']);
const FASTQ_EXTENSIONS = new Set(['fastq', 'fq', 'sanfastq']);
/** Strips a trailing `.gz`/`.bgz`/`.zst` and returns the remaining extension. */
export function fileExtensions(fileName) {
    const parts = fileName.toLowerCase().split('.');
    if (parts.length < 2)
        return { extension: '', compression: null };
    const last = parts[parts.length - 1];
    if (last === 'gz' || last === 'bgz' || last === 'gzip' || last === 'zst' || last === 'bz2') {
        return { extension: parts.length >= 3 ? parts[parts.length - 2] : '', compression: last };
    }
    return { extension: last, compression: null };
}
/**
 * Determines record format from the leading bytes of the decompressed stream,
 * falling back to the filename extension.
 *
 * Content wins over the extension: `.txt` files holding FASTQ and `.fasta`
 * files holding FASTQ both occur, and mis-parsing them produces nonsense
 * records rather than a clean error.
 */
export function detectFormatFromContent(head, fileName) {
    const { extension, compression } = fileExtensions(fileName);
    const gzipped = compression === 'gz' || compression === 'bgz' || compression === 'gzip';
    const extensionSuggestsProtein = extension === 'faa' || extension === 'mpfa';
    // Skip leading blank lines and legacy ';' comments.
    const lines = head.split('\n', 64);
    let first = null;
    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith(';'))
            continue;
        first = line;
        break;
    }
    if (first === null) {
        if (FASTQ_EXTENSIONS.has(extension)) {
            return {
                format: 'fastq',
                gzipped,
                reason: `No records were found; format assumed from the .${extension} extension.`,
                extensionSuggestsProtein,
            };
        }
        return {
            format: FASTA_EXTENSIONS.has(extension) ? 'fasta' : 'unknown',
            gzipped,
            reason: 'The file contained no non-blank lines.',
            extensionSuggestsProtein,
        };
    }
    if (first.startsWith('>')) {
        return {
            format: 'fasta',
            gzipped,
            reason: 'The first record line begins with ">".',
            extensionSuggestsProtein,
        };
    }
    if (first.startsWith('@')) {
        // Distinguish FASTQ from a FASTA-like file whose header uses '@': a FASTQ
        // record has a '+' separator line within the first few lines.
        const hasSeparator = lines.slice(1, 8).some((line) => line.startsWith('+'));
        if (hasSeparator || FASTQ_EXTENSIONS.has(extension)) {
            return {
                format: 'fastq',
                gzipped,
                reason: hasSeparator
                    ? 'The first record starts with "@" and a "+" separator line follows.'
                    : `The first record starts with "@" and the extension is .${extension}.`,
                extensionSuggestsProtein,
            };
        }
        return {
            format: 'fastq',
            gzipped,
            reason: 'The first record starts with "@". No "+" separator was found in the first lines, so the record may be wrapped or malformed.',
            extensionSuggestsProtein,
        };
    }
    if (FASTA_EXTENSIONS.has(extension)) {
        return {
            format: 'fasta',
            gzipped,
            reason: `The first line is not a header, but the .${extension} extension indicates FASTA. Leading residues will be imported under a generated identifier.`,
            extensionSuggestsProtein,
        };
    }
    return {
        format: 'unknown',
        gzipped,
        reason: `The first line starts with "${first.slice(0, 12)}", which is neither a FASTA ">" header nor a FASTQ "@" header.`,
        extensionSuggestsProtein,
    };
}
/** Recognises the gzip magic number 0x1f 0x8b. */
export const isGzipMagic = (bytes) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
export const SUPPORTED_EXTENSIONS = [
    '.fasta',
    '.fa',
    '.fna',
    '.faa',
    '.ffn',
    '.frn',
    '.fastq',
    '.fq',
    '.txt',
    '.fasta.gz',
    '.fa.gz',
    '.fna.gz',
    '.faa.gz',
    '.fastq.gz',
    '.fq.gz',
];
/** Extension list for the file picker's `accept` attribute. */
export const FILE_ACCEPT = SUPPORTED_EXTENSIONS.join(',');
