import { KmerSpectrumProvider } from './kmerSpectrum';
import { LocalProteinModelProvider } from './localModel';
/**
 * Embedding provider registry.
 *
 * Adding a backend means constructing it here; nothing else in the application
 * needs to change. The registry is the single place that knows which providers
 * exist, which is what makes the module extensible without the UI having to
 * enumerate implementations.
 */
const providers = [
    new KmerSpectrumProvider(),
    new LocalProteinModelProvider(),
];
export const listProviders = () => providers;
export const getProvider = (id) => providers.find((provider) => provider.info.id === id);
/** Provider info with a freshly probed availability status. */
export async function describeProviders() {
    return Promise.all(providers.map(async (provider) => ({
        ...provider.info,
        availability: await provider.probe(),
    })));
}
export const DEFAULT_PROVIDER_ID = 'kmer-spectrum';
