import { getPair } from './matrix';
/**
 * Agglomerative hierarchical clustering on a condensed similarity matrix.
 *
 * Similarities are converted to distances as `1 - similarity`, then the two
 * closest clusters are merged repeatedly. Linkage determines how the distance
 * between two clusters is defined:
 *
 *  - `single`: nearest members. Follows chains of related sequences, so it
 *    finds elongated families but is prone to joining two groups through a
 *    single intermediate sequence.
 *  - `complete`: furthest members. Produces compact, similar-diameter clusters
 *    and resists chaining, but splits genuinely elongated families.
 *  - `average` (UPGMA): mean over all member pairs. The default, because it is
 *    the least surprising of the three on sequence data.
 *
 * The implementation is the straightforward O(n^3) nearest-pair search. At the
 * default 400-sequence cap that is well under a second in a worker, and the
 * clarity is worth more here than the constant factor a nearest-neighbour chain
 * would save.
 */
export function buildDendrogram(matrix, n, linkage, labels) {
    if (n === 0)
        return null;
    if (n === 1) {
        return { id: 0, height: 0, size: 1, memberIndex: 0, label: labels?.(0) };
    }
    // Working distance matrix over active clusters, dense for simple indexing.
    const distance = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
            const d = 1 - getPair(matrix, n, i, j);
            distance[i * n + j] = d;
            distance[j * n + i] = d;
        }
    }
    const active = [];
    const nodes = new Map();
    for (let i = 0; i < n; i += 1) {
        active.push(i);
        nodes.set(i, { id: i, height: 0, size: 1, memberIndex: i, label: labels?.(i) });
    }
    // Slot occupied by each cluster in the working matrix.
    const slotOf = new Map();
    for (let i = 0; i < n; i += 1)
        slotOf.set(i, i);
    let nextId = n;
    while (active.length > 1) {
        let bestDistance = Infinity;
        let bestA = 0;
        let bestB = 1;
        for (let ai = 0; ai < active.length; ai += 1) {
            const slotA = slotOf.get(active[ai]);
            for (let bi = ai + 1; bi < active.length; bi += 1) {
                const slotB = slotOf.get(active[bi]);
                const d = distance[slotA * n + slotB];
                if (d < bestDistance) {
                    bestDistance = d;
                    bestA = ai;
                    bestB = bi;
                }
            }
        }
        const clusterA = active[bestA];
        const clusterB = active[bestB];
        const nodeA = nodes.get(clusterA);
        const nodeB = nodes.get(clusterB);
        const slotA = slotOf.get(clusterA);
        const slotB = slotOf.get(clusterB);
        const merged = {
            id: nextId,
            height: bestDistance,
            size: nodeA.size + nodeB.size,
            children: [nodeA, nodeB],
        };
        nodes.set(nextId, merged);
        // The merged cluster reuses slotA; update its distance to every other cluster.
        for (const other of active) {
            if (other === clusterA || other === clusterB)
                continue;
            const slotOther = slotOf.get(other);
            const dA = distance[slotA * n + slotOther];
            const dB = distance[slotB * n + slotOther];
            let updated;
            switch (linkage) {
                case 'single':
                    updated = Math.min(dA, dB);
                    break;
                case 'complete':
                    updated = Math.max(dA, dB);
                    break;
                case 'average':
                    updated = (dA * nodeA.size + dB * nodeB.size) / merged.size;
                    break;
            }
            distance[slotA * n + slotOther] = updated;
            distance[slotOther * n + slotA] = updated;
        }
        active.splice(bestB, 1);
        active[bestA] = nextId;
        slotOf.set(nextId, slotA);
        slotOf.delete(clusterA);
        slotOf.delete(clusterB);
        nodes.delete(clusterA);
        nodes.delete(clusterB);
        nextId += 1;
    }
    return nodes.get(active[0]) ?? null;
}
/**
 * Cuts a dendrogram at a distance threshold and returns the member indices of
 * each resulting cluster.
 *
 * `similarityThreshold` is converted to the matching distance `1 - threshold`,
 * so a threshold of 0.6 groups sequences whose linkage distance is at most 0.4.
 */
export function cutDendrogram(root, similarityThreshold) {
    if (root === null)
        return [];
    const maxDistance = 1 - similarityThreshold;
    const clusters = [];
    const visit = (node) => {
        if (node.height <= maxDistance || node.children === undefined) {
            clusters.push(collectLeaves(node));
            return;
        }
        visit(node.children[0]);
        visit(node.children[1]);
    };
    visit(root);
    return clusters;
}
/** Member indices of every leaf beneath a node, in left-to-right order. */
export function collectLeaves(node) {
    const leaves = [];
    const stack = [node];
    const ordered = [];
    while (stack.length > 0) {
        const current = stack.pop();
        ordered.push(current);
        if (current.children) {
            stack.push(current.children[1], current.children[0]);
        }
    }
    for (const item of ordered) {
        if (item.memberIndex !== undefined)
            leaves.push(item.memberIndex);
    }
    return leaves;
}
/**
 * Leaf order for drawing: a depth-first walk of the tree.
 * Using this order for the heatmap rows puts related sequences adjacent, which
 * is what makes block structure visible.
 */
export function leafOrder(root) {
    if (root === null)
        return [];
    const order = [];
    const walk = (node) => {
        if (node.children === undefined) {
            if (node.memberIndex !== undefined)
                order.push(node.memberIndex);
            return;
        }
        walk(node.children[0]);
        walk(node.children[1]);
    };
    walk(root);
    return order;
}
/**
 * Greedy single-pass clustering, used when the dataset is too large for a full
 * matrix.
 *
 * Each sequence either joins the first existing cluster whose representative it
 * matches at or above the threshold, or becomes a new representative. This is
 * the CD-HIT/VSEARCH approach: order-dependent and not guaranteed optimal, but
 * linear in the number of clusters rather than quadratic in sequences.
 */
export function greedyCluster(count, similarity, threshold, order) {
    const clusters = [];
    const sequence = order ?? Array.from({ length: count }, (_, i) => i);
    for (const index of sequence) {
        let assigned = false;
        for (const cluster of clusters) {
            if (similarity(cluster.representative, index) >= threshold) {
                cluster.members.push(index);
                assigned = true;
                break;
            }
        }
        if (!assigned)
            clusters.push({ representative: index, members: [index] });
    }
    return clusters;
}
/** Maximum merge height in a dendrogram, for scaling the drawing. */
export function dendrogramHeight(root) {
    if (root === null)
        return 0;
    let max = 0;
    const walk = (node) => {
        if (node.height > max)
            max = node.height;
        node.children?.forEach(walk);
    };
    walk(root);
    return max;
}
