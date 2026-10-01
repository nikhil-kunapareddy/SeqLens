import type { AnalysisConfig } from '@/types';

/**
 * Default analysis configuration.
 *
 * Every number here is an inspection starting point, not a biological rule.
 * A 20% duplicate rate is alarming in whole-genome shotgun data and completely
 * expected in amplicon or deeply sequenced RNA-seq libraries; a 30% GC content
 * is normal for *Plasmodium* and abnormal for *Streptomyces*. The UI surfaces
 * each threshold next to the metric it governs so the reader can see which
 * value produced a given verdict, and Settings lets every one of them change.
 */
export const DEFAULT_CONFIG: AnalysisConfig = {
  qc: {
    minLength: 50,
    maxLength: 1_000_000,
    ambiguousWarn: 0.01,
    ambiguousReview: 0.05,
    duplicateWarn: 0.2,
    duplicateReview: 0.5,
    gcLowWarn: 25,
    gcHighWarn: 75,
    homopolymerMinRun: 12,
    lowComplexityEntropy: 1.2,
    lowComplexityWindow: 64,
    meanQualityWarn: 25,
    meanQualityReview: 20,
  },
  composition: {
    kValues: [3, 4, 5, 6],
    topKmers: 50,
    rareKmerMaxCount: 2,
    positionalCap: 500,
    canonicalKmers: false,
  },
  similarity: {
    sketchK: 8,
    sketchSize: 128,
    exactMaxSequences: 400,
    sampleSize: 300,
    clusterThreshold: 0.6,
    linkage: 'average',
    refineWithAlignment: true,
    maxRefinedPairs: 200,
  },
  orf: {
    minAminoAcids: 50,
    geneticCode: 1,
    requireStartCodon: true,
    searchReverseStrand: true,
    allowPartialOrfs: false,
    maxSequences: 5_000,
  },
  alignment: {
    mode: 'global',
    match: 2,
    mismatch: -1,
    gapOpen: 5,
    gapExtend: 2,
    matrix: 'blosum62',
    maxSequences: 60,
    maxLength: 6_000,
    consensusThreshold: 0.5,
    conservedThreshold: 0.9,
  },
  embedding: {
    providerId: 'kmer-spectrum',
    k: 4,
    reduction: 'pca',
    maxSequences: 2_000,
    umapNeighbors: 15,
    umapMinDist: 0.1,
    umapEpochs: 200,
    clusterCount: 6,
    seed: 42,
  },
  import: {
    maxSequences: 0,
    maxResidues: 0,
    blockResidues: 4_000_000,
    blockSequences: 5_000,
    uppercase: true,
  },
};

export type ThresholdField =
  | keyof AnalysisConfig['qc']
  | keyof AnalysisConfig['composition']
  | keyof AnalysisConfig['similarity'];

export interface MetricDoc {
  /** Short display name. */
  label: string;
  /** What the number measures. */
  what: string;
  /** How SeqLens computes it. */
  how: string;
  /** Why the default threshold is not universal. */
  caveat: string;
}

/**
 * Plain-language documentation for every headline metric, shown in tooltips,
 * QC check cards, and the generated HTML report. Keeping the prose beside the
 * defaults makes it hard for the two to drift apart.
 */
