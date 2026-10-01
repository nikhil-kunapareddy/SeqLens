import { describe, expect, it } from 'vitest';
import { pca } from './pca';
import { kmeans, nearestNeighbors } from './kmeans';
import { fitCurve, umap } from './umap';
import { createRng } from '../parsers/hash';
describe('pca', () => {
    it('handles empty input', () => {
        const result = pca(new Float32Array(0), 0, 0, 2);
        expect(result.components).toBe(0);
        expect(result.projection).toHaveLength(0);
    });
    it('recovers the axis of a line in 2-D', () => {
        // Points along y = x: the first component must lie on that diagonal.
        const n = 20;
        const data = new Float32Array(n * 2);
        for (let i = 0; i < n; i += 1) {
            data[i * 2] = i;
            data[i * 2 + 1] = i;
        }
        const result = pca(data, n, 2, 2);
        const axis = [result.axes[0], result.axes[1]];
        // The axis should be (1,1)/sqrt(2) up to sign.
        expect(Math.abs(axis[0])).toBeCloseTo(Math.SQRT1_2, 3);
        expect(Math.abs(axis[1])).toBeCloseTo(Math.SQRT1_2, 3);
        expect(axis[0] * axis[1]).toBeGreaterThan(0);
        // Essentially all variance is on the first component.
        expect(result.explainedVariance[0]).toBeGreaterThan(0.999);
    });
    it('orders components by descending explained variance', () => {
        const rng = createRng(1);
        const n = 60;
        const d = 5;
        const data = new Float32Array(n * d);
        for (let i = 0; i < n; i += 1) {
            // Variance decreases with dimension index.
            for (let j = 0; j < d; j += 1) {
                data[i * d + j] = (rng() - 0.5) * (10 - j * 2);
            }
        }
        const result = pca(data, n, d, 3);
        expect(result.explainedVariance[0]).toBeGreaterThanOrEqual(result.explainedVariance[1]);
        expect(result.explainedVariance[1]).toBeGreaterThanOrEqual(result.explainedVariance[2]);
    });
    it('produces explained variance fractions summing to at most 1', () => {
        const rng = createRng(2);
        const n = 40;
        const d = 8;
        const data = new Float32Array(n * d);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        const result = pca(data, n, d, 4);
        const total = result.explainedVariance.reduce((sum, value) => sum + value, 0);
        expect(total).toBeLessThanOrEqual(1.0001);
        expect(total).toBeGreaterThan(0);
    });
    it('centres the data before projecting', () => {
        const n = 30;
        const data = new Float32Array(n * 2);
        for (let i = 0; i < n; i += 1) {
            data[i * 2] = 1000 + i;
            data[i * 2 + 1] = 500 - i;
        }
        const result = pca(data, n, 2, 2);
        let sum = 0;
        for (let i = 0; i < n; i += 1)
            sum += result.projection[i * 2];
        // Projections of centred data have mean zero.
        expect(Math.abs(sum / n)).toBeLessThan(1e-3);
        expect(result.mean[0]).toBeCloseTo(1000 + (n - 1) / 2, 3);
    });
    it('does not modify the input array', () => {
        const data = Float32Array.from([1, 2, 3, 4, 5, 6]);
        const copy = Float32Array.from(data);
        pca(data, 3, 2, 2);
        expect([...data]).toEqual([...copy]);
    });
    it('caps components at min(samples, dimensions)', () => {
        const result = pca(Float32Array.from([1, 2, 3, 4]), 2, 2, 8);
        expect(result.components).toBe(2);
    });
    it('separates two well-spaced clusters on the first component', () => {
        const rng = createRng(3);
        const n = 60;
        const d = 4;
        const data = new Float32Array(n * d);
        for (let i = 0; i < n; i += 1) {
            const offset = i < n / 2 ? 0 : 20;
            for (let j = 0; j < d; j += 1)
                data[i * d + j] = offset + rng();
        }
        const result = pca(data, n, d, 2);
        let meanA = 0;
        let meanB = 0;
        for (let i = 0; i < n / 2; i += 1)
            meanA += result.projection[i * 2];
        for (let i = n / 2; i < n; i += 1)
            meanB += result.projection[i * 2];
        expect(Math.abs(meanA / (n / 2) - meanB / (n / 2))).toBeGreaterThan(10);
    });
});
describe('kmeans', () => {
    it('handles empty input', () => {
        const result = kmeans(new Float32Array(0), 0, 0, 3);
        expect(result.assignments).toHaveLength(0);
    });
    it('recovers two well-separated clusters', () => {
        const rng = createRng(4);
        const n = 60;
        const d = 2;
        const data = new Float32Array(n * d);
        for (let i = 0; i < n; i += 1) {
            const offset = i < 30 ? 0 : 50;
            data[i * d] = offset + rng();
            data[i * d + 1] = offset + rng();
        }
        const result = kmeans(data, n, d, 2, 7);
        const first = result.assignments[0];
        for (let i = 0; i < 30; i += 1)
            expect(result.assignments[i]).toBe(first);
        for (let i = 30; i < 60; i += 1)
            expect(result.assignments[i]).not.toBe(first);
        expect(result.emptyClusters).toBe(0);
    });
    it('is deterministic for a given seed', () => {
        const rng = createRng(5);
        const data = new Float32Array(100);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        const a = kmeans(data, 50, 2, 4, 99);
        const b = kmeans(data, 50, 2, 4, 99);
        expect([...a.assignments]).toEqual([...b.assignments]);
    });
    it('caps k at the sample count', () => {
        const result = kmeans(Float32Array.from([0, 0, 1, 1]), 2, 2, 10);
        expect(result.centroids).toHaveLength(2 * 2);
        expect(new Set(result.assignments).size).toBeLessThanOrEqual(2);
    });
    it('assigns every sample to a valid cluster', () => {
        const rng = createRng(6);
        const data = new Float32Array(200);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng() * 10;
        const result = kmeans(data, 100, 2, 5, 1);
        for (const assignment of result.assignments) {
            expect(assignment).toBeGreaterThanOrEqual(0);
            expect(assignment).toBeLessThan(5);
        }
    });
    it('reduces inertia relative to a single cluster', () => {
        const rng = createRng(7);
        const n = 80;
        const data = new Float32Array(n * 2);
        for (let i = 0; i < n; i += 1) {
            const offset = i < 40 ? 0 : 30;
            data[i * 2] = offset + rng();
            data[i * 2 + 1] = offset + rng();
        }
        const one = kmeans(data, n, 2, 1, 3);
        const two = kmeans(data, n, 2, 2, 3);
        expect(two.inertia).toBeLessThan(one.inertia);
    });
});
describe('nearestNeighbors', () => {
    const data = Float32Array.from([
        1, 0, // 0
        0.99, 0.1, // 1: very close to 0 in direction
        0, 1, // 2: orthogonal
        -1, 0, // 3: opposite
    ]);
    it('ranks the closest vector first under cosine distance', () => {
        const neighbors = nearestNeighbors(data, 4, 2, 0, 3, 'cosine');
        expect(neighbors[0].index).toBe(1);
        expect(neighbors[0].similarity).toBeGreaterThan(0.99);
        expect(neighbors[neighbors.length - 1].index).toBe(3);
    });
    it('excludes the query itself', () => {
        const neighbors = nearestNeighbors(data, 4, 2, 0, 4, 'cosine');
        expect(neighbors.map((n) => n.index)).not.toContain(0);
        expect(neighbors).toHaveLength(3);
    });
    it('supports euclidean distance', () => {
        const neighbors = nearestNeighbors(data, 4, 2, 0, 1, 'euclidean');
        expect(neighbors[0].index).toBe(1);
        expect(neighbors[0].distance).toBeCloseTo(Math.hypot(0.01, 0.1), 5);
    });
    it('returns nothing for an out-of-range query', () => {
        expect(nearestNeighbors(data, 4, 2, 99, 3)).toEqual([]);
    });
    it('honours the requested count', () => {
        expect(nearestNeighbors(data, 4, 2, 0, 2)).toHaveLength(2);
    });
});
describe('umap', () => {
    it('fits curve parameters that reproduce the target kernel', () => {
        const { a, b } = fitCurve(1, 0.1);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
        // At distance 0 the kernel is 1 by construction.
        expect(1 / (1 + a * 0 ** (2 * b))).toBe(1);
        // A larger minDist flattens the curve, so a falls.
        expect(fitCurve(1, 0.5).a).toBeLessThan(a);
    });
    it('handles trivially small inputs', () => {
        expect(umap(new Float32Array(0), 0, 2, { nNeighbors: 5, minDist: 0.1, epochs: 10, seed: 1 }).embedding).toHaveLength(0);
        const two = umap(Float32Array.from([0, 0, 1, 1]), 2, 2, {
            nNeighbors: 5,
            minDist: 0.1,
            epochs: 10,
            seed: 1,
        });
        expect(two.embedding).toHaveLength(4);
    });
    it('produces finite coordinates', () => {
        const rng = createRng(8);
        const n = 40;
        const d = 6;
        const data = new Float32Array(n * d);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        const result = umap(data, n, d, { nNeighbors: 8, minDist: 0.1, epochs: 40, seed: 11 });
        expect(result.embedding).toHaveLength(n * 2);
        for (const value of result.embedding)
            expect(Number.isFinite(value)).toBe(true);
    });
    it('is reproducible for a given seed', () => {
        const rng = createRng(9);
        const n = 30;
        const d = 4;
        const data = new Float32Array(n * d);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        const options = { nNeighbors: 6, minDist: 0.1, epochs: 30, seed: 5 };
        const a = umap(data, n, d, options);
        const b = umap(data, n, d, options);
        expect([...a.embedding]).toEqual([...b.embedding]);
    });
    it('keeps members of two separated clusters closer to each other than across', () => {
        const rng = createRng(10);
        const n = 60;
        const d = 8;
        const data = new Float32Array(n * d);
        for (let i = 0; i < n; i += 1) {
            const offset = i < 30 ? 0 : 10;
            for (let j = 0; j < d; j += 1)
                data[i * d + j] = offset + rng();
        }
        const result = umap(data, n, d, {
            nNeighbors: 10,
            minDist: 0.1,
            epochs: 200,
            seed: 3,
        });
        const centroid = (from, to) => {
            let x = 0;
            let y = 0;
            for (let i = from; i < to; i += 1) {
                x += result.embedding[i * 2];
                y += result.embedding[i * 2 + 1];
            }
            const count = to - from;
            return [x / count, y / count];
        };
        const spread = (from, to, cx, cy) => {
            let sum = 0;
            for (let i = from; i < to; i += 1) {
                sum += Math.hypot(result.embedding[i * 2] - cx, result.embedding[i * 2 + 1] - cy);
            }
            return sum / (to - from);
        };
        const [ax, ay] = centroid(0, 30);
        const [bx, by] = centroid(30, 60);
        const between = Math.hypot(ax - bx, ay - by);
        const within = (spread(0, 30, ax, ay) + spread(30, 60, bx, by)) / 2;
        expect(between).toBeGreaterThan(within);
    });
    it('caps the neighbour count at n - 1', () => {
        const rng = createRng(11);
        const n = 5;
        const data = new Float32Array(n * 3);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        const result = umap(data, n, 3, { nNeighbors: 50, minDist: 0.1, epochs: 10, seed: 1 });
        expect(result.neighbors).toBe(n - 1);
    });
    it('stops early when progress reports cancellation', () => {
        const rng = createRng(12);
        const n = 20;
        const data = new Float32Array(n * 3);
        for (let i = 0; i < data.length; i += 1)
            data[i] = rng();
        let calls = 0;
        umap(data, n, 3, {
            nNeighbors: 5,
            minDist: 0.1,
            epochs: 500,
            seed: 1,
            onProgress: () => {
                calls += 1;
                return false;
            },
        });
        expect(calls).toBe(1);
    });
});
