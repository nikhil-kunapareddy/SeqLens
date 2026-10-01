import {
  AlertTriangle,
  FileUp,
  HardDrive,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FILE_ACCEPT, SUPPORTED_EXTENSIONS } from '@/bio/parsers/detect';
import { InlineJobProgress } from '@/components/layout/JobActivity';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import {
  Alert,
  Badge,
  MetricList,
  SectionHeading,
} from '@/components/ui/display';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives';
import { DEMO_DATASETS } from '@/data/demoData';
import { useRecentJobs } from '@/state/jobStore';
import { useProjectStore } from '@/state/projectStore';
import { useSettingsStore } from '@/state/settingsStore';
import { estimateStorage } from '@/storage/db';
import type { SequenceType } from '@/types';
import { cn } from '@/utils/cn';
import {
  formatBytes,
  formatFileFormat,
  formatInteger,
  formatPercent,
  formatSequenceType,
} from '@/utils/format';

interface QueuedFile {
  file: File;
  forcedType: SequenceType;
}

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

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number; supported: boolean } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void estimateStorage().then(setStorage);
  }, [datasets.length]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).map((file) => ({
      file,
      forcedType: 'unknown' as SequenceType,
    }));
    setQueue((previous) => {
      const existing = new Set(previous.map((entry) => `${entry.file.name}:${entry.file.size}`));
      return [
        ...previous,
        ...incoming.filter((entry) => !existing.has(`${entry.file.name}:${entry.file.size}`)),
      ];
    });
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
    },
    [addFiles],
  );

  const startImport = async () => {
    if (queue.length === 0) return;
    setImporting(true);
    try {
      const imported = await importFiles(queue);
      setQueue([]);
      if (imported.length > 0) {
        selectDataset(imported[imported.length - 1].id);
        navigate('/qc');
      }
    } finally {
      setImporting(false);
    }
  };

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

  const runningImports = recentJobs.filter(
    (job) => job.kind === 'import' && job.status === 'running',
  );
  const failedImports = recentJobs.filter(
    (job) => job.kind === 'import' && job.status === 'error',
  );

  const totalQueuedBytes = queue.reduce((sum, entry) => sum + entry.file.size, 0);
  const largeFile = queue.find((entry) => entry.file.size > largeFileWarnMb * 1024 * 1024);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Import FASTA / FASTQ"
        description="Files are read directly from this device with the browser's own streaming APIs and never uploaded. Parsing happens in a background thread, so a multi-gigabyte file does not freeze the interface."
      />

      {/* Drop zone */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border bg-subtle',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <FileUp className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">
          Drop sequence files here, or choose them
        </p>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
          FASTA ({SUPPORTED_EXTENSIONS.filter((e) => !e.includes('gz') && e !== '.fastq' && e !== '.fq' && e !== '.txt').join(', ')}), FASTQ
          (.fastq, .fq), and gzipped versions of any of them. Format and molecule type are detected
          from the file contents.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => inputRef.current?.click()}>
            <Upload />
            Choose files
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadDemo(DEMO_DATASETS[0].id)}
            disabled={loadingDemo !== null}
          >
            <Sparkles />
            {loadingDemo !== null ? 'Loading…' : 'Try demo dataset'}
          </Button>
        </div>
      </div>

      {/* Staged files */}
      {queue.length > 0 ? (
        <Card>
          <CardHeaderRow
            title={`${formatInteger(queue.length)} file${queue.length === 1 ? '' : 's'} ready to import`}
            description={`${formatBytes(totalQueuedBytes)} total. Files are imported one at a time so peak memory stays bounded.`}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => setQueue([])} disabled={importing}>
                  Clear
                </Button>
                <Button size="sm" onClick={() => void startImport()} disabled={importing}>
                  {importing ? 'Importing…' : 'Start import'}
                </Button>
              </>
            }
          />
          <div className="divide-y divide-border border-t border-border">
            {queue.map((entry, index) => (
              <div key={`${entry.file.name}-${index}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-foreground">{entry.file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(entry.file.size)}
                    {entry.file.name.toLowerCase().endsWith('.gz')
                      ? ' compressed'
                      : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`type-${index}`} className="text-[11px] whitespace-nowrap">
                    Type
                  </Label>
                  <Select
                    value={entry.forcedType}
                    onValueChange={(value) =>
                      setQueue((previous) =>
                        previous.map((candidate, i) =>
                          i === index
                            ? { ...candidate, forcedType: value as SequenceType }
                            : candidate,
                        ),
                      )
                    }
                  >
                    <SelectTrigger id={`type-${index}`} className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Detect</SelectItem>
                      <SelectItem value="dna">DNA</SelectItem>
                      <SelectItem value="rna">RNA</SelectItem>
                      <SelectItem value="protein">Protein</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setQueue((previous) => previous.filter((_, i) => i !== index))}
                  disabled={importing}
                  aria-label={`Remove ${entry.file.name}`}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>

          {largeFile ? (
            <div className="border-t border-border px-4 py-3">
              <Alert variant="warning" title="Large file">
                <p>
                  <span className="font-mono">{largeFile.file.name}</span> is{' '}
                  {formatBytes(largeFile.file.size)}. SeqLens streams the file rather than loading
                  it, so parsing will work, but the residues are written to this browser&rsquo;s
                  IndexedDB and will occupy a comparable amount of disk.
                </p>
                <p className="mt-1">
                  {storage?.supported && storage.quota > 0
                    ? `This origin currently has about ${formatBytes(storage.quota - storage.usage)} of its storage quota left.`
                    : 'Check available disk space before importing.'}{' '}
                  Settings can cap the number of sequences imported if you only need a sample.
                </p>
              </Alert>
            </div>
          ) : null}
        </Card>
      ) : null}

      {runningImports.map((job) => (
        <InlineJobProgress
          key={job.id}
          job={job}
          onCancel={job.datasetId ? () => cancelImport(job.datasetId!) : undefined}
        />
      ))}

      {failedImports.length > 0 ? (
        <div className="space-y-2">
          {failedImports.map((job) => (
            <Alert key={job.id} variant="error" title={job.error?.message ?? 'Import failed'}>
              {job.error?.suggestion ? <p>{job.error.suggestion}</p> : null}
              {job.error?.location ? (
                <p className="mt-1 font-mono text-[11px]">{job.error.location}</p>
              ) : null}
              {job.error?.detail ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] hover:text-foreground">
                    Technical detail
                  </summary>
                  <p className="mt-1 font-mono text-[10px] break-words">{job.error.detail}</p>
                </details>
              ) : null}
            </Alert>
          ))}
        </div>
      ) : null}

      {/* Imported datasets */}
      {datasets.length > 0 ? (
        <Card>
          <CardHeaderRow
            title="Imported datasets"
            description="Everything recorded at import time, including how the molecule type was decided."
          />
          <div className="divide-y divide-border border-t border-border">
            {datasets.map((dataset) => (
              <div key={dataset.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => selectDataset(dataset.id)}
                      className="truncate font-mono text-xs font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {dataset.fileName}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant="outline">{formatFileFormat(dataset.format)}</Badge>
                      <Badge variant="outline">{formatSequenceType(dataset.sequenceType)}</Badge>
                      {dataset.gzipped ? <Badge variant="default">gzip</Badge> : null}
                      {dataset.qualityEncoding ? (
                        <Badge variant="default">
                          {dataset.qualityEncoding === 'phred64' ? 'Phred+64' : 'Phred+33'}
                        </Badge>
                      ) : null}
                      {dataset.truncated ? <Badge variant="warning">Truncated</Badge> : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void deleteDataset(dataset.id)}
                    aria-label={`Delete ${dataset.fileName}`}
                    title="Delete this dataset and its results from local storage"
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>

                <MetricList
                  columns={2}
                  rows={[
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
                  ]}
                />

                {dataset.typeDetectionNote ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Type detection:</span>{' '}
                    {dataset.typeDetectionNote}
                  </p>
                ) : null}

                {dataset.parseIssues.length > 0 ? (
                  <div className="space-y-1.5 rounded border border-border bg-subtle px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                      <AlertTriangle className="size-3 text-[#8a5f00]" aria-hidden />
                      Parser notes
                    </p>
                    <ul className="space-y-1">
                      {dataset.parseIssues.map((issue, i) => (
                        <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                          {issue.count > 1 ? (
                            <span className="font-medium text-foreground">
                              {formatInteger(issue.count)}x{' '}
                            </span>
                          ) : null}
                          {issue.message}
                          {issue.line ? (
                            <span className="ml-1 font-mono">(line {formatInteger(issue.line)})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Storage */}
      <Card>
        <CardHeaderRow
          title="Local storage"
          description="Sequence data is written to this browser's IndexedDB on this device only."
        />
        <div className="px-4 pb-4">
          {storage?.supported ? (
            <>
              <MetricList
                columns={2}
                rows={[
                  { label: 'Used by this origin', value: formatBytes(storage.usage) },
                  { label: 'Quota', value: formatBytes(storage.quota) },
                  {
                    label: 'Remaining',
                    value: formatBytes(Math.max(0, storage.quota - storage.usage)),
                  },
                  {
                    label: 'Utilisation',
                    value:
                      storage.quota > 0
                        ? formatPercent((storage.usage / storage.quota) * 100, 1)
                        : '-',
                  },
                ]}
              />
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <HardDrive className="mt-0.5 size-3 shrink-0" aria-hidden />
                Browsers deliberately report a padded estimate here to limit fingerprinting, so
                treat these figures as approximate. The quota is typically a percentage of free
                disk space.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This browser does not expose a storage estimate.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

const formatDecimalRatio = (numerator: number, denominator: number): string =>
  denominator === 0 ? '-' : (numerator / denominator).toFixed(1);
