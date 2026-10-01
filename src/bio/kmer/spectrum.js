import { decodeKmer, iterateCounts, } from './counter';
/**
 * Selects the `topN` largest entries without sorting the whole table.
 *
 * At k = 11 the dense table has four million slots; a full sort would dominate
 * the runtime and produce four million objects. A bounded insertion buffer
 * keeps allocation proportional to `topN` instead.
 */
class TopN {
    items = [];
    threshold = 0;
    limit;
    constructor(limit) {
        this.limit = limit;
    }
    offer(value, count) {
        if (this.items.length >= this.limit && count <= this.threshold)
            return;
        this.items.push({ value, count });
        if (this.items.length > this.limit * 2)
            this.trim();
    }
    trim() {
        this.items.sort((a, b) => b.count - a.count);
        this.items.length = Math.min(this.items.length, this.limit);
        this.threshold = this.items.length > 0 ? this.items[this.items.length - 1].count : 0;
    }
    drain() {
        this.items.sort((a, b) => b.count - a.count);
        return this.items.slice(0, this.limit);
    }
}
/** Builds a reportable spectrum from packed nucleotide k-mer counts. */
export function buildNucleotideSpectrum(counts, options) {
    const { k, total, canonical } = counts;
    const rareSampleSize = options.rareSampleSize ?? 200;
    const top = new TopN(options.topN);
    const rare = [];
    let rareCount = 0;
    let distinct = 0;
    // Entropy is accumulated in the same pass: the k-mer total is already known,
    // so each term can be added immediately instead of buffering four million
    // counts to hand to a second function.
    let entropy = 0;
    for (const [code, count] of iterateCounts(counts)) {
        top.offer(code, count);
        distinct += 1;
        if (total > 0) {
            const p = count / total;
            entropy -= p * Math.log2(p);
        }
        if (count <= options.rareMaxCount) {
            rareCount += 1;
            if (rare.length < rareSampleSize) {
                rare.push({
                    kmer: decodeKmer(code, k),
                    count,
                    frequency: total === 0 ? 0 : count / total,
                });
            }
        }
    }
    const possible = canonical ? Math.ceil(4 ** k / 2) : 4 ** k;
    return {
        k,
        distinct,
        total,
        possible,
        entropy,
        normalizedEntropy: possible <= 1 ? 0 : entropy / Math.log2(possible),
        top: top.drain().map(({ value, count }) => ({
            kmer: decodeKmer(value, k),
            count,
            frequency: total === 0 ? 0 : count / total,
        })),
        rare: rare.sort((a, b) => a.count - b.count || a.kmer.localeCompare(b.kmer)),
        rareCount,
        exact: counts.dense !== null,
        canonical,
    };
}
/** Builds a reportable spectrum from string-keyed (protein) k-mer counts. */
export function buildStringSpectrum(counts, options, alphabetSize = 20) {
    const { k, total } = counts;
    const rareSampleSize = options.rareSampleSize ?? 200;
    const top = new TopN(options.topN);
    const rare = [];
    let rareCount = 0;
    let entropy = 0;
    for (const [kmer, count] of counts.counts) {
        top.offer(kmer, count);
        if (total > 0) {
            const p = count / total;
            entropy -= p * Math.log2(p);
        }
        if (count <= options.rareMaxCount) {
            rareCount += 1;
            if (rare.length < rareSampleSize) {
                rare.push({ kmer, count, frequency: total === 0 ? 0 : count / total });
            }
        }
    }
    const possible = alphabetSize ** k;
    return {
        k,
        distinct: counts.counts.size,
        total,
        possible,
        entropy,
        normalizedEntropy: possible <= 1 ? 0 : entropy / Math.log2(possible),
        top: top.drain().map(({ value, count }) => ({
            kmer: value,
            count,
            frequency: total === 0 ? 0 : count / total,
        })),
        rare: rare.sort((a, b) => a.count - b.count || a.kmer.localeCompare(b.kmer)),
        rareCount,
        exact: true,
        canonical: false,
    };
}
/**
 * Normalised k-mer frequency vector, used as a deterministic sequence
 * embedding and as a distance function for clustering.
 *
 * The vector is L2-normalised so that sequences of very different lengths are
 * comparable: without it, vector magnitude tracks sequence length and
 * dominates every distance calculation.
 */
export function kmerFrequencyVector(counts) {
    const size = 4 ** counts.k;
    const vector = new Float32Array(size);
    if (counts.dense !== null) {
        const dense = counts.dense;
        for (let i = 0; i < size; i += 1)
            vector[i] = dense[i];
    }
    else {
        for (const [code, count] of counts.sparse)
            vector[code] = count;
    }
    let norm = 0;
    for (let i = 0; i < size; i += 1)
        norm += vector[i] * vector[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < size; i += 1)
            vector[i] /= norm;
    }
    return vector;
}
