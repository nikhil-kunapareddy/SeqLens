import { createRng } from '../parsers/hash';
/** Squared Euclidean distance between rows i and j. */
function squaredDistance(data, dimensions, i, j) {
    const offsetA = i * dimensions;
    const offsetB = j * dimensions;
    let sum = 0;
    for (let d = 0; d < dimensions; d += 1) {
        const diff = data[offsetA + d] - data[offsetB + d];
        sum += diff * diff;
    }
    return sum;
}
/**
 * Fits the `a` and `b` of the UMAP output kernel `1 / (1 + a * d^(2b))` so the
 * curve matches the piecewise target defined by `minDist`.
 *
 * The reference implementation does a Levenberg-Marquardt fit; a coarse grid
 * search over the same objective lands within a percent or so of it and cannot
 * fail to converge, which matters more here than the last decimal place.
 */
export function fitCurve(spread, minDist) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < 300; i += 1) {
        const x = (i / 299) * 3 * spread;
        xs.push(x);
        ys.push(x <= minDist ? 1 : Math.exp(-(x - minDist) / spread));
    }
    let bestA = 1;
    let bestB = 1;
    let bestError = Infinity;
    for (let ai = 0; ai < 60; ai += 1) {
        const a = 0.05 + ai * 0.06;
        for (let bi = 0; bi < 60; bi += 1) {
            const b = 0.3 + bi * 0.03;
            let error = 0;
            for (let i = 0; i < xs.length; i += 1) {
                const predicted = 1 / (1 + a * xs[i] ** (2 * b));
                const diff = predicted - ys[i];
                error += diff * diff;
            }
            if (error < bestError) {
                bestError = error;
                bestA = a;
                bestB = b;
            }
        }
    }
    return { a: bestA, b: bestB };
}
/**
 * Per-point fuzzy simplicial set.
 *
 * `rho` is the distance to the nearest neighbour (so the nearest neighbour
 * always has membership 1, which is what keeps local structure intact), and
 * `sigma` is found by binary search so that the row's memberships sum to
 * `log2(k)`.
 */
