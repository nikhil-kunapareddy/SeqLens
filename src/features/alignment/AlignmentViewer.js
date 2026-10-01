import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { AMINO_CLASS, AMINO_CLASS_WASH, BASE_WASH, STATUS, } from '@/components/charts/palette';
import { Switch, Label } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { formatDecimal, formatInteger } from '@/utils/format';
const LABEL_WIDTH = 150;
const BLOCK_WIDTH = 60;
/**
 * Multiple alignment viewer.
 *
 * Alignments are laid out in blocks of 60 columns, the convention every
 * alignment tool uses, because a 6,000-column alignment cannot be read on one
 * line. Blocks are virtualised: only the blocks in view are mounted, so a
 * 60-sequence by 6,000-column alignment - 360,000 residues - renders as a few
 * thousand DOM nodes rather than all of them.
 *
 * The default colouring is difference-from-consensus rather than
 * residue-identity, because that is what an alignment is read for: a wall of
 * uniformly coloured residues hides exactly the columns worth seeing.
 */
export function AlignmentViewer({ rows, consensus, columns, isProtein, conservedThreshold, referenceRow = 0, height = 460, className, }) {
    const [mode, setMode] = useState('difference');
    const [showConservation, setShowConservation] = useState(true);
    const alignmentLength = rows[0]?.aligned.length ?? 0;
    const blockCount = Math.max(1, Math.ceil(alignmentLength / BLOCK_WIDTH));
    const reference = rows[referenceRow]?.aligned ?? consensus;
    const scrollRef = useRef(null);
    const virtualizer = useVirtualizer({
        count: blockCount,
        getScrollElement: () => scrollRef.current,
        // Each block is: ruler + conservation track + one line per row + consensus.
        estimateSize: () => 26 + (showConservation ? 14 : 0) + (rows.length + 1) * 15 + 12,
        overscan: 3,
    });
    const maxConservation = useMemo(() => Math.max(...columns.map((column) => column.conservation), 1), [columns]);
    if (alignmentLength === 0) {
        return (_jsx("p", { className: "py-8 text-center text-xs text-muted-foreground", children: "The alignment is empty." }));
    }
    return (_jsxs("div", { className: cn('overflow-hidden rounded-lg border border-border bg-card', className), children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 border-b border-border bg-subtle px-3 py-2", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Switch, { id: "alignment-mode", checked: mode === 'difference', onCheckedChange: (checked) => setMode(checked ? 'difference' : 'residue') }), _jsx(Label, { htmlFor: "alignment-mode", className: "cursor-pointer text-[11px]", children: "Highlight differences only" })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Switch, { id: "alignment-conservation", checked: showConservation, onCheckedChange: setShowConservation }), _jsx(Label, { htmlFor: "alignment-conservation", className: "cursor-pointer text-[11px]", children: "Conservation track" })] }), _jsxs("span", { className: "tabular ml-auto text-[11px] text-muted-foreground", children: [formatInteger(rows.length), " sequences \u00D7 ", formatInteger(alignmentLength), " columns"] })] }), _jsx("div", { ref: scrollRef, className: "overflow-auto", style: { height }, children: _jsx("div", { style: { height: virtualizer.getTotalSize(), position: 'relative' }, children: virtualizer.getVirtualItems().map((item) => {
                        const from = item.index * BLOCK_WIDTH;
                        const to = Math.min(alignmentLength, from + BLOCK_WIDTH);
                        return (_jsxs("div", { "data-index": item.index, ref: virtualizer.measureElement, className: "absolute top-0 left-0 w-full border-b border-border/70 px-3 py-2", style: { transform: `translateY(${item.start}px)` }, children: [_jsxs("div", { className: "flex", children: [_jsx("span", { className: "shrink-0 pr-2", style: { width: LABEL_WIDTH }, "aria-hidden": true }), _jsx("span", { className: "residues text-[9px] text-muted-foreground select-none", children: buildRuler(from, to) })] }), showConservation ? (_jsxs("div", { className: "flex items-end", children: [_jsx("span", { className: "shrink-0 pr-2 text-right text-[9px] text-muted-foreground select-none", style: { width: LABEL_WIDTH }, children: "conservation" }), _jsx("div", { className: "flex h-3 items-end", children: columns.slice(from, to).map((column) => (_jsx("span", { title: `Column ${column.position}: ${formatDecimal(column.conservation * 100, 0)}% conserved, ${formatDecimal(column.gapFraction * 100, 0)}% gaps`, style: {
                                                    width: '1ch',
                                                    height: `${Math.max(1, (column.conservation / maxConservation) * 12)}px`,
                                                    backgroundColor: column.conservation >= conservedThreshold
                                                        ? STATUS.pass
                                                        : column.conservation >= 0.5
                                                            ? STATUS.warning
                                                            : STATUS.review,
                                                    opacity: 0.55,
                                                } }, column.position))) })] })) : null, rows.map((row, rowIndex) => (_jsxs("div", { className: "flex items-baseline", children: [_jsx("span", { className: "shrink-0 truncate pr-2 text-right font-mono text-[10px] text-muted-foreground", style: { width: LABEL_WIDTH }, title: row.id, children: rowIndex === referenceRow ? (_jsx("span", { className: "font-semibold text-foreground", children: row.id })) : (row.id) }), _jsx("span", { className: "residues text-[11px]", children: [...row.aligned.slice(from, to)].map((residue, offset) => {
                                                const column = from + offset;
                                                const referenceResidue = reference[column];
                                                const differs = residue !== referenceResidue;
                                                const isGap = residue === '-';
                                                let background;
                                                if (mode === 'difference') {
                                                    if (isGap)
                                                        background = '#f1f3f5';
                                                    else if (differs && rowIndex !== referenceRow)
                                                        background = '#fde68a';
                                                }
                                                else {
                                                    background = isGap
                                                        ? '#f1f3f5'
                                                        : isProtein
                                                            ? AMINO_CLASS_WASH[AMINO_CLASS[residue] ?? 'special']
                                                            : (BASE_WASH[residue] ?? BASE_WASH.N);
                                                }
                                                return (_jsx("span", { style: { backgroundColor: background }, className: isGap ? 'text-muted-foreground' : 'text-foreground', children: residue }, offset));
                                            }) }), _jsx("span", { className: "tabular pl-2 text-[9px] text-muted-foreground select-none", children: formatInteger(ungappedPosition(row.aligned, to)) })] }, row.index))), _jsxs("div", { className: "mt-0.5 flex items-baseline border-t border-border pt-0.5", children: [_jsx("span", { className: "shrink-0 pr-2 text-right text-[10px] font-semibold text-foreground", style: { width: LABEL_WIDTH }, children: "consensus" }), _jsx("span", { className: "residues text-[11px] font-semibold text-foreground", children: consensus.slice(from, to) })] })] }, item.key));
                    }) }) }), _jsxs("div", { className: "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-subtle px-3 py-1.5", children: [mode === 'difference' ? (_jsxs(_Fragment, { children: [_jsx(LegendSwatch, { color: "#fde68a", label: "Differs from the reference row" }), _jsx(LegendSwatch, { color: "#f1f3f5", label: "Gap" })] })) : isProtein ? (_jsxs(_Fragment, { children: [_jsx(LegendSwatch, { color: AMINO_CLASS_WASH.hydrophobic, label: "Hydrophobic" }), _jsx(LegendSwatch, { color: AMINO_CLASS_WASH.polar, label: "Polar" }), _jsx(LegendSwatch, { color: AMINO_CLASS_WASH.acidic, label: "Acidic" }), _jsx(LegendSwatch, { color: AMINO_CLASS_WASH.basic, label: "Basic" }), _jsx(LegendSwatch, { color: AMINO_CLASS_WASH.aromatic, label: "Aromatic" })] })) : (_jsxs(_Fragment, { children: [_jsx(LegendSwatch, { color: BASE_WASH.A, label: "A" }), _jsx(LegendSwatch, { color: BASE_WASH.C, label: "C" }), _jsx(LegendSwatch, { color: BASE_WASH.G, label: "G" }), _jsx(LegendSwatch, { color: BASE_WASH.T, label: "T / U" })] })), showConservation ? (_jsxs(_Fragment, { children: [_jsx(LegendSwatch, { color: STATUS.pass, label: `Conserved (at or above ${formatDecimal(conservedThreshold * 100, 0)}%)` }), _jsx(LegendSwatch, { color: STATUS.warning, label: "50-90% conserved" }), _jsx(LegendSwatch, { color: STATUS.review, label: "Variable (below 50%)" })] })) : null] })] }));
}
function LegendSwatch({ color, label }) {
    return (_jsxs("span", { className: "flex items-center gap-1 text-[10px] text-muted-foreground", children: [_jsx("span", { className: "size-2.5 rounded-[2px] border border-border", style: { backgroundColor: color }, "aria-hidden": true }), label] }));
}
/**
 * Tick labels every ten columns, aligned to the residue grid.
 *
 * Each label is written right-aligned so its last digit sits directly over the
 * column it names, which is the only way a ruler above a monospace grid is
 * readable. Labels that would start before the block are clipped rather than
 * shifted, so no label ever points at the wrong column.
 */
function buildRuler(from, to) {
    const width = to - from;
    const characters = new Array(width).fill(' ');
    for (let column = from; column < to; column += 1) {
        const oneBased = column + 1;
        if (oneBased % 10 !== 0)
            continue;
        const label = String(oneBased);
        const end = column - from;
        for (let i = 0; i < label.length; i += 1) {
            const target = end - (label.length - 1) + i;
            if (target >= 0 && target < width)
                characters[target] = label[i];
        }
    }
    return characters.join('');
}
/** Ungapped position in the original sequence at an alignment column. */
function ungappedPosition(aligned, column) {
    let count = 0;
    for (let i = 0; i < Math.min(column, aligned.length); i += 1) {
        if (aligned[i] !== '-' && aligned[i] !== '.')
            count += 1;
    }
    return count;
}
