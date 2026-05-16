import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GateReceptor } from '../../packages/daemon/gate/GateReceptor.js';
import { createGateService, normalizeGateRequest } from '../../packages/daemon/gate/index.js';

function request(id, overrides = {}) {
  return {
    schema_version: 'aos.gate.request.v1',
    id,
    prompt: { title: `Gate ${id}`, body: null },
    fields: [{ id: 'decision', kind: 'boolean' }],
    timeout_ms: 20000,
    source: { surface: 'test' },
    ...overrides,
  };
}

class ManualReceptor extends GateReceptor {
  constructor(callbacks) {
    super(callbacks);
    this.handles = [];
    this.dismissed = [];
  }

  async present(gateRequest) {
    const handle = { id: gateRequest.id };
    this.handles.push(handle);
    return handle;
  }

  async dismiss(handle) {
    this.dismissed.push(handle?.id);
  }
}

function timeoutHarness() {
  const timers = [];
  return {
    timers,
    setTimeoutFn(callback, ms) {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      if (timer) timer.cleared = true;
    },
  };
}

test('normalizeGateRequest assigns id, source, fields, and clamps timeout', () => {
  const normalized = normalizeGateRequest({
    prompt: { title: 'Continue?' },
    ui: { variant: 'yes_no_with_escape' },
    timeout_ms: 1,
  });

  assert.equal(normalized.schema_version, 'aos.gate.request.v1');
  assert.match(normalized.id, /^gate-/);
  assert.equal(normalized.timeout_ms, 5000);
  assert.equal(normalized.source.surface, 'aos-cli');
  assert.equal(normalized.fields.length, 2);
  assert.equal('fields' in normalized.ui, false);
});

test('ask resolves with user values and cleans up pending gate', async () => {
  const harness = timeoutHarness();
  let receptor;
  const service = createGateService({
    receptorFactory(callbacks) {
      receptor = new ManualReceptor(callbacks);
      return receptor;
    },
    ...harness,
  });

  const promise = service.ask(request('gate-a'));
  await new Promise((resolve) => setImmediate(resolve));
  receptor.resolve('gate-a', { decision: true });

  assert.deepEqual(await promise, { decision: true });
  assert.equal(service.pending.size, 0);
  assert.deepEqual(receptor.dismissed, ['gate-a']);
  assert.equal(harness.timers[0].cleared, true);
});

test('ask resolves no-answer envelope on service timeout', async () => {
  const harness = timeoutHarness();
  let receptor;
  const service = createGateService({
    receptorFactory(callbacks) {
      receptor = new ManualReceptor(callbacks);
      return receptor;
    },
    ...harness,
  });

  const promise = service.ask(request('gate-timeout', { timeout_ms: 9000 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.timers[0].ms, 9000);
  harness.timers[0].callback();

  assert.deepEqual(await promise, { result: null, status: 'timeout' });
  assert.equal(service.pending.size, 0);
  assert.deepEqual(receptor.dismissed, ['gate-timeout']);
});

test('ask resolves no-answer envelope on human dismissal', async () => {
  const harness = timeoutHarness();
  let receptor;
  const service = createGateService({
    receptorFactory(callbacks) {
      receptor = new ManualReceptor(callbacks);
      return receptor;
    },
    ...harness,
  });

  const promise = service.ask(request('gate-dismiss'));
  await new Promise((resolve) => setImmediate(resolve));
  receptor.resolve('gate-dismiss', null);

  assert.deepEqual(await promise, { result: null, status: 'dismissed' });
  assert.equal(service.pending.size, 0);
  assert.deepEqual(receptor.dismissed, ['gate-dismiss']);
});

test('ask handles concurrent gates independently', async () => {
  const harness = timeoutHarness();
  const receptors = [];
  const service = createGateService({
    receptorFactory(callbacks) {
      const receptor = new ManualReceptor(callbacks);
      receptors.push(receptor);
      return receptor;
    },
    ...harness,
  });

  const first = service.ask(request('gate-1'));
  const second = service.ask(request('gate-2'));
  await new Promise((resolve) => setImmediate(resolve));

  receptors[1].resolve('gate-2', { decision: false });
  assert.deepEqual(await second, { decision: false });
  assert.equal(service.pending.has('gate-1'), true);
  assert.equal(service.pending.has('gate-2'), false);

  receptors[0].resolve('gate-1', { decision: true });
  assert.deepEqual(await first, { decision: true });
  assert.equal(service.pending.size, 0);
});

test('ask rejects when receptor reports an error', async () => {
  const harness = timeoutHarness();
  let receptor;
  const service = createGateService({
    receptorFactory(callbacks) {
      receptor = new ManualReceptor(callbacks);
      return receptor;
    },
    ...harness,
  });

  const promise = service.ask(request('gate-error'));
  await new Promise((resolve) => setImmediate(resolve));
  receptor.reject('gate-error', new Error('surface failed'));

  await assert.rejects(
    () => promise,
    (error) => error.code === 'AOS_GATE_RECEPTOR_ERROR' && /surface failed/.test(error.message),
  );
  assert.equal(service.pending.size, 0);
  assert.deepEqual(receptor.dismissed, ['gate-error']);
});
