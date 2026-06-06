/**
 * sigil-one-world-co-location-probe.test.mjs
 *
 * Phase 1 One-World co-location probe unit tests.
 *
 * Verifies the exit gate conditions deterministically:
 *   1. Deletable traffic → ~0: panel_messages.sent stays 0 during slider drag
 *   2. Slider-drag is direct: N writes → N applied, 0 cross-canvas IPC
 *   3. Focus and fault behavior: ownerLayer fault isolates; panelLayer unaffected
 *
 * Also verifies the signal store and probe in-heap tracking in isolation.
 *
 * These tests run in Node (no browser, no daemon, no Swift). They exercise
 * the co-location binding logic directly — the same approach as Phase 0 Test 1
 * (50 synthetic events, no native drag).
 *
 * Note on publishState / structural-overmark:
 *   desktopWorldSurface.publishState (main.js:5076) is owner → daemon display
 *   compositor traffic. It is NOT part of the panel↔owner separation boundary
 *   and is NOT deleted by pair co-location. The probe does not track it in
 *   this test — that is a Phase 2 shared-render-loop concern.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAvatarSignalStore } from '../../apps/sigil/avatar-editor/avatar-signal-store.js';
import { createSurfaceTransportProbe } from '../../apps/sigil/renderer/live-modules/surface-transport-probe.js';
import {
    createPanelLayer,
    createOwnerLayer,
    createCoLocatedPanel,
} from '../../apps/sigil/avatar-editor/co-located-panel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
    return createAvatarSignalStore();
}

function makeProbe() {
    const probe = createSurfaceTransportProbe({
        windowObject: { location: { search: '' } },
        label: 'test-coloc',
    });
    probe.setEnabled(true);
    return probe;
}

/**
 * Create a minimal mock control surface that exposes an onControlChange trigger.
 * Used to simulate slider events without loading the full toolkit DOM.
 */
function makeMockControlSurface(anchor, viewModel, options = {}) {
    const { onControlChange } = options;
    return {
        getActiveTab() { return null; },
        getControlRecords() { return []; },
        destroy() {},
        // Test helper: trigger a simulated slider change
        _triggerControlChange(change = {}) {
            onControlChange?.(change);
        },
    };
}

// ---------------------------------------------------------------------------
// Signal store tests
// ---------------------------------------------------------------------------

test('avatar signal store: write notifies subscribers synchronously', () => {
    const store = makeStore();
    const received = [];
    store.subscribe('control_change', (v) => received.push(v));

    const notified = store.write('control_change', { values: { size: 100 } });

    assert.equal(notified, 1, 'should have notified 1 subscriber');
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { values: { size: 100 } });
});

test('avatar signal store: multiple writes all arrive', () => {
    const store = makeStore();
    const received = [];
    store.subscribe('control_change', (v) => received.push(v));

    for (let i = 0; i < 50; i++) {
        store.write('control_change', { values: { size: i } });
    }

    assert.equal(received.length, 50);
    assert.equal(received[49].values.size, 49);
});

test('avatar signal store: unsubscribe stops delivery', () => {
    const store = makeStore();
    const received = [];
    const unsub = store.subscribe('control_change', (v) => received.push(v));

    store.write('control_change', { values: { size: 10 } });
    unsub();
    store.write('control_change', { values: { size: 20 } });

    assert.equal(received.length, 1, 'unsubscribed listener should not receive second write');
});

test('avatar signal store: stats tracks write counts and subscriber counts', () => {
    const store = makeStore();
    const unsub = store.subscribe('control_change', () => {});
    store.write('control_change', { values: { size: 1 } });
    store.write('control_change', { values: { size: 2 } });

    const stats = store.stats();
    assert.equal(stats.write_counts['control_change'], 2);
    assert.equal(stats.subscriber_counts['control_change'], 1);

    unsub();
});

test('avatar signal store: write returns 0 when no subscribers', () => {
    const store = makeStore();
    const notified = store.write('control_change', { values: {} });
    assert.equal(notified, 0);
});

test('avatar signal store: read returns last written value', () => {
    const store = makeStore();
    assert.equal(store.read('control_change'), undefined);
    store.write('control_change', { values: { size: 42 } });
    assert.deepEqual(store.read('control_change'), { values: { size: 42 } });
});

test('avatar signal store: multiple subscribers all receive write', () => {
    const store = makeStore();
    let countA = 0;
    let countB = 0;
    store.subscribe('control_change', () => { countA += 1; });
    store.subscribe('control_change', () => { countB += 1; });

    const notified = store.write('control_change', {});
    assert.equal(notified, 2);
    assert.equal(countA, 1);
    assert.equal(countB, 1);
});

// ---------------------------------------------------------------------------
// Probe in-heap tracking tests
// ---------------------------------------------------------------------------

test('probe records in-heap writes and applied counts', () => {
    const probe = makeProbe();

    probe.recordInHeapPropagation('write');
    probe.recordInHeapPropagation('write');
    probe.recordInHeapPropagation('applied');

    const s = probe.snapshot();
    assert.equal(s.in_heap.writes, 2);
    assert.equal(s.in_heap.applied, 1);
});

