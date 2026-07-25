/**
 * world-extension-api.js
 *
 * Phase 2 One-World substrate: public extension API for a co-located World
 * document.
 *
 * ## Purpose
 *
 * This module is the ONLY import a third-party widget or panel should need to
 * build against the World. It exposes:
 *
 *   1. **Signal store** — createSignal, createComputed, createEffect. Minimal
 *      reactive primitives scoped to what an extension needs. Not a framework.
 *   2. **Mount point** — mountWidget(host, factory): mounts a widget into a
 *      World anchor element, returning a handle that registers with the shared
 *      RAF scheduler and provides a teardown path.
 *   3. **Scheduler handle** — acquired via mountWidget. Lets the widget
 *      schedule frames and (if it changes avatar geometry) request structural
 *      frames.
 *   4. **Theming utilities** — applyTheme(root, tokens): applies --aos-* CSS
 *      custom property overrides to a root element for custom theming.
 *      readToken(el, name): reads the current resolved value of an --aos-* token.
 *
 * ## What third-party code must NOT do
 *
 * See docs/api/world-extension-api-v0.md §Internal Boundary for the full
 * enumeration. In brief:
 *
 *   - Do not import anything from apps/sigil/renderer/live-modules/**
 *   - Do not import anything from apps/sigil/renderer/live-modules/main.js,
 *     render-loop.js, host-runtime.js, scene.js, world-raf-scheduler.js, etc.
 *   - Do not access window.__sigil* debug globals
 *   - Do not mutate renderer-owned DOM elements outside your mount node
 *   - Do not call window.webkit.messageHandlers.headsup directly
 *   - Do not use window.__aosHost or window.headsup outside this API
 *
 * This module re-exports or wraps everything a widget legitimately needs so
 * there is no reason to reach in.
 *
 * ## Signal store decision
 *
 * Phase 1's avatar-signal-store.js is throwaway (pure pub/sub, no reactive
 * primitives). Phase 2 evaluated two options:
 *
 * Option A — tiny standalone signals library (e.g. @preact/signals-core,
 *   Solid's createSignal): best fit for ADR-0012's "prefer standalone lib over
 *   hand-rolling reactivity" advice. However, no suitable lib is present in the
 *   repo's node_modules (only @zag-js state machines, which are not signals
 *   primitives). WKWebView surfaces use relative ES module imports with no
 *   import map or bundler, so a lib would need to be vendored as a single ESM
 *   file. Vendoring an unreviewed snapshot introduces its own maintenance cost.
 *
 * Option B — minimal hand-rolled reactive primitives: implemented here.
 *   The implementation is ~120 lines covering createSignal, createComputed,
 *   and createEffect. This is not a "bespoke reactive framework" (ADR-0012's
 *   warning): it has no scheduler, no concurrent rendering, no component
 *   model, no virtual DOM. It is the same class as a 80-line pub/sub — a
 *   small utility, not a platform. The lib choice can be revisited when the
 *   platform has a vetted vendor path for ESM libraries.
 *
 * Decision: Option B — minimal hand-rolled reactive primitives.
 * Revisit when: a vendored ESM signals lib is added to the approved dep list.
 *
 * @module world-extension-api
 */

// ---------------------------------------------------------------------------
// Minimal reactive primitives
//
// These are NOT a framework. They are signals primitives: read, write,
// subscribe, and derive — no scheduler, no batching, no component model.
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {object} Signal
 * @property {() => T} get - read the current value
 * @property {(value: T) => void} set - write a new value and notify subscribers
 * @property {(fn: (value: T) => void) => () => void} subscribe - subscribe to
 *   changes; returns an unsubscribe function
 */

/**
 * Create a writable signal.
 *
 * @template T
 * @param {T} initial
 * @returns {Signal<T>}
 */
export function createSignal(initial) {
    let current = initial;
    /** @type {Set<(v: T) => void>} */
    const listeners = new Set();

    function get() {
        if (_currentEffect !== null) {
            _currentEffect.deps.add(signal);
        }
        return current;
    }

    function set(value) {
        if (Object.is(current, value)) return;
        current = value;
        // Snapshot listeners before notifying: listeners may be mutated during
        // notification (e.g. an effect re-subscribes on re-run), so iterating
        // over a snapshot prevents visiting newly-added entries in the same tick.
        const snapshot = [...listeners];
        for (const fn of snapshot) {
            try { fn(current); } catch (e) {
                if (typeof console !== 'undefined') console.warn('[world-api] signal listener error:', e);
            }
        }
    }

    function subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    const signal = { get, set, subscribe };
    return signal;
}

// Effect tracking context (for createComputed / createEffect)
let _currentEffect = null;

