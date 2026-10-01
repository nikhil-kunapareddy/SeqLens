import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowRight, Database, FileText, FlaskConical, Layers, Play, Sparkles, Upload, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { METRIC_DOCS } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { LocalOnlyBadge } from '@/components/layout/PrivacyIndicator';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, EmptyState, MetricList, SectionHeading, Skeleton, StatusBadge, } from '@/components/ui/display';
import { DEMO_DATASETS, PRIMARY_DEMO } from '@/data/demoData';
import { useAnalysisStore, selectQCResult } from '@/state/analysisStore';
import { selectActiveConfig, selectActiveDataset, selectActiveProject, useProjectStore, useProjectTotals, } from '@/state/projectStore';
import { datasetRepository } from '@/storage/repositories';
import { formatBytes, formatDecimal, formatInteger, formatPercent, formatRelativeTime, formatSequenceType, formatFileFormat, pluralize, } from '@/utils/format';
import { buildLengthHistogram, computeLengthStats } from '@/bio/statistics/lengths';
import { useKeyedAsync } from '@/utils/useKeyedAsync';
/**
 * Project dashboard.
 *
 * Shows the eight headline figures a reader wants before opening any module,
 * derived from the compact index so they are available immediately after import
 * without running a single analysis. QC status is the one figure that needs the
 * QC module, and it says so when it has not been computed.
 */
