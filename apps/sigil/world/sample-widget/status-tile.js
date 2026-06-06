/**
 * status-tile.js
 *
 * Sample World extension widget — Phase 2 sub-task 2.
 *
 * This file is INTENTIONALLY third-party-shaped: it imports ONLY from
 * ../world-extension-api.js. It does not import from:
 *   - apps/sigil/renderer/live-modules/**  (renderer internals)
 *   - apps/sigil/avatar-editor/**          (avatar internals)
 *   - apps/sigil/avatar-controls/**        (avatar controls)
 *   - packages/toolkit/**                  (toolkit internals)
 *   - Any other internal path
 *
 * This boundary is verifiable by static import analysis — see
 * tests/renderer/sigil-one-world-extension-api.test.mjs.
 *
 * ## What this widget demonstrates
 *
 *   1. Signal-driven state: uses createSignal and createComputed from the
 *      World API (no direct store manipulation).
 *   2. Custom theming: calls applyTheme to set --widget-* and --aos-* token
 *      overrides on its root element, making it visually distinct from the
 *      default AOS theme.
 *   3. Frame-tick rendering: registers with the World's shared RAF scheduler
 *      via the WidgetHandle returned by mountWidget, and only requests a
 *      frame when animated state actually changes.
 *   4. Clean teardown: returns a cleanup function from mount() that disposes
 *      signals and removes event listeners.
 *
 * ## Widget description
 *
 * A status tile that shows:
 *   - A "pulse" animation driven by a counter signal (increments per frame
 *     when the widget is active)
 *   - A label drawn from a writable signal
 *   - A computed "status class" derived from the counter value
 *   - Custom amber/dark theming to demonstrate the theming contract
 *
 * The tile has a button that increments a count signal on click, causing the
 * derived status to recompute and the display to update on the next frame.
 */

import {
    createSignal,
    createComputed,
    createEffect,
    applyTheme,
    mountWidget,
} from '../world-extension-api.js';

// ---------------------------------------------------------------------------
// Widget theme tokens — visually distinct from the default AOS Nexus theme
// ---------------------------------------------------------------------------

const TILE_THEME = {
    '--widget-bg': 'rgba(28, 18, 6, 0.95)',
    '--widget-border': 'rgba(255, 165, 40, 0.38)',
    '--widget-accent': '#ff9500',
    '--widget-accent-dim': 'rgba(255, 149, 0, 0.38)',
    '--widget-text': 'rgba(255, 230, 180, 0.94)',
    '--widget-text-muted': 'rgba(255, 200, 130, 0.62)',
    '--widget-radius': '10px',
    // Override AOS panel tokens so the tile looks distinct even when
    // nested inside a World document that loads theme.css.
    '--aos-panel-bg': 'rgba(28, 18, 6, 0.95)',
    '--aos-panel-border': 'rgba(255, 165, 40, 0.38)',
};

// ---------------------------------------------------------------------------
// Widget factory
//
// statusTileWidget is the factory object passed to mountWidget().
// Its name appears in the RAF scheduler contributor list.
// ---------------------------------------------------------------------------

