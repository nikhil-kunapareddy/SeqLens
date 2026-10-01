import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
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
} as const;

const GRID_PROPS = {
  stroke: CHROME.grid,
  strokeDasharray: undefined,
  vertical: false,
} as const;

export const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One tooltip row.
 *
 * `value` is widened to include an array because Recharts types a stacked or
 * range series value as a tuple; the renderer collapses it to a readable string
 * rather than printing "[object Array]".
 */
interface TooltipEntry {
  name?: string | number;
  value?: number | string | readonly (string | number)[];
  color?: string;
}

/** Recharts types the axis label as a ReactNode; only scalars are displayable. */
const scalarLabel = (label: unknown): string | number | undefined =>
  typeof label === 'string' || typeof label === 'number' ? label : undefined;

const renderTooltipValue = (value: TooltipEntry['value']): string => {
  if (value === undefined || value === null) return '-';
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(' - ');
  return typeof value === 'number' ? value.toLocaleString() : String(value);
};

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  /** Overrides the heading line. */
  labelFormatter?: (label: string | number | undefined) => ReactNode;
  valueFormatter?: (
    value: number | string | readonly (string | number)[] | undefined,
    name?: string | number,
  ) => ReactNode;
  /** Suppresses the swatch when there is only one series. */
  hideSwatch?: boolean;
}

/**
 * Hover readout.
 *
 * Present on every chart by default, because an HTML chart is interactive and a
 * reader who can hover expects to. It enhances rather than gates: the same
 * values are always in the table view.
 */
