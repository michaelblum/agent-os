/**
 * sigil-one-world-phase2-scheduler.test.mjs
 *
 * Phase 2 One-World substrate: shared RAF scheduler and demand-driven
 * structural flag.
 *
 * Verifies the Sub-task 1 exit gate conditions deterministically:
 *
 *  1. Scheduler contract: multiple contributors can register; each frame
 *     receives correct structural flag based on demand.
 *  2. Structural flag is demand-driven: panel-only frames (no structural
 *     request) set structural=false, skipping publishState.
 *  3. Avatar geometry change forces structural=true on that frame, matching
 *     the Phase 0/1 baseline for avatar scale drag.
 *  4. panel-ui-idle reason in classifyRenderLoopWork: confirmed as a cheap
 *     frame reason (publishState=false when only panel-ui-idle is active).
 *  5. Regression guard: existing cheap reasons and structural reasons continue
 *     to classify correctly.
 *
 * These tests run in Node without a browser, daemon, or RAF environment.
 * The scheduler accepts an injectable requestAnimationFrame for testability.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorldRafScheduler } from '../../apps/sigil/renderer/live-modules/world-raf-scheduler.js';
import { classifyRenderLoopWork } from '../../apps/sigil/renderer/live-modules/render-loop.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a synchronous test scheduler: no real RAF.
 * runFrame() drives one tick.
 */
function makeTestScheduler() {
    const frames = [];
    const scheduler = createWorldRafScheduler({
        requestAnimationFrame: null,
        cancelAnimationFrame: null,
    });
    return { scheduler, frames };
}

// ---------------------------------------------------------------------------
// Scheduler contract tests
// ---------------------------------------------------------------------------

test('world-raf-scheduler: single contributor, non-structural frame', () => {
    const { scheduler } = makeTestScheduler();
    const received = [];

    let wantsFrame = true;
    const handle = scheduler.register('panel-ui', {
        needsFrame() { return wantsFrame; },
        onFrame(ctx) { received.push({ ...ctx }); wantsFrame = false; },
    });

    scheduler.tick();

    assert.equal(received.length, 1, 'panel-ui should receive one frame');
    assert.equal(received[0].structural, false, 'no structural request → structural=false');
    assert.deepEqual(received[0].contributors, ['panel-ui']);

    handle.unregister();
});

test('world-raf-scheduler: structural request on avatar-scene contributor makes frame structural', () => {
    const { scheduler } = makeTestScheduler();
    const received = [];

    let wantsFrame = true;
    const handle = scheduler.register('avatar-scene', {
        needsFrame() { return wantsFrame; },
        onFrame(ctx) { received.push({ ...ctx }); wantsFrame = false; },
    });

    handle.requestStructural(); // avatar geometry changed
    scheduler.tick();

    assert.equal(received.length, 1);
    assert.equal(received[0].structural, true, 'structural request → structural=true');

    handle.unregister();
});

test('world-raf-scheduler: two contributors, one structural — frame is structural', () => {
    const { scheduler } = makeTestScheduler();
    const avatarFrames = [];
    const panelFrames = [];

    let avatarNeeds = true;
    let panelNeeds = true;

    const avatarHandle = scheduler.register('avatar-scene', {
        needsFrame() { return avatarNeeds; },
        onFrame(ctx) { avatarFrames.push({ ...ctx }); avatarNeeds = false; },
    });
    const panelHandle = scheduler.register('panel-ui', {
        needsFrame() { return panelNeeds; },
        onFrame(ctx) { panelFrames.push({ ...ctx }); panelNeeds = false; },
    });

    avatarHandle.requestStructural(); // only avatar is structural
    scheduler.tick();

    assert.equal(avatarFrames.length, 1);
    assert.equal(panelFrames.length, 1, 'panel-ui should also get the frame');
    assert.equal(avatarFrames[0].structural, true, 'structural because avatar requested it');
    assert.equal(panelFrames[0].structural, true, 'all contributors see the same structural flag');
    assert.ok(avatarFrames[0].contributors.includes('avatar-scene'));
    assert.ok(avatarFrames[0].contributors.includes('panel-ui'));

    avatarHandle.unregister();
    panelHandle.unregister();
});

