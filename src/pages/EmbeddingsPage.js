import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CircleSlash, Download, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { nearestNeighbors } from '@/bio/reduction/kmeans';
import { describeProviders, localModelRegistry } from '@/bio/embeddings';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { EmbeddingLegend, EmbeddingScatter, } from '@/components/charts/EmbeddingScatter';
import { markerFor } from '@/components/charts/palette';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, ToggleGroup, ToggleGroupItem, } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { selectActiveConfig, selectActiveDataset, selectActiveProject, useProjectStore, } from '@/state/projectStore';
import { useDebouncedValue, useElementSize } from '@/utils/debounce';
import { MIME, recordsToCsv, saveFile } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, slugify } from '@/utils/format';
/**
 * Sequence embeddings and 2-D exploration.
 *
 * The provider architecture is visible on this page rather than hidden: the
 * panel lists every registered backend with its availability, and a backend
 * that cannot run says why. That matters because the difference between a
 * counting-based embedding and a protein language model is the difference
 * between compositional signature and learned structural signal, and a plot
 * gives no hint which one produced it.
 */
export function EmbeddingsPage() {
    return (_jsx(AnalysisGate, { kind: "embedding", title: "Embeddings", description: "Sequences are turned into fixed-length vectors by a registered local provider, reduced to two dimensions by PCA or UMAP, and clustered by k-means in the original high-dimensional space. Everything runs on this device; no model is downloaded.", configPanel: _jsx(EmbeddingConfigPanel, {}), children: (result, dataset) => _jsx(EmbeddingResults, { result: result, fileName: dataset.fileName }) }));
}
function EmbeddingResults({ result, fileName }) {
    const [colorMode, setColorMode] = useState('cluster');
    const [selected, setSelected] = useState(null);
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(query, 220);
    const { ref: plotRef, width: plotWidth } = useElementSize();
    const gcRange = useMemo(() => {
        if (result.points.length === 0)
            return [0, 100];
        let min = Infinity;
        let max = -Infinity;
        for (const point of result.points) {
            if (point.gcPercent < min)
                min = point.gcPercent;
            if (point.gcPercent > max)
                max = point.gcPercent;
        }
        return [min, max];
    }, [result.points]);
    const lengthRange = useMemo(() => {
        if (result.points.length === 0)
            return [0, 1];
        let min = Infinity;
        let max = -Infinity;
        for (const point of result.points) {
            if (point.length < min)
                min = point.length;
            if (point.length > max)
                max = point.length;
        }
        return [min, max];
    }, [result.points]);
    /** Points whose identifier matches the search. */
    const matched = useMemo(() => {
        const needle = debouncedQuery.trim().toLowerCase();
        if (needle.length === 0)
            return undefined;
        const set = new Set();
        for (const point of result.points) {
            if (point.id.toLowerCase().includes(needle))
                set.add(point.index);
        }
        return set;
    }, [debouncedQuery, result.points]);
    /**
     * Nearest neighbours of the selected point.
     *
     * Computed on the full-dimensional vectors, not the 2-D projection: two
     * points can land next to each other in a UMAP layout without being close in
     * embedding space, and it is the embedding space that carries the signal.
     */
    const neighbours = useMemo(() => {
        if (selected === null)
            return [];
        const position = result.points.findIndex((point) => point.index === selected.index);
        if (position === -1)
            return [];
        return nearestNeighbors(result.vectors, result.points.length, result.dimensions, position, 10, 'cosine').map((neighbour) => ({
            point: result.points[neighbour.index],
            similarity: neighbour.similarity,
            distance: neighbour.distance,
        }));
    }, [selected, result]);
    const highlighted = useMemo(() => {
        if (neighbours.length === 0)
            return undefined;
        return new Set(neighbours.map((neighbour) => neighbour.point.index));
    }, [neighbours]);
    const pointRows = useMemo(() => result.points.map((point) => ({
        id: point.id,
        index: point.index + 1,
        cluster: point.cluster + 1,
        length: point.length,
        gcPercent: point.gcPercent,
        x: point.x,
        y: point.y,
    })), [result.points]);
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(StatGrid, { columns: 5, children: [_jsx(StatTile, { label: "Provider", value: _jsx("span", { className: "text-sm", children: result.providerName }), detail: `${formatInteger(result.dimensions)} dimensions` }), _jsx(StatTile, { label: "Sequences embedded", value: formatInteger(result.points.length), detail: result.sampled
                            ? `sampled from ${formatInteger(result.totalSequences)}`
                            : 'the whole dataset', badge: result.sampled ? _jsx(Badge, { variant: "warning", children: "Sampled" }) : undefined }), _jsx(StatTile, { label: "Reduction", value: result.reduction.toUpperCase(), detail: result.reduction === 'pca' && result.explainedVariance.length >= 2
                            ? `${formatPercent((result.explainedVariance[0] + result.explainedVariance[1]) * 100, 1)} of variance shown`
                            : `seed ${result.configSnapshot.seed}, ${result.configSnapshot.umapEpochs} epochs` }), _jsx(StatTile, { label: "Clusters", value: formatInteger(result.clusterSummary.filter((entry) => entry.size > 0).length), detail: `k-means on the full ${formatInteger(result.dimensions)}-dimensional vectors` }), _jsx(StatTile, { label: "Largest cluster", value: formatInteger(Math.max(...result.clusterSummary.map((entry) => entry.size), 0)), detail: `${formatPercent((Math.max(...result.clusterSummary.map((entry) => entry.size), 0) / Math.max(1, result.points.length)) * 100, 1)} of embedded sequences` })] }), _jsx(AnalysisNotes, { notes: result.notes }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[1fr_20rem]", children: [_jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeaderRow, { title: "Embedding explorer", description: "Scroll to zoom, drag to pan, click a point to select it and see its nearest neighbours in embedding space.", actions: _jsxs(_Fragment, { children: [_jsxs(ToggleGroup, { type: "single", value: colorMode, onValueChange: (value) => {
                                                if (value)
                                                    setColorMode(value);
                                            }, "aria-label": "Colour by", children: [_jsx(ToggleGroupItem, { value: "cluster", children: "Cluster" }), _jsx(ToggleGroupItem, { value: "gc", children: "GC%" }), _jsx(ToggleGroupItem, { value: "length", children: "Length" })] }), selected ? (_jsxs(Button, { size: "sm", variant: "ghost", onClick: () => setSelected(null), children: [_jsx(X, {}), "Clear"] })) : null] }) }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 border-y border-border bg-subtle px-3 py-2", children: [_jsxs("div", { className: "relative min-w-40 flex-1", children: [_jsx(Search, { className: "pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" }), _jsx(Input, { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search sequence identifiers", className: "h-7 pr-7 pl-7 text-xs", "aria-label": "Search sequence identifiers" }), query ? (_jsx("button", { type: "button", onClick: () => setQuery(''), className: "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground", "aria-label": "Clear search", children: _jsx(X, { className: "size-3" }) })) : null] }), matched ? (_jsxs(Badge, { variant: matched.size > 0 ? 'primary' : 'neutral', children: [formatInteger(matched.size), " match", matched.size === 1 ? '' : 'es'] })) : null, _jsx(EmbeddingLegend, { colorMode: colorMode, clusterSummary: result.clusterSummary, gcRange: gcRange, lengthRange: lengthRange })] }), _jsx("div", { ref: plotRef, className: "p-3", children: _jsx(EmbeddingScatter, { points: result.points, colorMode: colorMode, selectedIndex: selected?.index ?? null, highlighted: highlighted, matchedIndices: matched, onSelect: setSelected, width: Math.max(320, plotWidth - 24), height: 480 }) }), _jsx("div", { className: "border-t border-border bg-subtle px-3 py-2", children: _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: [result.reduction === 'umap'
                                            ? 'UMAP axes have no units. Which points are near each other is meaningful; the distance between two well-separated clusters is not, and neither is the orientation of the plot.'
                                            : 'PCA axes are the directions of greatest variance in the embedding space, so distances are meaningful but only the variance captured by these two components is visible.', ' ', "Cluster colouring uses four hues crossed with four marker shapes, because in a plot where any two points can sit adjacent a fifth hue would not stay distinguishable."] }) })] }), _jsxs("div", { className: "space-y-4", children: [selected ? (_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Selected sequence", description: "Nearest neighbours are computed by cosine similarity on the full-dimensional vectors." }), _jsxs("div", { className: "space-y-3 border-t border-border px-4 py-3", children: [_jsxs("div", { children: [_jsx("p", { className: "truncate font-mono text-xs font-semibold text-foreground", title: selected.id, children: selected.id }), _jsxs("div", { className: "mt-1 flex items-center gap-1.5", children: [_jsx("span", { className: "size-2.5 rounded-[2px]", style: { backgroundColor: markerFor(selected.cluster).color }, "aria-hidden": true }), _jsxs("span", { className: "text-[11px] text-muted-foreground", children: ["Cluster ", selected.cluster + 1] })] })] }), _jsx(MetricList, { rows: [
                                                    { label: 'Index', value: formatInteger(selected.index + 1) },
                                                    { label: 'Length', value: formatInteger(selected.length) },
                                                    { label: 'GC content', value: formatPercent(selected.gcPercent, 2) },
                                                    {
                                                        label: 'Coordinates',
                                                        value: `${formatDecimal(selected.x, 3)}, ${formatDecimal(selected.y, 3)}`,
                                                        mono: true,
                                                    },
                                                ] }), _jsxs("div", { children: [_jsx("p", { className: "mb-1.5 text-[11px] font-semibold text-foreground", children: "Nearest neighbours" }), _jsx("ul", { className: "space-y-1", children: neighbours.map((neighbour) => (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setSelected(neighbour.point), className: "flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted", children: [_jsx("span", { className: "size-2 shrink-0 rounded-[2px]", style: { backgroundColor: markerFor(neighbour.point.cluster).color }, "aria-hidden": true }), _jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-[10px] text-foreground", title: neighbour.point.id, children: neighbour.point.id }), _jsx("span", { className: "tabular shrink-0 text-[10px] text-muted-foreground", children: formatDecimal(neighbour.similarity, 3) })] }) }, neighbour.point.index))) })] })] })] })) : (_jsx(Card, { children: _jsx(CardHeaderRow, { title: "No point selected", description: "Click a point in the plot to see its metadata and nearest neighbours." }) })), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Cluster summary", description: "Mean GC and length per cluster. If clusters differ systematically in GC, the embedding is separating compositional populations." }), _jsx("div", { className: "max-h-72 overflow-auto border-t border-border", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-card", children: _jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [_jsx("th", { scope: "col", className: "px-3 py-1.5 text-left font-medium", children: "Cluster" }), _jsx("th", { scope: "col", className: "px-2 py-1.5 text-right font-medium", children: "Size" }), _jsx("th", { scope: "col", className: "px-2 py-1.5 text-right font-medium", children: "Mean GC" }), _jsx("th", { scope: "col", className: "px-3 py-1.5 text-right font-medium", children: "Mean length" })] }) }), _jsx("tbody", { children: result.clusterSummary.map((entry) => (_jsxs("tr", { className: "border-b border-border last:border-b-0", children: [_jsx("td", { className: "px-3 py-1", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "size-2.5 rounded-[2px]", style: { backgroundColor: markerFor(entry.cluster).color }, "aria-hidden": true }), entry.cluster + 1] }) }), _jsx("td", { className: "tabular px-2 py-1 text-right", children: entry.size === 0 ? (_jsx("span", { className: "text-muted-foreground", children: "empty" })) : (formatInteger(entry.size)) }), _jsx("td", { className: "tabular px-2 py-1 text-right", children: entry.size === 0 ? '-' : formatDecimal(entry.meanGc, 1) }), _jsx("td", { className: "tabular px-3 py-1 text-right", children: entry.size === 0 ? '-' : formatInteger(Math.round(entry.meanLength)) })] }, entry.cluster))) })] }) })] })] })] }), _jsx(ChartFrame, { title: "Embedding coordinates", description: "Every embedded sequence with its projected coordinates and cluster assignment. This is the table twin of the plot above; the plot encodes position and colour, and this has the numbers.", data: pointRows, columns: [
                    { key: 'index', header: 'Index', numeric: true },
                    { key: 'id', header: 'Identifier' },
                    { key: 'cluster', header: 'Cluster', numeric: true },
                    { key: 'length', header: 'Length', numeric: true },
                    {
                        key: 'gcPercent',
                        header: 'GC %',
                        numeric: true,
                        format: (value) => formatDecimal(Number(value), 2),
                    },
                    { key: 'x', header: 'X', numeric: true, format: (value) => formatDecimal(Number(value), 4) },
                    { key: 'y', header: 'Y', numeric: true, format: (value) => formatDecimal(Number(value), 4) },
                ], exportName: `${fileName}-embedding-coordinates`, height: 320, children: _jsx("div", { className: "flex h-full items-center justify-center", children: _jsx("p", { className: "max-w-sm text-center text-xs text-muted-foreground", children: "Switch to the table view with the control above to read the coordinates, or download them as CSV." }) }) }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void saveFile(recordsToCsv(result.points.map((point) => ({
                    sequenceIndex: point.index + 1,
                    sequenceId: point.id,
                    cluster: point.cluster + 1,
                    length: point.length,
                    gcPercent: point.gcPercent.toFixed(3),
                    x: point.x.toFixed(6),
                    y: point.y.toFixed(6),
                }))), {
                    suggestedName: `${slugify(fileName)}-embedding.csv`,
                    mimeType: MIME.csv,
                    extensions: ['.csv'],
                }), children: [_jsx(Download, {}), "Export coordinates (CSV)"] })] }));
}
/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */
/**
 * Provider selection and reduction settings.
 *
 * The provider list is probed live, so an unavailable backend reports its own
 * reason rather than being hidden. Registering a local model file is offered
 * because that is the only way a model provider can become usable without
 * SeqLens fetching weights from somewhere.
 */
