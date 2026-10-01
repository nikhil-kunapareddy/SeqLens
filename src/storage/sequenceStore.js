import { db } from './db';
/**
 * Block-level read cache.
 *
 * The sequence explorer scrolls through one dataset a few hundred rows at a
 * time, so the same block is requested repeatedly. Caching by block rather than
 * by sequence keeps the hit rate high while bounding memory by residue count:
 * the cache evicts least-recently-used blocks once the total residues held
 * exceeds the budget.
 */
class BlockCache {
    entries = new Map();
    residuesHeld = 0;
    budget;
    constructor(budget = 24_000_000) {
        this.budget = budget;
    }
    key(datasetId, blockIndex) {
        return `${datasetId}#${blockIndex}`;
    }
    get(datasetId, blockIndex) {
        const key = this.key(datasetId, blockIndex);
        const block = this.entries.get(key);
        if (block === undefined)
            return undefined;
        // Re-insert to mark as most recently used.
        this.entries.delete(key);
        this.entries.set(key, block);
        return block;
    }
    set(block) {
        const key = this.key(block.datasetId, block.blockIndex);
        if (this.entries.has(key))
            return;
        this.entries.set(key, block);
        this.residuesHeld += block.residues.length;
        this.evict();
    }
    evict() {
        while (this.residuesHeld > this.budget && this.entries.size > 1) {
            const oldest = this.entries.keys().next();
            if (oldest.done)
                break;
            const evicted = this.entries.get(oldest.value);
            this.entries.delete(oldest.value);
            if (evicted)
                this.residuesHeld -= evicted.residues.length;
        }
    }
    invalidate(datasetId) {
        if (datasetId === undefined) {
            this.entries.clear();
            this.residuesHeld = 0;
            return;
        }
        for (const [key, block] of [...this.entries]) {
            if (block.datasetId === datasetId) {
                this.entries.delete(key);
                this.residuesHeld -= block.residues.length;
            }
        }
    }
    setBudget(residues) {
        this.budget = Math.max(1_000_000, residues);
        this.evict();
    }
    get stats() {
        return { blocks: this.entries.size, residues: this.residuesHeld, budget: this.budget };
    }
}
export const blockCache = new BlockCache();
const blockMapCache = new Map();
async function loadBlockMap(datasetId) {
    const cached = blockMapCache.get(datasetId);
    if (cached)
        return cached;
    const map = await db.blockMaps.get(datasetId);
    if (!map)
        return null;
    const entry = { starts: map.starts, counts: map.counts };
    blockMapCache.set(datasetId, entry);
    return entry;
}
export function invalidateSequenceCaches(datasetId) {
    blockCache.invalidate(datasetId);
    if (datasetId === undefined)
        blockMapCache.clear();
    else
        blockMapCache.delete(datasetId);
}
/** Binary search for the block containing a global sequence index. */
function findBlock(starts, counts, index) {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const start = starts[mid];
        if (index < start) {
            high = mid - 1;
        }
        else if (index >= start + counts[mid]) {
            low = mid + 1;
        }
        else {
            return mid;
        }
    }
    return -1;
}
async function getBlock(datasetId, blockIndex) {
    const cached = blockCache.get(datasetId, blockIndex);
    if (cached)
        return cached;
    const block = await db.blocks.where('[datasetId+blockIndex]').equals([datasetId, blockIndex]).first();
    if (block)
        blockCache.set(block);
    return block;
}
/** Materialises one sequence from a loaded block. */
function sequenceFromBlock(block, globalIndex) {
    const local = globalIndex - block.startIndex;
    const from = block.offsets[local];
    const to = block.offsets[local + 1];
    return {
        id: block.ids[local],
        description: block.descriptions[local] ?? '',
        residues: block.residues.slice(from, to),
        quality: block.quality === undefined ? undefined : block.quality.slice(from, to),
        index: globalIndex,
    };
}
/** Reads one sequence by its index within the dataset. */
export async function getSequence(datasetId, index) {
    const map = await loadBlockMap(datasetId);
    if (!map)
        return null;
    const blockIndex = findBlock(map.starts, map.counts, index);
    if (blockIndex === -1)
        return null;
    const block = await getBlock(datasetId, blockIndex);
    if (!block)
        return null;
    return sequenceFromBlock(block, index);
}
/**
 * Reads a contiguous range of sequences.
 *
 * Used by the virtualised sequence table, which asks for exactly the window it
 * is about to paint plus a small overscan.
 */
