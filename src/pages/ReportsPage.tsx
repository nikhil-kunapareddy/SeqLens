import {
  Download,
  ExternalLink,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Play,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildHtmlReport } from '@/features/reports/htmlReport';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import {
  Alert,
  Badge,
  EmptyState,
  MetricList,
  SectionHeading,
  StatusBadge,
} from '@/components/ui/display';
import { Checkbox, Input, Label } from '@/components/ui/primitives';
import { useAnalysisStore } from '@/state/analysisStore';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { createId, reportRepository, resultRepository } from '@/storage/repositories';
import { APP_VERSION } from '@/types';
import type {
  AlignmentResult,
  AnalysisKind,
  CompositionResult,
  EmbeddingResult,
  OrfResult,
  QCResult,
  ReportRecord,
  ReportSectionSelection,
  SimilarityResult,
  StoredResult,
} from '@/types';
import { MIME, recordsToCsv, saveFile, toJson } from '@/utils/export';
import {
  formatBytes,
  formatInteger,
  formatRelativeTime,
  formatTimestamp,
  slugify,
} from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';

const SECTION_META: {
  key: keyof ReportSectionSelection;
  label: string;
  description: string;
  /** Analysis result the section needs, if any. */
  requires?: AnalysisKind;
}[] = [
  {
    key: 'overview',
    label: 'Dataset overview',
    description: 'File metadata, headline statistics, and any parser notes recorded at import.',
  },
  {
    key: 'qc',
    label: 'QC summary',
    description: 'All checks with their verdicts and thresholds, length and GC distributions, positional profiles, and flagged sequences.',
    requires: 'qc',
  },
  {
    key: 'composition',
    label: 'Composition',
    description: 'Residue composition, strand skew, CpG statistics, entropy, and protein properties where applicable.',
    requires: 'composition',
  },
  {
    key: 'kmer',
    label: 'k-mer analysis',
    description: 'One panel per k with distinct counts, entropy, and the most frequent and rarest k-mers.',
    requires: 'composition',
  },
  {
    key: 'redundancy',
    label: 'Redundancy',
    description: 'Exact duplicate groups and the copy-count distribution.',
    requires: 'qc',
  },
  {
    key: 'similarity',
    label: 'Similarity',
    description: 'Similarity matrix, clusters, representatives, and the most similar pairs.',
    requires: 'similarity',
  },
  {
    key: 'orf',
    label: 'ORF statistics',
    description: 'ORF counts, length distribution, per-frame breakdown, and codon usage.',
    requires: 'orf',
  },
  {
    key: 'alignment',
    label: 'Alignment results',
    description: 'The alignment itself in blocks, conserved and variable regions, and the variant table.',
    requires: 'alignment',
  },
  {
    key: 'embedding',
    label: 'Embedding results',
    description: 'The 2-D projection, cluster summary, and coordinates.',
    requires: 'embedding',
  },
];

const RESULT_KINDS: AnalysisKind[] = [
  'qc',
  'composition',
  'similarity',
  'orf',
  'alignment',
  'embedding',
];

/**
 * Stable empty values.
 *
 * The keyed-async hook returns null until a load settles, and substituting a
 * fresh `{}` or `[]` on each render would break memoisation downstream.
 */
const EMPTY_RESULTS: Partial<Record<AnalysisKind, StoredResult>> = Object.freeze({});
const EMPTY_REPORTS: readonly ReportRecord[] = Object.freeze([]);

/**
 * Report generation and export.
 *
 * The HTML report is a single self-contained file: styles inlined, charts as
 * inline SVG, no script tag, no sibling assets. That is the difference between
 * a report and a screenshot of an application - it opens on a machine that has
 * never run SeqLens, with no network access, years later.
 *
 * Only sections whose analysis has actually been run are offered. A report that
 * silently omitted a requested section, or filled it with placeholder text,
 * would be worse than one that says the analysis has not run.
 */
