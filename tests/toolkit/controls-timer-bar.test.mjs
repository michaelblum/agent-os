import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimerBar } from '../../packages/toolkit/controls/timer-bar.js';
import { createFakeDocument } from './dom-fixture.mjs';

function timerHarness() {
  const document = createFakeDocument();
  let time = 0;
  const frames = [];
  document.defaultView.performance.now = () => time;
  document.defaultView.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  document.defaultView.cancelAnimationFrame = () => {};
  return {
    document,
    tick(ms) {
      time += ms;
      const callback = frames.shift();
      callback?.(time);
    },
  };
}

test('createTimerBar returns shape and decrements with rAF ticks', () => {
  const harness = timerHarness();
  const timer = createTimerBar({ document: harness.document, totalMs: 1000 });

  assert.equal(typeof timer.start, 'function');
  assert.equal(typeof timer.pause, 'function');
  assert.equal(typeof timer.resume, 'function');
  assert.equal(typeof timer.reset, 'function');
  assert.equal(typeof timer.getRemainingMs, 'function');
  assert.equal(typeof timer.destroy, 'function');

  timer.start();
  harness.tick(250);
  assert.equal(timer.getRemainingMs(), 750);
});

test('timer clamps to zero and expires once', () => {
  const harness = timerHarness();
  let expired = 0;
  const timer = createTimerBar({ document: harness.document, totalMs: 1000, onExpire: () => { expired += 1; } });

  timer.start();
  harness.tick(1200);
  harness.tick(1200);

  assert.equal(timer.getRemainingMs(), 0);
  assert.equal(expired, 1);
});

test('timer pause, resume, and reset manage elapsed state', () => {
  const harness = timerHarness();
  const timer = createTimerBar({ document: harness.document, totalMs: 1000 });

  timer.start();
  harness.tick(300);
  timer.pause();
  harness.tick(300);
  assert.equal(timer.getRemainingMs(), 700);
  timer.resume();
  harness.tick(200);
  assert.equal(timer.getRemainingMs(), 500);
  timer.reset();
  assert.equal(timer.getRemainingMs(), 1000);
});
