import { entropyFromMap } from '../statistics/entropy';
import { alignPairwise } from './pairwise';
/**
 * Center-star progressive multiple alignment.
 *
 * Every sequence is aligned to one central sequence, and the pairwise results
 * are then merged into a single layout by taking, at each centre position, the
 * maximum number of insertions any pairwise alignment placed there.
 *
 * This is a real and well-defined heuristic with a known guarantee (the sum-of-
 * pairs cost is within a factor of 2 of optimal), and it needs only n-1
 * alignments rather than the n^2 of an all-pairs guide tree. It is not
 * profile-based progressive alignment: a column that is gapped in the centre
 * carries no information about how the non-centre residues relate to each
 * other, so divergent sets align less accurately than they would under
 * MAFFT or MUSCLE. SeqLens reports the method used alongside every result so
 * this limitation is visible rather than implied.
 *
 * `onProgress` is called after each pairwise alignment so a worker can report
 * progress and check for cancellation.
 */
export function alignMultiple(sequences, options, centerHint, onProgress) {
    if (sequences.length === 0) {
        return { rows: [], centerRow: -1, alignmentLength: 0, score: 0, meanPairwiseIdentity: 0 };
    }
    if (sequences.length === 1) {
        const only = sequences[0];
        return {
            rows: [{ id: only.id, index: only.index, aligned: only.residues }],
            centerRow: 0,
            alignmentLength: only.residues.length,
            score: 0,
            meanPairwiseIdentity: 1,
        };
    }
    const centerRow = centerHint ?? pickCenterByLength(sequences);
    const center = sequences[centerRow];
    const centerLength = center.residues.length;
    // insertionsBefore[j] holds, for each centre position j (0..centerLength),
    // the residues each other sequence inserts immediately before it.
    const perSequence = [];
    let totalScore = 0;
    let identitySum = 0;
    let completed = 0;
    for (let s = 0; s < sequences.length; s += 1) {
        if (s === centerRow) {
            perSequence.push({ insertions: [], alignedTo: [] });
            continue;
        }
        const pair = alignPairwise(center.residues, sequences[s].residues, options);
        totalScore += pair.score;
        identitySum += pair.identity;
        const insertions = Array.from({ length: centerLength + 1 }, () => []);
        const alignedTo = new Array(centerLength).fill('-');
        let centerPos = 0;
        for (let k = 0; k < pair.alignedA.length; k += 1) {
            const centreChar = pair.alignedA[k];
            const otherChar = pair.alignedB[k];
            if (centreChar === '-') {
                insertions[centerPos].push(otherChar);
            }
            else {
                alignedTo[centerPos] = otherChar;
                centerPos += 1;
            }
        }
        perSequence.push({ insertions, alignedTo });
        completed += 1;
        onProgress?.(completed, sequences.length - 1);
    }
    // Merged layout: how many insertion columns to reserve before each centre position.
    const reserved = new Uint32Array(centerLength + 1);
    for (let s = 0; s < sequences.length; s += 1) {
        if (s === centerRow)
            continue;
        const { insertions } = perSequence[s];
        for (let j = 0; j <= centerLength; j += 1) {
            if (insertions[j].length > reserved[j])
                reserved[j] = insertions[j].length;
        }
    }
    let alignmentLength = centerLength;
    for (let j = 0; j <= centerLength; j += 1)
        alignmentLength += reserved[j];
    const rows = sequences.map((sequence, s) => {
        const parts = [];
        if (s === centerRow) {
            for (let j = 0; j < centerLength; j += 1) {
                if (reserved[j] > 0)
                    parts.push('-'.repeat(reserved[j]));
                parts.push(center.residues[j]);
            }
            if (reserved[centerLength] > 0)
                parts.push('-'.repeat(reserved[centerLength]));
        }
        else {
            const { insertions, alignedTo } = perSequence[s];
            for (let j = 0; j < centerLength; j += 1) {
                if (reserved[j] > 0) {
                    const inserted = insertions[j];
                    parts.push(inserted.join(''));
                    if (inserted.length < reserved[j]) {
                        parts.push('-'.repeat(reserved[j] - inserted.length));
                    }
                }
                parts.push(alignedTo[j]);
            }
            if (reserved[centerLength] > 0) {
                const inserted = insertions[centerLength];
                parts.push(inserted.join(''));
                if (inserted.length < reserved[centerLength]) {
                    parts.push('-'.repeat(reserved[centerLength] - inserted.length));
                }
            }
        }
        return { id: sequence.id, index: sequence.index, aligned: parts.join('') };
    });
    return {
        rows,
        centerRow,
        alignmentLength,
        score: totalScore,
        meanPairwiseIdentity: sequences.length > 1 ? identitySum / (sequences.length - 1) : 1,
    };
}
/**
 * Picks the centre as the sequence closest to the median length.
 *
 * A proper centre is the medoid under pairwise distance, but finding it costs
 * the n^2 alignments this method exists to avoid. The median-length sequence is
 * a cheap stand-in that avoids the real failure mode, which is choosing an
 * outlier: anchoring on the shortest sequence truncates the alignment, and
 * anchoring on the longest pads every other row with gaps.
 */
export function pickCenterByLength(sequences) {
    const order = sequences
        .map((sequence, index) => ({ index, length: sequence.residues.length }))
        .sort((a, b) => a.length - b.length);
    return order[Math.floor(order.length / 2)].index;
}
/**
 * Per-column consensus, conservation, and gap statistics.
 *
 * Conservation is the frequency of the most common non-gap residue among the
 * non-gap residues in that column, so a column with two residues and
 * forty-eight gaps can still be 100% conserved. `gapFraction` is reported
 * separately precisely so that case is visible rather than hidden inside one
 * blended score.
 *
 * A column whose top residue does not reach `consensusThreshold` is called as
 * 'N' for nucleotides or 'X' for protein rather than reporting a plurality
 * residue as though it were settled.
 */
