import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlertTriangle, FileUp, HardDrive, Sparkles, Trash2, Upload, X, } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FILE_ACCEPT, SUPPORTED_EXTENSIONS } from '@/bio/parsers/detect';
import { InlineJobProgress } from '@/components/layout/JobActivity';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList, SectionHeading, } from '@/components/ui/display';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/primitives';
import { DEMO_DATASETS } from '@/data/demoData';
import { useRecentJobs } from '@/state/jobStore';
import { useProjectStore } from '@/state/projectStore';
import { useSettingsStore } from '@/state/settingsStore';
import { estimateStorage } from '@/storage/db';
import { cn } from '@/utils/cn';
import { formatBytes, formatFileFormat, formatInteger, formatPercent, formatSequenceType, } from '@/utils/format';
/**
 * File import.
 *
 * Files are staged before import rather than starting immediately, for two
 * reasons: molecule-type detection can be wrong on short or unusual sequences
 * and the user may want to override it, and a multi-gigabyte file deserves a
 * confirmation step rather than starting on a stray drop.
 */
export function ImportPage() {
    const importFiles = useProjectStore((state) => state.importFiles);
    const cancelImport = useProjectStore((state) => state.cancelImport);
    const datasets = useProjectStore((state) => state.datasets);
    const selectDataset = useProjectStore((state) => state.selectDataset);
    const deleteDataset = useProjectStore((state) => state.deleteDataset);
    const largeFileWarnMb = useSettingsStore((state) => state.largeFileWarnMb);
    const recentJobs = useRecentJobs();
    const [queue, setQueue] = useState([]);
    const [dragging, setDragging] = useState(false);
    const [importing, setImporting] = useState(false);
    const [loadingDemo, setLoadingDemo] = useState(null);
    const [storage, setStorage] = useState(null);
    const inputRef = useRef(null);
    const navigate = useNavigate();
    useEffect(() => {
        void estimateStorage().then(setStorage);
    }, [datasets.length]);
    const addFiles = useCallback((files) => {
        const incoming = Array.from(files).map((file) => ({
            file,
            forcedType: 'unknown',
        }));
        setQueue((previous) => {
            const existing = new Set(previous.map((entry) => `${entry.file.name}:${entry.file.size}`));
            return [
                ...previous,
                ...incoming.filter((entry) => !existing.has(`${entry.file.name}:${entry.file.size}`)),
            ];
        });
    }, []);
    const handleDrop = useCallback((event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length > 0)
            addFiles(event.dataTransfer.files);
    }, [addFiles]);
    const startImport = async () => {
        if (queue.length === 0)
            return;
        setImporting(true);
        try {
            const imported = await importFiles(queue);
            setQueue([]);
            if (imported.length > 0) {
                selectDataset(imported[imported.length - 1].id);
                navigate('/qc');
            }
        }
        finally {
            setImporting(false);
        }
    };
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
    const runningImports = recentJobs.filter((job) => job.kind === 'import' && job.status === 'running');
    const failedImports = recentJobs.filter((job) => job.kind === 'import' && job.status === 'error');
    const totalQueuedBytes = queue.reduce((sum, entry) => sum + entry.file.size, 0);
    const largeFile = queue.find((entry) => entry.file.size > largeFileWarnMb * 1024 * 1024);
    return (_jsxs("div", { className: "space-y-5", children: [_jsx(SectionHeading, { title: "Import FASTA / FASTQ", description: "Files are read directly from this device with the browser's own streaming APIs and never uploaded. Parsing happens in a background thread, so a multi-gigabyte file does not freeze the interface." }), _jsxs("div", { onDragOver: (event) => {
                    event.preventDefault();
                    setDragging(true);
                }, onDragLeave: () => setDragging(false), onDrop: handleDrop, className: cn('rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors', dragging ? 'border-primary bg-primary-soft' : 'border-border bg-subtle'), children: [_jsx("input", { ref: inputRef, type: "file", multiple: true, accept: FILE_ACCEPT, className: "sr-only", onChange: (event) => {
                            if (event.target.files)
                                addFiles(event.target.files);
                            event.target.value = '';
                        } }), _jsx(FileUp, { className: "mx-auto size-7 text-muted-foreground", strokeWidth: 1.5, "aria-hidden": true }), _jsx("p", { className: "mt-3 text-sm font-medium text-foreground", children: "Drop sequence files here, or choose them" }), _jsxs("p", { className: "mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground", children: ["FASTA (", SUPPORTED_EXTENSIONS.filter((e) => !e.includes('gz') && e !== '.fastq' && e !== '.fq' && e !== '.txt').join(', '), "), FASTQ (.fastq, .fq), and gzipped versions of any of them. Format and molecule type are detected from the file contents."] }), _jsxs("div", { className: "mt-4 flex flex-wrap justify-center gap-2", children: [_jsxs(Button, { size: "sm", onClick: () => inputRef.current?.click(), children: [_jsx(Upload, {}), "Choose files"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void loadDemo(DEMO_DATASETS[0].id), disabled: loadingDemo !== null, children: [_jsx(Sparkles, {}), loadingDemo !== null ? 'Loading…' : 'Try demo dataset'] })] })] }), queue.length > 0 ? (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: `${formatInteger(queue.length)} file${queue.length === 1 ? '' : 's'} ready to import`, description: `${formatBytes(totalQueuedBytes)} total. Files are imported one at a time so peak memory stays bounded.`, actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "ghost", onClick: () => setQueue([]), disabled: importing, children: "Clear" }), _jsx(Button, { size: "sm", onClick: () => void startImport(), disabled: importing, children: importing ? 'Importing…' : 'Start import' })] }) }), _jsx("div", { className: "divide-y divide-border border-t border-border", children: queue.map((entry, index) => (_jsxs("div", { className: "flex flex-wrap items-center gap-3 px-4 py-2.5", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate font-mono text-xs text-foreground", children: entry.file.name }), _jsxs("p", { className: "text-[11px] text-muted-foreground", children: [formatBytes(entry.file.size), entry.file.name.toLowerCase().endsWith('.gz')
                                                    ? ' compressed'
                                                    : ''] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Label, { htmlFor: `type-${index}`, className: "text-[11px] whitespace-nowrap", children: "Type" }), _jsxs(Select, { value: entry.forcedType, onValueChange: (value) => setQueue((previous) => previous.map((candidate, i) => i === index
                                                ? { ...candidate, forcedType: value }
                                                : candidate)), children: [_jsx(SelectTrigger, { id: `type-${index}`, className: "h-7 w-32 text-xs", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "unknown", children: "Detect" }), _jsx(SelectItem, { value: "dna", children: "DNA" }), _jsx(SelectItem, { value: "rna", children: "RNA" }), _jsx(SelectItem, { value: "protein", children: "Protein" })] })] })] }), _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => setQueue((previous) => previous.filter((_, i) => i !== index)), disabled: importing, "aria-label": `Remove ${entry.file.name}`, children: _jsx(X, {}) })] }, `${entry.file.name}-${index}`))) }), largeFile ? (_jsx("div", { className: "border-t border-border px-4 py-3", children: _jsxs(Alert, { variant: "warning", title: "Large file", children: [_jsxs("p", { children: [_jsx("span", { className: "font-mono", children: largeFile.file.name }), " is", ' ', formatBytes(largeFile.file.size), ". SeqLens streams the file rather than loading it, so parsing will work, but the residues are written to this browser\u2019s IndexedDB and will occupy a comparable amount of disk."] }), _jsxs("p", { className: "mt-1", children: [storage?.supported && storage.quota > 0
                                            ? `This origin currently has about ${formatBytes(storage.quota - storage.usage)} of its storage quota left.`
                                            : 'Check available disk space before importing.', ' ', "Settings can cap the number of sequences imported if you only need a sample."] })] }) })) : null] })) : null, runningImports.map((job) => (_jsx(InlineJobProgress, { job: job, onCancel: job.datasetId ? () => cancelImport(job.datasetId) : undefined }, job.id))), failedImports.length > 0 ? (_jsx("div", { className: "space-y-2", children: failedImports.map((job) => (_jsxs(Alert, { variant: "error", title: job.error?.message ?? 'Import failed', children: [job.error?.suggestion ? _jsx("p", { children: job.error.suggestion }) : null, job.error?.location ? (_jsx("p", { className: "mt-1 font-mono text-[11px]", children: job.error.location })) : null, job.error?.detail ? (_jsxs("details", { className: "mt-1.5", children: [_jsx("summary", { className: "cursor-pointer text-[11px] hover:text-foreground", children: "Technical detail" }), _jsx("p", { className: "mt-1 font-mono text-[10px] break-words", children: job.error.detail })] })) : null] }, job.id))) })) : null, datasets.length > 0 ? (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Imported datasets", description: "Everything recorded at import time, including how the molecule type was decided." }), _jsx("div", { className: "divide-y divide-border border-t border-border", children: datasets.map((dataset) => (_jsxs("div", { className: "space-y-2 px-4 py-3", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("button", { type: "button", onClick: () => selectDataset(dataset.id), className: "truncate font-mono text-xs font-medium text-foreground hover:text-primary hover:underline", children: dataset.fileName }), _jsxs("div", { className: "mt-1 flex flex-wrap items-center gap-1", children: [_jsx(Badge, { variant: "outline", children: formatFileFormat(dataset.format) }), _jsx(Badge, { variant: "outline", children: formatSequenceType(dataset.sequenceType) }), dataset.gzipped ? _jsx(Badge, { variant: "default", children: "gzip" }) : null, dataset.qualityEncoding ? (_jsx(Badge, { variant: "default", children: dataset.qualityEncoding === 'phred64' ? 'Phred+64' : 'Phred+33' })) : null, dataset.truncated ? _jsx(Badge, { variant: "warning", children: "Truncated" }) : null] })] }), _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => void deleteDataset(dataset.id), "aria-label": `Delete ${dataset.fileName}`, title: "Delete this dataset and its results from local storage", children: _jsx(Trash2, { className: "text-destructive" }) })] }), _jsx(MetricList, { columns: 2, rows: [
                                        { label: 'Sequences', value: formatInteger(dataset.sequenceCount) },
                                        {
                                            label: dataset.sequenceType === 'protein' ? 'Total residues' : 'Total bases',
                                            value: formatInteger(dataset.totalResidues),
                                        },
                                        {
                                            label: 'Length range',
                                            value: `${formatInteger(dataset.minLength)} – ${formatInteger(dataset.maxLength)}`,
                                        },
                                        { label: 'File size', value: formatBytes(dataset.fileSize) },
                                        ...(dataset.decompressedSize
                                            ? [
                                                {
                                                    label: 'Decompressed',
                                                    value: `${formatBytes(dataset.decompressedSize)} (${formatDecimalRatio(dataset.decompressedSize, dataset.fileSize)}x)`,
                                                },
                                            ]
                                            : []),
                                        { label: 'Stored blocks', value: formatInteger(dataset.blockCount) },
                                        {
                                            label: 'Type detection',
                                            value: `${formatPercent(dataset.typeConfidence * 100, 0)} confidence`,
                                            hint: dataset.typeDetectionNote,
                                        },
                                    ] }), dataset.typeDetectionNote ? (_jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: [_jsx("span", { className: "font-medium text-foreground", children: "Type detection:" }), ' ', dataset.typeDetectionNote] })) : null, dataset.parseIssues.length > 0 ? (_jsxs("div", { className: "space-y-1.5 rounded border border-border bg-subtle px-3 py-2", children: [_jsxs("p", { className: "flex items-center gap-1.5 text-[11px] font-medium text-foreground", children: [_jsx(AlertTriangle, { className: "size-3 text-[#8a5f00]", "aria-hidden": true }), "Parser notes"] }), _jsx("ul", { className: "space-y-1", children: dataset.parseIssues.map((issue, i) => (_jsxs("li", { className: "text-[11px] leading-relaxed text-muted-foreground", children: [issue.count > 1 ? (_jsxs("span", { className: "font-medium text-foreground", children: [formatInteger(issue.count), "x", ' '] })) : null, issue.message, issue.line ? (_jsxs("span", { className: "ml-1 font-mono", children: ["(line ", formatInteger(issue.line), ")"] })) : null] }, i))) })] })) : null] }, dataset.id))) })] })) : null, _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Local storage", description: "Sequence data is written to this browser's IndexedDB on this device only." }), _jsx("div", { className: "px-4 pb-4", children: storage?.supported ? (_jsxs(_Fragment, { children: [_jsx(MetricList, { columns: 2, rows: [
                                        { label: 'Used by this origin', value: formatBytes(storage.usage) },
                                        { label: 'Quota', value: formatBytes(storage.quota) },
                                        {
                                            label: 'Remaining',
                                            value: formatBytes(Math.max(0, storage.quota - storage.usage)),
                                        },
                                        {
                                            label: 'Utilisation',
                                            value: storage.quota > 0
                                                ? formatPercent((storage.usage / storage.quota) * 100, 1)
                                                : '-',
                                        },
                                    ] }), _jsxs("p", { className: "mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground", children: [_jsx(HardDrive, { className: "mt-0.5 size-3 shrink-0", "aria-hidden": true }), "Browsers deliberately report a padded estimate here to limit fingerprinting, so treat these figures as approximate. The quota is typically a percentage of free disk space."] })] })) : (_jsx("p", { className: "text-xs text-muted-foreground", children: "This browser does not expose a storage estimate." })) })] })] }));
}
const formatDecimalRatio = (numerator, denominator) => denominator === 0 ? '-' : (numerator / denominator).toFixed(1);
