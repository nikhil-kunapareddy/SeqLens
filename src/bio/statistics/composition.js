import { DNA_COMPLEMENT_TABLE, IS_GAP, RNA_COMPLEMENT_TABLE } from '../alphabets';
/**
 * Accumulates residue counts across many sequences without allocating per
 * sequence. A 128-slot table indexed by char code is both the fastest and the
 * smallest representation for ASCII residues.
 */
export class ResidueCounter {
    counts = new Float64Array(128);
    total = 0;
    add(residues, from = 0, to = residues.length) {
        const counts = this.counts;
        let total = 0;
        for (let i = from; i < to; i += 1) {
            const code = residues.charCodeAt(i);
            if (code > 127)
                continue;
            counts[code] += 1;
            total += 1;
        }
        this.total += total;
    }
    /** Counts keyed by residue character, sorted by descending count. */
    toRecord() {
        const record = {};
        for (let code = 0; code < 128; code += 1) {
            if (this.counts[code] > 0)
                record[String.fromCharCode(code)] = this.counts[code];
        }
        return record;
    }
    get(residue) {
        return this.counts[residue.charCodeAt(0)] ?? 0;
    }
}
/**
 * GC content over a residue string.
 *
 * Ambiguous IUPAC codes are excluded from both numerator and denominator rather
 * than counted as half-GC. An assembly with 5% N would otherwise have its GC
 * pulled toward 50% purely by the gaps. This includes the codes that are
 * unambiguous with respect to GC itself (`S` = G or C, `W` = A or T): they are
 * rare enough in practice that excluding them keeps this function, the
 * per-sequence GC in the dataset index, and the ambiguous-base percentage all
 * using one consistent denominator.
 */
export function gcContent(residues, from = 0, to = residues.length) {
    let gc = 0;
    let at = 0;
    for (let i = from; i < to; i += 1) {
        switch (residues.charCodeAt(i)) {
            case 71: // G
            case 103:
            case 67: // C
            case 99:
                gc += 1;
                break;
            case 65: // A
            case 97:
            case 84: // T
            case 116:
            case 85: // U
            case 117:
                at += 1;
                break;
            default:
                break;
        }
    }
    const unambiguous = gc + at;
    return { gc, at, unambiguous, percent: unambiguous === 0 ? 0 : (gc / unambiguous) * 100 };
}
/**
 * G + C count only, for the hot import path.
 *
 * Paired with `countAmbiguous`, this is what the dataset index stores: GC
 * percentage is later recovered as `gc / (length - ambiguous)`, which matches
 * the denominator `gcContent` uses.
 */
export function countGc(residues) {
    let gc = 0;
    for (let i = 0; i < residues.length; i += 1) {
        const code = residues.charCodeAt(i);
        if (code === 71 || code === 67 || code === 103 || code === 99)
            gc += 1;
    }
    return gc;
}
/**
 * Strand-composition skew.
 *
 * GC skew flips sign at the replication origin and terminus in most bacterial
 * chromosomes, which makes it a useful orientation check on an assembly. On a
 * set of short reads from both strands it averages to zero by construction and
 * carries no information.
 */
export function strandSkew(counts) {
    const gcTotal = counts.g + counts.c;
    const atTotal = counts.a + counts.t;
    return {
        gcSkew: gcTotal === 0 ? 0 : (counts.g - counts.c) / gcTotal,
        atSkew: atTotal === 0 ? 0 : (counts.a - counts.t) / atTotal,
    };
}
/**
 * Counts CpG dinucleotides and the observed/expected ratio.
 *
 * Expected count assumes independence: (C count * G count) / length. Vertebrate
 * genomes show a marked CpG deficit from methylation-driven deamination, with
 * observed/expected near 0.2, while CpG islands rise above 0.6. Bacterial and
 * plant genomes have no such deficit, so the ratio is only interpretable
 * relative to an expectation for the source organism.
 */
export function cpgStatistics(residues) {
    let cpg = 0;
    let c = 0;
    let g = 0;
    const n = residues.length;
    for (let i = 0; i < n; i += 1) {
        const code = residues.charCodeAt(i);
        if (code === 67 || code === 99) {
            c += 1;
            if (i + 1 < n) {
                const next = residues.charCodeAt(i + 1);
                if (next === 71 || next === 103)
                    cpg += 1;
            }
        }
        else if (code === 71 || code === 103) {
            g += 1;
        }
    }
    const expected = n === 0 ? 0 : (c * g) / n;
    return { count: cpg, observedExpected: expected === 0 ? 0 : cpg / expected };
}
/**
 * Reverse complement.
 *
 * Ambiguity codes are complemented correctly (R->Y, B->V, and so on) and gap
 * characters pass through. Characters outside the nucleotide alphabet become
 * 'N' rather than being dropped, so the output length always matches the input
 * and downstream coordinates stay valid.
 */
