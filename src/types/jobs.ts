/**
 * Message protocol shared by the main thread and the analysis workers.
 *
 * The protocol is deliberately explicit rather than using an RPC wrapper: every
 * long-running job reports staged progress and can be cancelled, and those two
 * requirements are easier to reason about with hand-written message types.
 */

import type {
  AlignmentConfig,
  AlignmentResult,
  AnalysisKind,
  CompositionConfig,
  CompositionResult,
  Dataset,
  DatasetProfile,
  EmbeddingConfig,
  EmbeddingResult,
  ImportConfig,
  OrfConfig,
  OrfResult,
  QCResult,
  QCThresholds,
  SequenceIndex,
  SimilarityConfig,
  SimilarityResult,
} from './core';

/** One labelled progress bar within a job. */
export interface ProgressStage {
  id: string;
  label: string;
  /** 0..1, or null when the total is not yet known. */
  value: number | null;
  /** Optional detail line, e.g. "182,400 / 500,000 sequences". */
  detail?: string;
}

export type JobKind =
  | 'import'
  | 'qc'
  | 'composition'
  | 'similarity'
  | 'orf'
  | 'translate'
  | 'alignment'
  | 'embedding';

export interface ImportJobRequest {
  kind: 'import';
  datasetId: string;
  projectId: string;
  file: File;
  config: ImportConfig;
  /** Overrides automatic detection when the user selects a type manually. */
  forcedType?: 'dna' | 'rna' | 'protein';
}

export interface ImportJobResult {
  dataset: Dataset;
  index: SequenceIndex;
  profile: DatasetProfile;
}

export interface QCJobRequest {
  kind: 'qc';
  datasetId: string;
  thresholds: QCThresholds;
}

export interface CompositionJobRequest {
  kind: 'composition';
  datasetId: string;
  config: CompositionConfig;
  /** Cap on sequences visited; 0 means visit all. */
  maxSequences: number;
}

export interface SimilarityJobRequest {
  kind: 'similarity';
  datasetId: string;
  config: SimilarityConfig;
}

export interface OrfJobRequest {
  kind: 'orf';
  datasetId: string;
  config: OrfConfig;
}

export interface TranslateJobRequest {
  kind: 'translate';
  datasetId: string;
  sequenceIndex: number;
  config: OrfConfig;
}

export interface TranslateJobResult {
  sequenceId: string;
  length: number;
  frames: {
    strand: '+' | '-';
    frame: 1 | 2 | 3;
    protein: string;
    stopCount: number;
    longestStretch: number;
  }[];
  orfs: OrfResult['orfs'];
}

export interface AlignmentJobRequest {
  kind: 'alignment';
  datasetId: string;
  /** Sequence indices to align. Two indices run a pairwise alignment. */
  sequenceIndices: number[];
  config: AlignmentConfig;
}

export interface EmbeddingJobRequest {
  kind: 'embedding';
  datasetId: string;
  config: EmbeddingConfig;
}

export type JobRequest =
  | ImportJobRequest
  | QCJobRequest
  | CompositionJobRequest
  | SimilarityJobRequest
  | OrfJobRequest
  | TranslateJobRequest
  | AlignmentJobRequest
  | EmbeddingJobRequest;

export interface JobResultMap {
  import: ImportJobResult;
  qc: QCResult;
  composition: CompositionResult;
  similarity: SimilarityResult;
  orf: OrfResult;
  translate: TranslateJobResult;
  alignment: AlignmentResult;
  embedding: EmbeddingResult;
}

/* ----------------------------- wire messages ------------------------------ */

export interface WorkerStartMessage {
  type: 'start';
  jobId: string;
  request: JobRequest;
}

export interface WorkerCancelMessage {
  type: 'cancel';
  jobId: string;
}

export type MainToWorkerMessage = WorkerStartMessage | WorkerCancelMessage;

export interface WorkerProgressMessage {
  type: 'progress';
  jobId: string;
  stages: ProgressStage[];
}

export interface WorkerDoneMessage {
  type: 'done';
  jobId: string;
  payload: unknown;
  durationMs: number;
}

/** Structured, scientist-readable failure. */
export interface WorkerErrorMessage {
  type: 'error';
  jobId: string;
  error: JobError;
}

export interface WorkerCancelledMessage {
  type: 'cancelled';
  jobId: string;
}

export type WorkerToMainMessage =
  | WorkerProgressMessage
  | WorkerDoneMessage
  | WorkerErrorMessage
  | WorkerCancelledMessage;

export type JobErrorCode =
  | 'unsupported-format'
  | 'empty-file'
  | 'malformed-record'
  | 'decompression-failed'
  | 'out-of-memory'
  | 'dataset-missing'
  | 'too-large'
  | 'wrong-sequence-type'
  | 'no-data'
  | 'provider-unavailable'
  | 'worker-crashed'
  | 'cancelled'
  | 'internal';

/**
 * An error phrased for a scientist rather than a stack trace: what happened,
 * what it means for the data, and what to try next.
 */
export interface JobError {
  code: JobErrorCode;
  /** One-line summary shown in the UI. */
  message: string;
  /** What the user can do about it. */
  suggestion?: string;
  /** Where in the input the problem occurred, when known. */
  location?: string;
  /** Underlying technical detail, shown behind a disclosure. */
  detail?: string;
}

export interface JobState {
  id: string;
  kind: JobKind;
  datasetId?: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  stages: ProgressStage[];
  startedAt: number;
  finishedAt?: number;
  error?: JobError;
}

/** Maps an analysis kind to the job that produces it. */
export const JOB_FOR_KIND: Record<AnalysisKind, JobKind> = {
  qc: 'qc',
  composition: 'composition',
  similarity: 'similarity',
  orf: 'orf',
  alignment: 'alignment',
  embedding: 'embedding',
};
