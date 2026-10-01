import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Copy, Download, Eye } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GENETIC_CODES, getGeneticCode } from '@/bio/translation/geneticCode';
import { formatFastaRecord } from '@/bio/parsers/writer';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { SERIES } from '@/components/charts/palette';
import { BarList, Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { SequenceViewer } from '@/components/sequence/SequenceViewer';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Tabs, TabsContent, TabsList, TabsTrigger, } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { OrfMap } from '@/features/orf/OrfMap';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { selectActiveConfig, selectActiveDataset, selectActiveProject, useProjectStore, } from '@/state/projectStore';
import { getSequence } from '@/storage/sequenceStore';
import { runJob } from '@/workers/client';
import { cn } from '@/utils/cn';
import { MIME, copyToClipboard, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';
/**
 * ORF detection and six-frame translation.
 *
 * Two views on the same data: a dataset-level summary of every ORF found, and a
 * per-sequence inspector showing all six translated frames plus the ORF map
 * drawn against the sequence axis. The inspector runs its own single-sequence
 * job, so opening a 5 Mbp contig does not go through the whole-dataset path.
 */
export function OrfPage() {
    const dataset = useProjectStore(selectActiveDataset);
    const isProtein = dataset?.sequenceType === 'protein';
    return (_jsx(AnalysisGate, { kind: "orf", title: "ORF & translation", description: "Open reading frames in all six frames, under a choice of NCBI genetic code, with six-frame translation for any individual sequence. One ORF is reported per stop codon, starting at the first initiation codon after the previous stop.", configPanel: _jsx(OrfConfigPanel, {}), unavailable: isProtein
            ? {
                reason: 'This dataset was detected as protein, and open reading frames are a property of nucleotide sequence. There is nothing to translate.',
                suggestion: (_jsx("p", { children: "Select a DNA or RNA dataset from the header. If this file really is nucleotide data that was misdetected, re-import it with the sequence type set manually on the Import page." })),
            }
            : null, children: (result, activeDataset) => (_jsx(OrfResults, { result: result, fileName: activeDataset.fileName, datasetId: activeDataset.id })) }));
}
function OrfResults({ result, fileName, datasetId, }) {
    const [inspecting, setInspecting] = useState(null);
    const code = getGeneticCode(result.configSnapshot.geneticCode);
    const lengthBins = useMemo(() => result.lengthHistogram.map((bin) => ({
        label: formatInteger(bin.from),
        from: bin.from,
        to: bin.to,
        count: bin.count,
    })), [result.lengthHistogram]);
    const exportProteins = async () => {
        const fasta = result.orfs
            .map((orf) => formatFastaRecord(`${orf.sequenceId}_orf_${orf.start}_${orf.end}_${orf.strand}${orf.frame}`, `${orf.aminoAcidLength} aa, ${orf.startCodon} start, ${orf.stopCodon ?? 'partial'} stop, genetic code ${result.configSnapshot.geneticCode}`, orf.protein))
            .join('');
        await saveFile(fasta, {
            suggestedName: `${slugify(fileName)}-orf-proteins.faa`,
            mimeType: MIME.fasta,
            description: 'Protein FASTA',
            extensions: ['.faa'],
        });
    };
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "ORFs found", value: formatInteger(result.stats.orfCount), detail: `in ${formatInteger(result.stats.sequencesWithOrf)} of ${formatInteger(result.stats.sequencesScanned)} sequences` }), _jsx(StatTile, { label: "Longest ORF", value: `${formatInteger(result.stats.maxOrfLength)} aa`, detail: result.orfs[0]
                            ? `${result.orfs[0].sequenceId} ${result.orfs[0].strand}${result.orfs[0].frame}`
                            : 'None found' }), _jsx(StatTile, { label: "Median length", value: `${formatInteger(result.stats.medianOrfLength)} aa`, detail: `mean ${formatDecimal(result.stats.meanOrfLength, 1)} aa` }), _jsx(StatTile, { label: "Coding fraction", value: formatPercent(result.stats.codingFraction * 100, 1), detail: `${formatInteger(result.stats.totalCodingBases)} bases inside an ORF`, help: "Bases covered by a reported ORF divided by all bases scanned. ORFs in different frames can overlap, so this can exceed 100% on a dense sequence and is not a gene-density estimate." }), _jsx(StatTile, { label: "Genetic code", value: `Table ${result.configSnapshot.geneticCode}`, detail: code.name.length > 40 ? `${code.name.slice(0, 38)}…` : code.name, badge: result.configSnapshot.requireStartCodon ? (_jsx(Badge, { variant: "default", children: "Start required" })) : (_jsx(Badge, { variant: "default", children: "Stop to stop" })) })] }), _jsx(AnalysisNotes, { notes: result.notes }), _jsxs(Tabs, { defaultValue: "inspect", children: [_jsxs(TabsList, { children: [_jsx(TabsTrigger, { value: "inspect", children: "Inspect a sequence" }), _jsx(TabsTrigger, { value: "table", children: "All ORFs" }), _jsx(TabsTrigger, { value: "distributions", children: "Distributions" }), _jsx(TabsTrigger, { value: "codons", children: "Codon usage" })] }), _jsx(TabsContent, { value: "inspect", className: "space-y-4", children: _jsx(SequenceInspector, { datasetId: datasetId, orfs: result.orfs, initialIndex: result.orfs[0]?.sequenceIndex ?? 0, geneticCode: result.configSnapshot.geneticCode, selected: inspecting, onSelect: setInspecting }) }), _jsx(TabsContent, { value: "table", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: pluralize(result.orfs.length, 'ORF'), description: result.orfs.length < result.stats.orfCount
                                        ? `The ${formatInteger(result.orfs.length)} longest of ${formatInteger(result.stats.orfCount)} found. Summary statistics above cover all of them.`
                                        : 'Every ORF found, longest first. Coordinates are 1-based, inclusive, and on the forward strand of the input sequence.', actions: _jsxs(_Fragment, { children: [_jsxs(Button, { size: "sm", variant: "outline", onClick: () => void exportProteins(), children: [_jsx(Download, {}), "Proteins (FASTA)"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.orfs.map((orf) => ({
                                                    sequenceId: orf.sequenceId,
                                                    sequenceIndex: orf.sequenceIndex + 1,
                                                    strand: orf.strand,
                                                    frame: orf.frame,
                                                    start: orf.start,
                                                    end: orf.end,
                                                    nucleotideLength: orf.nucleotideLength,
                                                    aminoAcidLength: orf.aminoAcidLength,
                                                    startCodon: orf.startCodon,
                                                    stopCodon: orf.stopCodon ?? '',
                                                    partial: orf.partial,
                                                    protein: orf.protein,
                                                }))), {
                                                    suggestedName: `${slugify(fileName)}-orfs.csv`,
                                                    mimeType: MIME.csv,
                                                    extensions: ['.csv'],
                                                }), children: [_jsx(Download, {}), "CSV"] })] }) }), _jsx("div", { className: "max-h-[36rem] overflow-auto border-t border-border", children: result.orfs.length === 0 ? (_jsxs(Alert, { variant: "info", className: "m-4", title: "No ORFs met the criteria", children: ["No open reading frame of at least", ' ', formatInteger(result.configSnapshot.minAminoAcids), " amino acids was found under genetic code ", result.configSnapshot.geneticCode, result.configSnapshot.requireStartCodon
                                                ? ' with an initiation codon required'
                                                : ' scanning stop to stop', ". Lowering the minimum length, clearing the start-codon requirement, or allowing partial ORFs will find shorter and truncated frames."] })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-left font-medium", children: "Sequence" }), _jsx("th", { scope: "col", className: "px-2 py-1.5 text-center font-medium", children: "Frame" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Start" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "End" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Length" }), _jsx("th", { scope: "col", className: "px-2 py-1.5 text-center font-medium", children: "Codons" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Protein" }), _jsx("th", { scope: "col", className: "px-2 py-1.5 text-center font-medium" })] }) }), _jsx("tbody", { children: result.orfs.slice(0, 1000).map((orf, i) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "px-4 py-1 font-mono text-foreground", children: orf.sequenceId }), _jsx("td", { className: "px-2 py-1 text-center", children: _jsxs("span", { className: cn('inline-block rounded px-1 font-mono text-[10px]', orf.strand === '+'
                                                                    ? 'bg-[#2a78d6]/12 text-[#1c5cab]'
                                                                    : 'bg-[#eb6834]/12 text-[#a8431c]'), children: [orf.strand, orf.frame] }) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(orf.start) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(orf.end) }), _jsxs("td", { className: "tabular px-3 py-1 text-right", children: [formatInteger(orf.aminoAcidLength), " aa"] }), _jsxs("td", { className: "px-2 py-1 text-center font-mono text-[10px] text-muted-foreground", children: [orf.startCodon, '→', orf.stopCodon ?? '—', orf.partial ? (_jsx(Badge, { variant: "warning", size: "sm", className: "ml-1", children: "partial" })) : null] }), _jsxs("td", { className: "max-w-64 truncate px-3 py-1 font-mono text-[10px] text-muted-foreground", children: [orf.protein.slice(0, 48), orf.protein.length > 48 ? '…' : ''] }), _jsx("td", { className: "px-2 py-1 text-center", children: _jsxs("span", { className: "flex items-center gap-0.5", children: [_jsx(Button, { size: "sm", variant: "ghost", className: "h-6 px-1", onClick: () => void copyToClipboard(orf.protein), title: "Copy protein sequence", "aria-label": "Copy protein sequence", children: _jsx(Copy, { className: "size-3" }) }), _jsx(Button, { size: "sm", variant: "ghost", className: "h-6 px-1", onClick: () => setInspecting(orf.sequenceIndex), title: "Inspect this sequence", "aria-label": "Inspect this sequence", children: _jsx(Eye, { className: "size-3" }) })] }) })] }, i))) })] })) }), result.orfs.length > 1000 ? (_jsxs("p", { className: "border-t border-border bg-subtle px-4 py-1.5 text-[11px] text-muted-foreground", children: ["Showing the 1,000 longest. The CSV export contains all", ' ', formatInteger(result.orfs.length), " retained ORFs."] })) : null] }) }), _jsx(TabsContent, { value: "distributions", className: "space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(ChartFrame, { title: "ORF length distribution", description: "ORF lengths in amino acids.", data: lengthBins, columns: [
                                        { key: 'from', header: 'From (aa)', numeric: true },
                                        { key: 'to', header: 'To (aa)', numeric: true },
                                        { key: 'count', header: 'ORFs', numeric: true },
                                    ], exportName: `${fileName}-orf-length-distribution`, footnote: "In non-coding sequence, stop codons occur roughly every 21 codons by chance, so a long right tail is the signal that distinguishes real coding sequence from noise.", children: _jsx(Histogram, { data: lengthBins, xKey: "label", yKey: "count", xLabel: "ORF length (amino acids)", yLabel: "ORFs", yTickFormatter: formatInteger, tooltipLabel: (row) => `${formatInteger(Number(row.from))} – ${formatInteger(Number(row.to) - 1)} aa`, tooltipValue: (row) => `${formatInteger(Number(row.count))} ORFs` }) }), _jsx(ChartFrame, { title: "ORFs per frame", description: "How the ORFs distribute across the six reading frames. A real gene shows a strong imbalance; a random sequence does not.", data: result.perFrameCounts, columns: [
                                        { key: 'frame', header: 'Frame' },
                                        { key: 'count', header: 'ORFs', numeric: true },
                                    ], exportName: `${fileName}-orfs-per-frame`, children: _jsx(Histogram, { data: result.perFrameCounts, xKey: "frame", yKey: "count", xLabel: "Strand and frame", yLabel: "ORFs", yTickFormatter: formatInteger, colorFor: (row) => (String(row.frame).startsWith('+') ? SERIES[0] : SERIES[1]), tooltipValue: (row) => `${formatInteger(Number(row.count))} ORFs` }) })] }) }), _jsx(TabsContent, { value: "codons", className: "space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(ChartFrame, { title: "Start codon usage", description: `Which initiation codons the reported ORFs begin with. Genetic code ${result.configSnapshot.geneticCode} permits ${code.startCodons.join(', ')}.`, data: result.startCodonUsage, columns: [
                                        { key: 'codon', header: 'Codon' },
                                        { key: 'count', header: 'ORFs', numeric: true },
                                    ], exportName: `${fileName}-start-codons`, height: 200, children: _jsx(BarList, { items: result.startCodonUsage.map((entry) => ({
                                            label: entry.codon,
                                            value: entry.count,
                                            secondary: formatPercent((entry.count / Math.max(1, result.stats.orfCount)) * 100, 1),
                                        })), valueFormatter: formatInteger, maxItems: 12 }) }), _jsx(ChartFrame, { title: "Stop codon usage", description: `Which termination codons the ORFs end with. Genetic code ${result.configSnapshot.geneticCode} uses ${code.stopCodons.join(', ')}.`, data: result.stopCodonUsage, columns: [
                                        { key: 'codon', header: 'Codon' },
                                        { key: 'count', header: 'ORFs', numeric: true },
                                    ], exportName: `${fileName}-stop-codons`, height: 200, footnote: "Stop codon preference differs between organisms and is not uniform: TAA dominates in AT-rich genomes and TGA in GC-rich ones.", children: _jsx(BarList, { items: result.stopCodonUsage.map((entry) => ({
                                            label: entry.codon,
                                            value: entry.count,
                                            secondary: formatPercent((entry.count / Math.max(1, result.stats.orfCount)) * 100, 1),
                                        })), valueFormatter: formatInteger, maxItems: 12 }) })] }) })] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(toJson(result), {
                    suggestedName: `${slugify(fileName)}-orf.json`,
                    mimeType: MIME.json,
                    extensions: ['.json'],
                }), children: [_jsx(Download, {}), "Export full ORF result (JSON)"] })] }));
}
/* -------------------------------------------------------------------------- */
/* Per-sequence inspector                                                     */
/* -------------------------------------------------------------------------- */
/**
 * Single-sequence six-frame view.
 *
 * Runs its own `translate` job rather than reusing the dataset result, because
 * the full six-frame translation of a long contig is six strings as long as the
 * sequence and is not something the dataset-level result should carry for every
 * record.
 */
