import { BLOSUM62, PAM250, alignMultiple, alignPairwise, analyzeColumns, callVariants, estimateMemoryBytes, identityMatrix, meanPairwiseIdentity, nucleotideMatrix, pickCenterByLength, } from '@/bio';
import { datasetRepository, getSequencesByIndices } from '@/storage';
import { AnalysisError } from '../context';
/**
 * Traceback memory ceiling for one pairwise alignment, in bytes.
 *
 * The Gotoh traceback needs one byte per cell, so this caps a single alignment
 * at roughly two 11 kb sequences. Above it the browser tab is at real risk of
 * an allocation failure, and failing with an explanation beats failing with
 * "Array buffer allocation failed".
 */
const MAX_TRACEBACK_BYTES = 128 * 1024 * 1024;
/**
 * Pairwise and multiple sequence alignment.
 *
 * Two sequences get an exact Gotoh alignment with full traceback. More than two
 * get a center-star progressive alignment, which is n-1 pairwise alignments
 * against a central sequence merged into one layout.
 *
 * Both paths are bounded before they start, because alignment is the one place
 * in SeqLens where the cost is quadratic in sequence length and a careless
 * selection can ask for something the browser cannot do. The limits are stated
 * in the error rather than silently applied.
 */
export async function runAlignmentJob(request, context) {
    const { datasetId, sequenceIndices, config } = request;
    const dataset = await datasetRepository.get(datasetId);
    if (!dataset) {
        throw new AnalysisError({
            code: 'dataset-missing',
            message: 'This dataset is no longer in local storage.',
            suggestion: 'Re-import the file, or pick a different dataset.',
        });
    }
    if (sequenceIndices.length < 2) {
        throw new AnalysisError({
            code: 'no-data',
            message: 'Alignment needs at least two sequences.',
            suggestion: 'Select two or more sequences in the table, then run the alignment.',
        });
    }
    if (sequenceIndices.length > config.maxSequences) {
        throw new AnalysisError({
            code: 'too-large',
            message: `${sequenceIndices.length} sequences were selected but the limit is ${config.maxSequences}.`,
            suggestion: `Select fewer sequences, or raise the alignment sequence limit in Settings. Center-star alignment does ${sequenceIndices.length - 1} pairwise alignments, so the cost grows linearly in sequence count and quadratically in length.`,
        });
    }
    context.report({ id: 'load', label: 'Loading sequences', value: 0.2 }, true);
    const sequences = await getSequencesByIndices(datasetId, sequenceIndices);
    if (sequences.length < 2) {
        throw new AnalysisError({
            code: 'no-data',
            message: 'The selected sequences could not be read from local storage.',
            suggestion: 'Reload the dataset and select the sequences again.',
        });
    }
    const notes = [];
    const tooLong = sequences.filter((s) => s.residues.length > config.maxLength);
    if (tooLong.length > 0) {
        throw new AnalysisError({
            code: 'too-large',
            message: `${tooLong.length} selected sequence${tooLong.length === 1 ? ' is' : 's are'} longer than the ${config.maxLength.toLocaleString()} residue alignment limit (longest: ${Math.max(...tooLong.map((s) => s.residues.length)).toLocaleString()}).`,
            suggestion: 'Raise the alignment length limit in Settings, or align a shorter region. Alignment memory grows with the product of the two lengths, so doubling the limit quadruples the requirement.',
            location: tooLong
                .slice(0, 3)
                .map((s) => s.id)
                .join(', '),
        });
    }
    context.complete('load', 'Loading sequences');
    const isProtein = dataset.sequenceType === 'protein';
    const matrix = resolveMatrix(config, isProtein);
    const options = {
        mode: config.mode,
        matrix,
        gapOpen: config.gapOpen,
        gapExtend: config.gapExtend,
    };
    const inputs = sequences.map((sequence) => ({
        id: sequence.id,
        index: sequence.index,
        residues: sequence.residues,
    }));
    let rows;
    let method;
    let score;
    let referenceRow = 0;
    if (inputs.length === 2) {
        const bytes = estimateMemoryBytes(inputs[0].residues.length, inputs[1].residues.length);
        if (bytes > MAX_TRACEBACK_BYTES) {
            throw new AnalysisError({
                code: 'too-large',
                message: `Aligning these two sequences needs about ${(bytes / (1024 * 1024)).toFixed(0)} MB for the traceback matrix, above the ${MAX_TRACEBACK_BYTES / (1024 * 1024)} MB limit.`,
                suggestion: 'Align shorter sequences or a sub-region. Exact alignment needs one byte per cell of the full length-by-length matrix; there is no way around that for an optimal result.',
                location: `${inputs[0].residues.length.toLocaleString()} x ${inputs[1].residues.length.toLocaleString()} residues`,
            });
        }
        context.report({ id: 'align', label: 'Aligning pair', value: 0.4 }, true);
        const pair = alignPairwise(inputs[0].residues, inputs[1].residues, options);
        context.complete('align', 'Aligning pair');
        rows = [
            { id: inputs[0].id, index: inputs[0].index, aligned: pair.alignedA },
            { id: inputs[1].id, index: inputs[1].index, aligned: pair.alignedB },
        ];
        method = 'pairwise-gotoh';
        score = pair.score;
        notes.push(`Optimal ${config.mode} alignment (Gotoh, affine gaps). Identity ${(pair.identity * 100).toFixed(1)}% over ${pair.length.toLocaleString()} columns: ${pair.matches.toLocaleString()} matches, ${pair.mismatches.toLocaleString()} mismatches, ${pair.gaps.toLocaleString()} gap columns.`);
        if (config.mode === 'local') {
            notes.push(`Local alignment covers positions ${pair.aStart + 1}-${pair.aEnd} of the first sequence and ${pair.bStart + 1}-${pair.bEnd} of the second; flanking residues are not shown.`);
        }
    }
    else {
        const center = pickCenterByLength(inputs);
        context.report({
            id: 'align',
            label: 'Aligning to centre sequence',
            value: 0,
            detail: `centre: ${inputs[center].id}`,
        }, true);
        const msa = alignMultiple(inputs, options, center, (completed, total) => {
            context.checkCancelled();
            context.report({
                id: 'align',
                label: 'Aligning to centre sequence',
                value: total === 0 ? 1 : completed / total,
                detail: `${completed} of ${total} pairwise alignments`,
            });
        });
        context.complete('align', 'Aligning to centre sequence');
        rows = msa.rows;
        method = 'center-star-progressive';
        score = msa.score;
        referenceRow = msa.centerRow;
        notes.push(`Center-star progressive alignment against "${inputs[center].id}", chosen as the median-length sequence. ` +
            'This is a heuristic: it performs n-1 alignments rather than the n^2 of a full guide tree, and columns where the centre is gapped carry no information about how the other sequences relate to each other. Divergent sets will align less accurately than under a profile-based aligner such as MAFFT.');
    }
    /* ----------------------------- column analysis -------------------------- */
    context.report({ id: 'analyze', label: 'Analysing columns', value: 0.5 }, true);
    const analysis = analyzeColumns(rows, config.consensusThreshold, config.conservedThreshold, isProtein ? 'X' : 'N');
    context.checkCancelled();
    const variants = callVariants(rows, referenceRow);
    const identity = meanPairwiseIdentity(rows);
    context.complete('analyze', 'Analysing columns');
    notes.push(`Conservation is the frequency of the most common non-gap residue in each column, measured over non-gap residues only; the gap fraction is reported separately so a column with two residues and many gaps is not mistaken for a well-supported one.`);
    notes.push(`Consensus calls a residue when it reaches ${(config.consensusThreshold * 100).toFixed(0)}% of the non-gap residues in a column, and '${isProtein ? 'X' : 'N'}' otherwise. Columns at or above ${(config.conservedThreshold * 100).toFixed(0)}% conservation are reported as conserved.`);
    notes.push(`Variants are tabulated per alignment column relative to "${rows[referenceRow]?.id ?? 'the reference'}". Consecutive columns are not merged into multi-base events.`);
    return {
        kind: 'alignment',
        datasetId,
        computedAt: Date.now(),
        configSnapshot: config,
        method,
        rows,
        consensus: analysis.consensus,
        columns: analysis.columns,
        conservedRegions: analysis.conservedRegions,
        variableRegions: analysis.variableRegions,
        variants: variants.variants,
        stats: {
            sequences: rows.length,
            alignmentLength: rows[0]?.aligned.length ?? 0,
            meanPairwiseIdentity: identity,
            gapFraction: analysis.gapFraction,
            substitutions: variants.substitutions,
            insertions: variants.insertions,
            deletions: variants.deletions,
            score,
        },
        notes,
    };
}
function resolveMatrix(config, isProtein) {
    if (!isProtein)
        return nucleotideMatrix(config.match, config.mismatch);
    switch (config.matrix) {
        case 'pam250':
            return PAM250;
        case 'identity':
            return identityMatrix();
        case 'blosum62':
        default:
            return BLOSUM62;
    }
}