export async function getSequenceRange(datasetId, from, count) {
    if (count <= 0)
        return [];
    const map = await loadBlockMap(datasetId);
    if (!map)
        return [];
    const out = [];
    let index = from;
    const end = from + count;
    while (index < end) {
        const blockIndex = findBlock(map.starts, map.counts, index);
        if (blockIndex === -1)
            break;
        const block = await getBlock(datasetId, blockIndex);
        if (!block)
            break;
        const blockEnd = block.startIndex + block.count;
        for (; index < Math.min(end, blockEnd); index += 1) {
            out.push(sequenceFromBlock(block, index));
        }
    }
    return out;
}
/** Reads a specific set of sequence indices, ordered by index for locality. */
export async function getSequencesByIndices(datasetId, indices) {
    const map = await loadBlockMap(datasetId);
    if (!map)
        return [];
    // Sorting by index means each block is loaded at most once.
    const ordered = [...indices].sort((a, b) => a - b);
    const byIndex = new Map();
    let currentBlockIndex = -1;
    let currentBlock;
    for (const index of ordered) {
        const blockIndex = findBlock(map.starts, map.counts, index);
        if (blockIndex === -1)
            continue;
        if (blockIndex !== currentBlockIndex) {
            currentBlock = await getBlock(datasetId, blockIndex);
            currentBlockIndex = blockIndex;
        }
        if (currentBlock)
            byIndex.set(index, sequenceFromBlock(currentBlock, index));
    }
    // Return in the caller's requested order.
    return indices.map((index) => byIndex.get(index)).filter((s) => s !== undefined);
}
/**
 * Streams every block of a dataset in order.
 *
 * This is the primitive every analysis job uses. Blocks are fetched one at a
 * time and are not cached, because a full pass would otherwise evict the whole
 * explorer cache for no benefit: an analysis touches each block exactly once.
 *
 * Returning `false` from `visit` stops the walk, which is how cancellation
 * propagates into a running job.
 */
export async function forEachBlock(datasetId, visit) {
    const map = await loadBlockMap(datasetId);
    if (!map)
        return { blocksVisited: 0, sequencesVisited: 0, completed: true };
    const totalBlocks = map.starts.length;
    let sequencesSoFar = 0;
    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
        const block = await db.blocks
            .where('[datasetId+blockIndex]')
            .equals([datasetId, blockIndex])
            .first();
        if (!block)
            continue;
        sequencesSoFar += block.count;
        const outcome = await visit({ block, blockIndex, totalBlocks, sequencesSoFar });
        if (outcome === false) {
            return { blocksVisited: blockIndex + 1, sequencesVisited: sequencesSoFar, completed: false };
        }
    }
    return { blocksVisited: totalBlocks, sequencesVisited: sequencesSoFar, completed: true };
}
/** Iterates individual sequences within a block without allocating objects. */
export function eachSequenceInBlock(block, visit) {
    for (let local = 0; local < block.count; local += 1) {
        const from = block.offsets[local];
        const to = block.offsets[local + 1];
        const residues = block.residues.slice(from, to);
        const quality = block.quality === undefined ? undefined : block.quality.slice(from, to);
        if (visit(block.startIndex + local, residues, block.ids[local], quality) === false) {
            return false;
        }
    }
    return true;
}
/** Reads the identifier at a given index from the dataset's compact index. */
export function idFromIndex(index, position) {
    if (position < 0 || position >= index.count)
        return '';
    return index.idBlob.slice(index.idOffsets[position], index.idOffsets[position + 1]);
}
/** Materialises every identifier. Only for small datasets or exports. */
export function allIds(index) {
    const ids = new Array(index.count);
    for (let i = 0; i < index.count; i += 1) {
        ids[i] = index.idBlob.slice(index.idOffsets[i], index.idOffsets[i + 1]);
    }
    return ids;
}
/**
 * GC percentage of one sequence, from the compact index.
 *
 * The denominator excludes ambiguous residues, matching `gcContent`, so a
 * scaffold padded with N is not pulled toward 50%.
 */
export function gcPercentFromIndex(index, position) {
    const length = index.lengths[position];
    const unambiguous = length - index.ambiguousCounts[position];
    return unambiguous <= 0 ? 0 : (index.gcCounts[position] / unambiguous) * 100;
}
