import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmbeddingPoint } from '@/types';
import { cn } from '@/utils/cn';
import { formatDecimal, formatInteger } from '@/utils/format';
import { CHROME, MARKER_SHAPES, markerFor, sequentialColor, type MarkerShape } from './palette';

export type ColorMode = 'cluster' | 'gc' | 'length';

export interface EmbeddingScatterProps {
  points: EmbeddingPoint[];
  colorMode: ColorMode;
  /** Highlighted point indices, e.g. nearest neighbours of a selection. */
  highlighted?: Set<number>;
  /** Point currently selected. */
  selectedIndex?: number | null;
  /** Points matching the active search, drawn with a ring. */
  matchedIndices?: Set<number>;
  onSelect?: (point: EmbeddingPoint | null) => void;
  width?: number;
  height?: number;
  className?: string;
}

interface Viewport {
  /** Scale factor; 1 fits the data to the canvas. */
  zoom: number;
  /** Pan offset in canvas pixels. */
  panX: number;
  panY: number;
}

const PADDING = 24;
const BASE_RADIUS = 3.5;

/**
 * Interactive 2-D embedding explorer.
 *
 * Canvas-based: a few thousand points as SVG circles is thousands of DOM nodes
 * that must all be re-laid-out on every pan and zoom frame. On a canvas the
 * whole plot is one repaint, which is what makes dragging feel continuous.
 *
 * Hit-testing keeps its own grid index rather than scanning every point per
 * mouse move, so the nearest-point lookup stays constant-time as the point
 * count grows. The search radius is wider than the mark, so a reader does not
 * have to land dead-centre on a 7-pixel dot.
 *
 * Cluster colouring uses the four all-pairs-safe hues crossed with four marker
 * shapes. Any two points can sit adjacent here, so a fifth hue would fall below
 * the separation floor; shape is a genuine second channel instead.
 */
