import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../packages/toolkit/components/canvas-inspector/marks/scheduler.js';
import { createMarksState, applySnapshot } from '../../packages/toolkit/components/canvas-inspector/marks/reconcile.js';

const mark = (id) => ({ id, x: 0, y: 0, w: 20, h: 20, color: '#fff', name: id, rect: true, ellipse: true, cross: true });

function fakeTimers() {
  const scheduled = [];
  const si = (fn, ms) => {
    const handle = { fn, ms };
    scheduled.push(handle);
    return handle;
  };
  const ci = (handle) => {
    const i = scheduled.indexOf(handle);
    if (i >= 0) scheduled.splice(i, 1);
  };
  return { si, ci, scheduled };
}

test('tick with nothing expired leaves state intact', () => {
  const state = createMarksState();
  applySnapshot(state, 'cv', [mark('a')], 1000);
  const calls = [];
  let t = 1000;
  const s = createScheduler({ state, onChange: (e) => calls.push(e), now: () => t });
  t = 2000;
  s.tick();
  assert.deepEqual(calls, []);
  assert.equal(state.marksByCanvas.has('cv'), true);
});

test('tick evicts expired entries and fires onChange with evicted ids', () => {
  const state = createMarksState();
  applySnapshot(state, 'old', [mark('a')], 1000);
  applySnapshot(state, 'fresh', [mark('b')], 9500);
  const calls = [];
  let t = 12_000;
  const s = createScheduler({ state, onChange: (e) => calls.push(e), now: () => t });
  s.tick();
  assert.deepEqual(calls, [['old']]);
  assert.equal(state.marksByCanvas.has('old'), false);
  assert.equal(state.marksByCanvas.has('fresh'), true);
});

test('tick that empties state auto-stops', () => {
  const { si, ci, scheduled } = fakeTimers();
  const state = createMarksState();
  applySnapshot(state, 'old', [mark('a')], 1000);
  let t = 1000;
  const s = createScheduler({ state, now: () => t, setInterval: si, clearInterval: ci });
  s.start();
  assert.equal(s.isRunning(), true);
  assert.equal(scheduled.length, 1);
  t = 20_000;
  s.tick();
  assert.equal(s.isRunning(), false);
  assert.equal(scheduled.length, 0);
});

test('start is idempotent', () => {
  const { si, ci, scheduled } = fakeTimers();
  const state = createMarksState();
  applySnapshot(state, 'cv', [mark('a')], 1000);
  const s = createScheduler({ state, setInterval: si, clearInterval: ci });
  s.start();
  s.start();
  s.start();
  assert.equal(scheduled.length, 1);
});

test('stop is idempotent and safe when not started', () => {
  const { si, ci, scheduled } = fakeTimers();
  const state = createMarksState();
  const s = createScheduler({ state, setInterval: si, clearInterval: ci });
  s.stop();
  s.stop();
  s.start();
  s.stop();
  s.stop();
  assert.equal(scheduled.length, 0);
  assert.equal(s.isRunning(), false);
});

test('interval callback runs tick', () => {
  const { si, ci, scheduled } = fakeTimers();
  const state = createMarksState();
  applySnapshot(state, 'old', [mark('a')], 1000);
  const calls = [];
  let t = 1000;
  const s = createScheduler({ state, onChange: (e) => calls.push(e), now: () => t, setInterval: si, clearInterval: ci });
  s.start();
  t = 20_000;
  scheduled[0].fn(); // simulate timer firing
  assert.deepEqual(calls, [['old']]);
  assert.equal(s.isRunning(), false); // auto-stopped since state empty
});

test('throws if state is not provided', () => {
  assert.throws(() => createScheduler({}), /state is required/);
});
