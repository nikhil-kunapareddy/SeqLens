import { useMemo } from 'react';
import type { DendrogramNode } from '@/types';
import { cn } from '@/utils/cn';
import { formatDecimal } from '@/utils/format';
import { CHROME, SERIES_ALL_PAIRS, SERIES_OTHER } from './palette';

interface LaidOutLeaf {
  memberIndex: number;
  label: string;
  y: number;
  clusterId: number;
}

interface LaidOutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  clusterId: number;
}

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
export function Dendrogram({
  root,
  threshold,
  width = 560,
  leafHeight = 14,
  labelWidth = 150,
  onSelectLeaf,
  highlightIndices,
  className,
}: {
  root: DendrogramNode | null;
  /** Similarity threshold; converted to the distance at which the tree is cut. */
  threshold?: number;
  width?: number;
  leafHeight?: number;
  labelWidth?: number;
  onSelectLeaf?: (memberIndex: number) => void;
  highlightIndices?: Set<number>;
  className?: string;
}) {
  const layout = useMemo(() => {
    if (root === null) return null;

    const cutDistance = threshold === undefined ? Number.POSITIVE_INFINITY : 1 - threshold;

    const leaves: LaidOutLeaf[] = [];
    const edges: LaidOutEdge[] = [];
    let maxHeight = 0;
    let nextClusterId = 0;

    const measure = (node: DendrogramNode): void => {
      if (node.height > maxHeight) maxHeight = node.height;
      node.children?.forEach(measure);
    };
    measure(root);
    const scale = maxHeight === 0 ? 1 : maxHeight;

    const plotWidth = Math.max(60, width - labelWidth - 16);
    // Distance grows right-to-left: leaves at the right edge, the root at the left.
    const xFor = (height: number) => plotWidth - (height / scale) * plotWidth;

    let nextY = 0;

    /** Returns the vertical centre of the subtree, laying out leaves in order. */
    const place = (node: DendrogramNode, clusterId: number): number => {
      // A node at or below the cut starts a cluster, and its whole subtree
      // inherits that cluster's colour.
      const effectiveCluster =
        clusterId === -1 && node.height <= cutDistance ? nextClusterId++ : clusterId;

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
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No clustering tree is available.
      </p>
    );
  }

  const colorFor = (clusterId: number): string =>
    clusterId < 0
      ? CHROME.axis
      : (SERIES_ALL_PAIRS[clusterId % SERIES_ALL_PAIRS.length] ?? SERIES_OTHER);

  const svgHeight = layout.height + 24;

  return (
    <div className={cn('overflow-auto', className)}>
      <svg
        width={width}
        height={svgHeight}
        viewBox={`0 0 ${width} ${svgHeight}`}
        role="img"
        aria-label={`Hierarchical clustering tree with ${layout.leaves.length} sequences in ${layout.clusterCount} clusters. Cluster assignments are listed in the table beneath.`}
      >
        {/* Distance axis along the top. */}
        <g>
          <line
            x1={0}
            y1={12}
            x2={layout.plotWidth}
            y2={12}
            stroke={CHROME.axis}
            strokeWidth={1}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const distance = layout.maxHeight * fraction;
            const x = layout.plotWidth - fraction * layout.plotWidth;
            return (
              <g key={fraction}>
                <line x1={x} y1={8} x2={x} y2={12} stroke={CHROME.axis} strokeWidth={1} />
                <text x={x} y={6} textAnchor="middle" fontSize={9} fill={CHROME.muted}>
                  {formatDecimal(distance, 2)}
                </text>
              </g>
            );
          })}
        </g>

        <g transform="translate(0, 18)">
          {layout.cutX !== null ? (
            <>
              <line
                x1={layout.cutX}
                y1={0}
                x2={layout.cutX}
                y2={layout.height}
                stroke={CHROME.inkSecondary}
                strokeWidth={1}
              />
              <text
                x={layout.cutX - 3}
                y={10}
                textAnchor="end"
                fontSize={9}
                fill={CHROME.inkSecondary}
              >
                cut
              </text>
            </>
          ) : null}

          {layout.edges.map((edge, index) => (
            <line
              key={index}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke={colorFor(edge.clusterId)}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}

          {layout.leaves.map((leaf) => {
            const highlighted = highlightIndices?.has(leaf.memberIndex) ?? false;
            return (
              <g
                key={`${leaf.memberIndex}-${leaf.y}`}
                className={onSelectLeaf ? 'cursor-pointer' : undefined}
                onClick={() => onSelectLeaf?.(leaf.memberIndex)}
              >
                {/* A transparent hit strip: a 1.5px line is too small a target. */}
                <rect
                  x={layout.plotWidth}
                  y={leaf.y - leafHeight / 2}
                  width={labelWidth + 12}
                  height={leafHeight}
                  fill={highlighted ? 'rgba(28,92,171,0.10)' : 'transparent'}
                />
                <circle cx={layout.plotWidth} cy={leaf.y} r={2.5} fill={colorFor(leaf.clusterId)} />
                <text
                  x={layout.plotWidth + 6}
                  y={leaf.y + 3}
                  fontSize={9.5}
                  fill={highlighted ? CHROME.ink : CHROME.inkSecondary}
                  fontWeight={highlighted ? 600 : 400}
                  fontFamily="ui-monospace, monospace"
                >
                  {leaf.label.length > 22 ? `${leaf.label.slice(0, 21)}…` : leaf.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
