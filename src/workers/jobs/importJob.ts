import {
  FastaParser,
  FastqParser,
  countAmbiguous,
  countGc,
  detectFormatFromContent,
  detectQualityEncoding,
  detectSequenceType,
  hash64,
  meanPhred,
  PositionalComposition,
  validateResidues,
  type IncrementalParser,
  type ParsedRecord,
} from '@/bio';
import { GrowableFloat32Array, GrowableUint32Array } from '@/utils/growable';
import {
  blockRepository,
  datasetRepository,
  type SequenceBlock,
} from '@/storage';
import type {
  Dataset,
  DatasetProfile,
  FileFormat,
  ImportConfig,
  ImportJobRequest,
  ImportJobResult,
  ParseIssue,
  QualityEncoding,
  SequenceIndex,
  SequenceType,
} from '@/types';
import { AnalysisError, JobCancelledError, type JobContext } from '../context';

/** Text buffered before the record format is decided. */
const DETECTION_BYTES = 64 * 1024;

/** Records buffered before the molecule type is decided. */
const TYPE_SAMPLE_RECORDS = 64;

/** Residues sampled for molecule-type detection. */
const TYPE_SAMPLE_RESIDUES = 100_000;

/** Positions retained for the per-position composition and quality profiles. */
const POSITIONAL_CAP = 500;

/**
 * Streaming import.
 *
 * The file is read through a chain of native streams -
 * `File.stream()` -> byte counter -> optional `DecompressionStream('gzip')` ->
 * `TextDecoder` - and fed to an incremental parser in chunks. Nothing larger
 * than one block of residues is ever held in memory at once, so the memory
 * ceiling is set by the block size rather than by the file size: a 12 GB FASTQ
 * imports in the same footprint as a 12 MB one.
 *
 * Everything that later analyses need at the whole-dataset level is computed in
 * this single pass, because a second pass over the residues would mean reading
 * every block back out of IndexedDB. The pass produces:
 *
 *  - the per-sequence index (length, GC, ambiguity, residue hash, mean quality)
 *  - the dataset profile (residue totals, positional composition and quality,
 *    GC and quality histograms)
 *  - the sequence blocks themselves
 *
 * Progress is measured in compressed bytes read, which is the only figure known
 * in advance for a gzipped file.
 */
export async function runImportJob(
  request: ImportJobRequest,
  context: JobContext,
): Promise<ImportJobResult> {
  const { file, config, datasetId, projectId } = request;

  if (file.size === 0) {
    throw new AnalysisError({
      code: 'empty-file',
      message: `"${file.name}" is empty (0 bytes).`,
      suggestion: 'Check that the file finished downloading or copying before importing it.',
    });
  }

  const gzipped = await looksGzipped(file);
  if (gzipped && typeof DecompressionStream === 'undefined') {
    throw new AnalysisError({
      code: 'decompression-failed',
      message: 'This browser cannot decompress gzip files.',
      suggestion:
        'Decompress the file before importing it, or use a current version of Chrome, Edge, Firefox, or Safari.',
    });
  }

  const state = new ImportState(datasetId, projectId, file, gzipped, config, request.forcedType);

  try {
    await streamFile(file, gzipped, state, context);
    await state.finish(context);
  } catch (error) {
    // A failed or cancelled import must not leave half a dataset behind.
    await datasetRepository.discardPartialImport(datasetId);
    throw error;
  }

  return state.toResult();
}

/** Reads the first two bytes to check for the gzip magic number. */
async function looksGzipped(file: File): Promise<boolean> {
  const name = file.name.toLowerCase();
  const extensionSaysGzip = name.endsWith('.gz') || name.endsWith('.bgz') || name.endsWith('.gzip');
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const magic = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
    // The magic number is authoritative: a `.gz` name on plain text, and
    // gzipped bytes under a `.fastq` name, both occur.
    return magic || (extensionSaysGzip && head.length < 2);
  } catch {
    return extensionSaysGzip;
  }
}

