import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { runQCJob } from '@/workers/jobs/qcJob';
import { runCompositionJob } from '@/workers/jobs/compositionJob';
import { runSimilarityJob } from '@/workers/jobs/similarityJob';
import { runOrfJob, runTranslateJob } from '@/workers/jobs/orfJob';
import { runAlignmentJob } from '@/workers/jobs/alignmentJob';
import { runEmbeddingJob } from '@/workers/jobs/embeddingJob';
import { AnalysisError } from '@/workers/context';
import { FASTA_FIXTURE, FASTQ_FIXTURE, PROTEIN_FIXTURE, createTestContext, importFixture, resetDatabase, } from './harness';
/**
 * Every analysis module, run against imported fixtures.
 *
 * The assertions are derived from the fixture contents by hand. That is the
 * point: a test that only checks "the result has a number in it" would pass
 * against a broken calculation.
 */
describe('quality control', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('computes dataset statistics that match the fixture', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        expect(qc.stats.sequenceCount).toBe(8);
        expect(qc.stats.totalResidues).toBe(290);
        expect(qc.stats.minLength).toBe(0);
        expect(qc.stats.maxLength).toBe(186);
        expect(qc.stats.medianLength).toBe(20);
        // Lengths descending: 186, 20, 20, 20, 20, 20, 4, 0. Total 290, half 145.
        // 186 alone crosses 145, so N50 is 186 and L50 is 1.
        expect(qc.stats.n50).toBe(186);
        expect(qc.stats.l50).toBe(1);
    });
    it('detects the duplicate pair and reports it exactly', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        // balanced_1 and balanced_2 are identical: one group, one redundant copy.
        expect(qc.stats.duplicateGroups).toBe(1);
        expect(qc.stats.duplicateSequences).toBe(1);
        expect(qc.duplicateGroups[0].count).toBe(2);
        expect(qc.duplicateGroups[0].ids.sort()).toEqual(['balanced_1', 'balanced_2']);
        expect(qc.stats.uniquePercent).toBeCloseTo((7 / 8) * 100, 6);
    });
    it('excludes empty records from duplicate grouping', async () => {
        // Three empty records would otherwise all hash alike.
        const { result } = await importFixture('>a\n>b\n>c\n>d\nACGTACGTACGTACGT\n', 'empties.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        expect(qc.stats.duplicateGroups).toBe(0);
        expect(qc.flagCounts.empty).toBe(3);
    });
    it('computes ambiguity from the fixture', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        // 10 N out of 290 residues.
        expect(qc.stats.ambiguousPercent).toBeCloseTo((10 / 290) * 100, 6);
    });
    it('flags the short, empty, and ambiguous records', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        expect(qc.flagCounts.empty).toBe(1); // empty_seq
        // The default short-sequence floor is 50, so the five 20 bp records and the
        // 4 bp one are all flagged; only the 186 bp coding sequence and the empty
        // record (counted separately) are not.
        expect(qc.flagCounts['too-short']).toBe(6);
        expect(qc.flagCounts.ambiguous).toBe(1); // with_n at 50%
        expect(qc.flagCounts['invalid-characters']).toBe(0);
        // With a floor below 20, only the 4 bp record is short.
        const lenient = await runQCJob({
            kind: 'qc',
            datasetId: result.dataset.id,
            thresholds: { ...DEFAULT_CONFIG.qc, minLength: 10 },
        }, createTestContext().context);
        expect(lenient.flagCounts['too-short']).toBe(1);
        const byId = new Map(qc.flaggedSequences.map((flag) => [flag.id, flag]));
        expect(byId.get('empty_seq')?.flags).toContain('empty');
        expect(byId.get('short')?.flags).toContain('too-short');
        expect(byId.get('with_n')?.flags).toContain('ambiguous');
    });
    it('names the threshold that produced each verdict', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const { context } = createTestContext();
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, context);
        expect(qc.checks.length).toBeGreaterThanOrEqual(10);
        for (const check of qc.checks) {
            expect(check.thresholdNote.length).toBeGreaterThan(10);
            expect(check.explanation.length).toBeGreaterThan(20);
        }
        const duplicates = qc.checks.find((check) => check.id === 'duplicates');
        expect(duplicates?.thresholdNote).toMatch(/20%/);
        expect(duplicates?.thresholdNote).toMatch(/50%/);
    });
    it('changes its verdict when a threshold changes', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const lenient = await runQCJob({
            kind: 'qc',
            datasetId: result.dataset.id,
            thresholds: { ...DEFAULT_CONFIG.qc, duplicateWarn: 0.9, duplicateReview: 0.95 },
        }, createTestContext().context);
        const strict = await runQCJob({
            kind: 'qc',
            datasetId: result.dataset.id,
            thresholds: { ...DEFAULT_CONFIG.qc, duplicateWarn: 0.01, duplicateReview: 0.05 },
        }, createTestContext().context);
        const lenientCheck = lenient.checks.find((c) => c.id === 'duplicates');
        const strictCheck = strict.checks.find((c) => c.id === 'duplicates');
        expect(lenientCheck?.status).toBe('pass');
        expect(strictCheck?.status).toBe('review');
        // The measured value is identical; only the verdict moved.
        expect(lenientCheck?.value).toBe(strictCheck?.value);
    });
    it('marks quality as not applicable for FASTA and computes it for FASTQ', async () => {
        const fasta = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const fastaQc = await runQCJob({ kind: 'qc', datasetId: fasta.result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        expect(fastaQc.stats.meanQuality).toBeNull();
        expect(fastaQc.checks.find((c) => c.id === 'mean-quality')?.status).toBe('not-applicable');
        expect(fastaQc.perPositionQuality).toEqual([]);
        const fastq = await importFixture(FASTQ_FIXTURE, 'reads.fastq');
        const fastqQc = await runQCJob({ kind: 'qc', datasetId: fastq.result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        // Read means are 40, 0, 40, 30 -> 27.5.
        expect(fastqQc.stats.meanQuality).toBeCloseTo(27.5, 4);
        expect(fastqQc.perPositionQuality).toHaveLength(10);
        expect(fastqQc.readQualityHistogram.length).toBeGreaterThan(0);
    });
    it('reports positional composition percentages that sum to 100', async () => {
        const { result } = await importFixture(FASTQ_FIXTURE, 'reads.fastq');
        const qc = await runQCJob({ kind: 'qc', datasetId: result.dataset.id, thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        for (const row of qc.positionalComposition) {
            expect(row.A + row.C + row.G + row.T + row.N).toBeCloseTo(100, 4);
        }
    });
    it('fails readably when the dataset is gone', async () => {
        let thrown;
        try {
            await runQCJob({ kind: 'qc', datasetId: 'does-not-exist', thresholds: DEFAULT_CONFIG.qc }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        expect(thrown.toJobError().code).toBe('dataset-missing');
    });
});
describe('composition and k-mers', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('computes nucleotide composition and k-mer spectra', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const composition = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [1, 3] },
            maxSequences: 0,
        }, createTestContext().context);
        expect(composition.sequenceType).toBe('dna');
        expect(composition.nucleotide).not.toBeNull();
        expect(composition.protein).toBeNull();
        expect(composition.sequencesAnalyzed).toBe(8);
        // Residue percentages must sum to 100.
        const total = composition.residueComposition.reduce((sum, entry) => sum + entry.percent, 0);
        expect(total).toBeCloseTo(100, 4);
        expect(composition.kmerSpectra).toHaveLength(2);
        const oneMer = composition.kmerSpectra.find((spectrum) => spectrum.k === 1);
        expect(oneMer?.possible).toBe(4);
        expect(oneMer?.distinct).toBeLessThanOrEqual(4);
        // 290 residues minus the 10 N, which are skipped.
        expect(oneMer?.total).toBe(280);
        const threeMer = composition.kmerSpectra.find((spectrum) => spectrum.k === 3);
        expect(threeMer?.possible).toBe(64);
        expect(threeMer?.exact).toBe(true);
    });
    it('reports entropy within the theoretical range', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const composition = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [2] },
            maxSequences: 0,
        }, createTestContext().context);
        expect(composition.nucleotide.entropyBitsPerBase).toBeGreaterThan(0);
        expect(composition.nucleotide.entropyBitsPerBase).toBeLessThanOrEqual(2 + 1e-9);
        const spectrum = composition.kmerSpectra[0];
        expect(spectrum.normalizedEntropy).toBeGreaterThan(0);
        expect(spectrum.normalizedEntropy).toBeLessThanOrEqual(1 + 1e-9);
    });
    it('merges reverse-complement pairs in canonical mode', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const plain = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [3], canonicalKmers: false },
            maxSequences: 0,
        }, createTestContext().context);
        const canonical = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [3], canonicalKmers: true },
            maxSequences: 0,
        }, createTestContext().context);
        expect(canonical.kmerSpectra[0].distinct).toBeLessThanOrEqual(plain.kmerSpectra[0].distinct);
        expect(canonical.kmerSpectra[0].possible).toBe(32);
        // Both count the same number of k-mer positions.
        expect(canonical.kmerSpectra[0].total).toBe(plain.kmerSpectra[0].total);
    });
    it('computes protein properties and skips nucleotide metrics', async () => {
        const { result } = await importFixture(PROTEIN_FIXTURE, 'proteins.faa');
        const composition = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [2] },
            maxSequences: 0,
        }, createTestContext().context);
        expect(composition.sequenceType).toBe('protein');
        expect(composition.nucleotide).toBeNull();
        expect(composition.protein).not.toBeNull();
        const bySeq = new Map(composition.protein.perSequenceSample.map((entry) => [entry.id, entry]));
        // The hydrophobic record must score positive GRAVY, the acidic one negative.
        expect(bySeq.get('hydrophobic_1').gravy).toBeGreaterThan(2);
        expect(bySeq.get('acidic_1').gravy).toBeLessThan(-2);
        // Acidic pI below neutral, basic pI above.
        expect(bySeq.get('acidic_1').isoelectricPoint).toBeLessThan(5);
        expect(bySeq.get('basic_1').isoelectricPoint).toBeGreaterThan(10);
        expect(bySeq.get('acidic_1').netChargeAtPh7).toBeLessThan(0);
        expect(bySeq.get('basic_1').netChargeAtPh7).toBeGreaterThan(0);
    });
    it('skips a k value that exceeds the alphabet limit and says so', async () => {
        const { result } = await importFixture(PROTEIN_FIXTURE, 'proteins.faa');
        const composition = await runCompositionJob({
            kind: 'composition',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.composition, kValues: [2, 12] },
            maxSequences: 0,
        }, createTestContext().context);
        expect(composition.kmerSpectra.map((s) => s.k)).toEqual([2]);
        expect(composition.notes.some((note) => note.includes('k = 12'))).toBe(true);
    });
});
describe('similarity', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('finds exact duplicates and clusters the dataset', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const similarity = await runSimilarityJob({ kind: 'similarity', datasetId: result.dataset.id, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        expect(similarity.sampled).toBe(false);
        expect(similarity.members).toHaveLength(8);
        expect(similarity.matrixSize).toBe(8);
        expect(similarity.matrix).toHaveLength((8 * 7) / 2);
        expect(similarity.stats.pairsCompared).toBe(28);
        expect(similarity.exactDuplicateGroups).toHaveLength(1);
        expect(similarity.exactDuplicateGroups[0].ids.sort()).toEqual([
            'balanced_1',
            'balanced_2',
        ]);
        expect(similarity.dendrogram).not.toBeNull();
        expect(similarity.clusters.length).toBeGreaterThan(0);
        // Every member belongs to exactly one cluster.
        const assigned = similarity.clusters.flatMap((cluster) => cluster.memberIndices);
        expect(assigned.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
    it('puts identical sequences in the same cluster', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const similarity = await runSimilarityJob({ kind: 'similarity', datasetId: result.dataset.id, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        const positionOf = (id) => similarity.members.findIndex((member) => member.id === id);
        const a = positionOf('balanced_1');
        const b = positionOf('balanced_2');
        const cluster = similarity.clusters.find((c) => c.memberIndices.includes(a));
        expect(cluster?.memberIndices).toContain(b);
    });
    it('keeps every Jaccard value in range and identical pairs at 1', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const similarity = await runSimilarityJob({ kind: 'similarity', datasetId: result.dataset.id, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        for (const value of similarity.matrix) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
        expect(similarity.stats.maxJaccard).toBeCloseTo(1, 6);
    });
    it('refines the top pairs with a real alignment identity', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const similarity = await runSimilarityJob({
            kind: 'similarity',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.similarity, refineWithAlignment: true, maxRefinedPairs: 10 },
        }, createTestContext().context);
        expect(similarity.stats.pairsRefined).toBeGreaterThan(0);
        const refined = similarity.topPairs.filter((pair) => pair.identity !== undefined);
        expect(refined.length).toBeGreaterThan(0);
        // The identical pair must align at 100% identity.
        const identical = refined.find((pair) => (similarity.members[pair.a].id === 'balanced_1' &&
            similarity.members[pair.b].id === 'balanced_2') ||
            (similarity.members[pair.a].id === 'balanced_2' &&
                similarity.members[pair.b].id === 'balanced_1'));
        expect(identical?.identity).toBeCloseTo(1, 6);
    });
    it('samples and says so when the dataset exceeds the matrix limit', async () => {
        const many = Array.from({ length: 40 }, (_, i) => `>s${i}\n${'ACGT'.repeat(10)}${'G'.repeat(i)}\n`).join('');
        const { result } = await importFixture(many, 'many.fasta');
        const similarity = await runSimilarityJob({
            kind: 'similarity',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.similarity, exactMaxSequences: 10, sampleSize: 10 },
        }, createTestContext().context);
        expect(similarity.sampled).toBe(true);
        expect(similarity.members.length).toBeLessThanOrEqual(10);
        expect(similarity.totalSequences).toBe(40);
        expect(similarity.notes.some((note) => /sample/i.test(note))).toBe(true);
    });
    it('refuses a single-sequence dataset with an explanation', async () => {
        const { result } = await importFixture('>only\nACGTACGTACGT\n', 'one.fasta');
        let thrown;
        try {
            await runSimilarityJob({ kind: 'similarity', datasetId: result.dataset.id, config: DEFAULT_CONFIG.similarity }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        expect(thrown.message).toMatch(/at least two sequences/i);
    });
});
describe('ORF detection and translation', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('finds the planted ORF with correct coordinates', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const orf = await runOrfJob({
            kind: 'orf',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.orf, minAminoAcids: 50, searchReverseStrand: false },
        }, createTestContext().context);
        const planted = orf.orfs.find((entry) => entry.sequenceId === 'coding');
        expect(planted).toBeDefined();
        expect(planted.strand).toBe('+');
        expect(planted.frame).toBe(1);
        expect(planted.start).toBe(1);
        expect(planted.end).toBe(186);
        expect(planted.aminoAcidLength).toBe(61);
        expect(planted.startCodon).toBe('ATG');
        expect(planted.stopCodon).toBe('TAA');
        expect(planted.protein).toBe(`M${'A'.repeat(60)}`);
        expect(planted.partial).toBe(false);
    });
    it('reports statistics consistent with the ORFs found', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const orf = await runOrfJob({
            kind: 'orf',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.orf, minAminoAcids: 50 },
        }, createTestContext().context);
        expect(orf.stats.sequencesScanned).toBe(8);
        expect(orf.stats.orfCount).toBe(orf.orfs.length);
        expect(orf.stats.maxOrfLength).toBe(Math.max(...orf.orfs.map((entry) => entry.aminoAcidLength)));
        const framesSum = orf.perFrameCounts.reduce((sum, entry) => sum + entry.count, 0);
        expect(framesSum).toBe(orf.stats.orfCount);
    });
    it('refuses a protein dataset with a readable reason', async () => {
        const { result } = await importFixture(PROTEIN_FIXTURE, 'proteins.faa');
        let thrown;
        try {
            await runOrfJob({ kind: 'orf', datasetId: result.dataset.id, config: DEFAULT_CONFIG.orf }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        const jobError = thrown.toJobError();
        expect(jobError.code).toBe('wrong-sequence-type');
        expect(jobError.suggestion).toMatch(/DNA or RNA/i);
    });
    it('translates a single sequence in six frames', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const translated = await runTranslateJob({
            kind: 'translate',
            datasetId: result.dataset.id,
            sequenceIndex: 7,
            config: { ...DEFAULT_CONFIG.orf, minAminoAcids: 50 },
        }, createTestContext().context);
        expect(translated.sequenceId).toBe('coding');
        expect(translated.length).toBe(186);
        expect(translated.frames).toHaveLength(6);
        expect(translated.frames.map((frame) => `${frame.strand}${frame.frame}`)).toEqual([
            '+1',
            '+2',
            '+3',
            '-1',
            '-2',
            '-3',
        ]);
        // Frame +1 is the coding frame: M then 60 alanines then the stop.
        expect(translated.frames[0].protein).toBe(`M${'A'.repeat(60)}*`);
        expect(translated.frames[0].stopCount).toBe(1);
        expect(translated.frames[0].longestStretch).toBe(61);
        expect(translated.orfs.length).toBeGreaterThan(0);
    });
    it('respects the genetic code selection', async () => {
        // TGA is a stop under code 1 and tryptophan under code 2.
        const sequence = `ATG${'GCC'.repeat(30)}TGA${'GCC'.repeat(30)}TAA`;
        const { result } = await importFixture(`>mito\n${sequence}\n`, 'mito.fasta');
        const standard = await runOrfJob({
            kind: 'orf',
            datasetId: result.dataset.id,
            config: {
                ...DEFAULT_CONFIG.orf,
                geneticCode: 1,
                minAminoAcids: 10,
                searchReverseStrand: false,
            },
        }, createTestContext().context);
        const mito = await runOrfJob({
            kind: 'orf',
            datasetId: result.dataset.id,
            config: {
                ...DEFAULT_CONFIG.orf,
                geneticCode: 2,
                minAminoAcids: 10,
                searchReverseStrand: false,
            },
        }, createTestContext().context);
        const standardFrame1 = standard.orfs.find((o) => o.frame === 1 && o.strand === '+');
        const mitoFrame1 = mito.orfs.find((o) => o.frame === 1 && o.strand === '+');
        // Under code 1 the ORF terminates at the internal TGA after 30 codons.
        expect(standardFrame1.aminoAcidLength).toBe(31);
        expect(standardFrame1.stopCodon).toBe('TGA');
        // Under code 2 the internal TGA is read as tryptophan, so the ORF runs on
        // to the TAA: M + 30 A + W + 30 A = 62 residues.
        expect(mitoFrame1.aminoAcidLength).toBe(62);
        expect(mitoFrame1.stopCodon).toBe('TAA');
        expect(mitoFrame1.protein).toContain('W');
    });
});
describe('alignment', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('aligns two identical sequences at full identity', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const alignment = await runAlignmentJob({
            kind: 'alignment',
            datasetId: result.dataset.id,
            sequenceIndices: [2, 3],
            config: DEFAULT_CONFIG.alignment,
        }, createTestContext().context);
        expect(alignment.method).toBe('pairwise-gotoh');
        expect(alignment.rows).toHaveLength(2);
        expect(alignment.stats.alignmentLength).toBe(20);
        expect(alignment.stats.meanPairwiseIdentity).toBeCloseTo(1, 6);
        expect(alignment.stats.gapFraction).toBe(0);
        expect(alignment.stats.substitutions).toBe(0);
        expect(alignment.consensus).toBe('ACGTACGTACGTACGTACGT');
        expect(alignment.variants).toEqual([]);
    });
    it('calls a substitution between two sequences that differ at one position', async () => {
        const { result } = await importFixture('>ref\nACGTACGTACGTACGTACGT\n>alt\nACGTACGTTCGTACGTACGT\n', 'pair.fasta');
        const alignment = await runAlignmentJob({
            kind: 'alignment',
            datasetId: result.dataset.id,
            sequenceIndices: [0, 1],
            config: DEFAULT_CONFIG.alignment,
        }, createTestContext().context);
        expect(alignment.stats.alignmentLength).toBe(20);
        expect(alignment.stats.substitutions).toBe(1);
        expect(alignment.variants).toHaveLength(1);
        expect(alignment.variants[0]).toMatchObject({
            column: 9,
            kind: 'substitution',
            reference: 'A',
            observed: 'T',
            count: 1,
        });
    });
    it('runs a center-star alignment for three or more sequences', async () => {
        const { result } = await importFixture([
            '>a',
            'ACGTACGTACGTACGTACGT',
            '>b',
            'ACGTACGTTCGTACGTACGT',
            '>c',
            'ACGTACGTACGTACGAACGT',
            '',
        ].join('\n'), 'three.fasta');
        const alignment = await runAlignmentJob({
            kind: 'alignment',
            datasetId: result.dataset.id,
            sequenceIndices: [0, 1, 2],
            config: DEFAULT_CONFIG.alignment,
        }, createTestContext().context);
        expect(alignment.method).toBe('center-star-progressive');
        expect(alignment.rows).toHaveLength(3);
        // Every row has the same number of columns.
        const lengths = new Set(alignment.rows.map((row) => row.aligned.length));
        expect(lengths.size).toBe(1);
        // Removing gaps must recover the original residues.
        for (const row of alignment.rows) {
            expect(row.aligned.replace(/-/g, '')).toHaveLength(20);
        }
        expect(alignment.columns).toHaveLength(alignment.stats.alignmentLength);
        expect(alignment.notes.some((note) => /center-star/i.test(note))).toBe(true);
    });
    it('refuses fewer than two sequences', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        await expect(runAlignmentJob({
            kind: 'alignment',
            datasetId: result.dataset.id,
            sequenceIndices: [0],
            config: DEFAULT_CONFIG.alignment,
        }, createTestContext().context)).rejects.toThrow(/at least two sequences/i);
    });
    it('refuses a selection above the sequence cap, naming the limit', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        let thrown;
        try {
            await runAlignmentJob({
                kind: 'alignment',
                datasetId: result.dataset.id,
                sequenceIndices: [0, 1, 2, 3],
                config: { ...DEFAULT_CONFIG.alignment, maxSequences: 3 },
            }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        const jobError = thrown.toJobError();
        expect(jobError.code).toBe('too-large');
        expect(jobError.message).toMatch(/limit is 3/);
    });
    it('refuses sequences longer than the length cap', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        let thrown;
        try {
            await runAlignmentJob({
                kind: 'alignment',
                datasetId: result.dataset.id,
                // Index 7 is the 186 bp coding sequence.
                sequenceIndices: [0, 7],
                config: { ...DEFAULT_CONFIG.alignment, maxLength: 100 },
            }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        expect(thrown.toJobError().code).toBe('too-large');
    });
    it('produces a local alignment that covers only the matching region', async () => {
        const { result } = await importFixture('>padded\nTTTTTTTTTTACGTACGTACGTTTTTTTTTT\n>core\nACGTACGTACGT\n', 'local.fasta');
        const alignment = await runAlignmentJob({
            kind: 'alignment',
            datasetId: result.dataset.id,
            sequenceIndices: [0, 1],
            config: { ...DEFAULT_CONFIG.alignment, mode: 'local' },
        }, createTestContext().context);
        expect(alignment.stats.alignmentLength).toBe(12);
        expect(alignment.stats.meanPairwiseIdentity).toBeCloseTo(1, 6);
    });
});
describe('embeddings', () => {
    beforeEach(async () => {
        await resetDatabase();
    });
    it('embeds with the k-mer provider and projects to 2-D', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const embedding = await runEmbeddingJob({
            kind: 'embedding',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.embedding, k: 3, clusterCount: 2, reduction: 'pca' },
        }, createTestContext().context);
        expect(embedding.providerId).toBe('kmer-spectrum');
        expect(embedding.dimensions).toBe(64); // 4^3
        expect(embedding.reduction).toBe('pca');
        expect(embedding.points).toHaveLength(8);
        expect(embedding.vectors).toHaveLength(8 * 64);
        expect(embedding.explainedVariance.length).toBeGreaterThan(0);
        for (const point of embedding.points) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
            expect(point.cluster).toBeGreaterThanOrEqual(0);
            expect(point.cluster).toBeLessThan(2);
        }
        const summarySize = embedding.clusterSummary.reduce((sum, entry) => sum + entry.size, 0);
        expect(summarySize).toBe(8);
    });
    it('is reproducible for a fixed seed', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        const config = { ...DEFAULT_CONFIG.embedding, k: 3, reduction: 'umap', umapEpochs: 30 };
        const first = await runEmbeddingJob({ kind: 'embedding', datasetId: result.dataset.id, config }, createTestContext().context);
        const second = await runEmbeddingJob({ kind: 'embedding', datasetId: result.dataset.id, config }, createTestContext().context);
        expect(first.points.map((p) => [p.x, p.y])).toEqual(second.points.map((p) => [p.x, p.y]));
        expect(first.points.map((p) => p.cluster)).toEqual(second.points.map((p) => p.cluster));
    });
    it('separates two compositional populations', async () => {
        const gcRich = Array.from({ length: 8 }, (_, i) => `>gc${i}\n${'GCGCGGCCGC'.repeat(12)}\n`);
        const atRich = Array.from({ length: 8 }, (_, i) => `>at${i}\n${'ATATAATTAT'.repeat(12)}\n`);
        const { result } = await importFixture([...gcRich, ...atRich].join(''), 'two-pops.fasta');
        const embedding = await runEmbeddingJob({
            kind: 'embedding',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.embedding, k: 4, clusterCount: 2 },
        }, createTestContext().context);
        const gcClusters = new Set(embedding.points.filter((p) => p.id.startsWith('gc')).map((p) => p.cluster));
        const atClusters = new Set(embedding.points.filter((p) => p.id.startsWith('at')).map((p) => p.cluster));
        // Each population lands in exactly one cluster, and they differ.
        expect(gcClusters.size).toBe(1);
        expect(atClusters.size).toBe(1);
        expect([...gcClusters][0]).not.toBe([...atClusters][0]);
    });
    it('refuses an unavailable provider and explains why', async () => {
        const { result } = await importFixture(PROTEIN_FIXTURE, 'proteins.faa');
        let thrown;
        try {
            await runEmbeddingJob({
                kind: 'embedding',
                datasetId: result.dataset.id,
                config: { ...DEFAULT_CONFIG.embedding, providerId: 'local-onnx-plm' },
            }, createTestContext().context);
        }
        catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalysisError);
        const jobError = thrown.toJobError();
        expect(jobError.code).toBe('provider-unavailable');
        // The reason must be specific rather than a generic failure.
        expect(jobError.suggestion).toMatch(/model/i);
    });
    it('refuses an unknown provider id', async () => {
        const { result } = await importFixture(FASTA_FIXTURE, 'fixture.fasta');
        await expect(runEmbeddingJob({
            kind: 'embedding',
            datasetId: result.dataset.id,
            config: { ...DEFAULT_CONFIG.embedding, providerId: 'nope' },
        }, createTestContext().context)).rejects.toThrow(/No embedding provider/i);
    });
});