export const METRIC_DOCS: Record<string, MetricDoc> = {
  n50: {
    label: 'N50',
    what: 'The length such that half of all residues sit in sequences at least that long.',
    how: 'Sequences are sorted longest-first and lengths accumulated until the running total reaches 50% of the dataset total; the length of the sequence that crosses that mark is reported.',
    caveat:
      'N50 describes contiguity, not correctness. A misassembly that fuses two contigs raises N50 while making the assembly worse. It is also meaningless for read sets of uniform length.',
  },
  n90: {
    label: 'N90',
    what: 'The length such that 90% of all residues sit in sequences at least that long.',
    how: 'Same accumulation as N50, stopping at 90% of the total residue count.',
    caveat:
      'N90 is sensitive to the long tail of short sequences, which many pipelines filter out at a length the tool cannot know about.',
  },
  l50: {
    label: 'L50',
    what: 'The number of sequences needed to cover half the residues.',
    how: 'Count of sequences consumed while accumulating to the N50 point.',
    caveat: 'Interpretation depends entirely on the expected genome or transcriptome size.',
  },
  gc: {
    label: 'GC content',
    what: 'Percentage of unambiguous bases that are G or C.',
    how: 'Total G + C divided by total (A + C + G + T/U). Ambiguous IUPAC codes are excluded from both numerator and denominator.',
    caveat:
      'Genomic GC content spans roughly 17% to 75% across sequenced organisms. A GC value far from 50% is informative about the source organism, not about data quality. Bimodal GC distributions in a read set, however, often do indicate contamination.',
  },
  ambiguous: {
    label: 'Ambiguous bases',
    what: 'Percentage of residues that are valid IUPAC ambiguity codes rather than a single base.',
    how: 'Counts every residue outside A/C/G/T/U for nucleotides, or outside the 20 standard amino acids plus U and O for proteins.',
    caveat:
      'Assembly gaps are legitimately represented as long N runs, so a scaffolded assembly can have several percent N by design. In raw reads, the same value suggests a base-calling problem.',
  },
  duplicates: {
    label: 'Duplicate sequences',
    what: 'Sequences whose residues are byte-identical to an earlier sequence.',
    how: 'A 64-bit hash groups candidates, then residues are compared directly to eliminate hash collisions. The first occurrence of each group counts as unique.',
    caveat:
      'Exact duplication is expected in amplicon panels, in high-depth RNA-seq of abundant transcripts, and in any dataset of short reads where the sequence space is small. It is a red flag mainly for low-depth shotgun libraries.',
  },
  entropy: {
    label: 'Shannon entropy',
    what: 'Information content of the residue distribution, in bits per residue.',
    how: 'Negative sum of p*log2(p) over observed residue frequencies. The maximum is 2 bits for DNA (4 symbols) and about 4.32 bits for protein (20 symbols).',
    caveat:
      'Entropy is computed on composition alone and ignores order, so a tandem repeat with balanced composition scores as high-complexity. The sliding-window scan partially compensates.',
  },
  kmerEntropy: {
    label: 'k-mer entropy',
    what: 'Evenness of the k-mer frequency distribution.',
    how: 'Shannon entropy over observed k-mer counts, optionally normalised by log2(4^k).',
    caveat:
      'Short sequences cannot populate the k-mer space, so normalised entropy falls with sequence length independently of any biological signal.',
  },
  jaccard: {
    label: 'Jaccard similarity',
    what: 'Overlap of two sequences k-mer sets: intersection divided by union.',
    how: 'Estimated from MinHash sketches, which sample the same hash-ordered subset of k-mers from each sequence. Sketch size controls the accuracy of the estimate.',
    caveat:
      'k-mer Jaccard falls off sharply with sequence divergence and with differences in sequence length. Two sequences where one is a substring of the other score low even though one contains the other entirely.',
  },
  gravy: {
    label: 'GRAVY',
    what: 'Grand average of hydropathy: mean Kyte-Doolittle hydrophobicity.',
    how: 'Sum of per-residue Kyte-Doolittle values divided by residue count. Non-standard residues are skipped.',
    caveat:
      'A positive GRAVY suggests an overall hydrophobic protein but says nothing about the location of membrane-spanning segments.',
  },
  isoelectricPoint: {
    label: 'Isoelectric point',
    what: 'pH at which the polypeptide carries no net charge.',
    how: 'Bisection search on the Henderson-Hasselbalch net-charge curve using EMBOSS pKa values for the termini and the seven ionisable side chains.',
    caveat:
      'This is a sequence-only estimate. Real pI is shifted by structure, post-translational modification, and bound ligands, and commonly differs from the computed value by a few tenths of a pH unit.',
  },
  molecularWeight: {
    label: 'Molecular weight',
    what: 'Mass of the unmodified polypeptide chain in daltons.',
    how: 'Sum of average isotopic residue masses plus one water molecule. Ambiguous residues are skipped.',
    caveat:
      'Excludes signal-peptide cleavage, glycosylation, disulfide bond formation, and any other modification.',
  },
  perBaseQuality: {
    label: 'Per-position quality',
    what: 'Mean Phred score at each position along the read.',
    how: 'Phred scores are decoded with the detected offset and averaged per position across every read covering that position.',
    caveat:
      'Declining quality toward the 3′ end is normal for most sequencing chemistries. The absolute values are only comparable within one platform and run.',
  },
};
