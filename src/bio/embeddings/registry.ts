import type { EmbeddingProviderInfo } from '@/types';
import { KmerSpectrumProvider } from './kmerSpectrum';
import { LocalProteinModelProvider } from './localModel';
import type { EmbeddingProvider } from './provider';

/**
 * Embedding provider registry.
 *
 * Adding a backend means constructing it here; nothing else in the application
 * needs to change. The registry is the single place that knows which providers
 * exist, which is what makes the module extensible without the UI having to
 * enumerate implementations.
 */
const providers: EmbeddingProvider[] = [
  new KmerSpectrumProvider(),
  new LocalProteinModelProvider(),
];

export const listProviders = (): EmbeddingProvider[] => providers;

export const getProvider = (id: string): EmbeddingProvider | undefined =>
  providers.find((provider) => provider.info.id === id);

/** Provider info with a freshly probed availability status. */
export async function describeProviders(): Promise<EmbeddingProviderInfo[]> {
  return Promise.all(
    providers.map(async (provider) => ({
      ...provider.info,
      availability: await provider.probe(),
    })),
  );
}

export const DEFAULT_PROVIDER_ID = 'kmer-spectrum';