export function analyzeColumns(rows, consensusThreshold, conservedThreshold, ambiguousSymbol = 'N') {
    const length = rows.length === 0 ? 0 : rows[0].aligned.length;
    const columns = [];
    const consensusChars = [];
    let totalGaps = 0;
    for (let position = 0; position < length; position += 1) {
        const counts = new Map();
        let gaps = 0;
        for (const row of rows) {
            const residue = row.aligned[position];
            if (residue === '-' || residue === '.' || residue === undefined) {
                gaps += 1;
                continue;
            }
            counts.set(residue, (counts.get(residue) ?? 0) + 1);
        }
        totalGaps += gaps;
        const nonGap = rows.length - gaps;
        let topResidue = ambiguousSymbol;
        let topCount = 0;
        for (const [residue, count] of counts) {
            if (count > topCount) {
                topCount = count;
                topResidue = residue;
            }
        }
        const conservation = nonGap === 0 ? 0 : topCount / nonGap;
        const consensus = nonGap === 0 ? '-' : conservation >= consensusThreshold ? topResidue : ambiguousSymbol;
        consensusChars.push(consensus);
        columns.push({
            position: position + 1,
            consensus,
            conservation,
            gapFraction: rows.length === 0 ? 0 : gaps / rows.length,
            entropy: entropyFromMap(counts),
        });
    }
    return {
        columns,
        consensus: consensusChars.join(''),
        conservedRegions: mergeRegions(columns, (c) => c.conservation >= conservedThreshold),
        variableRegions: mergeRegions(columns, (c) => c.conservation < conservedThreshold),
        gapFraction: length === 0 || rows.length === 0 ? 0 : totalGaps / (length * rows.length),
    };
}
/** Merges consecutive columns satisfying a predicate into runs. */
function mergeRegions(columns, predicate, minLength = 3) {
    const regions = [];
    let start = -1;
    let sum = 0;
    let count = 0;
    const close = (endIndex) => {
        if (start === -1)
            return;
        if (count >= minLength) {
            regions.push({
                start: columns[start].position,
                end: columns[endIndex].position,
                meanConservation: sum / count,
            });
        }
        start = -1;
        sum = 0;
        count = 0;
    };
    for (let i = 0; i < columns.length; i += 1) {
        if (predicate(columns[i])) {
            if (start === -1)
                start = i;
            sum += columns[i].conservation;
            count += 1;
        }
        else {
            close(i - 1);
        }
    }
    close(columns.length - 1);
    return regions;
}
/**
 * Calls variants relative to a reference row of the alignment.
 *
 * Because the coordinates are alignment columns rather than reference
 * positions, an insertion is a column where the reference is gapped and a
 * deletion is a column where the reference has a residue and the sample does
 * not. Consecutive columns of the same variant class are not merged into single
 * multi-base events: this is a per-column tabulation, not a VCF.
 */
export function callVariants(rows, referenceRow, maxVariants = 2000, maxIdsPerVariant = 12) {
    if (rows.length === 0 || referenceRow < 0 || referenceRow >= rows.length) {
        return { variants: [], substitutions: 0, insertions: 0, deletions: 0 };
    }
    const reference = rows[referenceRow].aligned;
    const variants = [];
    let substitutions = 0;
    let insertions = 0;
    let deletions = 0;
    for (let position = 0; position < reference.length; position += 1) {
        const refChar = reference[position];
        const observed = new Map();
        for (let r = 0; r < rows.length; r += 1) {
            if (r === referenceRow)
                continue;
            const char = rows[r].aligned[position];
            if (char === undefined || char === refChar)
                continue;
            const ids = observed.get(char);
            if (ids)
                ids.push(rows[r].id);
            else
                observed.set(char, [rows[r].id]);
        }
        for (const [char, ids] of observed) {
            const isGapInRef = refChar === '-' || refChar === '.';
            const isGapInSample = char === '-' || char === '.';
            let kind;
            if (isGapInRef) {
                kind = 'insertion';
                insertions += ids.length;
            }
            else if (isGapInSample) {
                kind = 'deletion';
                deletions += ids.length;
            }
            else {
                kind = 'substitution';
                substitutions += ids.length;
            }
            if (variants.length < maxVariants) {
                variants.push({
                    column: position + 1,
                    kind,
                    reference: refChar,
                    observed: char,
                    count: ids.length,
                    sequenceIds: ids.slice(0, maxIdsPerVariant),
                });
            }
        }
    }
    return { variants, substitutions, insertions, deletions };
}
/** Mean pairwise identity over every pair of rows in an alignment. */
export function meanPairwiseIdentity(rows) {
    if (rows.length < 2)
        return 1;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
            const a = rows[i].aligned;
            const b = rows[j].aligned;
            let matches = 0;
            let compared = 0;
            for (let k = 0; k < a.length; k += 1) {
                const ca = a[k];
                const cb = b[k];
                if (ca === '-' && cb === '-')
                    continue;
                compared += 1;
                if (ca === cb)
                    matches += 1;
            }
            sum += compared === 0 ? 0 : matches / compared;
            pairs += 1;
        }
    }
    return pairs === 0 ? 1 : sum / pairs;
}
