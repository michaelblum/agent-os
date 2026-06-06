/**
 * world-raf-scheduler.js
 *
 * Phase 2 One-World substrate: shared RAF scheduler for a co-located World
 * document.
 *
 * ## Why
 *
 * Phase 1 confirmed that the avatar owner and compact panel can share one
 * WKWebView document (co-located). With a shared document they can also share
 * one requestAnimationFrame loop. The existing avatar render loop
 * (render-loop.js + main.js) defaults every frame to structural=true —
 * causing overlay.draw + publishState on every animation tick (31/s baseline,
 * Phase 0 measurement). In a co-located document, panel-only frames that touch
 * no avatar geometry can skip publishState, because the display-compositor path
 * only needs to know the frame changed when geometry actually changed.
 *
 * ## Design
 *
 * The scheduler is a multi-contributor RAF loop. Each frame:
 *
 *   1. All registered contributors report whether they need the frame and
 *      whether any avatar geometry changed (structural request).
 *   2. The scheduler merges contributor requests: structural=true if ANY
 *      contributor requested structural; false if none did.
 *   3. The merged structural flag is passed to the avatar render step and to
 *      classifyRenderLoopWork so publishState is only called on structural frames.
 *
 * This moves the structural flag from a hard default (main.js:543 — "structural
 * unless explicitly false") to a demand-driven annotation: a contributor marks
 * structural only when avatar geometry actually changed.
 *
 * ## Contributor contract
 *
 *   - `needsFrame()` — returns true if this contributor wants the next frame.
 *   - `requestStructural()` — call when avatar geometry has changed; ensures
 *     this frame is marked structural.
 *   - `clearStructural()` — clear the structural request (called automatically
 *     by the scheduler at the start of each frame).
 *
 * ## Result of each frame
 *
 *   The scheduler calls each `onFrame(ctx)` callback with:
 *   - `structural: boolean` — true if any contributor requested structural
 *   - `contributors: string[]` — names of contributors that needed this frame
 *
 * ## Probe integration
 *
 * The scheduler integrates with the surface transport probe via an optional
 * `probe` parameter. It records `structural_skip` (publishState skipped) and
 * `structural_run` (publishState ran) for validation against Phase 0/1
 * baselines.
 *
 * @module world-raf-scheduler
 */

/**
 * Create a shared RAF scheduler for a co-located World document.
 *
 * @param {{
 *   requestAnimationFrame?: (cb: FrameRequestCallback) => number,
 *   cancelAnimationFrame?: (id: number) => void,
 * }} options
 * @returns {WorldRafScheduler}
 */
export function createWorldRafScheduler({
    requestAnimationFrame: raf = (typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null),
    cancelAnimationFrame: caf = (typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : null),
} = {}) {
    /** @type {Map<string, ContributorState>} */
    const contributors = new Map();
    let frameId = null;
    let suspended = false;

    /**
     * @typedef {object} ContributorState
     * @property {string} name
     * @property {() => boolean} needsFrame
     * @property {boolean} structuralPending
     * @property {(ctx: FrameContext) => void} onFrame
     */

    /**
     * @typedef {object} FrameContext
     * @property {boolean} structural - true if any contributor requested structural
     * @property {string[]} contributors - names of contributors active this frame
     */

    function scheduleIfNeeded() {
        if (suspended || frameId !== null) return;
        if (typeof raf !== 'function') return; // test mode: only tick() drives frames
        const anyNeeds = [...contributors.values()].some((c) => c.needsFrame());
        if (!anyNeeds) return;
        frameId = raf(runFrame);
    }

    function runFrame() {
        frameId = null;
        if (suspended) return;

        const active = [];
        let structural = false;

        for (const [name, c] of contributors) {
            if (!c.needsFrame()) continue;
            active.push(name);
            if (c.structuralPending) {
                structural = true;
                c.structuralPending = false;
            }
        }

        if (active.length === 0) return;

        const ctx = { structural, contributors: active };

        // Notify each active contributor
        for (const name of active) {
            const c = contributors.get(name);
            if (c) {
                try {
                    c.onFrame(ctx);
                } catch (err) {
                    // Fault isolation: contributor errors must not break other contributors
                    if (typeof console !== 'undefined') {
                        console.warn(`[world-raf-scheduler] contributor '${name}' error:`, err);
                    }
                }
            }
        }

        // Schedule next frame if any contributor still needs it
        scheduleIfNeeded();
    }

    /**
     * Register a contributor with the shared loop.
     *
     * @param {string} name - unique contributor name (e.g. 'avatar-scene', 'panel-ui')
     * @param {{
     *   needsFrame: () => boolean,
     *   onFrame: (ctx: FrameContext) => void,
     * }} opts
     * @returns {{ requestStructural: () => void, unregister: () => void, scheduleFrame: () => void }}
     */
    function register(name, { needsFrame, onFrame }) {
        if (typeof name !== 'string' || !name) throw new TypeError('contributor name must be a non-empty string');
        if (typeof needsFrame !== 'function') throw new TypeError('needsFrame must be a function');
        if (typeof onFrame !== 'function') throw new TypeError('onFrame must be a function');

        /** @type {ContributorState} */
        const state = {
            name,
            needsFrame,
            structuralPending: false,
            onFrame,
        };
        contributors.set(name, state);

        return {
            /**
             * Mark this contributor's next frame as structural (avatar geometry changed).
             * Call this from the path where avatar geometry is mutated —
             * e.g. scale descriptor apply, transform patch, geometry update.
             */
            requestStructural() {
                state.structuralPending = true;
                scheduleIfNeeded();
            },
            /**
             * Unregister this contributor from the shared loop.
             */
            unregister() {
                contributors.delete(name);
                if (contributors.size === 0 && frameId !== null && typeof caf === 'function') {
                    caf(frameId);
                    frameId = null;
                }
            },
            /**
             * Schedule a frame for this contributor (non-structural by default).
             * Call this when the contributor needs to update but has not changed
             * avatar geometry.
             */
            scheduleFrame() {
                scheduleIfNeeded();
            },
        };
    }

    /**
     * Suspend the shared loop. In-flight RAF callback will exit early.
     */
    function suspend() {
        suspended = true;
        if (frameId !== null && typeof caf === 'function') {
            caf(frameId);
            frameId = null;
        }
    }

    /**
     * Resume the shared loop.
     */
    function resume() {
        suspended = false;
        scheduleIfNeeded();
    }

    /**
     * Force a frame — used in tests and probe scenarios to drive the loop
     * without a real RAF environment.
     */
    function tick() {
        if (frameId !== null && typeof caf === 'function') {
            caf(frameId);
            frameId = null;
        }
        runFrame();
    }

    return {
        register,
        suspend,
        resume,
        tick,
        get suspended() { return suspended; },
        get contributorCount() { return contributors.size; },
        get pendingFrame() { return frameId !== null; },
    };
}
