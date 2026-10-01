import { BASE_CODE } from '../alphabets';
/**
 * Murphy et al. (2000) 10-letter reduced amino acid alphabet.
 *
 * A protein 3-mer over the full 20-letter alphabet needs 8,000 dimensions and
 * is almost entirely zero for a single sequence. Collapsing chemically similar
 * residues to ten classes brings that to 1,000 dimensions and, more usefully,
 * makes conservative substitutions look like matches instead of mismatches.
 */
const REDUCED_ALPHABET = {
    L: 0, V: 0, I: 0, M: 0,
    C: 1,
    A: 2,
    G: 3,
    S: 4, T: 4,
    P: 5,
    F: 6, Y: 6, W: 6,
    E: 7, D: 7, N: 7, Q: 7,
    K: 8, R: 8,
    H: 9,
};
const REDUCED_SIZE = 10;
const REDUCED_TABLE = (() => {
    const table = new Uint8Array(128).fill(255);
    for (const [residue, group] of Object.entries(REDUCED_ALPHABET)) {
        table[residue.charCodeAt(0)] = group;
        table[residue.toLowerCase().charCodeAt(0)] = group;
    }
    return table;
})();
/**
 * Deterministic k-mer spectrum embedding.
 *
 * Each sequence becomes its normalised k-mer frequency vector: 4^k dimensions
 * for nucleotides, 10^k over the reduced alphabet for proteins. Vectors are
 * L2-normalised so that cosine similarity between them is meaningful and
 * sequence length does not dominate.
 *
 * This is genuinely useful and genuinely limited, and it is worth being precise
 * about which. k-mer spectra reliably separate sequences by compositional
 * signature: organism GC bias, coding versus non-coding, repeat families,
 * different taxa in a metagenome. That is why they underpin tools like Kraken
 * and MetaBAT. What they do not capture is anything positional or structural -
 * two remote homologues with conserved fold and shuffled composition look
 * unrelated, and two unrelated sequences with matched composition look close.
 * A protein language model would capture that; a counting argument cannot.
 * SeqLens labels this provider `deterministic` for exactly that reason.
 */
export class KmerSpectrumProvider {
    info = {
        id: 'kmer-spectrum',
        name: 'k-mer spectrum',
        description: 'Normalised k-mer frequency vector. Captures compositional signature; does not model sequence order or structure.',
        family: 'deterministic',
        supports: ['dna', 'rna', 'protein'],
        dimensions: 'variable',
        availability: { status: 'available' },
        locality: 'Computed in a Web Worker on this device. No model download and no network access.',
    };
    async probe() {
        // Pure arithmetic with no external dependency, so this always runs.
        return { status: 'available' };
    }
    async embed(sequences, options) {
        const isProtein = options.sequenceType === 'protein';
        const alphabetSize = isProtein ? REDUCED_SIZE : 4;
        // Keep the vector under ~16k dimensions: beyond that, both the reduction
        // and the neighbour search cost more than the extra resolution is worth.
        const maxK = isProtein ? 4 : 7;
        const k = Math.max(1, Math.min(options.k, maxK));
        const dimensions = alphabetSize ** k;
        const notes = [];
        if (k !== options.k) {
            notes.push(`k was reduced from ${options.k} to ${k}: ${alphabetSize}^${options.k} dimensions would exceed the 16,384-dimension limit for this alphabet.`);
        }
        if (isProtein) {
            notes.push('Protein k-mers use the Murphy 10-letter reduced alphabet, so chemically similar residues share a dimension.');
        }
        const vectors = new Float32Array(sequences.length * dimensions);
        const counts = new Float32Array(dimensions);
        for (let s = 0; s < sequences.length; s += 1) {
            counts.fill(0);
            const residues = sequences[s].residues;
            const total = isProtein
                ? countReduced(residues, k, counts)
                : countNucleotide(residues, k, counts, dimensions - 1);
            const offset = s * dimensions;
            if (total > 0) {
                // L2 normalise directly from counts.
                let norm = 0;
                for (let d = 0; d < dimensions; d += 1)
                    norm += counts[d] * counts[d];
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let d = 0; d < dimensions; d += 1)
                        vectors[offset + d] = counts[d] / norm;
                }
            }
            if (options.onProgress && (s & 63) === 0) {
                if (options.onProgress(s + 1, sequences.length) === false)
                    break;
            }
        }
        options.onProgress?.(sequences.length, sequences.length);
        return { vectors, dimensions, notes };
    }
}
function countNucleotide(residues, k, counts, mask) {
    let code = 0;
    let valid = 0;
    let total = 0;
    for (let i = 0; i < residues.length; i += 1) {
        const charCode = residues.charCodeAt(i);
        const base = charCode < 128 ? BASE_CODE[charCode] : 255;
        if (base === 255) {
            valid = 0;
            code = 0;
            continue;
        }
        code = (((code << 2) | base) & mask) >>> 0;
        if (valid < k)
            valid += 1;
        if (valid < k)
            continue;
        counts[code] += 1;
        total += 1;
    }
    return total;
}
function countReduced(residues, k, counts) {
    // Rolling base-10 code: multiplying by 10 and taking the modulus keeps only
    // the last k reduced-alphabet symbols, the same trick as the 2-bit
    // nucleotide window but with a non-power-of-two alphabet.
    const modulus = REDUCED_SIZE ** k;
    let code = 0;
    let valid = 0;
    let total = 0;
    for (let i = 0; i < residues.length; i += 1) {
        const charCode = residues.charCodeAt(i);
        const group = charCode < 128 ? REDUCED_TABLE[charCode] : 255;
        if (group === 255) {
            valid = 0;
            code = 0;
            continue;
        }
        code = (code * REDUCED_SIZE + group) % modulus;
        if (valid < k)
            valid += 1;
        if (valid < k)
            continue;
        counts[code] += 1;
        total += 1;
    }
    return total;
}
