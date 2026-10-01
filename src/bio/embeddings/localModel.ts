import type { EmbeddingAvailability, EmbeddingProviderInfo } from '@/types';
import {
  ProviderUnavailableError,
  type EmbedOptions,
  type EmbeddingBatch,
  type EmbeddingInput,
  type EmbeddingProvider,
} from './provider';

/**
 * Descriptor for a model the user has placed on this device.
 *
 * Nothing here points at a remote URL. A model becomes usable only when its
 * weights are present locally, which today means the user supplied them
 * through the file picker.
 */
export interface LocalModelDescriptor {
  id: string;
  name: string;
  /** Output embedding width. */
  dimensions: number;
  /** Which alphabet the model was trained on. */
  sequenceType: 'protein' | 'dna';
  /** Residues beyond this are truncated by the model's context window. */
  maxLength: number;
  /** Size of the weights on disk, in bytes. */
  sizeBytes: number;
  /** Runtime the weights require. */
  runtime: 'onnx';
}

/**
 * Registry of locally supplied model weights.
 *
 * Kept in module scope rather than persisted: model weights are hundreds of
 * megabytes, and copying them into IndexedDB to survive a reload would be a
 * poor trade. The user re-selects the file per session, which also means
 * SeqLens never retains a copy of anything it was not asked to retain.
 */
class LocalModelRegistry {
  private models = new Map<string, { descriptor: LocalModelDescriptor; weights: File }>();
  private listeners = new Set<() => void>();

  register(descriptor: LocalModelDescriptor, weights: File): void {
    this.models.set(descriptor.id, { descriptor, weights });
    this.notify();
  }

  unregister(id: string): void {
    this.models.delete(id);
    this.notify();
  }

  list(): LocalModelDescriptor[] {
    return [...this.models.values()].map((entry) => entry.descriptor);
  }

  get(id: string): { descriptor: LocalModelDescriptor; weights: File } | undefined {
    return this.models.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const localModelRegistry = new LocalModelRegistry();

/**
 * Protein language model embedding, via a locally supplied ONNX model.
 *
 * This provider is fully wired into the embedding pipeline - registry entry,
 * availability probe, progress reporting, cancellation - and deliberately
 * stops short of fabricating vectors. Running a real PLM in the browser needs
 * three things SeqLens does not ship:
 *
 *  1. An inference runtime. `onnxruntime-web` can run transformer inference via
 *     WASM or WebGPU, but it is a multi-megabyte dependency and pulling it in
 *     unused would be dead weight.
 *  2. Model weights. The smallest useful protein language model (ESM-2 t6, 8M
 *     parameters) is about 31 MB in fp32. Downloading it would contradict the
 *     guarantee that SeqLens makes no network requests, so the weights have to
 *     come from the user.
 *  3. A tokenizer matched to those weights.
 *
 * Until weights are registered, `probe` returns `unavailable` with that
 * explanation and `embed` throws rather than returning plausible-looking
 * numbers. Silent fallback to the k-mer provider would be worse than an error:
 * the user would believe they were looking at a language model's view of their
 * sequences.
 *
 * To finish this provider, implement `runInference` against
 * `onnxruntime-web`'s `InferenceSession`, created from the registered `File`
 * via `ArrayBuffer` so nothing is fetched, and mean-pool the per-residue hidden
 * states into one vector per sequence.
 */
export class LocalProteinModelProvider implements EmbeddingProvider {
  static readonly ID = 'local-onnx-plm';

  readonly info: EmbeddingProviderInfo = {
    id: LocalProteinModelProvider.ID,
    name: 'Protein language model (local ONNX)',
    description:
      'Mean-pooled residue embeddings from a transformer protein language model. Captures structural and evolutionary signal that k-mer counting cannot.',
    family: 'model',
    supports: ['protein'],
    dimensions: 'variable',
    availability: {
      status: 'unavailable',
      reason:
        'No model weights are present on this device. SeqLens will not download them, because that would send a request off-device; supply an ONNX model file to enable this provider.',
    },
    locality:
      'Would run entirely on this device through WebAssembly or WebGPU. Sequences are never transmitted; model weights must be supplied locally rather than fetched.',
  };

  async probe(): Promise<EmbeddingAvailability> {
    const models = localModelRegistry
      .list()
      .filter((model) => model.runtime === 'onnx' && model.sequenceType === 'protein');

    if (models.length === 0) {
      return {
        status: 'unavailable',
        reason:
          'No local protein model is registered. Register an ONNX model file in Settings to enable this provider. SeqLens does not download models, because a download would mean contacting a remote server.',
      };
    }

    // Weights are present, but the inference runtime is not bundled.
    return {
      status: 'unavailable',
      reason: `Model "${models[0].name}" is registered, but the ONNX inference runtime is not bundled in this build. Embedding cannot run without it, and SeqLens will not fetch it at runtime.`,
    };
  }

  async embed(_sequences: EmbeddingInput[], _options: EmbedOptions): Promise<EmbeddingBatch> {
    const availability = await this.probe();
    const reason =
      availability.status === 'available'
        ? 'The inference runtime is not implemented in this build.'
        : availability.reason;
    throw new ProviderUnavailableError(LocalProteinModelProvider.ID, reason);
  }
}
