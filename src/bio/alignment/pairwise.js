/** Traceback bit layout, one byte per cell. */
const FROM_M = 0; // bits 0-1 of M's pointer
const PTR_MASK = 0b11;
const IX_FROM_IX = 0b100; // bit 2: Ix extended rather than opened
const IY_FROM_IY = 0b1000; // bit 3: Iy extended rather than opened
const M_IS_START = 0b10000; // bit 4: local alignment starts here
const NEG_INF = -1e18;
/**
 * Gotoh affine-gap alignment with full traceback.
 *
 * Three score rows are maintained - M (residues aligned), Ix (gap in B), and
 * Iy (gap in A) - which gives affine gap costs, where a gap of length L costs
 * `gapOpen + L * gapExtend`. A single linear gap penalty would score one long
 * indel the same as many scattered single-base gaps, which is wrong for
 * biological sequence: indels arise as events, not per base.
 *
 * Scores use two rolling rows, so score memory is O(n). Traceback needs one
 * byte per cell, so memory is O(m*n) bytes - 36 MB for two 6 kb sequences. The
 * caller is responsible for enforcing a length cap; `estimateMemoryBytes` gives
 * the figure to check against.
 */
export function alignPairwise(a, b, options) {
    const m = a.length;
    const n = b.length;
    const { mode, matrix, gapOpen, gapExtend } = options;
    const openCost = gapOpen + gapExtend;
    const local = mode === 'local';
    if (m === 0 || n === 0) {
        return emptyAlignment(a, b, local ? 0 : -(gapOpen + Math.max(m, n) * gapExtend));
    }
    const width = n + 1;
    const trace = new Uint8Array((m + 1) * width);
    let prevM = new Float64Array(width);
    let prevIx = new Float64Array(width);
    let prevIy = new Float64Array(width);
    let currM = new Float64Array(width);
    let currIx = new Float64Array(width);
    let currIy = new Float64Array(width);
    // Row 0 initialisation.
    if (local) {
        // M is zero everywhere in row 0 and both gap states are unreachable, so a
        // local alignment can only begin at the zero-clamped M state. Leaving Iy at
        // 0 here would silently allow cost-free leading gaps.
        prevM.fill(0);
        prevIx.fill(NEG_INF);
        prevIy.fill(NEG_INF);
    }
    else {
        prevM[0] = 0;
        prevIx[0] = NEG_INF;
        prevIy[0] = NEG_INF;
        for (let j = 1; j <= n; j += 1) {
            prevM[j] = NEG_INF;
            prevIx[j] = NEG_INF;
            prevIy[j] = -(openCost + (j - 1) * gapExtend);
            trace[j] |= IY_FROM_IY;
        }
        trace[1] &= ~IY_FROM_IY; // the first gap column opens rather than extends
    }
    const table = matrix.table;
    const fallback = matrix.fallback;
    let bestScore = local ? 0 : NEG_INF;
    let bestI = 0;
    let bestJ = 0;
    for (let i = 1; i <= m; i += 1) {
        const rowOffset = i * width;
        const aCode = a.charCodeAt(i - 1);
        const rowBase = aCode < 128 ? aCode * 128 : -1;
        if (local) {
            currM[0] = 0;
            currIx[0] = 0;
            currIy[0] = NEG_INF;
        }
        else {
            currM[0] = NEG_INF;
            currIx[0] = -(openCost + (i - 1) * gapExtend);
            currIy[0] = NEG_INF;
            if (i > 1)
                trace[rowOffset] |= IX_FROM_IX;
        }
        for (let j = 1; j <= n; j += 1) {
            const bCode = b.charCodeAt(j - 1);
            const s = rowBase >= 0 && bCode < 128 ? table[rowBase + bCode] : fallback;
            // M: extend the best of the three states diagonally.
            const diagM = prevM[j - 1];
            const diagIx = prevIx[j - 1];
            const diagIy = prevIy[j - 1];
            let bestDiag = diagM;
            let pointer = FROM_M;
            if (diagIx > bestDiag) {
                bestDiag = diagIx;
                pointer = 1;
            }
            if (diagIy > bestDiag) {
                bestDiag = diagIy;
                pointer = 2;
            }
            let mScore = bestDiag + s;
            let flags = pointer;
            if (local && mScore < 0) {
                mScore = 0;
                flags = M_IS_START;
            }
            currM[j] = mScore;
            // Ix: gap in B, consuming a[i-1].
            const openIx = prevM[j] - openCost;
            const extendIx = prevIx[j] - gapExtend;
            if (extendIx > openIx) {
                currIx[j] = extendIx;
                flags |= IX_FROM_IX;
            }
            else {
                currIx[j] = openIx;
            }
            // Iy: gap in A, consuming b[j-1].
            const openIy = currM[j - 1] - openCost;
            const extendIy = currIy[j - 1] - gapExtend;
            if (extendIy > openIy) {
                currIy[j] = extendIy;
                flags |= IY_FROM_IY;
            }
            else {
                currIy[j] = openIy;
            }
            trace[rowOffset + j] = flags;
            if (local && mScore > bestScore) {
                bestScore = mScore;
                bestI = i;
                bestJ = j;
            }
        }
        // Rotate the rolling rows.
        let swap = prevM;
        prevM = currM;
        currM = swap;
        swap = prevIx;
        prevIx = currIx;
        currIx = swap;
        swap = prevIy;
        prevIy = currIy;
        currIy = swap;
    }
    if (!local) {
        // Global alignment ends in the bottom-right corner, in whichever state scores best.
        bestI = m;
        bestJ = n;
        bestScore = Math.max(prevM[n], prevIx[n], prevIy[n]);
    }
    return traceback(a, b, trace, width, bestI, bestJ, bestScore, local, prevM, prevIx, prevIy);
}
function traceback(a, b, trace, width, startI, startJ, bestScore, local, lastM, lastIx, lastIy) {
    const outA = [];
    const outB = [];
    let i = startI;
    let j = startJ;
    let state = 0;
    if (!local) {
        const mEnd = lastM[j];
        const ixEnd = lastIx[j];
        const iyEnd = lastIy[j];
        state = mEnd >= ixEnd && mEnd >= iyEnd ? 0 : ixEnd >= iyEnd ? 1 : 2;
    }
    while (i > 0 || j > 0) {
        // A local alignment is bounded by the matrix interior: reaching an edge
        // means the traced region is complete. A global alignment, by contrast,
        // must keep going and pad the remainder with gaps.
        if (local && (i === 0 || j === 0))
            break;
        const flags = trace[i * width + j];
        if (state === 0) {
            if (i === 0) {
                state = 2;
                continue;
            }
            if (j === 0) {
                state = 1;
                continue;
            }
            if (local && (flags & M_IS_START) !== 0)
                break;
            outA.push(a[i - 1]);
            outB.push(b[j - 1]);
            const pointer = (flags & PTR_MASK);
            i -= 1;
            j -= 1;
            state = pointer;
            continue;
        }
        if (state === 1) {
            if (i === 0) {
                state = 2;
                continue;
            }
            outA.push(a[i - 1]);
            outB.push('-');
            const extended = (flags & IX_FROM_IX) !== 0;
            i -= 1;
            state = extended ? 1 : 0;
            continue;
        }
        // state === 2
        if (j === 0) {
            state = 1;
            continue;
        }
        outA.push('-');
        outB.push(b[j - 1]);
        const extended = (flags & IY_FROM_IY) !== 0;
        j -= 1;
        state = extended ? 2 : 0;
    }
    outA.reverse();
    outB.reverse();
    const alignedA = outA.join('');
    const alignedB = outB.join('');
    let matches = 0;
    let mismatches = 0;
    let gaps = 0;
    for (let k = 0; k < alignedA.length; k += 1) {
        const ca = alignedA[k];
        const cb = alignedB[k];
        if (ca === '-' || cb === '-')
            gaps += 1;
        else if (ca === cb)
            matches += 1;
        else
            mismatches += 1;
    }
    const scored = matches + mismatches + gaps;
    return {
        alignedA,
        alignedB,
        score: bestScore,
        length: alignedA.length,
        matches,
        mismatches,
        gaps,
        identity: scored === 0 ? 0 : matches / scored,
        aStart: i,
        aEnd: startI,
        bStart: j,
        bEnd: startJ,
    };
}
function emptyAlignment(a, b, score) {
    const alignedA = a.length > 0 ? a : '-'.repeat(b.length);
    const alignedB = b.length > 0 ? b : '-'.repeat(a.length);
    return {
        alignedA,
        alignedB,
        score,
        length: alignedA.length,
        matches: 0,
        mismatches: 0,
        gaps: alignedA.length,
        identity: 0,
        aStart: 0,
        aEnd: a.length,
        bStart: 0,
        bEnd: b.length,
    };
}
/** Traceback memory needed to align two sequences, in bytes. */
export const estimateMemoryBytes = (m, n) => (m + 1) * (n + 1);
/**
 * Percent identity of two sequences without materialising the alignment.
 *
 * Only the score rows are kept, so memory is O(min(m, n)) and no traceback
 * buffer is allocated. This is what the similarity module uses when refining
 * thousands of candidate pairs, where the aligned strings themselves are not
 * needed.
 */