async function streamFile(
  file: File,
  gzipped: boolean,
  state: ImportState,
  context: JobContext,
): Promise<void> {
  let bytesRead = 0;

  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  let byteStream: ReadableStream<Uint8Array> = file.stream().pipeThrough(counter);
  if (gzipped) {
    // `DecompressionStream` is typed as accepting `BufferSource`, which does not
    // unify with `ReadableStream<Uint8Array>` under TypeScript's stricter
    // ArrayBuffer generics. The runtime contract is satisfied; only the type
    // needs narrowing.
    byteStream = byteStream.pipeThrough(
      new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    );
  }

  const reader = byteStream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let detectionBuffer = '';
  let detecting = true;

  const reportProgress = (force = false) => {
    context.report(
      {
        id: 'parse',
        label: 'Parsing sequences',
        value: file.size === 0 ? null : Math.min(1, bytesRead / file.size),
        detail: `${state.sequenceCount.toLocaleString()} sequences · ${formatBytes(bytesRead)} of ${formatBytes(file.size)}${gzipped ? ' compressed' : ''}`,
      },
      force,
    );
  };

  try {
    while (true) {
      context.checkCancelled();
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (text.length === 0) continue;

      if (detecting) {
        detectionBuffer += text;
        if (detectionBuffer.length < DETECTION_BYTES) {
          reportProgress();
          continue;
        }
        state.beginParsing(detectionBuffer, file.name);
        detecting = false;
        await state.feed(detectionBuffer, context);
        detectionBuffer = '';
      } else {
        await state.feed(text, context);
      }

      reportProgress();
      if (state.limitReached) break;
    }

    // Flush the decoder's final bytes and any text still held for detection.
    const tail = decoder.decode();
    if (detecting) {
      detectionBuffer += tail;
      state.beginParsing(detectionBuffer, file.name);
      await state.feed(detectionBuffer, context);
    } else if (tail.length > 0) {
      await state.feed(tail, context);
    }

    await state.endParsing(context);
    bytesRead = file.size;
    reportProgress(true);
  } catch (error) {
    if (error instanceof JobCancelledError || error instanceof AnalysisError) throw error;
    if (gzipped) {
      throw new AnalysisError({
        code: 'decompression-failed',
        message: `"${file.name}" could not be decompressed.`,
        suggestion:
          'The file may be truncated or compressed with a format other than gzip. Browsers support gzip and zlib but not bzip2, xz, or zstd.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Accumulates everything the import produces.
 *
 * Held as a class rather than threaded through function arguments because there
 * are eighteen accumulators and they all advance together on every record.
 */
class ImportState {
  private readonly datasetId: string;
  private readonly projectId: string;
  private readonly file: File;
  private readonly gzipped: boolean;
  private readonly config: ImportConfig;
  private readonly forcedType?: SequenceType;

  private parser: IncrementalParser | null = null;
  private format: FileFormat = 'unknown';
  private formatReason = '';
  private sequenceType: SequenceType = 'unknown';
  private typeConfidence = 0;
  private typeReason = '';
  private qualityEncoding: QualityEncoding | undefined;
  private qualityOffset = 33;
  private extensionSuggestsProtein = false;

  /** Records held back until the molecule type is known. */
  private pendingRecords: ParsedRecord[] = [];
  private pendingResidues = 0;
  private typeResolved = false;

  // Per-sequence index columns.
  private readonly lengths = new GrowableUint32Array(4096);
  private readonly gcCounts = new GrowableUint32Array(4096);
  private readonly ambiguousCounts = new GrowableUint32Array(4096);
  private readonly hashLow = new GrowableUint32Array(4096);
  private readonly hashHigh = new GrowableUint32Array(4096);
  private readonly meanQuality = new GrowableFloat32Array(4096);
  private readonly idParts: string[] = [];
  private readonly idOffsets = new GrowableUint32Array(4096);
  private idBlobLength = 0;

  // Dataset-level accumulators.
  private readonly residueCounts = new Float64Array(128);
  private readonly positional = new PositionalComposition(POSITIONAL_CAP);
  private readonly positionalQualitySum = new Float64Array(POSITIONAL_CAP);
  private readonly qualityHistogram = new Uint32Array(61);
  private readonly readQualityHistogram = new Uint32Array(61);
  private readonly gcHistogram = new Uint32Array(101);
  private totalResidues = 0;
  private minLength = Number.POSITIVE_INFINITY;
  private maxLength = 0;

  // Block assembly.
  private blockResidues: string[] = [];
  private blockQuality: string[] = [];
  private blockIds: string[] = [];
  private blockDescriptions: string[] = [];
  private blockOffsets: number[] = [0];
  private blockResidueLength = 0;
  private blockStartIndex = 0;
  private blockIndex = 0;
  private pendingBlocks: SequenceBlock[] = [];
  private readonly blockStarts = new GrowableUint32Array(256);
  private readonly blockCounts = new GrowableUint32Array(256);
  private readonly blockResidueLengths = new GrowableUint32Array(256);

  private readonly invalidCharacterSet = new Set<string>();
  private invalidCharacterRecords = 0;
  private duplicateIdCount = 0;
  private readonly seenIds = new Set<string>();
  /** Above this many ids, duplicate-id detection stops to bound memory. */
  private static readonly ID_TRACKING_LIMIT = 2_000_000;

  sequenceCount = 0;
  limitReached = false;
  /** Characters decoded from the (possibly decompressed) stream. */
  private decompressedCharacters = 0;

  constructor(
    datasetId: string,
    projectId: string,
    file: File,
    gzipped: boolean,
    config: ImportConfig,
    forcedType?: SequenceType,
  ) {
    this.datasetId = datasetId;
    this.projectId = projectId;
    this.file = file;
    this.gzipped = gzipped;
    this.config = config;
    this.forcedType = forcedType;
    this.idOffsets.push(0);
  }

  /** Chooses a parser from the buffered head of the file. */
  beginParsing(head: string, fileName: string): void {
    const detection = detectFormatFromContent(head, fileName);
    this.format = detection.format;
    this.formatReason = detection.reason;
    this.extensionSuggestsProtein = detection.extensionSuggestsProtein;

    if (detection.format === 'unknown') {
      throw new AnalysisError({
        code: 'unsupported-format',
        message: `"${fileName}" does not look like a FASTA or FASTQ file.`,
        suggestion:
          'SeqLens reads FASTA (.fasta, .fa, .fna, .faa) and FASTQ (.fastq, .fq), optionally gzipped. Aligned formats such as SAM, BAM, or VCF are not supported.',
        location: detection.reason,
      });
    }

    this.parser =
      detection.format === 'fastq'
        ? new FastqParser({ uppercase: this.config.uppercase })
        : new FastaParser({ uppercase: this.config.uppercase });
  }

  async feed(text: string, context: JobContext): Promise<void> {
    if (this.parser === null) return;
    this.decompressedCharacters += text.length;
    const records: ParsedRecord[] = [];
    this.parser.push(text, (record) => records.push(record));
    await this.consume(records, context);
  }

  async endParsing(context: JobContext): Promise<void> {
    if (this.parser === null) return;
    const records: ParsedRecord[] = [];
    this.parser.end((record) => records.push(record));
    await this.consume(records, context);

    // Any records still held for type detection must be processed now.
    if (!this.typeResolved) {
      this.resolveType();
      const pending = this.pendingRecords;
      this.pendingRecords = [];
      for (const record of pending) {
        if (this.limitReached) break;
        this.accept(record);
      }
    }
  }

  private async consume(records: ParsedRecord[], context: JobContext): Promise<void> {
    for (const record of records) {
      if (this.limitReached) return;

      if (!this.typeResolved) {
        this.pendingRecords.push(record);
        this.pendingResidues += record.residues.length;
        if (
          this.pendingRecords.length >= TYPE_SAMPLE_RECORDS ||
          this.pendingResidues >= TYPE_SAMPLE_RESIDUES
        ) {
          this.resolveType();
          const pending = this.pendingRecords;
          this.pendingRecords = [];
          for (const pendingRecord of pending) {
            if (this.limitReached) break;
            this.accept(pendingRecord);
          }
        }
        continue;
      }

      this.accept(record);
    }

    context.checkCancelled();
    if (this.pendingBlocks.length > 0) await this.flushPendingBlocks();
  }

  /**
   * Decides the molecule type from the buffered sample.
   *
   * Detection is deferred rather than guessed from the first record because a
   * single short record is often ambiguous, and the type determines how GC and
   * ambiguity are counted for every sequence that follows.
   */
  private resolveType(): void {
    this.typeResolved = true;

    if (this.forcedType) {
      this.sequenceType = this.forcedType;
      this.typeConfidence = 1;
      this.typeReason = 'Set manually during import.';
      this.applyQualityEncoding();
      return;
    }

    let sample = '';
    for (const record of this.pendingRecords) {
      sample += record.residues;
      if (sample.length >= TYPE_SAMPLE_RESIDUES) break;
    }

    const detection = detectSequenceType(sample.slice(0, TYPE_SAMPLE_RESIDUES));
    this.sequenceType = detection.type;
    this.typeConfidence = detection.confidence;
    this.typeReason = detection.reason;

    // A `.faa` file is protein by convention; trust that over a weak call.
    if (this.extensionSuggestsProtein && detection.type !== 'protein') {
      this.sequenceType = 'protein';
      this.typeReason = `${detection.reason} The .faa extension indicates protein, which was used instead.`;
    }

    this.applyQualityEncoding();
  }

  private applyQualityEncoding(): void {
    if (this.format !== 'fastq') return;
    let sample = '';
    for (const record of this.pendingRecords) {
      if (record.quality) sample += record.quality;
      if (sample.length >= 20_000) break;
    }
    const detection = detectQualityEncoding(sample);
    this.qualityEncoding = detection.encoding;
    this.qualityOffset = detection.encoding === 'phred64' ? 64 : 33;
  }

  /** Folds one record into every accumulator and the current block. */
  private accept(record: ParsedRecord): void {
    const residues = record.residues;
    const length = residues.length;

    if (this.config.maxSequences > 0 && this.sequenceCount >= this.config.maxSequences) {
      this.limitReached = true;
      return;
    }
    if (this.config.maxResidues > 0 && this.totalResidues + length > this.config.maxResidues) {
      this.limitReached = true;
      return;
    }

    const index = this.sequenceCount;
    this.sequenceCount += 1;
    this.totalResidues += length;
    if (length < this.minLength) this.minLength = length;
    if (length > this.maxLength) this.maxLength = length;

    // Index columns.
    this.lengths.push(length);
    const digest = hash64(residues);
    this.hashLow.push(digest.low);
    this.hashHigh.push(digest.high);

    const ambiguous = countAmbiguous(residues, this.sequenceType);
    this.ambiguousCounts.push(ambiguous);

    if (this.sequenceType === 'protein') {
      this.gcCounts.push(0);
    } else {
      const gc = countGc(residues);
      this.gcCounts.push(gc);
      const unambiguous = length - ambiguous;
      if (unambiguous > 0) {
        this.gcHistogram[Math.round((gc / unambiguous) * 100)] += 1;
      }
    }

    // Identifier blob.
    this.idParts.push(record.id);
    this.idBlobLength += record.id.length;
    this.idOffsets.push(this.idBlobLength);

    // Residue totals and positional composition.
    for (let i = 0; i < length; i += 1) {
      const code = residues.charCodeAt(i);
      if (code < 128) this.residueCounts[code] += 1;
    }
    this.positional.add(residues);

    // Invalid characters: checked on a sample, because full validation of every
    // residue would double the import's per-byte cost for a check that is
    // almost always uniform across a file.
    if (index < 1000 || index % 1000 === 0) {
      const report = validateResidues(residues, this.sequenceType);
      if (!report.valid) {
        this.invalidCharacterRecords += 1;
        for (const character of report.invalidCharacters) {
          if (this.invalidCharacterSet.size < 12) this.invalidCharacterSet.add(character);
        }
      }
    }

    // Duplicate identifiers.
    if (this.seenIds.size < ImportState.ID_TRACKING_LIMIT) {
      if (this.seenIds.has(record.id)) this.duplicateIdCount += 1;
      else this.seenIds.add(record.id);
    }

    // Quality.
    if (record.quality !== undefined && record.quality.length > 0) {
      const quality = record.quality;
      const mean = meanPhred(quality, this.qualityOffset);
      this.meanQuality.push(mean);
      this.readQualityHistogram[Math.min(60, Math.max(0, Math.round(mean)))] += 1;
      const limit = Math.min(quality.length, POSITIONAL_CAP);
      for (let i = 0; i < limit; i += 1) {
        const score = Math.min(60, Math.max(0, quality.charCodeAt(i) - this.qualityOffset));
        this.positionalQualitySum[i] += score;
        this.qualityHistogram[score] += 1;
      }
      // Positions past the cap still contribute to the score histogram.
      for (let i = limit; i < quality.length; i += 1) {
        const score = Math.min(60, Math.max(0, quality.charCodeAt(i) - this.qualityOffset));
        this.qualityHistogram[score] += 1;
      }
    } else if (this.format === 'fastq') {
      this.meanQuality.push(0);
    }

    // Block assembly.
    this.blockIds.push(record.id);
    this.blockDescriptions.push(record.description);
    this.blockResidues.push(residues);
    if (record.quality !== undefined) {
      // Pad to the residue length so residues and quality share one offset array.
      this.blockQuality.push(
        record.quality.length === length
          ? record.quality
          : record.quality.slice(0, length).padEnd(length, '!'),
      );
    }
    this.blockResidueLength += length;
    this.blockOffsets.push(this.blockResidueLength);

    if (
      this.blockResidueLength >= this.config.blockResidues ||
      this.blockIds.length >= this.config.blockSequences
    ) {
      this.sealBlock();
    }
  }

  /** Converts the in-progress block into a record ready for writing. */
  private sealBlock(): void {
    if (this.blockIds.length === 0) return;

    const block: SequenceBlock = {
      datasetId: this.datasetId,
      blockIndex: this.blockIndex,
      startIndex: this.blockStartIndex,
      count: this.blockIds.length,
      residues: this.blockResidues.join(''),
      offsets: Uint32Array.from(this.blockOffsets),
      ids: this.blockIds,
      descriptions: this.blockDescriptions,
      quality: this.blockQuality.length > 0 ? this.blockQuality.join('') : undefined,
    };

    this.pendingBlocks.push(block);
    this.blockStarts.push(this.blockStartIndex);
    this.blockCounts.push(block.count);
    this.blockResidueLengths.push(block.residues.length);

    this.blockIndex += 1;
    this.blockStartIndex += block.count;
    this.blockResidues = [];
    this.blockQuality = [];
    this.blockIds = [];
    this.blockDescriptions = [];
    this.blockOffsets = [0];
    this.blockResidueLength = 0;
  }

  private async flushPendingBlocks(): Promise<void> {
    const blocks = this.pendingBlocks;
    this.pendingBlocks = [];
    await blockRepository.appendBlocks(blocks);
  }

  /** Writes the final block and the block map. */
  async finish(context: JobContext): Promise<void> {
    if (this.parser === null) {
      throw new AnalysisError({
        code: 'empty-file',
        message: `No sequence records were found in "${this.file.name}".`,
        suggestion:
          'Check that the file contains FASTA ">" headers or FASTQ "@" headers and is not, for example, a tabular or compressed archive.',
      });
    }

    this.sealBlock();
    await this.flushPendingBlocks();

    context.report({ id: 'store', label: 'Writing to local storage', value: 0.5 }, true);

    await blockRepository.writeBlockMap({
      datasetId: this.datasetId,
      starts: this.blockStarts.toTypedArray(),
      counts: this.blockCounts.toTypedArray(),
      residueLengths: this.blockResidueLengths.toTypedArray(),
    });

    if (this.sequenceCount === 0) {
      throw new AnalysisError({
        code: 'empty-file',
        message: `No sequence records were found in "${this.file.name}".`,
        suggestion: this.formatReason,
      });
    }

    context.complete('store', 'Writing to local storage');
  }

  toResult(): ImportJobResult {
    const index: SequenceIndex = {
      datasetId: this.datasetId,
      count: this.sequenceCount,
      lengths: this.lengths.toTypedArray(),
      gcCounts: this.gcCounts.toTypedArray(),
      ambiguousCounts: this.ambiguousCounts.toTypedArray(),
      hashLow: this.hashLow.toTypedArray(),
      hashHigh: this.hashHigh.toTypedArray(),
      meanQuality: this.meanQuality.toTypedArray(),
      idBlob: this.idParts.join(''),
      idOffsets: this.idOffsets.toTypedArray(),
    };

    const residueCounts: Record<string, number> = {};
    for (let code = 0; code < 128; code += 1) {
      if (this.residueCounts[code] > 0) {
        residueCounts[String.fromCharCode(code)] = this.residueCounts[code];
      }
    }

    const profile: DatasetProfile = {
      datasetId: this.datasetId,
      residueCounts,
      positionalCap: POSITIONAL_CAP,
      positionalComposition: this.positional.counts,
      positionalCoverage: this.positional.coverage,
      positionalQualitySum: this.positionalQualitySum,
      qualityHistogram: this.qualityHistogram,
      readQualityHistogram: this.readQualityHistogram,
      gcHistogram: this.gcHistogram,
      totalResidues: this.totalResidues,
    };

    const dataset: Dataset = {
      id: this.datasetId,
      projectId: this.projectId,
      fileName: this.file.name,
      fileSize: this.file.size,
      // Residues are ASCII, so one decoded character is one byte.
      decompressedSize: this.gzipped ? this.decompressedCharacters : undefined,
      gzipped: this.gzipped,
      format: this.format,
      sequenceType: this.sequenceType,
      typeConfidence: this.typeConfidence,
      typeDetectionNote: this.typeReason,
      qualityEncoding: this.qualityEncoding,
      importedAt: Date.now(),
      sequenceCount: this.sequenceCount,
      totalResidues: this.totalResidues,
      minLength: this.minLength === Number.POSITIVE_INFINITY ? 0 : this.minLength,
      maxLength: this.maxLength,
      blockCount: this.blockIndex,
      parseIssues: this.collectIssues(),
      truncated: this.limitReached,
    };

    return { dataset, index, profile };
  }

  private collectIssues(): ParseIssue[] {
    const issues: ParseIssue[] = this.parser ? [...this.parser.issues] : [];

    if (this.invalidCharacterRecords > 0) {
      const characters = [...this.invalidCharacterSet].map((c) => JSON.stringify(c)).join(', ');
      issues.push({
        kind: 'invalid-characters',
        count: this.invalidCharacterRecords,
        message: `Characters outside the ${this.sequenceType === 'protein' ? 'amino acid' : 'IUPAC nucleotide'} alphabet were found (${characters}). They were imported as-is and are excluded from composition statistics. If the detected sequence type is wrong, re-import with the type set manually.`,
      });
    }

    if (this.duplicateIdCount > 0) {
      issues.push({
        kind: 'duplicate-id',
        count: this.duplicateIdCount,
        message:
          'Some records share an identifier. Sequences are addressed by position, so nothing was lost, but identifier-based lookups may match more than one record.',
      });
    }

    if (this.limitReached) {
      issues.push({
        kind: 'limit-reached',
        count: 1,
        message: `Import stopped at the configured limit after ${this.sequenceCount.toLocaleString()} sequences. Statistics describe only the imported portion. Raise or clear the limit in Settings to import the whole file.`,
      });
    }

    return issues;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
