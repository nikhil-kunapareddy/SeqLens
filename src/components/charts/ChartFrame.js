import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Download, HelpCircle, Table2, BarChart3 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger, ToggleGroup, ToggleGroupItem, } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { MIME, recordsToCsv, saveFile } from '@/utils/export';
import { slugify } from '@/utils/format';
/**
 * Wrapper that gives every chart its table-view twin.
 *
 * This is not a convenience. Three of the categorical slots sit below 3:1
 * contrast on white, and a colour scale cannot be read by a colourblind reader
 * or in a forced-colours mode - in both cases the documented mitigation is that
 * the same values are reachable as text. Putting the table behind a toggle on
 * every chart discharges that obligation once, rather than per chart, and gives
 * the CSV export somewhere natural to live.
 *
 * The container sizes itself to the plot plus the axis band, so the x-axis
 * labels are never clipped into a nested scrollbar.
 */
export function ChartFrame({ title, description, help, footnote, data, columns, exportName, actions, height = 240, className, children, }) {
    const [view, setView] = useState('chart');
    const headingId = useId();
    const hasTable = Boolean(data && columns && data.length > 0);
    const csv = useMemo(() => {
        if (!hasTable || !data || !columns)
            return '';
        return recordsToCsv(data.map((row) => {
            const mapped = {};
            for (const column of columns) {
                const value = row[column.key];
                mapped[column.header] = column.format ? column.format(value) : value;
            }
            return mapped;
        }));
    }, [data, columns, hasTable]);
    const download = async () => {
        const name = `${slugify(exportName ?? title)}.csv`;
        await saveFile(csv, {
            suggestedName: name,
            mimeType: MIME.csv,
            description: 'CSV table',
            extensions: ['.csv'],
        });
    };
    return (_jsxs(Card, { className: cn('overflow-hidden', className), children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3", children: [_jsxs("div", { className: "min-w-0 space-y-1", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("h3", { id: headingId, className: "text-[13px] font-semibold tracking-tight text-foreground", children: title }), help ? (_jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx("button", { type: "button", className: "rounded-sm text-muted-foreground transition-colors hover:text-foreground", "aria-label": `What "${title}" measures`, children: _jsx(HelpCircle, { className: "size-3.5" }) }) }), _jsx(TooltipContent, { side: "top", children: help })] })) : null] }), description ? (_jsx("p", { className: "max-w-2xl text-xs leading-relaxed text-muted-foreground", children: description })) : null] }), _jsxs("div", { className: "flex shrink-0 items-center gap-1.5", children: [actions, hasTable ? (_jsxs(_Fragment, { children: [_jsxs(ToggleGroup, { type: "single", value: view, onValueChange: (next) => {
                                            if (next === 'chart' || next === 'table')
                                                setView(next);
                                        }, "aria-label": "View mode", children: [_jsx(ToggleGroupItem, { value: "chart", "aria-label": "Chart view", title: "Chart view", children: _jsx(BarChart3, {}) }), _jsx(ToggleGroupItem, { value: "table", "aria-label": "Table view", title: "Table view", children: _jsx(Table2, {}) })] }), _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => void download(), title: "Download this chart's data as CSV", "aria-label": "Download CSV", children: _jsx(Download, {}) })] })) : null] })] }), view === 'chart' ? (_jsx("div", { className: "px-2 pt-3 pb-2", role: "img", "aria-labelledby": headingId, children: _jsx("div", { style: { height }, children: children }) })) : (_jsx(ChartDataTable, { data: data ?? [], columns: columns ?? [], maxHeight: height + 48 })), footnote ? (_jsx("div", { className: "border-t border-border bg-subtle px-4 py-2", children: _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: footnote }) })) : null] }));
}
/** The table twin: every plotted value, as text. */
export function ChartDataTable({ data, columns, maxHeight = 280, }) {
    // Long series are truncated in the on-screen table; the CSV export is
    // complete, and the footer says so rather than leaving it implied.
    const LIMIT = 500;
    const rows = data.length > LIMIT ? data.slice(0, LIMIT) : data;
    return (_jsxs("div", { className: "overflow-auto", style: { maxHeight }, children: [_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 z-10 bg-card", children: _jsx("tr", { className: "border-b border-border", children: columns.map((column) => (_jsx("th", { scope: "col", className: cn('px-3 py-1.5 font-medium text-muted-foreground', column.numeric ? 'text-right' : 'text-left'), children: column.header }, column.key))) }) }), _jsx("tbody", { children: rows.map((row, index) => (_jsx("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: columns.map((column) => {
                                const value = row[column.key];
                                const text = column.format
                                    ? column.format(value)
                                    : value === null || value === undefined
                                        ? '-'
                                        : String(value);
                                return (_jsx("td", { className: cn('px-3 py-1 text-foreground', column.numeric ? 'text-right tabular' : 'text-left'), children: text }, column.key));
                            }) }, index))) })] }), data.length > LIMIT ? (_jsxs("p", { className: "border-t border-border bg-subtle px-3 py-1.5 text-[11px] text-muted-foreground", children: ["Showing the first ", LIMIT.toLocaleString(), " of ", data.length.toLocaleString(), " rows. The CSV export contains all of them."] })) : null] }));
}
