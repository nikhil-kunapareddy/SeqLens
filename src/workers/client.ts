import type {
  JobError,
  JobKind,
  JobRequest,
  JobResultMap,
  MainToWorkerMessage,
  ProgressStage,
  WorkerToMainMessage,
} from '@/types';

export interface RunOptions {
  /** Called whenever the worker reports staged progress. */
  onProgress?: (stages: ProgressStage[]) => void;
  /** Cancels the job. Cancellation is cooperative inside the worker. */
  signal?: AbortSignal;
}

/** Thrown to the caller when a job fails, carrying the structured error. */
export class JobFailedError extends Error {
  readonly jobError: JobError;

  constructor(jobError: JobError) {
    super(jobError.message);
    this.name = 'JobFailedError';
    this.jobError = jobError;
  }
}

/** Thrown when a job is cancelled, so callers can distinguish it from failure. */
export class JobCancelled extends Error {
  constructor() {
    super('Analysis was cancelled.');
    this.name = 'JobCancelled';
  }
}

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (stages: ProgressStage[]) => void;
  cleanup: () => void;
  workerSlot: WorkerSlot;
}

interface WorkerSlot {
  worker: Worker;
  /** Job ids currently assigned to this worker. */
  load: Set<string>;
}

/**
 * Worker pool and job dispatcher.
 *
 * Several workers rather than one, because the modules are genuinely
 * independent: a user can leave a similarity matrix building while running QC
 * on a second dataset, and serialising those onto one worker would make the
 * second wait for the first with no benefit.
 *
 * The pool is capped well below `hardwareConcurrency`. Each worker holds its
 * own copy of whatever block it is processing plus its accumulators, so memory
 * - not CPU - is the binding constraint, and the browser tab has a single heap
 * budget shared across all of them.
 *
 * Workers are created lazily on first use. That keeps the initial page load
 * free of worker startup and module evaluation for a user who is only reading
 * the landing page.
 */
class WorkerPool {
  private slots: WorkerSlot[] = [];
  private readonly pending = new Map<string, PendingJob>();
  private nextJobId = 0;
  private readonly maxWorkers: number;

  constructor() {
    const cores =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 4;
    this.maxWorkers = Math.max(1, Math.min(3, cores - 1));
  }

  /** True when the environment supports module workers at all. */
  static get supported(): boolean {
    return typeof Worker !== 'undefined';
  }

  private spawn(): WorkerSlot {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
      type: 'module',
      name: `seqlens-analysis-${this.slots.length}`,
    });

    const slot: WorkerSlot = { worker, load: new Set() };

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleMessage(event.data);
    };

    // A worker-level error means the worker itself died: every job assigned to
    // it is unrecoverable, so they are all failed rather than left hanging.
    worker.onerror = (event) => {
      const error: JobError = {
        code: 'worker-crashed',
        message: 'The analysis worker stopped unexpectedly.',
        suggestion:
          'Re-run the analysis. If it keeps happening, the dataset may be too large for this browser tab; try reducing the sequence limit in Settings.',
        detail: event.message,
      };
      for (const jobId of [...slot.load]) {
        this.failJob(jobId, error);
      }
      // Replace the dead worker so the next job gets a fresh one.
      this.slots = this.slots.filter((candidate) => candidate !== slot);
      worker.terminate();
    };

    this.slots.push(slot);
    return slot;
  }

  /** Least-loaded worker, spawning a new one while below the cap. */
  private acquire(): WorkerSlot {
    if (this.slots.length < this.maxWorkers) {
      const idle = this.slots.find((slot) => slot.load.size === 0);
      if (idle) return idle;
      return this.spawn();
    }
    return this.slots.reduce((best, slot) => (slot.load.size < best.load.size ? slot : best));
  }

  private handleMessage(message: WorkerToMainMessage): void {
    const job = this.pending.get(message.jobId);
    if (!job) return;

    switch (message.type) {
      case 'progress':
        job.onProgress?.(message.stages);
        return;
      case 'done':
        job.cleanup();
        this.pending.delete(message.jobId);
        job.workerSlot.load.delete(message.jobId);
        job.resolve(message.payload);
        return;
      case 'error':
        job.cleanup();
        this.pending.delete(message.jobId);
        job.workerSlot.load.delete(message.jobId);
        job.reject(new JobFailedError(message.error));
        return;
      case 'cancelled':
        job.cleanup();
        this.pending.delete(message.jobId);
        job.workerSlot.load.delete(message.jobId);
        job.reject(new JobCancelled());
        return;
    }
  }

  private failJob(jobId: string, error: JobError): void {
    const job = this.pending.get(jobId);
    if (!job) return;
    job.cleanup();
    this.pending.delete(jobId);
    job.workerSlot.load.delete(jobId);
    job.reject(new JobFailedError(error));
  }

  run<K extends JobKind>(
    request: Extract<JobRequest, { kind: K }>,
    options: RunOptions = {},
  ): Promise<JobResultMap[K]> {
    if (!WorkerPool.supported) {
      return Promise.reject(
        new JobFailedError({
          code: 'internal',
          message: 'This browser does not support Web Workers.',
          suggestion:
            'SeqLens runs all analysis in a background thread to keep the interface responsive. Use a current version of Chrome, Edge, Firefox, or Safari.',
        }),
      );
    }

    const jobId = `job_${(this.nextJobId += 1)}`;
    const slot = this.acquire();
    slot.load.add(jobId);

    return new Promise<JobResultMap[K]>((resolve, reject) => {
      const onAbort = () => {
        const message: MainToWorkerMessage = { type: 'cancel', jobId };
        slot.worker.postMessage(message);
      };

      if (options.signal?.aborted) {
        slot.load.delete(jobId);
        reject(new JobCancelled());
        return;
      }
      options.signal?.addEventListener('abort', onAbort);

      this.pending.set(jobId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
        cleanup: () => options.signal?.removeEventListener('abort', onAbort),
        workerSlot: slot,
      });

      const message: MainToWorkerMessage = { type: 'start', jobId, request };
      slot.worker.postMessage(message);
    });
  }

  /** Cancels every in-flight job. Used when navigating away from a dataset. */
  cancelAll(): void {
    for (const [jobId, job] of this.pending) {
      const message: MainToWorkerMessage = { type: 'cancel', jobId };
      job.workerSlot.worker.postMessage(message);
    }
  }

  get stats(): { workers: number; maxWorkers: number; running: number } {
    return {
      workers: this.slots.length,
      maxWorkers: this.maxWorkers,
      running: this.pending.size,
    };
  }

  /** Tears the pool down. Only used by tests and by full data deletion. */
  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.pending.clear();
  }
}

export const workerPool = new WorkerPool();

/** Convenience wrapper so callers read as `runJob({ kind: 'qc', ... })`. */
export function runJob<K extends JobKind>(
  request: Extract<JobRequest, { kind: K }>,
  options?: RunOptions,
): Promise<JobResultMap[K]> {
  return workerPool.run(request, options);
}
