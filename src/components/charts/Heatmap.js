import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPair } from '@/bio/similarity/matrix';
import { cn } from '@/utils/cn';
import { formatDecimal } from '@/utils/format';
import { CHROME, SEQUENTIAL, sequentialColor } from './palette';
/**
 * Similarity matrix, drawn on a canvas.
 *
 * Canvas rather than SVG because a 400-sequence matrix is 160,000 cells: as
 * SVG that is 160,000 DOM nodes, which takes seconds to lay out and makes the
 * page unusable. On a canvas it is one element and a single paint.
 *
 * Colour is a single-hue sequential ramp, light to dark, because the value
 * being encoded is magnitude. A rainbow scale would imply category boundaries
 * that do not exist in a continuous similarity.
 *
 * Rows are drawn in the supplied order - normally the dendrogram's leaf order -
 * which is what makes block structure visible. In input order the same matrix
 * looks like noise.
 */
export function Heatmap({ matrix, size, labels, order, onSelectPair, threshold, className, maxSize = 560, }) {
    const canvasRef = useRef(null);
    const [hover, setHover] = useState(null);
    const displayOrder = useMemo(() => order ?? Array.from({ length: size }, (_, i) => i), [order, size]);
    // Cell size is an integer so cells align to device pixels and no seams appear.
    const cell = Math.max(1, Math.floor(maxSize / Math.max(1, size)));
    const edge = cell * size;
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || size === 0)
            return;
        const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
        canvas.width = edge * dpr;
        canvas.height = edge * dpr;
        canvas.style.width = `${edge}px`;
        canvas.style.height = `${edge}px`;
        const context = canvas.getContext('2d');
        if (!context)
            return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, edge, edge);
        for (let row = 0; row < size; row += 1) {
            const rowIndex = displayOrder[row];
            for (let column = 0; column < size; column += 1) {
                const columnIndex = displayOrder[column];
                const value = rowIndex === columnIndex ? 1 : getPair(matrix, size, rowIndex, columnIndex);
                context.fillStyle = sequentialColor(value);
                context.fillRect(column * cell, row * cell, cell, cell);
            }
        }
        // Diagonal marker so the reader can orient in a large matrix.
        if (cell >= 3) {
            context.strokeStyle = CHROME.surface;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(0, 0);
            context.lineTo(edge, edge);
            context.stroke();
        }
    }, [matrix, size, displayOrder, cell, edge]);
    const handleMove = useCallback((event) => {
        const canvas = canvasRef.current;
        if (!canvas || size === 0)
            return;
        const rect = canvas.getBoundingClientRect();
        const column = Math.floor((event.clientX - rect.left) / cell);
        const row = Math.floor((event.clientY - rect.top) / cell);
        if (row < 0 || row >= size || column < 0 || column >= size) {
            setHover(null);
            return;
        }
        const rowIndex = displayOrder[row];
        const columnIndex = displayOrder[column];
        setHover({
            row: rowIndex,
            column: columnIndex,
            value: rowIndex === columnIndex ? 1 : getPair(matrix, size, rowIndex, columnIndex),
            x: column * cell + cell / 2,
            y: row * cell,
        });
    }, [cell, displayOrder, matrix, size]);
    if (size === 0) {
        return (_jsx("p", { className: "py-8 text-center text-xs text-muted-foreground", children: "No sequences were compared." }));
    }
    return (_jsxs("div", { className: cn('relative inline-block', className), children: [_jsx("canvas", { ref: canvasRef, onMouseMove: handleMove, onMouseLeave: () => setHover(null), onClick: () => {
                    if (hover && onSelectPair && hover.row !== hover.column) {
                        onSelectPair(hover.row, hover.column);
                    }
                }, className: cn('block rounded border border-border', onSelectPair ? 'cursor-pointer' : 'cursor-crosshair'), role: "img", "aria-label": `Similarity matrix of ${size} sequences. Use the table view for exact values.` }), hover ? (_jsxs("div", { className: "pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1.5 text-xs whitespace-nowrap shadow-md", style: { left: hover.x, top: Math.max(0, hover.y - 4) }, children: [_jsx("p", { className: "font-mono text-[11px] text-foreground", children: labels[hover.row] ?? hover.row }), _jsx("p", { className: "font-mono text-[11px] text-foreground", children: labels[hover.column] ?? hover.column }), _jsxs("p", { className: "tabular mt-0.5 font-medium text-foreground", children: ["Jaccard ", formatDecimal(hover.value, 3), threshold !== undefined && hover.value >= threshold ? (_jsx("span", { className: "ml-1.5 text-[10px] font-normal text-muted-foreground", children: "at or above threshold" })) : null] })] })) : null] }));
}
/**
 * Scale legend for the sequential ramp.
 *
 * A continuous colour scale is unreadable without one, and the endpoints are
 * labelled with values rather than "low" and "high" so the reader can map a
 * cell back to a number.
 */
export function HeatmapScale({ min = 0, max = 1, label = 'Jaccard similarity', threshold, className, }) {
    const gradient = `linear-gradient(to right, ${SEQUENTIAL.join(', ')})`;
    return (_jsxs("div", { className: cn('flex items-center gap-2', className), children: [_jsx("span", { className: "text-[11px] text-muted-foreground", children: formatDecimal(min, 1) }), _jsxs("div", { className: "relative h-2.5 w-32 overflow-hidden rounded-sm border border-border", children: [_jsx("div", { className: "h-full w-full", style: { background: gradient } }), threshold !== undefined && threshold > min && threshold < max ? (_jsx("div", { className: "absolute top-0 h-full w-px bg-foreground", style: { left: `${((threshold - min) / (max - min)) * 100}%` }, title: `Cluster threshold ${formatDecimal(threshold, 2)}` })) : null] }), _jsx("span", { className: "text-[11px] text-muted-foreground", children: formatDecimal(max, 1) }), _jsx("span", { className: "text-[11px] text-muted-foreground", children: label })] }));
}
