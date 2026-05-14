import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GateReceptor } from '../../packages/daemon/gate/GateReceptor.js';
import { LocalCanvasReceptor, parseGateResult } from '../../packages/daemon/gate/LocalCanvasReceptor.js';

function request(overrides = {}) {
  return {
    schema_version: 'aos.gate.request.v1',
    id: 'gate-test',
    prompt: { title: 'Continue?', body: null },
    fields: [{ id: 'decision', kind: 'boolean' }],
    timeout_ms: 20000,
    source: { surface: 'test' },
    ...overrides,
  };
}

test('GateReceptor exposes receive, resolve, reject, and support checks', async () => {
  const events = [];
  class TestReceptor extends GateReceptor {
    async present(gateRequest) {
      return { id: gateRequest.id };
    }
  }
  const receptor = new TestReceptor({
    onResolve: (id, values) => events.push(['resolve', id, values]),
    onReject: (id, reason) => events.push(['reject', id, reason]),
  });

  assert.deepEqual(await receptor.receive(request()), { id: 'gate-test' });
  assert.equal(receptor.supports('text'), true);
  assert.equal(receptor.supports('point3d'), false);

  receptor.resolve('gate-test', { decision: true });
  receptor.reject('gate-test', 'cancel');

  assert.deepEqual(events, [
    ['resolve', 'gate-test', { decision: true }],
    ['reject', 'gate-test', 'cancel'],
  ]);
});

test('base GateReceptor requires concrete presentation', async () => {
  const receptor = new GateReceptor();
  await assert.rejects(() => receptor.receive(request()), /present\(\) must be implemented/);
});

test('LocalCanvasReceptor creates canvas, polls result, resolves, and dismisses', async () => {
  const calls = [];
  const events = [];
  const intervals = [];
  const receptor = new LocalCanvasReceptor({
    canvasClient: {
      async createCanvas(gateRequest) {
        calls.push(['create', gateRequest.id]);
        return 'canvas-1';
      },
      async evalCanvas(canvasId) {
        calls.push(['eval', canvasId]);
        return JSON.stringify({ decision: 'yes' });
      },
      async removeCanvas(canvasId) {
        calls.push(['remove', canvasId]);
      },
    },
    setIntervalFn(callback) {
      intervals.push(callback);
      return 'poller-1';
    },
    clearIntervalFn(id) {
      calls.push(['clear', id]);
    },
    onResolve: (id, values) => events.push(['resolve', id, values]),
    onReject: (id, reason) => events.push(['reject', id, reason]),
  });

  const handle = await receptor.receive(request());
  await new Promise((resolve) => setImmediate(resolve));
  await receptor.dismiss(handle);

  assert.equal(handle.canvasId, 'canvas-1');
  assert.deepEqual(events, [['resolve', 'gate-test', { decision: 'yes' }]]);
  assert.deepEqual(calls, [
    ['create', 'gate-test'],
    ['eval', 'canvas-1'],
    ['clear', 'poller-1'],
    ['remove', 'canvas-1'],
  ]);
  assert.equal(intervals.length, 1);
});

test('LocalCanvasReceptor rejects when canvas polling fails', async () => {
  const events = [];
  const receptor = new LocalCanvasReceptor({
    canvasClient: {
      async createCanvas() {
        return 'canvas-1';
      },
      async evalCanvas() {
        throw new Error('canvas closed');
      },
      async removeCanvas() {},
    },
    setIntervalFn() {
      return 'poller-1';
    },
    clearIntervalFn() {},
    onResolve: (id, values) => events.push(['resolve', id, values]),
    onReject: (id, reason) => events.push(['reject', id, reason.message]),
  });

  await receptor.receive(request());
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [['reject', 'gate-test', 'canvas closed']]);
});

test('parseGateResult handles canvas string protocol', () => {
  assert.equal(parseGateResult(undefined), undefined);
  assert.equal(parseGateResult('undefined'), undefined);
  assert.equal(parseGateResult('null'), null);
  assert.deepEqual(parseGateResult('{"decision":"yes"}'), { decision: 'yes' });
  assert.deepEqual(parseGateResult(JSON.stringify(JSON.stringify({ decision: 'yes' }))), { decision: 'yes' });
});
