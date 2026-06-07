/**
 * avatar-signal-store.js
 *
 * Minimal in-heap signal store for the Phase 1 One-World co-location probe.
 *
 * Purpose: proves the avatar owner ↔ compact panel pair can share state
 * in a single WKWebView document without daemon serialization between them.
 *
 * This store is intentionally throwaway — the goal is evidence that the
 * pair co-locates correctly, not a production signals framework. Do not
 * build on this as Phase 2 substrate. ADR-0012 warns against a bespoke
 * reactive framework; Phase 2 will evaluate options after this probe closes.
 *
 * The store holds one channel per registered key. Subscribers receive the
 * new value synchronously on every write. Writes return the count of
 * subscribers notified (for probe evidence).
 */

/**
 * @typedef {Object} AvatarSignalStore
 * @property {(key: string, value: unknown) => number} write
 * @property {(key: string, handler: (value: unknown) => void) => () => void} subscribe
 * @property {(key: string) => unknown} read
 * @property {() => { keys: string[], subscriber_counts: Record<string, number>, write_counts: Record<string, number> }} stats
 */

/**
 * Creates a minimal in-heap signal store.
 *
 * @returns {AvatarSignalStore}
 */
export function createAvatarSignalStore() {
    /** @type {Map<string, Set<(value: unknown) => void>>} */
    const subscribers = new Map();
    /** @type {Map<string, unknown>} */
    const values = new Map();
    /** @type {Map<string, number>} */
    const writeCounts = new Map();

    /**
     * Write a value to the store. Notifies all subscribers synchronously.
     * @param {string} key
     * @param {unknown} value
     * @returns {number} number of subscribers notified
     */
    function write(key, value) {
        values.set(key, value);
        writeCounts.set(key, (writeCounts.get(key) || 0) + 1);
        const subs = subscribers.get(key);
        if (!subs || subs.size === 0) return 0;
        let notified = 0;
        for (const handler of subs) {
            handler(value);
            notified += 1;
        }
        return notified;
    }

    /**
     * Subscribe to writes on a key. Returns an unsubscribe function.
     * @param {string} key
     * @param {(value: unknown) => void} handler
     * @returns {() => void}
     */
    function subscribe(key, handler) {
        if (!subscribers.has(key)) subscribers.set(key, new Set());
        subscribers.get(key).add(handler);
        return function unsubscribe() {
            subscribers.get(key)?.delete(handler);
        };
    }

    /**
     * Read the last written value for a key (or undefined if never written).
     * @param {string} key
     * @returns {unknown}
     */
    function read(key) {
        return values.get(key);
    }

    /**
     * Return diagnostic stats for probe evidence.
     */
    function stats() {
        const keys = Array.from(values.keys());
        const subscriber_counts = {};
        const write_counts = {};
        for (const key of keys) {
            subscriber_counts[key] = subscribers.get(key)?.size ?? 0;
            write_counts[key] = writeCounts.get(key) ?? 0;
        }
        return { keys, subscriber_counts, write_counts };
    }

    return { write, subscribe, read, stats };
}