test('world-raf-scheduler: two contributors, neither structural — frame is non-structural', () => {
    const { scheduler } = makeTestScheduler();
    const results = [];

    let needs = true;

    const a = scheduler.register('avatar-scene', {
        needsFrame() { return needs; },
        onFrame(ctx) { results.push(ctx); },
    });
    const b = scheduler.register('panel-ui', {
        needsFrame() { return needs; },
        onFrame(ctx) { results.push(ctx); needs = false; },
    });

    scheduler.tick();

    assert.equal(results.length, 2);
    assert.equal(results[0].structural, false);
    assert.equal(results[1].structural, false);

    a.unregister();
    b.unregister();
});

test('world-raf-scheduler: contributor not needing frame is excluded', () => {
    const { scheduler } = makeTestScheduler();
    const avatarFrames = [];
    const panelFrames = [];

    const a = scheduler.register('avatar-scene', {
        needsFrame() { return false; }, // does NOT need frame
        onFrame(ctx) { avatarFrames.push(ctx); },
    });
    let panelNeeds = true;
    const b = scheduler.register('panel-ui', {
        needsFrame() { return panelNeeds; },
        onFrame(ctx) { panelFrames.push(ctx); panelNeeds = false; },
    });

    scheduler.tick();

    assert.equal(avatarFrames.length, 0, 'avatar-scene should not receive frame if needsFrame=false');
    assert.equal(panelFrames.length, 1, 'panel-ui should receive frame');
    assert.deepEqual(panelFrames[0].contributors, ['panel-ui']);

    a.unregister();
    b.unregister();
});

test('world-raf-scheduler: structural request cleared after frame', () => {
    const { scheduler } = makeTestScheduler();
    const results = [];

    let frameCount = 0;
    const handle = scheduler.register('avatar-scene', {
        needsFrame() { return frameCount < 2; },
        onFrame(ctx) { results.push({ ...ctx }); frameCount++; },
    });

    handle.requestStructural(); // structural for first frame only
    scheduler.tick(); // frame 1: structural
    scheduler.tick(); // frame 2: NOT structural (request was cleared)

    assert.equal(results.length, 2);
    assert.equal(results[0].structural, true, 'frame 1 should be structural');
    assert.equal(results[1].structural, false, 'frame 2: structural was cleared after frame 1');

    handle.unregister();
});

test('world-raf-scheduler: suspend stops frame delivery', () => {
    const { scheduler } = makeTestScheduler();
    const results = [];

    let needs = true;
    scheduler.register('panel-ui', {
        needsFrame() { return needs; },
        onFrame(ctx) { results.push(ctx); },
    });

    scheduler.suspend();
    scheduler.tick();

    assert.equal(results.length, 0, 'suspended scheduler should not deliver frames');
    assert.equal(scheduler.suspended, true);
});

test('world-raf-scheduler: resume re-enables frame delivery', () => {
    const { scheduler } = makeTestScheduler();
    const results = [];

    let needs = true;
    scheduler.register('panel-ui', {
        needsFrame() { return needs; },
        onFrame(ctx) { results.push(ctx); needs = false; },
    });

    scheduler.suspend();
    scheduler.resume();
    scheduler.tick();

    assert.equal(results.length, 1);
    assert.equal(scheduler.suspended, false);
});

test('world-raf-scheduler: contributor fault is isolated from other contributors', () => {
    const { scheduler } = makeTestScheduler();
    const panelFrames = [];

    let avatarNeeds = true;
    scheduler.register('avatar-scene', {
        needsFrame() { return avatarNeeds; },
        onFrame() {
            avatarNeeds = false;
            throw new Error('simulated avatar fault');
        },
    });

    let panelNeeds = true;
    const b = scheduler.register('panel-ui', {
        needsFrame() { return panelNeeds; },
        onFrame(ctx) { panelFrames.push(ctx); panelNeeds = false; },
    });

    assert.doesNotThrow(() => scheduler.tick(), 'scheduler.tick() must not throw when a contributor faults');
    assert.equal(panelFrames.length, 1, 'panel-ui should still receive frame despite avatar-scene fault');

    b.unregister();
});

