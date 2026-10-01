import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, } from 'recharts';
import { cn } from '@/utils/cn';
import { CHROME, SERIES, STATUS, seriesColor } from './palette';
/**
 * Shared Recharts configuration.
 *
 * Marks are thin, gridlines are solid hairlines one shade off the surface, and
 * axis chrome is recessive. Entry animations are off: a chart that animates
 * every time a threshold slider moves is noise, and Recharts re-animates on
 * every data change by default.
 */
const AXIS_PROPS = {
    stroke: CHROME.axis,
    tick: { fill: CHROME.muted, fontSize: 11 },
    tickLine: { stroke: CHROME.axis },
};
const GRID_PROPS = {
    stroke: CHROME.grid,
    strokeDasharray: undefined,
    vertical: false,
};
export const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 4 };
/** Recharts types the axis label as a ReactNode; only scalars are displayable. */
const scalarLabel = (label) => typeof label === 'string' || typeof label === 'number' ? label : undefined;
const renderTooltipValue = (value) => {
    if (value === undefined || value === null)
        return '-';
    if (Array.isArray(value))
        return value.map((entry) => String(entry)).join(' - ');
    return typeof value === 'number' ? value.toLocaleString() : String(value);
};
/**
 * Hover readout.
 *
 * Present on every chart by default, because an HTML chart is interactive and a
 * reader who can hover expects to. It enhances rather than gates: the same
 * values are always in the table view.
 */
export function ChartTooltip({ active, label, payload, labelFormatter, valueFormatter, hideSwatch, }) {
    if (!active || !payload || payload.length === 0)
        return null;
    return (_jsxs("div", { className: "rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md", children: [label !== undefined ? (_jsx("p", { className: "mb-1 font-medium text-foreground", children: labelFormatter ? labelFormatter(label) : label })) : null, _jsx("div", { className: "space-y-0.5", children: payload.map((entry, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [hideSwatch ? null : (_jsx("span", { className: "size-2 shrink-0 rounded-[2px]", style: { backgroundColor: entry.color ?? SERIES[0] }, "aria-hidden": true })), payload.length > 1 ? (_jsx("span", { className: "text-muted-foreground", children: entry.name })) : null, _jsx("span", { className: "tabular ml-auto font-medium text-foreground", children: valueFormatter
                                ? valueFormatter(entry.value, entry.name)
                                : renderTooltipValue(entry.value) })] }, index))) })] }));
}
/**
 * Legend, rendered outside the plot.
 *
 * Always present when there are two or more series, so identity never rests on
 * colour alone. A single-series chart has no legend: its title names the series.
 */
