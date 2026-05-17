import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { GateRecordStore } from '../../packages/daemon/gate/records.js';
import { GateContinuationStore } from '../../packages/daemon/gate/continuations.js';
import { runGateContinuations } from '../../packages/cli/verbs/gate-continuations.js';
import { runGateDefer } from '../../packages/cli/verbs/gate-defer.js';
import { runGateSubmit } from '../../packages/cli/verbs/gate-submit.js';

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

function request(id = 'gate-deferred') {
  return {
    schema_version: 'aos.gate.request.v1',
    id,
    prompt: { title: 'Continue later?', body: 'private body' },
    ui: { variant: 'approve_deny' },
    timeout_ms: 20000,
    source: { surface: 'test', session_id: 'source-session', agent: 'gdi', private: 'nope' },
  };
}

test('defer returns immediately and writes one pending continuation with redacted request data', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-gate-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const started = Date.now();
  const record = await store.create({
    request: request('gate-create'),
    sessionId: 'codex-session-1',
    harness: 'codex',
    cwd: process.cwd(),
  });

  assert.ok(Date.now() - started < 1000);
  assert.equal(record.schema_version, 'aos.gate.continuation.v1');
  assert.match(record.continuation_id, /^gate-cont-/);
  assert.equal(record.gate_id, 'gate-create');
  assert.equal(record.lifecycle.state, 'pending');
  assert.equal(record.storage.continuation_path, join(stateRoot, 'repo', 'gate', 'continuations', `${record.continuation_id}.json`));
  assert.equal(record.prompt_title, 'Continue later?');
  assert.deepEqual(record.source, { surface: 'test', session_id: 'source-session', agent: 'gdi' });
  assert.equal('body' in record, false);
  assert.equal(record.response_stored, false);
  assert.equal('response' in record, false);

  const stored = JSON.parse(await readFile(join(stateRoot, 'repo', 'gate', 'continuations', `${record.continuation_id}.json`), 'utf8'));
  assert.equal(stored.continuation_id, record.continuation_id);
});

test('continuation storage is runtime-mode scoped', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-scope-'));
  const repoStore = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const installedStore = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'installed' } });
  const repo = await repoStore.create({ request: request('gate-repo'), sessionId: 'repo-session', harness: 'codex' });
  const installed = await installedStore.create({ request: request('gate-installed'), sessionId: 'installed-session', harness: 'codex' });

  assert.equal((await repoStore.list()).length, 1);
  assert.equal((await installedStore.list()).length, 1);
  assert.equal((await repoStore.list())[0].continuation_id, repo.continuation_id);
  assert.equal((await installedStore.list())[0].continuation_id, installed.continuation_id);
});

test('readback filters continuations by id and status', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-readback-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const first = await store.create({ request: request('gate-first'), sessionId: 'session-1', harness: 'codex' });
  const second = await store.create({ request: request('gate-second'), sessionId: 'session-2', harness: 'codex' });
  await store.markTerminal(second.continuation_id, 'expired');

  const stdout = writable();
  const stderr = writable();
  const code = await runGateContinuations(['--status', 'pending', '--json'], { stdout, stderr, store });
  assert.equal(code, 0);
  assert.equal(stderr.text(), '');
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.schema_version, 'aos.gate.continuations.readback.v1');
  assert.equal(payload.count, 1);
  assert.equal(payload.continuations[0].continuation_id, first.continuation_id);

  assert.equal((await store.list({ id: second.continuation_id, status: 'pending' })).length, 0);
  assert.equal((await store.list({ id: second.continuation_id, status: 'expired' })).length, 1);
});

