import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { buildHtmlReport } from '@/features/reports/htmlReport';
import { db, estimateStorage, resultId } from '@/storage/db';
import { configHash, createId, datasetRepository, deleteAllLocalData, projectRepository, reportRepository, resultRepository, settingsRepository, summarizeLocalData, } from '@/storage/repositories';
import { runQCJob } from '@/workers/jobs/qcJob';
import { runCompositionJob } from '@/workers/jobs/compositionJob';
import { runOrfJob } from '@/workers/jobs/orfJob';
import { runSimilarityJob } from '@/workers/jobs/similarityJob';
import { APP_VERSION } from '@/types';
import { FASTA_FIXTURE, createTestContext, importFixture, resetDatabase } from './harness';
describe('project persistence', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('creates a project with the default configuration', async () => {
        const project = await projectRepository.create({ name: 'My project' });
        expect(project.id).toMatch(/^prj_/);
        expect(project.name).toBe('My project');
        expect(project.datasetIds).toEqual([]);
        expect(project.config.qc.duplicateWarn).toBe(DEFAULT_CONFIG.qc.duplicateWarn);
        const stored = await projectRepository.get(project.id);
        expect(stored).toEqual(project);
    });
    it('falls back to a placeholder name for an empty one', async () => {
        const project = await projectRepository.create({ name: '   ' });
        expect(project.name).toBe('Untitled project');
    });
    it('lists projects most-recently-updated first', async () => {
        const first = await projectRepository.create({ name: 'First' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = await projectRepository.create({ name: 'Second' });
        expect((await projectRepository.list()).map((p) => p.id)).toEqual([second.id, first.id]);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await projectRepository.touch(first.id);
        expect((await projectRepository.list()).map((p) => p.id)).toEqual([first.id, second.id]);
    });
    it('persists a configuration change', async () => {
        const project = await projectRepository.create({ name: 'Config' });
        const updated = {
            ...project.config,
            qc: { ...project.config.qc, duplicateWarn: 0.42 },
        };
        await projectRepository.update(project.id, { config: updated });
        const reloaded = await projectRepository.get(project.id);
        expect(reloaded?.config.qc.duplicateWarn).toBe(0.42);
        expect(reloaded?.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);
    });
    it('links an imported dataset to its project', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const reloaded = await projectRepository.get(project.id);
        expect(reloaded?.datasetIds).toEqual([result.dataset.id]);
    });
    it('survives a simulated reload by reading everything back from storage', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id,
            datasetId: result.dataset.id,
            kind: 'qc',
            configHash: configHash(DEFAULT_CONFIG.qc),
            durationMs: 12,
            result: qc,
        });
        // Nothing is held in memory here; everything below is a fresh read.
        const projects = await projectRepository.list();
        expect(projects).toHaveLength(1);
        const datasets = await datasetRepository.listForProject(projects[0].id);
        expect(datasets).toHaveLength(1);
        expect(datasets[0].sequenceCount).toBe(8);
        const index = await datasetRepository.getIndex(datasets[0].id);
        expect(index?.count).toBe(8);
        // Typed arrays must survive the structured clone into IndexedDB. The check
        // is on the constructor name and element width rather than `instanceof`:
        // fake-indexeddb clones through its own realm, so the reconstructed array
        // is a genuine Uint32Array that fails a cross-realm identity check.
        expectTypedArray(index?.lengths, 'Uint32Array', 4);
        expect([...(index?.lengths ?? [])]).toEqual([20, 20, 20, 20, 20, 0, 4, 186]);
        const profile = await datasetRepository.getProfile(datasets[0].id);
        expect(profile?.totalResidues).toBe(290);
        expectTypedArray(profile?.positionalComposition, 'Uint32Array', 4);
        const stored = await resultRepository.getLatest(datasets[0].id, 'qc');
        expect(stored?.result.stats.sequenceCount).toBe(8);
        expect(stored?.result.kind).toBe('qc');
    });
    it('deletes a dataset and everything derived from it', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id,
            datasetId,
            kind: 'qc',
            configHash: 'hash',
            durationMs: 1,
            result: qc,
        });
        expect(await db.blocks.where('datasetId').equals(datasetId).count()).toBeGreaterThan(0);
        await datasetRepository.delete(datasetId);
        expect(await datasetRepository.get(datasetId)).toBeUndefined();
        expect(await db.blocks.where('datasetId').equals(datasetId).count()).toBe(0);
        expect(await db.blockMaps.get(datasetId)).toBeUndefined();
        expect(await db.indexes.get(datasetId)).toBeUndefined();
        expect(await db.profiles.get(datasetId)).toBeUndefined();
        expect(await db.results.where('datasetId').equals(datasetId).count()).toBe(0);
        // The project survives, with the dataset unlinked.
        const reloaded = await projectRepository.get(project.id);
        expect(reloaded?.datasetIds).toEqual([]);
    });
    it('deletes a project and every dataset, result, and report under it', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id,
            datasetId,
            kind: 'qc',
            configHash: 'hash',
            durationMs: 1,
            result: qc,
        });
        await reportRepository.save(makeReport(project.id, datasetId));
        await projectRepository.delete(project.id);
        expect(await projectRepository.get(project.id)).toBeUndefined();
        expect(await db.datasets.count()).toBe(0);
        expect(await db.blocks.count()).toBe(0);
        expect(await db.blockMaps.count()).toBe(0);
        expect(await db.indexes.count()).toBe(0);
        expect(await db.profiles.count()).toBe(0);
        expect(await db.results.count()).toBe(0);
        expect(await db.reports.count()).toBe(0);
    });
    it('leaves other projects untouched when one is deleted', async () => {
        const keep = await importFixture(FASTA_FIXTURE, 'keep.fasta');
        const drop = await importFixture(FASTA_FIXTURE, 'drop.fasta');
        await projectRepository.delete(drop.project.id);
        expect(await projectRepository.get(keep.project.id)).toBeDefined();
        expect(await datasetRepository.get(keep.result.dataset.id)).toBeDefined();
        expect(await db.blocks.where('datasetId').equals(keep.result.dataset.id).count()).toBeGreaterThan(0);
        expect(await db.blocks.where('datasetId').equals(drop.result.dataset.id).count()).toBe(0);
    });
    it('persists settings by key', async () => {
        expect(await settingsRepository.get('missing', 'fallback')).toBe('fallback');
        await settingsRepository.set('theme', { lineWidth: 80 });
        expect(await settingsRepository.get('theme', null)).toEqual({ lineWidth: 80 });
    });
    it('summarises and then removes all local data', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        await reportRepository.save(makeReport(project.id, result.dataset.id));
        const before = await summarizeLocalData();
        expect(before.projects).toBe(1);
        expect(before.datasets).toBe(1);
        expect(before.sequences).toBe(8);
        expect(before.residues).toBe(290);
        expect(before.blocks).toBeGreaterThan(0);
        expect(before.reports).toBe(1);
        await deleteAllLocalData();
        const after = await summarizeLocalData();
        expect(after).toEqual({
            projects: 0,
            datasets: 0,
            sequences: 0,
            residues: 0,
            blocks: 0,
            results: 0,
            reports: 0,
        });
        expect(await db.settings.count()).toBe(0);
    });
    it('reports a storage estimate without throwing when unsupported', async () => {
        const estimate = await estimateStorage();
        expect(typeof estimate.supported).toBe('boolean');
        expect(estimate.usage).toBeGreaterThanOrEqual(0);
    });
});
describe('result caching', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('keys stored results by dataset, kind, and configuration hash', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const hash = configHash(DEFAULT_CONFIG.qc);
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const stored = await resultRepository.save({
            projectId: project.id,
            datasetId,
            kind: 'qc',
            configHash: hash,
            durationMs: 5,
            result: qc,
        });
        expect(stored.id).toBe(resultId(datasetId, 'qc', hash));
        expect(await resultRepository.get(datasetId, 'qc', hash)).toBeDefined();
        expect(await resultRepository.get(datasetId, 'qc', 'other-hash')).toBeUndefined();
    });
    it('produces a stable hash regardless of key order', () => {
        const a = configHash({ alpha: 1, beta: { x: 2, y: 3 } });
        const b = configHash({ beta: { y: 3, x: 2 }, alpha: 1 });
        expect(a).toBe(b);
    });
    it('produces different hashes for different values', () => {
        expect(configHash({ duplicateWarn: 0.2 })).not.toBe(configHash({ duplicateWarn: 0.3 }));
    });
    it('ignores undefined properties when hashing', () => {
        expect(configHash({ a: 1, b: undefined })).toBe(configHash({ a: 1 }));
    });
    it('overwrites a result computed with the same configuration', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const hash = configHash(DEFAULT_CONFIG.qc);
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id, datasetId, kind: 'qc', configHash: hash, durationMs: 1, result: qc,
        });
        await resultRepository.save({
            projectId: project.id, datasetId, kind: 'qc', configHash: hash, durationMs: 2, result: qc,
        });
        expect(await db.results.where('datasetId').equals(datasetId).count()).toBe(1);
        expect((await resultRepository.get(datasetId, 'qc', hash))?.durationMs).toBe(2);
    });
    it('keeps results for different configurations side by side', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        for (const duplicateWarn of [0.1, 0.5]) {
            const thresholds = { ...DEFAULT_CONFIG.qc, duplicateWarn };
            const qc = await runQCJob({ kind: 'qc', datasetId, thresholds }, createTestContext().context);
            await resultRepository.save({
                projectId: project.id,
                datasetId,
                kind: 'qc',
                configHash: configHash(thresholds),
                durationMs: 1,
                result: qc,
            });
        }
        expect(await db.results.where('[datasetId+kind]').equals([datasetId, 'qc']).count()).toBe(2);
        // getLatest returns the most recently computed of the two.
        expect(await resultRepository.getLatest(datasetId, 'qc')).toBeDefined();
    });
    it('round-trips a result containing typed arrays', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const similarity = await runSimilarityJob({ kind: 'similarity', datasetId, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id,
            datasetId,
            kind: 'similarity',
            configHash: configHash(DEFAULT_CONFIG.similarity),
            durationMs: 1,
            result: similarity,
        });
        const reloaded = await resultRepository.getLatest(datasetId, 'similarity');
        const matrix = (reloaded?.result).matrix;
        expectTypedArray(matrix, 'Float32Array', 4);
        expect(matrix).toHaveLength(similarity.matrix.length);
        expect([...matrix]).toEqual([...similarity.matrix]);
    });
    it('deletes results for one kind without touching the others', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const composition = await runCompositionJob({ kind: 'composition', datasetId, config: DEFAULT_CONFIG.composition, maxSequences: 0 }, createTestContext().context);
        await resultRepository.save({
            projectId: project.id, datasetId, kind: 'qc', configHash: 'a', durationMs: 1, result: qc,
        });
        await resultRepository.save({
            projectId: project.id, datasetId, kind: 'composition', configHash: 'b', durationMs: 1, result: composition,
        });
        await resultRepository.deleteForDataset(datasetId, 'qc');
        expect(await resultRepository.getLatest(datasetId, 'qc')).toBeUndefined();
        expect(await resultRepository.getLatest(datasetId, 'composition')).toBeDefined();
    });
});
describe('report generation', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    const allSections = {
        overview: true,
        qc: true,
        composition: true,
        kmer: true,
        redundancy: true,
        similarity: true,
        orf: true,
        alignment: true,
        embedding: true,
    };
    it('builds a self-contained HTML document', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: allSections,
            config: DEFAULT_CONFIG,
            qc,
            generatedAt: Date.UTC(2026, 0, 15, 12, 0, 0),
        });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('</html>');
        // Self-contained: its own styles, no script, no external references.
        expect(html).toContain('<style>');
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<link[^>]+href=/i);
        expect(html).not.toMatch(/src="https?:/i);
        expect(html).not.toMatch(/url\(https?:/i);
    });
    it('includes the headline statistics and the privacy statement', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: allSections,
            config: DEFAULT_CONFIG,
            qc,
        });
        expect(html).toContain('fixture.fasta');
        expect(html).toContain('SeqLens analysis report');
        expect(html).toContain('Local analysis.');
        expect(html).toContain('No sequence data was transmitted');
        // Sequence count and N50 from the fixture.
        expect(html).toContain('>8<');
        expect(html).toContain('186');
    });
    it('writes the configuration and provenance so the run is reproducible', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: allSections,
            config: DEFAULT_CONFIG,
            qc,
        });
        expect(html).toContain('Analysis parameters');
        expect(html).toContain('SeqLens version');
        expect(html).toContain(APP_VERSION);
        // The serialised configuration must carry the actual threshold values.
        expect(html).toContain('&quot;duplicateWarn&quot;: 0.2');
        expect(html).toContain('&quot;minAminoAcids&quot;: 50');
        expect(html).toContain('QC computed');
    });
    it('omits sections whose analysis was not run', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: { ...allSections, qc: false, composition: false, kmer: false },
            config: DEFAULT_CONFIG,
        });
        expect(html).toContain('Dataset overview');
        expect(html).not.toContain('<h2>Quality control</h2>');
        expect(html).not.toContain('<h2>k-mer analysis</h2>');
        // The configuration appendix is always present.
        expect(html).toContain('Analysis parameters');
    });
    it('includes every module when all results are supplied', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const datasetId = result.dataset.id;
        const qc = await runQCJob({ kind: 'qc', datasetId, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const composition = await runCompositionJob({
            kind: 'composition',
            datasetId,
            config: { ...DEFAULT_CONFIG.composition, kValues: [3] },
            maxSequences: 0,
        }, createTestContext().context);
        const similarity = await runSimilarityJob({ kind: 'similarity', datasetId, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        const orf = await runOrfJob({ kind: 'orf', datasetId, config: { ...DEFAULT_CONFIG.orf, minAminoAcids: 50 } }, createTestContext().context);
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: allSections,
            config: DEFAULT_CONFIG,
            qc,
            composition,
            similarity,
            orf,
        });
        for (const heading of [
            'Dataset overview',
            'Quality control',
            'Composition',
            'k-mer analysis',
            'Redundancy',
            'Similarity and clustering',
            'Open reading frames',
            'Analysis parameters',
        ]) {
            expect(html).toContain(`<h2>${heading}</h2>`);
        }
        // Charts are inline SVG with an accessible label.
        expect(html).toContain('<svg viewBox=');
        expect(html).toContain('role="img"');
        // Every chart is accompanied by a table.
        expect((html.match(/<table>/g) ?? []).length).toBeGreaterThan(5);
    });
    it('escapes identifiers so a hostile header cannot inject markup', async () => {
        const hostile = '><script>alert(1)</script> desc';
        const { project, result } = await importFixture(`>${hostile}\nACGTACGTACGTACGT\n>normal\nACGTACGTACGTACGT\n`, 'hostile.fasta');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        const html = buildHtmlReport({
            project,
            dataset: result.dataset,
            sections: allSections,
            config: DEFAULT_CONFIG,
            qc,
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
    it('persists a report against its project and deletes with it', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const record = makeReport(project.id, result.dataset.id);
        await reportRepository.save(record);
        expect((await reportRepository.listForProject(project.id)).map((r) => r.id)).toEqual([
            record.id,
        ]);
        expect(await reportRepository.get(record.id)).toMatchObject({ name: record.name });
        expect(await reportRepository.listAll()).toHaveLength(1);
        await reportRepository.delete(record.id);
        expect(await reportRepository.get(record.id)).toBeUndefined();
    });
    it('lists reports newest first', async () => {
        const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const older = { ...makeReport(project.id, result.dataset.id), createdAt: 1000 };
        const newer = {
            ...makeReport(project.id, result.dataset.id),
            id: createId('rep'),
            createdAt: 2000,
        };
        await reportRepository.save(older);
        await reportRepository.save(newer);
        expect((await reportRepository.listForProject(project.id)).map((r) => r.id)).toEqual([
            newer.id,
            older.id,
        ]);
    });
});
/**
 * Asserts a value is a typed array of the given kind without `instanceof`.
 *
 * `fake-indexeddb` reconstructs cloned values through its own realm, so a
 * perfectly valid `Uint32Array` read back from storage fails a cross-realm
 * `instanceof` check. Testing the constructor name and element width verifies
 * what actually matters - that the data came back as a typed array of the right
 * width - without asserting on the test environment's realm identity.
 */
function expectTypedArray(value, constructorName, bytesPerElement) {
    expect(value).toBeDefined();
    const candidate = value;
    expect(candidate.constructor?.name).toBe(constructorName);
    expect(candidate.BYTES_PER_ELEMENT).toBe(bytesPerElement);
    expect(ArrayBuffer.isView(value)).toBe(true);
}
function makeReport(projectId, datasetId) {
    const html = '<!doctype html><html><body>report</body></html>';
    return {
        id: createId('rep'),
        projectId,
        name: 'Test report',
        createdAt: Date.now(),
        appVersion: APP_VERSION,
        sections: {
            overview: true,
            qc: true,
            composition: false,
            kmer: false,
            redundancy: false,
            similarity: false,
            orf: false,
            alignment: false,
            embedding: false,
        },
        datasetIds: [datasetId],
        html,
        sizeBytes: html.length,
        configSnapshot: DEFAULT_CONFIG,
    };
}