function smoothKnnDistances(distances, n, k) {
    const rho = new Float32Array(n);
    const sigma = new Float32Array(n);
    const target = Math.log2(k);
    for (let i = 0; i < n; i += 1) {
        const offset = i * k;
        let nearest = Infinity;
        for (let j = 0; j < k; j += 1) {
            const d = distances[offset + j];
            if (d > 0 && d < nearest)
                nearest = d;
        }
        rho[i] = nearest === Infinity ? 0 : nearest;
        let low = 0;
        let high = Infinity;
        let mid = 1;
        for (let iteration = 0; iteration < 64; iteration += 1) {
            let sum = 0;
            for (let j = 0; j < k; j += 1) {
                const d = distances[offset + j] - rho[i];
                sum += d > 0 ? Math.exp(-d / mid) : 1;
            }
            if (Math.abs(sum - target) < 1e-5)
                break;
            if (sum > target) {
                high = mid;
                mid = (low + high) / 2;
            }
            else {
                low = mid;
                mid = high === Infinity ? mid * 2 : (low + high) / 2;
            }
        }
        sigma[i] = mid;
    }
    return { rho, sigma };
}
function buildGraph(data, n, dimensions, k) {
    const neighborIndex = new Int32Array(n * k);
    const neighborDistance = new Float32Array(n * k);
    // Exact brute-force kNN with a bounded insertion sort per row.
    const candidateDistance = new Float64Array(k).fill(Infinity);
    const candidateIndex = new Int32Array(k).fill(-1);
    for (let i = 0; i < n; i += 1) {
        candidateDistance.fill(Infinity);
        candidateIndex.fill(-1);
        for (let j = 0; j < n; j += 1) {
            if (j === i)
                continue;
            const d = squaredDistance(data, dimensions, i, j);
            if (d >= candidateDistance[k - 1])
                continue;
            let slot = k - 1;
            while (slot > 0 && candidateDistance[slot - 1] > d) {
                candidateDistance[slot] = candidateDistance[slot - 1];
                candidateIndex[slot] = candidateIndex[slot - 1];
                slot -= 1;
            }
            candidateDistance[slot] = d;
            candidateIndex[slot] = j;
        }
        for (let j = 0; j < k; j += 1) {
            neighborIndex[i * k + j] = candidateIndex[j];
            neighborDistance[i * k + j] =
                candidateDistance[j] === Infinity ? 0 : Math.sqrt(candidateDistance[j]);
        }
    }
    const { rho, sigma } = smoothKnnDistances(neighborDistance, n, k);
    // Directed memberships, then symmetrise with the probabilistic t-conorm.
    const strength = new Map();
    const keyOf = (a, b) => a * n + b;
    for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < k; j += 1) {
            const neighbor = neighborIndex[i * k + j];
            if (neighbor < 0)
                continue;
            const d = neighborDistance[i * k + j] - rho[i];
            const value = d > 0 ? Math.exp(-d / sigma[i]) : 1;
            strength.set(keyOf(i, neighbor), value);
        }
    }
    const head = [];
    const tail = [];
    const weight = [];
    const emitted = new Set();
    for (const [key, value] of strength) {
        const i = Math.floor(key / n);
        const j = key % n;
        const pairKey = i < j ? keyOf(i, j) : keyOf(j, i);
        if (emitted.has(pairKey))
            continue;
        emitted.add(pairKey);
        const reverse = strength.get(keyOf(j, i)) ?? 0;
        const combined = value + reverse - value * reverse;
        if (combined <= 0)
            continue;
        head.push(i);
        tail.push(j);
        weight.push(combined);
    }
    return {
        head: Int32Array.from(head),
        tail: Int32Array.from(tail),
        weight: Float32Array.from(weight),
    };
}
export function umap(data, sampleCount, dimensions, options) {
    const n = sampleCount;
    const k = Math.max(2, Math.min(options.nNeighbors, n - 1));
    const { a, b } = fitCurve(1, options.minDist);
    const rng = createRng(options.seed);
    if (n === 0)
        return { embedding: new Float32Array(0), a, b, neighbors: 0 };
    if (n <= 2) {
        const embedding = new Float32Array(n * 2);
        for (let i = 0; i < n; i += 1)
            embedding[i * 2] = i;
        return { embedding, a, b, neighbors: k };
    }
    const graph = buildGraph(data, n, dimensions, k);
    const embedding = new Float32Array(n * 2);
    if (options.init && options.init.length === n * 2) {
        // Scale the supplied (PCA) initialisation into UMAP's usual working range.
        let maxAbs = 0;
        for (let i = 0; i < options.init.length; i += 1) {
            const value = Math.abs(options.init[i]);
            if (value > maxAbs)
                maxAbs = value;
        }
        const scale = maxAbs === 0 ? 1 : 10 / maxAbs;
        for (let i = 0; i < embedding.length; i += 1) {
            embedding[i] = options.init[i] * scale + (rng() - 0.5) * 1e-3;
        }
    }
    else {
        for (let i = 0; i < embedding.length; i += 1)
            embedding[i] = (rng() - 0.5) * 20;
    }
    const epochs = Math.max(1, options.epochs);
    const negativeSampleRate = options.negativeSampleRate ?? 5;
    const edgeCount = graph.weight.length;
    if (edgeCount === 0)
        return { embedding, a, b, neighbors: k };
    // Edges are sampled in proportion to weight, as in the reference
    // implementation's `make_epochs_per_sample`.
    let maxWeight = 0;
    for (let e = 0; e < edgeCount; e += 1) {
        if (graph.weight[e] > maxWeight)
            maxWeight = graph.weight[e];
    }
    const epochsPerSample = new Float64Array(edgeCount);
    for (let e = 0; e < edgeCount; e += 1) {
        epochsPerSample[e] = maxWeight === 0 ? -1 : maxWeight / graph.weight[e];
    }
    const epochOfNextSample = Float64Array.from(epochsPerSample);
    const epochsPerNegativeSample = new Float64Array(edgeCount);
    const epochOfNextNegativeSample = new Float64Array(edgeCount);
    for (let e = 0; e < edgeCount; e += 1) {
        epochsPerNegativeSample[e] = epochsPerSample[e] / negativeSampleRate;
        epochOfNextNegativeSample[e] = epochsPerNegativeSample[e];
    }
    const initialAlpha = 1;
    const gammaRepulsion = 1;
    const clip = 4;
    for (let epoch = 0; epoch < epochs; epoch += 1) {
        const alpha = initialAlpha * (1 - epoch / epochs);
        for (let e = 0; e < edgeCount; e += 1) {
            if (epochsPerSample[e] < 0 || epochOfNextSample[e] > epoch)
                continue;
            const j = graph.head[e];
            const kIndex = graph.tail[e];
            const jOffset = j * 2;
            const kOffset = kIndex * 2;
            let dx = embedding[jOffset] - embedding[kOffset];
            let dy = embedding[jOffset + 1] - embedding[kOffset + 1];
            let distSquared = dx * dx + dy * dy;
            // Attractive gradient of the output kernel.
            let gradCoeff = 0;
            if (distSquared > 0) {
                gradCoeff = (-2 * a * b * distSquared ** (b - 1)) / (a * distSquared ** b + 1);
            }
            let gx = clamp(gradCoeff * dx, clip) * alpha;
            let gy = clamp(gradCoeff * dy, clip) * alpha;
            embedding[jOffset] += gx;
            embedding[jOffset + 1] += gy;
            embedding[kOffset] -= gx;
            embedding[kOffset + 1] -= gy;
            epochOfNextSample[e] += epochsPerSample[e];
            // Repulsion against random non-neighbours.
            const negativeSamples = Math.floor((epoch - epochOfNextNegativeSample[e]) / epochsPerNegativeSample[e]);
            for (let s = 0; s < negativeSamples; s += 1) {
                const randomIndex = Math.floor(rng() * n);
                if (randomIndex === j)
                    continue;
                const rOffset = randomIndex * 2;
                dx = embedding[jOffset] - embedding[rOffset];
                dy = embedding[jOffset + 1] - embedding[rOffset + 1];
                distSquared = dx * dx + dy * dy;
                if (distSquared > 0) {
                    gradCoeff =
                        (2 * gammaRepulsion * b) /
                            ((0.001 + distSquared) * (a * distSquared ** b + 1));
                }
                else {
                    gradCoeff = 0;
                }
                gx = distSquared > 0 ? clamp(gradCoeff * dx, clip) * alpha : 4 * alpha;
                gy = distSquared > 0 ? clamp(gradCoeff * dy, clip) * alpha : 4 * alpha;
                embedding[jOffset] += gx;
                embedding[jOffset + 1] += gy;
            }
            if (negativeSamples > 0) {
                epochOfNextNegativeSample[e] += negativeSamples * epochsPerNegativeSample[e];
            }
        }
        if (options.onProgress?.(epoch + 1, epochs) === false)
            break;
    }
    return { embedding, a, b, neighbors: k };
}
const clamp = (value, limit) => value > limit ? limit : value < -limit ? -limit : value;
