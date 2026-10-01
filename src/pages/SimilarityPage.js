import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Download, GitCompare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { METRIC_DOCS } from '@/bio/defaults';
import { leafOrder } from '@/bio/similarity/clustering';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Dendrogram } from '@/components/charts/Dendrogram';
import { Heatmap, HeatmapScale } from '@/components/charts/Heatmap';
import { Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { SimilarityConfigPanel } from '@/features/similarity/SimilarityConfigPanel';
import { useSelectionStore } from '@/state/selectionStore';
import { selectActiveConfig, useProjectStore } from '@/state/projectStore';
import { MIME, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';
/**
 * Similarity, redundancy, and clustering.
 *
 * The page is explicit about the difference between an exact result and an
 * estimate, because they are computed differently and mean different things
 * here. Exact duplicate detection covers every sequence in the dataset. The
 * similarity matrix is built from MinHash sketches over a possibly sampled
 * subset, and its Jaccard values carry sampling error. Where alignment
 * refinement ran, the identity column is a real measurement.
 */
export function SimilarityPage() {
    return (_jsx(AnalysisGate, { kind: "similarity", title: "Similarity & redundancy", description: "Exact duplicate detection across the whole dataset, plus a sketch-based similarity matrix, hierarchical clustering, and representative selection. An exhaustive all-pairs alignment is not attempted: at a thousand sequences that is half a million alignments.", configPanel: _jsx(SimilarityConfigPanel, {}), children: (result, dataset) => _jsx(SimilarityResults, { result: result, fileName: dataset.fileName }) }));
}
function SimilarityResults({ result, fileName, }) {
    const config = useProjectStore(selectActiveConfig);
    const setSelection = useSelectionStore((state) => state.setSelection);
    const navigate = useNavigate();
    const [highlighted, setHighlighted] = useState(new Set());
    const order = useMemo(() => leafOrder(result.dendrogram), [result.dendrogram]);
    const labels = useMemo(() => result.members.map((member) => member.id), [result.members]);
    /** Distribution of pairwise Jaccard values, for the histogram. */
    const jaccardHistogram = useMemo(() => {
        const bins = new Array(21).fill(0);
        for (let i = 0; i < result.matrix.length; i += 1) {
            const value = result.matrix[i];
            bins[Math.min(20, Math.max(0, Math.round(value * 20)))] += 1;
        }
        return bins.map((count, index) => ({
            bucket: formatDecimal(index / 20, 2),
            jaccard: index / 20,
            count,
        }));
    }, [result.matrix]);
    const alignPair = (a, b) => {
        const datasetIndices = [result.members[a]?.index, result.members[b]?.index].filter((value) => value !== undefined);
        if (datasetIndices.length !== 2)
            return;
        setSelection(result.datasetId, datasetIndices);
        navigate('/alignment');
    };
    return (_jsxs("div", { className: "space-y-5", children: [result.sampled ? (_jsxs(Alert, { variant: "warning", title: "The similarity matrix covers a sample, not the whole dataset", children: [formatInteger(result.members.length), " of ", formatInteger(result.totalSequences), " sequences were compared. The sample is deterministic and stratified by length, so re-running gives the same set, but a pair that is not in it was never examined. Exact duplicate detection below still covers every sequence."] })) : null, _jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "Exact duplicates", value: formatInteger(result.exactDuplicateGroups.reduce((sum, group) => sum + group.count - 1, 0)), detail: `${pluralize(result.exactDuplicateGroups.length, 'group')}, verified by residue comparison`, help: `${METRIC_DOCS.duplicates.what} ${METRIC_DOCS.duplicates.caveat}` }), _jsx(StatTile, { label: "Clusters", value: formatInteger(result.clusters.length), detail: `at Jaccard ${formatDecimal(result.configSnapshot.clusterThreshold, 2)}, ${result.configSnapshot.linkage} linkage` }), _jsx(StatTile, { label: "Redundant fraction", value: formatPercent(result.stats.redundantFraction * 100, 1), detail: "Compared sequences that are non-representative cluster members" }), _jsx(StatTile, { label: "Mean Jaccard", value: formatDecimal(result.stats.meanJaccard, 4), detail: `median ${formatDecimal(result.stats.medianJaccard, 4)}, max ${formatDecimal(result.stats.maxJaccard, 4)}`, help: `${METRIC_DOCS.jaccard.what} ${METRIC_DOCS.jaccard.caveat}` }), _jsx(StatTile, { label: "Pairs compared", value: formatInteger(result.stats.pairsCompared), detail: result.stats.pairsRefined > 0
                            ? `${formatInteger(result.stats.pairsRefined)} refined by alignment`
                            : 'Sketch estimates only' })] }), _jsx(AnalysisNotes, { notes: result.notes }), _jsxs(Tabs, { defaultValue: "matrix", children: [_jsxs(TabsList, { children: [_jsx(TabsTrigger, { value: "matrix", children: "Matrix" }), _jsx(TabsTrigger, { value: "tree", children: "Dendrogram" }), _jsx(TabsTrigger, { value: "clusters", children: "Clusters" }), _jsx(TabsTrigger, { value: "pairs", children: "Top pairs" }), _jsx(TabsTrigger, { value: "duplicates", children: "Exact duplicates" })] }), _jsx(TabsContent, { value: "matrix", className: "space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-[auto_1fr]", children: [_jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeaderRow, { title: "Similarity matrix", description: `${formatInteger(result.matrixSize)} sequences, ordered by the clustering tree so related sequences sit adjacent. Click a cell to align that pair.` }), _jsx("div", { className: "overflow-auto border-t border-border p-3", children: _jsx(Heatmap, { matrix: result.matrix, size: result.matrixSize, labels: labels, order: order.length === result.matrixSize ? order : undefined, threshold: result.configSnapshot.clusterThreshold, onSelectPair: alignPair }) }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 border-t border-border bg-subtle px-3 py-2", children: [_jsx(HeatmapScale, { threshold: result.configSnapshot.clusterThreshold }), _jsx("span", { className: "text-[11px] text-muted-foreground", children: "The vertical mark shows the cluster threshold." })] })] }), _jsx(ChartFrame, { title: "Pairwise similarity distribution", description: "How the pairwise Jaccard estimates are distributed. A mass at zero with a small tail near one is the signature of a mostly-unrelated set containing a few near-duplicate families.", data: jaccardHistogram, columns: [
                                        { key: 'bucket', header: 'Jaccard' },
                                        { key: 'count', header: 'Pairs', numeric: true },
                                    ], exportName: `${fileName}-jaccard-distribution`, height: 300, footnote: `Sketch estimates from ${formatInteger(result.configSnapshot.sketchSize)} hashes of ${result.configSnapshot.sketchK}-mers, so the standard error at a true similarity of 0.5 is about ${formatDecimal(Math.sqrt(0.25 / result.configSnapshot.sketchSize), 3)}.`, children: _jsx(Histogram, { data: jaccardHistogram, xKey: "bucket", yKey: "count", xLabel: "Jaccard similarity", yLabel: "Pairs", yTickFormatter: formatInteger, tooltipLabel: (row) => `Jaccard ${row.bucket}`, tooltipValue: (row) => `${formatInteger(Number(row.count))} pairs`, markers: [
                                            {
                                                value: result.configSnapshot.clusterThreshold,
                                                label: 'cluster threshold',
                                            },
                                        ] }) })] }) }), _jsx(TabsContent, { value: "tree", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Hierarchical clustering tree", description: `${result.configSnapshot.linkage} linkage on 1 minus the Jaccard estimate. The vertical rule marks the cut at Jaccard ${formatDecimal(result.configSnapshot.clusterThreshold, 2)}; branches below it are coloured by cluster and branches above are grey.` }), _jsx("div", { className: "border-t border-border p-3", children: _jsx(Dendrogram, { root: result.dendrogram, threshold: result.configSnapshot.clusterThreshold, width: Math.max(560, 560), leafHeight: result.matrixSize > 120 ? 9 : 14, onSelectLeaf: (memberIndex) => setHighlighted((previous) => {
                                            const next = new Set(previous);
                                            if (next.has(memberIndex))
                                                next.delete(memberIndex);
                                            else
                                                next.add(memberIndex);
                                            return next;
                                        }), highlightIndices: highlighted }) }), _jsx("div", { className: "border-t border-border bg-subtle px-3 py-2", children: _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "The axis along the top is linkage distance, with the root on the left and leaves on the right. Cluster colours come from a four-hue set that stays distinguishable when any two leaves sit adjacent; a fifth hue would not, so clusters beyond the fourth reuse the hues and are identified by the cluster table below." }) })] }) }), _jsxs(TabsContent, { value: "clusters", className: "space-y-4", children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Cluster assignments", description: "One row per cluster, largest first. The representative is the longest member, which is what a redundancy-reduction step would keep.", actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.clusters.flatMap((cluster) => cluster.memberIndices.map((memberIndex) => ({
                                                cluster: cluster.clusterId + 1,
                                                clusterSize: cluster.memberIndices.length,
                                                representativeId: cluster.representativeId,
                                                isRepresentative: memberIndex === cluster.representativeIndex,
                                                sequenceIndex: result.members[memberIndex].index + 1,
                                                sequenceId: result.members[memberIndex].id,
                                                length: result.members[memberIndex].length,
                                                gcPercent: result.members[memberIndex].gcPercent.toFixed(3),
                                                meanIntraClusterJaccard: cluster.meanSimilarity.toFixed(4),
                                            })))), {
                                                suggestedName: `${slugify(fileName)}-clusters.csv`,
                                                mimeType: MIME.csv,
                                                extensions: ['.csv'],
                                            }), children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-[32rem] overflow-auto border-t border-border", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-right font-medium", children: "Cluster" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Members" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Representative" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Mean Jaccard" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Members" })] }) }), _jsx("tbody", { children: result.clusters.map((cluster) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "tabular px-4 py-1.5 text-right text-muted-foreground", children: cluster.clusterId + 1 }), _jsx("td", { className: "tabular px-3 py-1.5 text-right", children: cluster.memberIndices.length > 1 ? (_jsx(Badge, { variant: "primary", children: cluster.memberIndices.length })) : (_jsx("span", { className: "text-muted-foreground", children: "1" })) }), _jsx("td", { className: "px-3 py-1.5 font-mono text-foreground", children: cluster.representativeId }), _jsx("td", { className: "tabular px-3 py-1.5 text-right", children: formatDecimal(cluster.meanSimilarity, 3) }), _jsxs("td", { className: "px-3 py-1.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground", children: [cluster.memberIndices
                                                                        .slice(0, 8)
                                                                        .map((memberIndex) => result.members[memberIndex]?.id)
                                                                        .join(', '), cluster.memberIndices.length > 8
                                                                        ? ` and ${formatInteger(cluster.memberIndices.length - 8)} more`
                                                                        : ''] })] }, cluster.clusterId))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Redundancy reduction", description: "Keeping one representative per cluster is the CD-HIT-style reduction. These figures say what that would cost." }), _jsxs("div", { className: "px-4 pb-4", children: [_jsx(MetricList, { columns: 2, rows: [
                                                    {
                                                        label: 'Sequences compared',
                                                        value: formatInteger(result.members.length),
                                                    },
                                                    {
                                                        label: 'Representatives retained',
                                                        value: formatInteger(result.clusters.length),
                                                    },
                                                    {
                                                        label: 'Sequences removed',
                                                        value: formatInteger(result.members.length - result.clusters.length),
                                                    },
                                                    {
                                                        label: 'Reduction',
                                                        value: formatPercent(result.stats.redundantFraction * 100, 1),
                                                    },
                                                    {
                                                        label: 'Residues in representatives',
                                                        value: formatInteger(result.clusters.reduce((sum, cluster) => sum + (result.members[cluster.representativeIndex]?.length ?? 0), 0)),
                                                    },
                                                    {
                                                        label: 'Residues in all compared',
                                                        value: formatInteger(result.members.reduce((sum, member) => sum + member.length, 0)),
                                                    },
                                                ] }), _jsxs(Button, { size: "sm", variant: "outline", className: "mt-3", onClick: () => void saveFile(recordsToCsv(result.clusters.map((cluster) => ({
                                                    clusterId: cluster.clusterId + 1,
                                                    representativeId: cluster.representativeId,
                                                    sequenceIndex: result.members[cluster.representativeIndex].index + 1,
                                                    length: result.members[cluster.representativeIndex].length,
                                                    clusterSize: cluster.memberIndices.length,
                                                }))), {
                                                    suggestedName: `${slugify(fileName)}-representatives.csv`,
                                                    mimeType: MIME.csv,
                                                    extensions: ['.csv'],
                                                }), children: [_jsx(Download, {}), "Export representative list"] })] })] })] }), _jsx(TabsContent, { value: "pairs", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Most similar pairs", description: result.stats.pairsRefined > 0
                                        ? `The highest-scoring pairs by sketch estimate. The identity column is present only where a real alignment ran, which is the ${formatInteger(result.stats.pairsRefined)} top pairs.`
                                        : 'The highest-scoring pairs by sketch estimate. Alignment refinement was disabled, so no exact identity is available.', actions: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.topPairs.map((pair) => ({
                                            sequenceA: result.members[pair.a]?.id ?? '',
                                            sequenceB: result.members[pair.b]?.id ?? '',
                                            lengthA: result.members[pair.a]?.length ?? '',
                                            lengthB: result.members[pair.b]?.length ?? '',
                                            jaccardEstimate: pair.jaccard.toFixed(4),
                                            alignmentIdentity: pair.identity === undefined ? '' : pair.identity.toFixed(4),
                                            alignedLength: pair.alignedLength ?? '',
                                        }))), {
                                            suggestedName: `${slugify(fileName)}-top-pairs.csv`,
                                            mimeType: MIME.csv,
                                            extensions: ['.csv'],
                                        }), children: [_jsx(Download, {}), "CSV"] }) }), _jsx("div", { className: "max-h-[32rem] overflow-auto border-t border-border", children: result.topPairs.length === 0 ? (_jsx("p", { className: "px-4 py-8 text-center text-xs text-muted-foreground", children: "No pairs share any k-mers, so every sequence in the compared set is distinct at this k." })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-4 py-1.5 text-left font-medium", children: "Sequence A" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Sequence B" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Jaccard (est.)" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Identity (aligned)" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Align" })] }) }), _jsx("tbody", { children: result.topPairs.map((pair, i) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-muted/60", children: [_jsx("td", { className: "px-4 py-1 font-mono text-foreground", children: result.members[pair.a]?.id }), _jsx("td", { className: "px-3 py-1 font-mono text-foreground", children: result.members[pair.b]?.id }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: formatDecimal(pair.jaccard, 3) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: pair.identity === undefined ? (_jsx("span", { className: "text-muted-foreground", children: "not aligned" })) : (_jsxs(_Fragment, { children: [formatPercent(pair.identity * 100, 1), _jsxs("span", { className: "ml-1 text-[10px] text-muted-foreground", children: ["over ", formatInteger(pair.alignedLength ?? 0)] })] })) }), _jsx("td", { className: "px-3 py-1 text-right", children: _jsx(Button, { size: "sm", variant: "ghost", className: "h-6 px-1.5", onClick: () => alignPair(pair.a, pair.b), title: "Align this pair", children: _jsx(GitCompare, { className: "size-3" }) }) })] }, i))) })] })) })] }) }), _jsx(TabsContent, { value: "duplicates", className: "space-y-4", children: _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Exact duplicate groups", description: "Byte-identical residue strings, grouped by a 64-bit hash and then confirmed by direct comparison. This covers every sequence in the dataset, including any excluded from the similarity matrix by sampling." }), _jsx("div", { className: "max-h-[32rem] overflow-auto border-t border-border", children: result.exactDuplicateGroups.length === 0 ? (_jsx(Alert, { variant: "success", className: "m-4", title: "No exact duplicates", children: "Every sequence in this dataset has a distinct residue string." })) : (_jsx("ul", { className: "divide-y divide-border", children: result.exactDuplicateGroups.map((group) => (_jsxs("li", { className: "space-y-1 px-4 py-2", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs(Badge, { variant: "default", children: [formatInteger(group.count), " copies"] }), _jsxs("span", { className: "tabular text-[11px] text-muted-foreground", children: [formatInteger(group.length), " residues \u00B7 hash", ' ', _jsx("span", { className: "font-mono", children: group.hash.slice(0, 12) })] })] }), _jsxs("p", { className: "font-mono text-[10px] leading-relaxed break-all text-muted-foreground", children: [group.ids.join(', '), group.count > group.ids.length
                                                            ? ` and ${formatInteger(group.count - group.ids.length)} more`
                                                            : ''] })] }, group.hash))) })) })] }) })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(toJson({ ...result, matrix: undefined }), {
                            suggestedName: `${slugify(fileName)}-similarity.json`,
                            mimeType: MIME.json,
                            extensions: ['.json'],
                        }), children: [_jsx(Download, {}), "Export result (JSON, without matrix)"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => {
                            // Long-form matrix rather than a square grid: a square CSV of a
                            // 400-sequence matrix has 400 columns, which no spreadsheet or
                            // downstream script handles gracefully.
                            const rows = [];
                            for (let i = 0; i < result.matrixSize; i += 1) {
                                for (let j = i + 1; j < result.matrixSize; j += 1) {
                                    rows.push({
                                        sequenceA: result.members[i].id,
                                        sequenceB: result.members[j].id,
                                        jaccard: result.matrix[i * result.matrixSize - (i * (i + 1)) / 2 + j - i - 1].toFixed(5),
                                    });
                                }
                            }
                            void saveFile(recordsToCsv(rows), {
                                suggestedName: `${slugify(fileName)}-similarity-matrix.csv`,
                                mimeType: MIME.csv,
                                extensions: ['.csv'],
                            });
                        }, children: [_jsx(Download, {}), "Export matrix (long-form CSV)"] })] }), _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: ["Sketch size ", formatInteger(config.similarity.sketchSize), ", k = ", config.similarity.sketchK, ". Raising the sketch size reduces the estimate\u2019s error at linear cost in comparison time; raising k makes the measure stricter about divergence."] })] }));
}