export function OverviewPage() {
    const loading = useProjectStore((state) => state.loading);
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const datasets = useProjectStore((state) => state.datasets);
    const totals = useProjectTotals();
    const config = useProjectStore(selectActiveConfig);
    const importFiles = useProjectStore((state) => state.importFiles);
    const selectDataset = useProjectStore((state) => state.selectDataset);
    const qc = useAnalysisStore((state) => selectQCResult(state, dataset?.id ?? null));
    const hydrate = useAnalysisStore((state) => state.hydrate);
    const runAnalysis = useAnalysisStore((state) => state.run);
    const [loadingDemo, setLoadingDemo] = useState(null);
    const navigate = useNavigate();
    // The index is keyed on the dataset id, so a read that resolves after the
    // user has already switched datasets is discarded rather than painted.
    const { data: index } = useKeyedAsync(dataset?.id ?? null, (datasetId) => datasetRepository.getIndex(datasetId).then((value) => value ?? null));
    const datasetId = dataset?.id ?? null;
    useEffect(() => {
        if (datasetId !== null)
            void hydrate(datasetId, ['qc']);
    }, [datasetId, hydrate]);
    const stats = useMemo(() => {
        if (index === null || index.count === 0)
            return null;
        const lengthStats = computeLengthStats(index.lengths);
        let gc = 0;
        let unambiguous = 0;
        for (let i = 0; i < index.count; i += 1) {
            gc += index.gcCounts[i];
            unambiguous += index.lengths[i] - index.ambiguousCounts[i];
        }
        return {
            ...lengthStats,
            gcPercent: unambiguous === 0 ? 0 : (gc / unambiguous) * 100,
        };
    }, [index]);
    const lengthHistogram = useMemo(() => {
        if (index === null || index.count === 0)
            return [];
        return buildLengthHistogram(index.lengths, 36).bins.map((bin) => ({
            label: bin.from === bin.to - 1 ? formatInteger(bin.from) : formatInteger(bin.from),
            from: bin.from,
            to: bin.to,
            count: bin.count,
        }));
    }, [index]);
    const loadDemo = async (id) => {
        const demo = DEMO_DATASETS.find((candidate) => candidate.id === id);
        if (!demo)
            return;
        setLoadingDemo(id);
        try {
            const imported = await importFiles([{ file: demo.build() }]);
            if (imported.length > 0) {
                selectDataset(imported[0].id);
                navigate('/qc');
            }
        }
        finally {
            setLoadingDemo(null);
        }
    };
    if (loading) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(Skeleton, { className: "h-7 w-64" }), _jsx(StatGrid, { children: [0, 1, 2, 3].map((i) => (_jsx(Skeleton, { className: "h-20" }, i))) }), _jsx(Skeleton, { className: "h-72" })] }));
    }
    if (project === null) {
        return _jsx(Landing, { onLoadDemo: loadDemo, loadingDemo: loadingDemo });
    }
    const isProtein = dataset?.sequenceType === 'protein';
    return (_jsxs("div", { className: "space-y-5", children: [_jsx(SectionHeading, { title: project.name, description: project.description ||
                    `Created ${formatRelativeTime(project.createdAt)}. ${formatInteger(totals.datasets)} dataset${totals.datasets === 1 ? '' : 's'}, ${formatInteger(totals.sequences)} sequences, ${formatInteger(totals.residues)} residues held locally.`, actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", asChild: true, children: _jsxs(Link, { to: "/reports", children: [_jsx(FileText, {}), "Reports"] }) }), _jsx(Button, { size: "sm", asChild: true, children: _jsxs(Link, { to: "/import", children: [_jsx(Upload, {}), "Import FASTA / FASTQ"] }) })] }) }), datasets.length === 0 ? (_jsx(EmptyState, { icon: Database, title: "This project has no datasets yet", description: "Import a FASTA or FASTQ file from this device, or load a demo dataset to see every module working end to end.", actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", asChild: true, children: _jsx(Link, { to: "/import", children: "Import a file" }) }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => void loadDemo(PRIMARY_DEMO.id), disabled: loadingDemo !== null, children: loadingDemo === PRIMARY_DEMO.id ? 'Loading demo…' : 'Try demo dataset' })] }) })) : null, dataset && stats ? (_jsxs(_Fragment, { children: [_jsxs(StatGrid, { columns: 4, children: [_jsx(StatTile, { label: "Dataset", value: _jsx("span", { className: "font-mono text-sm", children: dataset.fileName }), detail: `${formatFileFormat(dataset.format)} · ${formatSequenceType(dataset.sequenceType)} · ${formatBytes(dataset.fileSize)}`, badge: dataset.truncated ? _jsx(Badge, { variant: "warning", children: "Truncated" }) : undefined }), _jsx(StatTile, { label: "Sequences", value: formatInteger(stats.count), detail: `${formatInteger(stats.min)} to ${formatInteger(stats.max)} ${isProtein ? 'aa' : 'bp'}, median ${formatInteger(stats.median)}` }), _jsx(StatTile, { label: isProtein ? 'Total residues' : 'Total bases', value: formatInteger(stats.total), detail: `mean length ${formatDecimal(stats.mean, 1)}` }), _jsx(StatTile, { label: "GC content", value: isProtein ? 'N/A' : formatPercent(stats.gcPercent, 2), detail: isProtein
                                    ? 'Not applicable to protein sequences'
                                    : 'Over unambiguous bases only', help: `${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}` }), _jsx(StatTile, { label: "N50", value: formatInteger(stats.n50), detail: `N90 ${formatInteger(stats.n90)} · L50 ${formatInteger(stats.l50)}`, help: `${METRIC_DOCS.n50.what} ${METRIC_DOCS.n50.caveat}` }), _jsx(StatTile, { label: "Duplicates", value: qc ? formatInteger(qc.stats.duplicateSequences) : _jsx("span", { className: "text-muted-foreground", children: "\u2014" }), detail: qc
                                    ? `${formatPercent((qc.stats.duplicateSequences / Math.max(1, qc.stats.sequenceCount)) * 100, 2)} of sequences in ${pluralize(qc.stats.duplicateGroups, 'group')}`
                                    : 'Run QC to detect exact duplicates', help: `${METRIC_DOCS.duplicates.what} ${METRIC_DOCS.duplicates.caveat}` }), _jsx(StatTile, { label: "Ambiguous", value: index
                                    ? formatPercent((Array.from(index.ambiguousCounts).reduce((sum, value) => sum + value, 0) /
                                        Math.max(1, stats.total)) *
                                        100, 3)
                                    : '-', detail: "Residues outside the canonical alphabet", help: `${METRIC_DOCS.ambiguous.what} ${METRIC_DOCS.ambiguous.caveat}` }), _jsx(StatTile, { label: "QC status", value: qc ? (_jsx(StatusBadge, { status: qc.overallStatus, className: "text-xs" })) : (_jsx("span", { className: "text-sm text-muted-foreground", children: "Not run" })), detail: qc
                                    ? `${qc.checks.filter((c) => c.status === 'pass').length} of ${qc.checks.length} checks pass`
                                    : 'The most severe of eleven checks', badge: qc ? undefined : (_jsxs(Button, { size: "sm", variant: "ghost", className: "h-5 px-1.5 text-[10px]", onClick: () => void runAnalysis({
                                        projectId: project.id,
                                        datasetId: dataset.id,
                                        kind: 'qc',
                                        config,
                                    }), children: [_jsx(Play, { className: "size-3" }), "Run"] })) })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-3", children: [_jsx(ChartFrame, { className: "xl:col-span-2", title: "Sequence length distribution", description: `How the ${formatInteger(stats.count)} sequences in this dataset are distributed by length.`, data: lengthHistogram, columns: [
                                    { key: 'from', header: 'From', numeric: true },
                                    { key: 'to', header: 'To', numeric: true },
                                    { key: 'count', header: 'Sequences', numeric: true },
                                ], exportName: `${dataset.fileName}-length-distribution`, height: 260, footnote: stats.max / Math.max(1, stats.min) > 100
                                    ? 'Lengths span more than two orders of magnitude, so the bins are logarithmically spaced. Bin bounds are in the table view.'
                                    : undefined, children: _jsx(Histogram, { data: lengthHistogram, xKey: "label", yKey: "count", xLabel: isProtein ? 'Residues' : 'Length (bp)', yLabel: "Sequences", yTickFormatter: (value) => formatInteger(value), tooltipLabel: (row) => `${formatInteger(Number(row.from))} - ${formatInteger(Number(row.to) - 1)} ${isProtein ? 'aa' : 'bp'}`, tooltipValue: (row) => `${formatInteger(Number(row.count))} sequences` }) }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Next steps", description: "Each module runs on the selected dataset and caches its result locally." }), _jsx("div", { className: "space-y-1 px-2 pb-3", children: [
                                            { to: '/qc', label: 'Quality control', icon: FlaskConical, done: qc !== null },
                                            { to: '/composition', label: 'Composition and k-mers', icon: Layers, done: false },
                                            { to: '/similarity', label: 'Similarity and redundancy', icon: Layers, done: false },
                                            { to: '/explorer', label: 'Browse sequences', icon: Database, done: false },
                                            { to: '/reports', label: 'Generate a report', icon: FileText, done: false },
                                        ].map((item) => (_jsxs(Link, { to: item.to, className: "flex items-center gap-2 rounded-md px-2 py-2 text-xs text-foreground transition-colors hover:bg-muted", children: [_jsx(item.icon, { className: "size-4 shrink-0 text-muted-foreground", strokeWidth: 1.75 }), _jsx("span", { className: "flex-1", children: item.label }), item.done ? _jsx(Badge, { variant: "pass", children: "Done" }) : null, _jsx(ArrowRight, { className: "size-3.5 shrink-0 text-muted-foreground" })] }, item.to))) })] })] }), dataset.parseIssues.length > 0 ? (_jsx(Alert, { variant: "warning", title: "The parser reported issues for this file", children: _jsx("ul", { className: "list-disc space-y-1 pl-4", children: dataset.parseIssues.map((issue, i) => (_jsxs("li", { children: [_jsx("span", { className: "font-medium text-foreground", children: issue.count > 1 ? `${formatInteger(issue.count)}x ` : '' }), issue.message] }, i))) }) })) : null, _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Datasets in this project", description: "Every imported file, with the metadata recorded at import time.", actions: _jsx(Button, { size: "sm", variant: "outline", asChild: true, children: _jsx(Link, { to: "/import", children: "Import another" }) }) }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-y border-border bg-subtle text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-left font-medium", children: "File" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Format" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Type" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Sequences" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Residues" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Size" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Imported" })] }) }), _jsx("tbody", { children: datasets.map((candidate) => (_jsxs("tr", { className: `cursor-pointer border-b border-border last:border-b-0 ${candidate.id === dataset.id ? 'bg-primary-soft' : 'hover:bg-muted/60'}`, onClick: () => selectDataset(candidate.id), children: [_jsx("td", { className: "px-4 py-1.5 font-mono text-foreground", children: candidate.fileName }), _jsx("td", { className: "px-3 py-1.5", children: formatFileFormat(candidate.format) }), _jsxs("td", { className: "px-3 py-1.5", children: [formatSequenceType(candidate.sequenceType), candidate.typeConfidence < 0.95 ? (_jsxs("span", { className: "ml-1 text-muted-foreground", title: candidate.typeDetectionNote, children: ["(", formatPercent(candidate.typeConfidence * 100, 0), ")"] })) : null] }), _jsx("td", { className: "px-3 py-1.5 text-right tabular", children: formatInteger(candidate.sequenceCount) }), _jsx("td", { className: "px-3 py-1.5 text-right tabular", children: formatInteger(candidate.totalResidues) }), _jsxs("td", { className: "px-3 py-1.5 text-right tabular", children: [formatBytes(candidate.fileSize), candidate.gzipped ? (_jsx("span", { className: "ml-1 text-muted-foreground", children: "gz" })) : null] }), _jsx("td", { className: "px-3 py-1.5", children: formatRelativeTime(candidate.importedAt) })] }, candidate.id))) })] }) })] })] })) : null] }));
}
/* -------------------------------------------------------------------------- */
/* Landing / empty state                                                      */
/* -------------------------------------------------------------------------- */
/**
 * First-run landing page.
 *
 * Leads with what the tool does and what it does not do, because "runs entirely
 * in your browser" is the product's main claim and a user has no reason to take
 * it on faith. The two actions are import and demo; everything else is
 * reachable once a dataset exists.
 */
