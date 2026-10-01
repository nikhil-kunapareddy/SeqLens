import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Download, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { METRIC_DOCS } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { BASE_COLORS, SERIES, divergingColor } from '@/components/charts/palette';
import { BarList, ChartLegend, Histogram, StackedAreaChart, } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { KmerConfigPanel } from '@/features/composition/KmerConfigPanel';
import { useDebouncedValue } from '@/utils/debounce';
import { MIME, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';
/**
 * Composition and k-mer analysis.
 *
 * Nucleotide and protein datasets show different panels, because almost nothing
 * transfers between them: GC skew is meaningless for a protein and an
 * isoelectric point is meaningless for DNA. The page reads the dataset's
 * detected molecule type and shows only what applies.
 */
export function CompositionPage() {
    return (_jsx(AnalysisGate, { kind: "composition", title: "Composition", description: "Residue composition, strand skew, CpG statistics, entropy, positional composition, and exact k-mer spectra. Every metric comes from one streaming pass over the dataset, so requesting four k values costs one read rather than four.", configPanel: _jsx(KmerConfigPanel, {}), children: (result, dataset) => _jsx(CompositionResults, { result: result, fileName: dataset.fileName }) }));
}
function CompositionResults({ result, fileName, }) {
    const isProtein = result.sequenceType === 'protein';
    return (_jsxs("div", { className: "space-y-5", children: [isProtein ? (_jsx(ProteinSummary, { result: result })) : (_jsx(NucleotideSummary, { result: result })), _jsx(AnalysisNotes, { notes: result.notes }), _jsxs(Tabs, { defaultValue: "residues", children: [_jsxs(TabsList, { children: [_jsx(TabsTrigger, { value: "residues", children: "Residues" }), _jsx(TabsTrigger, { value: "positional", children: "Positional" }), _jsx(TabsTrigger, { value: "kmers", children: "k-mer spectra" }), isProtein ? _jsx(TabsTrigger, { value: "properties", children: "Protein properties" }) : null] }), _jsx(TabsContent, { value: "residues", className: "space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(ChartFrame, { title: isProtein ? 'Amino acid composition' : 'Nucleotide composition', description: `Total counts over ${formatInteger(result.sequencesAnalyzed)} sequences.`, data: result.residueComposition, columns: [
                                        { key: 'residue', header: 'Residue' },
                                        { key: 'count', header: 'Count', numeric: true },
                                        {
                                            key: 'percent',
                                            header: 'Percent',
                                            numeric: true,
                                            format: (value) => formatDecimal(Number(value), 4),
                                        },
                                    ], exportName: `${fileName}-residue-composition`, height: isProtein ? 420 : 240, children: _jsx(BarList, { items: result.residueComposition.map((entry) => ({
                                            label: entry.residue,
                                            value: entry.count,
                                            secondary: formatPercent(entry.percent, 2),
                                        })), valueFormatter: formatInteger, maxItems: 30, color: isProtein ? SERIES[0] : (BASE_COLORS[result.residueComposition[0]?.residue] ?? SERIES[0]) }) }), isProtein && result.protein ? (_jsx(ChartFrame, { title: "Net charge at pH 7", description: "Distribution of per-sequence net charge, from the Henderson-Hasselbalch curve.", help: `${METRIC_DOCS.isoelectricPoint.what} ${METRIC_DOCS.isoelectricPoint.caveat}`, data: result.protein.chargeDistribution, columns: [
                                        { key: 'bucket', header: 'Net charge' },
                                        { key: 'count', header: 'Sequences', numeric: true },
                                    ], exportName: `${fileName}-charge-distribution`, children: _jsx(Histogram, { data: result.protein.chargeDistribution, xKey: "bucket", yKey: "count", xLabel: "Net charge at pH 7", yLabel: "Sequences", yTickFormatter: formatInteger, tooltipValue: (row) => `${formatInteger(Number(row.count))} sequences` }) })) : (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Strand and dinucleotide statistics", description: "Skew and CpG measures, which describe strand asymmetry and methylation-driven depletion respectively." }), _jsx("div", { className: "px-4 pb-4", children: result.nucleotide ? (_jsx(MetricList, { rows: [
                                                    {
                                                        label: 'GC skew (G−C)/(G+C)',
                                                        value: (_jsx("span", { style: { color: divergingColor(result.nucleotide.gcSkew) }, className: "font-medium", children: formatDecimal(result.nucleotide.gcSkew, 4) })),
                                                        hint: 'Flips sign at the replication origin in most bacterial chromosomes; averages to zero for reads from both strands.',
                                                    },
                                                    {
                                                        label: 'AT skew (A−T)/(A+T)',
                                                        value: (_jsx("span", { style: { color: divergingColor(result.nucleotide.atSkew) }, className: "font-medium", children: formatDecimal(result.nucleotide.atSkew, 4) })),
                                                    },
                                                    {
                                                        label: 'CpG dinucleotides',
                                                        value: formatInteger(result.nucleotide.cpgCount),
                                                    },
                                                    {
                                                        label: 'CpG observed / expected',
                                                        value: formatDecimal(result.nucleotide.cpgObservedExpected, 3),
                                                        hint: 'Vertebrate genomes show a marked deficit near 0.2; CpG islands rise above 0.6. Bacteria and plants have no such deficit.',
                                                    },
                                                    {
                                                        label: 'Entropy',
                                                        value: `${formatDecimal(result.nucleotide.entropyBitsPerBase, 4)} bits/base`,
                                                        hint: `${METRIC_DOCS.entropy.what} Maximum is 2 bits for four equally frequent bases.`,
                                                    },
                                                    {
                                                        label: 'Ambiguous residues',
                                                        value: formatPercent(result.nucleotide.ambiguousPercent, 3),
                                                    },
                                                ] })) : null })] }))] }) }), _jsx(TabsContent, { value: "positional", className: "space-y-4", children: result.positionalComposition.length === 0 ? (_jsx(Alert, { variant: "info", title: "No positional profile is available", children: "Positional composition needs at least one sequence long enough to cover the tracked positions." })) : (_jsx(ChartFrame, { title: "Per-position composition", description: "Residue composition at each position, as a percentage of the sequences covering that position.", data: result.positionalComposition, columns: [
                                { key: 'position', header: 'Position', numeric: true },
                                { key: 'A', header: 'A %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                                { key: 'C', header: 'C %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                                { key: 'G', header: 'G %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                                { key: 'T', header: 'T %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                                {
                                    key: isProtein ? 'other' : 'N',
                                    header: 'Other %',
                                    numeric: true,
                                    format: (v) => formatDecimal(Number(v), 2),
                                },
                            ], exportName: `${fileName}-positional-composition`, height: 300, footnote: isProtein
                                ? 'For protein datasets these five rows group residues by the first letter of the nucleotide alphabet and are not biologically meaningful; the amino acid composition table above is the correct view.'
                                : 'Capped at 500 positions. A pronounced bias across the first 10-15 bases of a read set is the normal signature of random-priming rather than a defect.', children: _jsxs(_Fragment, { children: [_jsx(StackedAreaChart, { data: result.positionalComposition, xKey: "position", xLabel: "Position", yLabel: "Composition (%)", valueFormatter: (value) => typeof value === 'number' ? `${formatDecimal(value, 2)}%` : String(value ?? ''), series: [
                                            { key: 'A', label: 'A', color: BASE_COLORS.A },
                                            { key: 'C', label: 'C', color: BASE_COLORS.C },
                                            { key: 'G', label: 'G', color: BASE_COLORS.G },
                                            { key: 'T', label: 'T / U', color: BASE_COLORS.T },
                                            { key: isProtein ? 'other' : 'N', label: 'Other', color: BASE_COLORS.N },
                                        ] }), _jsx(ChartLegend, { items: [
                                            { label: 'A', color: BASE_COLORS.A },
                                            { label: 'C', color: BASE_COLORS.C },
                                            { label: 'G', color: BASE_COLORS.G },
                                            { label: 'T / U', color: BASE_COLORS.T },
                                            { label: 'Other', color: BASE_COLORS.N },
                                        ] })] }) })) }), _jsx(TabsContent, { value: "kmers", className: "space-y-4", children: _jsx(KmerPanels, { spectra: result.kmerSpectra, fileName: fileName }) }), isProtein && result.protein ? (_jsxs(TabsContent, { value: "properties", className: "space-y-4", children: [_jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(ChartFrame, { title: "Hydrophobicity (GRAVY)", description: "Distribution of per-sequence grand average of hydropathy.", help: `${METRIC_DOCS.gravy.what} ${METRIC_DOCS.gravy.caveat}`, data: result.protein.hydrophobicityDistribution, columns: [
                                            { key: 'bucket', header: 'GRAVY' },
                                            { key: 'count', header: 'Sequences', numeric: true },
                                        ], exportName: `${fileName}-gravy-distribution`, children: _jsx(Histogram, { data: result.protein.hydrophobicityDistribution, xKey: "bucket", yKey: "count", xLabel: "GRAVY score", yLabel: "Sequences", yTickFormatter: formatInteger, tooltipValue: (row) => `${formatInteger(Number(row.count))} sequences` }) }), _jsx(ChartFrame, { title: "Molecular weight", description: "Distribution of estimated molecular weight of the unmodified chain.", help: `${METRIC_DOCS.molecularWeight.what} ${METRIC_DOCS.molecularWeight.caveat}`, data: result.protein.molecularWeightDistribution, columns: [
                                            { key: 'bucket', header: 'Molecular weight' },
                                            { key: 'count', header: 'Sequences', numeric: true },
                                        ], exportName: `${fileName}-mw-distribution`, children: _jsx(Histogram, { data: result.protein.molecularWeightDistribution, xKey: "bucket", yKey: "count", xLabel: "Molecular weight", yLabel: "Sequences", yTickFormatter: formatInteger, tooltipValue: (row) => `${formatInteger(Number(row.count))} sequences` }) })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Low-complexity regions", description: "Windows whose residue entropy falls below the low-complexity threshold, merged into maximal regions. These are common and functional in real disordered proteins, not defects.", actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.protein.lowComplexityRegions.map((region) => ({
                                                sequenceIndex: region.sequenceIndex + 1,
                                                sequenceId: region.sequenceId,
                                                start: region.start,
                                                end: region.end,
                                                length: region.end - region.start + 1,
                                                entropyBits: region.entropy.toFixed(4),
                                                dominantResidue: region.dominantResidue,
                                            }))), {
                                                suggestedName: `${slugify(fileName)}-low-complexity.csv`,
                                                mimeType: MIME.csv,
                                                extensions: ['.csv'],
                                            }), disabled: result.protein.lowComplexityRegions.length === 0, children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-72 overflow-auto border-t border-border", children: result.protein.lowComplexityRegions.length === 0 ? (_jsx("p", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "No low-complexity regions were found at the current threshold." })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-left font-medium", children: "Sequence" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Start" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "End" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Length" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Entropy" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Dominant" })] }) }), _jsx("tbody", { children: result.protein.lowComplexityRegions.slice(0, 200).map((region, i) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "px-4 py-1 font-mono text-foreground", children: region.sequenceId }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(region.start) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(region.end) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(region.end - region.start + 1) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(region.entropy, 2) }), _jsx("td", { className: "px-3 py-1 font-mono", children: region.dominantResidue })] }, i))) })] })) })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Per-sequence properties", description: `Physicochemical estimates for the first ${formatInteger(result.protein.perSequenceSample.length)} sequences.`, actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.protein.perSequenceSample.map((entry) => ({
                                                index: entry.index + 1,
                                                id: entry.id,
                                                length: entry.length,
                                                molecularWeightDa: entry.molecularWeight.toFixed(2),
                                                isoelectricPoint: entry.isoelectricPoint.toFixed(3),
                                                netChargeAtPh7: entry.netChargeAtPh7.toFixed(3),
                                                gravy: entry.gravy.toFixed(4),
                                                hydrophobicFraction: entry.hydrophobicFraction.toFixed(4),
                                                positiveResidues: entry.positiveResidues,
                                                negativeResidues: entry.negativeResidues,
                                                aromaticResidues: entry.aromaticResidues,
                                                extinction280: entry.extinctionCoefficient,
                                            }))), {
                                                suggestedName: `${slugify(fileName)}-protein-properties.csv`,
                                                mimeType: MIME.csv,
                                                extensions: ['.csv'],
                                            }), children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-96 overflow-auto border-t border-border", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-left font-medium", children: "Identifier" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Length" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "MW (kDa)" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "pI" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Charge pH7" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "GRAVY" })] }) }), _jsx("tbody", { children: result.protein.perSequenceSample.slice(0, 300).map((entry) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "px-4 py-1 font-mono text-foreground", children: entry.id }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatInteger(entry.length) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(entry.molecularWeight / 1000, 2) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(entry.isoelectricPoint, 2) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(entry.netChargeAtPh7, 2) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(entry.gravy, 3) })] }, entry.index))) })] }) })] })] })) : null] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(toJson(result), {
                    suggestedName: `${slugify(fileName)}-composition.json`,
                    mimeType: MIME.json,
                    extensions: ['.json'],
                }), children: [_jsx(Download, {}), "Export full composition result (JSON)"] })] }));
}
function NucleotideSummary({ result }) {
    if (!result.nucleotide)
        return null;
    const { nucleotide } = result;
    return (_jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "GC content", value: formatPercent(nucleotide.gcPercent, 2), detail: `AT ${formatPercent(nucleotide.atPercent, 2)}`, help: `${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}` }), _jsx(StatTile, { label: "GC skew", value: formatDecimal(nucleotide.gcSkew, 4), detail: "(G \u2212 C) / (G + C)", help: "Strand asymmetry in G versus C. Informative for single-stranded assemblies; averages to zero for reads sampled from both strands." }), _jsx(StatTile, { label: "CpG obs/exp", value: formatDecimal(nucleotide.cpgObservedExpected, 3), detail: `${formatInteger(nucleotide.cpgCount)} CpG dinucleotides`, help: "Observed CpG count divided by the count expected if C and G were independent. Vertebrates show a deficit near 0.2; bacteria and plants do not." }), _jsx(StatTile, { label: "Entropy", value: `${formatDecimal(nucleotide.entropyBitsPerBase, 3)} bits`, detail: "Maximum is 2 bits per base", help: `${METRIC_DOCS.entropy.what} ${METRIC_DOCS.entropy.caveat}` }), _jsx(StatTile, { label: "Sequences analysed", value: formatInteger(result.sequencesAnalyzed), detail: `${formatPercent(nucleotide.ambiguousPercent, 3)} ambiguous residues` })] }));
}
function ProteinSummary({ result }) {
    if (!result.protein)
        return null;
    const { aggregate } = result.protein;
    return (_jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "Mean GRAVY", value: formatDecimal(aggregate.gravy, 3), detail: `${formatPercent(aggregate.hydrophobicFraction * 100, 1)} hydrophobic residues`, help: `${METRIC_DOCS.gravy.what} ${METRIC_DOCS.gravy.caveat}` }), _jsx(StatTile, { label: "Aggregate pI", value: formatDecimal(aggregate.isoelectricPoint, 2), detail: "Over the pooled residue composition", help: `${METRIC_DOCS.isoelectricPoint.what} ${METRIC_DOCS.isoelectricPoint.caveat}` }), _jsx(StatTile, { label: "Charged residues", value: formatInteger(aggregate.positiveResidues + aggregate.negativeResidues), detail: `${formatInteger(aggregate.positiveResidues)} basic, ${formatInteger(aggregate.negativeResidues)} acidic` }), _jsx(StatTile, { label: "Aromatic residues", value: formatInteger(aggregate.aromaticResidues), detail: "F, W, and Y" }), _jsx(StatTile, { label: "Sequences analysed", value: formatInteger(result.sequencesAnalyzed), detail: `${pluralize(result.protein.lowComplexityRegions.length, 'low-complexity region')} found` })] }));
}
/* -------------------------------------------------------------------------- */
/* k-mer panels                                                               */
/* -------------------------------------------------------------------------- */
/**
 * One panel per requested k, with search and a rare-k-mer view.
 *
 * Search is over the retained top and rare lists rather than the whole table:
 * at k = 11 the full table has four million entries and is not transferred out
 * of the worker. The spectrum's summary statistics describe all of them.
 */
