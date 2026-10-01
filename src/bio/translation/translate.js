import { BASE_CODE } from '../alphabets';
import { reverseComplement } from '../statistics/composition';
import { getGeneticCode } from './geneticCode';
/**
 * Translates nucleotides to amino acids.
 *
 * A codon containing any character outside A/C/G/T/U cannot be resolved and
 * becomes 'X'. Substituting a guess would fabricate residues, and dropping the
 * codon would shift every downstream position, so the ambiguity is preserved
 * explicitly. Trailing bases that do not complete a codon are ignored.
 */
export function translate(residues, options = {}) {
    const code = getGeneticCode(options.geneticCode ?? 1);
    const offset = options.offset ?? 0;
    const ambiguous = options.ambiguousSymbol ?? 'X';
    const stopAtFirstStop = options.stopAtFirstStop ?? false;
    const n = residues.length;
    const out = [];
    for (let i = offset; i + 2 < n; i += 3) {
        const c1 = BASE_CODE[residues.charCodeAt(i)];
        const c2 = BASE_CODE[residues.charCodeAt(i + 1)];
        const c3 = BASE_CODE[residues.charCodeAt(i + 2)];
        if (c1 === 255 || c2 === 255 || c3 === 255) {
            out.push(ambiguous);
            continue;
        }
        const codon = c1 * 16 + c2 * 4 + c3;
        if (stopAtFirstStop && code.isStop[codon] === 1)
            break;
        out.push(String.fromCharCode(code.aminoAcids[codon]));
    }
    return out.join('');
}
/**
 * Translates all six reading frames.
 *
 * Frames 1-3 read the given strand from offsets 0, 1, 2. Frames 1-3 on the
 * minus strand read the reverse complement from the same offsets, which is the
 * standard convention (EMBOSS, NCBI ORFfinder) and means minus-strand frame 1
 * starts at the 3' end of the input.
 */
export function sixFrameTranslation(residues, geneticCode = 1, type = 'dna') {
    const reverse = reverseComplement(residues, type);
    const frames = [];
    for (const strand of ['+', '-']) {
        const source = strand === '+' ? residues : reverse;
        for (const frame of [1, 2, 3]) {
            const protein = translate(source, { geneticCode, offset: frame - 1 });
            frames.push({
                strand,
                frame,
                protein,
                stopCount: countStops(protein),
                longestStretch: longestStopFreeStretch(protein),
            });
        }
    }
    return frames;
}
const countStops = (protein) => {
    let count = 0;
    for (let i = 0; i < protein.length; i += 1) {
        if (protein.charCodeAt(i) === 42)
            count += 1;
    }
    return count;
};
/**
 * Longest run of residues containing no stop codon.
 *
 * In a coding frame this stretch is long; in the five non-coding frames of a
 * real gene it is short, because stop codons occur roughly every 21 codons by
 * chance. The contrast is what makes six-frame translation informative.
 */
const longestStopFreeStretch = (protein) => {
    let best = 0;
    let current = 0;
    for (let i = 0; i < protein.length; i += 1) {
        if (protein.charCodeAt(i) === 42) {
            if (current > best)
                best = current;
            current = 0;
        }
        else {
            current += 1;
        }
    }
    return current > best ? current : best;
};
/**
 * Finds open reading frames in all requested frames.
 *
 * When `requireStartCodon` is set, each reported ORF runs from the first
 * initiation codon after the previous stop to the next in-frame stop. This is
 * the "longest ORF per stop codon" convention used by EMBOSS `getorf` and by
 * NCBI ORFfinder's default: without it, a single gene with several internal ATG
 * codons produces a nested cascade of shorter ORFs that all share one stop.
 *
 * When `requireStartCodon` is clear, ORFs are stop-to-stop stretches, which is
 * what you want for fragmentary assemblies where the true start may be missing.
 *
 * All returned coordinates are 1-based, inclusive, and expressed on the forward
 * strand of the input sequence regardless of which strand the ORF is on, so
 * they can be drawn on a single axis.
 *
 * The initiator codon is translated literally: an ORF opening on GTG reports a
 * leading V, not M. Ribosomes do insert methionine at a genuine initiation
 * site regardless of the codon, but SeqLens has no evidence that any given ORF
 * is one, and silently rewriting the first residue would hide which alternative
 * start codon was used.
 */