export function ChartLegend({ items, className, }) {
    if (items.length < 2)
        return null;
    return (_jsx("ul", { className: cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1', className), children: items.map((item) => (_jsxs("li", { className: "flex items-center gap-1.5 text-[11px] text-muted-foreground", children: [_jsx(LegendGlyph, { color: item.color, shape: item.shape }), _jsx("span", { children: item.label }), item.value ? _jsx("span", { className: "tabular text-foreground", children: item.value }) : null] }, item.label))) }));
}
function LegendGlyph({ color, shape = 'square' }) {
    if (shape === 'circle') {
        return (_jsx("svg", { width: "9", height: "9", viewBox: "0 0 9 9", "aria-hidden": true, children: _jsx("circle", { cx: "4.5", cy: "4.5", r: "4", fill: color }) }));
    }
    if (shape === 'triangle') {
        return (_jsx("svg", { width: "9", height: "9", viewBox: "0 0 9 9", "aria-hidden": true, children: _jsx("polygon", { points: "4.5,0.5 8.5,8 0.5,8", fill: color }) }));
    }
    if (shape === 'diamond') {
        return (_jsx("svg", { width: "9", height: "9", viewBox: "0 0 9 9", "aria-hidden": true, children: _jsx("polygon", { points: "4.5,0.5 8.5,4.5 4.5,8.5 0.5,4.5", fill: color }) }));
    }
    return (_jsx("span", { className: "size-2.5 shrink-0 rounded-[2px]", style: { backgroundColor: color }, "aria-hidden": true }));
}
/**
 * Bar histogram for a single distribution.
 *
 * One series, one colour. Colouring bars darker-where-taller would double-encode
 * the height and burn the only free channel on information the bar length
 * already carries.
 */
export function Histogram({ data, xKey, yKey, xLabel, yLabel, color = SERIES[0], colorFor, xTickFormatter, yTickFormatter, tooltipLabel, tooltipValue, markers, }) {
    return (_jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(BarChart, { data: data, margin: { ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }, children: [_jsx(CartesianGrid, { ...GRID_PROPS }), _jsx(XAxis, { dataKey: xKey, ...AXIS_PROPS, tickFormatter: xTickFormatter, label: xLabel
                        ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
                        : undefined, minTickGap: 12 }), _jsx(YAxis, { ...AXIS_PROPS, tickFormatter: yTickFormatter, width: 52, label: yLabel
                        ? {
                            value: yLabel,
                            angle: -90,
                            position: 'insideLeft',
                            fill: CHROME.muted,
                            fontSize: 11,
                            style: { textAnchor: 'middle' },
                        }
                        : undefined }), _jsx(RechartsTooltip, { cursor: { fill: CHROME.grid, fillOpacity: 0.6 }, content: ({ active, payload }) => {
                        const row = payload?.[0]?.payload;
                        if (!active || !row)
                            return null;
                        return (_jsx(ChartTooltip, { active: true, hideSwatch: true, label: tooltipLabel ? tooltipLabel(row) : String(row[xKey]), payload: [
                                {
                                    value: tooltipValue ? tooltipValue(row) : Number(row[yKey]).toLocaleString(),
                                    color,
                                },
                            ] }));
                    } }), markers?.map((marker) => (_jsx(ReferenceLine, { x: marker.value, stroke: marker.color ?? CHROME.inkSecondary, strokeWidth: 1, label: { value: marker.label, position: 'top', fill: CHROME.muted, fontSize: 10 } }, marker.label))), _jsx(Bar, { dataKey: yKey, fill: color, radius: [4, 4, 0, 0], isAnimationActive: false, maxBarSize: 48, children: colorFor
                        ? data.map((row, index) => (_jsx(Cell, { fill: colorFor(row, index) }, index)))
                        : null })] }) }));
}
/** Multi-series line chart with a crosshair tooltip. */
export function LineSeriesChart({ data, xKey, series, xLabel, yLabel, yDomain, xTickFormatter, yTickFormatter, valueFormatter, bands, }) {
    return (_jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(LineChart, { data: data, margin: { ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }, children: [_jsx(CartesianGrid, { ...GRID_PROPS }), bands?.map((band) => (_jsx(ReferenceArea, { y1: band.from, y2: band.to, fill: band.color, fillOpacity: 0.09, stroke: "none", ifOverflow: "hidden" }, `${band.from}-${band.to}`))), _jsx(XAxis, { dataKey: xKey, ...AXIS_PROPS, tickFormatter: xTickFormatter, minTickGap: 16, label: xLabel
                        ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
                        : undefined }), _jsx(YAxis, { ...AXIS_PROPS, domain: yDomain, tickFormatter: yTickFormatter, width: 52, label: yLabel
                        ? {
                            value: yLabel,
                            angle: -90,
                            position: 'insideLeft',
                            fill: CHROME.muted,
                            fontSize: 11,
                            style: { textAnchor: 'middle' },
                        }
                        : undefined }), _jsx(RechartsTooltip, { cursor: { stroke: CHROME.axis, strokeWidth: 1 }, content: (props) => (_jsx(ChartTooltip, { active: props.active, label: scalarLabel(props.label), payload: props.payload, hideSwatch: series.length < 2, valueFormatter: valueFormatter })) }), series.map((spec, index) => (_jsx(Line, { type: "monotone", dataKey: spec.key, name: spec.label, stroke: spec.color ?? seriesColor(index), strokeWidth: 2, dot: false, activeDot: { r: 4, strokeWidth: 2, stroke: CHROME.surface }, isAnimationActive: false }, spec.key)))] }) }));
}
/* -------------------------------------------------------------------------- */
/* Stacked area                                                               */
/* -------------------------------------------------------------------------- */
/**
 * Stacked composition over position.
 *
 * A 1px surface-coloured stroke between segments provides the 2px effective gap
 * that separates adjacent fills. That gap is also the secondary encoding the
 * nucleotide palette needs: the red/green pair sits in the colour-vision warn
 * band, so the boundary has to be visible independently of hue.
 */
