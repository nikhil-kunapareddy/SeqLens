import { CircleSlash, Download, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { nearestNeighbors } from '@/bio/reduction/kmeans';
import { describeProviders, localModelRegistry } from '@/bio/embeddings';
import { ChartFrame } from '@/components/charts/ChartFrame';
import {
  EmbeddingLegend,
  EmbeddingScatter,
  type ColorMode,
} from '@/components/charts/EmbeddingScatter';
import { markerFor } from '@/components/charts/palette';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import type { EmbeddingPoint, EmbeddingProviderInfo, EmbeddingResult } from '@/types';
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
  return (
    <AnalysisGate<EmbeddingResult>
      kind="embedding"
      title="Embeddings"
      description="Sequences are turned into fixed-length vectors by a registered local provider, reduced to two dimensions by PCA or UMAP, and clustered by k-means in the original high-dimensional space. Everything runs on this device; no model is downloaded."
      configPanel={<EmbeddingConfigPanel />}
    >
      {(result, dataset) => <EmbeddingResults result={result} fileName={dataset.fileName} />}
    </AnalysisGate>
  );
}

function EmbeddingResults({ result, fileName }: { result: EmbeddingResult; fileName: string }) {
  const [colorMode, setColorMode] = useState<ColorMode>('cluster');
  const [selected, setSelected] = useState<EmbeddingPoint | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 220);
  const { ref: plotRef, width: plotWidth } = useElementSize<HTMLDivElement>();

  const gcRange = useMemo<[number, number]>(() => {
    if (result.points.length === 0) return [0, 100];
    let min = Infinity;
    let max = -Infinity;
    for (const point of result.points) {
      if (point.gcPercent < min) min = point.gcPercent;
      if (point.gcPercent > max) max = point.gcPercent;
    }
    return [min, max];
  }, [result.points]);

  const lengthRange = useMemo<[number, number]>(() => {
    if (result.points.length === 0) return [0, 1];
    let min = Infinity;
    let max = -Infinity;
    for (const point of result.points) {
      if (point.length < min) min = point.length;
      if (point.length > max) max = point.length;
    }
    return [min, max];
  }, [result.points]);

  /** Points whose identifier matches the search. */
  const matched = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (needle.length === 0) return undefined;
    const set = new Set<number>();
    for (const point of result.points) {
      if (point.id.toLowerCase().includes(needle)) set.add(point.index);
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
    if (selected === null) return [];
    const position = result.points.findIndex((point) => point.index === selected.index);
    if (position === -1) return [];
    return nearestNeighbors(
      result.vectors,
      result.points.length,
      result.dimensions,
      position,
      10,
      'cosine',
    ).map((neighbour) => ({
      point: result.points[neighbour.index],
      similarity: neighbour.similarity,
      distance: neighbour.distance,
    }));
  }, [selected, result]);

  const highlighted = useMemo(() => {
    if (neighbours.length === 0) return undefined;
    return new Set(neighbours.map((neighbour) => neighbour.point.index));
  }, [neighbours]);

  const pointRows = useMemo(
    () =>
      result.points.map((point) => ({
        id: point.id,
        index: point.index + 1,
        cluster: point.cluster + 1,
        length: point.length,
        gcPercent: point.gcPercent,
        x: point.x,
        y: point.y,
      })),
    [result.points],
  );

  return (
    <div className="space-y-5">
      <StatGrid columns={5}>
        <StatTile
          label="Provider"
          value={<span className="text-sm">{result.providerName}</span>}
          detail={`${formatInteger(result.dimensions)} dimensions`}
        />
        <StatTile
          label="Sequences embedded"
          value={formatInteger(result.points.length)}
          detail={
            result.sampled
              ? `sampled from ${formatInteger(result.totalSequences)}`
              : 'the whole dataset'
          }
          badge={result.sampled ? <Badge variant="warning">Sampled</Badge> : undefined}
        />
        <StatTile
          label="Reduction"
          value={result.reduction.toUpperCase()}
          detail={
            result.reduction === 'pca' && result.explainedVariance.length >= 2
              ? `${formatPercent((result.explainedVariance[0] + result.explainedVariance[1]) * 100, 1)} of variance shown`
              : `seed ${result.configSnapshot.seed}, ${result.configSnapshot.umapEpochs} epochs`
          }
        />
        <StatTile
          label="Clusters"
          value={formatInteger(result.clusterSummary.filter((entry) => entry.size > 0).length)}
          detail={`k-means on the full ${formatInteger(result.dimensions)}-dimensional vectors`}
        />
        <StatTile
          label="Largest cluster"
          value={formatInteger(Math.max(...result.clusterSummary.map((entry) => entry.size), 0))}
          detail={`${formatPercent((Math.max(...result.clusterSummary.map((entry) => entry.size), 0) / Math.max(1, result.points.length)) * 100, 1)} of embedded sequences`}
        />
      </StatGrid>

      <AnalysisNotes notes={result.notes} />

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardHeaderRow
            title="Embedding explorer"
            description="Scroll to zoom, drag to pan, click a point to select it and see its nearest neighbours in embedding space."
            actions={
              <>
                <ToggleGroup
                  type="single"
                  value={colorMode}
                  onValueChange={(value) => {
                    if (value) setColorMode(value as ColorMode);
                  }}
                  aria-label="Colour by"
                >
                  <ToggleGroupItem value="cluster">Cluster</ToggleGroupItem>
                  <ToggleGroupItem value="gc">GC%</ToggleGroupItem>
                  <ToggleGroupItem value="length">Length</ToggleGroupItem>
                </ToggleGroup>
                {selected ? (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                    <X />
                    Clear
                  </Button>
                ) : null}
              </>
            }
          />

          <div className="flex flex-wrap items-center gap-2 border-y border-border bg-subtle px-3 py-2">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sequence identifiers"
                className="h-7 pr-7 pl-7 text-xs"
                aria-label="Search sequence identifiers"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
            {matched ? (
              <Badge variant={matched.size > 0 ? 'primary' : 'neutral'}>
                {formatInteger(matched.size)} match{matched.size === 1 ? '' : 'es'}
              </Badge>
            ) : null}
            <EmbeddingLegend
              colorMode={colorMode}
              clusterSummary={result.clusterSummary}
              gcRange={gcRange}
              lengthRange={lengthRange}
            />
          </div>

          <div ref={plotRef} className="p-3">
            <EmbeddingScatter
              points={result.points}
              colorMode={colorMode}
              selectedIndex={selected?.index ?? null}
              highlighted={highlighted}
              matchedIndices={matched}
              onSelect={setSelected}
              width={Math.max(320, plotWidth - 24)}
              height={480}
            />
          </div>

          <div className="border-t border-border bg-subtle px-3 py-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {result.reduction === 'umap'
                ? 'UMAP axes have no units. Which points are near each other is meaningful; the distance between two well-separated clusters is not, and neither is the orientation of the plot.'
                : 'PCA axes are the directions of greatest variance in the embedding space, so distances are meaningful but only the variance captured by these two components is visible.'}{' '}
              Cluster colouring uses four hues crossed with four marker shapes, because in a plot
              where any two points can sit adjacent a fifth hue would not stay distinguishable.
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          {selected ? (
            <Card>
              <CardHeaderRow
                title="Selected sequence"
                description="Nearest neighbours are computed by cosine similarity on the full-dimensional vectors."
              />
              <div className="space-y-3 border-t border-border px-4 py-3">
                <div>
                  <p className="truncate font-mono text-xs font-semibold text-foreground" title={selected.id}>
                    {selected.id}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{ backgroundColor: markerFor(selected.cluster).color }}
                      aria-hidden
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Cluster {selected.cluster + 1}
                    </span>
                  </div>
                </div>

                <MetricList
                  rows={[
                    { label: 'Index', value: formatInteger(selected.index + 1) },
                    { label: 'Length', value: formatInteger(selected.length) },
                    { label: 'GC content', value: formatPercent(selected.gcPercent, 2) },
                    {
                      label: 'Coordinates',
                      value: `${formatDecimal(selected.x, 3)}, ${formatDecimal(selected.y, 3)}`,
                      mono: true,
                    },
                  ]}
                />

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-foreground">
                    Nearest neighbours
                  </p>
                  <ul className="space-y-1">
                    {neighbours.map((neighbour) => (
                      <li key={neighbour.point.index}>
                        <button
                          type="button"
                          onClick={() => setSelected(neighbour.point)}
                          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
                        >
                          <span
                            className="size-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: markerFor(neighbour.point.cluster).color }}
                            aria-hidden
                          />
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground"
                            title={neighbour.point.id}
                          >
                            {neighbour.point.id}
                          </span>
                          <span className="tabular shrink-0 text-[10px] text-muted-foreground">
                            {formatDecimal(neighbour.similarity, 3)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeaderRow
                title="No point selected"
                description="Click a point in the plot to see its metadata and nearest neighbours."
              />
            </Card>
          )}

          <Card>
            <CardHeaderRow
              title="Cluster summary"
              description="Mean GC and length per cluster. If clusters differ systematically in GC, the embedding is separating compositional populations."
            />
            <div className="max-h-72 overflow-auto border-t border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Cluster</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Size</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Mean GC</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Mean length</th>
                  </tr>
                </thead>
                <tbody>
                  {result.clusterSummary.map((entry) => (
                    <tr key={entry.cluster} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2.5 rounded-[2px]"
                            style={{ backgroundColor: markerFor(entry.cluster).color }}
                            aria-hidden
                          />
                          {entry.cluster + 1}
                        </span>
                      </td>
                      <td className="tabular px-2 py-1 text-right">
                        {entry.size === 0 ? (
                          <span className="text-muted-foreground">empty</span>
                        ) : (
                          formatInteger(entry.size)
                        )}
                      </td>
                      <td className="tabular px-2 py-1 text-right">
                        {entry.size === 0 ? '-' : formatDecimal(entry.meanGc, 1)}
                      </td>
                      <td className="tabular px-3 py-1 text-right">
                        {entry.size === 0 ? '-' : formatInteger(Math.round(entry.meanLength))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <ChartFrame
        title="Embedding coordinates"
        description="Every embedded sequence with its projected coordinates and cluster assignment. This is the table twin of the plot above; the plot encodes position and colour, and this has the numbers."
        data={pointRows}
        columns={[
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
        ]}
        exportName={`${fileName}-embedding-coordinates`}
        height={320}
      >
        <div className="flex h-full items-center justify-center">
          <p className="max-w-sm text-center text-xs text-muted-foreground">
            Switch to the table view with the control above to read the coordinates, or download
            them as CSV.
          </p>
        </div>
      </ChartFrame>

      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void saveFile(
            recordsToCsv(
              result.points.map((point) => ({
                sequenceIndex: point.index + 1,
                sequenceId: point.id,
                cluster: point.cluster + 1,
                length: point.length,
                gcPercent: point.gcPercent.toFixed(3),
                x: point.x.toFixed(6),
                y: point.y.toFixed(6),
              })),
            ),
            {
              suggestedName: `${slugify(fileName)}-embedding.csv`,
              mimeType: MIME.csv,
              extensions: ['.csv'],
            },
          )
        }
      >
        <Download />
        Export coordinates (CSV)
      </Button>
    </div>
  );
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

  const [providers, setProviders] = useState<EmbeddingProviderInfo[]>([]);
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void describeProviders().then((described) => {
      if (!cancelled) setProviders(described);
    });
    return () => {
      cancelled = true;
    };
  }, [registryVersion]);

  useEffect(() => localModelRegistry.subscribe(() => setRegistryVersion((v) => v + 1)), []);

  if (project === null) return null;

  const embedding = config.embedding;
  const setEmbedding = (changes: Partial<typeof embedding>) => {
    void updateConfig(project.id, { ...config, embedding: { ...embedding, ...changes } });
  };

  const active = providers.find((provider) => provider.id === embedding.providerId);
  const isProtein = dataset?.sequenceType === 'protein';
  const alphabetSize = isProtein ? 10 : 4;
  const dimensions = alphabetSize ** Math.min(embedding.k, isProtein ? 4 : 7);

  const registerModel = async (file: File) => {
    localModelRegistry.register(
      {
        id: `local-${file.name}`,
        name: file.name,
        dimensions: 0,
        sequenceType: 'protein',
        maxLength: 1024,
        sizeBytes: file.size,
        runtime: 'onnx',
      },
      file,
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeaderRow
          title="Embedding providers"
          description="Each backend is probed for availability on this device. A provider that cannot run says why rather than silently falling back to another, because the choice determines what the vectors actually represent."
        />
        <div className="divide-y divide-border border-t border-border">
          {providers.map((provider) => {
            const selected = provider.id === embedding.providerId;
            const usable = provider.availability.status !== 'unavailable';
            const supported = dataset ? provider.supports.includes(dataset.sequenceType) : true;

            return (
              <div key={provider.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-semibold text-foreground">{provider.name}</p>
                      <Badge variant={provider.family === 'model' ? 'primary' : 'default'}>
                        {provider.family === 'model' ? 'Learned model' : 'Deterministic'}
                      </Badge>
                      {provider.availability.status === 'available' ? (
                        <Badge variant="pass">Available</Badge>
                      ) : provider.availability.status === 'experimental' ? (
                        <Badge variant="warning">Experimental</Badge>
                      ) : (
                        <Badge variant="neutral">Unavailable</Badge>
                      )}
                      {!supported ? (
                        <Badge variant="warning">
                          Not for {dataset?.sequenceType ?? 'this type'}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                      {provider.description}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    disabled={!usable || !supported}
                    onClick={() => setEmbedding({ providerId: provider.id })}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </Button>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Where it runs:</span>{' '}
                  {provider.locality}
                </p>

                {provider.availability.status !== 'available' ? (
                  <Alert
                    variant={provider.availability.status === 'experimental' ? 'warning' : 'info'}
                    icon={false}
                    title={
                      provider.availability.status === 'experimental'
                        ? 'Experimental'
                        : 'Cannot run on this device'
                    }
                  >
                    <p>{provider.availability.reason}</p>
                    {provider.family === 'model' ? (
                      <div className="mt-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted">
                          <Upload className="size-3" aria-hidden />
                          Register a local model file
                          <input
                            type="file"
                            accept=".onnx"
                            className="sr-only"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void registerModel(file);
                              event.target.value = '';
                            }}
                          />
                        </label>
                        <p className="mt-1.5 text-[11px] leading-relaxed">
                          The file stays in memory for this session and is never copied to storage
                          or transmitted. Registering weights is not sufficient on its own: this
                          build does not bundle an ONNX inference runtime, and SeqLens will not
                          fetch one, because that would mean a network request.
                        </p>
                      </div>
                    ) : null}
                  </Alert>
                ) : null}

                {localModelRegistry.list().length > 0 && provider.family === 'model' ? (
                  <div className="space-y-1">
                    {localModelRegistry.list().map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 rounded border border-border bg-subtle px-2 py-1"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                          {model.name}
                        </span>
                        <span className="tabular text-[10px] text-muted-foreground">
                          {formatInteger(Math.round(model.sizeBytes / 1024 / 1024))} MB
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1"
                          onClick={() => localModelRegistry.unregister(model.id)}
                          aria-label={`Unregister ${model.name}`}
                        >
                          <CircleSlash className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeaderRow
          title="Reduction and clustering"
          description={
            active
              ? `${active.name} will produce ${active.dimensions === 'variable' ? `${formatInteger(dimensions)}` : formatInteger(active.dimensions)}-dimensional vectors for this dataset.`
              : 'Choose a provider above.'
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void updateConfig(project.id, {
                  ...config,
                  embedding: { ...DEFAULT_CONFIG.embedding },
                })
              }
            >
              Restore defaults
            </Button>
          }
        />
        <div className="grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="embed-k">k-mer size</Label>
            <Input
              id="embed-k"
              type="number"
              min={1}
              max={isProtein ? 4 : 7}
              value={embedding.k}
              onChange={(event) =>
                setEmbedding({
                  k: Math.max(1, Math.min(isProtein ? 4 : 7, Number(event.target.value) || 4)),
                })
              }
              className="h-7 max-w-20 text-xs"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Sets the vector width: {alphabetSize}
              <sup>k</sup> = {formatInteger(dimensions)} dimensions. Larger k gives finer
              compositional resolution but a sparser vector, and for short sequences most
              dimensions end up zero.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reduction">Reduction</Label>
            <Select
              value={embedding.reduction}
              onValueChange={(value) => setEmbedding({ reduction: value as 'pca' | 'umap' })}
            >
              <SelectTrigger id="reduction" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pca">PCA</SelectItem>
                <SelectItem value="umap">UMAP</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              PCA is linear, deterministic, and reports how much variance the two axes capture.
              UMAP preserves local neighbourhoods better and separates clusters more clearly, but
              its axes have no units and inter-cluster distances are not faithful.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="max-sequences">Sequences to embed</Label>
            <Input
              id="max-sequences"
              type="number"
              min={3}
              max={4000}
              step={100}
              value={embedding.maxSequences}
              onChange={(event) =>
                setEmbedding({
                  maxSequences: Math.max(3, Math.min(4000, Number(event.target.value) || 2000)),
                })
              }
              className="h-7 max-w-24 text-xs"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Capped at 4,000. UMAP&rsquo;s neighbour search here is exact brute force, so it is
              quadratic in point count: 4,000 points at 256 dimensions is already four billion
              multiply-adds.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="cluster-count">Clusters (k-means)</Label>
              <span className="tabular text-[11px] font-medium text-foreground">
                {embedding.clusterCount}
              </span>
            </div>
            <Slider
              id="cluster-count"
              min={1}
              max={16}
              step={1}
              value={[embedding.clusterCount]}
              onValueChange={([value]) => setEmbedding({ clusterCount: value })}
              className="py-2"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              k-means always returns this many clusters whether or not the data has that structure.
              Up to 16 stay visually distinguishable, using four hues crossed with four marker
              shapes.
            </p>
          </div>

          {embedding.reduction === 'umap' ? (
            <>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="umap-neighbors">UMAP neighbours</Label>
                  <span className="tabular text-[11px] font-medium text-foreground">
                    {embedding.umapNeighbors}
                  </span>
                </div>
                <Slider
                  id="umap-neighbors"
                  min={2}
                  max={100}
                  step={1}
                  value={[embedding.umapNeighbors]}
                  onValueChange={([value]) => setEmbedding({ umapNeighbors: value })}
                  className="py-2"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Low values emphasise very local structure and fragment the layout; high values
                  emphasise global structure and merge nearby clusters.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="umap-mindist">UMAP minimum distance</Label>
                  <span className="tabular text-[11px] font-medium text-foreground">
                    {formatDecimal(embedding.umapMinDist, 2)}
                  </span>
                </div>
                <Slider
                  id="umap-mindist"
                  min={0}
                  max={0.99}
                  step={0.01}
                  value={[embedding.umapMinDist]}
                  onValueChange={([value]) => setEmbedding({ umapMinDist: value })}
                  className="py-2"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  How tightly points may pack together. Low values produce dense clumps; high
                  values spread points evenly and obscure cluster boundaries.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="umap-epochs">UMAP epochs</Label>
                <Input
                  id="umap-epochs"
                  type="number"
                  min={20}
                  max={2000}
                  step={20}
                  value={embedding.umapEpochs}
                  onChange={(event) =>
                    setEmbedding({
                      umapEpochs: Math.max(20, Math.min(2000, Number(event.target.value) || 200)),
                    })
                  }
                  className="h-7 max-w-24 text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Optimisation steps. More epochs sharpen cluster separation at linear cost; below
                  about 100 the layout has not converged.
                </p>
              </div>
            </>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="embed-seed">Random seed</Label>
            <Input
              id="embed-seed"
              type="number"
              min={0}
              value={embedding.seed}
              onChange={(event) => setEmbedding({ seed: Number(event.target.value) || 0 })}
              className="h-7 max-w-24 text-xs"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Drives every stochastic step: the sample when the dataset is capped, the k-means
              seeding, and the UMAP layout. The same seed always produces the same result, which is
              what makes the plot reproducible.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
