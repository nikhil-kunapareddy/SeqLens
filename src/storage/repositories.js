import { DEFAULT_CONFIG } from '@/bio/defaults';
import { hashString } from '@/bio/parsers/hash';
import { db, resultId } from './db';
import { invalidateSequenceCaches } from './sequenceStore';
/** Collision-resistant id that is also readable in a URL. */
export function createId(prefix) {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `${prefix}_${Date.now().toString(36)}${random}`;
}
/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */
export const projectRepository = {
    async list() {
        const projects = await db.projects.toArray();
        return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get(id) {
        return db.projects.get(id);
    },
    async create(input) {
        const now = Date.now();
        const project = {
            id: createId('prj'),
            name: input.name.trim() || 'Untitled project',
            description: input.description?.trim() ?? '',
            createdAt: now,
            updatedAt: now,
            datasetIds: [],
            config: input.config ?? structuredClone(DEFAULT_CONFIG),
        };
        await db.projects.add(project);
        return project;
    },
    async update(id, changes) {
        await db.projects.update(id, { ...changes, updatedAt: Date.now() });
    },
    async touch(id) {
        await db.projects.update(id, { updatedAt: Date.now() });
    },
    /**
     * Deletes a project and everything derived from it.
     *
     * Runs in one transaction across every affected table: a half-deleted project
     * would leave orphaned blocks occupying quota with nothing referencing them.
     */
    async delete(id) {
        const datasets = await db.datasets.where('projectId').equals(id).toArray();
        const datasetIds = datasets.map((dataset) => dataset.id);
        await db.transaction('rw', [db.projects, db.datasets, db.blocks, db.blockMaps, db.indexes, db.profiles, db.results, db.reports], async () => {
            for (const datasetId of datasetIds) {
                await db.blocks.where('datasetId').equals(datasetId).delete();
                await db.blockMaps.delete(datasetId);
                await db.indexes.delete(datasetId);
                await db.profiles.delete(datasetId);
            }
            await db.datasets.where('projectId').equals(id).delete();
            await db.results.where('projectId').equals(id).delete();
            await db.reports.where('projectId').equals(id).delete();
            await db.projects.delete(id);
        });
        for (const datasetId of datasetIds)
            invalidateSequenceCaches(datasetId);
    },
};
/* -------------------------------------------------------------------------- */
/* Datasets                                                                   */
/* -------------------------------------------------------------------------- */
export const datasetRepository = {
    listForProject(projectId) {
        return db.datasets.where('projectId').equals(projectId).toArray();
    },
    get(id) {
        return db.datasets.get(id);
    },
    getIndex(datasetId) {
        return db.indexes.get(datasetId);
    },
    getProfile(datasetId) {
        return db.profiles.get(datasetId);
    },
    /**
     * Registers a fully imported dataset.
     *
     * The blocks themselves are written by the import worker as it parses, so by
     * the time this runs only the metadata, index, profile, and block map remain.
     * Registering them together in one transaction is what makes a dataset either
     * fully visible or not visible at all.
     */
    async register(input) {
        await db.transaction('rw', [db.datasets, db.indexes, db.profiles, db.projects], async () => {
            await db.datasets.put(input.dataset);
            await db.indexes.put(input.index);
            await db.profiles.put(input.profile);
            const project = await db.projects.get(input.dataset.projectId);
            if (project && !project.datasetIds.includes(input.dataset.id)) {
                await db.projects.update(project.id, {
                    datasetIds: [...project.datasetIds, input.dataset.id],
                    updatedAt: Date.now(),
                });
            }
        });
        invalidateSequenceCaches(input.dataset.id);
    },
    async delete(datasetId) {
        const dataset = await db.datasets.get(datasetId);
        await db.transaction('rw', [db.datasets, db.blocks, db.blockMaps, db.indexes, db.profiles, db.results, db.projects], async () => {
            await db.blocks.where('datasetId').equals(datasetId).delete();
            await db.blockMaps.delete(datasetId);
            await db.indexes.delete(datasetId);
            await db.profiles.delete(datasetId);
            await db.results.where('datasetId').equals(datasetId).delete();
            await db.datasets.delete(datasetId);
            if (dataset) {
                const project = await db.projects.get(dataset.projectId);
                if (project) {
                    await db.projects.update(project.id, {
                        datasetIds: project.datasetIds.filter((id) => id !== datasetId),
                        updatedAt: Date.now(),
                    });
                }
            }
        });
        invalidateSequenceCaches(datasetId);
    },
    /** Removes any partially written blocks from an import that failed. */
    async discardPartialImport(datasetId) {
        await db.transaction('rw', [db.blocks, db.blockMaps, db.indexes, db.profiles], async () => {
            await db.blocks.where('datasetId').equals(datasetId).delete();
            await db.blockMaps.delete(datasetId);
            await db.indexes.delete(datasetId);
            await db.profiles.delete(datasetId);
        });
        invalidateSequenceCaches(datasetId);
    },
};
/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */
export const blockRepository = {
    /** Appends a batch of blocks. Called by the import worker as it parses. */
    async appendBlocks(blocks) {
        if (blocks.length === 0)
            return;
        await db.blocks.bulkAdd(blocks);
    },
    async writeBlockMap(map) {
        await db.blockMaps.put(map);
        invalidateSequenceCaches(map.datasetId);
    },
    countForDataset(datasetId) {
        return db.blocks.where('datasetId').equals(datasetId).count();
    },
};
/* -------------------------------------------------------------------------- */
/* Analysis results                                                           */
/* -------------------------------------------------------------------------- */
/**
 * Stable fingerprint of an analysis configuration.
 *
 * Object keys are sorted before hashing so that two configurations that differ
 * only in property order produce the same hash. Without that, a cached result
 * would be missed whenever a config object happened to be rebuilt in a
 * different order, and every analysis would silently re-run.
 */
export function configHash(config) {
    return hashString(stableStringify(config));
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`).join(',')}}`;
}
export const resultRepository = {
    async get(datasetId, kind, hash) {
        return db.results.get(resultId(datasetId, kind, hash));
    },
    /** Most recent result of a kind for a dataset, whatever config produced it. */
    async getLatest(datasetId, kind) {
        const rows = await db.results.where('[datasetId+kind]').equals([datasetId, kind]).toArray();
        if (rows.length === 0)
            return undefined;
        rows.sort((a, b) => b.computedAt - a.computedAt);
        return rows[0];
    },
    listForProject(projectId) {
        return db.results.where('projectId').equals(projectId).toArray();
    },
    async save(input) {
        const stored = {
            id: resultId(input.datasetId, input.kind, input.configHash),
            projectId: input.projectId,
            datasetId: input.datasetId,
            kind: input.kind,
            computedAt: Date.now(),
            configHash: input.configHash,
            durationMs: input.durationMs,
            result: input.result,
        };
        await db.results.put(stored);
        await projectRepository.touch(input.projectId);
        return stored;
    },
    async deleteForDataset(datasetId, kind) {
        if (kind) {
            await db.results.where('[datasetId+kind]').equals([datasetId, kind]).delete();
            return;
        }
        await db.results.where('datasetId').equals(datasetId).delete();
    },
};
/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */
export const reportRepository = {
    async listForProject(projectId) {
        const rows = await db.reports.where('projectId').equals(projectId).toArray();
        return rows.sort((a, b) => b.createdAt - a.createdAt);
    },
    async listAll() {
        const rows = await db.reports.toArray();
        return rows.sort((a, b) => b.createdAt - a.createdAt);
    },
    get(id) {
        return db.reports.get(id);
    },
    async save(report) {
        await db.reports.put(report);
        await projectRepository.touch(report.projectId);
    },
    async delete(id) {
        await db.reports.delete(id);
    },
};
/* -------------------------------------------------------------------------- */
/* Settings and wholesale deletion                                            */
/* -------------------------------------------------------------------------- */
export const settingsRepository = {
    async get(key, fallback) {
        const row = await db.settings.get(key);
        return row === undefined ? fallback : row.value;
    },
    async set(key, value) {
        await db.settings.put({ key, value });
    },
};
/** Counts everything SeqLens has stored, for the privacy panel. */
export async function summarizeLocalData() {
    const [projects, datasets, blocks, results, reports] = await Promise.all([
        db.projects.count(),
        db.datasets.toArray(),
        db.blocks.count(),
        db.results.count(),
        db.reports.count(),
    ]);
    let sequences = 0;
    let residues = 0;
    for (const dataset of datasets) {
        sequences += dataset.sequenceCount;
        residues += dataset.totalResidues;
    }
    return {
        projects,
        datasets: datasets.length,
        sequences,
        residues,
        blocks,
        results,
        reports,
    };
}
/**
 * Deletes every trace of SeqLens data from this browser.
 *
 * Every table is cleared and the in-memory caches are dropped. The database
 * itself is left in place: recreating the schema on the next import is cheaper
 * than a full `delete()`, and an empty database holds no sequence data.
 */
export async function deleteAllLocalData() {
    await db.transaction('rw', [
        db.projects,
        db.datasets,
        db.blocks,
        db.blockMaps,
        db.indexes,
        db.profiles,
        db.results,
        db.reports,
        db.settings,
    ], async () => {
        await Promise.all([
            db.projects.clear(),
            db.datasets.clear(),
            db.blocks.clear(),
            db.blockMaps.clear(),
            db.indexes.clear(),
            db.profiles.clear(),
            db.results.clear(),
            db.reports.clear(),
            db.settings.clear(),
        ]);
    });
    invalidateSequenceCaches();
}
