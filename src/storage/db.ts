import Dexie, { type EntityTable } from 'dexie';
import type {
  AnalysisKind,
  Dataset,
  DatasetProfile,
  Project,
  ReportRecord,
  SequenceIndex,
  StoredResult,
} from '@/types';

/**
 * A contiguous run of sequences from one dataset.
 *
 * Residues from every sequence in the block are concatenated into a single
 * string, with `offsets` marking the boundaries. That layout matters at scale:
 * one record per sequence would mean one IndexedDB key, one structured-clone
 * envelope, and one JS string header per sequence, which for ten million short
 * reads costs more in overhead than the reads themselves. Concatenating into
 * blocks of a few megabytes turns that into a few thousand records, and a block
 * is also the natural unit for incremental processing: a worker can pull one
 * block, fold it into its accumulators, and drop it before pulling the next.
 */
export interface SequenceBlock {
  id?: number;
  datasetId: string;
  blockIndex: number;
  /** Global index within the dataset of this block's first sequence. */
  startIndex: number;
  count: number;
  /** Concatenated residues for every sequence in the block. */
  residues: string;
  /** `count + 1` boundaries into `residues`. */
  offsets: Uint32Array;
  ids: string[];
  descriptions: string[];
  /** Concatenated FASTQ quality, sharing `offsets`. Absent for FASTA. */
  quality?: string;
}

/** Locates a sequence index within a dataset's blocks without loading them. */
export interface BlockMap {
  datasetId: string;
  /** Global start index of each block, ascending. */
  starts: Uint32Array;
  /** Sequence count of each block. */
  counts: Uint32Array;
  /** Byte length of each block's residue string, for cache accounting. */
  residueLengths: Uint32Array;
}

/** Persisted user preferences. Stored as one row per key. */
export interface SettingRow {
  key: string;
  value: unknown;
}

export class SeqLensDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  datasets!: EntityTable<Dataset, 'id'>;
  blocks!: EntityTable<SequenceBlock, 'id'>;
  blockMaps!: EntityTable<BlockMap, 'datasetId'>;
  indexes!: EntityTable<SequenceIndex, 'datasetId'>;
  profiles!: EntityTable<DatasetProfile, 'datasetId'>;
  results!: EntityTable<StoredResult, 'id'>;
  reports!: EntityTable<ReportRecord, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

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
export const resultId = (datasetId: string, kind: AnalysisKind, configHash: string): string =>
  `${datasetId}:${kind}:${configHash}`;

/**
 * Reports how much of the origin's storage quota is in use.
 *
 * The figure is the browser's own estimate for the whole origin and is
 * deliberately imprecise - browsers pad it to avoid fingerprinting - but it is
 * the only number available, and users need some signal before importing a file
 * larger than their remaining quota.
 */
export async function estimateStorage(): Promise<{
  usage: number;
  quota: number;
  supported: boolean;
}> {
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
  } catch {
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
export async function requestPersistentStorage(): Promise<{
  granted: boolean;
  supported: boolean;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { granted: false, supported: false };
  }
  try {
    if (await navigator.storage.persisted()) return { granted: true, supported: true };
    return { granted: await navigator.storage.persist(), supported: true };
  } catch {
    return { granted: false, supported: false };
  }
}
