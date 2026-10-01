import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Activity, CheckCircle2, ChevronDown, Loader2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Progress } from '@/components/ui/primitives';
import { jobOverallProgress, useJobStore, useRecentJobs, useRunningJobs } from '@/state/jobStore';
import { cn } from '@/utils/cn';
import { useElapsed } from '@/utils/debounce';
import { formatDuration } from '@/utils/format';
/**
 * Header activity indicator and progress panel.
 *
 * Analyses run in background workers, so progress has to be visible from
 * wherever the user navigates to next - not only on the page that started it.
 * The panel lists each job's stages with their own bars, because a single
 * blended percentage hides which part of a multi-stage analysis is slow.
 */
export function JobActivity() {
    const running = useRunningJobs();
    const recent = useRecentJobs();
    const clearFinished = useJobStore((state) => state.clearFinished);
    const [open, setOpen] = useState(false);
    const busy = running.length > 0;
    const failures = recent.filter((job) => job.status === 'error').length;
    return (_jsxs(Popover, { open: open, onOpenChange: setOpen, children: [_jsx(PopoverTrigger, { asChild: true, children: _jsxs(Button, { variant: busy ? 'subtle' : 'ghost', size: "sm", className: "gap-1.5", "aria-label": busy ? `${running.length} analyses running` : 'Analysis activity', children: [busy ? (_jsx(Loader2, { className: "animate-spin text-primary" })) : failures > 0 ? (_jsx(XCircle, { className: "text-destructive" })) : (_jsx(Activity, {})), _jsx("span", { className: "hidden sm:inline", children: busy ? `${running.length} running` : 'Activity' }), _jsx(ChevronDown, { className: "size-3 opacity-60" })] }) }), _jsxs(PopoverContent, { align: "end", className: "w-96 p-0", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-3 py-2", children: [_jsx("p", { className: "text-xs font-semibold text-foreground", children: "Analysis activity" }), recent.some((job) => job.status !== 'running') ? (_jsx(Button, { variant: "ghost", size: "sm", className: "h-6 text-[11px]", onClick: clearFinished, children: "Clear finished" })) : null] }), _jsx("div", { className: "max-h-96 overflow-y-auto", children: recent.length === 0 ? (_jsx("p", { className: "px-3 py-6 text-center text-xs text-muted-foreground", children: "No analyses have run yet in this session." })) : (_jsx("ul", { className: "divide-y divide-border", children: recent.map((job) => (_jsx("li", { className: "px-3 py-2.5", children: _jsx(JobRow, { job: job }) }, job.id))) })) })] })] }));
}
function JobRow({ job }) {
    const dismiss = useJobStore((state) => state.dismiss);
    const overall = jobOverallProgress(job);
    // Ticked through state rather than read during render, so the duration
    // actually counts up and render stays a pure function of state.
    const elapsed = useElapsed(job.startedAt, job.status === 'running');
    return (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-xs font-medium text-foreground", children: job.label }), _jsx("p", { className: "text-[10px] text-muted-foreground", children: job.status === 'running'
                                    ? `running for ${formatDuration(elapsed)}`
                                    : job.finishedAt
                                        ? `${job.status} in ${formatDuration(job.finishedAt - job.startedAt)}`
                                        : job.status })] }), _jsxs("div", { className: "flex shrink-0 items-center gap-1", children: [job.status === 'done' ? (_jsx(CheckCircle2, { className: "size-3.5 text-[#067506]", "aria-hidden": true })) : null, job.status === 'error' ? (_jsx(XCircle, { className: "size-3.5 text-destructive", "aria-hidden": true })) : null, job.status === 'cancelled' ? _jsx(Badge, { variant: "neutral", children: "Cancelled" }) : null, job.status !== 'running' ? (_jsx("button", { type: "button", onClick: () => dismiss(job.id), className: "rounded-sm p-0.5 text-muted-foreground hover:text-foreground", "aria-label": "Dismiss", children: _jsx(X, { className: "size-3" }) })) : null] })] }), job.status === 'running' ? (_jsxs("div", { className: "space-y-1.5", children: [job.stages.length === 0 ? (_jsx(Progress, { indeterminate: true, "aria-label": "Starting" })) : (job.stages.map((stage) => _jsx(StageBar, { stage: stage }, stage.id))), overall !== null && job.stages.length > 1 ? (_jsxs("p", { className: "tabular text-right text-[10px] text-muted-foreground", children: [Math.round(overall * 100), "% overall"] })) : null] })) : null, job.error ? (_jsxs("div", { className: "rounded border border-destructive/25 bg-destructive/6 px-2 py-1.5", children: [_jsx("p", { className: "text-[11px] leading-relaxed text-foreground", children: job.error.message }), job.error.suggestion ? (_jsx("p", { className: "mt-1 text-[11px] leading-relaxed text-muted-foreground", children: job.error.suggestion })) : null] })) : null] }));
}
/**
 * One labelled progress bar.
 *
 * The label sits above the bar with the percentage right-aligned on the same
 * line, which is the layout that reads as a progress list rather than a stack
 * of anonymous bars.
 */
export function StageBar({ stage, className }) {
    const percent = stage.value === null ? null : Math.round(stage.value * 100);
    return (_jsxs("div", { className: cn('space-y-1', className), children: [_jsxs("div", { className: "flex items-baseline justify-between gap-2", children: [_jsx("span", { className: "truncate text-[11px] text-muted-foreground", children: stage.label }), _jsx("span", { className: "tabular shrink-0 text-[11px] font-medium text-foreground", children: percent === null ? '' : `${percent}%` })] }), _jsx(Progress, { value: percent ?? 0, indeterminate: percent === null, "aria-label": stage.label }), stage.detail ? (_jsx("p", { className: "tabular truncate text-[10px] text-muted-foreground", children: stage.detail })) : null] }));
}
/**
 * Inline progress panel for a page that started an analysis.
 *
 * Shown in place of the results while a job runs, with a cancel control. This
 * is the ASCII-style staged readout the interface promises: each stage of a
 * multi-part analysis gets its own bar and its own detail line.
 */
export function InlineJobProgress({ job, onCancel, className, }) {
    return (_jsxs("div", { className: cn('rounded-lg border border-border bg-card p-4', className), children: [_jsxs("div", { className: "mb-3 flex items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Loader2, { className: "size-4 animate-spin text-primary", "aria-hidden": true }), _jsx("p", { className: "text-xs font-medium text-foreground", children: job.label })] }), onCancel ? (_jsx(Button, { variant: "outline", size: "sm", onClick: onCancel, children: "Cancel" })) : null] }), _jsx("div", { className: "space-y-2.5", children: job.stages.length === 0 ? (_jsx(Progress, { indeterminate: true, "aria-label": "Starting analysis" })) : (job.stages.map((stage) => _jsx(StageBar, { stage: stage }, stage.id))) }), _jsx("p", { className: "mt-3 text-[11px] leading-relaxed text-muted-foreground", children: "Running in a background thread, so the interface stays responsive. You can navigate to another page and come back; progress is tracked in the activity panel." })] }));
}
