/**
 * Core domain types for SeqLens.
 *
 * These types are deliberately free of React and IndexedDB concerns so that the
 * algorithms in `src/bio` and the persistence layer in `src/storage` can be
 * tested and reused independently of the UI.
 */

export const APP_VERSION = '1.0.0';

/** Molecule alphabet of a sequence or dataset. */
export type SequenceType = 'dna' | 'rna' | 'protein' | 'unknown';

/** On-disk record format of an imported file. */
export type FileFormat = 'fasta' | 'fastq' | 'unknown';

/** Phred quality encoding offset used by a FASTQ file. */
export type QualityEncoding = 'phred33' | 'phred64';

/** A single sequence record, fully materialised in memory. */
export interface Sequence {
  /** Identifier: the first whitespace-delimited token of the header. */
  id: string;
  /** Remainder of the header line, or empty string. */
  description: string;
  /** Residues, uppercase, without line breaks. */
  residues: string;
  /** Raw FASTQ quality string, present only for FASTQ records. */
  quality?: string;
  /** Zero-based ordinal position within the dataset. */
  index: number;
}

/** Sequence plus the dataset it belongs to. Used by cross-dataset views. */
export interface SequenceRef extends Sequence {
  datasetId: string;
}

/* -------------------------------------------------------------------------- */
/* Projects and datasets                                                      */
/* -------------------------------------------------------------------------- */

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  /** Ids of datasets belonging to this project. */
  datasetIds: string[];
  /** Persisted analysis configuration; makes stored results reproducible. */
  config: AnalysisConfig;
}

/** Metadata and summary statistics for one imported file. */
export interface Dataset {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  /** Size of the decompressed payload, when the source was gzipped. */
  decompressedSize?: number;
  gzipped: boolean;
  format: FileFormat;
  sequenceType: SequenceType;
  /** Confidence of the detected sequence type, 0..1. */
  typeConfidence: number;
  /** Plain-language explanation of how the sequence type was decided. */
  typeDetectionNote: string;
  qualityEncoding?: QualityEncoding;
  importedAt: number;
  sequenceCount: number;
  totalResidues: number;
  minLength: number;
  maxLength: number;
  /** Number of sequence blocks written to the block store. */
  blockCount: number;
  /** Records the parser skipped or repaired, with reasons. */
  parseIssues: ParseIssue[];
  /** True when import stopped early because a configured limit was reached. */
  truncated: boolean;
}

export interface ParseIssue {
  kind:
    | 'empty-sequence'
    | 'missing-header'
    | 'invalid-characters'
    | 'quality-length-mismatch'
    | 'truncated-record'
    | 'duplicate-id'
    | 'limit-reached';
  /** 1-based line number in the decompressed stream, when known. */
  line?: number;
  /** Sequence identifier, when known. */
  sequenceId?: string;
  message: string;
  count: number;
}

/* -------------------------------------------------------------------------- */
/* Compact per-dataset index                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Column-oriented index over every sequence in a dataset.
 *
 * Holding these as typed arrays keeps whole-dataset statistics, sorting, and
 * table rendering possible without ever loading residues into memory. For a
 * one-million-sequence dataset this structure is roughly 24 MB rather than the
 * gigabytes the residues themselves would occupy.
 */
export interface SequenceIndex {
  datasetId: string;
  count: number;
  lengths: Uint32Array;
  /** G + C counts (nucleotide datasets only; zeroed for protein). */
  gcCounts: Uint32Array;
  /** Count of residues outside the canonical alphabet but still valid IUPAC. */
  ambiguousCounts: Uint32Array;
  /** Low 32 bits of a 64-bit residue hash, for duplicate grouping. */
  hashLow: Uint32Array;
  /** High 32 bits of the same hash. */
  hashHigh: Uint32Array;
  /** Mean Phred quality per record; empty for FASTA. */
  meanQuality: Float32Array;
  /** All identifiers concatenated; `idOffsets` delimits them. */
  idBlob: string;
  /** Start offset of each id within `idBlob`; length is count + 1. */
  idOffsets: Uint32Array;
}