function EmbeddingConfigPanel() {
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const config = useProjectStore(selectActiveConfig);
    const updateConfig = useProjectStore((state) => state.updateConfig);
    const [providers, setProviders] = useState([]);
    const [registryVersion, setRegistryVersion] = useState(0);
    useEffect(() => {
        let cancelled = false;
        void describeProviders().then((described) => {
            if (!cancelled)
                setProviders(described);
        });
        return () => {
            cancelled = true;
        };
    }, [registryVersion]);
    useEffect(() => localModelRegistry.subscribe(() => setRegistryVersion((v) => v + 1)), []);
    if (project === null)
        return null;
    const embedding = config.embedding;
    const setEmbedding = (changes) => {
        void updateConfig(project.id, { ...config, embedding: { ...embedding, ...changes } });
    };
    const active = providers.find((provider) => provider.id === embedding.providerId);
    const isProtein = dataset?.sequenceType === 'protein';
    const alphabetSize = isProtein ? 10 : 4;
    const dimensions = alphabetSize ** Math.min(embedding.k, isProtein ? 4 : 7);
    const registerModel = async (file) => {
        localModelRegistry.register({
            id: `local-${file.name}`,
            name: file.name,
            dimensions: 0,
            sequenceType: 'protein',
            maxLength: 1024,
            sizeBytes: file.size,
            runtime: 'onnx',
        }, file);
    };
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Embedding providers", description: "Each backend is probed for availability on this device. A provider that cannot run says why rather than silently falling back to another, because the choice determines what the vectors actually represent." }), _jsx("div", { className: "divide-y divide-border border-t border-border", children: providers.map((provider) => {
                            const selected = provider.id === embedding.providerId;
                            const usable = provider.availability.status !== 'unavailable';
                            const supported = dataset ? provider.supports.includes(dataset.sequenceType) : true;
                            return (_jsxs("div", { className: "space-y-2 px-4 py-3", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [_jsx("p", { className: "text-xs font-semibold text-foreground", children: provider.name }), _jsx(Badge, { variant: provider.family === 'model' ? 'primary' : 'default', children: provider.family === 'model' ? 'Learned model' : 'Deterministic' }), provider.availability.status === 'available' ? (_jsx(Badge, { variant: "pass", children: "Available" })) : provider.availability.status === 'experimental' ? (_jsx(Badge, { variant: "warning", children: "Experimental" })) : (_jsx(Badge, { variant: "neutral", children: "Unavailable" })), !supported ? (_jsxs(Badge, { variant: "warning", children: ["Not for ", dataset?.sequenceType ?? 'this type'] })) : null] }), _jsx("p", { className: "mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground", children: provider.description })] }), _jsx(Button, { size: "sm", variant: selected ? 'default' : 'outline', disabled: !usable || !supported, onClick: () => setEmbedding({ providerId: provider.id }), children: selected ? 'Selected' : 'Select' })] }), _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: [_jsx("span", { className: "font-medium text-foreground", children: "Where it runs:" }), ' ', provider.locality] }), provider.availability.status !== 'available' ? (_jsxs(Alert, { variant: provider.availability.status === 'experimental' ? 'warning' : 'info', icon: false, title: provider.availability.status === 'experimental'
                                            ? 'Experimental'
                                            : 'Cannot run on this device', children: [_jsx("p", { children: provider.availability.reason }), provider.family === 'model' ? (_jsxs("div", { className: "mt-2", children: [_jsxs("label", { className: "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted", children: [_jsx(Upload, { className: "size-3", "aria-hidden": true }), "Register a local model file", _jsx("input", { type: "file", accept: ".onnx", className: "sr-only", onChange: (event) => {
                                                                    const file = event.target.files?.[0];
                                                                    if (file)
                                                                        void registerModel(file);
                                                                    event.target.value = '';
                                                                } })] }), _jsx("p", { className: "mt-1.5 text-[11px] leading-relaxed", children: "The file stays in memory for this session and is never copied to storage or transmitted. Registering weights is not sufficient on its own: this build does not bundle an ONNX inference runtime, and SeqLens will not fetch one, because that would mean a network request." })] })) : null] })) : null, localModelRegistry.list().length > 0 && provider.family === 'model' ? (_jsx("div", { className: "space-y-1", children: localModelRegistry.list().map((model) => (_jsxs("div", { className: "flex items-center gap-2 rounded border border-border bg-subtle px-2 py-1", children: [_jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-[10px] text-foreground", children: model.name }), _jsxs("span", { className: "tabular text-[10px] text-muted-foreground", children: [formatInteger(Math.round(model.sizeBytes / 1024 / 1024)), " MB"] }), _jsx(Button, { size: "sm", variant: "ghost", className: "h-5 px-1", onClick: () => localModelRegistry.unregister(model.id), "aria-label": `Unregister ${model.name}`, children: _jsx(CircleSlash, { className: "size-3" }) })] }, model.id))) })) : null] }, provider.id));
                        }) })] }), _jsxs(Card, { children: [_jsx(CardHeaderRow, { title: "Reduction and clustering", description: active
                            ? `${active.name} will produce ${active.dimensions === 'variable' ? `${formatInteger(dimensions)}` : formatInteger(active.dimensions)}-dimensional vectors for this dataset.`
                            : 'Choose a provider above.', actions: _jsx(Button, { size: "sm", variant: "outline", onClick: () => void updateConfig(project.id, {
                                ...config,
                                embedding: { ...DEFAULT_CONFIG.embedding },
                            }), children: "Restore defaults" }) }), _jsxs("div", { className: "grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "embed-k", children: "k-mer size" }), _jsx(Input, { id: "embed-k", type: "number", min: 1, max: isProtein ? 4 : 7, value: embedding.k, onChange: (event) => setEmbedding({
                                            k: Math.max(1, Math.min(isProtein ? 4 : 7, Number(event.target.value) || 4)),
                                        }), className: "h-7 max-w-20 text-xs" }), _jsxs("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: ["Sets the vector width: ", alphabetSize, _jsx("sup", { children: "k" }), " = ", formatInteger(dimensions), " dimensions. Larger k gives finer compositional resolution but a sparser vector, and for short sequences most dimensions end up zero."] })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "reduction", children: "Reduction" }), _jsxs(Select, { value: embedding.reduction, onValueChange: (value) => setEmbedding({ reduction: value }), children: [_jsx(SelectTrigger, { id: "reduction", className: "h-7 text-xs", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "pca", children: "PCA" }), _jsx(SelectItem, { value: "umap", children: "UMAP" })] })] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "PCA is linear, deterministic, and reports how much variance the two axes capture. UMAP preserves local neighbourhoods better and separates clusters more clearly, but its axes have no units and inter-cluster distances are not faithful." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "max-sequences", children: "Sequences to embed" }), _jsx(Input, { id: "max-sequences", type: "number", min: 3, max: 4000, step: 100, value: embedding.maxSequences, onChange: (event) => setEmbedding({
                                            maxSequences: Math.max(3, Math.min(4000, Number(event.target.value) || 2000)),
                                        }), className: "h-7 max-w-24 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Capped at 4,000. UMAP\u2019s neighbour search here is exact brute force, so it is quadratic in point count: 4,000 points at 256 dimensions is already four billion multiply-adds." })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "cluster-count", children: "Clusters (k-means)" }), _jsx("span", { className: "tabular text-[11px] font-medium text-foreground", children: embedding.clusterCount })] }), _jsx(Slider, { id: "cluster-count", min: 1, max: 16, step: 1, value: [embedding.clusterCount], onValueChange: ([value]) => setEmbedding({ clusterCount: value }), className: "py-2" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "k-means always returns this many clusters whether or not the data has that structure. Up to 16 stay visually distinguishable, using four hues crossed with four marker shapes." })] }), embedding.reduction === 'umap' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "umap-neighbors", children: "UMAP neighbours" }), _jsx("span", { className: "tabular text-[11px] font-medium text-foreground", children: embedding.umapNeighbors })] }), _jsx(Slider, { id: "umap-neighbors", min: 2, max: 100, step: 1, value: [embedding.umapNeighbors], onValueChange: ([value]) => setEmbedding({ umapNeighbors: value }), className: "py-2" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Low values emphasise very local structure and fragment the layout; high values emphasise global structure and merge nearby clusters." })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx(Label, { htmlFor: "umap-mindist", children: "UMAP minimum distance" }), _jsx("span", { className: "tabular text-[11px] font-medium text-foreground", children: formatDecimal(embedding.umapMinDist, 2) })] }), _jsx(Slider, { id: "umap-mindist", min: 0, max: 0.99, step: 0.01, value: [embedding.umapMinDist], onValueChange: ([value]) => setEmbedding({ umapMinDist: value }), className: "py-2" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "How tightly points may pack together. Low values produce dense clumps; high values spread points evenly and obscure cluster boundaries." })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "umap-epochs", children: "UMAP epochs" }), _jsx(Input, { id: "umap-epochs", type: "number", min: 20, max: 2000, step: 20, value: embedding.umapEpochs, onChange: (event) => setEmbedding({
                                                    umapEpochs: Math.max(20, Math.min(2000, Number(event.target.value) || 200)),
                                                }), className: "h-7 max-w-24 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Optimisation steps. More epochs sharpen cluster separation at linear cost; below about 100 the layout has not converged." })] })] })) : null, _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: "embed-seed", children: "Random seed" }), _jsx(Input, { id: "embed-seed", type: "number", min: 0, value: embedding.seed, onChange: (event) => setEmbedding({ seed: Number(event.target.value) || 0 }), className: "h-7 max-w-24 text-xs" }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: "Drives every stochastic step: the sample when the dataset is capped, the k-means seeding, and the UMAP layout. The same seed always produces the same result, which is what makes the plot reproducible." })] })] })] })] }));
}
