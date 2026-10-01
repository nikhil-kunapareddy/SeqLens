import { create } from 'zustand';
import { configHash, resultRepository } from '@/storage';
import { JobCancelled, JobFailedError, runJob } from '@/workers/client';
import type {
  AlignmentResult,
  AnalysisConfig,
  AnalysisKind,
  AnalysisResult,
  CompositionResult,
  EmbeddingResult,
  JobError,
  OrfResult,
  QCResult,
  SimilarityResult,
  StoredResult,
} from '@/types';
import { useJobStore } from './jobStore';

type ResultKey = string;

const key = (datasetId: string, kind: AnalysisKind): ResultKey => `${datasetId}:${kind}`;

export interface RunAnalysisInput {
  projectId: string;
  datasetId: string;
  kind: AnalysisKind;
  config: AnalysisConfig;
  /** Sequence indices, required for alignment. */
  sequenceIndices?: number[];
  /** Skip the stored-result cache and recompute. */
  force?: boolean;
}

interface AnalysisStoreState {
  /** Results in memory, keyed by dataset and kind. */
  results: Record<ResultKey, StoredResult>;
  /** Kinds currently running, keyed the same way. */
  running: Record<ResultKey, string>;
  errors: Record<ResultKey, JobError>;
  controllers: Record<ResultKey, AbortController>;
  /** True while a stored result is being read back from IndexedDB. */
  hydrating: Record<ResultKey, boolean>;

  hydrate: (datasetId: string, kinds?: AnalysisKind[]) => Promise<void>;
  run: (input: RunAnalysisInput) => Promise<AnalysisResult | null>;
  cancel: (datasetId: string, kind: AnalysisKind) => void;
  clear: (datasetId: string, kind?: AnalysisKind) => void;
  dismissError: (datasetId: string, kind: AnalysisKind) => void;
}

const JOB_LABELS: Record<AnalysisKind, string> = {
  qc: 'Quality control',
  composition: 'Composition and k-mers',
  similarity: 'Similarity and clustering',
  orf: 'ORF detection',
  alignment: 'Sequence alignment',
  embedding: 'Sequence embedding',
};

/**
 * Analysis results, with a persistent cache keyed by configuration.
 *
 * A stored result is reused only when the configuration hash matches, so
 * changing a threshold re-runs the analysis while revisiting a page does not.
 * That is what makes results reproducible: the hash is derived from the exact
 * configuration that produced them, and both are written together.
 */
export const useAnalysisStore = create<AnalysisStoreState>()((set, get) => ({
  results: {},
  running: {},
  errors: {},
  controllers: {},
  hydrating: {},

  /** Loads previously computed results for a dataset from IndexedDB. */
  async hydrate(datasetId, kinds = ['qc', 'composition', 'similarity', 'orf', 'alignment', 'embedding']) {
    set((state) => {
      const hydrating = { ...state.hydrating };
      for (const kind of kinds) hydrating[key(datasetId, kind)] = true;
      return { hydrating };
    });

    const loaded = await Promise.all(
      kinds.map(async (kind) => ({ kind, stored: await resultRepository.getLatest(datasetId, kind) })),
    );

    set((state) => {
      const results = { ...state.results };
      const hydrating = { ...state.hydrating };
      for (const { kind, stored } of loaded) {
        const resultKey = key(datasetId, kind);
        hydrating[resultKey] = false;
        if (stored) results[resultKey] = stored;
      }
      return { results, hydrating };
    });
  },

  async run(input) {
    const { projectId, datasetId, kind, config, force } = input;
    const resultKey = key(datasetId, kind);

    // Only the slice of configuration this analysis reads goes into the hash,
    // so tweaking an unrelated module's settings does not invalidate the cache.
    const relevantConfig = configSliceFor(kind, config, input.sequenceIndices);
    const hash = configHash(relevantConfig);

    if (!force) {
      const inMemory = get().results[resultKey];
      if (inMemory && inMemory.configHash === hash) return inMemory.result;

      const stored = await resultRepository.get(datasetId, kind, hash);
      if (stored) {
        set((state) => ({ results: { ...state.results, [resultKey]: stored } }));
        return stored.result;
      }
    }

    const jobId = `${kind}_${datasetId}_${Date.now()}`;
    const controller = new AbortController();
    const jobStore = useJobStore.getState();

    set((state) => {
      const errors = { ...state.errors };
      delete errors[resultKey];
      return {
        running: { ...state.running, [resultKey]: jobId },
        controllers: { ...state.controllers, [resultKey]: controller },
        errors,
      };
    });

    jobStore.start({ id: jobId, kind, label: JOB_LABELS[kind], datasetId });

    try {
      const result = await executeJob(input, controller, jobId);
      const startedAt = useJobStore.getState().jobs[jobId]?.startedAt ?? Date.now();

      const stored = await resultRepository.save({
        projectId,
        datasetId,
        kind,
        configHash: hash,
        durationMs: Date.now() - startedAt,
        result,
      });

      useJobStore.getState().finish(jobId);
      set((state) => {
        const running = { ...state.running };
        const controllers = { ...state.controllers };
        delete running[resultKey];
        delete controllers[resultKey];
        return { results: { ...state.results, [resultKey]: stored }, running, controllers };
      });
      return result;
    } catch (error) {
      const jobError: JobError =
        error instanceof JobFailedError
          ? error.jobError
          : error instanceof JobCancelled
            ? { code: 'cancelled', message: 'Analysis was cancelled.' }
            : {
                code: 'internal',
                message: `${JOB_LABELS[kind]} failed.`,
                detail: error instanceof Error ? error.message : String(error),
              };

      if (error instanceof JobCancelled) useJobStore.getState().cancel(jobId);
      else useJobStore.getState().fail(jobId, jobError);

      set((state) => {
        const running = { ...state.running };
        const controllers = { ...state.controllers };
        delete running[resultKey];
        delete controllers[resultKey];
        return {
          running,
          controllers,
          errors:
            jobError.code === 'cancelled'
              ? state.errors
              : { ...state.errors, [resultKey]: jobError },
        };
      });
      return null;
    }
  },

  cancel(datasetId, kind) {
    get().controllers[key(datasetId, kind)]?.abort();
  },

  clear(datasetId, kind) {
    set((state) => {
      const results = { ...state.results };
      const errors = { ...state.errors };
      if (kind) {
        delete results[key(datasetId, kind)];
        delete errors[key(datasetId, kind)];
      } else {
        for (const resultKey of Object.keys(results)) {
          if (resultKey.startsWith(`${datasetId}:`)) delete results[resultKey];
        }
        for (const resultKey of Object.keys(errors)) {
          if (resultKey.startsWith(`${datasetId}:`)) delete errors[resultKey];
        }
      }
      return { results, errors };
    });
  },

  dismissError(datasetId, kind) {
    set((state) => {
      const errors = { ...state.errors };
      delete errors[key(datasetId, kind)];
      return { errors };
    });
  },
}));

