import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/utils/cn';
/**
 * Data surface.
 *
 * A hairline border and no shadow by default: a page of twelve shadowed cards
 * reads as a consumer dashboard, while a hairline keeps the emphasis on the
 * numbers inside.
 */
export function Card({ className, ...props }) {
    return (_jsx("div", { className: cn('rounded-lg border border-border bg-card text-card-foreground', className), ...props }));
}
export function CardHeader({ className, ...props }) {
    return _jsx("div", { className: cn('flex flex-col gap-1 px-4 pt-3.5 pb-3', className), ...props });
}
export function CardTitle({ className, ...props }) {
    return (_jsx("h3", { className: cn('text-[13px] font-semibold tracking-tight text-foreground', className), ...props }));
}
export function CardDescription({ className, ...props }) {
    return _jsx("p", { className: cn('text-xs leading-relaxed text-muted-foreground', className), ...props });
}
export function CardContent({ className, ...props }) {
    return _jsx("div", { className: cn('px-4 pb-4', className), ...props });
}
export function CardFooter({ className, ...props }) {
    return (_jsx("div", { className: cn('flex items-center gap-2 border-t border-border px-4 py-2.5', className), ...props }));
}
/** Header with a right-aligned action slot, the layout most panels need. */
export function CardHeaderRow({ title, description, actions, className, }) {
    return (_jsxs("div", { className: cn('flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-3', className), children: [_jsxs("div", { className: "min-w-0 space-y-1", children: [_jsx("h3", { className: "text-[13px] font-semibold tracking-tight text-foreground", children: title }), description ? (_jsx("p", { className: "max-w-3xl text-xs leading-relaxed text-muted-foreground", children: description })) : null] }), actions ? _jsx("div", { className: "flex shrink-0 items-center gap-1.5", children: actions }) : null] }));
}