export function findOrfs(residues, sequenceIndex, sequenceId, config) {
    const code = getGeneticCode(config.geneticCode);
    const orfs = [];
    const n = residues.length;
    if (n < 3)
        return orfs;
    const reverse = config.searchReverseStrand ? reverseComplement(residues) : null;
    const strands = [
        { strand: '+', source: residues },
    ];
    if (reverse !== null)
        strands.push({ strand: '-', source: reverse });
    for (const { strand, source } of strands) {
        for (const frame of [1, 2, 3]) {
            collectFrameOrfs(source, strand, frame, n, code, config, sequenceIndex, sequenceId, orfs);
        }
    }
    orfs.sort((a, b) => b.aminoAcidLength - a.aminoAcidLength || a.start - b.start);
    return orfs;
}
function collectFrameOrfs(source, strand, frame, sequenceLength, code, config, sequenceIndex, sequenceId, out) {
    const offset = frame - 1;
    const n = source.length;
    let orfStartCodon = config.requireStartCodon ? -1 : 0;
    // Codon index i covers source positions [offset + 3i, offset + 3i + 2].
    const codonCount = Math.floor((n - offset) / 3);
    for (let i = 0; i < codonCount; i += 1) {
        const p = offset + 3 * i;
        const c1 = BASE_CODE[source.charCodeAt(p)];
        const c2 = BASE_CODE[source.charCodeAt(p + 1)];
        const c3 = BASE_CODE[source.charCodeAt(p + 2)];
        if (c1 === 255 || c2 === 255 || c3 === 255) {
            // An ambiguous codon could be a stop; treating it as one avoids reporting
            // an ORF that may not exist. The open ORF is discarded rather than closed.
            orfStartCodon = config.requireStartCodon ? -1 : i + 1;
            continue;
        }
        const codon = c1 * 16 + c2 * 4 + c3;
        if (config.requireStartCodon && orfStartCodon === -1) {
            if (code.isStart[codon] === 1)
                orfStartCodon = i;
            continue;
        }
        if (code.isStop[codon] === 1) {
            if (orfStartCodon !== -1 && orfStartCodon < i) {
                emit(source, strand, frame, offset, orfStartCodon, i, sequenceLength, code, config, sequenceIndex, sequenceId, false, out);
            }
            orfStartCodon = config.requireStartCodon ? -1 : i + 1;
        }
    }
    // A run that reaches the end of the sequence without an in-frame stop.
    if (config.allowPartialOrfs && orfStartCodon !== -1 && orfStartCodon < codonCount) {
        emit(source, strand, frame, offset, orfStartCodon, codonCount, sequenceLength, code, config, sequenceIndex, sequenceId, true, out);
    }
}
function emit(source, strand, frame, offset, startCodonIndex, stopCodonIndex, sequenceLength, code, config, sequenceIndex, sequenceId, partial, out) {
    const aminoAcidLength = stopCodonIndex - startCodonIndex;
    if (aminoAcidLength < config.minAminoAcids)
        return;
    // 0-based half-open span on `source`, including the stop codon when present.
    const sourceStart = offset + 3 * startCodonIndex;
    const sourceEnd = offset + 3 * (partial ? stopCodonIndex : stopCodonIndex + 1);
    // Map back to forward-strand coordinates. A reverse-strand span [p, q) on the
    // reverse complement covers forward positions [L - q, L - p).
    const forwardStart = strand === '+' ? sourceStart : sequenceLength - sourceEnd;
    const forwardEnd = strand === '+' ? sourceEnd : sequenceLength - sourceStart;
    const protein = translate(source.slice(sourceStart, offset + 3 * stopCodonIndex), {
        geneticCode: code.id,
    });
    out.push({
        sequenceIndex,
        sequenceId,
        start: forwardStart + 1,
        end: forwardEnd,
        strand,
        frame,
        nucleotideLength: sourceEnd - sourceStart,
        aminoAcidLength,
        startCodon: source.slice(sourceStart, sourceStart + 3),
        stopCodon: partial ? null : source.slice(offset + 3 * stopCodonIndex, offset + 3 * stopCodonIndex + 3),
        partial,
        protein,
    });
}
/** The single longest ORF, or null when none meet the minimum length. */
export function longestOrf(orfs) {
    let best = null;
    for (const orf of orfs) {
        if (best === null || orf.aminoAcidLength > best.aminoAcidLength)
            best = orf;
    }
    return best;
}