/** Dispatches the right worker job for an analysis kind. */
async function executeJob(
  input: RunAnalysisInput,
  controller: AbortController,
  jobId: string,
): Promise<AnalysisResult> {
  const { datasetId, kind, config } = input;
  const options = {
    signal: controller.signal,
    onProgress: (stages: Parameters<ReturnType<typeof useJobStore.getState>['progress']>[1]) =>
      useJobStore.getState().progress(jobId, stages),
  };

  switch (kind) {
    case 'qc':
      return runJob({ kind: 'qc', datasetId, thresholds: config.qc }, options);
    case 'composition':
      return runJob(
        {
          kind: 'composition',
          datasetId,
          config: config.composition,
          maxSequences: 0,
        },
        options,
      );
    case 'similarity':
      return runJob({ kind: 'similarity', datasetId, config: config.similarity }, options);
    case 'orf':
      return runJob({ kind: 'orf', datasetId, config: config.orf }, options);
    case 'alignment':
      return runJob(
        {
          kind: 'alignment',
          datasetId,
          sequenceIndices: input.sequenceIndices ?? [],
          config: config.alignment,
        },
        options,
      );
    case 'embedding':
      return runJob({ kind: 'embedding', datasetId, config: config.embedding }, options);
  }
}

/** The configuration slice that actually affects a given analysis. */
function configSliceFor(
  kind: AnalysisKind,
  config: AnalysisConfig,
  sequenceIndices?: number[],
): unknown {
  switch (kind) {
    case 'qc':
      return config.qc;
    case 'composition':
      return config.composition;
    case 'similarity':
      return config.similarity;
    case 'orf':
      return config.orf;
    case 'alignment':
      return { ...config.alignment, sequenceIndices: [...(sequenceIndices ?? [])].sort((a, b) => a - b) };
    case 'embedding':
      return config.embedding;
  }
}

/* ------------------------------- selectors -------------------------------- */

const getResult = <T extends AnalysisResult>(
  state: AnalysisStoreState,
  datasetId: string | null,
  kind: AnalysisKind,
): T | null => {
  if (!datasetId) return null;
  return (state.results[key(datasetId, kind)]?.result as T | undefined) ?? null;
};

export const selectQCResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<QCResult>(state, datasetId, 'qc');

export const selectCompositionResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<CompositionResult>(state, datasetId, 'composition');

export const selectSimilarityResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<SimilarityResult>(state, datasetId, 'similarity');

export const selectOrfResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<OrfResult>(state, datasetId, 'orf');

export const selectAlignmentResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<AlignmentResult>(state, datasetId, 'alignment');

export const selectEmbeddingResult = (state: AnalysisStoreState, datasetId: string | null) =>
  getResult<EmbeddingResult>(state, datasetId, 'embedding');

export const selectIsRunning = (
  state: AnalysisStoreState,
  datasetId: string | null,
  kind: AnalysisKind,
): boolean => (datasetId ? state.running[key(datasetId, kind)] !== undefined : false);

export const selectError = (
  state: AnalysisStoreState,
  datasetId: string | null,
  kind: AnalysisKind,
): JobError | null => (datasetId ? (state.errors[key(datasetId, kind)] ?? null) : null);

export const selectStoredResult = (
  state: AnalysisStoreState,
  datasetId: string | null,
  kind: AnalysisKind,
): StoredResult | null => (datasetId ? (state.results[key(datasetId, kind)] ?? null) : null);