/**
 * Whole-dataset accumulators gathered during the single parsing pass.
 * Positional arrays are capped at `positionalCap` positions.
 */
export interface DatasetProfile {
  datasetId: string;
  /** Total occurrences of every residue character seen. */
  residueCounts: Record<string, number>;
  /** Number of positions retained in the positional arrays. */
  positionalCap: number;
  /** Per-position counts for A, C, G, T/U, other - 5 rows of positionalCap. */
  positionalComposition: Uint32Array;
  /** Number of sequences covering each position, used as the denominator. */
  positionalCoverage: Uint32Array;
  /** Sum of Phred scores per position (FASTQ only). */
  positionalQualitySum: Float64Array;
  /** Histogram of per-base Phred scores, index = score 0..60 (FASTQ only). */
  qualityHistogram: Uint32Array;
  /** Histogram of per-read mean Phred scores, index = rounded score (FASTQ). */
  readQualityHistogram: Uint32Array;
  /** Histogram of per-sequence GC percentage, 101 bins (0..100). */
  gcHistogram: Uint32Array;
  /** Sum of lengths, kept as a double to survive very large datasets. */
  totalResidues: number;
}

/* -------------------------------------------------------------------------- */
/* Analysis configuration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every threshold that influences a PASS / WARNING / REVIEW verdict lives here.
 *
 * None of these values are biologically universal: a GC content that is normal
 * for one organism is an outlier for another, and duplicate rates that indicate
 * PCR artefacts in DNA-seq are expected in amplicon or RNA-seq data. They are
 * starting points for inspection, not a verdict on data quality.
 */
export interface QCThresholds {
  /** Sequences at or below this length are flagged as extremely short. */
  minLength: number;
  /** Sequences at or above this length are flagged as extremely long. */
  maxLength: number;
  /** Per-sequence ambiguous-base fraction that triggers a WARNING. */
  ambiguousWarn: number;
  /** Per-sequence ambiguous-base fraction that triggers a REVIEW. */
  ambiguousReview: number;
  /** Duplicate fraction of the dataset that triggers a WARNING. */
  duplicateWarn: number;
  /** Duplicate fraction that triggers a REVIEW. */
  duplicateReview: number;
  /** Acceptable GC percentage band; outside the band triggers a WARNING. */
  gcLowWarn: number;
  gcHighWarn: number;
  /** Shortest run of one residue counted as a homopolymer. */
  homopolymerMinRun: number;
  /** Shannon entropy (bits/residue) below which a sequence is low-complexity. */
  lowComplexityEntropy: number;
  /** Window size used for the sliding low-complexity scan. */
  lowComplexityWindow: number;
  /** Mean read Phred below this triggers a WARNING (FASTQ only). */
  meanQualityWarn: number;
  /** Mean read Phred below this triggers a REVIEW (FASTQ only). */
  meanQualityReview: number;
}

export interface CompositionConfig {
  /** k values to compute k-mer spectra for. */
  kValues: number[];
  /** Number of top k-mers retained per k. */
  topKmers: number;
  /** Count below which a k-mer is reported as rare. */
  rareKmerMaxCount: number;
  /** Cap on positional composition columns. */
  positionalCap: number;
  /** Treat reverse-complement k-mer pairs as one canonical k-mer. */
  canonicalKmers: boolean;
}

export interface SimilarityConfig {
  /** k-mer size used to build MinHash sketches. */
  sketchK: number;
  /** Number of hash functions in each sketch. */
  sketchSize: number;
  /** Above this sequence count, similarity runs on a deterministic sample. */
  exactMaxSequences: number;
  /** Number of sequences retained when sampling. */
  sampleSize: number;
  /** Jaccard similarity at which two sequences join the same cluster. */
  clusterThreshold: number;
  /** Linkage rule for hierarchical clustering. */
  linkage: 'single' | 'complete' | 'average';
  /** Compute exact alignment identity for candidate pairs above threshold. */
  refineWithAlignment: boolean;
  /** Maximum number of pairs to refine with alignment. */
  maxRefinedPairs: number;
}