export function reverseComplement(residues, type = 'dna') {
    const table = type === 'rna' ? RNA_COMPLEMENT_TABLE : DNA_COMPLEMENT_TABLE;
    const n = residues.length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
        const code = residues.charCodeAt(n - 1 - i);
        const complement = code < 128 ? table[code] : 0;
        out[i] = complement === 0 ? 78 /* N */ : complement;
    }
    return decodeAscii(out);
}
/** Complement without reversing. */
export function complement(residues, type = 'dna') {
    const table = type === 'rna' ? RNA_COMPLEMENT_TABLE : DNA_COMPLEMENT_TABLE;
    const n = residues.length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
        const code = residues.charCodeAt(i);
        const c = code < 128 ? table[code] : 0;
        out[i] = c === 0 ? 78 : c;
    }
    return decodeAscii(out);
}
/** Reverses a string; used for reverse-only views in the sequence explorer. */
export const reverse = (residues) => {
    let out = '';
    for (let i = residues.length - 1; i >= 0; i -= 1)
        out += residues[i];
    return out;
};
/** DNA to RNA: T becomes U. */
export const transcribe = (residues) => residues.replace(/T/g, 'U').replace(/t/g, 'u');
/** RNA to DNA: U becomes T. */
export const reverseTranscribe = (residues) => residues.replace(/U/g, 'T').replace(/u/g, 't');
/**
 * Decodes an ASCII byte array to a string in 32k chunks.
 * `String.fromCharCode(...bytes)` blows the argument limit past ~120k entries,
 * which a single chromosome would hit immediately.
 */
function decodeAscii(bytes) {
    const CHUNK = 32768;
    if (bytes.length <= CHUNK) {
        return String.fromCharCode(...bytes);
    }
    const parts = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
        parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
    }
    return parts.join('');
}
/**
 * Per-position residue composition, as percentages.
 *
 * Positions beyond `cap` are not tracked: for a set of 150 bp reads the full
 * profile is small, but for a set of variable-length contigs the tail positions
 * are covered by a single sequence and the percentages there are noise.
 */
export class PositionalComposition {
    /** Rows: A, C, G, T/U, other. */
    counts;
    coverage;
    cap;
    constructor(cap) {
        this.cap = cap;
        this.counts = new Uint32Array(cap * 5);
        this.coverage = new Uint32Array(cap);
    }
    add(residues) {
        const limit = Math.min(residues.length, this.cap);
        const counts = this.counts;
        const cap = this.cap;
        for (let i = 0; i < limit; i += 1) {
            let row;
            switch (residues.charCodeAt(i)) {
                case 65:
                case 97:
                    row = 0;
                    break;
                case 67:
                case 99:
                    row = 1;
                    break;
                case 71:
                case 103:
                    row = 2;
                    break;
                case 84:
                case 116:
                case 85:
                case 117:
                    row = 3;
                    break;
                default:
                    row = 4;
            }
            counts[row * cap + i] += 1;
            this.coverage[i] += 1;
        }
    }
    toRows() {
        const rows = [];
        const cap = this.cap;
        for (let i = 0; i < cap; i += 1) {
            const total = this.coverage[i];
            if (total === 0)
                continue;
            rows.push({
                position: i + 1,
                A: (this.counts[i] / total) * 100,
                C: (this.counts[cap + i] / total) * 100,
                G: (this.counts[2 * cap + i] / total) * 100,
                T: (this.counts[3 * cap + i] / total) * 100,
                N: (this.counts[4 * cap + i] / total) * 100,
            });
        }
        return rows;
    }
}
/** Counts residues outside the canonical alphabet for the molecule type. */
export function countAmbiguous(residues, type) {
    let count = 0;
    if (type === 'protein') {
        for (let i = 0; i < residues.length; i += 1) {
            const code = residues.charCodeAt(i);
            // B, Z, J, X are the amino acid ambiguity codes.
            if (code === 66 || code === 90 || code === 74 || code === 88)
                count += 1;
            else if (code === 98 || code === 122 || code === 106 || code === 120)
                count += 1;
        }
        return count;
    }
    for (let i = 0; i < residues.length; i += 1) {
        const code = residues.charCodeAt(i);
        if (code > 127 || IS_GAP[code] === 1)
            continue;
        switch (code) {
            case 65:
            case 97:
            case 67:
            case 99:
            case 71:
            case 103:
            case 84:
            case 116:
            case 85:
            case 117:
                break;
            default:
                count += 1;
        }
    }
    return count;
}