export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
  valueFormatter,
  hideSwatch,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
      {label !== undefined ? (
        <p className="mb-1 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            {hideSwatch ? null : (
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: entry.color ?? SERIES[0] }}
                aria-hidden
              />
            )}
            {payload.length > 1 ? (
              <span className="text-muted-foreground">{entry.name}</span>
            ) : null}
            <span className="tabular ml-auto font-medium text-foreground">
              {valueFormatter
                ? valueFormatter(entry.value, entry.name)
                : renderTooltipValue(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                     */
/* -------------------------------------------------------------------------- */

export interface LegendItem {
  label: string;
  color: string;
  /** Marker glyph, for all-pairs forms that encode with shape as well. */
  shape?: 'circle' | 'triangle' | 'square' | 'diamond';
  value?: string;
}

/**
 * Legend, rendered outside the plot.
 *
 * Always present when there are two or more series, so identity never rests on
 * colour alone. A single-series chart has no legend: its title names the series.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string;
}) {
  if (items.length < 2) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <LegendGlyph color={item.color} shape={item.shape} />
          <span>{item.label}</span>
          {item.value ? <span className="tabular text-foreground">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function LegendGlyph({ color, shape = 'square' }: { color: string; shape?: LegendItem['shape'] }) {
  if (shape === 'circle') {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <circle cx="4.5" cy="4.5" r="4" fill={color} />
      </svg>
    );
  }
  if (shape === 'triangle') {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <polygon points="4.5,0.5 8.5,8 0.5,8" fill={color} />
      </svg>
    );
  }
  if (shape === 'diamond') {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        <polygon points="4.5,0.5 8.5,4.5 4.5,8.5 0.5,4.5" fill={color} />
      </svg>
    );
  }
  return (
    <span
      className="size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Histogram                                                                  */
/* -------------------------------------------------------------------------- */

export type ChartRow = Record<string, unknown>;

export interface HistogramProps {
  data: readonly ChartRow[];
  xKey: string;
  yKey: string;
  xLabel?: string;
  yLabel?: string;
  /** Single-series colour. Defaults to the first categorical slot. */
  color?: string;
  /** Per-bar colour, for the rare case where bars carry an ordered class. */
  colorFor?: (row: ChartRow, index: number) => string;
  xTickFormatter?: (value: unknown) => string;
  yTickFormatter?: (value: number) => string;
  tooltipLabel?: (row: ChartRow) => string;
  tooltipValue?: (row: ChartRow) => string;
  /** Reference lines, for configured thresholds. */
  markers?: { value: number; label: string; color?: string }[];
}

/**
 * Bar histogram for a single distribution.
 *
 * One series, one colour. Colouring bars darker-where-taller would double-encode
 * the height and burn the only free channel on information the bar length
 * already carries.
 */
export function Histogram({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  color = SERIES[0],
  colorFor,
  xTickFormatter,
  yTickFormatter,
  tooltipLabel,
  tooltipValue,
  markers,
}: HistogramProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data as ChartRow[]} margin={{ ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis
          dataKey={xKey}
          {...AXIS_PROPS}
          tickFormatter={xTickFormatter}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
              : undefined
          }
          minTickGap={12}
        />
        <YAxis
          {...AXIS_PROPS}
          tickFormatter={yTickFormatter}
          width={52}
          label={
            yLabel
              ? {
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  fill: CHROME.muted,
                  fontSize: 11,
                  style: { textAnchor: 'middle' },
                }
              : undefined
          }
        />
        <RechartsTooltip
          cursor={{ fill: CHROME.grid, fillOpacity: 0.6 }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as ChartRow | undefined;
            if (!active || !row) return null;
            return (
              <ChartTooltip
                active
                hideSwatch
                label={tooltipLabel ? tooltipLabel(row) : String(row[xKey])}
                payload={[
                  {
                    value: tooltipValue ? tooltipValue(row) : Number(row[yKey]).toLocaleString(),
                    color,
                  },
                ]}
              />
            );
          }}
        />
        {markers?.map((marker) => (
          <ReferenceLine
            key={marker.label}
            x={marker.value}
            stroke={marker.color ?? CHROME.inkSecondary}
            strokeWidth={1}
            label={{ value: marker.label, position: 'top', fill: CHROME.muted, fontSize: 10 }}
          />
        ))}
        {/* 4px rounded data-end anchored to the baseline. */}
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={48}>
          {colorFor
            ? (data as ChartRow[]).map((row, index) => (
                <Cell key={index} fill={colorFor(row, index)} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Line chart                                                                 */
/* -------------------------------------------------------------------------- */

export interface SeriesSpec {
  key: string;
  label: string;
  color?: string;
}

export interface LineSeriesChartProps {
  data: readonly ChartRow[];
  xKey: string;
  series: SeriesSpec[];
  xLabel?: string;
  yLabel?: string;
  yDomain?: [number | 'auto', number | 'auto'];
  xTickFormatter?: (value: unknown) => string;
  yTickFormatter?: (value: number) => string;
  valueFormatter?: (
    value: number | string | readonly (string | number)[] | undefined,
    name?: string | number,
  ) => string;
  /** Horizontal threshold bands, drawn behind the marks. */
  bands?: { from: number; to: number; color: string; label?: string }[];
}

/** Multi-series line chart with a crosshair tooltip. */
export function LineSeriesChart({
  data,
  xKey,
  series,
  xLabel,
  yLabel,
  yDomain,
  xTickFormatter,
  yTickFormatter,
  valueFormatter,
  bands,
}: LineSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data as ChartRow[]} margin={{ ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }}>
        <CartesianGrid {...GRID_PROPS} />
        {bands?.map((band) => (
          <ReferenceArea
            key={`${band.from}-${band.to}`}
            y1={band.from}
            y2={band.to}
            fill={band.color}
            fillOpacity={0.09}
            stroke="none"
            ifOverflow="hidden"
          />
        ))}
        <XAxis
          dataKey={xKey}
          {...AXIS_PROPS}
          tickFormatter={xTickFormatter}
          minTickGap={16}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
              : undefined
          }
        />
        <YAxis
          {...AXIS_PROPS}
          domain={yDomain}
          tickFormatter={yTickFormatter}
          width={52}
          label={
            yLabel
              ? {
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  fill: CHROME.muted,
                  fontSize: 11,
                  style: { textAnchor: 'middle' },
                }
              : undefined
          }
        />
        <RechartsTooltip
          cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          content={(props) => (
            <ChartTooltip
              active={props.active}
              label={scalarLabel(props.label)}
              payload={props.payload}
              hideSwatch={series.length < 2}
              valueFormatter={valueFormatter}
            />
          )}
        />
        {series.map((spec, index) => (
          <Line
            key={spec.key}
            type="monotone"
            dataKey={spec.key}
            name={spec.label}
            stroke={spec.color ?? seriesColor(index)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
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
export function StackedAreaChart({
  data,
  xKey,
  series,
  xLabel,
  yLabel,
  yTickFormatter,
  valueFormatter,
}: {
  data: readonly ChartRow[];
  xKey: string;
  series: SeriesSpec[];
  xLabel?: string;
  yLabel?: string;
  yTickFormatter?: (value: number) => string;
  valueFormatter?: (
    value: number | string | readonly (string | number)[] | undefined,
    name?: string | number,
  ) => string;
}) {
  // The 1px surface stroke separates adjacent bands, but once there are more
  // points than pixels it covers more of each band than the fill does and reads
  // as jitter. Past ~200 points the bands are left to meet at their own edges.
  const separate = data.length <= 200;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data as ChartRow[]} margin={{ ...CHART_MARGIN, bottom: xLabel ? 18 : 4 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis
          dataKey={xKey}
          {...AXIS_PROPS}
          minTickGap={20}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fill: CHROME.muted, fontSize: 11 }
              : undefined
          }
        />
        <YAxis
          {...AXIS_PROPS}
          width={52}
          tickFormatter={yTickFormatter}
          label={
            yLabel
              ? {
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  fill: CHROME.muted,
                  fontSize: 11,
                  style: { textAnchor: 'middle' },
                }
              : undefined
          }
        />
        <RechartsTooltip
          cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          content={(props) => (
            <ChartTooltip
              active={props.active}
              label={scalarLabel(props.label)}
              payload={props.payload}
              valueFormatter={valueFormatter}
            />
          )}
        />
        {series.map((spec, index) => (
          <Area
            key={spec.key}
            type="monotone"
            dataKey={spec.key}
            name={spec.label}
            stackId="composition"
            stroke={separate ? CHROME.surface : (spec.color ?? seriesColor(index))}
            strokeWidth={separate ? 1 : 0}
            fill={spec.color ?? seriesColor(index)}
            fillOpacity={0.92}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
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
export function BarList({
  items,
  valueFormatter,
  color = SERIES[0],
  maxItems = 20,
  emptyLabel = 'No entries',
}: {
  items: { label: string; value: number; secondary?: string }[];
  valueFormatter?: (value: number) => string;
  color?: string;
  maxItems?: number;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((item) => item.value), 1);
  const shown = items.slice(0, maxItems);

  return (
    <ol className="space-y-1 overflow-y-auto px-2" style={{ maxHeight: '100%' }}>
      {shown.map((item) => (
        <li key={item.label} className="group relative">
          <div className="flex items-baseline justify-between gap-3 py-0.5">
            <span className="truncate font-mono text-[11px] text-foreground" title={item.label}>
              {item.label}
            </span>
            <span className="tabular shrink-0 text-[11px] text-muted-foreground">
              {item.secondary ? <span className="mr-2">{item.secondary}</span> : null}
              <span className="font-medium text-foreground">
                {valueFormatter ? valueFormatter(item.value) : item.value.toLocaleString()}
              </span>
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
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
