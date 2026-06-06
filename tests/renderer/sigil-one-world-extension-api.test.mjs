/**
 * sigil-one-world-extension-api.test.mjs
 *
 * Phase 2 sub-task 2: World Extension API + theming contract.
 *
 * Tests:
 *   1. Signal primitives: createSignal, createComputed, createEffect
 *   2. Mount API: mountWidget contract, WidgetHandle, lifecycle
 *   3. Theming: applyTheme, readToken
 *   4. Import-boundary check: status-tile.js imports ONLY from
 *      world-extension-api.js (static analysis, no browser or DOM required)
 *   5. Sample widget integration: statusTileWidget mounts, responds to signals,
 *      and can be destroyed cleanly
 *
 * These tests run in Node (no browser, no daemon, no Swift).
 *
 * ## Import-boundary test (gate 3 prerequisite)
 *
 * The work card requires that a reviewer (not the implementing session)
 * can confirm the sample widget uses only the documented API and does not
 * reach into renderer or runtime internals.
 *
 * The strongest version of this check is a deterministic test that statically
 * parses the widget's imports and asserts none match internal-path patterns.
 * Test group 4 implements this check. Any reviewer can reproduce:
 *
 *   node --test tests/renderer/sigil-one-world-extension-api.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import {
    createSignal,
    createComputed,
    createEffect,
    applyTheme,
    readToken,
    mountWidget,
} from '../../apps/sigil/world/world-extension-api.js';

import { statusTileWidget } from '../../apps/sigil/world/sample-widget/status-tile.js';
import { createWorldRafScheduler } from '../../apps/sigil/renderer/live-modules/world-raf-scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// 1. Signal primitives
// ---------------------------------------------------------------------------

test('createSignal: basic read/write', () => {
    const s = createSignal(42);
    assert.equal(s.get(), 42);
    s.set(100);
    assert.equal(s.get(), 100);
});

test('createSignal: same value does not notify', () => {
    const s = createSignal('hello');
    let notified = 0;
    s.subscribe(() => notified++);
    s.set('hello'); // same value
    assert.equal(notified, 0);
    s.set('world');
    assert.equal(notified, 1);
});

test('createSignal: subscribe delivers current value on change', () => {
    const s = createSignal(0);
    const received = [];
    s.subscribe((v) => received.push(v));
    s.set(1);
    s.set(2);
    s.set(3);
    assert.deepEqual(received, [1, 2, 3]);
});

test('createSignal: unsubscribe stops delivery', () => {
    const s = createSignal(0);
    const received = [];
    const unsub = s.subscribe((v) => received.push(v));
    s.set(1);
    unsub();
    s.set(2);
    assert.deepEqual(received, [1]);
});

test('createSignal: multiple subscribers each receive updates', () => {
    const s = createSignal('a');
    const a = [];
    const b = [];
    s.subscribe((v) => a.push(v));
    s.subscribe((v) => b.push(v));
    s.set('b');
    s.set('c');
    assert.deepEqual(a, ['b', 'c']);
    assert.deepEqual(b, ['b', 'c']);
});

test('createComputed: derives from signal', () => {
    const s = createSignal(5);
    const doubled = createComputed(() => s.get() * 2);
    assert.equal(doubled.get(), 10);
    s.set(7);
    assert.equal(doubled.get(), 14);
});

test('createComputed: notifies subscriber when source changes', () => {
    const s = createSignal(3);
    const label = createComputed(() => s.get() < 5 ? 'low' : 'high');
    const received = [];
    label.subscribe((v) => received.push(v));
    s.set(10); // triggers recompute → 'high'
    assert.ok(received.length > 0, 'subscriber should be notified');
});

test('createEffect: runs immediately', () => {
    const s = createSignal(0);
    let ran = false;
    const dispose = createEffect(() => {
        s.get(); // track the signal
        ran = true;
    });
    assert.ok(ran);
    dispose();
});

test('createEffect: re-runs when signal changes', () => {
    const s = createSignal('x');
    const seen = [];
    const dispose = createEffect(() => {
        seen.push(s.get());
    });
    s.set('y');
    s.set('z');
    dispose();
    assert.ok(seen.includes('x'));
    assert.ok(seen.includes('y'));
    assert.ok(seen.includes('z'));
});

test('createEffect: cleanup is called before re-run', () => {
    const s = createSignal(0);
    const log = [];
    const dispose = createEffect(() => {
        const val = s.get();
        log.push(`setup:${val}`);
        return () => log.push(`cleanup:${val}`);
    });
    s.set(1);
    dispose();
    assert.ok(log.includes('setup:0'));
    assert.ok(log.includes('cleanup:0'));
    assert.ok(log.includes('setup:1'));
});

test('createEffect: dispose stops effect', () => {
    const s = createSignal(0);
    let runCount = 0;
    const dispose = createEffect(() => {
        s.get();
        runCount++;
    });
    const countAfterSetup = runCount;
    dispose();
    s.set(99); // should NOT re-run
    assert.equal(runCount, countAfterSetup);
});

// ---------------------------------------------------------------------------
// 2. mountWidget contract
// ---------------------------------------------------------------------------

// Minimal DOM stub for Node test environment
function makeFakeElement(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(),
        children: [],
        style: { _props: {}, setProperty(k, v) { this._props[k] = v; } },
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k]; },
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) {
            const i = this.children.indexOf(child);
            if (i >= 0) this.children.splice(i, 1);
        },
        parentNode: null,
        innerHTML: '',
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
    };
    el.parentNode = null;
    return el;
}

// Patch global document for the mountWidget call
function withFakeDocument(fn) {
    const prev = global.document;
    global.document = {
        createElement(tag) {
            const el = makeFakeElement(tag);
            el.parentNode = null;
            return el;
        },
    };
    try {
        return fn();
    } finally {
        if (prev === undefined) delete global.document;
        else global.document = prev;
    }
}

test('mountWidget: requires host and factory', () => {
    assert.throws(() => mountWidget(null, { mount() {} }), TypeError);
    assert.throws(
        () => withFakeDocument(() => mountWidget(makeFakeElement(), null)),
        TypeError
    );
    assert.throws(
        () => withFakeDocument(() => mountWidget(makeFakeElement(), { mount: 'notfn' })),
        TypeError
    );
});

test('mountWidget: returns WidgetHandle with required properties', () => {
    const host = makeFakeElement();
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, {
            mount(h) { return undefined; },
        });
    });
    assert.equal(typeof handle.mountNode, 'object');
    assert.equal(typeof handle.requestStructural, 'function');
    assert.equal(typeof handle.scheduleFrame, 'function');
    assert.equal(typeof handle.destroy, 'function');
});

test('mountWidget: factory.mount receives WidgetHandle', () => {
    const host = makeFakeElement();
    let receivedHandle = null;
    withFakeDocument(() => {
        mountWidget(host, {
            mount(h) { receivedHandle = h; },
        });
    });
    assert.ok(receivedHandle !== null);
    assert.equal(typeof receivedHandle.mountNode, 'object');
    assert.equal(typeof receivedHandle.destroy, 'function');
});

test('mountWidget: cleanup from mount is called on destroy', () => {
    const host = makeFakeElement();
    let cleaned = false;
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, {
            mount() { return () => { cleaned = true; }; },
        });
    });
    assert.ok(!cleaned);
    handle.destroy();
    assert.ok(cleaned);
});

test('mountWidget: destroy is idempotent', () => {
    const host = makeFakeElement();
    let cleanCount = 0;
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, {
            mount() { return () => { cleanCount++; }; },
        });
    });
    handle.destroy();
    handle.destroy(); // second call should not double-clean
    assert.equal(cleanCount, 1);
});

test('mountWidget: registers with provided scheduler', () => {
    const registeredNames = [];
    const fakeScheduler = {
        register(name, opts) {
            registeredNames.push(name);
            return {
                requestStructural() {},
                unregister() {},
                scheduleFrame() {},
            };
        },
    };
    const host = makeFakeElement();
    withFakeDocument(() => {
        mountWidget(host, { name: 'test-widget', mount() {} }, { scheduler: fakeScheduler });
    });
    assert.ok(registeredNames.includes('test-widget'));
});

test('mountWidget: works without scheduler (standalone mode)', () => {
    const host = makeFakeElement();
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, { mount() {} }, { scheduler: null });
    });
    // scheduleFrame should not throw even without a scheduler
    assert.doesNotThrow(() => handle.scheduleFrame());
    handle.destroy();
});

test('mountWidget: widget mount error is isolated (does not throw)', () => {
    const host = makeFakeElement();
    assert.doesNotThrow(() => {
        withFakeDocument(() => {
            mountWidget(host, {
                mount() { throw new Error('widget mount failed'); },
            });
        });
    });
});

// ---------------------------------------------------------------------------
// 3. Theming: applyTheme, readToken
// ---------------------------------------------------------------------------

test('applyTheme: applies CSS custom properties to element', () => {
    const el = makeFakeElement();
    applyTheme(el, { '--widget-accent': '#ff9500', '--widget-bg': 'black' });
    assert.equal(el.style._props['--widget-accent'], '#ff9500');
    assert.equal(el.style._props['--widget-bg'], 'black');
});

test('applyTheme: throws for non-element', () => {
    assert.throws(() => applyTheme(null, {}), TypeError);
    assert.throws(() => applyTheme('string', {}), TypeError);
});

test('readToken: returns empty string in non-browser environment', () => {
    // In Node there is no getComputedStyle; readToken returns '' gracefully
    const el = makeFakeElement();
    const result = readToken(el, '--aos-panel-bg');
    assert.equal(result, '');
});

// ---------------------------------------------------------------------------
// 4. Import-boundary check (gate 3 — reviewer-confirmable)
//
// Static analysis: read status-tile.js and assert every import resolves to
// world-extension-api.js. Assert no import matches internal path patterns.
//
// This is the mechanical version of gate 3. A reviewer runs this test and
// the result is authoritative: either the widget imports only the public API,
// or the test fails.
// ---------------------------------------------------------------------------

// Internal path patterns that third-party code must NOT import from.
// These patterns are anchored to the repo-relative path conventions.
const FORBIDDEN_INTERNAL_PATTERNS = [
    /apps\/sigil\/renderer\/live-modules/,
    /apps\/sigil\/renderer\/live-modules\/main\.js/,
    /apps\/sigil\/renderer\/live-modules\/render-loop\.js/,
    /apps\/sigil\/renderer\/live-modules\/host-runtime\.js/,
    /apps\/sigil\/renderer\/live-modules\/scene\.js/,
    /apps\/sigil\/renderer\/live-modules\/world-raf-scheduler\.js/,
    /apps\/sigil\/renderer\/live-modules\/surface-transport-probe\.js/,
    /apps\/sigil\/renderer\/live-modules\/webgl-renderer\.js/,
    /apps\/sigil\/avatar-editor/,
    /apps\/sigil\/avatar-controls/,
    /packages\/toolkit/,
    // Also block any attempt to reference the Phase 1 throwaway store directly
    /avatar-signal-store\.js/,
];

const WIDGET_SOURCE_PATH = resolve(
    REPO_ROOT,
    'apps/sigil/world/sample-widget/status-tile.js'
);

const EXPECTED_ALLOWED_IMPORT = 'world-extension-api.js';

test('import-boundary: status-tile.js source can be read', () => {
    // If this test fails the file doesn't exist at the expected path.
    assert.doesNotThrow(() => readFileSync(WIDGET_SOURCE_PATH, 'utf8'));
});

test('import-boundary: status-tile.js has no forbidden internal imports', () => {
    const source = readFileSync(WIDGET_SOURCE_PATH, 'utf8');

    // Extract all static import specifiers from the source.
    // Matches: import ... from 'specifier'; or import 'specifier';
    const importSpecifierRe = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const found = [];
    let match;
    while ((match = importSpecifierRe.exec(source)) !== null) {
        found.push(match[1]);
    }

    assert.ok(found.length > 0,
        'status-tile.js should have at least one import statement');

    for (const specifier of found) {
        for (const pattern of FORBIDDEN_INTERNAL_PATTERNS) {
            assert.ok(
                !pattern.test(specifier),
                `status-tile.js MUST NOT import from internal path: ${specifier} (matched pattern: ${pattern})`
            );
        }
    }
});

test('import-boundary: all status-tile.js imports resolve to world-extension-api.js', () => {
    const source = readFileSync(WIDGET_SOURCE_PATH, 'utf8');

    const importSpecifierRe = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const found = [];
    let match;
    while ((match = importSpecifierRe.exec(source)) !== null) {
        found.push(match[1]);
    }

    // All imports should be relative paths that end in world-extension-api.js
    for (const specifier of found) {
        assert.ok(
            specifier.endsWith(EXPECTED_ALLOWED_IMPORT),
            `status-tile.js import '${specifier}' does not resolve to ${EXPECTED_ALLOWED_IMPORT}. ` +
            'Every import from a third-party widget must come from the World extension API only.'
        );
    }
});

test('import-boundary: status-tile.js has exactly one import statement', () => {
    const source = readFileSync(WIDGET_SOURCE_PATH, 'utf8');

    const importSpecifierRe = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const found = [];
    let match;
    while ((match = importSpecifierRe.exec(source)) !== null) {
        found.push(match[1]);
    }

    assert.equal(found.length, 1,
        `status-tile.js should have exactly 1 import (from world-extension-api.js) but found: ${found.join(', ')}`
    );
});

// ---------------------------------------------------------------------------
// 5. Sample widget integration: statusTileWidget API usage
// ---------------------------------------------------------------------------

test('statusTileWidget: has required factory properties', () => {
    assert.equal(statusTileWidget.name, 'status-tile');
    assert.equal(typeof statusTileWidget.mount, 'function');
    assert.equal(typeof statusTileWidget.onFrame, 'function');
});

test('statusTileWidget: mounts and returns cleanup via mountWidget', () => {
    const host = makeFakeElement();
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, statusTileWidget, { scheduler: null });
    });
    // WidgetHandle returned
    assert.ok(handle !== null);
    assert.equal(typeof handle.destroy, 'function');
    // Cleanup should not throw
    assert.doesNotThrow(() => handle.destroy());
});

test('statusTileWidget: onFrame does not throw with empty context', () => {
    assert.doesNotThrow(() =>
        statusTileWidget.onFrame({ structural: false, contributors: [] })
    );
});

test('statusTileWidget: onFrame accepts structural context', () => {
    assert.doesNotThrow(() =>
        statusTileWidget.onFrame({ structural: true, contributors: ['avatar-scene', 'status-tile'] })
    );
});

// Signal integration via the widget's signals (not directly, but via the API)
test('signal + computed integration: createComputed tracks createSignal', () => {
    const count = createSignal(0);
    const statusText = createComputed(() => {
        const n = count.get();
        if (n === 0) return 'idle';
        if (n < 5) return 'warming';
        return 'active';
    });

    assert.equal(statusText.get(), 'idle');
    count.set(2);
    assert.equal(statusText.get(), 'warming');
    count.set(10);
    assert.equal(statusText.get(), 'active');
    count.set(0);
    assert.equal(statusText.get(), 'idle');
});

test('mountWidget + scheduler integration: frame tick reaches onFrame', () => {
    let lastCtx = null;
    const framesReceived = [];

    // Build a minimal test scheduler
    const contributions = new Map();
    const testScheduler = {
        register(name, opts) {
            contributions.set(name, opts);
            return {
                requestStructural() {},
                unregister() { contributions.delete(name); },
                scheduleFrame() {},
            };
        },
    };

    const host = makeFakeElement();
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, {
            name: 'test-onframe',
            mount(h) {},
            onFrame(ctx) { framesReceived.push(ctx); },
        }, { scheduler: testScheduler });
    });

    // Simulate a frame tick from the scheduler
    const contributor = contributions.get('test-onframe');
    assert.ok(contributor, 'widget should be registered as a contributor');

    contributor.onFrame({ structural: false, contributors: ['test-onframe'] });
    assert.equal(framesReceived.length, 1);
    assert.equal(framesReceived[0].structural, false);

    handle.destroy();
    // After destroy, contributor should be unregistered
    assert.ok(!contributions.has('test-onframe'));
});

// ---------------------------------------------------------------------------
// 6. Effect reads computed — discriminating reactivity test
//
// This is the key test that Blocker 1 would have caught: an effect that reads
// a computed must re-run when the source signal changes, not just on the
// initial mount. If createComputed.get() does not register the computed in
// _currentEffect.deps, the effect only tracks the underlying signals directly
// — which means it never fires when the computed's value changes via a signal
// that the effect never read directly.
// ---------------------------------------------------------------------------

test('createEffect: re-runs when a read computed changes (effect reads computed only)', () => {
    // The effect reads statusText.get() — NOT count.get() directly.
    // After count.set(), statusText should recompute, and the effect should re-run.
    const count = createSignal(0);
    const statusText = createComputed(() => {
        const n = count.get();
        if (n === 0) return 'idle';
        if (n < 5) return 'warming';
        return 'active';
    });

    const seen = [];
    const dispose = createEffect(() => {
        seen.push(statusText.get()); // reads computed, not signal
    });

    assert.deepEqual(seen, ['idle'], 'initial effect run should capture idle');
    count.set(3);
    assert.deepEqual(seen, ['idle', 'warming'], 'effect should re-run when computed changes via source signal');
    count.set(10);
    assert.deepEqual(seen, ['idle', 'warming', 'active'], 'effect should re-run again on further signal change');
    dispose();
    count.set(0);
    assert.deepEqual(seen, ['idle', 'warming', 'active'], 'disposed effect should not re-run');
});

// ---------------------------------------------------------------------------
// 7. Real WorldRafScheduler integration
//
// The test-scheduler stub in test 32 is third-party-shaped (no internal
// imports). This test uses the actual createWorldRafScheduler to confirm that
// mountWidget wires correctly to the real shared loop — the "minimal scene
// model registers with the shared loop" deliverable.
// ---------------------------------------------------------------------------

test('mountWidget + real WorldRafScheduler: widget registers, ticks onFrame, unregisters on destroy', () => {
    // Create a real scheduler in test mode (no real RAF, tick() drives frames)
    const scheduler = createWorldRafScheduler({
        requestAnimationFrame: null, // no real RAF in Node
        cancelAnimationFrame: null,
    });

    const framesReceived = [];
    const host = makeFakeElement();
    let handle;
    withFakeDocument(() => {
        handle = mountWidget(host, {
            name: 'real-scheduler-test',
            mount(h) {
                // Request a frame so needsFrame() returns true
                h.scheduleFrame();
            },
            onFrame(ctx) { framesReceived.push(ctx); },
        }, { scheduler });
    });

    // Confirm the contributor is registered
    assert.equal(scheduler.contributorCount, 1, 'one contributor should be registered');

    // Drive a frame via tick()
    scheduler.tick();
    assert.equal(framesReceived.length, 1, 'onFrame should fire on tick');
    assert.equal(typeof framesReceived[0].structural, 'boolean');
    assert.ok(Array.isArray(framesReceived[0].contributors));

    // Destroy the widget — contributor should unregister
    handle.destroy();
    assert.equal(scheduler.contributorCount, 0, 'contributor should be unregistered after destroy');
});