export const statusTileWidget = {
    name: 'status-tile',

    /**
     * Mount the status tile into the World.
     *
     * @param {import('../world-extension-api.js').WidgetHandle} handle
     * @returns {() => void} cleanup
     */
    mount(handle) {
        const { mountNode, scheduleFrame } = handle;

        // --- Signals ----------------------------------------------------------

        /** Counter signal — drives the animated display */
        const count = createSignal(0);
        /** Label signal — can be written from outside to update the title */
        const label = createSignal('World Widget');
        /** Derived status string */
        const statusText = createComputed(() => {
            const n = count.get();
            if (n === 0) return 'idle';
            if (n < 5) return 'warming';
            if (n < 20) return 'active';
            return 'running';
        });

        // --- DOM construction ------------------------------------------------

        const root = createTileDOM(mountNode);
        applyTheme(root, TILE_THEME);

        // --- Reactive bindings -----------------------------------------------

        const disposeLabel = createEffect(() => {
            const el = root.querySelector('[data-tile-label]');
            if (el) el.textContent = label.get();
        });

        const disposeStatus = createEffect(() => {
            const el = root.querySelector('[data-tile-status]');
            if (el) el.textContent = statusText.get();
        });

        const disposeCount = createEffect(() => {
            const el = root.querySelector('[data-tile-count]');
            if (el) el.textContent = String(count.get());
        });

        // --- Event listeners -------------------------------------------------

        const btn = root.querySelector('[data-tile-btn]');
        function onIncrement() {
            count.set(count.get() + 1);
            scheduleFrame(); // request next render tick
        }
        btn?.addEventListener('click', onIncrement);

        const resetBtn = root.querySelector('[data-tile-reset]');
        function onReset() {
            count.set(0);
            scheduleFrame();
        }
        resetBtn?.addEventListener('click', onReset);

        // --- Cleanup ----------------------------------------------------------

        return function cleanup() {
            disposeLabel();
            disposeStatus();
            disposeCount();
            btn?.removeEventListener('click', onIncrement);
            resetBtn?.removeEventListener('click', onReset);
        };
    },

    /**
     * onFrame is called by the World RAF scheduler each frame this widget
     * requested.
     *
     * @param {{ structural: boolean, contributors: string[] }} ctx
     */
    onFrame(ctx) {
        // The status tile does not drive continuous animation on its own;
        // frames are requested only when the count signal changes (via
        // scheduleFrame in the click handler). Nothing to do here except
        // confirm we received the frame context — useful for live verification.
        if (typeof window !== 'undefined' && window.__statusTileDebug) {
            window.__statusTileDebug.lastFrameCtx = ctx;
        }
    },
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Build the tile's DOM structure inside the provided container element.
 *
 * @param {Element} container
 * @returns {Element} the tile root element
 */
function createTileDOM(container) {
    const root = document.createElement('div');
    root.className = 'status-tile';
    root.innerHTML = `
<style>
.status-tile {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--widget-bg, rgba(28,18,6,0.95));
  border: 1px solid var(--widget-border, rgba(255,165,40,0.38));
  border-radius: var(--widget-radius, 10px);
  padding: 14px 16px;
  min-width: 180px;
  color: var(--widget-text, rgba(255,230,180,0.94));
  box-shadow: 0 8px 28px rgba(0,0,0,0.38);
}
.status-tile-title {
  font-size: 11px;
  font-weight: 680;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--widget-accent, #ff9500);
  margin-bottom: 10px;
}
.status-tile-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.status-tile-key {
  font-size: 10px;
  color: var(--widget-text-muted, rgba(255,200,130,0.62));
  flex-shrink: 0;
  width: 52px;
}
.status-tile-value {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--widget-text, rgba(255,230,180,0.94));
}
.status-tile-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.status-tile-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--widget-accent-dim, rgba(255,149,0,0.38));
  background: rgba(255,149,0,0.10);
  color: var(--widget-accent, #ff9500);
  font-size: 11px;
  cursor: pointer;
}
.status-tile-btn:hover {
  background: rgba(255,149,0,0.20);
  border-color: var(--widget-accent, #ff9500);
}
</style>
<div class="status-tile-title" data-tile-label>World Widget</div>
<div class="status-tile-row">
  <span class="status-tile-key">status</span>
  <span class="status-tile-value" data-tile-status>idle</span>
</div>
<div class="status-tile-row">
  <span class="status-tile-key">count</span>
  <span class="status-tile-value" data-tile-count>0</span>
</div>
<div class="status-tile-actions">
  <button class="status-tile-btn" data-tile-btn>increment</button>
  <button class="status-tile-btn" data-tile-reset>reset</button>
</div>
    `.trim();

    if (container) container.appendChild(root);
    return root;
}

// ---------------------------------------------------------------------------
// Standalone HTML bootstrap — only runs in a browser context
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
    // Expose debug handle for live eval verification
    window.__statusTileDebug = {
        /** The last frame context received from the World scheduler */
        lastFrameCtx: null,
    };
}
