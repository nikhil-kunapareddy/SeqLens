import { BASE_COLORS, CHROME, SEQUENTIAL, SERIES, STATUS, sequentialColor } from '@/components/charts/palette';

/**
 * SVG chart generation as strings.
 *
 * The HTML report is a single self-contained file that must open with no
 * network access and no JavaScript, so its charts cannot be rendered by
 * Recharts: that needs a live DOM and a React runtime. These functions emit SVG
 * markup directly.
 *
 * The same design rules apply as on screen - one hue per single series, hairline
 * solid gridlines, thin marks, a legend whenever there are two or more series -
 * and every chart in the report is followed by its data table, so a reader who
 * cannot distinguish the colours still has the numbers.
 */

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export interface ChartSize {
  width: number;
  height: number;
}

const DEFAULT_SIZE: ChartSize = { width: 720, height: 240 };
const MARGIN = { top: 12, right: 16, bottom: 34, left: 56 };

/** Formats an axis tick compactly so labels do not collide. */
function tickLabel(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(magnitude >= 10_000_000 ? 0 : 1)}M`;
  if (magnitude >= 1000) return `${(value / 1000).toFixed(magnitude >= 10_000 ? 0 : 1)}k`;
  if (magnitude >= 10 || Number.isInteger(value)) return String(Math.round(value));
  return value.toFixed(2);
}

/**
 * Rounds an axis maximum up to a readable value.
 *
 * The comparisons carry a relative tolerance because the values reaching here
 * are sums of floats: a stacked composition that should total exactly 100 often
 * arrives as 100.00000000000003, which without the tolerance rounds the axis up
 * to 200 and squashes the plot into the bottom half.
 */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const tolerance = 1 + 1e-9;
  const step =
    normalised <= 1 * tolerance
      ? 1
      : normalised <= 2 * tolerance
        ? 2
        : normalised <= 5 * tolerance
          ? 5
          : 10;
  return step * magnitude;
}

interface AxisFrame {
  plotWidth: number;
  plotHeight: number;
  yMax: number;
  markup: string;
}

/**
 * Draws the shared chart frame: gridlines, axes, and tick labels.
 * Gridlines are solid hairlines one shade off the surface; dashing them would
 * read as a threshold rather than as a grid.
 */
function axisFrame(
  size: ChartSize,
  maxValue: number,
  xLabel: string,
  yLabel: string,
  ticks = 5,
): AxisFrame {
  const plotWidth = size.width - MARGIN.left - MARGIN.right;
  const plotHeight = size.height - MARGIN.top - MARGIN.bottom;
  const yMax = niceMax(maxValue);

  const parts: string[] = [];
  for (let i = 0; i <= ticks; i += 1) {
    const value = (yMax / ticks) * i;
    const y = MARGIN.top + plotHeight - (value / yMax) * plotHeight;
    parts.push(
      `<line x1="${MARGIN.left}" y1="${y.toFixed(1)}" x2="${(MARGIN.left + plotWidth).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${CHROME.grid}" stroke-width="1"/>`,
      `<text x="${MARGIN.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${CHROME.muted}">${escapeXml(tickLabel(value))}</text>`,
    );
  }

  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + plotHeight}" x2="${MARGIN.left + plotWidth}" y2="${MARGIN.top + plotHeight}" stroke="${CHROME.axis}" stroke-width="1"/>`,
  );

  if (xLabel) {
    parts.push(
      `<text x="${MARGIN.left + plotWidth / 2}" y="${size.height - 4}" text-anchor="middle" font-size="10" fill="${CHROME.muted}">${escapeXml(xLabel)}</text>`,
    );
  }
  if (yLabel) {
    parts.push(
      `<text x="12" y="${MARGIN.top + plotHeight / 2}" text-anchor="middle" font-size="10" fill="${CHROME.muted}" transform="rotate(-90 12 ${MARGIN.top + plotHeight / 2})">${escapeXml(yLabel)}</text>`,
    );
  }

  return { plotWidth, plotHeight, yMax, markup: parts.join('') };
}

const svgWrapper = (size: ChartSize, body: string, title: string): string =>
  `<svg viewBox="0 0 ${size.width} ${size.height}" width="100%" height="${size.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}" style="max-width:${size.width}px"><title>${escapeXml(title)}</title>${body}</svg>`;

/* -------------------------------------------------------------------------- */
/* Bar chart                                                                  */
/* -------------------------------------------------------------------------- */