test('probe: in-heap counters reset with probe reset', () => {
    const probe = makeProbe();
    probe.recordInHeapPropagation('write');
    probe.recordInHeapPropagation('applied');

    probe.reset();
    const s = probe.snapshot();
    assert.equal(s.in_heap.writes, 0);
    assert.equal(s.in_heap.applied, 0);
});

test('probe: in-heap counters are inert when probe is disabled', () => {
    const probe = createSurfaceTransportProbe({
        windowObject: { location: { search: '' } },
        label: 'test',
    });
    // probe starts disabled
    probe.recordInHeapPropagation('write');
    probe.recordInHeapPropagation('applied');

    const s = probe.snapshot();
    assert.equal(s.in_heap.writes, 0, 'disabled probe should not count writes');
    assert.equal(s.in_heap.applied, 0);
});

test('probe: panel_messages.sent remains 0 when using in-heap path', () => {
    // Verifies exit gate condition 1: no cross-canvas IPC
    const probe = makeProbe();

    // In the co-located path, the panel writes to the store and records 'write'.
    // It never calls recordPanelMessage('sent', ...) because sendToOwner is never called.
    probe.recordInHeapPropagation('write');
    probe.recordInHeapPropagation('applied');

    const s = probe.snapshot();
    assert.deepEqual(s.panel_messages.sent, {}, 'no cross-canvas messages should be sent');
    assert.deepEqual(s.panel_messages.received, {});
});

// ---------------------------------------------------------------------------
// Co-located binding tests — exit gate verification
// ---------------------------------------------------------------------------

test('co-located binding: N slider events → N writes → N applied, 0 cross-canvas IPC', () => {
    // Exit gate conditions 1 and 2 checked deterministically.
    // Uses mock control surface to simulate slider events without DOM/toolkit.
    const store = makeStore();
    const probe = makeProbe();

    const applied = [];
    const ownerLayer = createOwnerLayer({ store, probe, onApply: (p) => applied.push(p) });
    ownerLayer.start();

    const panelLayer = createPanelLayer({
        anchor: {},
        viewModel: { type: 'test', tabs: [] },
        document: { createElement: () => ({ appendChild: () => {} }) },
        store,
        probe,
        createControlSurface: makeMockControlSurface,
    });
    const surface = panelLayer.mount();

    // Simulate 50 synthetic slider events (mirrors Phase 0 Test 1 methodology)
    const N = 50;
    for (let i = 0; i < N; i++) {
        surface._triggerControlChange({ values: { size: i }, section: { controls: [] } });
    }

    const snap = probe.snapshot();

    // Exit gate 1: cross-canvas IPC = 0
    assert.deepEqual(snap.panel_messages.sent, {}, 'no cross-canvas messages (gate 1)');

    // Exit gate 2: N writes, N applied — positive propagation evidence
    assert.equal(snap.in_heap.writes, N, `${N} in-heap writes (gate 2)`);
    assert.equal(snap.in_heap.applied, N, `${N} in-heap applied (gate 2)`);
    assert.equal(applied.length, N, 'owner received all changes in-heap');

    // Verify payload fidelity: last slider value arrived correctly
    assert.equal(applied[N - 1].values.size, N - 1, 'last value arrived correctly');

    ownerLayer.stop();
    panelLayer.destroy();
});

test('co-located binding: writes match applied — no drops, no duplicates', () => {
    const store = makeStore();
    const probe = makeProbe();

    let writeCount = 0;
    let applyCount = 0;

    const ownerLayer = createOwnerLayer({
        store, probe, onApply: () => { applyCount += 1; },
    });
    ownerLayer.start();

    const panelLayer = createPanelLayer({
        anchor: {},
        viewModel: {},
        document: { createElement: () => ({ appendChild: () => {} }) },
        store,
        probe,
        createControlSurface(anchor, viewModel, options) {
            return {
                getActiveTab: () => null,
                getControlRecords: () => [],
                destroy() {},
                _trigger() {
                    writeCount += 1;
                    options.onControlChange({ values: { x: writeCount } });
                },
            };
        },
    });
    const surface = panelLayer.mount();

    for (let i = 0; i < 20; i++) surface._trigger();

    assert.equal(writeCount, 20);
    assert.equal(applyCount, 20);
    assert.equal(probe.snapshot().in_heap.writes, 20);
    assert.equal(probe.snapshot().in_heap.applied, 20);

    ownerLayer.stop();
    panelLayer.destroy();
});

