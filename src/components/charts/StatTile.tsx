import { HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the value. */
  detail?: ReactNode;
  /** Explanation shown behind a help icon. */
  help?: ReactNode;
  /** Status or accent chip rendered top-right. */
  badge?: ReactNode;
  /** Sparkline or small inline visual. */
  visual?: ReactNode;
  className?: string;
  /** Change indicator, for comparisons between datasets. */
  delta?: { value: string; direction: 'up' | 'down'; good?: boolean };
}

/**
 * Headline metric.
 *
 * When the story is one number, the number is the chart - a one-bar bar chart
 * or a two-slice pie says less and takes more room. The value uses proportional
 * figures deliberately: tabular figures make a large standalone number look
 * loose, and there is no column here for the digits to align with.
 */
export function StatTile({
  label,
  value,
  detail,
  help,
  badge,
  visual,
  className,
  delta,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3.5 py-3',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          {help ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`What "${label}" measures`}
                >
                  <HelpCircle className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{help}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {badge}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="truncate text-xl leading-tight font-semibold text-foreground">
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium',
              delta.good === false ? 'text-destructive' : 'text-[#006300]',
            )}
          >
            {delta.direction === 'up' ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {delta.value}
          </span>
        ) : null}
      </div>

      {detail ? (
        <span className="truncate text-[11px] leading-relaxed text-muted-foreground">{detail}</span>
      ) : null}
      {visual ? <div className="pt-1">{visual}</div> : null}
    </div>
  );
}

/**
 * Inline sparkline.
 *
 * Deliberately axis-free and label-free: it shows shape, and the stat tile's
 * value carries the magnitude. Drawn as a plain polyline because a 60x18 pixel
 * visual does not justify a chart library's layout pass.
 */
export function Sparkline({
  values,
  width = 72,
  height = 18,
  color = '#2a78d6',
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Responsive grid for a row of stat tiles. */
export function StatGrid({
  children,
  className,
  columns = 4,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 5 | 6;
}) {
  const columnClass = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }[columns];

  return <div className={cn('grid gap-2', columnClass, className)}>{children}</div>;
}