export function alignmentIdentity(a, b, options) {
    const m = a.length;
    const n = b.length;
    if (m === 0 || n === 0)
        return { identity: 0, score: 0, alignedLength: Math.max(m, n) };
    const { matrix, gapOpen, gapExtend, mode } = options;
    const openCost = gapOpen + gapExtend;
    const local = mode === 'local';
    const width = n + 1;
    // Each state tracks score plus the match count and column count of the best
    // path reaching it, which yields identity without a traceback matrix.
    let prevM = new Float64Array(width);
    let prevIx = new Float64Array(width);
    let prevIy = new Float64Array(width);
    let prevMatchM = new Float64Array(width);
    let prevMatchIx = new Float64Array(width);
    let prevMatchIy = new Float64Array(width);
    let prevLenM = new Float64Array(width);
    let prevLenIx = new Float64Array(width);
    let prevLenIy = new Float64Array(width);
    let currM = new Float64Array(width);
    let currIx = new Float64Array(width);
    let currIy = new Float64Array(width);
    let currMatchM = new Float64Array(width);
    let currMatchIx = new Float64Array(width);
    let currMatchIy = new Float64Array(width);
    let currLenM = new Float64Array(width);
    let currLenIx = new Float64Array(width);
    let currLenIy = new Float64Array(width);
    if (local) {
        prevIx.fill(NEG_INF);
        prevIy.fill(NEG_INF);
    }
    else {
        prevM[0] = 0;
        prevIx[0] = NEG_INF;
        prevIy[0] = NEG_INF;
        for (let j = 1; j <= n; j += 1) {
            prevM[j] = NEG_INF;
            prevIx[j] = NEG_INF;
            prevIy[j] = -(openCost + (j - 1) * gapExtend);
            prevLenIy[j] = j;
        }
    }
    const table = matrix.table;
    const fallback = matrix.fallback;
    let bestScore = local ? 0 : NEG_INF;
    let bestMatches = 0;
    let bestLength = 0;
    for (let i = 1; i <= m; i += 1) {
        const aCode = a.charCodeAt(i - 1);
        const rowBase = aCode < 128 ? aCode * 128 : -1;
        if (local) {
            currM[0] = 0;
            currIx[0] = 0;
            currIy[0] = NEG_INF;
            currMatchM[0] = 0;
            currLenM[0] = 0;
            currMatchIx[0] = 0;
            currLenIx[0] = 0;
        }
        else {
            currM[0] = NEG_INF;
            currIx[0] = -(openCost + (i - 1) * gapExtend);
            currIy[0] = NEG_INF;
            currLenIx[0] = i;
            currMatchIx[0] = 0;
        }
        for (let j = 1; j <= n; j += 1) {
            const bCode = b.charCodeAt(j - 1);
            const s = rowBase >= 0 && bCode < 128 ? table[rowBase + bCode] : fallback;
            const isMatch = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 1 : 0;
            let bestDiag = prevM[j - 1];
            let diagMatches = prevMatchM[j - 1];
            let diagLength = prevLenM[j - 1];
            if (prevIx[j - 1] > bestDiag) {
                bestDiag = prevIx[j - 1];
                diagMatches = prevMatchIx[j - 1];
                diagLength = prevLenIx[j - 1];
            }
            if (prevIy[j - 1] > bestDiag) {
                bestDiag = prevIy[j - 1];
                diagMatches = prevMatchIy[j - 1];
                diagLength = prevLenIy[j - 1];
            }
            let mScore = bestDiag + s;
            let mMatches = diagMatches + isMatch;
            let mLength = diagLength + 1;
            if (local && mScore < 0) {
                mScore = 0;
                mMatches = 0;
                mLength = 0;
            }
            currM[j] = mScore;
            currMatchM[j] = mMatches;
            currLenM[j] = mLength;
            const openIx = prevM[j] - openCost;
            const extendIx = prevIx[j] - gapExtend;
            if (extendIx > openIx) {
                currIx[j] = extendIx;
                currMatchIx[j] = prevMatchIx[j];
                currLenIx[j] = prevLenIx[j] + 1;
            }
            else {
                currIx[j] = openIx;
                currMatchIx[j] = prevMatchM[j];
                currLenIx[j] = prevLenM[j] + 1;
            }
            const openIy = currM[j - 1] - openCost;
            const extendIy = currIy[j - 1] - gapExtend;
            if (extendIy > openIy) {
                currIy[j] = extendIy;
                currMatchIy[j] = currMatchIy[j - 1];
                currLenIy[j] = currLenIy[j - 1] + 1;
            }
            else {
                currIy[j] = openIy;
                currMatchIy[j] = currMatchM[j - 1];
                currLenIy[j] = currLenM[j - 1] + 1;
            }
            if (local && mScore > bestScore) {
                bestScore = mScore;
                bestMatches = mMatches;
                bestLength = mLength;
            }
        }
        [prevM, currM] = [currM, prevM];
        [prevIx, currIx] = [currIx, prevIx];
        [prevIy, currIy] = [currIy, prevIy];
        [prevMatchM, currMatchM] = [currMatchM, prevMatchM];
        [prevMatchIx, currMatchIx] = [currMatchIx, prevMatchIx];
        [prevMatchIy, currMatchIy] = [currMatchIy, prevMatchIy];
        [prevLenM, currLenM] = [currLenM, prevLenM];
        [prevLenIx, currLenIx] = [currLenIx, prevLenIx];
        [prevLenIy, currLenIy] = [currLenIy, prevLenIy];
    }
    if (!local) {
        const mEnd = prevM[n];
        const ixEnd = prevIx[n];
        const iyEnd = prevIy[n];
        if (mEnd >= ixEnd && mEnd >= iyEnd) {
            bestScore = mEnd;
            bestMatches = prevMatchM[n];
            bestLength = prevLenM[n];
        }
        else if (ixEnd >= iyEnd) {
            bestScore = ixEnd;
            bestMatches = prevMatchIx[n];
            bestLength = prevLenIx[n];
        }
        else {
            bestScore = iyEnd;
            bestMatches = prevMatchIy[n];
            bestLength = prevLenIy[n];
        }
    }
    return {
        identity: bestLength === 0 ? 0 : bestMatches / bestLength,
        score: bestScore,
        alignedLength: bestLength,
    };
}