function SequenceInspector({ datasetId, orfs, initialIndex, geneticCode, selected, onSelect, }) {
    const config = useProjectStore(selectActiveConfig);
    const sequenceIndex = selected ?? initialIndex;
    // The highlighted ORF is stored with the translation key that produced it, so
    // switching sequence or genetic code drops the highlight by derivation rather
    // than by clearing it in an effect.
    const [highlight, setHighlight] = useState(null);
    // Candidate sequences: those with ORFs, so the picker is useful rather than a
    // list of every record in the dataset.
    const candidates = useMemo(() => {
        const seen = new Map();
        for (const orf of orfs) {
            const entry = seen.get(orf.sequenceIndex);
            if (entry) {
                entry.orfCount += 1;
                entry.longest = Math.max(entry.longest, orf.aminoAcidLength);
            }
            else {
                seen.set(orf.sequenceIndex, {
                    index: orf.sequenceIndex,
                    id: orf.sequenceId,
                    orfCount: 1,
                    longest: orf.aminoAcidLength,
                });
            }
        }
        return [...seen.values()].sort((a, b) => b.longest - a.longest).slice(0, 300);
    }, [orfs]);
    // Sequence and translation are loaded together and keyed on all three inputs,
    // so changing the selected sequence or the genetic code discards whichever
    // read is already in flight instead of racing it.
    const orfConfig = config.orf;
    const translationKey = `${datasetId}|${sequenceIndex}|${geneticCode}`;
    const { data: loaded, loading, error } = useKeyedAsync(translationKey, async () => Promise.all([
        getSequence(datasetId, sequenceIndex),
        runJob({
            kind: 'translate',
            datasetId,
            sequenceIndex,
            config: { ...orfConfig, geneticCode },
        }),
    ]));
    const sequence = loaded?.[0] ?? null;
    const translation = loaded?.[1] ?? null;
    const focusedOrf = highlight?.key === translationKey ? highlight.orf : null;
    const setFocusedOrf = (orf) => setHighlight(orf === null ? null : { key: translationKey, orf });
    const annotations = useMemo(() => {
        if (translation === null)
            return [];
        return translation.orfs.map((orf) => ({
            start: orf.start,
            end: orf.end,
            label: `ORF ${orf.strand}${orf.frame}`,
            color: orf.strand === '+' ? SERIES[0] : SERIES[1],
            detail: `${formatInteger(orf.aminoAcidLength)} aa, ${orf.startCodon} to ${orf.stopCodon ?? 'end'}`,
        }));
    }, [translation]);
    if (candidates.length === 0) {
        return (_jsx(Alert, { variant: "info", title: "No sequence has an ORF to inspect", children: "Lower the minimum ORF length or clear the start-codon requirement in the configuration panel and re-run the analysis." }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Label, { htmlFor: "inspect-sequence", className: "whitespace-nowrap", children: "Sequence" }), _jsxs(Select, { value: String(sequenceIndex), onValueChange: (value) => onSelect(Number(value)), children: [_jsx(SelectTrigger, { id: "inspect-sequence", className: "h-8 max-w-96 text-xs", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: candidates.map((candidate) => (_jsxs(SelectItem, { value: String(candidate.index), children: [_jsx("span", { className: "font-mono", children: candidate.id }), _jsxs("span", { className: "ml-2 text-muted-foreground", children: [candidate.orfCount, " ORF", candidate.orfCount === 1 ? '' : 's', ", longest", ' ', formatInteger(candidate.longest), " aa"] })] }, candidate.index))) })] }), loading ? _jsx(Badge, { variant: "default", children: "Translating\u2026" }) : null] }), error ? (_jsx(Alert, { variant: "error", title: "This sequence could not be translated", children: error.message })) : null, translation && sequence ? (_jsxs(_Fragment, { children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: `ORF map — ${translation.sequenceId}`, description: `${formatInteger(translation.length)} bases, ${pluralize(translation.orfs.length, 'ORF')} across six frames. Click an ORF to highlight it in the sequence below.` }), _jsx("div", { className: "border-t border-border p-3", children: _jsx(OrfMap, { orfs: translation.orfs, sequenceLength: translation.length, onSelect: setFocusedOrf, selectedOrf: focusedOrf }) })] }), focusedOrf ? (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: `ORF ${focusedOrf.strand}${focusedOrf.frame} at ${formatInteger(focusedOrf.start)}–${formatInteger(focusedOrf.end)}`, description: `${formatInteger(focusedOrf.aminoAcidLength)} amino acids, ${formatInteger(focusedOrf.nucleotideLength)} nucleotides including the stop codon.`, actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void copyToClipboard(focusedOrf.protein), children: [_jsx(Copy, {}), "Copy protein"] }) }), _jsxs("div", { className: "space-y-2 border-t border-border px-4 py-3", children: [_jsx(MetricList, { columns: 2, rows: [
                                            { label: 'Start codon', value: focusedOrf.startCodon, mono: true },
                                            {
                                                label: 'Stop codon',
                                                value: focusedOrf.stopCodon ?? 'none (partial ORF)',
                                                mono: true,
                                            },
                                            { label: 'Strand', value: focusedOrf.strand === '+' ? 'Forward' : 'Reverse' },
                                            { label: 'Frame', value: String(focusedOrf.frame) },
                                        ] }), _jsx("div", { className: "residues max-h-40 overflow-auto rounded border border-border bg-subtle p-2 text-[11px] break-all", children: focusedOrf.protein })] })] })) : null, _jsx(SequenceViewer, { sequence: sequence, sequenceType: "dna", annotations: annotations, height: 320, metadata: [{ label: 'ORFs', value: String(translation.orfs.length) }] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Six-frame translation", description: "Each frame's full translation, with stop codons shown as asterisks. The longest stop-free stretch is the signal to look at: a coding frame has one long run while the other five are broken up." }), _jsx("div", { className: "divide-y divide-border border-t border-border", children: translation.frames.map((frame) => (_jsxs("div", { className: "space-y-1 px-4 py-2.5", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("span", { className: cn('rounded px-1.5 py-0.5 font-mono text-[11px] font-medium', frame.strand === '+'
                                                        ? 'bg-[#2a78d6]/12 text-[#1c5cab]'
                                                        : 'bg-[#eb6834]/12 text-[#a8431c]'), children: [frame.strand, frame.frame] }), _jsxs("span", { className: "tabular text-[11px] text-muted-foreground", children: [formatInteger(frame.protein.length), " residues \u00B7", ' ', formatInteger(frame.stopCount), " stops \u00B7 longest stop-free stretch", ' ', _jsx("span", { className: "font-medium text-foreground", children: formatInteger(frame.longestStretch) })] }), _jsx(Button, { size: "sm", variant: "ghost", className: "ml-auto h-6 px-1.5", onClick: () => void copyToClipboard(frame.protein), title: "Copy this frame", "aria-label": "Copy this frame", children: _jsx(Copy, { className: "size-3" }) })] }), _jsx("div", { className: "residues max-h-24 overflow-auto rounded border border-border bg-subtle p-2 text-[10px] break-all", children: frame.protein.length === 0 ? (_jsx("span", { className: "text-muted-foreground", children: "Too short to translate in this frame." })) : (frame.protein) })] }, `${frame.strand}${frame.frame}`))) })] })] })) : null] }));
}
/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */
function OrfConfigPanel() {
    const project = useProjectStore(selectActiveProject);
    const config = useProjectStore(selectActiveConfig);
    const updateConfig = useProjectStore((state) => state.updateConfig);
    if (project === null)
        return null;
    const orf = config.orf;
    const code = getGeneticCode(orf.geneticCode);
    const setOrf = (changes) => {
        void updateConfig(project.id, { ...config, orf: { ...orf, ...changes } });
    };
    return (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "ORF detection settings", description: `Genetic code ${orf.geneticCode} (${code.name}). Start codons: ${code.startCodons.join(', ')}. Stop codons: ${code.stopCodons.join(', ')}.`, actions: _jsx(Button, { size: "sm", variant: "outline", onClick: () => void updateConfig(project.id, { ...config, orf: { ...DEFAULT_CONFIG.orf } }), children: "Restore defaults" }) }), _jsxs("div", { className: "grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "genetic-code", children: "Genetic code" }), _jsxs(Select, { value: String(orf.geneticCode), onValueChange: (value) => setOrf({ geneticCode: Number(value) }), children: [_jsx(SelectTrigger, { id: "genetic-code", className: "h-7 text-xs", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: GENETIC_CODES.map((table) => (_jsx(SelectItem, { value: String(table.id), children: table.shortName }, table.id))) })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: GENETIC_CODES.find((table) => table.id === orf.geneticCode)?.note })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "min-aa", children: "Minimum length" }), _jsx(Input, { id: "min-aa", type: "number", min: 1, max: 100_000, value: orf.minAminoAcids, onChange: (event) => setOrf({ minAminoAcids: Math.max(1, Number(event.target.value) || 50) }), className: "h-7 max-w-28 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "In amino acids, excluding the stop codon. In non-coding sequence stop codons appear roughly every 21 codons, so 50 filters most chance ORFs while keeping short real genes." })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "require-start", checked: orf.requireStartCodon, onCheckedChange: (checked) => setOrf({ requireStartCodon: checked }) }), _jsx(Label, { htmlFor: "require-start", className: "cursor-pointer", children: "Require a start codon" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "reverse-strand", checked: orf.searchReverseStrand, onCheckedChange: (checked) => setOrf({ searchReverseStrand: checked }) }), _jsx(Label, { htmlFor: "reverse-strand", className: "cursor-pointer", children: "Search the reverse strand" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Switch, { id: "partial-orfs", checked: orf.allowPartialOrfs, onCheckedChange: (checked) => setOrf({ allowPartialOrfs: checked }) }), _jsx(Label, { htmlFor: "partial-orfs", className: "cursor-pointer", children: "Report partial ORFs" })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Clearing the start requirement finds stop-to-stop stretches, which is what fragmentary assemblies need. Partial ORFs run off the end of the sequence with no stop codon." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "max-sequences", children: "Sequences to scan" }), _jsx(Input, { id: "max-sequences", type: "number", min: 1, max: 1_000_000, step: 100, value: orf.maxSequences, onChange: (event) => setOrf({ maxSequences: Math.max(1, Number(event.target.value) || 5000) }), className: "h-7 max-w-28 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Scanning is linear in total bases, but each sequence needs a reverse complement as long as itself, so a large read set is slower than the base count alone suggests." })] })] })] }));
}
