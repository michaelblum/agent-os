/**
 * co-located-panel.js
 *
 * Phase 1 One-World co-location probe.
 *
 * Two layers in one WKWebView document. The owner and the compact panel are
 * co-residents of a single document sharing a signal store in-heap — no
 * cross-canvas IPC, no daemon serialization boundary between them during a
 * slider drag.
 *
 * Architecture:
 *   - panelLayer: mounts the compact control surface (UI input side)
 *   - ownerLayer: stub owner that applies slider changes in-heap
 *   - sharedStore: avatarSignalStore instance — the only communication channel
 *     between the two layers
 *
 * The store is intentionally minimal and throwaway. It exists to prove the
 * pair co-locates correctly. Do not commit to this as the Phase 2 World substrate.
 *
 * Probe instrumentation:
 *   - panelLayer writes to store → probe records 'write'
 *   - ownerLayer applies from store → probe records 'applied'
 *   - cross-canvas IPC counters remain 0 because sendToOwner is never called
 *
 * Exit gate (Phase 1):
 *   1. Deletable traffic → ~0: panel_messages.sent stays 0 during slider drag
 *   2. Slider-drag is direct: in_heap.writes == in_heap.applied per drag event
 *   3. Focus and fault behavior: panelLayer stays focusable; ownerLayer fault
 *      is isolated (its apply errors are caught and do not propagate to panelLayer)
 *
 * Guardrails (from work card):
 *   - No new Swift logic. No daemon round-trip between panel and owner.
 *   - The daemon remains the sole privileged broker (ADR-0015).
 *   - publishState (owner→daemon display compositor) is NOT deleted by co-location.
 *     That is a separate Phase 2 concern about the shared render loop.
 */

import { createSurfaceTransportProbe } from '../renderer/live-modules/surface-transport-probe.js';
import { createAvatarSignalStore } from './avatar-signal-store.js';
import { createSigilAvatarCompactControlSurface } from './compact-surface.js';

// ---------------------------------------------------------------------------
// Panel layer factory
// ---------------------------------------------------------------------------

/**
 * Create the panel layer — the compact control surface (UI input side).
 *
 * Writes control changes directly to the shared store in-heap.
 * Never calls sendToOwner / post('canvas.send').
 *
 * @param {{
 *   anchor: Element,
 *   viewModel: object,
 *   document: Document,
 *   activeTab?: string|null,
 *   store: import('./avatar-signal-store.js').AvatarSignalStore,
 *   probe: ReturnType<import('../renderer/live-modules/surface-transport-probe.js').createSurfaceTransportProbe>,
 *   createControlSurface?: typeof createSigilAvatarCompactControlSurface,
 * }} options
 */
export function createPanelLayer({
    anchor,
    viewModel,
    document: doc,
    activeTab = null,
    store,
    probe,
    createControlSurface = createSigilAvatarCompactControlSurface,
} = {}) {
    if (!anchor || !viewModel) {
        throw new TypeError('createPanelLayer requires anchor and viewModel');
    }
    if (!doc) throw new TypeError('createPanelLayer requires document');
    if (!store) throw new TypeError('createPanelLayer requires store');
    if (!probe) throw new TypeError('createPanelLayer requires probe');

    let surface = null;

    function onControlChange(change = {}) {
        const payload = {
            tab: change.tab,
            section: change.section,
            values: change.values || {},
            controls: change.section?.controls || [],
            avatar_id: change.avatar_id,
        };
        // Write directly to the in-heap store — no cross-canvas IPC.
        probe.recordInHeapPropagation('write');
        store.write('control_change', payload);
    }

    function mount(nextTab = activeTab) {
        surface?.destroy?.();
        surface = createControlSurface(anchor, viewModel, {
            document: doc,
            defaultTab: nextTab,
            onControlChange,
            // onProjectionChange and onProjectionAction: not exercised by the
            // slider-drag probe scenario; keep as no-ops for scope narrowness.
            onProjectionChange() {},
            onProjectionAction() {},
            onTabChange() {},
        });
        return surface;
    }

    function destroy() {
        surface?.destroy?.();
        surface = null;
    }

    function getActiveTab() {
        return surface?.getActiveTab?.() || null;
    }

    function getControlRecords() {
        return surface?.getControlRecords?.() || [];
    }

    return { mount, destroy, getActiveTab, getControlRecords };
}