export interface OrfConfig {
  /** Minimum ORF length in amino acids, excluding the stop codon. */
  minAminoAcids: number;
  /** NCBI genetic code table id. */
  geneticCode: number;
  /** Require a table-specific start codon. */
  requireStartCodon: boolean;
  /** Include ORFs on the reverse-complement strand. */
  searchReverseStrand: boolean;
  /** Report ORFs that run off the end of the sequence without a stop. */
  allowPartialOrfs: boolean;
  /** Maximum sequences to scan in one run. */
  maxSequences: number;
}

export interface AlignmentConfig {
  mode: 'global' | 'local';
  /** Match/mismatch scores used for nucleotide alignments. */
  match: number;
  mismatch: number;
  /** Affine gap penalties; both are positive costs. */
  gapOpen: number;
  gapExtend: number;
  /** Substitution matrix used for protein alignments. */
  matrix: 'blosum62' | 'pam250' | 'identity';
  /** Cap on sequences included in a multiple alignment. */
  maxSequences: number;
  /** Cap on sequence length for a multiple alignment. */
  maxLength: number;
  /** Fraction of non-gap residues that must agree for a consensus call. */
  consensusThreshold: number;
  /** Column conservation at or above this fraction counts as conserved. */
  conservedThreshold: number;
}

export interface EmbeddingConfig {
  /** Registered provider id; see `src/bio/embeddings/registry.ts`. */
  providerId: string;
  /** k used by the k-mer spectrum provider. */
  k: number;
  /** Reduction method for the 2-D explorer. */
  reduction: 'pca' | 'umap';
  /** Maximum sequences embedded in one run. */
  maxSequences: number;
  /** UMAP neighbourhood size. */
  umapNeighbors: number;
  /** UMAP minimum separation of projected points. */
  umapMinDist: number;
  /** UMAP optimisation epochs. */
  umapEpochs: number;
  /** Number of k-means clusters computed in embedding space. */
  clusterCount: number;
  /** Seed for every stochastic step, so runs are reproducible. */
  seed: number;
}

export interface ImportConfig {
  /** Stop importing after this many sequences (0 = unlimited). */
  maxSequences: number;
  /** Stop importing after this many residues (0 = unlimited). */
  maxResidues: number;
  /** Target residue count per stored block. */
  blockResidues: number;
  /** Maximum sequences per stored block. */
  blockSequences: number;
  /** Convert residues to uppercase on import. */
  uppercase: boolean;
}

