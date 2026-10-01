/**
 * Message protocol shared by the main thread and the analysis workers.
 *
 * The protocol is deliberately explicit rather than using an RPC wrapper: every
 * long-running job reports staged progress and can be cancelled, and those two
 * requirements are easier to reason about with hand-written message types.
 */
/** Maps an analysis kind to the job that produces it. */
export const JOB_FOR_KIND = {
    qc: 'qc',
    composition: 'composition',
    similarity: 'similarity',
    orf: 'orf',
    alignment: 'alignment',
    embedding: 'embedding',
};
