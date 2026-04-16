import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderLoopScheduler } from '../../apps/sigil/renderer/live-modules/render-loop.js';

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