export interface AnalysisConfig {
  qc: QCThresholds;
  composition: CompositionConfig;
  similarity: SimilarityConfig;
  orf: OrfConfig;
  alignment: AlignmentConfig;
  embedding: EmbeddingConfig;
  import: ImportConfig;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export type QCStatus = 'pass' | 'warning' | 'review' | 'not-applicable';

export interface QCCheck {
  id: string;
  label: string;
  status: QCStatus;
  /** Human-readable value, already formatted. */
  value: string;
  /** What the metric measures and how it was computed. */
  explanation: string;
  /** Which configured threshold produced this status. */
  thresholdNote: string;
  /** Count of sequences implicated, when the check is sequence-level. */
  affected?: number;
}

export interface LengthHistogramBin {
  /** Inclusive lower bound of the bin. */
  from: number;
  /** Exclusive upper bound of the bin. */
  to: number;
  count: number;
}

export interface DuplicateGroup {
  /** Hash of the shared residue string. */
  hash: string;
  count: number;
  length: number;
  /** Identifiers in the group, capped for display. */
  ids: string[];
  /** Index of the representative (first-seen) sequence. */
  representativeIndex: number;
}

export type SequenceFlagKind =
  | 'invalid-characters'
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'ambiguous'
  | 'homopolymer'
  | 'low-complexity'
  | 'duplicate';

export interface SequenceFlag {
  index: number;
  id: string;
  length: number;
  flags: SequenceFlagKind[];
  /** Longest homopolymer run found, when the homopolymer flag is set. */
  longestRun?: number;
  /** Residue forming the longest run. */
  runResidue?: string;
  /** Shannon entropy in bits per residue. */
  entropy?: number;
  /** Fraction of ambiguous residues. */
  ambiguousFraction?: number;
  /** Characters found outside the IUPAC alphabet. */
  invalidCharacters?: string[];
}

export interface QCResult {
  kind: 'qc';
  datasetId: string;
  computedAt: number;
  configSnapshot: QCThresholds;
  /** Overall verdict: the most severe individual check. */
  overallStatus: QCStatus;
  checks: QCCheck[];
  stats: {
    sequenceCount: number;
    totalResidues: number;
    minLength: number;
    maxLength: number;
    meanLength: number;
    medianLength: number;
    n50: number;
    n90: number;
    l50: number;
    gcPercent: number;
    ambiguousPercent: number;
    duplicateSequences: number;
    duplicateGroups: number;
    uniquePercent: number;
    meanQuality: number | null;
  };
  lengthHistogram: LengthHistogramBin[];
  gcHistogram: { gc: number; count: number }[];
  nucleotideComposition: { residue: string; count: number; percent: number }[];
  ambiguousHistogram: { bucket: string; count: number }[];
  duplicateHistogram: { copies: number; groups: number; sequences: number }[];
  topLengths: { length: number; count: number }[];
  duplicateGroups: DuplicateGroup[];
  flaggedSequences: SequenceFlag[];
  flagCounts: Record<SequenceFlagKind, number>;
  /** Per-position quality, FASTQ only. */
  perPositionQuality: { position: number; mean: number; coverage: number }[];
  /** Per-read mean quality distribution, FASTQ only. */
  readQualityHistogram: { score: number; count: number }[];
  /** Per-position base composition percentages. */
  positionalComposition: {
    position: number;
    A: number;
    C: number;
    G: number;
    T: number;
    N: number;
  }[];
  notes: string[];
}

export interface KmerEntry {
  kmer: string;
  count: number;
  frequency: number;
}

export interface KmerSpectrum {
  k: number;
  /** Number of distinct k-mers observed. */
  distinct: number;
  /** Number of k-mer positions counted. */
  total: number;
  /** Maximum distinct k-mers possible for the alphabet. */
  possible: number;
  /** Shannon entropy of the k-mer distribution, in bits. */
  entropy: number;
  /** Entropy normalised by log2(possible). */
  normalizedEntropy: number;
  /** Highest-count k-mers, descending. */
  top: KmerEntry[];
  /** k-mers at or below the configured rare threshold. */
  rare: KmerEntry[];
  /** Number of rare k-mers, which may exceed the returned sample. */
  rareCount: number;
  /** True when counting used an exact dense table rather than a hash map. */
  exact: boolean;
  /** True when reverse-complement pairs were merged. */
  canonical: boolean;
}

export interface ProteinProperties {
  /** GRAVY score: mean Kyte-Doolittle hydropathy. */
  gravy: number;
  /** Molecular weight in daltons, average isotopic masses. */
  molecularWeight: number;
  /** Isoelectric point estimated from the Henderson-Hasselbalch curve. */
  isoelectricPoint: number;
  /** Net charge at pH 7.0. */
  netChargeAtPh7: number;
  positiveResidues: number;
  negativeResidues: number;
  aromaticResidues: number;
  /** Fraction of residues with positive Kyte-Doolittle hydropathy. */
  hydrophobicFraction: number;
  /** Extinction coefficient at 280 nm, M^-1 cm^-1, cysteines reduced. */
  extinctionCoefficient: number;
}

export interface LowComplexityRegion {
  sequenceIndex: number;
  sequenceId: string;
  start: number;
  end: number;
  entropy: number;
  dominantResidue: string;
}

export interface CompositionResult {
  kind: 'composition';
  datasetId: string;
  computedAt: number;
  configSnapshot: CompositionConfig;
  sequenceType: SequenceType;
  residueComposition: { residue: string; count: number; percent: number }[];
  /** Nucleotide-only metrics; null for protein datasets. */
  nucleotide: {
    gcPercent: number;
    atPercent: number;
    gcSkew: number;
    atSkew: number;
    cpgCount: number;
    cpgObservedExpected: number;
    entropyBitsPerBase: number;
    ambiguousPercent: number;
  } | null;
  /** Protein-only metrics; null for nucleotide datasets. */
  protein: {
    aggregate: ProteinProperties;
    /** Per-sequence properties for the sampled sequences. */
    perSequenceSample: (ProteinProperties & {
      id: string;
      index: number;
      length: number;
    })[];
    chargeDistribution: { bucket: string; count: number }[];
    hydrophobicityDistribution: { bucket: string; count: number }[];
    molecularWeightDistribution: { bucket: string; count: number }[];
    lowComplexityRegions: LowComplexityRegion[];
  } | null;
  positionalComposition: Record<string, number>[];
  kmerSpectra: KmerSpectrum[];
  /** Number of sequences actually visited (may be a sample of large datasets). */
  sequencesAnalyzed: number;
  notes: string[];
}

export interface SimilarityPair {
  a: number;
  b: number;
  /** Estimated Jaccard similarity of the k-mer sketches, 0..1. */
  jaccard: number;
  /** Exact alignment identity, present only when refinement ran. */
  identity?: number;
  /** Alignment length used for the identity calculation. */
  alignedLength?: number;
}

export interface ClusterAssignment {
  clusterId: number;
  /** Indices into the similarity result's `members` array. */
  memberIndices: number[];
  representativeIndex: number;
  representativeId: string;
  /** Mean intra-cluster Jaccard similarity. */
  meanSimilarity: number;
}

/** Node in a hierarchical clustering tree. Leaves carry `memberIndex`. */
export interface DendrogramNode {
  id: number;
  height: number;
  size: number;
  memberIndex?: number;
  label?: string;
  children?: [DendrogramNode, DendrogramNode];
}

export interface SimilarityMember {
  index: number;
  id: string;
  length: number;
  gcPercent: number;
}

export interface SimilarityResult {
  kind: 'similarity';
  datasetId: string;
  computedAt: number;
  configSnapshot: SimilarityConfig;
  /** Sequences included in the comparison, after any sampling. */
  members: SimilarityMember[];
  /** True when the dataset was subsampled rather than compared exhaustively. */
  sampled: boolean;
  totalSequences: number;
  /** Condensed upper-triangular Jaccard matrix over `members`. */
  matrix: Float32Array;
  matrixSize: number;
  topPairs: SimilarityPair[];
  clusters: ClusterAssignment[];
  dendrogram: DendrogramNode | null;
  exactDuplicateGroups: DuplicateGroup[];
  stats: {
    meanJaccard: number;
    medianJaccard: number;
    maxJaccard: number;
    pairsCompared: number;
    pairsRefined: number;
    redundantFraction: number;
  };
  notes: string[];
}

export interface Orf {
  sequenceIndex: number;
  sequenceId: string;
  /** 1-based inclusive start on the forward strand of the input sequence. */
  start: number;
  /** 1-based inclusive end on the forward strand of the input sequence. */
  end: number;
  strand: '+' | '-';
  /** Reading frame 1..3 relative to the strand's own 5' end. */
  frame: 1 | 2 | 3;
  /** Nucleotide length, including the stop codon when present. */
  nucleotideLength: number;
  /** Amino acid length, excluding the stop codon. */
  aminoAcidLength: number;
  startCodon: string;
  stopCodon: string | null;
  /** True when the ORF has no in-sequence stop codon. */
  partial: boolean;
  protein: string;
}

export interface FrameTranslation {
  strand: '+' | '-';
  frame: 1 | 2 | 3;
  protein: string;
  stopCount: number;
  /** Longest uninterrupted stretch without a stop codon, in residues. */
  longestStretch: number;
}

export interface OrfResult {
  kind: 'orf';
  datasetId: string;
  computedAt: number;
  configSnapshot: OrfConfig;
  orfs: Orf[];
  stats: {
    sequencesScanned: number;
    sequencesWithOrf: number;
    orfCount: number;
    meanOrfLength: number;
    medianOrfLength: number;
    maxOrfLength: number;
    totalCodingBases: number;
    codingFraction: number;
  };
  lengthHistogram: LengthHistogramBin[];
  perFrameCounts: { frame: string; count: number }[];
  startCodonUsage: { codon: string; count: number }[];
  stopCodonUsage: { codon: string; count: number }[];
  notes: string[];
}

export interface AlignmentColumn {
  position: number;
  consensus: string;
  /** Fraction of non-gap residues matching the consensus. */
  conservation: number;
  gapFraction: number;
  /** Shannon entropy of the column, in bits. */
  entropy: number;
}

export interface AlignedVariant {
  column: number;
  kind: 'substitution' | 'insertion' | 'deletion';
  reference: string;
  observed: string;
  /** Number of aligned sequences carrying this variant. */
  count: number;
  /** Ids of sequences carrying it, capped for display. */
  sequenceIds: string[];
}

export interface AlignmentResult {
  kind: 'alignment';
  datasetId: string;
  computedAt: number;
  configSnapshot: AlignmentConfig;
  /** Alignment strategy actually used. */
  method: 'pairwise-gotoh' | 'center-star-progressive';
  rows: { id: string; index: number; aligned: string }[];
  consensus: string;
  columns: AlignmentColumn[];
  conservedRegions: { start: number; end: number; meanConservation: number }[];
  variableRegions: { start: number; end: number; meanConservation: number }[];
  variants: AlignedVariant[];
  stats: {
    sequences: number;
    alignmentLength: number;
    meanPairwiseIdentity: number;
    gapFraction: number;
    substitutions: number;
    insertions: number;
    deletions: number;
    score?: number;
  };
  notes: string[];
}

export type EmbeddingAvailability =
  | { status: 'available' }
  | { status: 'unavailable'; reason: string }
  | { status: 'experimental'; reason: string };

export interface EmbeddingProviderInfo {
  id: string;
  name: string;
  /** One-line description of what the vectors represent. */
  description: string;
  /** 'deterministic' for analytic featurisation, 'model' for a learned model. */
  family: 'deterministic' | 'model';
  /** Which alphabets the provider accepts. */
  supports: SequenceType[];
  dimensions: number | 'variable';
  availability: EmbeddingAvailability;
  /** Explains where the computation runs and what leaves the device. */
  locality: string;
}

export interface EmbeddingPoint {
  index: number;
  id: string;
  length: number;
  gcPercent: number;
  x: number;
  y: number;
  cluster: number;
}

export interface EmbeddingResult {
  kind: 'embedding';
  datasetId: string;
  computedAt: number;
  configSnapshot: EmbeddingConfig;
  providerId: string;
  providerName: string;
  dimensions: number;
  reduction: 'pca' | 'umap';
  points: EmbeddingPoint[];
  /** Full-dimensional vectors, row-major, retained for neighbour queries. */
  vectors: Float32Array;
  /** Explained variance ratio per component; PCA only. */
  explainedVariance: number[];
  clusterSummary: {
    cluster: number;
    size: number;
    meanGc: number;
    meanLength: number;
  }[];
  sampled: boolean;
  totalSequences: number;
  notes: string[];
}

export type AnalysisResult =
  | QCResult
  | CompositionResult
  | SimilarityResult
  | OrfResult
  | AlignmentResult
  | EmbeddingResult;

export type AnalysisKind = AnalysisResult['kind'];

/** Persisted envelope around an analysis result. */
export interface StoredResult<T extends AnalysisResult = AnalysisResult> {
  id: string;
  projectId: string;
  datasetId: string;
  kind: AnalysisKind;
  computedAt: number;
  /** Stable hash of the configuration used, for cache lookups. */
  configHash: string;
  /** Milliseconds of wall-clock compute time. */
  durationMs: number;
  result: T;
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

export interface ReportSectionSelection {
  overview: boolean;
  qc: boolean;
  composition: boolean;
  kmer: boolean;
  redundancy: boolean;
  similarity: boolean;
  orf: boolean;
  alignment: boolean;
  embedding: boolean;
}

export interface ReportRecord {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  appVersion: string;
  sections: ReportSectionSelection;
  datasetIds: string[];
  /** Serialized, self-contained HTML document. */
  html: string;
  /** Byte length of the HTML, for display. */
  sizeBytes: number;
  configSnapshot: AnalysisConfig;
}
