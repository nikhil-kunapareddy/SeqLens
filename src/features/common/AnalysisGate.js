import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Database, FolderPlus, Play, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InlineJobProgress } from '@/components/layout/JobActivity';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, SectionHeading } from '@/components/ui/display';
import { selectError, selectIsRunning, selectStoredResult, useAnalysisStore, } from '@/state/analysisStore';
import { selectJobForDataset, useJobStore } from '@/state/jobStore';
import { selectActiveConfig, selectActiveDataset, selectActiveProject, useProjectStore, } from '@/state/projectStore';
import { JOB_FOR_KIND } from '@/types';
import { formatDuration, formatRelativeTime } from '@/utils/format';
/**
 * Shared scaffolding for the six analysis pages.
 *
 * Every module has the same five states - no project, no dataset, not yet run,
 * running, failed - and the same affordances: a run button, a cancel control,
 * a re-run that bypasses the cache, and a line saying when the shown result was
 * computed. Implementing that once means the states behave identically
 * everywhere, and a page is left to describe only its own results.
 */
export function AnalysisGate({ kind, title, description, configPanel, actions, sequenceIndices, unavailable, children, }) {
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const config = useProjectStore(selectActiveConfig);
    const stored = useAnalysisStore((state) => selectStoredResult(state, dataset?.id ?? null, kind));
    const running = useAnalysisStore((state) => selectIsRunning(state, dataset?.id ?? null, kind));
    const error = useAnalysisStore((state) => selectError(state, dataset?.id ?? null, kind));
    const run = useAnalysisStore((state) => state.run);
    const cancel = useAnalysisStore((state) => state.cancel);
    const dismissError = useAnalysisStore((state) => state.dismissError);
    const job = useJobStore((state) => selectJobForDataset(state, dataset?.id ?? null, JOB_FOR_KIND[kind]));
    if (project === null) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: title, description: description }), _jsx(EmptyState, { icon: FolderPlus, title: "No project yet", description: "Analysis needs a project to hold the dataset and its results. Create one, or import a file and SeqLens will create a project for it.", actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", asChild: true, children: _jsx(Link, { to: "/import", children: "Import FASTA / FASTQ" }) }), _jsx(Button, { size: "sm", variant: "outline", asChild: true, children: _jsx(Link, { to: "/projects", children: "Create a project" }) })] }) })] }));
    }
    if (dataset === null) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: title, description: description }), _jsx(EmptyState, { icon: Database, title: `"${project.name}" has no datasets`, description: "Import a FASTA or FASTQ file, or load one of the built-in demo datasets, to run this analysis.", actions: _jsx(Button, { size: "sm", asChild: true, children: _jsx(Link, { to: "/import", children: "Import a file" }) }) })] }));
    }
    const execute = (force) => {
        void run({
            projectId: project.id,
            datasetId: dataset.id,
            kind,
            config,
            sequenceIndices,
            force,
        });
    };
    const runControls = unavailable ? null : (_jsx("div", { className: "flex items-center gap-2", children: running ? (_jsx(Button, { size: "sm", variant: "outline", onClick: () => cancel(dataset.id, kind), children: "Cancel" })) : stored ? (_jsxs(Button, { size: "sm", variant: "outline", onClick: () => execute(true), children: [_jsx(RefreshCw, {}), "Re-run"] })) : (_jsxs(Button, { size: "sm", onClick: () => execute(false), children: [_jsx(Play, {}), "Run analysis"] })) }));
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: title, description: description, actions: _jsxs(_Fragment, { children: [stored ? actions : null, runControls] }) }), unavailable ? (_jsxs(Alert, { variant: "warning", title: "This analysis does not apply to the selected dataset", children: [_jsx("p", { children: unavailable.reason }), unavailable.suggestion ? _jsx("div", { className: "mt-1.5", children: unavailable.suggestion }) : null] })) : null, configPanel, error ? (_jsxs(Alert, { variant: "error", title: error.message, actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => execute(true), children: "Try again" }), _jsx(Button, { size: "sm", variant: "ghost", onClick: () => dismissError(dataset.id, kind), children: "Dismiss" })] }), children: [error.suggestion ? _jsx("p", { children: error.suggestion }) : null, error.location ? (_jsx("p", { className: "mt-1 font-mono text-[11px]", children: error.location })) : null, error.detail ? (_jsxs("details", { className: "mt-1.5", children: [_jsx("summary", { className: "cursor-pointer text-[11px] hover:text-foreground", children: "Technical detail" }), _jsx("p", { className: "mt-1 font-mono text-[10px] break-words", children: error.detail })] })) : null] })) : null, running && job ? (_jsx(InlineJobProgress, { job: job, onCancel: () => cancel(dataset.id, kind) })) : null, stored ? (_jsxs(_Fragment, { children: [_jsx(ResultProvenance, { computedAt: stored.computedAt, durationMs: stored.durationMs, configHash: stored.configHash, stale: running }), _jsx("div", { className: running ? 'pointer-events-none opacity-60' : undefined, children: children(stored.result, dataset) })] })) : !running && !unavailable && !error ? (_jsx(EmptyState, { icon: Play, title: "Not run yet", description: _jsxs(_Fragment, { children: ["This analysis has not been run for", ' ', _jsx("span", { className: "font-mono", children: dataset.fileName }), ". It runs in a background thread on this device and the result is cached against the current configuration, so re-opening this page will not recompute it."] }), actions: _jsxs(Button, { size: "sm", onClick: () => execute(false), children: [_jsx(Play, {}), "Run analysis"] }) })) : null] }));
}
/**
 * Provenance line for a displayed result.
 *
 * States when the result was computed, how long it took, and the fingerprint of
 * the configuration that produced it. Without this, a cached result is
 * indistinguishable from a fresh one, and a reader cannot tell whether the
 * numbers reflect the thresholds currently shown in the panel.
 */
export function ResultProvenance({ computedAt, durationMs, configHash, stale, }) {
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-subtle px-3 py-1.5 text-[11px] text-muted-foreground", children: [stale ? (_jsxs("span", { className: "inline-flex items-center gap-1 font-medium text-foreground", children: [_jsx(AlertTriangle, { className: "size-3", "aria-hidden": true }), "Recomputing \u2014 values below are from the previous run"] })) : (_jsxs("span", { children: ["Computed ", formatRelativeTime(computedAt), " in ", formatDuration(durationMs)] })), _jsxs("span", { className: "font-mono", children: ["config ", configHash.slice(0, 8)] })] }));
}
/** Notes panel shared by every module's result view. */
export function AnalysisNotes({ notes }) {
    if (notes.length === 0)
        return null;
    return (_jsx(Alert, { variant: "info", title: "How to read these numbers", children: _jsx("ul", { className: "list-disc space-y-1 pl-4", children: notes.map((note, index) => (_jsx("li", { children: note }, index))) }) }));
}
