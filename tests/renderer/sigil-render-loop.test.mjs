import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRenderLoopWork,
  createRenderLoopScheduler,
  renderLoopContinuationReasons,
  shouldContinueRenderLoop,
} from '../../apps/sigil/renderer/live-modules/render-loop.js';

test('suspend blocks reschedule until resume', () => {
  const queued = [];
  const loop = createRenderLoopScheduler((cb) => {
    queued.push(cb);
    return queued.length;
  });

  const frames = [];
  const step = () => {
    frames.push(`frame-${frames.length + 1}`);
    loop.schedule(step);
  };

  loop.schedule(step);
  assert.equal(queued.length, 1);

  queued.shift()();
  assert.deepEqual(frames, ['frame-1']);
  assert.equal(queued.length, 1);

  loop.suspend();
  queued.shift()();
  assert.deepEqual(frames, ['frame-1', 'frame-2']);
  assert.equal(queued.length, 0);

  loop.schedule(step);
  assert.equal(queued.length, 0);

  loop.resume();
  loop.schedule(step);
  assert.equal(queued.length, 1);

  queued.shift()();
  assert.deepEqual(frames, ['frame-1', 'frame-2', 'frame-3']);
});

test('delayed continuous schedule stays queued and is canceled by suspend', () => {
  const queued = [];
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (cb, ms) => {
    timers.push({ cb, ms, cleared: false });
    return timers.length - 1;
  };
  globalThis.clearTimeout = (id) => {
    if (timers[id]) timers[id].cleared = true;
  };
  try {
    const loop = createRenderLoopScheduler((cb) => {
      queued.push(cb);
      return queued.length;
    });
    loop.schedule(() => {}, { mode: 'continuous', delayMs: 33 });
    assert.equal(loop.queued, true);
    assert.equal(loop.delayed, true);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 33);

    loop.suspend();
    assert.equal(loop.queued, false);
    assert.equal(loop.delayed, false);
    assert.equal(timers[0].cleared, true);
    assert.equal(queued.length, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('immediate dirty schedule preempts a delayed visual frame', () => {
  const queued = [];
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (cb, ms) => {
    timers.push({ cb, ms, cleared: false });
    return timers.length - 1;
  };
  globalThis.clearTimeout = (id) => {
    if (timers[id]) timers[id].cleared = true;
  };
  try {
    const loop = createRenderLoopScheduler((cb) => {
      queued.push(cb);
      return queued.length;
    });
    const frames = [];
    loop.schedule(() => frames.push('visual'), { mode: 'continuous', delayMs: 33 });
    loop.schedule(() => frames.push('dirty'), { mode: 'dirty' });

    assert.equal(timers[0].cleared, true);
    assert.equal(loop.queued, true);
    assert.equal(loop.delayed, false);
    assert.equal(queued.length, 1);

    queued.shift()();
    assert.deepEqual(frames, ['dirty']);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('hidden or paused idle avatar does not require continuous rendering', () => {
  assert.equal(shouldContinueRenderLoop({
    rendererSuspended: false,
    currentState: 'IDLE',
    avatarMotionActive: false,
    avatarHover: false,
    avatarHoverProgress: 0,
    visibilityTransitionActive: false,
    fastTravelActive: false,
    radialActivationTransitionActive: false,
    radialGestureActive: false,
    contextMenuOpen: false,
    annotationReticleActive: false,
    selectionModeActive: false,
    sessionVitalityRefreshing: false,
    sessionVitalityFlickerAmount: 0,
  }), false);
});

test('visible idle avatar motion keeps render loop continuous with explicit reason', () => {
  assert.deepEqual(renderLoopContinuationReasons({
    rendererSuspended: false,
    currentState: 'IDLE',
    avatarMotionActive: true,
    avatarHover: false,
    avatarHoverProgress: 0,
    visibilityTransitionActive: false,
    fastTravelActive: false,
    radialActivationTransitionActive: false,
    radialGestureActive: false,
    contextMenuOpen: false,
    annotationReticleActive: false,
    selectionModeActive: false,
    sessionVitalityRefreshing: false,
    sessionVitalityFlickerAmount: 0,
  }), ['avatar-motion']);
});

test('idle avatar motion is classified as visual-only when no structural inputs are dirty', () => {
  assert.deepEqual(classifyRenderLoopWork({
    continuationReasons: ['avatar-motion'],
    structuralDirty: false,
  }), {
    continuationReasons: ['avatar-motion'],
    structural: false,
    overlay: false,
    publishState: false,
    visualOnly: true,
  });
});

test('unchanged Selection Mode cursor frames stay visual-only', () => {
  assert.deepEqual(classifyRenderLoopWork({
    continuationReasons: ['avatar-motion', 'selection-mode'],
    structuralDirty: false,
  }), {
    continuationReasons: ['avatar-motion', 'selection-mode'],
    structural: false,
    overlay: false,
    publishState: false,
    visualOnly: true,
  });
});

test('dirty or interactive frames keep structural sync and state publish active', () => {
  assert.equal(classifyRenderLoopWork({
    continuationReasons: ['avatar-motion'],
    structuralDirty: true,
  }).structural, true);

  const hover = classifyRenderLoopWork({
    continuationReasons: ['avatar-motion', 'hover-easing'],
    structuralDirty: false,
  });
  assert.equal(hover.overlay, true);
  assert.equal(hover.publishState, true);
  assert.equal(hover.visualOnly, false);
});

test('transitions and interaction states keep render loop continuous', () => {
  assert.deepEqual(renderLoopContinuationReasons({
    currentState: 'IDLE',
    visibilityTransitionActive: true,
  }), ['visibility-transition']);

  assert.ok(shouldContinueRenderLoop({
    currentState: 'RADIAL',
    radialGestureActive: true,
  }));

  assert.deepEqual(renderLoopContinuationReasons({
    currentState: 'IDLE',
    selectionModeActive: true,
  }), ['selection-mode']);

  assert.deepEqual(renderLoopContinuationReasons({
    currentState: 'IDLE',
    selectionModeEffectActive: true,
  }), ['selection-mode-effect']);

  assert.ok(shouldContinueRenderLoop({
    currentState: 'IDLE',
    avatarHover: true,
    avatarHoverProgress: 0.5,
  }));

  assert.ok(shouldContinueRenderLoop({
    currentState: 'IDLE',
    sessionVitalityRefreshing: true,
  }));
});
