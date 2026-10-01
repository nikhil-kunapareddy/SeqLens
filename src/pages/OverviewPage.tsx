import {
  ArrowRight,
  Database,
  FileText,
  FlaskConical,
  Layers,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { METRIC_DOCS } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { LocalOnlyBadge } from '@/components/layout/PrivacyIndicator';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import {
  Alert,
  Badge,
  EmptyState,
  MetricList,
  SectionHeading,
  Skeleton,
  StatusBadge,
} from '@/components/ui/display';
import { DEMO_DATASETS, PRIMARY_DEMO } from '@/data/demoData';
import { useAnalysisStore, selectQCResult } from '@/state/analysisStore';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
  useProjectTotals,
} from '@/state/projectStore';
import { datasetRepository } from '@/storage/repositories';
import {
  formatBytes,
  formatDecimal,
  formatInteger,
  formatPercent,
  formatRelativeTime,
  formatSequenceType,
  formatFileFormat,
  pluralize,
} from '@/utils/format';
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

  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);
  const navigate = useNavigate();

  // The index is keyed on the dataset id, so a read that resolves after the
  // user has already switched datasets is discarded rather than painted.
  const { data: index } = useKeyedAsync(dataset?.id ?? null, (datasetId) =>
    datasetRepository.getIndex(datasetId).then((value) => value ?? null),
  );

  const datasetId = dataset?.id ?? null;
  useEffect(() => {
    if (datasetId !== null) void hydrate(datasetId, ['qc']);
  }, [datasetId, hydrate]);

  const stats = useMemo(() => {
    if (index === null || index.count === 0) return null;
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
    if (index === null || index.count === 0) return [];
    return buildLengthHistogram(index.lengths, 36).bins.map((bin) => ({
      label: bin.from === bin.to - 1 ? formatInteger(bin.from) : formatInteger(bin.from),
      from: bin.from,
      to: bin.to,
      count: bin.count,
    }));
  }, [index]);

  const loadDemo = async (id: string) => {
    const demo = DEMO_DATASETS.find((candidate) => candidate.id === id);
    if (!demo) return;
    setLoadingDemo(id);
    try {
      const imported = await importFiles([{ file: demo.build() }]);
      if (imported.length > 0) {
        selectDataset(imported[0].id);
        navigate('/qc');
      }
    } finally {
      setLoadingDemo(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <StatGrid>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </StatGrid>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (project === null) {
    return <Landing onLoadDemo={loadDemo} loadingDemo={loadingDemo} />;
  }

  const isProtein = dataset?.sequenceType === 'protein';

  return (
    <div className="space-y-5">
      <SectionHeading
        title={project.name}
        description={
          project.description ||
          `Created ${formatRelativeTime(project.createdAt)}. ${formatInteger(totals.datasets)} dataset${totals.datasets === 1 ? '' : 's'}, ${formatInteger(totals.sequences)} sequences, ${formatInteger(totals.residues)} residues held locally.`
        }
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/reports">
                <FileText />
                Reports
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/import">
                <Upload />
                Import FASTA / FASTQ
              </Link>
            </Button>
          </>
        }
      />

      {datasets.length === 0 ? (
        <EmptyState
          icon={Database}
          title="This project has no datasets yet"
          description="Import a FASTA or FASTQ file from this device, or load a demo dataset to see every module working end to end."
          actions={
            <>
              <Button size="sm" asChild>
                <Link to="/import">Import a file</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadDemo(PRIMARY_DEMO.id)}
                disabled={loadingDemo !== null}
              >
                {loadingDemo === PRIMARY_DEMO.id ? 'Loading demo…' : 'Try demo dataset'}
              </Button>
            </>
          }
        />
      ) : null}

      {dataset && stats ? (
        <>
          {/* The eight headline figures. */}
          <StatGrid columns={4}>
            <StatTile
              label="Dataset"
              value={<span className="font-mono text-sm">{dataset.fileName}</span>}
              detail={`${formatFileFormat(dataset.format)} · ${formatSequenceType(dataset.sequenceType)} · ${formatBytes(dataset.fileSize)}`}
              badge={
                dataset.truncated ? <Badge variant="warning">Truncated</Badge> : undefined
              }
            />
            <StatTile
              label="Sequences"
              value={formatInteger(stats.count)}
              detail={`${formatInteger(stats.min)} to ${formatInteger(stats.max)} ${isProtein ? 'aa' : 'bp'}, median ${formatInteger(stats.median)}`}
            />
            <StatTile
              label={isProtein ? 'Total residues' : 'Total bases'}
              value={formatInteger(stats.total)}
              detail={`mean length ${formatDecimal(stats.mean, 1)}`}
            />
            <StatTile
              label="GC content"
              value={isProtein ? 'N/A' : formatPercent(stats.gcPercent, 2)}
              detail={
                isProtein
                  ? 'Not applicable to protein sequences'
                  : 'Over unambiguous bases only'
              }
              help={`${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}`}
            />
            <StatTile
              label="N50"
              value={formatInteger(stats.n50)}
              detail={`N90 ${formatInteger(stats.n90)} · L50 ${formatInteger(stats.l50)}`}
              help={`${METRIC_DOCS.n50.what} ${METRIC_DOCS.n50.caveat}`}
            />
            <StatTile
              label="Duplicates"
              value={
                qc ? formatInteger(qc.stats.duplicateSequences) : <span className="text-muted-foreground">&mdash;</span>
              }
              detail={
                qc
                  ? `${formatPercent((qc.stats.duplicateSequences / Math.max(1, qc.stats.sequenceCount)) * 100, 2)} of sequences in ${pluralize(qc.stats.duplicateGroups, 'group')}`
                  : 'Run QC to detect exact duplicates'
              }
              help={`${METRIC_DOCS.duplicates.what} ${METRIC_DOCS.duplicates.caveat}`}
            />
            <StatTile
              label="Ambiguous"
              value={
                index
                  ? formatPercent(
                      (Array.from(index.ambiguousCounts).reduce((sum, value) => sum + value, 0) /
                        Math.max(1, stats.total)) *
                        100,
                      3,
                    )
                  : '-'
              }
              detail="Residues outside the canonical alphabet"
              help={`${METRIC_DOCS.ambiguous.what} ${METRIC_DOCS.ambiguous.caveat}`}
            />
            <StatTile
              label="QC status"
              value={
                qc ? (
                  <StatusBadge status={qc.overallStatus} className="text-xs" />
                ) : (
                  <span className="text-sm text-muted-foreground">Not run</span>
                )
              }
              detail={
                qc
                  ? `${qc.checks.filter((c) => c.status === 'pass').length} of ${qc.checks.length} checks pass`
                  : 'The most severe of eleven checks'
              }
              badge={
                qc ? undefined : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() =>
                      void runAnalysis({
                        projectId: project.id,
                        datasetId: dataset.id,
                        kind: 'qc',
                        config,
                      })
                    }
                  >
                    <Play className="size-3" />
                    Run
                  </Button>
                )
              }
            />
          </StatGrid>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartFrame
              className="xl:col-span-2"
              title="Sequence length distribution"
              description={`How the ${formatInteger(stats.count)} sequences in this dataset are distributed by length.`}
              data={lengthHistogram}
              columns={[
                { key: 'from', header: 'From', numeric: true },
                { key: 'to', header: 'To', numeric: true },
                { key: 'count', header: 'Sequences', numeric: true },
              ]}
              exportName={`${dataset.fileName}-length-distribution`}
              height={260}
              footnote={
                stats.max / Math.max(1, stats.min) > 100
                  ? 'Lengths span more than two orders of magnitude, so the bins are logarithmically spaced. Bin bounds are in the table view.'
                  : undefined
              }
            >
              <Histogram
                data={lengthHistogram}
                xKey="label"
                yKey="count"
                xLabel={isProtein ? 'Residues' : 'Length (bp)'}
                yLabel="Sequences"
                yTickFormatter={(value) => formatInteger(value)}
                tooltipLabel={(row) =>
                  `${formatInteger(Number(row.from))} - ${formatInteger(Number(row.to) - 1)} ${isProtein ? 'aa' : 'bp'}`
                }
                tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
              />
            </ChartFrame>

            <Card>
              <CardHeaderRow
                title="Next steps"
                description="Each module runs on the selected dataset and caches its result locally."
              />
              <div className="space-y-1 px-2 pb-3">
                {[
                  { to: '/qc', label: 'Quality control', icon: FlaskConical, done: qc !== null },
                  { to: '/composition', label: 'Composition and k-mers', icon: Layers, done: false },
                  { to: '/similarity', label: 'Similarity and redundancy', icon: Layers, done: false },
                  { to: '/explorer', label: 'Browse sequences', icon: Database, done: false },
                  { to: '/reports', label: 'Generate a report', icon: FileText, done: false },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <item.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="flex-1">{item.label}</span>
                    {item.done ? <Badge variant="pass">Done</Badge> : null}
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          {dataset.parseIssues.length > 0 ? (
            <Alert variant="warning" title="The parser reported issues for this file">
              <ul className="list-disc space-y-1 pl-4">
                {dataset.parseIssues.map((issue, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">
                      {issue.count > 1 ? `${formatInteger(issue.count)}x ` : ''}
                    </span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <Card>
            <CardHeaderRow
              title="Datasets in this project"
              description="Every imported file, with the metadata recorded at import time."
              actions={
                <Button size="sm" variant="outline" asChild>
                  <Link to="/import">Import another</Link>
                </Button>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-y border-border bg-subtle text-muted-foreground">
                    <th scope="col" className="px-4 py-1.5 text-left font-medium">File</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Format</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Type</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Sequences</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Residues</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Size</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className={`cursor-pointer border-b border-border last:border-b-0 ${candidate.id === dataset.id ? 'bg-primary-soft' : 'hover:bg-muted/60'}`}
                      onClick={() => selectDataset(candidate.id)}
                    >
                      <td className="px-4 py-1.5 font-mono text-foreground">{candidate.fileName}</td>
                      <td className="px-3 py-1.5">{formatFileFormat(candidate.format)}</td>
                      <td className="px-3 py-1.5">
                        {formatSequenceType(candidate.sequenceType)}
                        {candidate.typeConfidence < 0.95 ? (
                          <span
                            className="ml-1 text-muted-foreground"
                            title={candidate.typeDetectionNote}
                          >
                            ({formatPercent(candidate.typeConfidence * 100, 0)})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {formatInteger(candidate.sequenceCount)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {formatInteger(candidate.totalResidues)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {formatBytes(candidate.fileSize)}
                        {candidate.gzipped ? (
                          <span className="ml-1 text-muted-foreground">gz</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5">{formatRelativeTime(candidate.importedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
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
function Landing({
  onLoadDemo,
  loadingDemo,
}: {
  onLoadDemo: (id: string) => Promise<void>;
  loadingDemo: string | null;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">SeqLens</h1>
          <p className="text-base text-foreground">Local sequence intelligence.</p>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Analyse FASTA and FASTQ files directly in your browser. No uploads. No accounts. No
          cloud. Quality control, composition, k-mer spectra, redundancy, similarity, open reading
          frames, alignment, and embeddings, all computed on this device.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link to="/import">
              <Upload />
              Import FASTA / FASTQ
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => void onLoadDemo(PRIMARY_DEMO.id)}
            disabled={loadingDemo !== null}
          >
            <Sparkles />
            {loadingDemo === PRIMARY_DEMO.id ? 'Loading demo…' : 'Try demo dataset'}
          </Button>
        </div>

        <LocalOnlyBadge />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeaderRow
            title="What SeqLens computes"
            description="Everything runs in Web Workers on this machine."
          />
          <div className="px-4 pb-4">
            <MetricList
              rows={[
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
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeaderRow
            title="Why it stays on your machine"
            description="The guarantee is structural, not a policy statement."
          />
          <div className="space-y-2.5 px-4 pb-4 text-xs leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">No backend exists.</span> SeqLens is a
              static bundle. There is no API to send sequences to, because none was built.
            </p>
            <p>
              <span className="font-medium text-foreground">No network calls after load.</span>{' '}
              Parsing, statistics, alignment, and embedding all run in Web Workers. Open your
              browser&rsquo;s network panel and watch an analysis run.
            </p>
            <p>
              <span className="font-medium text-foreground">Storage is local and optional.</span>{' '}
              Files are held in IndexedDB on this device only when you save a project, and Settings
              has a control that deletes every trace of it.
            </p>
            <p>
              <span className="font-medium text-foreground">No telemetry, no accounts.</span>{' '}
              Nothing is measured, and nothing identifies you.
            </p>
            <p>
              The deployed build ships a Content-Security-Policy that blocks outbound connections
              entirely, so the browser itself enforces this.
            </p>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        <SectionHeading
          title="Demo datasets"
          description="Synthetic, deterministic, and generated on this device. Each one carries features worth finding, so you can see what every module reports before importing your own data."
        />
        <div className="grid gap-3 md:grid-cols-3">
          {DEMO_DATASETS.map((demo) => (
            <Card key={demo.id} className="flex flex-col">
              <CardHeaderRow title={demo.title} description={demo.description} />
              <div className="flex-1 px-4">
                <ul className="space-y-1">
                  {demo.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
                    >
                      <span className="text-primary" aria-hidden>
                        &bull;
                      </span>
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-4">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {demo.fileName}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onLoadDemo(demo.id)}
                  disabled={loadingDemo !== null}
                >
                  {loadingDemo === demo.id ? 'Loading…' : 'Load'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
