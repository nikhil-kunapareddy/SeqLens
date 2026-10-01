import type { JobError, JobErrorCode, ProgressStage } from '@/types';

/** Thrown when a job observes that it has been cancelled. */
export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled.`);
    this.name = 'JobCancelledError';
  }
}

/**
 * A failure phrased for the person reading it.
 *
 * A scientist looking at "Cannot read properties of undefined" learns nothing
 * about their data. Every failure path in the worker raises this instead, with
 * a statement of what happened, where, and what to try - and keeps the
 * technical detail available behind a disclosure for when it is actually
 * needed.
 */
export class AnalysisError extends Error {
  readonly code: JobErrorCode;
  readonly suggestion?: string;
  readonly location?: string;
  readonly detail?: string;

  constructor(init: {
    code: JobErrorCode;
    message: string;
    suggestion?: string;
    location?: string;
    detail?: string;
  }) {
    super(init.message);
    this.name = 'AnalysisError';
    this.code = init.code;
    this.suggestion = init.suggestion;
    this.location = init.location;
    this.detail = init.detail;
  }

  toJobError(): JobError {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      location: this.location,
      detail: this.detail,
    };
  }
}

/**
 * Converts any thrown value into a structured, readable job error.
 *
 * The browser's own out-of-memory and quota errors are recognised explicitly,
 * because those are the two failures a large import is most likely to hit and
 * the native messages ("The quota has been exceeded.") do not tell the user
 * that the fix is to import fewer sequences.
 */
export function toJobError(error: unknown): JobError {
  if (error instanceof AnalysisError) return error.toJobError();

  if (error instanceof JobCancelledError) {
    return { code: 'cancelled', message: 'Analysis was cancelled.' };
  }

  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return {
        code: 'out-of-memory',
        message: 'The browser ran out of storage space while writing this dataset.',
        suggestion:
          'Delete a project you no longer need, or set a sequence limit in Settings before re-importing. Browsers typically allow a few percent of free disk space per site.',
        detail: `${error.name}: ${error.message}`,
      };
    }
    if (error.name === 'AbortError') {
      return { code: 'cancelled', message: 'Analysis was cancelled.' };
    }
    if (error.name === 'DataError' || error.name === 'DataCloneError') {
      return {
        code: 'internal',
        message: 'A result could not be saved to local storage.',
        suggestion: 'Re-run the analysis. If it keeps failing, the browser profile may be corrupted.',
        detail: `${error.name}: ${error.message}`,
      };
    }
  }

  if (error instanceof RangeError) {
    return {
      code: 'out-of-memory',
      message: 'This analysis needed more memory than the browser tab allows.',
      suggestion:
        'Reduce the sequence limit or the k-mer size in Settings, or analyse a smaller subset. Browser tabs are typically capped at 2-4 GB regardless of how much RAM the machine has.',
      detail: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'internal',
    message: 'The analysis failed unexpectedly.',
    suggestion: 'Re-run it; if the failure repeats, the dataset may contain something unusual.',
    detail: message,
  };
}

/**
 * Per-job services: staged progress reporting and cooperative cancellation.
 *
 * Cancellation is cooperative because the alternative - terminating the worker
 * - loses every other job queued on it and cannot run cleanup. Jobs call
 * `checkCancelled` at chunk boundaries, which is frequent enough to feel
 * immediate and rare enough to cost nothing.
 */
export class JobContext {
  readonly jobId: string;
  private readonly stages = new Map<string, ProgressStage>();
  private readonly order: string[] = [];
  private lastPostAt = 0;
  private cancelled = false;
  private readonly post: (stages: ProgressStage[]) => void;

  /** Minimum interval between progress messages, in milliseconds. */
  private readonly throttleMs: number;

  constructor(jobId: string, post: (stages: ProgressStage[]) => void, throttleMs = 80) {
    this.jobId = jobId;
    this.post = post;
    this.throttleMs = throttleMs;
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  checkCancelled(): void {
    if (this.cancelled) throw new JobCancelledError(this.jobId);
  }

  /**
   * Records a stage's progress and posts an update if the throttle allows.
   *
   * Posting on every chunk of a million-sequence file would flood the main
   * thread with messages it cannot paint. Throttling to ~12 updates a second
   * keeps the bars smooth without the message queue becoming the bottleneck.
   */
  report(stage: ProgressStage, force = false): void {
    if (!this.stages.has(stage.id)) this.order.push(stage.id);
    this.stages.set(stage.id, stage);

    const now = Date.now();
    if (!force && now - this.lastPostAt < this.throttleMs) return;
    this.lastPostAt = now;
    this.flush();
  }

  /** Marks a stage complete and posts immediately. */
  complete(id: string, label: string, detail?: string): void {
    this.report({ id, label, value: 1, detail }, true);
  }

  flush(): void {
    this.post(this.order.map((id) => this.stages.get(id)!).filter(Boolean));
  }
}
