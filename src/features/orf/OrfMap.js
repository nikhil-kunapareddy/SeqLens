import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { SERIES } from '@/components/charts/palette';
import { CHROME } from '@/components/charts/palette';
import { cn } from '@/utils/cn';
import { formatInteger } from '@/utils/format';
/**
 * Six-frame ORF map.
 *
 * One lane per reading frame, with the sequence axis running left to right and
 * each ORF drawn as a bar with a directional point at its 3' end. This is the
 * layout the request asked for, and the reason it is worth the space is that
 * frame membership is the thing you cannot see in a table: a real gene shows one
 * long ORF in one frame while the other five are peppered with short ones.
 *
 * Coordinates are forward-strand for every frame, so a minus-strand ORF sits
 * under the region of the sequence it actually covers rather than being mirrored.
 */
export function OrfMap({ orfs, sequenceLength, width = 760, onSelect, selectedOrf, className, }) {
    const lanes = useMemo(() => {
        const byFrame = new Map();
        for (const strand of ['+', '-']) {
            for (const frame of [1, 2, 3]) {
                byFrame.set(`${strand}${frame}`, []);
            }
        }
        for (const orf of orfs) {
            byFrame.get(`${orf.strand}${orf.frame}`)?.push(orf);
        }
        return [...byFrame.entries()];
    }, [orfs]);
    if (sequenceLength === 0)
        return null;
    const labelWidth = 34;
    const plotWidth = Math.max(80, width - labelWidth - 8);
    const laneHeight = 18;
    const laneGap = 3;
    const axisHeight = 22;
    const height = axisHeight + lanes.length * (laneHeight + laneGap) + 8;
    const xFor = (position) => ((position - 1) / sequenceLength) * plotWidth;
    // Ticks at a round interval that yields five or six labels.
    const tickStep = niceStep(sequenceLength / 5);
    const ticks = [];
    for (let position = 0; position <= sequenceLength; position += tickStep) {
        ticks.push(position);
    }
    return (_jsxs("div", { className: cn('overflow-x-auto', className), children: [_jsxs("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Open reading frame map across six frames of a ${sequenceLength} base sequence, showing ${orfs.length} ORFs. Coordinates are listed in the table beneath.`, children: [_jsxs("g", { transform: `translate(${labelWidth}, 0)`, children: [_jsx("line", { x1: 0, y1: axisHeight - 6, x2: plotWidth, y2: axisHeight - 6, stroke: CHROME.axis, strokeWidth: 1 }), ticks.map((position) => (_jsxs("g", { children: [_jsx("line", { x1: xFor(position + 1), y1: axisHeight - 10, x2: xFor(position + 1), y2: axisHeight - 6, stroke: CHROME.axis, strokeWidth: 1 }), _jsx("text", { x: xFor(position + 1), y: axisHeight - 13, textAnchor: "middle", fontSize: 9, fill: CHROME.muted, children: formatInteger(position) })] }, position)))] }), lanes.map(([frameKey, frameOrfs], laneIndex) => {
                        const y = axisHeight + laneIndex * (laneHeight + laneGap);
                        const isReverse = frameKey.startsWith('-');
                        return (_jsxs("g", { children: [_jsx("text", { x: labelWidth - 6, y: y + laneHeight / 2 + 3, textAnchor: "end", fontSize: 9.5, fill: CHROME.inkSecondary, fontFamily: "ui-monospace, monospace", children: frameKey }), _jsxs("g", { transform: `translate(${labelWidth}, 0)`, children: [_jsx("line", { x1: 0, y1: y + laneHeight / 2, x2: plotWidth, y2: y + laneHeight / 2, stroke: CHROME.grid, strokeWidth: 1 }), frameOrfs.map((orf) => {
                                            const x1 = xFor(orf.start);
                                            const x2 = xFor(orf.end + 1);
                                            const barWidth = Math.max(2, x2 - x1);
                                            const selected = selectedOrf !== null &&
                                                selectedOrf !== undefined &&
                                                selectedOrf.start === orf.start &&
                                                selectedOrf.end === orf.end &&
                                                selectedOrf.strand === orf.strand;
                                            const color = isReverse ? SERIES[1] : SERIES[0];
                                            const point = Math.min(6, barWidth * 0.3);
                                            // Arrow pointing in the direction of translation: right for
                                            // the plus strand, left for the minus strand.
                                            const path = isReverse
                                                ? `M ${x1 + point} ${y + 3} L ${x1 + barWidth} ${y + 3} L ${x1 + barWidth} ${y + laneHeight - 3} L ${x1 + point} ${y + laneHeight - 3} L ${x1} ${y + laneHeight / 2} Z`
                                                : `M ${x1} ${y + 3} L ${x1 + barWidth - point} ${y + 3} L ${x1 + barWidth} ${y + laneHeight / 2} L ${x1 + barWidth - point} ${y + laneHeight - 3} L ${x1} ${y + laneHeight - 3} Z`;
                                            return (_jsxs("g", { className: onSelect ? 'cursor-pointer' : undefined, onClick: () => onSelect?.(orf), children: [_jsx("title", { children: `${orf.strand}${orf.frame} ${formatInteger(orf.start)}-${formatInteger(orf.end)} (${formatInteger(orf.aminoAcidLength)} aa, ${orf.startCodon}${orf.stopCodon ? ` to ${orf.stopCodon}` : ', partial'})` }), _jsx("path", { d: path, fill: color, fillOpacity: selected ? 1 : 0.72, stroke: selected ? CHROME.ink : CHROME.surface, strokeWidth: selected ? 1.5 : 1 }), barWidth > 54 ? (_jsxs("text", { x: x1 + barWidth / 2, y: y + laneHeight / 2 + 3, textAnchor: "middle", fontSize: 8.5, fill: "#ffffff", fontFamily: "ui-monospace, monospace", pointerEvents: "none", children: [formatInteger(orf.aminoAcidLength), " aa"] })) : null] }, `${orf.start}-${orf.end}-${orf.strand}-${orf.frame}`));
                                        })] })] }, frameKey));
                    })] }), _jsxs("ul", { className: "flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1", children: [_jsxs("li", { className: "flex items-center gap-1.5 text-[11px] text-muted-foreground", children: [_jsx("svg", { width: "16", height: "9", viewBox: "0 0 16 9", "aria-hidden": true, children: _jsx("path", { d: "M0 0 L11 0 L16 4.5 L11 9 L0 9 Z", fill: SERIES[0], fillOpacity: 0.72 }) }), "Forward strand"] }), _jsxs("li", { className: "flex items-center gap-1.5 text-[11px] text-muted-foreground", children: [_jsx("svg", { width: "16", height: "9", viewBox: "0 0 16 9", "aria-hidden": true, children: _jsx("path", { d: "M5 0 L16 0 L16 9 L5 9 L0 4.5 Z", fill: SERIES[1], fillOpacity: 0.72 }) }), "Reverse strand"] }), _jsx("li", { className: "text-[11px] text-muted-foreground", children: "The point marks the 3\u2032 end. Coordinates are on the forward strand for both strands." })] })] }));
}
/** Rounds a tick interval up to 1, 2, or 5 times a power of ten. */
function niceStep(raw) {
    if (raw <= 0)
        return 1;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalised = raw / magnitude;
    const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
    return Math.max(1, step * magnitude);
}
