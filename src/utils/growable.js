/**
 * Growable typed arrays.
 *
 * Per-sequence statistics are collected during a single streaming pass, so the
 * final sequence count is not known in advance. A plain `number[]` would work
 * but costs 8 bytes plus boxing overhead per element and defeats the point of
 * the column-oriented index; these wrappers keep the data in typed arrays and
 * double the backing buffer when it fills, which makes the amortised cost of an
 * append constant and the total allocation at most 2x the final size.
 */
export class GrowableUint32Array {
    buffer;
    size = 0;
    constructor(initialCapacity = 1024) {
        this.buffer = new Uint32Array(Math.max(1, initialCapacity));
    }
    push(value) {
        if (this.size === this.buffer.length)
            this.grow();
        this.buffer[this.size++] = value;
    }
    get length() {
        return this.size;
    }
    get(index) {
        return this.buffer[index];
    }
    grow() {
        const next = new Uint32Array(this.buffer.length * 2);
        next.set(this.buffer);
        this.buffer = next;
    }
    /**
     * Returns a right-sized copy.
     *
     * A copy rather than a `subarray` view: the result is handed to IndexedDB and
     * posted between threads, and a view would carry the whole oversized buffer
     * with it, storing up to twice the necessary bytes.
     */
    toTypedArray() {
        return this.buffer.slice(0, this.size);
    }
}
export class GrowableFloat32Array {
    buffer;
    size = 0;
    constructor(initialCapacity = 1024) {
        this.buffer = new Float32Array(Math.max(1, initialCapacity));
    }
    push(value) {
        if (this.size === this.buffer.length) {
            const next = new Float32Array(this.buffer.length * 2);
            next.set(this.buffer);
            this.buffer = next;
        }
        this.buffer[this.size++] = value;
    }
    get length() {
        return this.size;
    }
    toTypedArray() {
        return this.buffer.slice(0, this.size);
    }
}
