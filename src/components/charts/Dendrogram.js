import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo } from 'react';
import { cn } from '@/utils/cn';
import { formatDecimal } from '@/utils/format';
import { CHROME, SERIES_ALL_PAIRS, SERIES_OTHER } from './palette';
/**
 * Hierarchical clustering tree.
 *
 * Drawn as a rectangular (bracket-style) dendrogram, the convention in every
 * phylogenetics and clustering tool, where the horizontal position of a join
 * is its merge distance. Branches below the cut are coloured by cluster and
 * branches above it are neutral grey, so the cut's effect is visible rather
 * than needing to be inferred from the threshold value.
 *
 * Cluster colours come from the four-slot all-pairs-safe subset: leaves of
 * different clusters sit adjacent, so any two colours must be separable, not
 * just neighbouring ones.
 */
export function Dendrogram({ root, threshold, width = 560, leafHeight = 14, labelWidth = 150, onSelectLeaf, highlightIndices, className, }) {
    const layout = useMemo(() => {
        if (root === null)
            return null;
        const cutDistance = threshold === undefined ? Number.POSITIVE_INFINITY : 1 - threshold;
        const leaves = [];
        const edges = [];
        let maxHeight = 0;
        let nextClusterId = 0;
        const measure = (node) => {
            if (node.height > maxHeight)
                maxHeight = node.height;
            node.children?.forEach(measure);
        };
        measure(root);
        const scale = maxHeight === 0 ? 1 : maxHeight;
        const plotWidth = Math.max(60, width - labelWidth - 16);
        // Distance grows right-to-left: leaves at the right edge, the root at the left.
        const xFor = (height) => plotWidth - (height / scale) * plotWidth;
        let nextY = 0;
        /** Returns the vertical centre of the subtree, laying out leaves in order. */
        const place = (node, clusterId) => {
            // A node at or below the cut starts a cluster, and its whole subtree
            // inherits that cluster's colour.
            const effectiveCluster = clusterId === -1 && node.height <= cutDistance ? nextClusterId++ : clusterId;
            if (node.children === undefined) {
                const y = nextY * leafHeight + leafHeight / 2;
                nextY += 1;
                leaves.push({
                    memberIndex: node.memberIndex ?? -1,
                    label: node.label ?? String(node.memberIndex ?? ''),
                    y,
                    clusterId: effectiveCluster,
                });
                return y;
            }
            const [left, right] = node.children;
            const leftY = place(left, effectiveCluster);
            const rightY = place(right, effectiveCluster);
            const x = xFor(node.height);
            // Two horizontal arms plus one vertical connector: the bracket shape.
            edges.push({ x1: x, y1: leftY, x2: xFor(left.height), y2: leftY, clusterId: effectiveCluster });
            edges.push({ x1: x, y1: rightY, x2: xFor(right.height), y2: rightY, clusterId: effectiveCluster });
            edges.push({ x1: x, y1: leftY, x2: x, y2: rightY, clusterId: effectiveCluster });
            return (leftY + rightY) / 2;
        };
        place(root, -1);
        return {
            leaves,
            edges,
            plotWidth,
            height: Math.max(leafHeight, nextY * leafHeight),
            maxHeight,
            cutX: cutDistance >= scale ? null : xFor(cutDistance),
            clusterCount: nextClusterId,
        };
    }, [root, threshold, width, leafHeight, labelWidth]);
    if (layout === null) {
        return (_jsx("p", { className: "py-8 text-center text-xs text-muted-foreground", children: "No clustering tree is available." }));
    }
    const colorFor = (clusterId) => clusterId < 0
        ? CHROME.axis
        : (SERIES_ALL_PAIRS[clusterId % SERIES_ALL_PAIRS.length] ?? SERIES_OTHER);
    const svgHeight = layout.height + 24;
    return (_jsx("div", { className: cn('overflow-auto', className), children: _jsxs("svg", { width: width, height: svgHeight, viewBox: `0 0 ${width} ${svgHeight}`, role: "img", "aria-label": `Hierarchical clustering tree with ${layout.leaves.length} sequences in ${layout.clusterCount} clusters. Cluster assignments are listed in the table beneath.`, children: [_jsxs("g", { children: [_jsx("line", { x1: 0, y1: 12, x2: layout.plotWidth, y2: 12, stroke: CHROME.axis, strokeWidth: 1 }), [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                            const distance = layout.maxHeight * fraction;
                            const x = layout.plotWidth - fraction * layout.plotWidth;
                            return (_jsxs("g", { children: [_jsx("line", { x1: x, y1: 8, x2: x, y2: 12, stroke: CHROME.axis, strokeWidth: 1 }), _jsx("text", { x: x, y: 6, textAnchor: "middle", fontSize: 9, fill: CHROME.muted, children: formatDecimal(distance, 2) })] }, fraction));
                        })] }), _jsxs("g", { transform: "translate(0, 18)", children: [layout.cutX !== null ? (_jsxs(_Fragment, { children: [_jsx("line", { x1: layout.cutX, y1: 0, x2: layout.cutX, y2: layout.height, stroke: CHROME.inkSecondary, strokeWidth: 1 }), _jsx("text", { x: layout.cutX - 3, y: 10, textAnchor: "end", fontSize: 9, fill: CHROME.inkSecondary, children: "cut" })] })) : null, layout.edges.map((edge, index) => (_jsx("line", { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2, stroke: colorFor(edge.clusterId), strokeWidth: 1.5, strokeLinecap: "round" }, index))), layout.leaves.map((leaf) => {
                            const highlighted = highlightIndices?.has(leaf.memberIndex) ?? false;
                            return (_jsxs("g", { className: onSelectLeaf ? 'cursor-pointer' : undefined, onClick: () => onSelectLeaf?.(leaf.memberIndex), children: [_jsx("rect", { x: layout.plotWidth, y: leaf.y - leafHeight / 2, width: labelWidth + 12, height: leafHeight, fill: highlighted ? 'rgba(28,92,171,0.10)' : 'transparent' }), _jsx("circle", { cx: layout.plotWidth, cy: leaf.y, r: 2.5, fill: colorFor(leaf.clusterId) }), _jsx("text", { x: layout.plotWidth + 6, y: leaf.y + 3, fontSize: 9.5, fill: highlighted ? CHROME.ink : CHROME.inkSecondary, fontWeight: highlighted ? 600 : 400, fontFamily: "ui-monospace, monospace", children: leaf.label.length > 22 ? `${leaf.label.slice(0, 21)}…` : leaf.label })] }, `${leaf.memberIndex}-${leaf.y}`));
                        })] })] }) }));
}