export function StackedAreaChart({ data, xKey, series, xLabel, yLabel, yTickFormatter, valueFormatter, }) {
    // The 1px surface stroke separates adjacent bands, but once there are more
    // points than pixels it covers more of each band than the fill does and reads
    // as jitter. Past ~200 points the bands are left to meet at their own edges.
    const separate = data.length <= 200;
    return (_jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(AreaChart, { data: data, margin: { ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }, children: [_jsx(CartesianGrid, { ...GRID_PROPS }), _jsx(XAxis, { dataKey: xKey, ...AXIS_PROPS, minTickGap: 20, label: xLabel
                        ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
                        : undefined }), _jsx(YAxis, { ...AXIS_PROPS, width: 52, tickFormatter: yTickFormatter, label: yLabel
                        ? {
                            value: yLabel,
                            angle: -90,
                            position: 'insideLeft',
                            fill: CHROME.muted,
                            fontSize: 11,
                            style: { textAnchor: 'middle' },
                        }
                        : undefined }), _jsx(RechartsTooltip, { cursor: { stroke: CHROME.axis, strokeWidth: 1 }, content: (props) => (_jsx(ChartTooltip, { active: props.active, label: scalarLabel(props.label), payload: props.payload, valueFormatter: valueFormatter })) }), series.map((spec, index) => (_jsx(Area, { type: "monotone", dataKey: spec.key, name: spec.label, stackId: "composition", stroke: separate ? CHROME.surface : (spec.color ?? seriesColor(index)), strokeWidth: separate ? 1 : 0, fill: spec.color ?? seriesColor(index), fillOpacity: 0.92, isAnimationActive: false }, spec.key)))] }) }));
}
/* -------------------------------------------------------------------------- */
/* Horizontal bar list                                                        */
/* -------------------------------------------------------------------------- */
/**
 * Ranked horizontal bars, for top-N lists such as k-mer frequencies.
 *
 * Plain HTML rather than a chart library: the bars are one div each, the labels
 * are real text (so they are searchable and never clipped), and there is no
 * axis to collide with. For a ranked list that is both lighter and more
 * readable than an SVG bar chart.
 */
export function BarList({ items, valueFormatter, color = SERIES[0], maxItems = 20, emptyLabel = 'No entries', }) {
    if (items.length === 0) {
        return _jsx("p", { className: "px-2 py-6 text-center text-xs text-muted-foreground", children: emptyLabel });
    }
    const max = Math.max(...items.map((item) => item.value), 1);
    const shown = items.slice(0, maxItems);
    return (_jsx("ol", { className: "space-y-1 overflow-y-auto px-2", style: { maxHeight: '100%' }, children: shown.map((item) => (_jsxs("li", { className: "group relative", children: [_jsxs("div", { className: "flex items-baseline justify-between gap-3 py-0.5", children: [_jsx("span", { className: "truncate font-mono text-[11px] text-foreground", title: item.label, children: item.label }), _jsxs("span", { className: "tabular shrink-0 text-[11px] text-muted-foreground", children: [item.secondary ? _jsx("span", { className: "mr-2", children: item.secondary }) : null, _jsx("span", { className: "font-medium text-foreground", children: valueFormatter ? valueFormatter(item.value) : item.value.toLocaleString() })] })] }), _jsx("div", { className: "h-1 w-full overflow-hidden rounded-full bg-muted", children: _jsx("div", { className: "h-full rounded-full", style: { width: `${(item.value / max) * 100}%`, backgroundColor: color } }) })] }, item.label))) }));
}
/* -------------------------------------------------------------------------- */
/* Threshold bands                                                            */
/* -------------------------------------------------------------------------- */
/**
 * Phred quality bands, as used by FastQC.
 *
 * These are status colours because they mean good / warning / poor, not
 * identity. They are always accompanied by the axis, so the colour is
 * reinforcement rather than the only cue.
 */
export const QUALITY_BANDS = [
    { from: 28, to: 45, color: STATUS.pass, label: 'Q28+' },
    { from: 20, to: 28, color: STATUS.warning, label: 'Q20-28' },
    { from: 0, to: 20, color: STATUS.review, label: 'below Q20' },
];