test('world-raf-scheduler: unregister removes contributor from future frames', () => {
    const { scheduler } = makeTestScheduler();
    const results = [];

    let needs = true;
    const handle = scheduler.register('panel-ui', {
        needsFrame() { return needs; },
        onFrame(ctx) { results.push(ctx); },
    });

    handle.unregister();
    scheduler.tick();

    assert.equal(results.length, 0, 'unregistered contributor should not receive frames');
    assert.equal(scheduler.contributorCount, 0);
});

test('world-raf-scheduler: register validates arguments', () => {
    const { scheduler } = makeTestScheduler();

    assert.throws(
        () => scheduler.register('', { needsFrame: () => false, onFrame: () => {} }),
        /name must be a non-empty string/,
    );
    assert.throws(
        () => scheduler.register('x', { needsFrame: null, onFrame: () => {} }),
        /needsFrame must be a function/,
    );
    assert.throws(
        () => scheduler.register('x', { needsFrame: () => false, onFrame: null }),
        /onFrame must be a function/,
    );
});

// ---------------------------------------------------------------------------
// render-loop.js: panel-ui-idle cheap-frame classification
// ---------------------------------------------------------------------------

test('render-loop: panel-ui-idle is a cheap frame — no publishState', () => {
    // The key Phase 2 invariant: panel-only frames skip publishState.
    // This is the demand-driven structural flag for the co-located World doc.
    const result = classifyRenderLoopWork({
        continuationReasons: ['panel-ui-idle'],
        structuralDirty: false,
    });

    assert.equal(result.structural, false, 'panel-ui-idle: no structural work');
    assert.equal(result.publishState, false, 'panel-ui-idle: publishState skipped');
    assert.equal(result.overlay, false, 'panel-ui-idle: no overlay draw');
    assert.equal(result.visualOnly, false, 'panel-ui-idle is cheap but not visualOnly');
});

test('render-loop: panel-ui-idle + structuralDirty → structural (avatar geometry changed)', () => {
    // Avatar scale drag parity: if structural is dirty (avatar geometry changed),
    // publishState must still run even if panel-ui-idle is also a reason.
    const result = classifyRenderLoopWork({
        continuationReasons: ['panel-ui-idle'],
        structuralDirty: true,
    });

    assert.equal(result.structural, true, 'structuralDirty forces structural=true');
    assert.equal(result.publishState, true, 'structuralDirty forces publishState=true');
});

test('render-loop: panel-ui-idle with avatar-motion stays non-structural', () => {
    // Panel UI + avatar idle motion together: both cheap reasons → no publishState
    const result = classifyRenderLoopWork({
        continuationReasons: ['panel-ui-idle', 'avatar-motion'],
        structuralDirty: false,
    });

    assert.equal(result.structural, false);
    assert.equal(result.publishState, false);
});

test('render-loop: panel-ui-idle + avatar-controls → structural (controls open forces structural)', () => {
    // avatar-controls is NOT a cheap reason; pairing panel-ui-idle with it still
    // results in a structural frame (avatar has non-geometry continuation pending).
    const result = classifyRenderLoopWork({
        continuationReasons: ['panel-ui-idle', 'avatar-controls'],
        structuralDirty: false,
    });

    // avatar-controls is not in cheapFrameReasons, so the mixed frame is structural
    assert.equal(result.structural, true);
    assert.equal(result.publishState, true);
});

// ---------------------------------------------------------------------------
// Regression guard: existing cheap reasons still classify correctly
// ---------------------------------------------------------------------------

test('render-loop regression: avatar-motion still visual-only (unchanged)', () => {
    const result = classifyRenderLoopWork({
        continuationReasons: ['avatar-motion'],
        structuralDirty: false,
    });
    assert.equal(result.structural, false);
    assert.equal(result.publishState, false);
    assert.equal(result.visualOnly, true);
});

