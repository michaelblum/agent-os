import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateReceptor } from '../../packages/daemon/gate/GateReceptor.js';
import { createGateService, normalizeGateRequest } from '../../packages/daemon/gate/index.js';
import { GateRecordStore } from '../../packages/daemon/gate/records.js';
import { runGateAsk } from '../../packages/cli/verbs/gate-ask.js';

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

function writable() {
  let text = '';
  return {
    write(chunk) {
      text += chunk;
    },
    text() {
      return text;
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

test('gate ask rejects preset values outside the manifest enum', async () => {
  const stdout = writable();
  const stderr = writable();
  const code = await runGateAsk(['--preset', 'maybe_later', '--title', 'Continue?'], { stdout, stderr });

  assert.equal(code, 1);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /--preset must be one of: yes_no_with_escape, approve_deny, single_choice, multi_choice, freetext/);
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

test('gate records persist answered, dismissed, timeout, and error outcomes with redacted payloads by default', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-gate-records-'));
  const path = join(stateRoot, 'repo', 'gate', 'records.jsonl');
  const store = new GateRecordStore({ path });
  const harness = timeoutHarness();
  const receptors = [];
  const service = createGateService({
    receptorFactory(callbacks) {
      const receptor = new ManualReceptor(callbacks);
      receptors.push(receptor);
      return receptor;
    },
    recordStore: store,
    ...harness,
  });

  const answered = service.ask(request('gate-record-answer', {
    prompt: { title: 'Answer me', body: 'do not persist body' },
    source: { surface: 'test', session_id: 'session-1', agent: 'gdi', ignored: 'nope' },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  receptors[0].resolve('gate-record-answer', { decision: true, notes: 'private' });
  assert.deepEqual(await answered, { decision: true, notes: 'private' });

  const dismissed = service.ask(request('gate-record-dismiss'));
  await new Promise((resolve) => setImmediate(resolve));
  receptors[1].resolve('gate-record-dismiss', null);
  assert.deepEqual(await dismissed, { result: null, status: 'dismissed' });

  const timedOut = service.ask(request('gate-record-timeout', { timeout_ms: 9000 }));
  await new Promise((resolve) => setImmediate(resolve));
  harness.timers[2].callback();
  assert.deepEqual(await timedOut, { result: null, status: 'timeout' });

  const errored = service.ask(request('gate-record-error'));
  await new Promise((resolve) => setImmediate(resolve));
  receptors[3].reject('gate-record-error', new Error('surface failed'));
  await assert.rejects(() => errored, /surface failed/);

  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 4);
  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => record.resolution), ['answered', 'dismissed', 'timeout', 'error']);
  assert.equal(records[0].schema_version, 'aos.gate.record.v1');
  assert.equal(records[0].gate_id, 'gate-record-answer');
  assert.equal(records[0].request_schema_version, 'aos.gate.request.v1');
  assert.equal(records[0].prompt_title, 'Answer me');
  assert.deepEqual(records[0].source, { surface: 'test', session_id: 'session-1', agent: 'gdi' });
  assert.equal(records[0].receptor, 'ManualReceptor');
  assert.deepEqual(records[0].field_kinds, ['boolean']);
  assert.equal(records[0].response_stored, false);
  assert.equal('response' in records[0], false);
  assert.equal('body' in records[0], false);
  assert.equal(records[1].status, 'dismissed');
  assert.equal(records[2].status, 'timeout');
  assert.equal(records[3].error_code, 'AOS_GATE_RECEPTOR_ERROR');
  assert.match(records[3].error_message, /surface failed/);
});

test('gate records can deliberately store answer payloads by request opt-in', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-gate-records-opt-in-'));
  const store = new GateRecordStore({ path: join(stateRoot, 'repo', 'gate', 'records.jsonl') });
  const harness = timeoutHarness();
  let receptor;
  const service = createGateService({
    receptorFactory(callbacks) {
      receptor = new ManualReceptor(callbacks);
      return receptor;
    },
    recordStore: store,
    ...harness,
  });

  const promise = service.ask(request('gate-record-store-response', {
    metadata: { record_response: true },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  receptor.resolve('gate-record-store-response', { decision: true });
  await promise;

  const records = await store.list({ limit: 10 });
  assert.equal(records[0].response_stored, true);
  assert.deepEqual(records[0].response, { decision: true });
});

test('gate records persist unsupported receptor field errors after request normalization', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-gate-records-unsupported-'));
  const store = new GateRecordStore({ path: join(stateRoot, 'repo', 'gate', 'records.jsonl') });
  const receptor = new ManualReceptor({});
  receptor.supports = () => false;
  const service = createGateService({ receptor, recordStore: store, ...timeoutHarness() });

  await assert.rejects(
    () => service.ask(request('gate-record-unsupported')),
    (error) => error.code === 'AOS_GATE_UNSUPPORTED_FIELD',
  );

  const records = await store.list({ limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].gate_id, 'gate-record-unsupported');
  assert.equal(records[0].resolution, 'error');
  assert.equal(records[0].error_code, 'AOS_GATE_UNSUPPORTED_FIELD');
  assert.equal(records[0].response_stored, false);
});
