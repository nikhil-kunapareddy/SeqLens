import { create } from 'zustand';
import { configHash, resultRepository } from '@/storage';
import { JobCancelled, JobFailedError, runJob } from '@/workers/client';
import { useJobStore } from './jobStore';
const key = (datasetId, kind) => `${datasetId}:${kind}`;
const JOB_LABELS = {
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
export const useAnalysisStore = create()((set, get) => ({
    results: {},
    running: {},
    errors: {},
    controllers: {},
    hydrating: {},
    /** Loads previously computed results for a dataset from IndexedDB. */
    async hydrate(datasetId, kinds = ['qc', 'composition', 'similarity', 'orf', 'alignment', 'embedding']) {
        set((state) => {
            const hydrating = { ...state.hydrating };
            for (const kind of kinds)
                hydrating[key(datasetId, kind)] = true;
            return { hydrating };
        });
        const loaded = await Promise.all(kinds.map(async (kind) => ({ kind, stored: await resultRepository.getLatest(datasetId, kind) })));
        set((state) => {
            const results = { ...state.results };
            const hydrating = { ...state.hydrating };
            for (const { kind, stored } of loaded) {
                const resultKey = key(datasetId, kind);
                hydrating[resultKey] = false;
                if (stored)
                    results[resultKey] = stored;
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
            if (inMemory && inMemory.configHash === hash)
                return inMemory.result;
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
        }
        catch (error) {
            const jobError = error instanceof JobFailedError
                ? error.jobError
                : error instanceof JobCancelled
                    ? { code: 'cancelled', message: 'Analysis was cancelled.' }
                    : {
                        code: 'internal',
                        message: `${JOB_LABELS[kind]} failed.`,
                        detail: error instanceof Error ? error.message : String(error),
                    };
            if (error instanceof JobCancelled)
                useJobStore.getState().cancel(jobId);
            else
                useJobStore.getState().fail(jobId, jobError);
            set((state) => {
                const running = { ...state.running };
                const controllers = { ...state.controllers };
                delete running[resultKey];
                delete controllers[resultKey];
                return {
                    running,
                    controllers,
                    errors: jobError.code === 'cancelled'
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
            }
            else {
                for (const resultKey of Object.keys(results)) {
                    if (resultKey.startsWith(`${datasetId}:`))
                        delete results[resultKey];
                }
                for (const resultKey of Object.keys(errors)) {
                    if (resultKey.startsWith(`${datasetId}:`))
                        delete errors[resultKey];
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
async function executeJob(input, controller, jobId) {
    const { datasetId, kind, config } = input;
    const options = {
        signal: controller.signal,
        onProgress: (stages) => useJobStore.getState().progress(jobId, stages),
    };
    switch (kind) {
        case 'qc':
            return runJob({ kind: 'qc', datasetId, thresholds: config.qc }, options);
        case 'composition':
            return runJob({
                kind: 'composition',
                datasetId,
                config: config.composition,
                maxSequences: 0,
            }, options);
        case 'similarity':
            return runJob({ kind: 'similarity', datasetId, config: config.similarity }, options);
        case 'orf':
            return runJob({ kind: 'orf', datasetId, config: config.orf }, options);
        case 'alignment':
            return runJob({
                kind: 'alignment',
                datasetId,
                sequenceIndices: input.sequenceIndices ?? [],
                config: config.alignment,
            }, options);
        case 'embedding':
            return runJob({ kind: 'embedding', datasetId, config: config.embedding }, options);
    }
}
/** The configuration slice that actually affects a given analysis. */
function configSliceFor(kind, config, sequenceIndices) {
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
const getResult = (state, datasetId, kind) => {
    if (!datasetId)
        return null;
    return state.results[key(datasetId, kind)]?.result ?? null;
};
export const selectQCResult = (state, datasetId) => getResult(state, datasetId, 'qc');
export const selectCompositionResult = (state, datasetId) => getResult(state, datasetId, 'composition');
export const selectSimilarityResult = (state, datasetId) => getResult(state, datasetId, 'similarity');
export const selectOrfResult = (state, datasetId) => getResult(state, datasetId, 'orf');
export const selectAlignmentResult = (state, datasetId) => getResult(state, datasetId, 'alignment');
export const selectEmbeddingResult = (state, datasetId) => getResult(state, datasetId, 'embedding');
export const selectIsRunning = (state, datasetId, kind) => (datasetId ? state.running[key(datasetId, kind)] !== undefined : false);
export const selectError = (state, datasetId, kind) => (datasetId ? (state.errors[key(datasetId, kind)] ?? null) : null);
export const selectStoredResult = (state, datasetId, kind) => (datasetId ? (state.results[key(datasetId, kind)] ?? null) : null);
