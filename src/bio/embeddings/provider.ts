import type { EmbeddingAvailability, EmbeddingProviderInfo, SequenceType } from '@/types';

export interface EmbeddingInput {
  index: number;
  id: string;
  residues: string;
}

export interface EmbeddingBatch {
  /** Row-major `count * dimensions`. */
  vectors: Float32Array;
  dimensions: number;
  /** Notes worth showing beside the result (reductions applied, caps hit). */
  notes: string[];
}

export interface EmbedOptions {
  sequenceType: SequenceType;
  /** k for k-mer based providers. */
  k: number;
  /** Called with a 0..1 fraction; return false to cancel. */
  onProgress?: (completed: number, total: number) => boolean | void;
}

/**
 * Contract every embedding backend implements.
 *
 * The interface exists so that a real protein language model can be added
 * without touching the reduction, clustering, or explorer code: a provider
 * takes residue strings and returns fixed-length vectors, and nothing
 * downstream cares whether those came from a counting argument or a
 * transformer.
 *
 * `probe` is the honesty mechanism. A provider that cannot run - because no
 * model weights are present on the device, or because the runtime is missing -
 * reports `unavailable` with a reason, and the UI marks it as such. No provider
 * is permitted to reach the network: doing so would send sequence data off the
 * device, which is the one thing SeqLens guarantees it will not do.
 */
export interface EmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  /** Checks whether the provider can run right now, on this device. */
  probe(): Promise<EmbeddingAvailability>;
  embed(sequences: EmbeddingInput[], options: EmbedOptions): Promise<EmbeddingBatch>;
}

export class ProviderUnavailableError extends Error {
  readonly providerId: string;
  readonly reason: string;

  constructor(providerId: string, reason: string) {
    super(reason);
    this.name = 'ProviderUnavailableError';
    this.providerId = providerId;
    this.reason = reason;
  }
}
