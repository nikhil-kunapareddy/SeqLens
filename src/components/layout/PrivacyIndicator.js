import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Lock, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
/**
 * Persistent local-analysis indicator.
 *
 * Present in the header on every page, not just the privacy section. The claim
 * it makes is structural rather than a policy promise: SeqLens has no server
 * component, makes no network request after the page loads, and the deployed
 * build ships a Content-Security-Policy that blocks outbound connections. A
 * user can confirm all of that with the browser's own network panel, and the
 * tooltip tells them to.
 */
export function PrivacyIndicator({ className }) {
    return (_jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs(Link, { to: "/settings#privacy", className: cn('inline-flex items-center gap-1.5 rounded-md border border-[#0ca30c]/25 bg-[#0ca30c]/8 px-2 py-1 transition-colors hover:bg-[#0ca30c]/12', className), "aria-label": "Local analysis. Your sequence data stays on this device. Opens privacy details.", children: [_jsx(ShieldCheck, { className: "size-3.5 shrink-0 text-[#067506]", "aria-hidden": true }), _jsx("span", { className: "text-[10px] leading-none font-semibold tracking-wide text-[#067506] uppercase", children: "Local analysis" })] }) }), _jsxs(TooltipContent, { side: "bottom", className: "max-w-xs", children: [_jsx("p", { className: "font-medium text-foreground", children: "Your sequence data never leaves this browser." }), _jsx("p", { className: "mt-1.5 text-muted-foreground", children: "Parsing, statistics, alignment, and embedding all run in Web Workers on this device. SeqLens has no backend and makes no network request after the page loads. Open your browser\u2019s network panel and run an analysis to confirm it." }), _jsx("p", { className: "mt-1.5 text-muted-foreground", children: "Click for full privacy details." })] })] }));
}
/** Compact inline badge for empty states and the landing page. */
export function LocalOnlyBadge({ className }) {
    return (_jsxs("div", { className: cn('inline-flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2', className), children: [_jsx(Lock, { className: "mt-0.5 size-3.5 shrink-0 text-[#067506]", "aria-hidden": true }), _jsxs("div", { className: "space-y-0.5", children: [_jsx("p", { className: "text-[10px] leading-none font-semibold tracking-wide text-foreground uppercase", children: "Local only" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Your sequence data stays on this device." })] })] }));
}
