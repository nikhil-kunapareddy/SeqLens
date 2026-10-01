import { Activity, CheckCircle2, ChevronDown, Loader2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Progress } from '@/components/ui/primitives';
import { jobOverallProgress, useJobStore, useRecentJobs, useRunningJobs } from '@/state/jobStore';
import type { JobState, ProgressStage } from '@/types';
import { cn } from '@/utils/cn';
import { useElapsed } from '@/utils/debounce';
import { formatDuration } from '@/utils/format';

/**
 * Header activity indicator and progress panel.
 *
 * Analyses run in background workers, so progress has to be visible from
 * wherever the user navigates to next - not only on the page that started it.
 * The panel lists each job's stages with their own bars, because a single
 * blended percentage hides which part of a multi-stage analysis is slow.
 */
export function JobActivity() {
  const running = useRunningJobs();
  const recent = useRecentJobs();
  const clearFinished = useJobStore((state) => state.clearFinished);
  const [open, setOpen] = useState(false);

  const busy = running.length > 0;
  const failures = recent.filter((job) => job.status === 'error').length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={busy ? 'subtle' : 'ghost'}
          size="sm"
          className="gap-1.5"
          aria-label={busy ? `${running.length} analyses running` : 'Analysis activity'}
        >
          {busy ? (
            <Loader2 className="animate-spin text-primary" />
          ) : failures > 0 ? (
            <XCircle className="text-destructive" />
          ) : (
            <Activity />
          )}
          <span className="hidden sm:inline">
            {busy ? `${running.length} running` : 'Activity'}
          </span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Analysis activity</p>
          {recent.some((job) => job.status !== 'running') ? (
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={clearFinished}>
              Clear finished
            </Button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No analyses have run yet in this session.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((job) => (
                <li key={job.id} className="px-3 py-2.5">
                  <JobRow job={job} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function JobRow({ job }: { job: JobState }) {
  const dismiss = useJobStore((state) => state.dismiss);
  const overall = jobOverallProgress(job);
  // Ticked through state rather than read during render, so the duration
  // actually counts up and render stays a pure function of state.
  const elapsed = useElapsed(job.startedAt, job.status === 'running');

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{job.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {job.status === 'running'
              ? `running for ${formatDuration(elapsed)}`
              : job.finishedAt
                ? `${job.status} in ${formatDuration(job.finishedAt - job.startedAt)}`
                : job.status}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {job.status === 'done' ? (
            <CheckCircle2 className="size-3.5 text-[#067506]" aria-hidden />
          ) : null}
          {job.status === 'error' ? (
            <XCircle className="size-3.5 text-destructive" aria-hidden />
          ) : null}
          {job.status === 'cancelled' ? <Badge variant="neutral">Cancelled</Badge> : null}
          {job.status !== 'running' ? (
            <button
              type="button"
              onClick={() => dismiss(job.id)}
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {job.status === 'running' ? (
        <div className="space-y-1.5">
          {job.stages.length === 0 ? (
            <Progress indeterminate aria-label="Starting" />
          ) : (
            job.stages.map((stage) => <StageBar key={stage.id} stage={stage} />)
          )}
          {overall !== null && job.stages.length > 1 ? (
            <p className="tabular text-right text-[10px] text-muted-foreground">
              {Math.round(overall * 100)}% overall
            </p>
          ) : null}
        </div>
      ) : null}

      {job.error ? (
        <div className="rounded border border-destructive/25 bg-destructive/6 px-2 py-1.5">
          <p className="text-[11px] leading-relaxed text-foreground">{job.error.message}</p>
          {job.error.suggestion ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {job.error.suggestion}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One labelled progress bar.
 *
 * The label sits above the bar with the percentage right-aligned on the same
 * line, which is the layout that reads as a progress list rather than a stack
 * of anonymous bars.
 */
export function StageBar({ stage, className }: { stage: ProgressStage; className?: string }) {
  const percent = stage.value === null ? null : Math.round(stage.value * 100);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">{stage.label}</span>
        <span className="tabular shrink-0 text-[11px] font-medium text-foreground">
          {percent === null ? '' : `${percent}%`}
        </span>
      </div>
      <Progress
        value={percent ?? 0}
        indeterminate={percent === null}
        aria-label={stage.label}
      />
      {stage.detail ? (
        <p className="tabular truncate text-[10px] text-muted-foreground">{stage.detail}</p>
      ) : null}
    </div>
  );
}

/**
 * Inline progress panel for a page that started an analysis.
 *
 * Shown in place of the results while a job runs, with a cancel control. This
 * is the ASCII-style staged readout the interface promises: each stage of a
 * multi-part analysis gets its own bar and its own detail line.
 */
export function InlineJobProgress({
  job,
  onCancel,
  className,
}: {
  job: JobState;
  onCancel?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          <p className="text-xs font-medium text-foreground">{job.label}</p>
        </div>
        {onCancel ? (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {job.stages.length === 0 ? (
          <Progress indeterminate aria-label="Starting analysis" />
        ) : (
          job.stages.map((stage) => <StageBar key={stage.id} stage={stage} />)
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Running in a background thread, so the interface stays responsive. You can navigate to
        another page and come back; progress is tracked in the activity panel.
      </p>
    </div>
  );
}