function KmerPanels({ spectra, fileName }) {
    const [activeK, setActiveK] = useState(() => spectra[0]?.k ?? 3);
    const spectrum = spectra.find((candidate) => candidate.k === activeK) ?? spectra[0];
    if (!spectrum) {
        return (_jsx(Alert, { variant: "info", title: "No k-mer spectra were computed", children: "Choose at least one k value in the configuration panel and re-run the analysis." }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "text-xs text-muted-foreground", children: "k =" }), spectra.map((candidate) => (_jsx(Button, { size: "sm", variant: candidate.k === activeK ? 'default' : 'outline', onClick: () => setActiveK(candidate.k), children: candidate.k }, candidate.k)))] }), _jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "Distinct k-mers", value: formatInteger(spectrum.distinct), detail: `of ${formatInteger(spectrum.possible)} possible (${formatPercent((spectrum.distinct / Math.max(1, spectrum.possible)) * 100, 2)})` }), _jsx(StatTile, { label: "Total counted", value: formatInteger(spectrum.total), detail: "k-mer positions, excluding windows with ambiguous residues" }), _jsx(StatTile, { label: "Entropy", value: `${formatDecimal(spectrum.entropy, 3)} bits`, detail: `normalised ${formatDecimal(spectrum.normalizedEntropy, 3)} of 1.0`, help: `${METRIC_DOCS.kmerEntropy.what} ${METRIC_DOCS.kmerEntropy.caveat}` }), _jsx(StatTile, { label: "Rare k-mers", value: formatInteger(spectrum.rareCount), detail: "At or below the configured rare threshold" }), _jsx(StatTile, { label: "Counting method", value: spectrum.exact ? 'Exact table' : 'Hash map', detail: spectrum.canonical
                            ? 'Reverse-complement pairs merged'
                            : 'Forward strand only', badge: spectrum.exact ? _jsx(Badge, { variant: "pass", children: "Exact" }) : _jsx(Badge, { variant: "default", children: "Sparse" }) })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-2", children: [_jsx(KmerList, { title: `Most frequent ${spectrum.k}-mers`, description: `The ${formatInteger(spectrum.top.length)} highest-count ${spectrum.k}-mers, with their share of all counted k-mers.`, entries: spectrum.top, fileName: `${fileName}-top-${spectrum.k}mers`, total: spectrum.total }), _jsx(KmerList, { title: `Rare ${spectrum.k}-mers`, description: `A sample of the ${formatInteger(spectrum.rareCount)} ${spectrum.k}-mers at or below the rare-count threshold. In a random sequence of this size, rare k-mers are expected; a k-mer that is absent entirely can indicate a restriction site or a methylation-sensitive motif.`, entries: spectrum.rare, fileName: `${fileName}-rare-${spectrum.k}mers`, total: spectrum.total, emptyLabel: "No k-mers fall at or below the rare threshold." })] })] }));
}
function KmerList({ title, description, entries, fileName, total, emptyLabel, }) {
    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, 180);
    const filtered = useMemo(() => {
        const needle = debounced.trim().toUpperCase();
        if (needle.length === 0)
            return entries;
        return entries.filter((entry) => entry.kmer.includes(needle));
    }, [entries, debounced]);
    return (_jsx(ChartFrame, { title: title, description: description, data: filtered, columns: [
            { key: 'kmer', header: 'k-mer' },
            { key: 'count', header: 'Count', numeric: true },
            {
                key: 'frequency',
                header: 'Frequency',
                numeric: true,
                format: (value) => Number(value).toExponential(3),
            },
        ], exportName: fileName, height: 340, actions: _jsxs("div", { className: "relative w-36", children: [_jsx(Search, { className: "pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" }), _jsx(Input, { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Filter", className: "h-7 pr-6 pl-6 font-mono text-[11px]", "aria-label": `Filter ${title}` }), query ? (_jsx("button", { type: "button", onClick: () => setQuery(''), className: "absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground", "aria-label": "Clear filter", children: _jsx(X, { className: "size-3" }) })) : null] }), footnote: total > 0 && filtered.length !== entries.length
            ? `${formatInteger(filtered.length)} of ${formatInteger(entries.length)} shown by the filter.`
            : undefined, children: _jsx(BarList, { items: filtered.map((entry) => ({
                label: entry.kmer,
                value: entry.count,
                secondary: formatPercent(entry.frequency * 100, 3),
            })), valueFormatter: formatInteger, maxItems: 60, emptyLabel: emptyLabel ?? 'No k-mers match the filter.' }) }));
}
