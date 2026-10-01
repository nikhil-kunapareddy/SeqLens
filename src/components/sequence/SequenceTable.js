import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { Checkbox, Input } from '@/components/ui/primitives';
import { gcPercentFromIndex, idFromIndex } from '@/storage/sequenceStore';
import { cn } from '@/utils/cn';
import { useDebouncedValue } from '@/utils/debounce';
import { formatDecimal, formatInteger } from '@/utils/format';
const ROW_HEIGHT = 30;
/**
 * Virtualised dataset browser.
 *
 * Every column comes from the compact index, never from the residues: a
 * ten-million-sequence dataset lists, sorts, and filters without a single block
 * read. Residues are fetched only when a row is opened in the viewer.
 *
 * Sorting produces a permutation of indices rather than reordering the index
 * itself, which is shared with every other view and must stay in import order.
 */
export function SequenceTable({ dataset, index, selected, onToggle, onFocus, focusedIndex, restrictTo, height = 460, className, selectable = true, }) {
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState('index');
    const [direction, setDirection] = useState('asc');
    const debouncedQuery = useDebouncedValue(query, 220);
    const isProtein = dataset.sequenceType === 'protein';
    const hasQuality = dataset.format === 'fastq' && index.meanQuality.length > 0;
    const selectedSet = useMemo(() => new Set(selected ?? []), [selected]);
    /**
     * Row order after filtering and sorting.
     *
     * Recomputed only when the query, sort, or restriction changes - not on
     * scroll - so scrolling a filtered million-row table stays free.
     */
    const rows = useMemo(() => {
        const needle = debouncedQuery.trim().toLowerCase();
        const candidates = [];
        for (let i = 0; i < index.count; i += 1) {
            if (restrictTo !== undefined && !restrictTo.has(i))
                continue;
            if (needle.length > 0) {
                const id = idFromIndex(index, i).toLowerCase();
                if (!id.includes(needle))
                    continue;
            }
            candidates.push(i);
        }
        if (sortKey === 'index' && direction === 'asc')
            return candidates;
        const sign = direction === 'asc' ? 1 : -1;
        const valueOf = (i) => {
            switch (sortKey) {
                case 'length':
                    return index.lengths[i];
                case 'gc':
                    return gcPercentFromIndex(index, i);
                case 'ambiguous':
                    return index.lengths[i] === 0 ? 0 : index.ambiguousCounts[i] / index.lengths[i];
                case 'quality':
                    return index.meanQuality[i] ?? 0;
                default:
                    return i;
            }
        };
        if (sortKey === 'id') {
            return candidates.sort((a, b) => sign * idFromIndex(index, a).localeCompare(idFromIndex(index, b)));
        }
        return candidates.sort((a, b) => sign * (valueOf(a) - valueOf(b)) || a - b);
    }, [index, debouncedQuery, sortKey, direction, restrictTo]);
    const scrollRef = useRef(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 12,
    });
    // Scroll the focused row into view when focus changes from elsewhere.
    useEffect(() => {
        if (focusedIndex === null || focusedIndex === undefined)
            return;
        const position = rows.indexOf(focusedIndex);
        if (position >= 0)
            virtualizer.scrollToIndex(position, { align: 'auto' });
        // Intentionally not re-running on `rows`: a filter change should not yank
        // the viewport back to the focused row.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusedIndex]);
    const toggleSort = useCallback((key) => {
        if (key === sortKey) {
            setDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortKey(key);
        // Numeric columns are most useful largest-first on the first click.
        setDirection(key === 'index' || key === 'id' ? 'asc' : 'desc');
    }, [sortKey]);
    const allVisibleSelected = rows.length > 0 && selectedSet.size > 0 && rows.every((row) => selectedSet.has(row));
    const columns = [
        { key: 'index', label: '#', width: '4.5rem', numeric: true },
        { key: 'id', label: 'Identifier', width: 'minmax(8rem, 1fr)' },
        { key: 'length', label: isProtein ? 'Residues' : 'Length', width: '6.5rem', numeric: true },
        ...(isProtein ? [] : [{ key: 'gc', label: 'GC %', width: '5.5rem', numeric: true }]),
        { key: 'ambiguous', label: 'Ambig. %', width: '6rem', numeric: true },
        ...(hasQuality
            ? [{ key: 'quality', label: 'Mean Q', width: '5.5rem', numeric: true }]
            : []),
    ];
    const gridTemplate = `${selectable ? '2rem ' : ''}${columns.map((c) => c.width).join(' ')}`;
    return (_jsxs("div", { className: cn('flex flex-col overflow-hidden rounded-lg border border-border bg-card', className), children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2", children: [_jsxs("div", { className: "relative min-w-40 flex-1", children: [_jsx(Search, { className: "pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" }), _jsx(Input, { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Filter by identifier", className: "h-7 pr-7 pl-7 text-xs", "aria-label": "Filter sequences by identifier" }), query ? (_jsx("button", { type: "button", onClick: () => setQuery(''), className: "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground", "aria-label": "Clear filter", children: _jsx(X, { className: "size-3" }) })) : null] }), _jsxs(Badge, { variant: "default", children: [formatInteger(rows.length), rows.length !== index.count ? ` of ${formatInteger(index.count)}` : '', " sequences"] }), selectable && selected !== undefined ? (_jsxs(_Fragment, { children: [selected.length > 0 ? (_jsxs(Badge, { variant: "primary", children: [formatInteger(selected.length), " selected"] })) : null, _jsx(Button, { variant: "outline", size: "sm", className: "h-7", onClick: () => {
                                    if (!onToggle)
                                        return;
                                    // Toggling the visible page rather than the whole dataset: an
                                    // alignment selection is capped, and "select all" on a million
                                    // rows would silently truncate.
                                    const target = rows.slice(0, 200);
                                    if (allVisibleSelected) {
                                        for (const row of target)
                                            if (selectedSet.has(row))
                                                onToggle(row);
                                    }
                                    else {
                                        for (const row of target)
                                            if (!selectedSet.has(row))
                                                onToggle(row);
                                    }
                                }, children: allVisibleSelected ? 'Clear' : 'Select first 200' })] })) : null] }), _jsxs("div", { className: "grid items-center gap-2 border-b border-border bg-subtle px-3 py-1.5 text-[11px] font-medium text-muted-foreground", style: { gridTemplateColumns: gridTemplate }, role: "row", children: [selectable ? _jsx("span", { "aria-hidden": true }) : null, columns.map((column) => (_jsxs("button", { type: "button", onClick: () => toggleSort(column.key), className: cn('flex items-center gap-1 rounded-sm transition-colors hover:text-foreground', column.numeric ? 'justify-end' : 'justify-start'), "aria-sort": sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none', children: [column.label, sortKey === column.key ? (direction === 'asc' ? (_jsx(ArrowUp, { className: "size-3" })) : (_jsx(ArrowDown, { className: "size-3" }))) : null] }, column.key)))] }), _jsx("div", { ref: scrollRef, className: "overflow-auto", style: { height }, children: rows.length === 0 ? (_jsx("p", { className: "px-3 py-10 text-center text-xs text-muted-foreground", children: index.count === 0
                        ? 'This dataset contains no sequences.'
                        : 'No sequences match the current filter.' })) : (_jsx("div", { style: { height: virtualizer.getTotalSize(), position: 'relative' }, children: virtualizer.getVirtualItems().map((item) => {
                        const sequenceIndex = rows[item.index];
                        const length = index.lengths[sequenceIndex];
                        const ambiguousPercent = length === 0 ? 0 : (index.ambiguousCounts[sequenceIndex] / length) * 100;
                        const isFocused = focusedIndex === sequenceIndex;
                        const isSelected = selectedSet.has(sequenceIndex);
                        return (_jsxs("div", { className: cn('absolute top-0 left-0 grid w-full cursor-pointer items-center gap-2 border-b border-border px-3 text-xs transition-colors', isFocused ? 'bg-primary-soft' : 'hover:bg-muted/70'), style: {
                                height: ROW_HEIGHT,
                                transform: `translateY(${item.start}px)`,
                                gridTemplateColumns: gridTemplate,
                            }, onClick: () => onFocus?.(sequenceIndex), role: "row", children: [selectable ? (_jsx("span", { className: "flex items-center", onClick: (event) => {
                                        // The checkbox toggles selection; the row opens the
                                        // viewer. Without this the two actions fight.
                                        event.stopPropagation();
                                    }, children: _jsx(Checkbox, { checked: isSelected, onCheckedChange: () => onToggle?.(sequenceIndex), "aria-label": `Select ${idFromIndex(index, sequenceIndex)}` }) })) : null, _jsx("span", { className: "tabular text-right text-muted-foreground", children: formatInteger(sequenceIndex + 1) }), _jsx("span", { className: "truncate font-mono text-foreground", title: idFromIndex(index, sequenceIndex), children: idFromIndex(index, sequenceIndex) }), _jsx("span", { className: "tabular text-right text-foreground", children: formatInteger(length) }), isProtein ? null : (_jsx("span", { className: "tabular text-right text-foreground", children: length === 0 ? '-' : formatDecimal(gcPercentFromIndex(index, sequenceIndex), 1) })), _jsx("span", { className: cn('tabular text-right', ambiguousPercent > 5 ? 'text-destructive' : 'text-muted-foreground'), children: ambiguousPercent === 0 ? '0' : formatDecimal(ambiguousPercent, 2) }), hasQuality ? (_jsx("span", { className: "tabular text-right text-foreground", children: formatDecimal(index.meanQuality[sequenceIndex] ?? 0, 1) })) : null] }, item.key));
                    }) })) })] }));
}