export function ReportsPage() {
  const project = useProjectStore(selectActiveProject);
  const dataset = useProjectStore(selectActiveDataset);
  const datasets = useProjectStore((state) => state.datasets);
  const config = useProjectStore(selectActiveConfig);
  const hydrate = useAnalysisStore((state) => state.hydrate);

  const [sections, setSections] = useState<ReportSectionSelection>({
    overview: true,
    qc: true,
    composition: true,
    kmer: true,
    redundancy: true,
    similarity: true,
    orf: true,
    alignment: true,
    embedding: true,
  });
  const [reportName, setReportName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<ReportRecord | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Results are read straight from IndexedDB rather than from the in-memory
  // store, so the section list reflects what is actually available rather than
  // what happens to be loaded from a page the user visited earlier.
  const { data: available } = useKeyedAsync(dataset?.id ?? null, async (datasetId) => {
    const entries = await Promise.all(
      RESULT_KINDS.map(
        async (kind) => [kind, await resultRepository.getLatest(datasetId, kind)] as const,
      ),
    );
    const map: Partial<Record<AnalysisKind, StoredResult>> = {};
    for (const [kind, stored] of entries) {
      if (stored) map[kind] = stored;
    }
    return map;
  });
  const results = available ?? EMPTY_RESULTS;

  const { data: reports } = useKeyedAsync(
    project === null ? null : `${project.id}|${reloadToken}`,
    (key) => reportRepository.listForProject(key.slice(0, key.lastIndexOf('|'))),
  );
  const savedReports = reports ?? EMPTY_REPORTS;

  const datasetId = dataset?.id ?? null;
  useEffect(() => {
    if (datasetId !== null) void hydrate(datasetId, RESULT_KINDS);
  }, [datasetId, hydrate]);

  // The default name tracks the selected dataset without an effect: the input
  // holds only what the user typed, and the dataset-derived name is the
  // placeholder and the fallback.
  const defaultReportName = dataset ? `${dataset.fileName} report` : 'SeqLens report';
  const effectiveReportName = reportName.trim() || defaultReportName;

  const effectiveSections = useMemo<ReportSectionSelection>(() => {
    const next = { ...sections };
    for (const meta of SECTION_META) {
      if (meta.requires && results[meta.requires] === undefined) {
        next[meta.key] = false;
      }
    }
    return next;
  }, [sections, results]);

  const includedCount = Object.values(effectiveSections).filter(Boolean).length;

  const generate = async () => {
    if (!project || !dataset) return;
    setGenerating(true);
    try {
      const html = buildHtmlReport({
        project,
        dataset,
        sections: effectiveSections,
        config,
        qc: (results.qc?.result as QCResult | undefined) ?? null,
        composition: (results.composition?.result as CompositionResult | undefined) ?? null,
        similarity: (results.similarity?.result as SimilarityResult | undefined) ?? null,
        orf: (results.orf?.result as OrfResult | undefined) ?? null,
        alignment: (results.alignment?.result as AlignmentResult | undefined) ?? null,
        embedding: (results.embedding?.result as EmbeddingResult | undefined) ?? null,
      });

      const record: ReportRecord = {
        id: createId('rep'),
        projectId: project.id,
        name: effectiveReportName,
        createdAt: Date.now(),
        appVersion: APP_VERSION,
        sections: effectiveSections,
        datasetIds: [dataset.id],
        html,
        sizeBytes: new Blob([html]).size,
        configSnapshot: config,
      };

      await reportRepository.save(record);
      setLastGenerated(record);
      setReloadToken((token) => token + 1);
    } finally {
      setGenerating(false);
    }
  };

  const downloadHtml = async (record: ReportRecord) => {
    await saveFile(record.html, {
      suggestedName: `${slugify(record.name)}.html`,
      mimeType: MIME.html,
      description: 'HTML report',
      extensions: ['.html'],
    });
  };

  /** Opens the report in a new tab from an object URL, with no server involved. */
  const openHtml = (record: ReportRecord) => {
    const blob = new Blob([record.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const exportJson = async () => {
    if (!project || !dataset) return;
    const payload = {
      seqlens: { version: APP_VERSION, exportedAt: new Date().toISOString() },
      project: { id: project.id, name: project.name, description: project.description },
      dataset,
      configuration: config,
      results: Object.fromEntries(
        Object.entries(results).map(([kind, stored]) => [
          kind,
          stored
            ? {
                computedAt: stored.computedAt,
                configHash: stored.configHash,
                durationMs: stored.durationMs,
                result: stored.result,
              }
            : null,
        ]),
      ),
    };
    await saveFile(toJson(payload), {
      suggestedName: `${slugify(dataset.fileName)}-seqlens.json`,
      mimeType: MIME.json,
      description: 'JSON export',
      extensions: ['.json'],
    });
  };

  const exportCsvBundle = async () => {
    if (!dataset) return;
    // One combined long-form CSV rather than a zip: writing a zip needs a
    // compression library, and a single tidy table is easier to load anyway.
    const rows: Record<string, unknown>[] = [];

    const push = (section: string, metric: string, value: unknown, note = '') => {
      rows.push({ dataset: dataset.fileName, section, metric, value, note });
    };

    push('dataset', 'fileName', dataset.fileName);
    push('dataset', 'format', dataset.format);
    push('dataset', 'sequenceType', dataset.sequenceType);
    push('dataset', 'sequenceCount', dataset.sequenceCount);
    push('dataset', 'totalResidues', dataset.totalResidues);
    push('dataset', 'minLength', dataset.minLength);
    push('dataset', 'maxLength', dataset.maxLength);
    push('dataset', 'fileSizeBytes', dataset.fileSize);

    const qc = results.qc?.result as QCResult | undefined;
    if (qc) {
      for (const [metric, value] of Object.entries(qc.stats)) {
        push('qc', metric, value);
      }
      for (const check of qc.checks) {
        push('qc-check', check.id, check.status, `${check.value} — ${check.thresholdNote}`);
      }
    }

    const composition = results.composition?.result as CompositionResult | undefined;
    if (composition?.nucleotide) {
      for (const [metric, value] of Object.entries(composition.nucleotide)) {
        push('composition', metric, value);
      }
    }
    if (composition?.protein) {
      for (const [metric, value] of Object.entries(composition.protein.aggregate)) {
        push('composition-protein', metric, value);
      }
    }
    for (const spectrum of composition?.kmerSpectra ?? []) {
      push('kmer', `k${spectrum.k}-distinct`, spectrum.distinct);
      push('kmer', `k${spectrum.k}-total`, spectrum.total);
      push('kmer', `k${spectrum.k}-entropy`, spectrum.entropy);
      push('kmer', `k${spectrum.k}-normalizedEntropy`, spectrum.normalizedEntropy);
      push('kmer', `k${spectrum.k}-rareCount`, spectrum.rareCount);
      for (const entry of spectrum.top.slice(0, 20)) {
        push(`kmer-top-k${spectrum.k}`, entry.kmer, entry.count, `frequency ${entry.frequency}`);
      }
    }

    const similarity = results.similarity?.result as SimilarityResult | undefined;
    if (similarity) {
      for (const [metric, value] of Object.entries(similarity.stats)) {
        push('similarity', metric, value);
      }
      push('similarity', 'clusters', similarity.clusters.length);
      push('similarity', 'sampled', similarity.sampled);
    }

    const orf = results.orf?.result as OrfResult | undefined;
    if (orf) {
      for (const [metric, value] of Object.entries(orf.stats)) {
        push('orf', metric, value);
      }
    }

    const alignment = results.alignment?.result as AlignmentResult | undefined;
    if (alignment) {
      for (const [metric, value] of Object.entries(alignment.stats)) {
        push('alignment', metric, value ?? '');
      }
      push('alignment', 'method', alignment.method);
    }

    const embedding = results.embedding?.result as EmbeddingResult | undefined;
    if (embedding) {
      push('embedding', 'provider', embedding.providerId);
      push('embedding', 'dimensions', embedding.dimensions);
      push('embedding', 'reduction', embedding.reduction);
      push('embedding', 'pointsEmbedded', embedding.points.length);
      push('embedding', 'sampled', embedding.sampled);
    }

    await saveFile(recordsToCsv(rows), {
      suggestedName: `${slugify(dataset.fileName)}-summary.csv`,
      mimeType: MIME.csv,
      description: 'CSV summary',
      extensions: ['.csv'],
    });
  };

  if (project === null) {
    return (
      <div className="space-y-4">
        <SectionHeading title="Reports" />
        <EmptyState
          icon={FileText}
          title="No project yet"
          description="Reports are generated from a project's analysis results."
          actions={
            <Button size="sm" asChild>
              <Link to="/import">Import FASTA / FASTQ</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Reports"
        description="A single self-contained HTML file with its styles and charts embedded, no JavaScript, and no external assets. It opens on a machine that has never run SeqLens, with no network access. The analysis configuration is written out in full, so the numbers can be reproduced."
      />

      {dataset === null ? (
        <EmptyState
          icon={FileText}
          title="No dataset selected"
          description="Import a file or pick a dataset from the header to generate a report."
          actions={
            <Button size="sm" asChild>
              <Link to="/import">Import a file</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeaderRow
              title="Build a report"
              description={
                <>
                  For <span className="font-mono">{dataset.fileName}</span>. Sections whose
                  analysis has not been run are unavailable rather than filled with placeholders.
                </>
              }
              actions={
                <Button size="sm" onClick={() => void generate()} disabled={generating || includedCount === 0}>
                  <Play />
                  {generating ? 'Generating…' : 'Generate report'}
                </Button>
              }
            />

            <div className="space-y-3 border-t border-border px-4 py-4">
              <div className="max-w-md space-y-1">
                <Label htmlFor="report-name">Report name</Label>
                <Input
                  id="report-name"
                  value={reportName}
                  onChange={(event) => setReportName(event.target.value)}
                  placeholder={defaultReportName}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">Sections</p>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {SECTION_META.map((meta) => {
                    const stored = meta.requires ? results[meta.requires] : undefined;
                    const unavailable = meta.requires !== undefined && stored === undefined;
                    return (
                      <label
                        key={meta.key}
                        className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 transition-colors ${
                          unavailable
                            ? 'cursor-not-allowed border-border bg-subtle opacity-60'
                            : 'border-border bg-card hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={effectiveSections[meta.key]}
                          disabled={unavailable}
                          onCheckedChange={(checked) =>
                            setSections((previous) => ({ ...previous, [meta.key]: checked === true }))
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground">{meta.label}</span>
                            {unavailable ? (
                              <Badge variant="neutral">Not run</Badge>
                            ) : stored ? (
                              <Badge variant="pass">
                                {formatRelativeTime(stored.computedAt)}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {meta.description}
                          </span>
                          {unavailable ? (
                            <Link
                              to={`/${meta.requires === 'composition' ? 'composition' : meta.requires}`}
                              className="mt-1 inline-block text-[11px] text-primary hover:underline"
                            >
                              Run {meta.requires} analysis
                            </Link>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {includedCount === 0 ? (
                <Alert variant="warning" title="No sections selected">
                  Select at least one section, or run an analysis first.
                </Alert>
              ) : null}
            </div>

            <div className="border-t border-border bg-subtle px-4 py-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The report is saved into this project in local storage and can be downloaded or
                opened at any time. Downloading writes it to your own filesystem through the
                browser&rsquo;s save dialog; nothing is uploaded.
              </p>
            </div>
          </Card>

          {lastGenerated ? (
            <Alert
              variant="success"
              title={`Report generated: ${lastGenerated.name}`}
              actions={
                <>
                  <Button size="sm" onClick={() => void downloadHtml(lastGenerated)}>
                    <Download />
                    Download HTML
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openHtml(lastGenerated)}>
                    <ExternalLink />
                    Open in a new tab
                  </Button>
                </>
              }
            >
              {formatBytes(lastGenerated.sizeBytes)},{' '}
              {Object.values(lastGenerated.sections).filter(Boolean).length} sections.
            </Alert>
          ) : null}

          <Card>
            <CardHeaderRow
              title="Other export formats"
              description="For downstream analysis rather than reading."
            />
            <div className="grid gap-3 border-t border-border px-4 py-4 md:grid-cols-3">
              <ExportOption
                icon={FileJson}
                title="JSON"
                description="Every stored result in full, with its configuration hash and compute time. Typed arrays become plain arrays; very large ones are truncated with an explicit marker rather than silently."
                action={
                  <Button size="sm" variant="outline" onClick={() => void exportJson()}>
                    <Download />
                    Export JSON
                  </Button>
                }
              />
              <ExportOption
                icon={FileSpreadsheet}
                title="CSV summary"
                description="One tidy long-form table of every headline metric across all modules, with the QC verdicts and their thresholds. Individual charts have their own CSV export on each page."
                action={
                  <Button size="sm" variant="outline" onClick={() => void exportCsvBundle()}>
                    <Download />
                    Export CSV
                  </Button>
                }
              />
              <ExportOption
                icon={FileCode2}
                title="Sequences"
                description="Export the current selection, ORF proteins, or cluster representatives as FASTA or FASTQ from the Explorer, ORF, and Similarity pages respectively."
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/explorer">Open explorer</Link>
                  </Button>
                }
              />
            </div>
          </Card>

          <Card>
            <CardHeaderRow
              title="Analysis status"
              description="What has been computed for this dataset, and when."
            />
            <div className="px-4 pb-4">
              <MetricList
                rows={SECTION_META.filter((meta) => meta.requires).map((meta) => {
                  const stored = results[meta.requires!];
                  return {
                    label: meta.label,
                    value: stored ? (
                      <span className="flex items-center gap-1.5">
                        {meta.requires === 'qc' && stored ? (
                          <StatusBadge status={(stored.result as QCResult).overallStatus} />
                        ) : null}
                        {formatRelativeTime(stored.computedAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">not run</span>
                    ),
                  };
                })}
              />
            </div>
          </Card>
        </>
      )}

      <Card>
        <CardHeaderRow
          title={`Saved reports (${formatInteger(savedReports.length)})`}
          description="Stored in this browser with the project. Deleting a project deletes its reports."
        />
        {savedReports.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No reports have been generated for this project yet.
          </p>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {savedReports.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{record.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatTimestamp(record.createdAt)} &middot; {formatBytes(record.sizeBytes)}{' '}
                    &middot; {Object.values(record.sections).filter(Boolean).length} sections
                    &middot; SeqLens {record.appVersion}
                    {record.datasetIds.length > 1
                      ? ` · ${record.datasetIds.length} datasets`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => openHtml(record)}>
                    <ExternalLink />
                    Open
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void downloadHtml(record)}>
                    <Download />
                    HTML
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      void reportRepository
                        .delete(record.id)
                        .then(() => setReloadToken((token) => token + 1));
                    }}
                    aria-label={`Delete ${record.name}`}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {datasets.length > 1 ? (
        <Alert variant="info" title="Reports cover one dataset at a time">
          This project has {formatInteger(datasets.length)} datasets. Switch the active dataset in
          the header and generate a report for each; each report records which dataset it describes.
        </Alert>
      ) : null}
    </div>
  );
}

function ExportOption({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof FileJson;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-subtle px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <p className="flex-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      <div>{action}</div>
    </div>
  );
}
