import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
/** How many completed jobs are kept in the activity list. */
const HISTORY_LIMIT = 40;
/**
 * Live registry of analysis jobs.
 *
 * Separate from the analysis results store because progress updates arrive
 * roughly twelve times a second per job: keeping them in their own store means
 * a running import re-renders the progress bar and nothing else. Components
 * that show results subscribe to the result store and stay still while a job
 * runs.
 */
export const useJobStore = create()((set) => ({
    jobs: {},
    order: [],
    start: ({ id, kind, label, datasetId }) => set((state) => ({
        jobs: {
            ...state.jobs,
            [id]: {
                id,
                kind,
                datasetId,
                label,
                status: 'running',
                stages: [],
                startedAt: Date.now(),
            },
        },
        order: [...state.order.filter((existing) => existing !== id), id],
    })),
    progress: (id, stages) => set((state) => {
        const job = state.jobs[id];
        if (!job || job.status !== 'running')
            return state;
        return { jobs: { ...state.jobs, [id]: { ...job, stages } } };
    }),
    finish: (id) => set((state) => {
        const job = state.jobs[id];
        if (!job)
            return state;
        return {
            jobs: {
                ...state.jobs,
                [id]: {
                    ...job,
                    status: 'done',
                    finishedAt: Date.now(),
                    // Force every stage to full so a completed job never shows a
                    // partially filled bar because the last update was throttled.
                    stages: job.stages.map((stage) => ({ ...stage, value: 1 })),
                },
            },
            ...trim(state),
        };
    }),
    fail: (id, error) => set((state) => {
        const job = state.jobs[id];
        if (!job)
            return state;
        return {
            jobs: {
                ...state.jobs,
                [id]: { ...job, status: 'error', error, finishedAt: Date.now() },
            },
            ...trim(state),
        };
    }),
    cancel: (id) => set((state) => {
        const job = state.jobs[id];
        if (!job)
            return state;
        return {
            jobs: {
                ...state.jobs,
                [id]: { ...job, status: 'cancelled', finishedAt: Date.now() },
            },
            ...trim(state),
        };
    }),
    dismiss: (id) => set((state) => {
        const { [id]: _removed, ...rest } = state.jobs;
        return { jobs: rest, order: state.order.filter((existing) => existing !== id) };
    }),
    clearFinished: () => set((state) => {
        const jobs = {};
        const order = [];
        for (const id of state.order) {
            if (state.jobs[id]?.status === 'running' || state.jobs[id]?.status === 'queued') {
                jobs[id] = state.jobs[id];
                order.push(id);
            }
        }
        return { jobs, order };
    }),
}));
/** Drops the oldest finished jobs once the history limit is exceeded. */
function trim(state) {
    const finished = state.order.filter((id) => state.jobs[id] && state.jobs[id].status !== 'running' && state.jobs[id].status !== 'queued');
    if (finished.length <= HISTORY_LIMIT)
        return {};
    const toDrop = new Set(finished.slice(0, finished.length - HISTORY_LIMIT));
    const jobs = {};
    const order = [];
    for (const id of state.order) {
        if (toDrop.has(id))
            continue;
        jobs[id] = state.jobs[id];
        order.push(id);
    }
    return { jobs, order };
}
/* ------------------------------- selectors -------------------------------- */
/**
 * Array-building selectors must be subscribed through `useShallow`.
 *
 * Zustand compares a selector's result by reference, so a selector that maps or
 * filters returns a new array on every call and would re-render without end.
 * The hooks below wrap the comparison so callers cannot get this wrong.
 */
export const selectRunningJobs = (state) => state.order.map((id) => state.jobs[id]).filter((job) => job?.status === 'running');
export const selectRecentJobs = (state) => [...state.order].reverse().map((id) => state.jobs[id]).filter(Boolean);
/** Subscribes to the running jobs with shallow comparison. */
export const useRunningJobs = () => useJobStore(useShallow(selectRunningJobs));
/** Subscribes to the full job history, newest first, with shallow comparison. */
export const useRecentJobs = () => useJobStore(useShallow(selectRecentJobs));
export const selectJobForDataset = (state, datasetId, kind) => {
    if (datasetId === null)
        return undefined;
    for (let i = state.order.length - 1; i >= 0; i -= 1) {
        const job = state.jobs[state.order[i]];
        if (job && job.datasetId === datasetId && job.kind === kind)
            return job;
    }
    return undefined;
};
/** Overall completion across a job's stages, for a single summary bar. */
export const jobOverallProgress = (job) => {
    const known = job.stages.filter((stage) => stage.value !== null);
    if (known.length === 0)
        return null;
    return known.reduce((sum, stage) => sum + (stage.value ?? 0), 0) / known.length;
};
