import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
/**
 * Test environment shims.
 *
 * `fake-indexeddb/auto` installs an in-memory IndexedDB so the storage layer can
 * be exercised for real rather than mocked. jsdom is missing a handful of
 * browser APIs that SeqLens uses; each is polyfilled here rather than guarded
 * for in application code.
 */
afterEach(() => {
    cleanup();
});
// jsdom has no ResizeObserver, which Recharts' responsive container needs.
if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
        observe() { }
        unobserve() { }
        disconnect() { }
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
        writable: true,
        value: ResizeObserverStub,
    });
}
// Radix primitives call these during open/close transitions.
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => { };
    Element.prototype.releasePointerCapture = () => { };
}
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => { };
}
if (!('matchMedia' in globalThis)) {
    Object.defineProperty(globalThis, 'matchMedia', {
        writable: true,
        value: (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }),
    });
}
// File.prototype.stream and text() exist in jsdom but Blob.stream can be absent
// in older builds; the parser tests depend on it.
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
    const readBlobAsStream = (blob) => new ReadableStream({
        async start(controller) {
            const buffer = await blob.arrayBuffer();
            controller.enqueue(new Uint8Array(buffer));
            controller.close();
        },
    });
    Object.defineProperty(Blob.prototype, 'stream', {
        writable: true,
        value: function stream() {
            return readBlobAsStream(this);
        },
    });
}
if (!('structuredClone' in globalThis)) {
    Object.defineProperty(globalThis, 'structuredClone', {
        writable: true,
        value: (value) => JSON.parse(JSON.stringify(value)),
    });
}
