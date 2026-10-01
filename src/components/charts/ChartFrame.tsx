import { Download, HelpCircle, Table2, BarChart3 } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { MIME, recordsToCsv, saveFile } from '@/utils/export';
import { slugify } from '@/utils/format';

export interface ChartTableColumn {
  key: string;
  header: string;
  /** Right-align and use tabular figures. */
  numeric?: boolean;
  format?: (value: unknown) => string;
}

export interface ChartFrameProps {
  title: string;
  /** One sentence on what the chart shows. */
  description?: ReactNode;
  /** Longer explanation of the metric, shown behind a help icon. */
  help?: ReactNode;
  /** Notes about sampling, caps, or caveats that apply to this chart. */
  footnote?: ReactNode;
  /** Rows backing the table-view twin and the CSV export. */
  data?: readonly Record<string, unknown>[];
  columns?: readonly ChartTableColumn[];
  /** Basename for the exported CSV. */
  exportName?: string;
  /** Extra controls placed in the header. */
  actions?: ReactNode;
  /** Chart height in pixels, excluding the header and axis band. */
  height?: number;
  className?: string;
  children: ReactNode;
}

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
export function ChartFrame({
  title,
  description,
  help,
  footnote,
  data,
  columns,
  exportName,
  actions,
  height = 240,
  className,
  children,
}: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const headingId = useId();
  const hasTable = Boolean(data && columns && data.length > 0);

  const csv = useMemo(() => {
    if (!hasTable || !data || !columns) return '';
    return recordsToCsv(
      data.map((row) => {
        const mapped: Record<string, unknown> = {};
        for (const column of columns) {
          const value = row[column.key];
          mapped[column.header] = column.format ? column.format(value) : value;
        }
        return mapped;
      }),
    );
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

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <h3
              id={headingId}
              className="text-[13px] font-semibold tracking-tight text-foreground"
            >
              {title}
            </h3>
            {help ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`What "${title}" measures`}
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{help}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          {description ? (
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {hasTable ? (
            <>
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(next) => {
                  if (next === 'chart' || next === 'table') setView(next);
                }}
                aria-label="View mode"
              >
                <ToggleGroupItem value="chart" aria-label="Chart view" title="Chart view">
                  <BarChart3 />
                </ToggleGroupItem>
                <ToggleGroupItem value="table" aria-label="Table view" title="Table view">
                  <Table2 />
                </ToggleGroupItem>
              </ToggleGroup>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void download()}
                title="Download this chart's data as CSV"
                aria-label="Download CSV"
              >
                <Download />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {view === 'chart' ? (
        <div className="px-2 pt-3 pb-2" role="img" aria-labelledby={headingId}>
          <div style={{ height }}>{children}</div>
        </div>
      ) : (
        <ChartDataTable data={data ?? []} columns={columns ?? []} maxHeight={height + 48} />
      )}

      {footnote ? (
        <div className="border-t border-border bg-subtle px-4 py-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{footnote}</p>
        </div>
      ) : null}
    </Card>
  );
}

/** The table twin: every plotted value, as text. */
export function ChartDataTable({
  data,
  columns,
  maxHeight = 280,
}: {
  data: readonly Record<string, unknown>[];
  columns: readonly ChartTableColumn[];
  maxHeight?: number;
}) {
  // Long series are truncated in the on-screen table; the CSV export is
  // complete, and the footer says so rather than leaving it implied.
  const LIMIT = 500;
  const rows = data.length > LIMIT ? data.slice(0, LIMIT) : data;

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-1.5 font-medium text-muted-foreground',
                  column.numeric ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-b-0 hover:bg-muted/60">
              {columns.map((column) => {
                const value = row[column.key];
                const text = column.format
                  ? column.format(value)
                  : value === null || value === undefined
                    ? '-'
                    : String(value);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-1 text-foreground',
                      column.numeric ? 'text-right tabular' : 'text-left',
                    )}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > LIMIT ? (
        <p className="border-t border-border bg-subtle px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the first {LIMIT.toLocaleString()} of {data.length.toLocaleString()} rows. The CSV
          export contains all of them.
        </p>
      ) : null}
    </div>
  );
}
