import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/storage/db';
import { datasetRepository } from '@/storage/repositories';
import {
  forEachBlock,
  getSequence,
  getSequenceRange,
  getSequencesByIndices,
  gcPercentFromIndex,
  idFromIndex,
  invalidateSequenceCaches,
} from '@/storage/sequenceStore';
import { runImportJob } from '@/workers/jobs/importJob';
import { AnalysisError } from '@/workers/context';
import {
  FASTA_FIXTURE,
  FASTQ_FIXTURE,
  PROTEIN_FIXTURE,
  createCancellingContext,
  createTestContext,
  importFixture,
  makeFile,
  resetDatabase,
} from './harness';
import { DEFAULT_CONFIG } from '@/bio/defaults';

/**
 * File import, end to end.
 *
 * These exercise the real streaming pipeline - `File.stream`, the incremental
 * parser, the block writer, and IndexedDB via `fake-indexeddb` - and check the
 * results against numbers derived by hand from the fixtures rather than from a
 * previous run.
 */
describe('file import', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('imports a FASTA file and records correct metadata', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const { dataset, index, profile } = result;

    expect(dataset.format).toBe('fasta');
    expect(dataset.sequenceType).toBe('dna');
    expect(dataset.sequenceCount).toBe(8);
    expect(dataset.truncated).toBe(false);
    expect(dataset.gzipped).toBe(false);

    // 20 + 20 + 20 + 20 + 20 + 0 + 4 + 186 = 290
    expect(dataset.totalResidues).toBe(290);
    expect(dataset.minLength).toBe(0);
    expect(dataset.maxLength).toBe(186);

    expect(index.count).toBe(8);
    expect([...index.lengths]).toEqual([20, 20, 20, 20, 20, 0, 4, 186]);
    expect(profile.totalResidues).toBe(290);
  });

  it('computes per-sequence GC from the index', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const { index } = result;

    expect(gcPercentFromIndex(index, 0)).toBeCloseTo(100, 6); // gc_rich
    expect(gcPercentFromIndex(index, 1)).toBeCloseTo(0, 6); // at_rich
    expect(gcPercentFromIndex(index, 2)).toBeCloseTo(50, 6); // balanced_1
    // with_n: 10 real bases (5 GC) and 10 N, so GC is over the 10 real bases.
    expect(gcPercentFromIndex(index, 4)).toBeCloseTo(50, 6);
    expect(gcPercentFromIndex(index, 5)).toBe(0); // empty
  });

  it('counts ambiguous residues per sequence', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    expect([...result.index.ambiguousCounts]).toEqual([0, 0, 0, 0, 10, 0, 0, 0]);
  });

  it('stores identifiers in a single blob addressable by index', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const { index } = result;
    expect(index.idOffsets.length).toBe(index.count + 1);
    expect(idFromIndex(index, 0)).toBe('gc_rich');
    expect(idFromIndex(index, 5)).toBe('empty_seq');
    expect(idFromIndex(index, 7)).toBe('coding');
    // Out-of-range access returns empty rather than throwing.
    expect(idFromIndex(index, 99)).toBe('');
  });

  it('gives identical hashes to identical residues and different hashes otherwise', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const { index } = result;
    // balanced_1 and balanced_2 are byte-identical.
    expect(index.hashLow[2]).toBe(index.hashLow[3]);
    expect(index.hashHigh[2]).toBe(index.hashHigh[3]);
    // gc_rich and at_rich are not.
    expect(index.hashLow[0] === index.hashLow[1] && index.hashHigh[0] === index.hashHigh[1]).toBe(
      false,
    );
  });

  it('reads residues back from the block store', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const datasetId = result.dataset.id;

    const first = await getSequence(datasetId, 0);
    expect(first?.id).toBe('gc_rich');
    expect(first?.description).toBe('high GC');
    expect(first?.residues).toBe('GGGGCCCCGGGGCCCCGGGG');
    expect(first?.index).toBe(0);

    const empty = await getSequence(datasetId, 5);
    expect(empty?.id).toBe('empty_seq');
    expect(empty?.residues).toBe('');

    const last = await getSequence(datasetId, 7);
    expect(last?.residues).toHaveLength(186);
    expect(last?.residues.startsWith('ATGGCC')).toBe(true);
    expect(last?.residues.endsWith('TAA')).toBe(true);

    expect(await getSequence(datasetId, 99)).toBeNull();
  });

  it('reads a contiguous range in order', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const range = await getSequenceRange(result.dataset.id, 1, 3);
    expect(range.map((s) => s.id)).toEqual(['at_rich', 'balanced_1', 'balanced_2']);
    expect(range.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('reads an arbitrary index set and returns it in the requested order', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const picked = await getSequencesByIndices(result.dataset.id, [7, 0, 4]);
    expect(picked.map((s) => s.id)).toEqual(['coding', 'gc_rich', 'with_n']);
  });

  it('streams every block exactly once', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    let sequencesSeen = 0;
    const blocksSeen: number[] = [];
    const walk = await forEachBlock(result.dataset.id, ({ block, blockIndex }) => {
      blocksSeen.push(blockIndex);
      sequencesSeen += block.count;
    });
    expect(walk.completed).toBe(true);
    expect(sequencesSeen).toBe(8);
    expect(blocksSeen).toEqual([...new Set(blocksSeen)]);
  });

  it('splits into multiple blocks and still reads back correctly', async () => {
    // Force three sequences per block so the block boundary logic is exercised.
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta', {
      import: { ...DEFAULT_CONFIG.import, blockSequences: 3 },
    });
    expect(result.dataset.blockCount).toBeGreaterThan(1);

    const all = await getSequenceRange(result.dataset.id, 0, 8);
    expect(all).toHaveLength(8);
    expect(all.map((s) => s.id)).toEqual([
      'gc_rich',
      'at_rich',
      'balanced_1',
      'balanced_2',
      'with_n',
      'empty_seq',
      'short',
      'coding',
    ]);
    // A sequence that lands at a block boundary must still be intact.
    expect(all[3].residues).toBe('ACGTACGTACGTACGTACGT');
    expect(all[7].residues).toHaveLength(186);
  });

  it('imports FASTQ with quality and detects the encoding', async () => {
    const { result } = await importFixture(FASTQ_FIXTURE, 'reads.fastq');
    const { dataset, index } = result;

    expect(dataset.format).toBe('fastq');
    expect(dataset.qualityEncoding).toBe('phred33');
    expect(dataset.sequenceCount).toBe(4);
    expect(index.meanQuality).toHaveLength(4);

    // 'I' is Q40, '!' is Q0.
    expect(index.meanQuality[0]).toBeCloseTo(40, 4);
    expect(index.meanQuality[1]).toBeCloseTo(0, 4);
    // 'I5' alternating is (40 + 20) / 2 = 30.
    expect(index.meanQuality[3]).toBeCloseTo(30, 4);

    const read = await getSequence(dataset.id, 0);
    expect(read?.residues).toBe('ACGTACGTAC');
    expect(read?.quality).toBe('IIIIIIIIII');
  });

  it('detects protein sequences and zeroes the GC column', async () => {
    const { result } = await importFixture(PROTEIN_FIXTURE, 'proteins.faa');
    expect(result.dataset.sequenceType).toBe('protein');
    expect(result.dataset.sequenceCount).toBe(5);
    expect([...result.index.gcCounts]).toEqual([0, 0, 0, 0, 0]);
  });

  it('honours a manual sequence type override', async () => {
    const { context } = createTestContext();
    const result = await runImportJob(
      {
        kind: 'import',
        datasetId: 'ds_forced',
        projectId: 'prj_forced',
        file: makeFile('>a\nGATTACA\n', 'ambiguous.fasta'),
        config: DEFAULT_CONFIG.import,
        forcedType: 'protein',
      },
      context,
    );
    expect(result.dataset.sequenceType).toBe('protein');
    expect(result.dataset.typeDetectionNote).toMatch(/manually/i);
  });

  it('respects a maximum sequence limit and marks the dataset truncated', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta', {
      import: { ...DEFAULT_CONFIG.import, maxSequences: 3 },
    });
    expect(result.dataset.sequenceCount).toBe(3);
    expect(result.dataset.truncated).toBe(true);
    expect(result.dataset.parseIssues.some((issue) => issue.kind === 'limit-reached')).toBe(true);
  });

  it('respects a maximum residue limit', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta', {
      import: { ...DEFAULT_CONFIG.import, maxResidues: 45 },
    });
    // Two 20 bp sequences fit; the third would exceed 45.
    expect(result.dataset.totalResidues).toBeLessThanOrEqual(45);
    expect(result.dataset.truncated).toBe(true);
  });

  it('reports an empty record as a parse issue and still imports it', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const issue = result.dataset.parseIssues.find((i) => i.kind === 'empty-sequence');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/no residues/i);
    expect(result.index.lengths[5]).toBe(0);
  });

  it('reports progress with a parse stage', async () => {
    const { context, progress } = createTestContext();
    await runImportJob(
      {
        kind: 'import',
        datasetId: 'ds_progress',
        projectId: 'prj_progress',
        file: makeFile(FASTA_FIXTURE, 'fixture.fasta'),
        config: DEFAULT_CONFIG.import,
      },
      context,
    );
    expect(progress.ids.has('parse')).toBe(true);
    expect(progress.stages.length).toBeGreaterThan(0);
  });

  /* ------------------------------ error paths ----------------------------- */

  it('rejects an empty file with a readable message', async () => {
    const { context } = createTestContext();
    await expect(
      runImportJob(
        {
          kind: 'import',
          datasetId: 'ds_empty',
          projectId: 'prj',
          file: makeFile('', 'empty.fasta'),
          config: DEFAULT_CONFIG.import,
        },
        context,
      ),
    ).rejects.toThrow(/is empty/i);
  });

  it('rejects an unrecognised format with a suggestion', async () => {
    const { context } = createTestContext();
    let thrown: unknown;
    try {
      await runImportJob(
        {
          kind: 'import',
          datasetId: 'ds_bad',
          projectId: 'prj',
          file: makeFile('id,name,value\n1,foo,2\n', 'table.csv'),
          config: DEFAULT_CONFIG.import,
        },
        context,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AnalysisError);
    const jobError = (thrown as AnalysisError).toJobError();
    expect(jobError.code).toBe('unsupported-format');
    expect(jobError.message).toMatch(/does not look like a FASTA or FASTQ/i);
    expect(jobError.suggestion).toBeTruthy();
  });

  it('reports a file with headers but no parseable records', async () => {
    const { context } = createTestContext();
    await expect(
      runImportJob(
        {
          kind: 'import',
          datasetId: 'ds_blank',
          projectId: 'prj',
          file: makeFile('\n\n\n\n', 'blank.fasta'),
          config: DEFAULT_CONFIG.import,
        },
        context,
      ),
    ).rejects.toThrow(/No sequence records/i);
  });

  it('discards partially written blocks when an import fails', async () => {
    const { context } = createTestContext();
    const datasetId = 'ds_partial';
    await expect(
      runImportJob(
        {
          kind: 'import',
          datasetId,
          projectId: 'prj',
          file: makeFile('not a sequence file at all', 'junk.bin'),
          config: DEFAULT_CONFIG.import,
        },
        context,
      ),
    ).rejects.toThrow();

    expect(await db.blocks.where('datasetId').equals(datasetId).count()).toBe(0);
    expect(await db.blockMaps.get(datasetId)).toBeUndefined();
    expect(await db.indexes.get(datasetId)).toBeUndefined();
  });

  it('cancels mid-import and leaves nothing behind', async () => {
    // A file large enough to produce several progress reports before cancelling.
    const many = Array.from(
      { length: 4000 },
      (_, i) => `>seq_${i}\n${'ACGT'.repeat(50)}\n`,
    ).join('');
    const context = createCancellingContext(1);
    const datasetId = 'ds_cancelled';

    await expect(
      runImportJob(
        {
          kind: 'import',
          datasetId,
          projectId: 'prj',
          file: makeFile(many, 'many.fasta'),
          config: { ...DEFAULT_CONFIG.import, blockSequences: 100 },
        },
        context,
      ),
    ).rejects.toThrow(/cancelled/i);

    expect(await db.blocks.where('datasetId').equals(datasetId).count()).toBe(0);
    expect(await db.indexes.get(datasetId)).toBeUndefined();
  });

  it('survives a cache invalidation between reads', async () => {
    const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const before = await getSequence(result.dataset.id, 2);
    invalidateSequenceCaches();
    const after = await getSequence(result.dataset.id, 2);
    expect(after).toEqual(before);
  });

  it('registers the dataset against its project', async () => {
    const { project, result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
    const stored = await datasetRepository.get(result.dataset.id);
    expect(stored?.projectId).toBe(project.id);

    const datasets = await datasetRepository.listForProject(project.id);
    expect(datasets.map((d) => d.id)).toEqual([result.dataset.id]);
  });
});