export interface BarChartOptions {
  title: string;
  data: { label: string; value: number; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  color?: string;
  size?: Partial<ChartSize>;
  /** Show every nth x label; computed automatically when omitted. */
  labelEvery?: number;
}

/**
 * Vertical bar chart.
 *
 * Bars get a 4px rounded top anchored to the baseline and a 2px surface gap
 * between neighbours, so adjacent bars separate without a drawn border.
 */
export function barChartSvg(options: BarChartOptions): string {
  const size = { ...DEFAULT_SIZE, ...options.size };
  const { data } = options;
  if (data.length === 0) {
    return emptyChartSvg(size, options.title);
  }

  const maxValue = Math.max(...data.map((entry) => entry.value), 0);
  const frame = axisFrame(size, maxValue, options.xLabel ?? '', options.yLabel ?? '');
  const slot = frame.plotWidth / data.length;
  const gap = Math.min(2, slot * 0.2);
  // Cap the bar width: a two-category chart would otherwise draw two bars each
  // a third of the plot wide, which reads as a block of colour rather than a
  // comparison. Narrow bars stay centred in their slot.
  const barWidth = Math.max(1, Math.min(slot - gap, 56));
  const slotPadding = (slot - gap - barWidth) / 2;
  const radius = Math.min(4, barWidth / 2);
  const labelEvery = options.labelEvery ?? Math.max(1, Math.ceil(data.length / 14));

  const bars = data
    .map((entry, index) => {
      const height = frame.yMax === 0 ? 0 : (entry.value / frame.yMax) * frame.plotHeight;
      const x = MARGIN.left + index * slot + gap / 2 + slotPadding;
      const y = MARGIN.top + frame.plotHeight - height;
      const fill = entry.color ?? options.color ?? SERIES[0];

      // Rounded top, square base: the base must sit flush on the axis.
      const r = Math.min(radius, height);
      const path =
        height <= 0.5
          ? ''
          : `<path d="M${x.toFixed(1)} ${(y + height).toFixed(1)} L${x.toFixed(1)} ${(y + r).toFixed(1)} Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)} L${(x + barWidth - r).toFixed(1)} ${y.toFixed(1)} Q${(x + barWidth).toFixed(1)} ${y.toFixed(1)} ${(x + barWidth).toFixed(1)} ${(y + r).toFixed(1)} L${(x + barWidth).toFixed(1)} ${(y + height).toFixed(1)} Z" fill="${fill}"/>`;

      const label =
        index % labelEvery === 0
          ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(MARGIN.top + frame.plotHeight + 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${CHROME.muted}">${escapeXml(entry.label)}</text>`
          : '';

      return path + label;
    })
    .join('');

  return svgWrapper(size, frame.markup + bars, options.title);
}

/* -------------------------------------------------------------------------- */
/* Line chart                                                                 */
/* -------------------------------------------------------------------------- */

export interface LineChartOptions {
  title: string;
  /** X values, shared by every series. */
  x: number[];
  series: { label: string; values: number[]; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  /** Fixed y maximum; derived from the data when omitted. */
  yMax?: number;
  /** Horizontal bands drawn behind the lines. */
  bands?: { from: number; to: number; color: string }[];
  size?: Partial<ChartSize>;
}

export function lineChartSvg(options: LineChartOptions): string {
  const size = { ...DEFAULT_SIZE, ...options.size };
  if (options.x.length === 0 || options.series.length === 0) {
    return emptyChartSvg(size, options.title);
  }

  const dataMax = Math.max(...options.series.flatMap((series) => series.values), 0);
  const frame = axisFrame(size, options.yMax ?? dataMax, options.xLabel ?? '', options.yLabel ?? '');
  const xMin = options.x[0];
  const xMax = options.x[options.x.length - 1];
  const xSpan = xMax - xMin || 1;

  const toX = (value: number) => MARGIN.left + ((value - xMin) / xSpan) * frame.plotWidth;
  const toY = (value: number) =>
    MARGIN.top + frame.plotHeight - (Math.min(value, frame.yMax) / frame.yMax) * frame.plotHeight;

  const bands = (options.bands ?? [])
    .map((band) => {
      const top = toY(Math.min(band.to, frame.yMax));
      const bottom = toY(Math.max(0, band.from));
      return `<rect x="${MARGIN.left}" y="${top.toFixed(1)}" width="${frame.plotWidth}" height="${Math.max(0, bottom - top).toFixed(1)}" fill="${band.color}" fill-opacity="0.09"/>`;
    })
    .join('');

  const lines = options.series
    .map((series, index) => {
      const points = series.values
        .map((value, i) => `${toX(options.x[i]).toFixed(1)},${toY(value).toFixed(1)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="${series.color ?? SERIES[index % SERIES.length]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join('');

  // X-axis ticks at five positions.
  const xTicks: string[] = [];
  for (let i = 0; i <= 5; i += 1) {
    const value = xMin + (xSpan / 5) * i;
    xTicks.push(
      `<text x="${toX(value).toFixed(1)}" y="${(MARGIN.top + frame.plotHeight + 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${CHROME.muted}">${escapeXml(tickLabel(value))}</text>`,
    );
  }

  const legend =
    options.series.length > 1
      ? legendSvg(
          options.series.map((series, index) => ({
            label: series.label,
            color: series.color ?? SERIES[index % SERIES.length],
          })),
          MARGIN.left,
          MARGIN.top - 2,
        )
      : '';

  return svgWrapper(
    size,
    bands + frame.markup + xTicks.join('') + lines + legend,
    options.title,
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked area                                                               */
/* -------------------------------------------------------------------------- */

export interface StackedAreaOptions {
  title: string;
  x: number[];
  series: { label: string; values: number[]; color: string }[];
  xLabel?: string;
  yLabel?: string;
  size?: Partial<ChartSize>;
}

/**
 * Stacked area chart.
 *
 * A 1px surface-coloured stroke on each band supplies the gap that separates
 * adjacent fills, which for the nucleotide palette is also the secondary
 * encoding the red/green pair needs.
 */
export function stackedAreaSvg(options: StackedAreaOptions): string {
  const size = { ...DEFAULT_SIZE, ...options.size };
  if (options.x.length === 0 || options.series.length === 0) {
    return emptyChartSvg(size, options.title);
  }

  const totals = options.x.map((_, i) =>
    options.series.reduce((sum, series) => sum + (series.values[i] ?? 0), 0),
  );
  const frame = axisFrame(size, Math.max(...totals, 0), options.xLabel ?? '', options.yLabel ?? '');
  const xMin = options.x[0];
  const xMax = options.x[options.x.length - 1];
  const xSpan = xMax - xMin || 1;

  const toX = (value: number) => MARGIN.left + ((value - xMin) / xSpan) * frame.plotWidth;
  const toY = (value: number) =>
    MARGIN.top + frame.plotHeight - (value / frame.yMax) * frame.plotHeight;

  const baseline = new Array(options.x.length).fill(0) as number[];
  const areas: string[] = [];

  // The 1px surface stroke exists to separate adjacent fills. Once the x
  // spacing falls below about two pixels the stroke covers more of the band
  // than the fill does and reads as noise, so it is dropped at that density -
  // the bands are still separated, just by their own edges.
  const spacing = frame.plotWidth / Math.max(1, options.x.length - 1);
  const separate = spacing >= 2;

  for (const series of options.series) {
    const upper = options.x.map((_, i) => baseline[i] + (series.values[i] ?? 0));
    const forward = options.x
      .map((value, i) => `${toX(value).toFixed(1)},${toY(upper[i]).toFixed(1)}`)
      .join(' ');
    const backward = [...options.x]
      .reverse()
      .map((value, i) => {
        const index = options.x.length - 1 - i;
        return `${toX(value).toFixed(1)},${toY(baseline[index]).toFixed(1)}`;
      })
      .join(' ');
    areas.push(
      `<polygon points="${forward} ${backward}" fill="${series.color}" fill-opacity="0.92"${separate ? ` stroke="${CHROME.surface}" stroke-width="1"` : ''}/>`,
    );
    for (let i = 0; i < baseline.length; i += 1) baseline[i] = upper[i];
  }

  const xTicks: string[] = [];
  for (let i = 0; i <= 5; i += 1) {
    const value = xMin + (xSpan / 5) * i;
    xTicks.push(
      `<text x="${toX(value).toFixed(1)}" y="${(MARGIN.top + frame.plotHeight + 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${CHROME.muted}">${escapeXml(tickLabel(value))}</text>`,
    );
  }

  const legend = legendSvg(
    options.series.map((series) => ({ label: series.label, color: series.color })),
    MARGIN.left,
    MARGIN.top - 2,
  );

  return svgWrapper(size, frame.markup + areas.join('') + xTicks.join('') + legend, options.title);
}

/* -------------------------------------------------------------------------- */
/* Horizontal bar list                                                        */
/* -------------------------------------------------------------------------- */

export interface HorizontalBarOptions {
  title: string;
  data: { label: string; value: number; secondary?: string }[];
  color?: string;
  width?: number;
  /** Maximum rows drawn. */
  maxRows?: number;
}

/** Ranked horizontal bars, for top-N lists. */
export function horizontalBarSvg(options: HorizontalBarOptions): string {
  const rows = options.data.slice(0, options.maxRows ?? 20);
  const width = options.width ?? 720;
  const rowHeight = 18;
  const labelWidth = 92;
  const valueWidth = 112;
  const height = Math.max(rowHeight, rows.length * rowHeight) + 8;

  if (rows.length === 0) return emptyChartSvg({ width, height: 60 }, options.title);

  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const barArea = width - labelWidth - valueWidth - 12;

  const body = rows
    .map((row, index) => {
      const y = index * rowHeight + 4;
      const barWidth = Math.max(1, (row.value / maxValue) * barArea);
      return [
        `<text x="${labelWidth - 6}" y="${y + 11}" text-anchor="end" font-size="10" font-family="ui-monospace, monospace" fill="${CHROME.ink}">${escapeXml(row.label)}</text>`,
        `<rect x="${labelWidth}" y="${y + 3}" width="${barWidth.toFixed(1)}" height="${rowHeight - 8}" rx="2" fill="${options.color ?? SERIES[0]}"/>`,
        `<text x="${labelWidth + barArea + 8}" y="${y + 11}" font-size="10" fill="${CHROME.inkSecondary}">${escapeXml(formatNumber(row.value))}${row.secondary ? ` <tspan fill="${CHROME.muted}">${escapeXml(row.secondary)}</tspan>` : ''}</text>`,
      ].join('');
    })
    .join('');

  return svgWrapper({ width, height }, body, options.title);
}

/* -------------------------------------------------------------------------- */
/* Heatmap                                                                    */
/* -------------------------------------------------------------------------- */

export interface HeatmapOptions {
  title: string;
  /** Condensed upper-triangular values. */
  matrix: Float32Array;
  size: number;
  order?: number[];
  maxPixels?: number;
}

/**
 * Similarity matrix as SVG rectangles.
 *
 * Capped at 120x120 cells, which is 14,400 rectangles. On screen this is a
 * canvas, but a report must be a static file, and beyond that cell count the
 * SVG grows large enough to slow the reader's browser down. Above the cap the
 * report says so and points at the CSV export.
 */
export function heatmapSvg(options: HeatmapOptions): string {
  const cap = options.maxPixels ?? 120;
  const n = options.size;
  if (n === 0) return emptyChartSvg({ width: 400, height: 60 }, options.title);
  if (n > cap) {
    return `<p class="note">The similarity matrix has ${formatNumber(n)} rows, above the ${cap}-row limit for an embedded image. The full matrix is available as a long-form CSV export from the Similarity page.</p>`;
  }

  const cell = Math.max(3, Math.floor(480 / n));
  const edge = cell * n;
  const order = options.order ?? Array.from({ length: n }, (_, i) => i);

  const cells: string[] = [];
  for (let row = 0; row < n; row += 1) {
    const rowIndex = order[row];
    for (let column = 0; column < n; column += 1) {
      const columnIndex = order[column];
      let value: number;
      if (rowIndex === columnIndex) {
        value = 1;
      } else {
        const [a, b] = rowIndex < columnIndex ? [rowIndex, columnIndex] : [columnIndex, rowIndex];
        value = options.matrix[a * n - (a * (a + 1)) / 2 + b - a - 1];
      }
      cells.push(
        `<rect x="${column * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="${sequentialColor(value)}"/>`,
      );
    }
  }

  const scale = SEQUENTIAL.map(
    (color, index) =>
      `<rect x="${index * 14}" y="${edge + 8}" width="14" height="8" fill="${color}"/>`,
  ).join('');

  return svgWrapper(
    { width: edge, height: edge + 30 },
    `${cells.join('')}${scale}<text x="0" y="${edge + 27}" font-size="9" fill="${CHROME.muted}">0.0</text><text x="${SEQUENTIAL.length * 14}" y="${edge + 27}" font-size="9" fill="${CHROME.muted}" text-anchor="end">1.0 Jaccard</text>`,
    options.title,
  );
}

/* -------------------------------------------------------------------------- */
/* Scatter                                                                    */
/* -------------------------------------------------------------------------- */

export interface ScatterOptions {
  title: string;
  points: { x: number; y: number; group: number }[];
  /** Colour per group index. */
  colors?: string[];
  size?: Partial<ChartSize>;
  xLabel?: string;
  yLabel?: string;
}

/** 2-D scatter, for the embedding projection. */
export function scatterSvg(options: ScatterOptions): string {
  const size = { ...DEFAULT_SIZE, height: 380, ...options.size };
  if (options.points.length === 0) return emptyChartSvg(size, options.title);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of options.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const plotWidth = size.width - MARGIN.left - MARGIN.right;
  const plotHeight = size.height - MARGIN.top - MARGIN.bottom;
  const toX = (value: number) => MARGIN.left + ((value - minX) / spanX) * plotWidth;
  const toY = (value: number) => MARGIN.top + plotHeight - ((value - minY) / spanY) * plotHeight;

  const colors = options.colors ?? [...SERIES];
  const marks = options.points
    .map(
      (point) =>
        `<circle cx="${toX(point.x).toFixed(1)}" cy="${toY(point.y).toFixed(1)}" r="2.6" fill="${colors[point.group % colors.length]}" fill-opacity="0.85"/>`,
    )
    .join('');

  const frame = `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${CHROME.grid}" stroke-width="1"/>`;

  const groups = [...new Set(options.points.map((point) => point.group))].sort((a, b) => a - b);
  const legend = legendSvg(
    groups.map((group) => ({
      label: `Cluster ${group + 1}`,
      color: colors[group % colors.length],
    })),
    MARGIN.left,
    size.height - 6,
  );

  const axisLabels = [
    options.xLabel
      ? `<text x="${MARGIN.left + plotWidth / 2}" y="${size.height - 20}" text-anchor="middle" font-size="10" fill="${CHROME.muted}">${escapeXml(options.xLabel)}</text>`
      : '',
    options.yLabel
      ? `<text x="12" y="${MARGIN.top + plotHeight / 2}" text-anchor="middle" font-size="10" fill="${CHROME.muted}" transform="rotate(-90 12 ${MARGIN.top + plotHeight / 2})">${escapeXml(options.yLabel)}</text>`
      : '',
  ].join('');

  return svgWrapper(size, frame + marks + axisLabels + legend, options.title);
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/** Legend row. Always emitted for two or more series. */
function legendSvg(
  items: { label: string; color: string }[],
  x: number,
  y: number,
): string {
  if (items.length < 2) return '';
  let offset = x;
  const parts: string[] = [];
  for (const item of items) {
    parts.push(
      `<rect x="${offset}" y="${y - 7}" width="8" height="8" rx="1.5" fill="${item.color}"/>`,
      `<text x="${offset + 11}" y="${y}" font-size="9.5" fill="${CHROME.inkSecondary}">${escapeXml(item.label)}</text>`,
    );
    offset += 14 + item.label.length * 5.4;
  }
  return parts.join('');
}

function emptyChartSvg(size: ChartSize, title: string): string {
  return svgWrapper(
    size,
    `<text x="${size.width / 2}" y="${size.height / 2}" text-anchor="middle" font-size="11" fill="${CHROME.muted}">No data available for this chart</text>`,
    title,
  );
}

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(3);

/** Status pill used by the QC summary in the report. */
export function statusPillHtml(status: string, label: string): string {
  const colors: Record<string, { background: string; text: string; symbol: string }> = {
    pass: { background: 'rgba(12,163,12,0.10)', text: '#067506', symbol: '✓' },
    warning: { background: 'rgba(250,178,25,0.14)', text: '#8a5f00', symbol: '⚠' },
    review: { background: 'rgba(208,59,59,0.10)', text: '#d03b3b', symbol: '✕' },
    'not-applicable': { background: '#f1f3f5', text: '#6b7280', symbol: '—' },
  };
  const style = colors[status] ?? colors['not-applicable'];
  // The symbol is not decoration: two of these colours are sub-3:1 on white,
  // so the glyph plus the word carries the meaning.
  return `<span class="pill" style="background:${style.background};color:${style.text}">${style.symbol} ${escapeXml(label)}</span>`;
}

export { escapeXml, BASE_COLORS, STATUS };