function Landing({ onLoadDemo, loadingDemo, }) {
    return (_jsxs("div", { className: "mx-auto max-w-4xl space-y-8 py-8", children: [_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("h1", { className: "text-2xl font-semibold tracking-tight text-foreground", children: "SeqLens" }), _jsx("p", { className: "text-base text-foreground", children: "Local sequence intelligence." })] }), _jsx("p", { className: "max-w-2xl text-sm leading-relaxed text-muted-foreground", children: "Analyse FASTA and FASTQ files directly in your browser. No uploads. No accounts. No cloud. Quality control, composition, k-mer spectra, redundancy, similarity, open reading frames, alignment, and embeddings, all computed on this device." }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Button, { asChild: true, children: _jsxs(Link, { to: "/import", children: [_jsx(Upload, {}), "Import FASTA / FASTQ"] }) }), _jsxs(Button, { variant: "outline", onClick: () => void onLoadDemo(PRIMARY_DEMO.id), disabled: loadingDemo !== null, children: [_jsx(Sparkles, {}), loadingDemo === PRIMARY_DEMO.id ? 'Loading demo…' : 'Try demo dataset'] })] }), _jsx(LocalOnlyBadge, {})] }), _jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "What SeqLens computes", description: "Everything runs in Web Workers on this machine." }), _jsx("div", { className: "px-4 pb-4", children: _jsx(MetricList, { rows: [
                                        { label: 'Quality control', value: '11 checks, configurable thresholds' },
                                        { label: 'Dataset statistics', value: 'N50, N90, L50, GC, ambiguity' },
                                        { label: 'Composition', value: 'residues, skew, CpG, entropy' },
                                        { label: 'k-mer spectra', value: 'k = 1 to 15, exact counts' },
                                        { label: 'Redundancy', value: 'exact duplicates, verified' },
                                        { label: 'Similarity', value: 'MinHash, clustering, dendrogram' },
                                        { label: 'ORFs', value: '6 frames, 5 genetic codes' },
                                        { label: 'Alignment', value: 'Gotoh affine gaps, center-star MSA' },
                                        { label: 'Embeddings', value: 'k-mer spectrum, PCA and UMAP' },
                                        { label: 'Reports', value: 'self-contained HTML, CSV, JSON' },
                                    ] }) })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Why it stays on your machine", description: "The guarantee is structural, not a policy statement." }), _jsxs("div", { className: "space-y-2.5 px-4 pb-4 text-xs leading-relaxed text-muted-foreground", children: [_jsxs("p", { children: [_jsx("span", { className: "font-medium text-foreground", children: "No backend exists." }), " SeqLens is a static bundle. There is no API to send sequences to, because none was built."] }), _jsxs("p", { children: [_jsx("span", { className: "font-medium text-foreground", children: "No network calls after load." }), ' ', "Parsing, statistics, alignment, and embedding all run in Web Workers. Open your browser\u2019s network panel and watch an analysis run."] }), _jsxs("p", { children: [_jsx("span", { className: "font-medium text-foreground", children: "Storage is local and optional." }), ' ', "Files are held in IndexedDB on this device only when you save a project, and Settings has a control that deletes every trace of it."] }), _jsxs("p", { children: [_jsx("span", { className: "font-medium text-foreground", children: "No telemetry, no accounts." }), ' ', "Nothing is measured, and nothing identifies you."] }), _jsx("p", { children: "The deployed build ships a Content-Security-Policy that blocks outbound connections entirely, so the browser itself enforces this." })] })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsx(SectionHeading, { title: "Demo datasets", description: "Synthetic, deterministic, and generated on this device. Each one carries features worth finding, so you can see what every module reports before importing your own data." }), _jsx("div", { className: "grid gap-3 md:grid-cols-3", children: DEMO_DATASETS.map((demo) => (_jsxs(Card, { className: "flex flex-col", children: [_jsx(CardHeaderRow, { title: demo.title, description: demo.description }), _jsx("div", { className: "flex-1 px-4", children: _jsx("ul", { className: "space-y-1", children: demo.highlights.map((highlight) => (_jsxs("li", { className: "flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground", children: [_jsx("span", { className: "text-primary", "aria-hidden": true, children: "\u2022" }), highlight] }, highlight))) }) }), _jsxs("div", { className: "flex items-center justify-between gap-2 px-4 pt-3 pb-4", children: [_jsx("span", { className: "font-mono text-[10px] text-muted-foreground", children: demo.fileName }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => void onLoadDemo(demo.id), disabled: loadingDemo !== null, children: loadingDemo === demo.id ? 'Loading…' : 'Load' })] })] }, demo.id))) })] })] }));
}
