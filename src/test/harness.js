import { DEFAULT_CONFIG } from '@/bio/defaults';
import { db } from '@/storage/db';
import { datasetRepository, projectRepository } from '@/storage/repositories';
import { invalidateSequenceCaches } from '@/storage/sequenceStore';
import { JobContext } from '@/workers/context';
import { runImportJob } from '@/workers/jobs/importJob';
/** A job context that records progress instead of posting it. */
export function createTestContext(jobId = 'test-job') {
    const progress = { stages: [], ids: new Set() };
    const context = new JobContext(jobId, (stages) => {
        progress.stages.push(stages.map((stage) => ({ ...stage })));
        for (const stage of stages)
            progress.ids.add(stage.id);
    }, 
    // No throttling, so every reported stage is observable in a test.
    0);
    return { context, progress };
}
/** A context that cancels itself after `afterReports` progress messages. */
export function createCancellingContext(afterReports) {
    let seen = 0;
    const context = new JobContext('cancel-job', () => {
        seen += 1;
        if (seen >= afterReports)
            context.cancel();
    }, 0);
    return context;
}
/** Builds an in-memory File, the same shape the import job receives. */
export const makeFile = (contents, name) => new File([contents], name, { type: 'text/plain' });
/** Clears every table so each test starts from an empty database. */
export async function resetDatabase() {
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
/**
 * Creates a project and imports a file into it, exactly as the application
 * does: run the import job, then register the dataset.
 */
export async function importFixture(contents, fileName, overrides = {}) {
    const config = { ...structuredClone(DEFAULT_CONFIG), ...overrides };
    const project = await projectRepository.create({ name: `Test ${fileName}`, config });
    const { context } = createTestContext();
    const result = await runImportJob({
        kind: 'import',
        datasetId: `ds_${fileName.replace(/[^a-z0-9]/gi, '_')}`,
        projectId: project.id,
        file: makeFile(contents, fileName),
        config: config.import,
    }, context);
    await datasetRepository.register(result);
    return { project, result, config };
}
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * A small FASTA fixture with known, hand-checkable properties.
 *
 * Contents by design:
 *  - `gc_rich`: 20 bp, 100% GC
 *  - `at_rich`: 20 bp, 0% GC
 *  - `balanced_1` and `balanced_2`: identical 20 bp sequences, 50% GC (one
 *    duplicate pair)
 *  - `with_n`: 10 real bases plus 10 N (50% ambiguous)
 *  - `empty_seq`: header with no residues
 *  - `short`: 4 bp
 *  - `coding`: ATG + 60 alanine codons + TAA, one clean 61-codon ORF
 *
 * Totals: 8 records, and every statistic in the tests is derived from these
 * numbers by hand rather than from a previous run of the code.
 */
export const FASTA_FIXTURE = [
    '>gc_rich high GC',
    'GGGGCCCCGGGGCCCCGGGG',
    '>at_rich high AT',
    'AAAATTTTAAAATTTTAAAA',
    '>balanced_1 duplicate pair',
    'ACGTACGTACGTACGTACGT',
    '>balanced_2 duplicate pair',
    'ACGTACGTACGTACGTACGT',
    '>with_n half ambiguous',
    'ACGTACGTACNNNNNNNNNN',
    '>empty_seq no residues',
    '>short too short',
    'ACGT',
    '>coding one clean ORF',
    `ATG${'GCC'.repeat(60)}TAA`,
].join('\n');
/** Four-record FASTQ fixture with known Phred+33 quality. */
export const FASTQ_FIXTURE = [
    '@read1 perfect',
    'ACGTACGTAC',
    '+',
    'IIIIIIIIII',
    '@read2 poor',
    'ACGTACGTAC',
    '+',
    '!!!!!!!!!!',
    '@read3 duplicate of read1 residues',
    'ACGTACGTAC',
    '+',
    'IIIIIIIIII',
    '@read4 mixed',
    'GGGGCCCCGG',
    '+',
    'I5I5I5I5I5',
    '',
].join('\n');
/** Protein fixture: hydrophobic, acidic, and duplicate records. */
export const PROTEIN_FIXTURE = [
    '>hydrophobic_1',
    'MIIIILLLLVVVVAAAAFFFF',
    '>acidic_1',
    'MDDDDEEEEDDDDEEEEDDDD',
    '>basic_1',
    'MKKKKRRRRKKKKRRRRKKKK',
    '>dup_1',
    'MACDEFGHIKLMNPQRSTVWY',
    '>dup_2',
    'MACDEFGHIKLMNPQRSTVWY',
    '',
].join('\n');