export function EmbeddingScatter({
  points,
  colorMode,
  highlighted,
  selectedIndex,
  matchedIndices,
  onSelect,
  width = 640,
  height = 460,
  className,
}: EmbeddingScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [hovered, setHovered] = useState<EmbeddingPoint | null>(null);
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /** Data bounds and the transform that maps data space to canvas space. */
  const bounds = useMemo(() => {
    if (points.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    // Guard against a degenerate axis, which would divide by zero.
    if (maxX - minX < 1e-9) {
      minX -= 0.5;
      maxX += 0.5;
    }
    if (maxY - minY < 1e-9) {
      minY -= 0.5;
      maxY += 0.5;
    }
    return { minX, maxX, minY, maxY };
  }, [points]);

  const transform = useMemo(() => {
    const plotWidth = width - PADDING * 2;
    const plotHeight = height - PADDING * 2;
    const scaleX = plotWidth / (bounds.maxX - bounds.minX);
    const scaleY = plotHeight / (bounds.maxY - bounds.minY);
    // One scale for both axes, so the layout is not stretched: distances in an
    // embedding are only comparable if the aspect ratio is preserved.
    const scale = Math.min(scaleX, scaleY) * viewport.zoom;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    return {
      toCanvasX: (x: number) => width / 2 + (x - centerX) * scale + viewport.panX,
      // Canvas y grows downward; data y grows upward.
      toCanvasY: (y: number) => height / 2 - (y - centerY) * scale + viewport.panY,
      scale,
    };
  }, [bounds, width, height, viewport]);

  /** Colour and shape for one point under the active colour mode. */
  const styleFor = useCallback(
    (point: EmbeddingPoint): { color: string; shape: MarkerShape } => {
      if (colorMode === 'cluster') return markerFor(point.cluster);
      if (colorMode === 'gc') {
        return { color: sequentialColor(point.gcPercent / 100), shape: 'circle' };
      }
      // Length is heavily skewed, so the ramp is applied on a log scale;
      // a linear ramp would put almost every point in the lightest step.
      const logLength = Math.log10(Math.max(1, point.length));
      const maxLog = Math.log10(Math.max(10, Math.max(...points.map((p) => p.length))));
      return { color: sequentialColor(logLength / maxLog), shape: 'circle' };
    },
    [colorMode, points],
  );

  /**
   * Spatial hash for hit-testing, rebuilt when the projection changes.
   * Cell size is one search radius, so a lookup examines at most nine cells.
   */
  const hitIndex = useMemo(() => {
    const cellSize = 16;
    const grid = new Map<string, EmbeddingPoint[]>();
    for (const point of points) {
      const cx = Math.floor(transform.toCanvasX(point.x) / cellSize);
      const cy = Math.floor(transform.toCanvasY(point.y) / cellSize);
      const cellKey = `${cx},${cy}`;
      const bucket = grid.get(cellKey);
      if (bucket) bucket.push(point);
      else grid.set(cellKey, [point]);
    }
    return { grid, cellSize };
  }, [points, transform]);

  const findNearest = useCallback(
    (canvasX: number, canvasY: number): EmbeddingPoint | null => {
      const { grid, cellSize } = hitIndex;
      const cx = Math.floor(canvasX / cellSize);
      const cy = Math.floor(canvasY / cellSize);
      let best: EmbeddingPoint | null = null;
      let bestDistance = 14 * 14; // ~24px effective target diameter

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const point of bucket) {
            const px = transform.toCanvasX(point.x) - canvasX;
            const py = transform.toCanvasY(point.y) - canvasY;
            const distance = px * px + py * py;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = point;
            }
          }
        }
      }
      return best;
    },
    [hitIndex, transform],
  );

  /* ------------------------------- painting ------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    // Recessive hairline frame, no gridlines: embedding axes have no units, so
    // a grid would imply a scale that does not exist.
    context.strokeStyle = CHROME.grid;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);

    const radius = Math.max(2, BASE_RADIUS * Math.min(2, Math.sqrt(viewport.zoom)));

    const drawMarker = (
      x: number,
      y: number,
      shape: MarkerShape,
      r: number,
      fill: string,
      ring: string | null,
    ) => {
      context.beginPath();
      switch (shape) {
        case 'triangle':
          context.moveTo(x, y - r * 1.2);
          context.lineTo(x + r * 1.1, y + r * 0.9);
          context.lineTo(x - r * 1.1, y + r * 0.9);
          context.closePath();
          break;
        case 'square':
          context.rect(x - r * 0.95, y - r * 0.95, r * 1.9, r * 1.9);
          break;
        case 'diamond':
          context.moveTo(x, y - r * 1.25);
          context.lineTo(x + r * 1.25, y);
          context.lineTo(x, y + r * 1.25);
          context.lineTo(x - r * 1.25, y);
          context.closePath();
          break;
        default:
          context.arc(x, y, r, 0, Math.PI * 2);
      }
      context.fillStyle = fill;
      context.fill();
      if (ring !== null) {
        // A 2px surface ring separates overlapping marks without a border look.
        context.strokeStyle = ring;
        context.lineWidth = 2;
        context.stroke();
      }
    };

    // Unselected points first, so highlights paint on top.
    for (const point of points) {
      if (selectedIndex === point.index) continue;
      if (highlighted?.has(point.index)) continue;
      const { color, shape } = styleFor(point);
      const dim = highlighted !== undefined && highlighted.size > 0;
      const matched = matchedIndices?.has(point.index) ?? false;
      context.globalAlpha = dim && !matched ? 0.25 : 0.85;
      drawMarker(
        transform.toCanvasX(point.x),
        transform.toCanvasY(point.y),
        shape,
        radius,
        color,
        matched ? CHROME.ink : null,
      );
    }

    context.globalAlpha = 1;

    if (highlighted) {
      for (const point of points) {
        if (!highlighted.has(point.index) || selectedIndex === point.index) continue;
        const { color, shape } = styleFor(point);
        drawMarker(
          transform.toCanvasX(point.x),
          transform.toCanvasY(point.y),
          shape,
          radius + 1.5,
          color,
          CHROME.surface,
        );
      }
    }

    const selected = points.find((point) => point.index === selectedIndex);
    if (selected) {
      const { color, shape } = styleFor(selected);
      const x = transform.toCanvasX(selected.x);
      const y = transform.toCanvasY(selected.y);
      drawMarker(x, y, shape, radius + 2.5, color, CHROME.surface);
      context.strokeStyle = CHROME.ink;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, radius + 6, 0, Math.PI * 2);
      context.stroke();
    }
  }, [
    points,
    transform,
    styleFor,
    width,
    height,
    viewport.zoom,
    highlighted,
    selectedIndex,
    matchedIndices,
  ]);

  /* ------------------------------ interaction ----------------------------- */

  const canvasPosition = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // React attaches wheel listeners passively, so a React `onWheel` handler
  // cannot call preventDefault and the page would scroll while zooming. The
  // listener is registered directly on the element with `passive: false`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listener = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setViewport((previous) => ({
        ...previous,
        zoom: Math.max(0.5, Math.min(40, previous.zoom * factor)),
      }));
    };
    canvas.addEventListener('wheel', listener, { passive: false });
    return () => canvas.removeEventListener('wheel', listener);
  }, []);

  return (
    <div className={cn('relative', className)}>
      <canvas
        ref={canvasRef}
        className={cn('block rounded border border-border bg-card', isDragging ? 'cursor-grabbing' : 'cursor-crosshair')}
        onMouseDown={(event) => {
          const { x, y } = canvasPosition(event);
          dragState.current = { x, y, panX: viewport.panX, panY: viewport.panY };
        }}
        onMouseMove={(event) => {
          const { x, y } = canvasPosition(event);
          if (dragState.current) {
            const dx = x - dragState.current.x;
            const dy = y - dragState.current.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
              setIsDragging(true);
              setViewport((previous) => ({
                ...previous,
                panX: dragState.current!.panX + dx,
                panY: dragState.current!.panY + dy,
              }));
            }
            return;
          }
          setHovered(findNearest(x, y));
        }}
        onMouseUp={(event) => {
          const wasDragging = isDragging;
          dragState.current = null;
          setIsDragging(false);
          if (wasDragging) return;
          const { x, y } = canvasPosition(event);
          onSelect?.(findNearest(x, y));
        }}
        onMouseLeave={() => {
          dragState.current = null;
          setIsDragging(false);
          setHovered(null);
        }}
        role="img"
        aria-label={`Embedding explorer with ${points.length} sequences. Exact coordinates and cluster assignments are in the table view.`}
      />

      {/* Zoom controls: scroll-wheel zoom alone is not discoverable. */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        {[
          { label: '+', title: 'Zoom in', action: () => setViewport((v) => ({ ...v, zoom: Math.min(40, v.zoom * 1.4) })) },
          { label: '−', title: 'Zoom out', action: () => setViewport((v) => ({ ...v, zoom: Math.max(0.5, v.zoom / 1.4) })) },
          { label: '↺', title: 'Reset view', action: () => setViewport({ zoom: 1, panX: 0, panY: 0 }) },
        ].map((control) => (
          <button
            key={control.title}
            type="button"
            onClick={control.action}
            title={control.title}
            aria-label={control.title}
            className="flex size-6 items-center justify-center rounded border border-border bg-card text-xs text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
          >
            {control.label}
          </button>
        ))}
      </div>

      {viewport.zoom !== 1 || viewport.panX !== 0 || viewport.panY !== 0 ? (
        <span className="absolute bottom-2 left-2 rounded bg-card/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {formatDecimal(viewport.zoom, 1)}x
        </span>
      ) : null}

      {hovered && !isDragging ? (
        <div
          className="pointer-events-none absolute z-20 max-w-64 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{
            left: Math.min(width - 20, Math.max(20, transform.toCanvasX(hovered.x))),
            top: Math.max(8, transform.toCanvasY(hovered.y) - 8),
          }}
        >
          <p className="truncate font-mono text-[11px] font-medium text-foreground">{hovered.id}</p>
          <p className="tabular mt-0.5 text-[11px] text-muted-foreground">
            {formatInteger(hovered.length)} residues · GC {formatDecimal(hovered.gcPercent, 1)}% · cluster{' '}
            {hovered.cluster + 1}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Legend for the active colour mode. */
export function EmbeddingLegend({
  colorMode,
  clusterSummary,
  gcRange,
  lengthRange,
}: {
  colorMode: ColorMode;
  clusterSummary: { cluster: number; size: number }[];
  gcRange: [number, number];
  lengthRange: [number, number];
}) {
  if (colorMode === 'cluster') {
    const visible = clusterSummary.filter((entry) => entry.size > 0);
    if (visible.length < 2) return null;
    return (
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {visible.map((entry) => {
          const { color, shape } = markerFor(entry.cluster);
          return (
            <li
              key={entry.cluster}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <MarkerGlyph color={color} shape={shape} />
              <span>Cluster {entry.cluster + 1}</span>
              <span className="tabular text-foreground">{formatInteger(entry.size)}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  const [low, high] = colorMode === 'gc' ? gcRange : lengthRange;
  const label = colorMode === 'gc' ? 'GC content' : 'Sequence length';
  const format = (value: number) =>
    colorMode === 'gc' ? `${formatDecimal(value, 1)}%` : formatInteger(value);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">{format(low)}</span>
      <div
        className="h-2.5 w-28 rounded-sm border border-border"
        style={{
          background: `linear-gradient(to right, ${sequentialColor(0)}, ${sequentialColor(0.5)}, ${sequentialColor(1)})`,
        }}
      />
      <span className="text-[11px] text-muted-foreground">{format(high)}</span>
      <span className="text-[11px] text-muted-foreground">
        {label}
        {colorMode === 'length' ? ' (log scale)' : ''}
      </span>
    </div>
  );
}

function MarkerGlyph({ color, shape }: { color: string; shape: MarkerShape }) {
  const index = MARKER_SHAPES.indexOf(shape);
  if (index === 1) {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <polygon points="4.5,0.5 8.5,8 0.5,8" fill={color} />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <rect x="0.5" y="0.5" width="8" height="8" fill={color} />
      </svg>
    );
  }
  if (index === 3) {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <polygon points="4.5,0.5 8.5,4.5 4.5,8.5 0.5,4.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
      <circle cx="4.5" cy="4.5" r="4" fill={color} />
    </svg>
  );
}
