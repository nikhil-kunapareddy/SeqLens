import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
/**
 * Returns a value that lags behind its input until it stops changing.
 *
 * Search boxes in SeqLens filter tables of hundreds of thousands of rows, and
 * filtering on every keystroke means re-scanning the index between characters.
 * Debouncing the value rather than the handler keeps the input itself
 * responsive: the field updates immediately, the expensive work waits.
 *
 * A zero delay still goes through a timer rather than setting state
 * synchronously in the effect, which would cascade an extra render pass on
 * every keystroke.
 */
export function useDebouncedValue(value, delayMs = 200) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}
/**
 * Elapsed milliseconds since a timestamp, updated on an interval.
 *
 * Reading `Date.now()` during render makes the render impure and the value
 * never refreshes. Ticking it through state keeps render a pure function of
 * state and makes a running job's duration actually count up. The interval is
 * only installed while `active` is true, so an idle page schedules nothing.
 */
export function useElapsed(since, active, intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active)
            return;
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [active, intervalMs]);
    return Math.max(0, now - since);
}
/** Tracks an element's size without a layout thrash on every render. */
export function useElementSize() {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const observer = useRef(null);
    const ref = useCallback((node) => {
        observer.current?.disconnect();
        if (node === null)
            return;
        if (typeof ResizeObserver === 'undefined') {
            setSize({ width: node.clientWidth, height: node.clientHeight });
            return;
        }
        observer.current = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry)
                return;
            setSize((previous) => {
                const width = Math.round(entry.contentRect.width);
                const height = Math.round(entry.contentRect.height);
                // Bail out when nothing changed: the observer fires on every layout,
                // and setting an equal value still schedules a render.
                return previous.width === width && previous.height === height
                    ? previous
                    : { width, height };
            });
        });
        observer.current.observe(node);
        setSize({ width: node.clientWidth, height: node.clientHeight });
    }, []);
    useEffect(() => () => observer.current?.disconnect(), []);
    return useMemo(() => ({ ref, width: size.width, height: size.height }), [ref, size.width, size.height]);
}