test('submit marks pending continuation submitted and writes a human-authored resume event and one gate record', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-submit-'));
  const recordStore = new GateRecordStore({ path: join(stateRoot, 'repo', 'gate', 'records.jsonl') });
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' }, recordStore });
  const continuation = await store.create({ request: request('gate-submit'), sessionId: 'codex-session-9', harness: 'codex' });
  const result = await store.submit({
    continuationId: continuation.continuation_id,
    response: { decision: 'approve', private_notes: 'do not store' },
    submittedBy: { role: 'human', user: 'tester' },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.record.lifecycle.state, 'submitted');
  assert.equal(result.record.response_stored, false);
  assert.equal('response' in result.record, false);
  assert.equal(result.event.schema_version, 'aos.gate.resume-event.v1');
  assert.equal(result.event.session_id, 'codex-session-9');
  assert.equal(result.event.harness, 'codex');
  assert.equal(result.event.continuation_id, continuation.continuation_id);
  assert.equal(result.event.gate_id, 'gate-submit');
  assert.equal(result.event.authored_role, 'human');
  assert.deepEqual(result.event.answer_summary, { kind: 'object', keys: ['decision', 'private_notes'] });
  assert.equal(result.event.response_stored, false);
  assert.equal('response' in result.event, false);
  assert.match(result.record.resume.event_path, /repo\/gate\/resume-events\/gate-resume-/);
  assert.equal((await recordStore.list({ limit: 10 })).length, 1);
});

test('duplicate submit is idempotent and does not create duplicate resume events', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-duplicate-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const continuation = await store.create({ request: request('gate-dupe'), sessionId: 'session-dupe', harness: 'codex' });
  const first = await store.submit({ continuationId: continuation.continuation_id, response: { decision: 'approve' } });
  const second = await store.submit({ continuationId: continuation.continuation_id, response: { decision: 'deny' } });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.event.event_id, first.event.event_id);
  assert.deepEqual(second.event.answer_summary, first.event.answer_summary);
  const eventFiles = await readdir(join(stateRoot, 'repo', 'gate', 'resume-events'));
  assert.equal(eventFiles.length, 1);
});

test('continuation ids are constrained before filesystem access', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-id-guard-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });

  await assert.rejects(() => store.read('../escape'), /invalid continuation id/);
  await assert.rejects(() => store.submit({ continuationId: '../escape', response: { decision: 'approve' } }), /invalid continuation id/);
});

test('cancelled and expired continuations cannot be submitted', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-terminal-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const cancelled = await store.create({ request: request('gate-cancel'), sessionId: 'session-cancel', harness: 'codex' });
  const expired = await store.create({ request: request('gate-expire'), sessionId: 'session-expire', harness: 'codex' });
  await store.markTerminal(cancelled.continuation_id, 'cancelled');
  await store.markTerminal(expired.continuation_id, 'expired');

  await assert.rejects(() => store.submit({ continuationId: cancelled.continuation_id, response: { decision: 'approve' } }), /cancelled/);
  await assert.rejects(() => store.submit({ continuationId: expired.continuation_id, response: { decision: 'approve' } }), /expired/);
});

test('explicit response payload opt-in stores response in continuation and resume event', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-opt-in-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const continuation = await store.create({ request: request('gate-opt-in'), sessionId: 'session-opt-in', harness: 'codex' });
  const result = await store.submit({
    continuationId: continuation.continuation_id,
    response: { decision: 'approve' },
    storeResponse: true,
  });

  assert.equal(result.record.response_stored, true);
  assert.deepEqual(result.record.response, { decision: 'approve' });
  assert.equal(result.event.response_stored, true);
  assert.deepEqual(result.event.response, { decision: 'approve' });
});

test('CLI defer and submit use AOS_STATE_ROOT and do not mutate canonical repo state', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-deferred-cli-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const store = new GateContinuationStore({ env });
  const stdout = writable();
  const stderr = writable();
  const createCode = await runGateDefer([
    '--json',
    JSON.stringify(request('gate-cli')),
    '--session-id',
    'codex-cli-session',
    '--harness',
    'codex',
  ], { stdout, stderr, store });

  assert.equal(createCode, 0, stderr.text());
  const created = JSON.parse(stdout.text());
  assert.equal(created.state, 'pending');
  assert.match(created.continuation_id, /^gate-cont-/);
  assert.equal(created.path, join(stateRoot, 'repo', 'gate', 'continuations', `${created.continuation_id}.json`));

  const submitOut = writable();
  const submitErr = writable();
  const submitCode = await runGateSubmit([
    '--continuation-id',
    created.continuation_id,
    '--json',
    JSON.stringify({ decision: 'approve' }),
  ], { stdout: submitOut, stderr: submitErr, store });
  assert.equal(submitCode, 0, submitErr.text());
  assert.equal(JSON.parse(submitOut.text()).resume_event.session_id, 'codex-cli-session');
  assert.ok(!stateRoot.startsWith(join(homedir(), '.config', 'aos', 'repo')));
});
