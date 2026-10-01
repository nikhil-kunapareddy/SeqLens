import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Download, Info, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { SERIES } from '@/components/charts/palette';
import { LineSeriesChart } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { SequenceTable } from '@/components/sequence/SequenceTable';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Tabs, TabsContent, TabsList, TabsTrigger, } from '@/components/ui/primitives';
import { AlignmentViewer } from '@/features/alignment/AlignmentViewer';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { selectActiveConfig, selectActiveDataset, selectActiveProject, useProjectStore, } from '@/state/projectStore';
import { MAX_SELECTION, selectSelection, useSelectionStore } from '@/state/selectionStore';
import { datasetRepository } from '@/storage/repositories';
import { MIME, copyToClipboard, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, slugify } from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';
/**
 * Pairwise and multiple sequence alignment.
 *
 * Alignment is the one module that needs an explicit sequence selection rather
 * than operating on the whole dataset, because its cost is quadratic in length
 * and it produces something a reader inspects rather than summarises. Two
 * sequences get an exact optimal alignment; more get a center-star progressive
 * alignment, and the page says which was used.
 */
export function AlignmentPage() {
    const dataset = useProjectStore(selectActiveDataset);
    const selection = useSelectionStore((state) => selectSelection(state, dataset?.id ?? null));
    return (_jsx(AnalysisGate, { kind: "alignment", title: "Alignment", description: "Exact Gotoh alignment with affine gap costs for a pair, or center-star progressive alignment for a set. Select sequences below, then run. Both paths produce a consensus, per-column conservation, and a variant table.", sequenceIndices: [...selection], configPanel: _jsx(AlignmentSetup, {}), unavailable: selection.length < 2
            ? {
                reason: `Alignment needs at least two sequences and ${selection.length === 0 ? 'none are' : 'one is'} selected.`,
                suggestion: (_jsx("p", { children: "Pick sequences in the table below. The Similarity module\u2019s top-pairs table also has a button that selects a pair and brings you here." })),
            }
            : null, children: (result, activeDataset) => (_jsx(AlignmentResults, { result: result, fileName: activeDataset.fileName, isProtein: activeDataset.sequenceType === 'protein' })) }));
}
/* -------------------------------------------------------------------------- */
/* Selection and configuration                                               */
/* -------------------------------------------------------------------------- */
function AlignmentSetup() {
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const config = useProjectStore(selectActiveConfig);
    const updateConfig = useProjectStore((state) => state.updateConfig);
    const selection = useSelectionStore((state) => selectSelection(state, dataset?.id ?? null));
    const toggle = useSelectionStore((state) => state.toggle);
    const clear = useSelectionStore((state) => state.clear);
    const { data: index } = useKeyedAsync(dataset?.id ?? null, (datasetId) => datasetRepository.getIndex(datasetId).then((value) => value ?? null));
    if (project === null || dataset === null)
        return null;
    const isProtein = dataset.sequenceType === 'protein';
    const alignment = config.alignment;
    const setAlignment = (changes) => {
        void updateConfig(project.id, { ...config, alignment: { ...alignment, ...changes } });
    };
    const selectedLengths = index
        ? selection.map((sequenceIndex) => index.lengths[sequenceIndex] ?? 0)
        : [];
    const longest = selectedLengths.length > 0 ? Math.max(...selectedLengths) : 0;
    const tracebackMb = selection.length === 2 && selectedLengths.length === 2
        ? (selectedLengths[0] + 1) * (selectedLengths[1] + 1) / (1024 * 1024)
        : null;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Alignment settings", description: selection.length === 2
                            ? 'Two sequences selected, so an exact optimal alignment will be computed with full traceback.'
                            : selection.length > 2
                                ? `${formatInteger(selection.length)} sequences selected, so a center-star progressive alignment will be used: ${formatInteger(selection.length - 1)} pairwise alignments against a central sequence, merged into one layout.`
                                : 'Select sequences in the table below to align them.', actions: _jsx(Button, { size: "sm", variant: "outline", onClick: () => void updateConfig(project.id, {
                                ...config,
                                alignment: { ...DEFAULT_CONFIG.alignment },
                            }), children: "Restore defaults" }) }), _jsxs("div", { className: "grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "align-mode", children: "Mode" }), _jsxs(Select, { value: alignment.mode, onValueChange: (value) => setAlignment({ mode: value }), children: [_jsx(SelectTrigger, { id: "align-mode", className: "h-7 text-xs", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "global", children: "Global (Needleman-Wunsch)" }), _jsx(SelectItem, { value: "local", children: "Local (Smith-Waterman)" })] })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Global aligns the sequences end to end, which is right for homologous sequences of similar length. Local finds the best-scoring sub-region and discards the flanks, which is right when only part of the sequences is related." })] }), isProtein ? (_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "align-matrix", children: "Substitution matrix" }), _jsxs(Select, { value: alignment.matrix, onValueChange: (value) => setAlignment({ matrix: value }), children: [_jsx(SelectTrigger, { id: "align-matrix", className: "h-7 text-xs", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "blosum62", children: "BLOSUM62" }), _jsx(SelectItem, { value: "pam250", children: "PAM250" }), _jsx(SelectItem, { value: "identity", children: "Identity" })] })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "BLOSUM62 is the standard for proteins at moderate divergence. PAM250 scores distant homologues better. Identity ignores chemical similarity entirely and is only useful as a baseline." })] })) : (_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { children: "Match / mismatch" }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Input, { type: "number", value: alignment.match, min: 1, max: 20, onChange: (event) => setAlignment({ match: Math.max(1, Number(event.target.value) || 2) }), className: "h-7 max-w-16 text-xs", "aria-label": "Match score" }), _jsx("span", { className: "text-[11px] text-muted-foreground", children: "/" }), _jsx(Input, { type: "number", value: alignment.mismatch, min: -20, max: 0, onChange: (event) => setAlignment({ mismatch: Math.min(0, Number(event.target.value) || -1) }), className: "h-7 max-w-16 text-xs", "aria-label": "Mismatch score" })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "The ratio matters more than the values. A high match relative to mismatch tolerates divergence; a harsh mismatch produces short, high-identity alignments." })] })), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { children: "Gap open / extend" }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Input, { type: "number", value: alignment.gapOpen, min: 0, max: 50, onChange: (event) => setAlignment({ gapOpen: Math.max(0, Number(event.target.value) || 5) }), className: "h-7 max-w-16 text-xs", "aria-label": "Gap open cost" }), _jsx("span", { className: "text-[11px] text-muted-foreground", children: "/" }), _jsx(Input, { type: "number", value: alignment.gapExtend, min: 0, max: 50, onChange: (event) => setAlignment({ gapExtend: Math.max(0, Number(event.target.value) || 2) }), className: "h-7 max-w-16 text-xs", "aria-label": "Gap extend cost" })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "A gap of length L costs open + L \u00D7 extend. A high open relative to extend produces few long gaps, which matches how indels actually arise; equal values reduce to a linear penalty and scatter single-base gaps." })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "consensus-threshold", children: "Consensus threshold" }), _jsx("span", { className: "tabular text-[11px] font-medium text-foreground", children: formatPercent(alignment.consensusThreshold * 100, 0) })] }), _jsx(Slider, { id: "consensus-threshold", min: 0.25, max: 1, step: 0.05, value: [alignment.consensusThreshold], onValueChange: ([value]) => setAlignment({ consensusThreshold: value }), className: "py-2" }), _jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "conserved-threshold", children: "Conserved threshold" }), _jsx("span", { className: "tabular text-[11px] font-medium text-foreground", children: formatPercent(alignment.conservedThreshold * 100, 0) })] }), _jsx(Slider, { id: "conserved-threshold", min: 0.5, max: 1, step: 0.05, value: [alignment.conservedThreshold], onValueChange: ([value]) => setAlignment({ conservedThreshold: value }), className: "py-2" }), _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: ["A column whose top residue does not reach the consensus threshold is called as", isProtein ? ' X' : ' N', " rather than reported as settled."] })] })] }), tracebackMb !== null ? (_jsx("div", { className: "border-t border-border px-4 py-3", children: _jsxs("p", { className: "flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground", children: [_jsx(Info, { className: "mt-0.5 size-3 shrink-0", "aria-hidden": true }), "An exact alignment of these two sequences needs a", ' ', _jsxs("span", { className: "font-medium text-foreground", children: [formatDecimal(tracebackMb, 1), " MB"] }), ' ', "traceback matrix, one byte per cell of the full", ' ', formatInteger(selectedLengths[0]), " \u00D7 ", formatInteger(selectedLengths[1]), " grid. There is no way around that for an optimal result; the limit is 128 MB."] }) })) : null] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Select sequences", description: _jsxs(_Fragment, { children: ["Click the checkbox to include a sequence. Up to ", MAX_SELECTION, " can be selected, and the alignment itself is capped at ", alignment.maxSequences, " sequences and", ' ', formatInteger(alignment.maxLength), " residues \u2014 adjustable in", ' ', _jsx(Link, { to: "/settings", className: "text-primary hover:underline", children: "Settings" }), "."] }), actions: selection.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Badge, { variant: "primary", children: [formatInteger(selection.length), " selected", longest > 0 ? `, longest ${formatInteger(longest)}` : ''] }), _jsxs(Button, { size: "sm", variant: "ghost", onClick: () => clear(dataset.id), children: [_jsx(Trash2, {}), "Clear"] })] })) : null }), _jsx("div", { className: "border-t border-border", children: index ? (_jsx(SequenceTable, { dataset: dataset, index: index, selected: [...selection], onToggle: (sequenceIndex) => toggle(dataset.id, sequenceIndex), height: 300, className: "rounded-none border-0" })) : (_jsx("p", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "Loading the sequence index\u2026" })) })] })] }));
}
/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */
function AlignmentResults({ result, fileName, isProtein, }) {
    const conservationSeries = useMemo(() => result.columns.map((column) => ({
        position: column.position,
        conservation: column.conservation * 100,
        gaps: column.gapFraction * 100,
    })), [result.columns]);
    const exportAlignment = async (format) => {
        if (format === 'fasta') {
            const fasta = result.rows
                .map((row) => `>${row.id}\n${row.aligned}\n`)
                .join('');
            await saveFile(fasta, {
                suggestedName: `${slugify(fileName)}-alignment.afa`,
                mimeType: MIME.fasta,
                description: 'Aligned FASTA',
                extensions: ['.afa', '.fasta'],
            });
            return;
        }
        // CLUSTAL format: 60-column blocks with a conservation line, which is what
        // most downstream alignment viewers expect to read.
        const width = 60;
        const nameWidth = Math.max(16, ...result.rows.map((row) => row.id.length)) + 2;
        const lines = ['CLUSTAL W (produced by SeqLens, center-star or Gotoh)', '', ''];
        for (let from = 0; from < result.stats.alignmentLength; from += width) {
            for (const row of result.rows) {
                lines.push(`${row.id.padEnd(nameWidth)}${row.aligned.slice(from, from + width)}`);
            }
            const marks = result.columns
                .slice(from, from + width)
                .map((column) => column.conservation >= 1 ? '*' : column.conservation >= 0.8 ? ':' : column.conservation >= 0.5 ? '.' : ' ')
                .join('');
            lines.push(`${''.padEnd(nameWidth)}${marks}`, '');
        }
        await saveFile(lines.join('\n'), {
            suggestedName: `${slugify(fileName)}-alignment.aln`,
            mimeType: MIME.text,
            description: 'CLUSTAL alignment',
            extensions: ['.aln'],
        });
    };
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "Method", value: result.method === 'pairwise-gotoh' ? 'Exact' : 'Center-star', detail: result.method === 'pairwise-gotoh'
                            ? `Optimal ${result.configSnapshot.mode} alignment, Gotoh affine gaps`
                            : `${formatInteger(result.stats.sequences - 1)} pairwise alignments merged`, badge: result.method === 'pairwise-gotoh' ? (_jsx(Badge, { variant: "pass", children: "Optimal" })) : (_jsx(Badge, { variant: "warning", children: "Heuristic" })) }), _jsx(StatTile, { label: "Alignment length", value: formatInteger(result.stats.alignmentLength), detail: `${formatInteger(result.stats.sequences)} sequences` }), _jsx(StatTile, { label: "Mean identity", value: formatPercent(result.stats.meanPairwiseIdentity * 100, 1), detail: "Over all pairs of rows, ignoring gap-gap columns" }), _jsx(StatTile, { label: "Gap fraction", value: formatPercent(result.stats.gapFraction * 100, 1), detail: "Of all cells in the alignment grid" }), _jsx(StatTile, { label: "Variants", value: formatInteger(result.stats.substitutions + result.stats.insertions + result.stats.deletions), detail: `${formatInteger(result.stats.substitutions)} substitutions, ${formatInteger(result.stats.insertions)} insertions, ${formatInteger(result.stats.deletions)} deletions` })] }), _jsx(AnalysisNotes, { notes: result.notes }), _jsxs(Tabs, { defaultValue: "alignment", children: [_jsxs(TabsList, { children: [_jsx(TabsTrigger, { value: "alignment", children: "Alignment" }), _jsx(TabsTrigger, { value: "conservation", children: "Conservation" }), _jsx(TabsTrigger, { value: "regions", children: "Regions" }), _jsx(TabsTrigger, { value: "variants", children: "Variants" }), _jsx(TabsTrigger, { value: "consensus", children: "Consensus" })] }), _jsxs(TabsContent, { value: "alignment", className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs(Button, { size: "sm", variant: "outline", onClick: () => void exportAlignment('fasta'), children: [_jsx(Download, {}), "Aligned FASTA"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void exportAlignment('clustal'), children: [_jsx(Download, {}), "CLUSTAL"] })] }), _jsx(AlignmentViewer, { rows: result.rows, consensus: result.consensus, columns: result.columns, isProtein: isProtein, conservedThreshold: result.configSnapshot.conservedThreshold, height: 520 })] }), _jsx(TabsContent, { value: "conservation", className: "space-y-4", children: _jsx(ChartFrame, { title: "Per-column conservation and gaps", description: "Conservation is the frequency of the most common non-gap residue among the non-gap residues in a column. The gap fraction is plotted separately, because a column with two residues and forty-eight gaps can be 100% conserved and still tell you almost nothing.", data: conservationSeries, columns: [
                                { key: 'position', header: 'Column', numeric: true },
                                {
                                    key: 'conservation',
                                    header: 'Conservation %',
                                    numeric: true,
                                    format: (value) => formatDecimal(Number(value), 1),
                                },
                                {
                                    key: 'gaps',
                                    header: 'Gap %',
                                    numeric: true,
                                    format: (value) => formatDecimal(Number(value), 1),
                                },
                            ], exportName: `${fileName}-alignment-conservation`, height: 300, children: _jsx(LineSeriesChart, { data: conservationSeries, xKey: "position", xLabel: "Alignment column", yLabel: "Percent", yDomain: [0, 100], valueFormatter: (value) => typeof value === 'number' ? `${formatDecimal(value, 1)}%` : String(value ?? ''), series: [
                                    { key: 'conservation', label: 'Conservation', color: SERIES[0] },
                                    { key: 'gaps', label: 'Gaps', color: SERIES[1] },
                                ] }) }) }), _jsx(TabsContent, { value: "regions", className: "space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(RegionTable, { title: "Conserved regions", description: `Runs of at least three consecutive columns at or above ${formatPercent(result.configSnapshot.conservedThreshold * 100, 0)} conservation.`, regions: result.conservedRegions, emptyLabel: "No region reaches the conserved threshold across three or more consecutive columns.", fileName: `${slugify(fileName)}-conserved-regions` }), _jsx(RegionTable, { title: "Variable regions", description: "Runs of at least three consecutive columns below the conserved threshold. In a real alignment these are where the informative differences are.", regions: result.variableRegions, emptyLabel: "Every column reaches the conserved threshold.", fileName: `${slugify(fileName)}-variable-regions` })] }) }), _jsx(TabsContent, { value: "variants", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Variants relative to the reference row", description: `Per-column differences from "${result.rows[0]?.id ?? 'the reference'}". Consecutive columns are not merged into multi-base events, so a three-base deletion appears as three rows: this is a tabulation, not a VCF.`, actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.variants.map((variant) => ({
                                            column: variant.column,
                                            kind: variant.kind,
                                            reference: variant.reference,
                                            observed: variant.observed,
                                            count: variant.count,
                                            sequenceIds: variant.sequenceIds.join('; '),
                                        }))), {
                                            suggestedName: `${slugify(fileName)}-variants.csv`,
                                            mimeType: MIME.csv,
                                            extensions: ['.csv'],
                                        }), disabled: result.variants.length === 0, children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-[32rem] overflow-auto border-t border-border", children: result.variants.length === 0 ? (_jsx(Alert, { variant: "success", className: "m-4", title: "No variants", children: "Every aligned sequence matches the reference row at every column." })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-right font-medium", children: "Column" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Type" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-center font-medium", children: "Change" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Sequences" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Carried by" })] }) }), _jsx("tbody", { children: result.variants.slice(0, 1000).map((variant, i) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "tabular px-4 py-1 text-right", children: formatInteger(variant.column) }), _jsx("td", { className: "px-3 py-1", children: _jsx(Badge, { variant: variant.kind === 'substitution'
                                                                    ? 'default'
                                                                    : variant.kind === 'insertion'
                                                                        ? 'primary'
                                                                        : 'warning', size: "sm", children: variant.kind }) }), _jsxs("td", { className: "px-3 py-1 text-center font-mono", children: [variant.reference, " \u2192 ", variant.observed] }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(variant.count) }), _jsxs("td", { className: "px-3 py-1 font-mono text-[10px] break-all text-muted-foreground", children: [variant.sequenceIds.join(', '), variant.count > variant.sequenceIds.length
                                                                    ? ` and ${formatInteger(variant.count - variant.sequenceIds.length)} more`
                                                                    : ''] })] }, i))) })] })) })] }) }), _jsx(TabsContent, { value: "consensus", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Consensus sequence", description: `Positions where the top residue reaches ${formatPercent(result.configSnapshot.consensusThreshold * 100, 0)} of the non-gap residues; other positions are called ${isProtein ? 'X' : 'N'}. Gap columns remain as dashes.`, actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => void copyToClipboard(result.consensus), children: "Copy" }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(`>consensus ${result.rows.length} sequences, ${result.stats.alignmentLength} columns\n${result.consensus.replace(/-/g, '')}\n`, {
                                                    suggestedName: `${slugify(fileName)}-consensus.fasta`,
                                                    mimeType: MIME.fasta,
                                                    extensions: ['.fasta'],
                                                }), children: [_jsx(Download, {}), "FASTA (ungapped)"] })] }) }), _jsxs("div", { className: "space-y-3 border-t border-border px-4 py-3", children: [_jsx(MetricList, { columns: 2, rows: [
                                                {
                                                    label: 'Length with gaps',
                                                    value: formatInteger(result.consensus.length),
                                                },
                                                {
                                                    label: 'Length without gaps',
                                                    value: formatInteger(result.consensus.replace(/-/g, '').length),
                                                },
                                                {
                                                    label: `Ambiguous (${isProtein ? 'X' : 'N'}) positions`,
                                                    value: formatInteger((result.consensus.match(isProtein ? /X/g : /N/g) ?? []).length),
                                                },
                                                {
                                                    label: 'Conserved columns',
                                                    value: formatInteger(result.columns.filter((column) => column.conservation >= result.configSnapshot.conservedThreshold).length),
                                                },
                                            ] }), _jsx("div", { className: "residues max-h-64 overflow-auto rounded border border-border bg-subtle p-2 text-[11px] break-all", children: result.consensus })] })] }) })] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(toJson(result), {
                    suggestedName: `${slugify(fileName)}-alignment.json`,
                    mimeType: MIME.json,
                    extensions: ['.json'],
                }), children: [_jsx(Download, {}), "Export full alignment result (JSON)"] })] }));
}
function RegionTable({ title, description, regions, emptyLabel, fileName, }) {
    return (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: `${title} (${formatInteger(regions.length)})`, description: description, actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(regions.map((region) => ({
                        start: region.start,
                        end: region.end,
                        length: region.end - region.start + 1,
                        meanConservation: region.meanConservation.toFixed(4),
                    }))), { suggestedName: `${fileName}.csv`, mimeType: MIME.csv, extensions: ['.csv'] }), disabled: regions.length === 0, children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-72 overflow-auto border-t border-border", children: regions.length === 0 ? (_jsx("p", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: emptyLabel })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-right font-medium", children: "Start" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "End" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Length" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Mean conservation" })] }) }), _jsx("tbody", { children: regions.map((region, i) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "tabular px-4 py-1 text-right", children: formatInteger(region.start) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(region.end) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(region.end - region.start + 1) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatPercent(region.meanConservation * 100, 1) })] }, i))) })] })) })] }));
}
