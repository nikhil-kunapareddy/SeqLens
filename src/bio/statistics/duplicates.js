import { formatHash } from '../parsers/hash';
/**
 * Groups sequences that share a residue hash.
 *
 * Rather than a `Map` keyed by a composite string (which would allocate one
 * key string and one array per sequence), this sorts a permutation of indices
 * by the hash pair and walks the runs. For ten million sequences that is one
 * 40 MB typed array and a single sort, instead of tens of millions of
 * short-lived objects.
 *
 * Sequences of length 0 are excluded: every empty record hashes identically,
 * and reporting them as mutual duplicates hides the real finding, which is that
 * the records are empty.
 */
export function findDuplicateCandidates(hashLow, hashHigh, lengths) {
    const n = lengths.length;
    const order = new Uint32Array(n);
    let kept = 0;
    for (let i = 0; i < n; i += 1) {
        if (lengths[i] > 0)
            order[kept++] = i;
    }
    const active = order.subarray(0, kept);
    // Uint32Array.prototype.sort accepts a comparator and sorts in place.
    active.sort((a, b) => {
        const highDiff = hashHigh[a] - hashHigh[b];
        if (highDiff !== 0)
            return highDiff;
        const lowDiff = hashLow[a] - hashLow[b];
        if (lowDiff !== 0)
            return lowDiff;
        return a - b;
    });
    const runs = [];
    let runStart = 0;
    for (let i = 1; i <= kept; i += 1) {
        const isBoundary = i === kept ||
            hashHigh[active[i]] !== hashHigh[active[runStart]] ||
            hashLow[active[i]] !== hashLow[active[runStart]];
        if (isBoundary) {
            if (i - runStart > 1)
                runs.push({ start: runStart, end: i });
            runStart = i;
        }
    }
    return { order: active, runs };
}
/**
 * Confirms candidate duplicate groups by comparing residues.
 *
 * `getResidues` is called only for indices inside a candidate group, which for
 * typical data is a small fraction of the dataset. Confirming rather than
 * trusting the hash means a 64-bit collision costs one string comparison
 * instead of producing a wrong duplicate count.
 */
export function confirmDuplicates(candidates, hashLow, hashHigh, lengths, getId, getResidues, options = {}) {
    const maxGroups = options.maxGroups ?? 500;
    const maxIds = options.maxIdsPerGroup ?? 20;
    const groups = [];
    const redundantIndices = new Set();
    const copiesHistogram = new Map();
    let duplicateSequences = 0;
    let duplicateGroups = 0;
    let hashCollisions = 0;
    for (const run of candidates.runs) {
        // Partition the run into exact-match buckets keyed by residue string.
        const buckets = new Map();
        for (let i = run.start; i < run.end; i += 1) {
            const index = candidates.order[i];
            const residues = getResidues(index);
            const bucket = buckets.get(residues);
            if (bucket)
                bucket.push(index);
            else
                buckets.set(residues, [index]);
        }
        if (buckets.size > 1)
            hashCollisions += buckets.size - 1;
        for (const [residues, indices] of buckets) {
            if (indices.length < 2)
                continue;
            indices.sort((a, b) => a - b);
            duplicateGroups += 1;
            duplicateSequences += indices.length - 1;
            for (let i = 1; i < indices.length; i += 1)
                redundantIndices.add(indices[i]);
            const bin = copiesHistogram.get(indices.length) ?? { groups: 0, sequences: 0 };
            bin.groups += 1;
            bin.sequences += indices.length;
            copiesHistogram.set(indices.length, bin);
            if (groups.length < maxGroups) {
                const representative = indices[0];
                groups.push({
                    hash: formatHash({ low: hashLow[representative], high: hashHigh[representative] }),
                    count: indices.length,
                    length: residues.length || lengths[representative],
                    ids: indices.slice(0, maxIds).map(getId),
                    representativeIndex: representative,
                });
            }
        }
    }
    groups.sort((a, b) => b.count - a.count || b.length - a.length);
    const histogram = [...copiesHistogram.entries()]
        .map(([copies, value]) => ({ copies, groups: value.groups, sequences: value.sequences }))
        .sort((a, b) => a.copies - b.copies);
    return {
        groups,
        duplicateSequences,
        duplicateGroups,
        redundantIndices,
        hashCollisions,
        histogram,
    };
}
/** Unique-sequence percentage from a total and a redundant-copy count. */
export const uniquePercent = (total, duplicateSequences) => total === 0 ? 0 : ((total - duplicateSequences) / total) * 100;