test('co-located binding (fault isolation): ownerLayer error does not propagate to panelLayer', () => {
    // Exit gate condition 3 (fault behavior): owner fault is isolated.
    const store = makeStore();
    const probe = makeProbe();

    let panelWriteCount = 0;
    let applyCallCount = 0;

    const ownerLayer = createOwnerLayer({
        store,
        probe,
        onApply() {
            applyCallCount += 1;
            if (applyCallCount === 2) {
                // Fault on second apply — should NOT crash panelLayer
                throw new Error('simulated owner fault');
            }
        },
    });
    ownerLayer.start();

    const panelLayer = createPanelLayer({
        anchor: {},
        viewModel: {},
        document: { createElement: () => ({ appendChild: () => {} }) },
        store,
        probe,
        createControlSurface(anchor, viewModel, options) {
            return {
                getActiveTab: () => null,
                getControlRecords: () => [],
                destroy() {},
                _trigger() {
                    panelWriteCount += 1;
                    options.onControlChange({ values: { x: panelWriteCount } });
                },
            };
        },
    });
    const surface = panelLayer.mount();

    // Trigger 4 events — second causes owner fault, rest should still succeed
    assert.doesNotThrow(() => {
        for (let i = 0; i < 4; i++) surface._trigger();
    }, 'panelLayer must not throw when ownerLayer faults');

    // panelLayer continued writing despite owner fault
    assert.equal(panelWriteCount, 4, 'panelLayer wrote all 4 events despite owner fault');
    // Owner applied 4 times but threw on 2nd — probe still records all applied (fault happens after recordInHeapPropagation)
    assert.equal(probe.snapshot().in_heap.applied, 4, 'probe records all apply attempts');
    assert.equal(probe.snapshot().in_heap.writes, 4);

    ownerLayer.stop();
    panelLayer.destroy();
});

test('co-located binding: ownerLayer stop unsubscribes cleanly', () => {
    const store = makeStore();
    const probe = makeProbe();

    const applied = [];
    const ownerLayer = createOwnerLayer({ store, probe, onApply: (p) => applied.push(p) });
    ownerLayer.start();

    const panelLayer = createPanelLayer({
        anchor: {},
        viewModel: {},
        document: { createElement: () => ({ appendChild: () => {} }) },
        store,
        probe,
        createControlSurface(anchor, viewModel, options) {
            return {
                getActiveTab: () => null,
                getControlRecords: () => [],
                destroy() {},
                _trigger() { options.onControlChange({ values: { x: 1 } }); },
            };
        },
    });
    const surface = panelLayer.mount();

    surface._trigger();
    assert.equal(applied.length, 1, 'owner received before stop');

    ownerLayer.stop();
    surface._trigger();
    assert.equal(applied.length, 1, 'owner does not receive after stop');

    // store still works for future subscribers
    const later = [];
    store.subscribe('control_change', (v) => later.push(v));
    surface._trigger();
    assert.equal(later.length, 1, 'store still delivers to new subscriber after owner stop');

    panelLayer.destroy();
});

// ---------------------------------------------------------------------------
// createCoLocatedPanel factory test
// ---------------------------------------------------------------------------

test('createCoLocatedPanel: factory creates wired store + probe + layer factories', () => {
    const { store, probe, makePanelLayer, makeOwnerLayer } = createCoLocatedPanel({
        canvasId: 'test-coloc',
        windowObject: { location: { search: '' } },
    });

    assert.ok(store, 'store created');
    assert.ok(probe, 'probe created');
    assert.ok(typeof makePanelLayer === 'function', 'makePanelLayer is a function');
    assert.ok(typeof makeOwnerLayer === 'function', 'makeOwnerLayer is a function');

    const applied = [];
    const ownerLayer = makeOwnerLayer({ onApply: (p) => applied.push(p) });
    ownerLayer.start();

    const panelLayer = makePanelLayer({
        anchor: {},
        viewModel: {},
        document: { createElement: () => ({ appendChild: () => {} }) },
        createControlSurface(anchor, viewModel, options) {
            return {
                getActiveTab: () => null,
                getControlRecords: () => [],
                destroy() {},
                _trigger() { options.onControlChange({ values: { brightness: 0.8 } }); },
            };
        },
    });
    const surface = panelLayer.mount();

    probe.setEnabled(true);
    surface._trigger();

    const snap = probe.snapshot();
    assert.equal(snap.in_heap.writes, 1);
    assert.equal(snap.in_heap.applied, 1);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].values.brightness, 0.8);

    ownerLayer.stop();
    panelLayer.destroy();
});

// ---------------------------------------------------------------------------
// Phase 0 baseline comparison note (not a test, recorded as assertion comment)
// ---------------------------------------------------------------------------
//
// Phase 0 baseline (Test 3, native CGEvent drag, --speed 30, 29.5s):
//   cross-canvas IPC: 1222 total (82.8/s) — control_change + snapshot
//   publishState:      915 calls (31/s) — render loop rate, NOT panel↔owner
//
// Phase 1 co-located result (50 synthetic events, this test):
//   panel_messages.sent: 0  (cross-canvas IPC eliminated for control_change + snapshot)
//   in_heap.writes:     50  (positive propagation evidence)
//   in_heap.applied:    50  (positive propagation evidence)
//
// publishState is owner→daemon (display compositor) and remains unchanged by
// pair co-location. It is a Phase 2 concern (shared render loop / shared scene).
