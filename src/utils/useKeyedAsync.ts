import { useEffect, useRef, useState } from 'react';

export interface KeyedAsyncState<T> {
  /** The loaded value, or null while loading or after a failure. */
  data: T | null;
  /** True when a load for the current key has not settled yet. */
  loading: boolean;
  error: Error | null;
}

/**
 * Loads a value derived from a key, discarding results for stale keys.
 *
 * This is the shape every page in SeqLens needs: read the sequence index, or a
 * sequence's residues, or the stored results for the selected dataset, and
 * re-read when the selection changes. Two things make it worth a hook rather
 * than an effect per page.
 *
 * First, staleness. Block reads resolve out of order when a user clicks through
 * datasets quickly, so a load started earlier can land after a later one. The
 * resolved key is stored alongside the data and compared on read, which makes a
 * stale result structurally unobservable rather than relying on a cleanup flag
 * winning a race.
 *
 * Second, `loading` is *derived* from whether the settled key matches the
 * requested one. The obvious alternative - clearing the data and setting a
 * loading flag at the top of the effect - calls setState synchronously during
 * an effect, which cascades an extra render on every key change and briefly
 * renders an empty state that then fills in.
 *
 * `key` must be a primitive: it is compared by identity in the dependency list.
 * Compose several values into one string where necessary.
 */
export function useKeyedAsync<K extends string | number | null, T>(
  key: K,
  load: (key: NonNullable<K>) => Promise<T>,
): KeyedAsyncState<T> {
  const [settled, setSettled] = useState<{
    key: K | undefined;
    data: T | null;
    error: Error | null;
  }>({ key: undefined, data: null, error: null });

  // The loader is usually an inline closure, so it is read through a ref rather
  // than depended on; depending on it would restart the load every render. The
  // ref is updated in its own effect, declared first so it has already run by
  // the time the load effect below fires.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (key === null || key === undefined) return;
    let cancelled = false;

    loadRef
      .current(key as NonNullable<K>)
      .then((data) => {
        if (!cancelled) setSettled({ key, data, error: null });
      })
      .catch((thrown: unknown) => {
        if (cancelled) return;
        setSettled({
          key,
          data: null,
          error: thrown instanceof Error ? thrown : new Error(String(thrown)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = settled.key === key;
  return {
    data: current ? settled.data : null,
    error: current ? settled.error : null,
    loading: key !== null && key !== undefined && !current,
  };
}