// ---------------------------------------------------------------------------
// Owner layer factory
// ---------------------------------------------------------------------------

/**
 * Create the owner layer — stub that applies control changes from the
 * in-heap store. Fault isolation: errors in onApply are caught so they
 * cannot propagate to and break the panelLayer.
 *
 * @param {{
 *   store: import('./avatar-signal-store.js').AvatarSignalStore,
 *   probe: ReturnType<import('../renderer/live-modules/surface-transport-probe.js').createSurfaceTransportProbe>,
 *   onApply?: (payload: object) => void,
 * }} options
 */
export function createOwnerLayer({
    store,
    probe,
    onApply = null,
} = {}) {
    if (!store) throw new TypeError('createOwnerLayer requires store');
    if (!probe) throw new TypeError('createOwnerLayer requires probe');

    let unsubscribeControlChange = null;
    let lastAppliedPayload = null;

    function applyControlChange(payload) {
        try {
            lastAppliedPayload = payload;
            probe.recordInHeapPropagation('applied');
            if (typeof onApply === 'function') {
                onApply(payload);
            }
        } catch (error) {
            // Fault isolation: ownerLayer errors must not propagate to panelLayer.
            // In production this would feed the renderer's error telemetry.
            if (typeof console !== 'undefined') {
                console.warn('[co-located-probe] ownerLayer apply error (isolated):', error);
            }
        }
    }

    function start() {
        if (unsubscribeControlChange) return;
        unsubscribeControlChange = store.subscribe('control_change', applyControlChange);
    }

    function stop() {
        if (unsubscribeControlChange) {
            unsubscribeControlChange();
            unsubscribeControlChange = null;
        }
    }

    function lastApplied() {
        return lastAppliedPayload;
    }

    return { start, stop, lastApplied };
}

// ---------------------------------------------------------------------------
// Document-level factory — creates a matched store + probe + layer pair
// ---------------------------------------------------------------------------

/**
 * Create the full co-located document binding for a single WKWebView document.
 *
 * Returns the store, probe, panelLayer factory, and ownerLayer factory
 * wired together.
 *
 * @param {{
 *   canvasId?: string,
 *   windowObject?: Window|null,
 * }} options
 */
export function createCoLocatedPanel({
    canvasId = 'sigil-avatar-coloc-probe',
    windowObject = (typeof window !== 'undefined' ? window : null),
} = {}) {
    const store = createAvatarSignalStore();
    const probe = createSurfaceTransportProbe({ label: canvasId, windowObject });

    function makePanelLayer(options = {}) {
        return createPanelLayer({ ...options, store, probe });
    }

    function makeOwnerLayer(options = {}) {
        return createOwnerLayer({ ...options, store, probe });
    }

    return { store, probe, makePanelLayer, makeOwnerLayer };
}

// ---------------------------------------------------------------------------
// Document-level default instance (for the live HTML entrypoint)
// ---------------------------------------------------------------------------

const _params = new URLSearchParams(
    (typeof location !== 'undefined' && location.search) || ''
);
const _canvasId = (typeof window !== 'undefined' && window.__aosCanvasId)
    || _params.get('id')
    || 'sigil-avatar-coloc-probe';

/**
 * Default co-located panel binding for this document.
 * Exposed so the HTML entrypoint can use it and so live debug tools can
 * access the store and probe via window.__sigilCoLocatedProbeDebug.
 */
export const defaultCoLocatedPanel = createCoLocatedPanel({ canvasId: _canvasId });

// ---------------------------------------------------------------------------
// Debug surface (mirrors __sigilAvatarPanelDebug for the co-located doc)
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
    const { probe: p, store: s } = defaultCoLocatedPanel;
    window.__sigilCoLocatedProbeDebug = {
        surfaceTransportProbe: {
            enable() { return p.setEnabled(true); },
            disable() { return p.setEnabled(false); },
            reset() { p.reset(); return p.snapshot(); },
            snapshot(options) { return p.snapshot(options); },
            mark(name, payload) { p.mark(name, payload); return p.snapshot(); },
        },
        store: {
            stats() { return s.stats(); },
        },
    };
}
