/// <reference lib="webworker" />
import { JobCancelledError, JobContext, toJobError } from './context';
import { runImportJob } from './jobs/importJob';
import { runQCJob } from './jobs/qcJob';
import { runCompositionJob } from './jobs/compositionJob';
import { runSimilarityJob } from './jobs/similarityJob';
import { runOrfJob, runTranslateJob } from './jobs/orfJob';
import { runAlignmentJob } from './jobs/alignmentJob';
import { runEmbeddingJob } from './jobs/embeddingJob';
/**
 * The analysis worker.
 *
 * Every CPU-intensive operation in SeqLens runs here rather than on the main
 * thread: parsing a multi-gigabyte FASTQ, counting k-mers, building a
 * similarity matrix, and running UMAP are all seconds-to-minutes of synchronous
 * arithmetic, and on the main thread each would freeze the interface outright.
 *
 * The worker also owns its own IndexedDB connection, so the import job writes
 * blocks directly as it parses. Posting residues back to the main thread for
 * storage would copy every byte across the thread boundary - the one thing
 * worth avoiding when the payload is the whole dataset.
 *
 * Jobs run one at a time per worker; the pool on the main thread decides how
 * many workers exist.
 */
const active = new Map();
const send = (message) => {
    self.postMessage(message);
};
self.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'cancel') {
        // Cancellation is cooperative: the running job notices at its next chunk
        // boundary. Terminating the worker instead would abandon its IndexedDB
        // transactions mid-write.
        active.get(message.jobId)?.cancel();
        return;
    }
    if (message.type === 'start') {
        void execute(message.jobId, message.request);
    }
};
async function execute(jobId, request) {
    const postProgress = (stages) => {
        send({ type: 'progress', jobId, stages });
    };
    const context = new JobContext(jobId, postProgress);
    active.set(jobId, context);
    const startedAt = performance.now();
    try {
        const payload = await dispatch(request, context);
        context.flush();
        send({ type: 'done', jobId, payload, durationMs: performance.now() - startedAt });
    }
    catch (error) {
        if (error instanceof JobCancelledError || context.isCancelled) {
            send({ type: 'cancelled', jobId });
            return;
        }
        send({ type: 'error', jobId, error: toJobError(error) });
    }
    finally {
        active.delete(jobId);
    }
}
/** Routes a request to its job implementation. */
function dispatch(request, context) {
    switch (request.kind) {
        case 'import':
            return runImportJob(request, context);
        case 'qc':
            return runQCJob(request, context);
        case 'composition':
            return runCompositionJob(request, context);
        case 'similarity':
            return runSimilarityJob(request, context);
        case 'orf':
            return runOrfJob(request, context);
        case 'translate':
            return runTranslateJob(request, context);
        case 'alignment':
            return runAlignmentJob(request, context);
        case 'embedding':
            return runEmbeddingJob(request, context);
    }
}