/**
 * Create a derived (computed) signal whose value is recalculated when any
 * signal read inside `compute` changes.
 *
 * Dep subscriptions are torn down and re-established on each recomputation
 * to prevent subscription accumulation across runs.
 *
 * @template T
 * @param {() => T} compute
 * @returns {{ get: () => T, subscribe: (fn: (v: T) => void) => () => void }}
 */
export function createComputed(compute) {
    let current;
    let dirty = true;
    const listeners = new Set();
    /** @type {Array<() => void>} */
    let depUnsubs = [];

    function recompute() {
        // Tear down existing dep subscriptions before re-tracking
        for (const unsub of depUnsubs) unsub();
        depUnsubs = [];

        const prev = _currentEffect;
        const ctx = { deps: new Set() };
        _currentEffect = ctx;
        try {
            current = compute();
            dirty = false;
        } finally {
            _currentEffect = prev;
        }
        // Subscribe to all discovered deps for future invalidation
        for (const dep of ctx.deps) {
            depUnsubs.push(dep.subscribe(invalidate));
        }
    }

    function invalidate() {
        // Recompute immediately so listeners receive the new value
        recompute();
        const snapshot = [...listeners];
        for (const fn of snapshot) {
            try { fn(current); } catch (e) {
                if (typeof console !== 'undefined') console.warn('[world-api] computed listener error:', e);
            }
        }
    }

    function get() {
        if (dirty) recompute();
        // Register this computed as a dep of any enclosing effect or computed.
        // The computed exposes `subscribe`, so the enclosing context's dep
        // subscription machinery will wire re-runs correctly.
        if (_currentEffect !== null) {
            _currentEffect.deps.add(computed);
        }
        return current;
    }

    function subscribe(fn) {
        // Eagerly compute on first subscription so dep tracking is active
        if (dirty) recompute();
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    const computed = { get, subscribe };
    return computed;
}

/**
 * Run an effect immediately and re-run it when any signal read inside changes.
 *
 * Dep subscriptions are torn down and re-established on each re-run to prevent
 * subscription accumulation. The user cleanup (returned by fn) is called
 * before each re-run and on dispose.
 *
 * @param {() => (void | (() => void))} fn - the effect body; may return a
 *   cleanup function that is called before each re-run.
 * @returns {() => void} dispose — call to stop the effect
 */
export function createEffect(fn) {
    let userCleanup = null;
    let disposed = false;
    /** @type {Array<() => void>} */
    let depUnsubs = [];

    function run() {
        if (disposed) return;

        // Call user cleanup from previous run
        if (typeof userCleanup === 'function') {
            try { userCleanup(); } catch (e) {
                if (typeof console !== 'undefined') console.warn('[world-api] effect cleanup error:', e);
            }
            userCleanup = null;
        }

        // Tear down previous dep subscriptions before re-tracking
        for (const unsub of depUnsubs) unsub();
        depUnsubs = [];

        const prev = _currentEffect;
        const ctx = { deps: new Set() };
        _currentEffect = ctx;
        try {
            const result = fn();
            if (typeof result === 'function') userCleanup = result;
        } finally {
            _currentEffect = prev;
        }

        // Subscribe to all discovered deps; each fires run() when changed
        for (const dep of ctx.deps) {
            depUnsubs.push(dep.subscribe(run));
        }
    }

    run();

    return function dispose() {
        if (disposed) return;
        disposed = true;
        for (const unsub of depUnsubs) unsub();
        depUnsubs = [];
        if (typeof userCleanup === 'function') {
            try { userCleanup(); } catch (e) {
                if (typeof console !== 'undefined') console.warn('[world-api] effect dispose error:', e);
            }
            userCleanup = null;
        }
    };
}

// ---------------------------------------------------------------------------
// Theming utilities
// ---------------------------------------------------------------------------

/**
 * Apply custom AOS token overrides to a root element.
 *
 * All keys must be valid --aos-* CSS custom property names (or any valid
 * CSS custom property). Values are string literals.
 *
 * Example:
 *   applyTheme(myWidget, {
 *     '--aos-panel-bg': 'rgba(20,30,40,0.95)',
 *     '--widget-accent': '#ff9500',
 *   });
 *
 * @param {Element} rootElement - the widget root element to receive overrides
 * @param {Record<string, string>} tokens - custom property name → value pairs
 */
export function applyTheme(rootElement, tokens) {
    if (!rootElement || typeof rootElement.style === 'undefined') {
        throw new TypeError('applyTheme requires a DOM element');
    }
    for (const [key, value] of Object.entries(tokens)) {
        rootElement.style.setProperty(key, value);
    }
}

/**
 * Read the resolved value of a CSS custom property on an element.
 *
 * @param {Element} element
 * @param {string} name - CSS custom property name (e.g. '--aos-panel-bg')
 * @returns {string} the resolved value, trimmed
 */
export function readToken(element, name) {
    if (!element || typeof getComputedStyle === 'undefined') return '';
    return getComputedStyle(element).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------------------
// Minimal scene model: mount point + resource pool (light surfaces)
//
// "Scene model" in this context is the mounting contract, not a GPU object
// graph. It scopes to: acquire a mount node, register with the shared RAF
// loop, release when done. The visual-object/GPU resource migration is a
// separate track (Phase 5).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} WidgetHandle
 * @property {Element} mountNode - the DOM element the widget renders into
 * @property {() => void} requestStructural - tell the scheduler that avatar
 *   geometry changed this frame (call only when the widget mutates avatar
 *   geometry — most widgets never need this)
 * @property {() => void} scheduleFrame - request a non-structural frame (use
 *   when animating or updating a display value)
 * @property {() => void} destroy - unmount the widget and release resources
 */

/**
 * @typedef {object} WidgetFactory
 * @property {(handle: WidgetHandle) => (void | (() => void))} mount - called
 *   once to initialize the widget. May return a cleanup function.
 * @property {((ctx: { structural: boolean, contributors: string[] }) => void)=} onFrame -
 *   optional; called each frame the widget is active. Receives the shared
 *   frame context from the World RAF scheduler.
 * @property {string=} name - contributor name for the shared RAF loop
 */

/**
 * Mount a widget into the World.
 *
 * Creates a mount node inside `host`, registers the widget as a contributor
 * with the World's shared RAF scheduler, and calls `factory.mount(handle)`.
 *
 * The scheduler is optional: if null or undefined, the widget still mounts
 * but does not receive frame ticks. This allows testing outside a live World
 * document.
 *
 * @param {Element} host - the World anchor element to mount into
 * @param {WidgetFactory} factory - the widget factory
 * @param {{
 *   scheduler?: import('../renderer/live-modules/world-raf-scheduler.js').WorldRafScheduler | null,
 *   id?: string,
 * }} options
 * @returns {WidgetHandle}
 */
export function mountWidget(host, factory, { scheduler = null, id = null } = {}) {
    if (!host) throw new TypeError('mountWidget requires a host element');
    if (!factory || typeof factory.mount !== 'function') {
        throw new TypeError('mountWidget requires a factory with a mount function');
    }

    const name = factory.name || id || `widget-${Math.random().toString(36).slice(2, 8)}`;

    // Create an isolated mount node
    const mountNode = (typeof document !== 'undefined' ? document : null)?.createElement?.('div');
    if (mountNode) {
        mountNode.setAttribute('data-world-widget', name);
        host.appendChild(mountNode);
    }

    let schedulerHandle = null;
    let wantsFrame = false;
    let userCleanup = null;
    let destroyed = false;

    function requestStructural() {
        if (schedulerHandle) schedulerHandle.requestStructural();
    }

    function scheduleFrame() {
        wantsFrame = true;
        if (schedulerHandle) schedulerHandle.scheduleFrame();
    }

    const handle = {
        mountNode,
        requestStructural,
        scheduleFrame,
        destroy,
    };

    // Register with the shared RAF scheduler if provided
    if (scheduler && typeof scheduler.register === 'function') {
        schedulerHandle = scheduler.register(name, {
            needsFrame() { return wantsFrame; },
            onFrame(ctx) {
                wantsFrame = false;
                if (typeof factory.onFrame === 'function' && !destroyed) {
                    try {
                        factory.onFrame(ctx);
                    } catch (e) {
                        if (typeof console !== 'undefined') {
                            console.warn(`[world-api] widget '${name}' onFrame error:`, e);
                        }
                    }
                }
            },
        });
    }

    // Call the factory mount function
    try {
        const result = factory.mount(handle);
        if (typeof result === 'function') userCleanup = result;
    } catch (e) {
        // Fault isolation: widget mount error should not crash the World
        if (typeof console !== 'undefined') {
            console.warn(`[world-api] widget '${name}' mount error:`, e);
        }
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        if (typeof userCleanup === 'function') {
            try { userCleanup(); } catch (e) {
                if (typeof console !== 'undefined') console.warn(`[world-api] widget '${name}' cleanup error:`, e);
            }
        }
        if (schedulerHandle) {
            schedulerHandle.unregister();
            schedulerHandle = null;
        }
        if (mountNode && mountNode.parentNode) {
            mountNode.parentNode.removeChild(mountNode);
        }
    }

    return handle;
}

// ---------------------------------------------------------------------------
// Re-export the scheduler type reference for JSDoc only — do NOT re-export
// the module itself. Widgets acquire a scheduler via mountWidget's options,
// not by importing world-raf-scheduler.js directly.
// ---------------------------------------------------------------------------
