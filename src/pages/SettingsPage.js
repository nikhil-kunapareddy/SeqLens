import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Cpu, Database, Eye, HardDrive, RotateCcw, ShieldCheck, Trash2, } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList, SectionHeading } from '@/components/ui/display';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from '@/components/ui/overlays';
import { Input, Label, Separator, Slider, Switch } from '@/components/ui/primitives';
import { ThresholdPanel } from '@/features/qc/ThresholdPanel';
import { selectActiveConfig, selectActiveProject, useProjectStore } from '@/state/projectStore';
import { useSettingsStore } from '@/state/settingsStore';
import { estimateStorage, requestPersistentStorage } from '@/storage/db';
import { deleteAllLocalData, summarizeLocalData, } from '@/storage/repositories';
import { blockCache } from '@/storage/sequenceStore';
import { workerPool } from '@/workers/client';
import { APP_VERSION } from '@/types';
import { formatBytes, formatInteger, formatPercent } from '@/utils/format';
/**
 * Settings, privacy, and local data management.
 *
 * The privacy section is the substantive part of this page. The claim SeqLens
 * makes is not a policy promise but a structural one, so this section explains
 * what the architecture guarantees, what it does not, and how a reader can
 * check for themselves - and gives them a single control that removes
 * everything.
 */
export function SettingsPage() {
    const project = useProjectStore(selectActiveProject);
    const config = useProjectStore(selectActiveConfig);
    const updateConfig = useProjectStore((state) => state.updateConfig);
    const initialize = useProjectStore((state) => state.initialize);
    const settings = useSettingsStore();
    const updateSetting = useSettingsStore((state) => state.update);
    const resetSettings = useSettingsStore((state) => state.reset);
    const [storage, setStorage] = useState(null);
    const [persistence, setPersistence] = useState(null);
    const [summary, setSummary] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [deleted, setDeleted] = useState(false);
    const refresh = () => {
        void estimateStorage().then(setStorage);
        void summarizeLocalData().then(setSummary);
    };
    useEffect(() => {
        refresh();
        void navigator.storage
            ?.persisted?.()
            .then((granted) => setPersistence({ granted, supported: true }))
            .catch(() => setPersistence({ granted: false, supported: false }));
    }, []);
    const confirmDelete = async () => {
        await deleteAllLocalData();
        workerPool.dispose();
        setDeleting(false);
        setConfirmText('');
        setDeleted(true);
        refresh();
        await initialize();
    };
    const poolStats = workerPool.stats;
    const cacheStats = blockCache.stats;
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(SectionHeading, { title: "Settings", description: "Display preferences and performance limits are stored per browser. Analysis thresholds belong to the project, because they determine what the results mean and must travel with them." }), _jsxs("section", { id: "privacy", className: "space-y-3 scroll-mt-4", children: [_jsx(SectionHeading, { title: _jsxs("span", { className: "flex items-center gap-2", children: [_jsx(ShieldCheck, { className: "size-4 text-[#067506]", "aria-hidden": true }), "Privacy"] }), description: "Your sequence data never leaves this browser." }), _jsx(Card, { children: _jsxs("div", { className: "space-y-3 px-4 py-4 text-xs leading-relaxed text-muted-foreground", children: [_jsxs(PrivacyPoint, { title: "Files are processed locally.", children: ["Files are read from your device with the browser\u2019s own streaming APIs (", _jsx("span", { className: "font-mono", children: "File.stream" }), ",", ' ', _jsx("span", { className: "font-mono", children: "DecompressionStream" }), ", and", ' ', _jsx("span", { className: "font-mono", children: "TextDecoder" }), ") and parsed inside Web Workers on this machine. Parsing, statistics, k-mer counting, alignment, clustering, and embedding are all computed here."] }), _jsx(PrivacyPoint, { title: "Files are stored locally only when you save a project.", children: "Sequence data is written to this browser\u2019s IndexedDB when you import into a project, so you can return to it later. It stays on this device. Nothing is written outside the browser\u2019s own storage except the files you explicitly export through a save dialog." }), _jsx(PrivacyPoint, { title: "No biological sequence data is transmitted.", children: "There is no backend to transmit it to. SeqLens is a static bundle with no server component and no API layer \u2014 not a service with a privacy policy, but an application with nowhere to send anything. After the page loads it makes no network request of any kind." }), _jsx(PrivacyPoint, { title: "No account is required.", children: "There is no sign-in, no identity, and no user record. Nothing here identifies you." }), _jsx(PrivacyPoint, { title: "No telemetry and no analytics.", children: "Nothing about your usage is measured, counted, or reported. There is no analytics script, no error-reporting service, and no usage beacon. When something fails, the message appears on your screen and in your console, and nowhere else." }), _jsx(PrivacyPoint, { title: "External network access is not required.", children: "Every feature works offline. The deployed build ships a Content-Security-Policy that restricts connections to the origin itself, so the browser enforces this rather than relying on the code to behave." }), _jsx(PrivacyPoint, { title: "You can delete all local data.", children: "The control below removes every project, dataset, sequence block, cached result, and report from this browser in one transaction. Exported files already saved to your filesystem are yours and are not touched." }), _jsx("div", { className: "rounded-md border border-border bg-subtle px-3 py-2.5", children: _jsxs("p", { className: "flex items-start gap-2 text-[11px] text-foreground", children: [_jsx(Eye, { className: "mt-0.5 size-3.5 shrink-0 text-primary", "aria-hidden": true }), _jsxs("span", { children: [_jsx("span", { className: "font-medium", children: "Verify it yourself." }), " Open your browser\u2019s developer tools, go to the Network panel, import a file, and run every analysis. You will see no outbound requests. This is the only kind of privacy claim worth making: one you can check."] })] }) }), _jsx("div", { className: "rounded-md border border-border bg-subtle px-3 py-2.5", children: _jsxs("p", { className: "text-[11px] text-foreground", children: [_jsx("span", { className: "font-medium", children: "What this does not protect against." }), " Data in IndexedDB is readable by anything with access to this browser profile, and is not encrypted at rest beyond whatever full-disk encryption the machine has. On a shared or managed device, use the delete control when you are done. A browser extension with permission to read page data could also read it \u2014 that is true of any web application, including this one."] }) })] }) }), _jsxs(Card, { className: "border-destructive/30", children: [_jsx(CardHeaderRow, { title: "Delete all local data", description: "Removes every project, dataset, sequence block, analysis result, report, and preference from this browser. There is no undo, and no copy exists anywhere else.", actions: _jsxs(Button, { size: "sm", variant: "destructive", onClick: () => setDeleting(true), children: [_jsx(Trash2, {}), "Delete all local data"] }) }), summary ? (_jsx("div", { className: "border-t border-border px-4 py-3", children: _jsx(MetricList, { columns: 2, rows: [
                                        { label: 'Projects', value: formatInteger(summary.projects) },
                                        { label: 'Datasets', value: formatInteger(summary.datasets) },
                                        { label: 'Sequences', value: formatInteger(summary.sequences) },
                                        { label: 'Residues', value: formatInteger(summary.residues) },
                                        { label: 'Sequence blocks', value: formatInteger(summary.blocks) },
                                        { label: 'Cached results', value: formatInteger(summary.results) },
                                        { label: 'Saved reports', value: formatInteger(summary.reports) },
                                        {
                                            label: 'Storage used by this origin',
                                            value: storage?.supported ? formatBytes(storage.usage) : 'unavailable',
                                        },
                                    ] }) })) : null, deleted ? (_jsx("div", { className: "border-t border-border px-4 py-3", children: _jsx(Alert, { variant: "success", title: "All local data deleted", children: "Every project, dataset, result, report, and preference has been removed from this browser." }) })) : null] })] }), _jsx(Separator, {}), _jsxs("section", { id: "qc", className: "space-y-3 scroll-mt-4", children: [_jsx(SectionHeading, { title: "Analysis thresholds", description: project
                            ? `Saved with "${project.name}". Changing a threshold invalidates the cached results that depend on it, so the next run recomputes the verdicts.`
                            : 'Create a project to configure analysis thresholds.', actions: project ? (_jsxs(Button, { size: "sm", variant: "outline", onClick: () => void updateConfig(project.id, structuredClone(DEFAULT_CONFIG)), children: [_jsx(RotateCcw, {}), "Restore all defaults"] })) : null }), _jsx(ThresholdPanel, {}), project ? (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Import limits", description: "Caps applied while reading a file. Useful for sampling a very large file rather than importing all of it, and for keeping within the browser's storage quota." }), _jsxs("div", { className: "grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "max-sequences", children: "Maximum sequences" }), _jsx(Input, { id: "max-sequences", type: "number", min: 0, step: 1000, value: config.import.maxSequences, onChange: (event) => void updateConfig(project.id, {
                                                    ...config,
                                                    import: {
                                                        ...config.import,
                                                        maxSequences: Math.max(0, Number(event.target.value) || 0),
                                                    },
                                                }), className: "h-7 max-w-32 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "0 imports every record. When a limit stops an import, the dataset is marked truncated and every statistic says it describes only the imported portion." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "max-residues", children: "Maximum residues" }), _jsx(Input, { id: "max-residues", type: "number", min: 0, step: 1_000_000, value: config.import.maxResidues, onChange: (event) => void updateConfig(project.id, {
                                                    ...config,
                                                    import: {
                                                        ...config.import,
                                                        maxResidues: Math.max(0, Number(event.target.value) || 0),
                                                    },
                                                }), className: "h-7 max-w-32 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "0 means unlimited. Residues in IndexedDB occupy roughly one byte each, so this is the most direct control over how much disk a dataset uses." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "block-residues", children: "Block size (residues)" }), _jsx(Input, { id: "block-residues", type: "number", min: 100_000, max: 32_000_000, step: 1_000_000, value: config.import.blockResidues, onChange: (event) => void updateConfig(project.id, {
                                                    ...config,
                                                    import: {
                                                        ...config.import,
                                                        blockResidues: Math.max(100_000, Number(event.target.value) || 4_000_000),
                                                    },
                                                }), className: "h-7 max-w-32 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Sequences are stored in concatenated blocks. A block is the unit of reading, so larger blocks mean fewer IndexedDB round-trips but a higher memory floor during analysis." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "block-sequences", children: "Block size (sequences)" }), _jsx(Input, { id: "block-sequences", type: "number", min: 100, max: 100_000, step: 500, value: config.import.blockSequences, onChange: (event) => void updateConfig(project.id, {
                                                    ...config,
                                                    import: {
                                                        ...config.import,
                                                        blockSequences: Math.max(100, Number(event.target.value) || 5000),
                                                    },
                                                }), className: "h-7 max-w-32 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "A block is sealed when it reaches either limit. For short reads the sequence count binds first; for long contigs the residue count does." })] })] })] })) : null] }), _jsx(Separator, {}), _jsxs("section", { className: "space-y-3", children: [_jsx(SectionHeading, { title: "Display", description: "How results are rendered. These never affect a computed value, so changing one does not invalidate a cached result.", actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void resetSettings(), children: [_jsx(RotateCcw, {}), "Restore defaults"] }) }), _jsx(Card, { children: _jsxs("div", { className: "grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "line-width", children: "Residues per line" }), _jsx(Input, { id: "line-width", type: "number", min: 10, max: 300, step: 10, value: settings.sequenceLineWidth, onChange: (event) => void updateSetting('sequenceLineWidth', Math.max(10, Number(event.target.value) || 60)), className: "h-7 max-w-24 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Line width in the sequence viewer. 60 and 80 are the conventional widths for FASTA." })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "font-size", children: "Sequence font size" }), _jsxs("span", { className: "tabular text-[11px] font-medium text-foreground", children: [settings.sequenceFontSize, "px"] })] }), _jsx(Slider, { id: "font-size", min: 9, max: 18, step: 1, value: [settings.sequenceFontSize], onValueChange: ([value]) => void updateSetting('sequenceFontSize', value), className: "py-2" })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "color-residues", checked: settings.colorResidues, onCheckedChange: (checked) => void updateSetting('colorResidues', checked) }), _jsx(Label, { htmlFor: "color-residues", className: "cursor-pointer", children: "Colour residues" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "show-ruler", checked: settings.showRuler, onCheckedChange: (checked) => void updateSetting('showRuler', checked) }), _jsx(Label, { htmlFor: "show-ruler", className: "cursor-pointer", children: "Show the position ruler" })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Residue colouring needs one DOM node per residue on the visible lines. Turning it off makes scrolling a very long sequence noticeably smoother." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "large-file-warn", children: "Large-file warning" }), _jsx(Input, { id: "large-file-warn", type: "number", min: 1, max: 100_000, step: 50, value: settings.largeFileWarnMb, onChange: (event) => void updateSetting('largeFileWarnMb', Math.max(1, Number(event.target.value) || 500)), className: "h-7 max-w-24 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Warn before importing a file larger than this, in megabytes." })] })] }) })] }), _jsx(Separator, {}), _jsxs("section", { className: "space-y-3", children: [_jsx(SectionHeading, { title: "Performance and storage", description: "What SeqLens is using on this machine right now." }), _jsxs("div", { className: "grid gap-3 md:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: _jsxs("span", { className: "flex items-center gap-2", children: [_jsx(Cpu, { className: "size-4 text-muted-foreground", "aria-hidden": true }), "Compute"] }), description: "Analyses run in Web Workers so the interface stays responsive. The pool is capped below the core count because memory, not CPU, is the binding constraint: each worker holds its own block plus its accumulators, and the tab has one heap budget." }), _jsxs("div", { className: "px-4 pb-4", children: [_jsx(MetricList, { rows: [
                                                    {
                                                        label: 'Logical cores reported',
                                                        value: formatInteger(navigator.hardwareConcurrency ?? 0),
                                                    },
                                                    { label: 'Worker pool limit', value: formatInteger(poolStats.maxWorkers) },
                                                    { label: 'Workers started', value: formatInteger(poolStats.workers) },
                                                    { label: 'Jobs running', value: formatInteger(poolStats.running) },
                                                ] }), _jsxs("div", { className: "mt-3 space-y-1", children: [_jsx(Label, { htmlFor: "cache-budget", children: "Read cache budget (MB)" }), _jsx(Input, { id: "cache-budget", type: "number", min: 1, max: 512, step: 4, value: settings.cacheBudgetMb, onChange: (event) => void updateSetting('cacheBudgetMb', Math.max(1, Number(event.target.value) || 24)), className: "h-7 max-w-24 text-xs" }), _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: ["Residues held in memory for the sequence explorer. Currently holding", ' ', formatInteger(cacheStats.blocks), " block", cacheStats.blocks === 1 ? '' : 's', " and", ' ', formatInteger(cacheStats.residues), " residues. A larger budget makes scrolling smoother at the cost of heap."] })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: _jsxs("span", { className: "flex items-center gap-2", children: [_jsx(HardDrive, { className: "size-4 text-muted-foreground", "aria-hidden": true }), "Storage"] }), description: "The browser's own estimate for this origin. Browsers deliberately pad this figure to limit fingerprinting, so treat it as approximate.", actions: _jsx(Button, { size: "sm", variant: "outline", onClick: refresh, children: "Refresh" }) }), _jsxs("div", { className: "px-4 pb-4", children: [storage?.supported ? (_jsx(MetricList, { rows: [
                                                    { label: 'Used', value: formatBytes(storage.usage) },
                                                    { label: 'Quota', value: formatBytes(storage.quota) },
                                                    {
                                                        label: 'Remaining',
                                                        value: formatBytes(Math.max(0, storage.quota - storage.usage)),
                                                    },
                                                    {
                                                        label: 'Utilisation',
                                                        value: storage.quota > 0
                                                            ? formatPercent((storage.usage / storage.quota) * 100, 2)
                                                            : '-',
                                                    },
                                                ] })) : (_jsx("p", { className: "text-xs text-muted-foreground", children: "This browser does not expose a storage estimate." })), _jsxs("div", { className: "mt-3 space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "persistence", checked: settings.requestPersistence, onCheckedChange: (checked) => {
                                                                    void updateSetting('requestPersistence', checked);
                                                                    if (checked)
                                                                        void requestPersistentStorage().then(setPersistence);
                                                                } }), _jsx(Label, { htmlFor: "persistence", className: "cursor-pointer", children: "Request persistent storage" }), persistence?.granted ? (_jsx(Badge, { variant: "pass", children: "Granted" })) : persistence?.supported ? (_jsx(Badge, { variant: "neutral", children: "Not granted" })) : (_jsx(Badge, { variant: "neutral", children: "Unsupported" }))] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Without persistence, a browser under storage pressure may clear IndexedDB and a saved project disappears. Chrome grants this silently for sites you use regularly; Firefox prompts. A refusal is not an error \u2014 it just means saved projects are best-effort." })] })] })] })] })] }), _jsx(Separator, {}), _jsxs("section", { className: "space-y-3", children: [_jsx(SectionHeading, { title: "About" }), _jsx(Card, { children: _jsxs("div", { className: "px-4 py-4", children: [_jsx(MetricList, { columns: 2, rows: [
                                        { label: 'SeqLens version', value: APP_VERSION },
                                        {
                                            label: 'Web Workers',
                                            value: typeof Worker === 'undefined' ? 'Unavailable' : 'Available',
                                        },
                                        {
                                            label: 'IndexedDB',
                                            value: typeof indexedDB === 'undefined' ? 'Unavailable' : 'Available',
                                        },
                                        {
                                            label: 'gzip decompression',
                                            value: typeof DecompressionStream === 'undefined' ? 'Unavailable' : 'Available',
                                        },
                                        {
                                            label: 'File System Access',
                                            value: typeof globalThis.showSaveFilePicker ===
                                                'function'
                                                ? 'Available (save dialog)'
                                                : 'Unavailable (falls back to download)',
                                        },
                                        {
                                            label: 'Storage estimate',
                                            value: storage?.supported ? 'Available' : 'Unavailable',
                                        },
                                    ] }), _jsx("p", { className: "mt-3 text-[11px] leading-relaxed text-muted-foreground", children: "Where a browser capability is missing, SeqLens degrades rather than failing: without the File System Access API it falls back to a plain download, and without DecompressionStream it asks you to decompress the file first. Web Workers and IndexedDB are the two it genuinely needs." })] }) })] }), _jsx(Dialog, { open: deleting, onOpenChange: (open) => {
                    if (!open) {
                        setDeleting(false);
                        setConfirmText('');
                    }
                }, children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "size-4 text-destructive", "aria-hidden": true }), "Delete all local data?"] }), _jsxs(DialogDescription, { children: ["This removes everything SeqLens has stored in this browser:", summary
                                            ? ` ${formatInteger(summary.projects)} project${summary.projects === 1 ? '' : 's'}, ${formatInteger(summary.datasets)} dataset${summary.datasets === 1 ? '' : 's'}, ${formatInteger(summary.sequences)} sequences, ${formatInteger(summary.results)} cached result${summary.results === 1 ? '' : 's'}, and ${formatInteger(summary.reports)} report${summary.reports === 1 ? '' : 's'}.`
                                            : ' every project, dataset, result, and report.', ' ', "There is no undo and no copy anywhere else \u2014 SeqLens never sent your data off this device. Files you have already exported to your filesystem are not affected."] })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsxs(Label, { htmlFor: "confirm-delete-all", children: ["Type ", _jsx("span", { className: "font-mono font-semibold", children: "delete everything" }), " to confirm"] }), _jsx(Input, { id: "confirm-delete-all", value: confirmText, onChange: (event) => setConfirmText(event.target.value), placeholder: "delete everything", autoComplete: "off" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => {
                                        setDeleting(false);
                                        setConfirmText('');
                                    }, children: "Cancel" }), _jsxs(Button, { variant: "destructive", size: "sm", onClick: () => void confirmDelete(), disabled: confirmText.trim().toLowerCase() !== 'delete everything', children: [_jsx(Database, {}), "Delete everything"] })] })] }) })] }));
}
function PrivacyPoint({ title, children }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold text-foreground", children: title }), _jsx("p", { className: "mt-0.5", children: children })] }));
}
