import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cva } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */
const badgeVariants = cva('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase [&_svg]:size-3', {
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
});
export function Badge({ className, variant, size, ...props }) {
    return _jsx("span", { className: cn(badgeVariants({ variant, size }), className), ...props });
}
/* -------------------------------------------------------------------------- */
/* QC status                                                                  */
/* -------------------------------------------------------------------------- */
const STATUS_META = {
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
export function StatusBadge({ status, className, showLabel = true, }) {
    const { label, variant, Icon } = STATUS_META[status];
    return (_jsxs(Badge, { variant: variant, className: className, title: label, children: [_jsx(Icon, { "aria-hidden": true }), showLabel ? label : _jsx("span", { className: "sr-only", children: label })] }));
}
export const statusLabel = (status) => STATUS_META[status].label;
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
};
const ALERT_ICON_COLOR = {
    info: 'text-muted-foreground',
    note: 'text-primary',
    warning: 'text-[#8a5f00]',
    error: 'text-destructive',
    success: 'text-[#067506]',
};
export function Alert({ className, variant = 'info', title, children, actions, icon = true, }) {
    const Icon = ALERT_ICONS[variant];
    return (_jsx("div", { className: cn(alertVariants({ variant }), className), role: "note", children: _jsxs("div", { className: "flex gap-2.5", children: [icon ? (_jsx(Icon, { className: cn('mt-px size-4 shrink-0', ALERT_ICON_COLOR[variant]), "aria-hidden": true })) : null, _jsxs("div", { className: "min-w-0 flex-1 space-y-1.5", children: [title ? _jsx("p", { className: "text-xs font-semibold text-foreground", children: title }) : null, children ? _jsx("div", { className: "text-muted-foreground", children: children }) : null, actions ? _jsx("div", { className: "flex flex-wrap gap-2 pt-1", children: actions }) : null] })] }) }));
}
/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className, ...props }) {
    return _jsx("div", { className: cn('animate-pulse rounded bg-muted', className), ...props });
}
/**
 * Label/value list for dense metric panels.
 *
 * Values are right-aligned with tabular figures so a column of numbers lines up
 * on the decimal point, which is the whole reason to use a table here rather
 * than prose.
 */
export function MetricList({ rows, className, columns = 1, }) {
    return (_jsx("dl", { className: cn('grid gap-x-6', columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1', className), children: rows.map((row) => (_jsxs("div", { className: "flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0", children: [_jsx("dt", { className: "text-xs text-muted-foreground", title: row.hint, children: row.label }), _jsx("dd", { className: cn('tabular text-xs font-medium text-foreground', row.mono && 'font-mono'), children: row.value })] }, row.label))) }));
}
/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */
export function EmptyState({ icon: Icon, title, description, actions, className, }) {
    return (_jsxs("div", { className: cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-subtle px-6 py-12 text-center', className), children: [Icon ? (_jsx(Icon, { className: "size-6 text-muted-foreground", strokeWidth: 1.5, "aria-hidden": true })) : null, _jsxs("div", { className: "space-y-1.5", children: [_jsx("p", { className: "text-sm font-medium text-foreground", children: title }), description ? (_jsx("p", { className: "mx-auto max-w-md text-xs leading-relaxed text-muted-foreground", children: description })) : null] }), actions ? _jsx("div", { className: "flex flex-wrap justify-center gap-2 pt-1", children: actions }) : null] }));
}
/* -------------------------------------------------------------------------- */
/* Section heading                                                            */
/* -------------------------------------------------------------------------- */
export function SectionHeading({ title, description, actions, className, }) {
    return (_jsxs("div", { className: cn('flex flex-wrap items-start justify-between gap-3', className), children: [_jsxs("div", { className: "min-w-0 space-y-1", children: [_jsx("h2", { className: "text-sm font-semibold tracking-tight text-foreground", children: title }), description ? (_jsx("p", { className: "max-w-3xl text-xs leading-relaxed text-muted-foreground", children: description })) : null] }), actions ? _jsx("div", { className: "flex shrink-0 flex-wrap items-center gap-2", children: actions }) : null] }));
}
