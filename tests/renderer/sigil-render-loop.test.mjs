import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
    sessionVitalityRefreshing: false,
    sessionVitalityFlickerAmount: 0,
  }), ['avatar-motion']);
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
