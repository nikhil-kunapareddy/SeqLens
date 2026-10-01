import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Database, Download, FolderPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatFastaRecord, formatFastqRecord } from '@/bio/parsers/writer';
import { SequenceTable } from '@/components/sequence/SequenceTable';
import { SequenceViewer } from '@/components/sequence/SequenceViewer';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, EmptyState, SectionHeading } from '@/components/ui/display';
import { selectQCResult, useAnalysisStore } from '@/state/analysisStore';
import { selectActiveDataset, selectActiveProject, useProjectStore } from '@/state/projectStore';
import { MAX_SELECTION, selectFocused, selectSelection, useSelectionStore, } from '@/state/selectionStore';
import { datasetRepository } from '@/storage/repositories';
import { getSequence, getSequencesByIndices } from '@/storage/sequenceStore';
import { MIME, saveFile } from '@/utils/export';
import { formatInteger, slugify } from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';
/**
 * Sequence explorer.
 *
 * The dataset browser and the residue viewer side by side. Both are virtualised
 * and both read through the block store, so opening a ten-million-sequence
 * dataset costs one index load and one block read rather than materialising
 * anything. The selection made here is shared with the Alignment module.
 */
export function ExplorerPage() {
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const qc = useAnalysisStore((state) => selectQCResult(state, dataset?.id ?? null));
    const selection = useSelectionStore((state) => selectSelection(state, dataset?.id ?? null));
    const focused = useSelectionStore((state) => selectFocused(state, dataset?.id ?? null));
    const toggle = useSelectionStore((state) => state.toggle);
    const setFocus = useSelectionStore((state) => state.focus);
    const clear = useSelectionStore((state) => state.clear);
    const [filter, setFilter] = useState('all');
    const { data: index } = useKeyedAsync(dataset?.id ?? null, (datasetId) => datasetRepository.getIndex(datasetId).then((value) => value ?? null));
    // The viewer shows the focused record, defaulting to the first so the panel
    // is never empty beside a populated table. Keyed on dataset and position
    // together, so switching either discards a read that is already in flight.
    const viewerKey = dataset !== null && index !== null && index.count > 0
        ? `${dataset.id}|${focused ?? 0}`
        : null;
    const { data: sequence } = useKeyedAsync(viewerKey, (key) => {
        const separator = key.lastIndexOf('|');
        return getSequence(key.slice(0, separator), Number(key.slice(separator + 1)));
    });
    /** Index restriction for the active filter. */
    const restrictTo = useMemo(() => {
        if (filter === 'all')
            return undefined;
        if (filter === 'selected')
            return new Set(selection);
        if (qc === null)
            return undefined;
        if (filter === 'flagged') {
            return new Set(qc.flaggedSequences.map((flag) => flag.index));
        }
        const duplicates = new Set();
        for (const group of qc.duplicateGroups) {
            duplicates.add(group.representativeIndex);
        }
        for (const flag of qc.flaggedSequences) {
            if (flag.flags.includes('duplicate'))
                duplicates.add(flag.index);
        }
        return duplicates;
    }, [filter, selection, qc]);
    const exportSelection = async () => {
        if (!dataset || selection.length === 0)
            return;
        const sequences = await getSequencesByIndices(dataset.id, [...selection]);
        const asFastq = dataset.format === 'fastq' && sequences.every((s) => s.quality !== undefined);
        const contents = sequences
            .map((s) => asFastq
            ? formatFastqRecord(s.id, s.description, s.residues, s.quality ?? '')
            : formatFastaRecord(s.id, s.description, s.residues))
            .join('');
        await saveFile(contents, {
            suggestedName: `${slugify(dataset.fileName)}-selection.${asFastq ? 'fastq' : 'fasta'}`,
            mimeType: asFastq ? MIME.fastq : MIME.fasta,
            description: asFastq ? 'FASTQ sequences' : 'FASTA sequences',
            extensions: [asFastq ? '.fastq' : '.fasta'],
        });
    };
    if (project === null) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: "Sequence explorer" }), _jsx(EmptyState, { icon: FolderPlus, title: "No project yet", description: "Import a FASTA or FASTQ file to browse its sequences.", actions: _jsx(Button, { size: "sm", asChild: true, children: _jsx(Link, { to: "/import", children: "Import FASTA / FASTQ" }) }) })] }));
    }
    if (dataset === null || index === null) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: "Sequence explorer" }), _jsx(EmptyState, { icon: Database, title: dataset === null ? 'No dataset selected' : 'Loading the sequence index', description: dataset === null
                        ? 'Import a file, or pick a dataset from the header.'
                        : 'Reading the compact index from local storage.', actions: dataset === null ? (_jsx(Button, { size: "sm", asChild: true, children: _jsx(Link, { to: "/import", children: "Import a file" }) })) : undefined })] }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(SectionHeading, { title: "Sequence explorer", description: _jsxs(_Fragment, { children: ["Browsing ", _jsx("span", { className: "font-mono", children: dataset.fileName }), ":", ' ', formatInteger(index.count), " sequences. Length, GC, and ambiguity come from the compact index, so sorting and filtering never read residues. Residues are fetched only for the record open in the viewer."] }), actions: _jsx(_Fragment, { children: selection.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Badge, { variant: "primary", children: [formatInteger(selection.length), " selected", selection.length >= MAX_SELECTION ? ' (limit)' : ''] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void exportSelection(), children: [_jsx(Download, {}), "Export selection"] }), _jsx(Button, { size: "sm", variant: "ghost", onClick: () => clear(dataset.id), children: "Clear" })] })) : null }) }), _jsx("div", { className: "flex flex-wrap items-center gap-1.5", children: [
                    { value: 'all', label: `All (${formatInteger(index.count)})` },
                    {
                        value: 'flagged',
                        label: qc ? `QC flagged (${formatInteger(qc.flaggedSequences.length)})` : 'QC flagged',
                    },
                    {
                        value: 'duplicates',
                        label: qc
                            ? `Duplicates (${formatInteger(qc.stats.duplicateSequences)})`
                            : 'Duplicates',
                    },
                    { value: 'selected', label: `Selected (${formatInteger(selection.length)})` },
                ].map((option) => (_jsx(Button, { size: "sm", variant: filter === option.value ? 'default' : 'outline', onClick: () => setFilter(option.value), disabled: (option.value === 'flagged' || option.value === 'duplicates') && qc === null, title: (option.value === 'flagged' || option.value === 'duplicates') && qc === null
                        ? 'Run QC to enable this filter'
                        : undefined, children: option.label }, option.value))) }), (filter === 'flagged' || filter === 'duplicates') && qc === null ? (_jsx(Alert, { variant: "info", title: "This filter needs QC results", children: "Run the quality control analysis to identify flagged and duplicate sequences." })) : null, _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(SequenceTable, { dataset: dataset, index: index, selected: [...selection], onToggle: (sequenceIndex) => toggle(dataset.id, sequenceIndex), onFocus: (sequenceIndex) => setFocus(dataset.id, sequenceIndex), focusedIndex: focused, restrictTo: restrictTo, height: 560 }), sequence ? (_jsx(SequenceViewer, { sequence: sequence, sequenceType: dataset.sequenceType, qualityOffset: dataset.qualityEncoding === 'phred64' ? 64 : 33, height: 470, metadata: qc
                            ? (() => {
                                const flag = qc.flaggedSequences.find((f) => f.index === sequence.index);
                                return flag ? [{ label: 'QC', value: flag.flags.join(', ') }] : [];
                            })()
                            : [] })) : (_jsx(Card, { children: _jsx(CardHeaderRow, { title: "No sequence open", description: "Click a row in the table to open it here." }) }))] })] }));
}
