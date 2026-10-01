/**
 * Condensed (upper-triangular) similarity matrix helpers.
 *
 * A full n x n matrix stores every value twice plus a diagonal of ones. For the
 * default cap of 400 sequences that is 640 kB instead of 319 kB, and the waste
 * grows quadratically. Every consumer - the heatmap, the clustering, the export
 * - goes through these accessors, so the layout is an implementation detail.
 *
 * Index of pair (i, j) with i < j is `i * n - i * (i + 1) / 2 + j - i - 1`.
 */
export const condensedLength = (n) => (n * (n - 1)) / 2;
export function pairIndex(n, i, j) {
    if (i === j)
        return -1;
    const [a, b] = i < j ? [i, j] : [j, i];
    return a * n - (a * (a + 1)) / 2 + b - a - 1;
}
/** Reads a value, returning 1 on the diagonal. */
export const getPair = (matrix, n, i, j) => i === j ? 1 : matrix[pairIndex(n, i, j)];
export const setPair = (matrix, n, i, j, value) => {
    if (i === j)
        return;
    matrix[pairIndex(n, i, j)] = value;
};
export function matrixStats(matrix) {
    const n = matrix.length;
    if (n === 0)
        return { mean: 0, median: 0, max: 0, min: 0, count: 0 };
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < n; i += 1) {
        const value = matrix[i];
        sum += value;
        if (value > max)
            max = value;
        if (value < min)
            min = value;
    }
    const sorted = Float32Array.from(matrix);
    sorted.sort();
    const median = n % 2 === 1 ? sorted[(n - 1) >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return { mean: sum / n, median, max, min, count: n };
}
/** Converts a condensed similarity matrix to a dense row-major array. */
export function toDense(matrix, n) {
    const dense = new Float32Array(n * n);
    for (let i = 0; i < n; i += 1) {
        dense[i * n + i] = 1;
        for (let j = i + 1; j < n; j += 1) {
            const value = matrix[pairIndex(n, i, j)];
            dense[i * n + j] = value;
            dense[j * n + i] = value;
        }
    }
    return dense;
}
