import Dexie, {} from 'dexie';
export class SeqLensDatabase extends Dexie {
    projects;
    datasets;
    blocks;
    blockMaps;
    indexes;
    profiles;
    results;
    reports;
    settings;
    constructor(name = 'seqlens') {
        super(name);
        this.version(1).stores({
            projects: 'id, name, createdAt, updatedAt',
            datasets: 'id, projectId, fileName, importedAt',
            // The compound index is what makes ordered block streaming a range scan.
            blocks: '++id, datasetId, [datasetId+blockIndex]',
            blockMaps: 'datasetId',
            indexes: 'datasetId',
            profiles: 'datasetId',
            results: 'id, projectId, datasetId, kind, [datasetId+kind], [datasetId+kind+configHash]',
            reports: 'id, projectId, createdAt',
            settings: 'key',
        });
    }
}
export const db = new SeqLensDatabase();
/** Result-cache key: one stored result per dataset, kind, and configuration. */
export const resultId = (datasetId, kind, configHash) => `${datasetId}:${kind}:${configHash}`;
/**
 * Reports how much of the origin's storage quota is in use.
 *
 * The figure is the browser's own estimate for the whole origin and is
 * deliberately imprecise - browsers pad it to avoid fingerprinting - but it is
 * the only number available, and users need some signal before importing a file
 * larger than their remaining quota.
 */
export async function estimateStorage() {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
        return { usage: 0, quota: 0, supported: false };
    }
    try {
        const estimate = await navigator.storage.estimate();
        return {
            usage: estimate.usage ?? 0,
            quota: estimate.quota ?? 0,
            supported: true,
        };
    }
    catch {
        return { usage: 0, quota: 0, supported: false };
    }
}
/**
 * Asks the browser to exempt this origin's data from automatic eviction.
 *
 * Without persistence, a browser under storage pressure may clear IndexedDB
 * and a saved project disappears. Chrome grants this silently for engaged
 * sites; Firefox prompts. A refusal is not an error - it just means saved
 * projects are best-effort - so the result is surfaced in Settings rather than
 * treated as a failure.
 */
export async function requestPersistentStorage() {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
        return { granted: false, supported: false };
    }
    try {
        if (await navigator.storage.persisted())
            return { granted: true, supported: true };
        return { granted: await navigator.storage.persist(), supported: true };
    }
    catch {
        return { granted: false, supported: false };
    }
}
