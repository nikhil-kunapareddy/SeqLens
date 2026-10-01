import { AlertTriangle, Database, FolderPlus, Play, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InlineJobProgress } from '@/components/layout/JobActivity';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, SectionHeading } from '@/components/ui/display';
import {
  selectError,
  selectIsRunning,
  selectStoredResult,
  useAnalysisStore,
} from '@/state/analysisStore';
import { selectJobForDataset, useJobStore } from '@/state/jobStore';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { JOB_FOR_KIND, type AnalysisKind, type AnalysisResult, type Dataset } from '@/types';
import { formatDuration, formatRelativeTime } from '@/utils/format';

export interface AnalysisGateProps<T extends AnalysisResult> {
  kind: AnalysisKind;
  title: string;
  /** One paragraph describing what the module computes. */
  description: ReactNode;
  /** Controls rendered next to the run button. */
  configPanel?: ReactNode;
  /** Extra header actions, shown once a result exists. */
  actions?: ReactNode;
  /** Sequence indices, required by the alignment module. */
  sequenceIndices?: number[];
  /** Blocks the run button with an explanation, e.g. wrong sequence type. */
  unavailable?: { reason: string; suggestion?: ReactNode } | null;
  /** Rendered once a result is available. */
  children: (result: T, dataset: Dataset) => ReactNode;
}

/**
 * Shared scaffolding for the six analysis pages.
 *
 * Every module has the same five states - no project, no dataset, not yet run,
 * running, failed - and the same affordances: a run button, a cancel control,
 * a re-run that bypasses the cache, and a line saying when the shown result was
 * computed. Implementing that once means the states behave identically
 * everywhere, and a page is left to describe only its own results.
 */
export function AnalysisGate<T extends AnalysisResult>({
  kind,
  title,
  description,
  configPanel,
  actions,
  sequenceIndices,
  unavailable,
  children,
}: AnalysisGateProps<T>) {
  const project = useProjectStore(selectActiveProject);
  const dataset = useProjectStore(selectActiveDataset);
  const config = useProjectStore(selectActiveConfig);

  const stored = useAnalysisStore((state) => selectStoredResult(state, dataset?.id ?? null, kind));
  const running = useAnalysisStore((state) => selectIsRunning(state, dataset?.id ?? null, kind));
  const error = useAnalysisStore((state) => selectError(state, dataset?.id ?? null, kind));
  const run = useAnalysisStore((state) => state.run);
  const cancel = useAnalysisStore((state) => state.cancel);
  const dismissError = useAnalysisStore((state) => state.dismissError);

  const job = useJobStore((state) =>
    selectJobForDataset(state, dataset?.id ?? null, JOB_FOR_KIND[kind]),
  );

  if (project === null) {
    return (
      <div className="space-y-4">
        <SectionHeading title={title} description={description} />
        <EmptyState
          icon={FolderPlus}
          title="No project yet"
          description="Analysis needs a project to hold the dataset and its results. Create one, or import a file and SeqLens will create a project for it."
          actions={
            <>
              <Button size="sm" asChild>
                <Link to="/import">Import FASTA / FASTQ</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/projects">Create a project</Link>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  if (dataset === null) {
    return (
      <div className="space-y-4">
        <SectionHeading title={title} description={description} />
        <EmptyState
          icon={Database}
          title={`"${project.name}" has no datasets`}
          description="Import a FASTA or FASTQ file, or load one of the built-in demo datasets, to run this analysis."
          actions={
            <Button size="sm" asChild>
              <Link to="/import">Import a file</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const execute = (force: boolean) => {
    void run({
      projectId: project.id,
      datasetId: dataset.id,
      kind,
      config,
      sequenceIndices,
      force,
    });
  };

  const runControls = unavailable ? null : (
    <div className="flex items-center gap-2">
      {running ? (
        <Button size="sm" variant="outline" onClick={() => cancel(dataset.id, kind)}>
          Cancel
        </Button>
      ) : stored ? (
        <Button size="sm" variant="outline" onClick={() => execute(true)}>
          <RefreshCw />
          Re-run
        </Button>
      ) : (
        <Button size="sm" onClick={() => execute(false)}>
          <Play />
          Run analysis
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <SectionHeading
        title={title}
        description={description}
        actions={
          <>
            {stored ? actions : null}
            {runControls}
          </>
        }
      />

      {unavailable ? (
        <Alert variant="warning" title="This analysis does not apply to the selected dataset">
          <p>{unavailable.reason}</p>
          {unavailable.suggestion ? <div className="mt-1.5">{unavailable.suggestion}</div> : null}
        </Alert>
      ) : null}

      {configPanel}

      {error ? (
        <Alert
          variant="error"
          title={error.message}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => execute(true)}>
                Try again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dismissError(dataset.id, kind)}
              >
                Dismiss
              </Button>
            </>
          }
        >
          {error.suggestion ? <p>{error.suggestion}</p> : null}
          {error.location ? (
            <p className="mt-1 font-mono text-[11px]">{error.location}</p>
          ) : null}
          {error.detail ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] hover:text-foreground">
                Technical detail
              </summary>
              <p className="mt-1 font-mono text-[10px] break-words">{error.detail}</p>
            </details>
          ) : null}
        </Alert>
      ) : null}

      {running && job ? (
        <InlineJobProgress job={job} onCancel={() => cancel(dataset.id, kind)} />
      ) : null}

      {stored ? (
        <>
          <ResultProvenance
            computedAt={stored.computedAt}
            durationMs={stored.durationMs}
            configHash={stored.configHash}
            stale={running}
          />
          <div className={running ? 'pointer-events-none opacity-60' : undefined}>
            {children(stored.result as T, dataset)}
          </div>
        </>
      ) : !running && !unavailable && !error ? (
        <EmptyState
          icon={Play}
          title="Not run yet"
          description={
            <>
              This analysis has not been run for{' '}
              <span className="font-mono">{dataset.fileName}</span>. It runs in a background
              thread on this device and the result is cached against the current configuration, so
              re-opening this page will not recompute it.
            </>
          }
          actions={
            <Button size="sm" onClick={() => execute(false)}>
              <Play />
              Run analysis
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Provenance line for a displayed result.
 *
 * States when the result was computed, how long it took, and the fingerprint of
 * the configuration that produced it. Without this, a cached result is
 * indistinguishable from a fresh one, and a reader cannot tell whether the
 * numbers reflect the thresholds currently shown in the panel.
 */
export function ResultProvenance({
  computedAt,
  durationMs,
  configHash,
  stale,
}: {
  computedAt: number;
  durationMs: number;
  configHash: string;
  stale?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-subtle px-3 py-1.5 text-[11px] text-muted-foreground">
      {stale ? (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <AlertTriangle className="size-3" aria-hidden />
          Recomputing &mdash; values below are from the previous run
        </span>
      ) : (
        <span>
          Computed {formatRelativeTime(computedAt)} in {formatDuration(durationMs)}
        </span>
      )}
      <span className="font-mono">config {configHash.slice(0, 8)}</span>
    </div>
  );
}

/** Notes panel shared by every module's result view. */
export function AnalysisNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Alert variant="info" title="How to read these numbers">
      <ul className="list-disc space-y-1 pl-4">
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
    </Alert>
  );
}
