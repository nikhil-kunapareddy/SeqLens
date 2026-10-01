import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, MinusCircle, XCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import type { QCStatus } from '@/types';

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border bg-card text-foreground',
        primary: 'border-primary/25 bg-primary-soft text-primary',
        pass: 'border-[#0ca30c]/30 bg-[#0ca30c]/10 text-[#067506]',
        warning: 'border-[#fab219]/40 bg-[#fab219]/12 text-[#8a5f00]',
        review: 'border-destructive/30 bg-destructive/10 text-destructive',
        neutral: 'border-border bg-muted text-muted-foreground',
      },
      size: {
        default: '',
        sm: 'px-1 py-0 text-[9px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* QC status                                                                  */
/* -------------------------------------------------------------------------- */

const STATUS_META: Record<
  QCStatus,
  { label: string; variant: 'pass' | 'warning' | 'review' | 'neutral'; Icon: typeof CheckCircle2 }
> = {
  pass: { label: 'Pass', variant: 'pass', Icon: CheckCircle2 },
  warning: { label: 'Warning', variant: 'warning', Icon: AlertTriangle },
  review: { label: 'Review', variant: 'review', Icon: XCircle },
  'not-applicable': { label: 'N/A', variant: 'neutral', Icon: MinusCircle },
};

/**
 * QC verdict chip.
 *
 * The icon is not decoration. Two of the four status colours sit below 3:1
 * contrast on white, and a colourblind reader cannot separate the amber warning
 * from the red review by hue, so the icon and the word carry the meaning and
 * the colour only reinforces it.
 */
export function StatusBadge({
  status,
  className,
  showLabel = true,
}: {
  status: QCStatus;
  className?: string;
  showLabel?: boolean;
}) {
  const { label, variant, Icon } = STATUS_META[status];
  return (
    <Badge variant={variant} className={className} title={label}>
      <Icon aria-hidden />
      {showLabel ? label : <span className="sr-only">{label}</span>}
    </Badge>
  );
}

export const statusLabel = (status: QCStatus): string => STATUS_META[status].label;

/* -------------------------------------------------------------------------- */
/* Alert                                                                      */
/* -------------------------------------------------------------------------- */

const alertVariants = cva('rounded-lg border px-3.5 py-3 text-xs leading-relaxed', {
  variants: {
    variant: {
      info: 'border-border bg-subtle text-foreground',
      note: 'border-primary/20 bg-primary-soft text-foreground',
      warning: 'border-[#fab219]/40 bg-[#fab219]/8 text-foreground',
      error: 'border-destructive/25 bg-destructive/6 text-foreground',
      success: 'border-[#0ca30c]/25 bg-[#0ca30c]/8 text-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ALERT_ICONS = {
  info: Info,
  note: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
} as const;

const ALERT_ICON_COLOR = {
  info: 'text-muted-foreground',
  note: 'text-primary',
  warning: 'text-[#8a5f00]',
  error: 'text-destructive',
  success: 'text-[#067506]',
} as const;

export function Alert({
  className,
  variant = 'info',
  title,
  children,
  actions,
  icon = true,
}: {
  className?: string;
  variant?: 'info' | 'note' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: boolean;
}) {
  const Icon = ALERT_ICONS[variant];
  return (
    <div className={cn(alertVariants({ variant }), className)} role="note">
      <div className="flex gap-2.5">
        {icon ? (
          <Icon className={cn('mt-px size-4 shrink-0', ALERT_ICON_COLOR[variant])} aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          {title ? <p className="text-xs font-semibold text-foreground">{title}</p> : null}
          {children ? <div className="text-muted-foreground">{children}</div> : null}
          {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Dense metric list                                                          */
/* -------------------------------------------------------------------------- */

export interface MetricRow {
  label: string;
  value: ReactNode;
  /** Tooltip text explaining what the metric measures. */
  hint?: string;
  mono?: boolean;
}

/**
 * Label/value list for dense metric panels.
 *
 * Values are right-aligned with tabular figures so a column of numbers lines up
 * on the decimal point, which is the whole reason to use a table here rather
 * than prose.
 */
export function MetricList({
  rows,
  className,
  columns = 1,
}: {
  rows: MetricRow[];
  className?: string;
  columns?: 1 | 2;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6',
        columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
        >
          <dt className="text-xs text-muted-foreground" title={row.hint}>
            {row.label}
          </dt>
          <dd
            className={cn(
              'tabular text-xs font-medium text-foreground',
              row.mono && 'font-mono',
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: typeof Info;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-subtle px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      ) : null}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap justify-center gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section heading                                                            */
/* -------------------------------------------------------------------------- */

export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