test('render-loop regression: avatar-controls still structural (no regression)', () => {
    // avatar-controls is NOT in cheapFrameReasons; this behavior must not change.
    // Phase 0/1 baseline: 31/s publishState while controls are open.
    const result = classifyRenderLoopWork({
        continuationReasons: ['avatar-controls'],
        structuralDirty: false,
    });
    assert.equal(result.structural, true, 'avatar-controls still structural (regression guard)');
    assert.equal(result.publishState, true);
});

test('render-loop regression: structuralDirty=true always structural (no regression)', () => {
    const result = classifyRenderLoopWork({
        continuationReasons: [],
        structuralDirty: true,
    });
    assert.equal(result.structural, true);
    assert.equal(result.publishState, true);
});

// ---------------------------------------------------------------------------
// End-to-end demand-driven path: scheduler + render-loop integration
// ---------------------------------------------------------------------------

test('end-to-end: panel-only interaction drops publishState (scheduler + classifyRenderLoopWork)', () => {
    // Simulates the Phase 2 exit gate condition 1:
    // Under a panel-only interaction (no avatar geometry change), the scheduler
    // drives frames for panel-ui-idle, which classifyRenderLoopWork classifies
    // as non-structural → publishState=false.
    //
    // This is the deterministic proof of the scheduler design; live measurement
    // confirms it against the 31/s baseline (see §Live AOS Evidence in the
    // phase 2 report).

    const { scheduler } = makeTestScheduler();
    const publishStateFrames = [];
    const nonStructuralFrames = [];

    let framesLeft = 5;
    scheduler.register('avatar-scene', {
        needsFrame() { return framesLeft > 0; },
        onFrame(ctx) {
            framesLeft--;
            // Avatar render step: classify work using the structural flag from the scheduler
            const work = classifyRenderLoopWork({
                continuationReasons: ctx.structural ? ['avatar-controls'] : ['panel-ui-idle'],
                structuralDirty: ctx.structural,
            });
            if (work.publishState) {
                publishStateFrames.push(work);
            } else {
                nonStructuralFrames.push(work);
            }
        },
    });
    // panel-ui contributor is active but NOT requesting structural
    let panelFramesLeft = 5;
    scheduler.register('panel-ui', {
        needsFrame() { return panelFramesLeft > 0; },
        onFrame() { panelFramesLeft--; },
    });

    // Run 5 frames without any structural request (panel-only interaction)
    for (let i = 0; i < 5; i++) scheduler.tick();

    assert.equal(publishStateFrames.length, 0, 'no publishState during panel-only interaction (gate 1)');
    assert.equal(nonStructuralFrames.length, 5, '5 non-structural frames delivered');
});

test('end-to-end: avatar scale drag keeps publishState (scheduler + classifyRenderLoopWork)', () => {
    // Phase 2 exit gate condition 2: avatar scale drag parity.
    // When avatar geometry changes, requestStructural() is called, and the
    // classify step sets publishState=true.

    const { scheduler } = makeTestScheduler();
    const publishStateFrames = [];

    let framesLeft = 3;
    const avatarHandle = scheduler.register('avatar-scene', {
        needsFrame() { return framesLeft > 0; },
        onFrame(ctx) {
            framesLeft--;
            const work = classifyRenderLoopWork({
                continuationReasons: ctx.structural ? ['avatar-controls'] : ['panel-ui-idle'],
                structuralDirty: ctx.structural,
            });
            if (work.publishState) publishStateFrames.push(work);
        },
    });
    let panelFramesLeft = 3;
    scheduler.register('panel-ui', {
        needsFrame() { return panelFramesLeft > 0; },
        onFrame() { panelFramesLeft--; },
    });

    // Simulate avatar scale drag: requestStructural on each frame
    for (let i = 0; i < 3; i++) {
        avatarHandle.requestStructural(); // scale changed → structural
        scheduler.tick();
    }

    assert.equal(publishStateFrames.length, 3, 'publishState runs on every avatar-geometry frame (gate 2)');
});
