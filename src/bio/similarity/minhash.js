import { BASE_CODE } from '../alphabets';
import { canonicalCode } from '../kmer/counter';
import { mix32 } from '../parsers/hash';
/** Fixed-capacity max-heap used to retain the smallest values seen. */
class BottomK {
    heap = [];
    seen = new Set();
    capacity;
    constructor(capacity) {
        this.capacity = capacity;
    }
    offer(value) {
        if (this.seen.has(value))
            return;
        if (this.heap.length < this.capacity) {
            this.seen.add(value);
            this.heap.push(value);
            this.siftUp(this.heap.length - 1);
            return;
        }
        if (value >= this.heap[0])
            return;
        this.seen.delete(this.heap[0]);
        this.seen.add(value);
        this.heap[0] = value;
        this.siftDown(0);
    }
    siftUp(start) {
        let i = start;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.heap[parent] >= this.heap[i])
                break;
            [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
            i = parent;
        }
    }
    siftDown(start) {
        let i = start;
        const n = this.heap.length;
        while (true) {
            const left = 2 * i + 1;
            const right = left + 1;
            let largest = i;
            if (left < n && this.heap[left] > this.heap[largest])
                largest = left;
            if (right < n && this.heap[right] > this.heap[largest])
                largest = right;
            if (largest === i)
                break;
            [this.heap[largest], this.heap[i]] = [this.heap[i], this.heap[largest]];
            i = largest;
        }
    }
    drainSorted() {
        const out = Uint32Array.from(this.heap);
        out.sort();
        return out;
    }
}
/**
 * Builds a sketch from a nucleotide sequence.
 *
 * k-mers are canonicalised (each k-mer and its reverse complement collapse to
 * one value) so that two reads sampled from opposite strands of the same locus
 * sketch identically. Windows containing an ambiguous base are skipped.
 */
export function sketchNucleotide(residues, k, size) {
    const bottom = new BottomK(size);
    const mask = (4 ** k - 1) >>> 0;
    let code = 0;
    let valid = 0;
    let kmerCount = 0;
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
        bottom.offer(mix32(canonicalCode(code, k)));
        kmerCount += 1;
    }
    return { hashes: bottom.drainSorted(), k, kmerCount };
}
/** Builds a sketch from a protein sequence using substring k-mers. */
export function sketchProtein(residues, k, size) {
    const bottom = new BottomK(size);
    let kmerCount = 0;
    for (let i = 0; i + k <= residues.length; i += 1) {
        let hash = 0x811c9dc5;
        for (let j = 0; j < k; j += 1) {
            hash = (Math.imul(hash ^ residues.charCodeAt(i + j), 16777619) >>> 0);
        }
        bottom.offer(mix32(hash));
        kmerCount += 1;
    }
    return { hashes: bottom.drainSorted(), k, kmerCount };
}
/**
 * Estimates Jaccard similarity from two bottom-k sketches.
 *
 * The union's `s` smallest distinct hashes are enumerated by merging the two
 * sorted sketches, and the estimate is the fraction of those that appear in
 * both. `s` is the smaller of the two sketch sizes, so short sequences with
 * under-filled sketches are compared on the hashes they actually have.
 *
 * The standard error of the estimate is roughly `sqrt(j * (1 - j) / s)`, which
 * at the default sketch size of 128 is about 0.044 at j = 0.5. The estimate is
 * therefore useful for clustering and screening, not for reporting a precise
 * identity; that is what the optional alignment refinement step is for.
 */
export function estimateJaccard(a, b) {
    const ah = a.hashes;
    const bh = b.hashes;
    if (ah.length === 0 || bh.length === 0)
        return 0;
    const limit = Math.min(ah.length, bh.length);
    let i = 0;
    let j = 0;
    let considered = 0;
    let shared = 0;
    while (considered < limit && (i < ah.length || j < bh.length)) {
        if (i < ah.length && (j >= bh.length || ah[i] < bh[j])) {
            i += 1;
            considered += 1;
        }
        else if (j < bh.length && (i >= ah.length || bh[j] < ah[i])) {
            j += 1;
            considered += 1;
        }
        else {
            // Equal values present in both sketches.
            i += 1;
            j += 1;
            shared += 1;
            considered += 1;
        }
    }
    return considered === 0 ? 0 : shared / considered;
}
/**
 * Mash distance: the expected substitution rate implied by a Jaccard estimate.
 *
 * `d = -(1/k) * ln(2j / (1 + j))`. This converts a k-mer set overlap into
 * something closer to a mutation rate, which is more linear in divergence than
 * raw Jaccard over the range that matters for clustering.
 */
export function mashDistance(jaccard, k) {
    if (jaccard <= 0)
        return 1;
    if (jaccard >= 1)
        return 0;
    return Math.min(1, -(1 / k) * Math.log((2 * jaccard) / (1 + jaccard)));
}
/** Exact Jaccard over full k-mer sets. Used to validate the sketch estimate. */
export function exactJaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    let intersection = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const value of small) {
        if (large.has(value))
            intersection += 1;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
/** Full canonical k-mer set for a sequence, for exact comparison. */
export function kmerSet(residues, k) {
    const set = new Set();
    const mask = (4 ** k - 1) >>> 0;
    let code = 0;
    let valid = 0;
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
        set.add(canonicalCode(code, k));
    }
    return set;
}
