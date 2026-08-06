import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseError,
  parseJSON,
  readTextIfExists,
  run,
  savedCaptureFixture,
  savedRefFixture,
  validateJSONFile,
  writeJSON,
} from '../lib/pending-annotation-fixtures.mjs';

test('pending annotation CLI creates an explicit target record and consumes it once', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_SESSION_ID: 'test-session',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-test',
    '--target-kind',
    'browser',
    '--target-summary',
    'Save button in checkout form',
    '--comment',
    'Use this button',
    '--artifact',
    'screenshot=/tmp/aos-pending-annotation-test.png',
    '--json',
  ], env));

  assert.equal(created.status, 'created');
  assert.equal(created.annotation.id, 'ann-test');
  assert.equal(created.annotation.state, 'pending');
  assert.equal(created.annotation.saved_ref, null);
  assert.equal(created.annotation.recommended_next_count, 1);

  const recordPath = created.annotation.path;
  validateJSONFile(recordPath);
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.target.saved_ref, null);
  assert.equal(record.artifact_refs[0].role, 'screenshot');

  const listed = parseJSON(run(['list', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-test');

  const read = parseJSON(run(['read', 'ann-test', '--json'], env));
  assert.equal(read.annotation.comment.text, 'Use this button');

  const consumed = parseJSON(run(['consume', 'ann-test', '--actor', 'test-agent', '--json'], env));
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.annotation.state, 'consumed');
  assert.equal(typeof consumed.consumed_annotation.lifecycle.consumed_at, 'string');
  assert.equal(consumed.consumed_annotation.lifecycle.consumed_by.source, 'test-agent');

  const linked = parseJSON(run([
    'link-work-record',
    'ann-test',
    '--work-record',
    'work-record:annotation-action-proof',
    '--relation',
    'annotation_action_evidence',
    '--artifact',
    'after_readback=/tmp/aos-after-readback.json',
    '--actor',
    'test-agent',
    '--json',
  ], env));
  assert.equal(linked.status, 'linked');
  assert.equal(linked.annotation.state, 'consumed');
  assert.equal(linked.annotation.work_record_link_count, 1);
  assert.equal(linked.work_record_link.ref, 'work-record:annotation-action-proof');
  assert.equal(linked.work_record_link.relationship, 'annotation_action_evidence');
  assert.equal(linked.work_record_link.artifact_refs[0].role, 'after_readback');
  assert.equal(linked.linked_annotation.work_record_links[0].linked_by.source, 'test-agent');
  validateJSONFile(recordPath);

  const secondConsume = run(['consume', 'ann-test', '--json'], env);
  assert.notEqual(secondConsume.status, 0);
  const err = JSON.parse(secondConsume.stderr);
  assert.equal(err.code, 'PENDING_ANNOTATION_NOT_CONSUMABLE');
  assert.equal(err.state, 'consumed');
});

test('pending annotation capture projection maps every valid typed handle independent of action hints', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const cases = [
    ['browser', 'browser', 'browser'],
    ['canvas', 'aos_canvas', 'canvas'],
    ['native', 'native_ax', 'native_ax'],
  ];

  for (const [name, backend, targetKind] of cases) {
    const snapshot = `snap-${name}`;
    const capturePath = await writeJSON(fixtureRoot, `${name}.json`, savedCaptureFixture({
      snapshot,
      refs: [savedRefFixture({
        ref: 'r1',
        snapshot,
        backend,
        summary: `${name} selected target`,
        supportedActions: [],
      })],
    }));

    const created = parseJSON(run([
      'create',
      '--id',
      `ann-${name}`,
      '--from-capture-json',
      capturePath,
      '--ref',
      'r1',
      '--comment',
      'operator chose this target',
      '--json',
    ], env));

    const read = parseJSON(run(['read', `ann-${name}`, '--json'], env));
    assert.equal(created.annotation.state, 'pending');
    assert.equal(created.annotation.capability_status, 'saved_ref');
    assert.equal(read.annotation.target.kind, targetKind);
    assert.equal(read.annotation.target.saved_ref.ref, 'r1');
    assert.equal(read.annotation.target.saved_ref.backend, backend);
    assert.equal(read.annotation.source_capture.kind, 'saved_capture');
    assert.equal(read.annotation.source_capture.selected_ref, 'r1');
    assert.deepEqual(read.annotation.recommended_next[0].argv, [
      'aos',
      'see',
      'refs',
      '--workspace',
      'ws1',
      '--snapshot',
      snapshot,
      '--json',
    ]);
    validateJSONFile(created.annotation.path);
  }
});

test('pending annotation --from-json rejects saved-capture envelopes without projection', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-json-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-json-capture-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const capturePath = await writeJSON(fixtureRoot, 'capture-envelope.json', savedCaptureFixture({
    refs: [savedRefFixture()],
  }));

  const rejected = parseError(run(['create', '--id', 'ann-json-capture', '--from-json', capturePath, '--json'], env));
  assert.equal(rejected.code, 'INVALID_ARG');
  assert.match(rejected.error, /Unsupported target kind/);
  assert.equal(
    await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-json-capture.json')),
    null,
  );

  const projected = parseJSON(run(['create', '--id', 'ann-capture-adapter', '--from-capture-json', capturePath, '--json'], env));
  assert.equal(projected.status, 'created');
  validateJSONFile(projected.annotation.path);
});

test('pending annotation rejects V0 saved captures before writing a record', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-v0-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-v0-fixture-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const capturePath = await writeJSON(fixtureRoot, 'capture-v0.json', {
    ...savedCaptureFixture({ refs: [savedRefFixture()] }),
    schema_version: 'aos.agent-workspace.v0',
  });

  const rejected = parseError(run([
    'create', '--id', 'ann-v0-capture', '--from-capture-json', capturePath, '--json',
  ], env));
  assert.equal(rejected.code, 'AGENT_WORKSPACE_SCHEMA_UNSUPPORTED');
  assert.equal(rejected.recapture_required, true);
  assert.equal(
    await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-v0-capture.json')),
    null,
  );

  const malformedPath = await writeJSON(fixtureRoot, 'capture-malformed-v1.json', {
    schema_version: 'aos.agent-workspace.v1',
    refs: [],
  });
  const malformed = parseError(run([
    'create', '--id', 'ann-malformed-v1', '--from-capture-json', malformedPath, '--json',
  ], env));
  assert.equal(malformed.code, 'TARGET_HANDLE_INVALID');
  assert.equal(
    await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-malformed-v1.json')),
    null,
  );

  const invalidRef = savedRefFixture();
  delete invalidRef.handle;
  const malformedRefPath = await writeJSON(fixtureRoot, 'capture-malformed-ref.json', savedCaptureFixture({
    refs: [invalidRef],
  }));
  const malformedRef = parseError(run([
    'create', '--id', 'ann-malformed-ref', '--from-capture-json', malformedRefPath, '--json',
  ], env));
  assert.equal(malformedRef.code, 'TARGET_HANDLE_INVALID');
  assert.equal(
    await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-malformed-ref.json')),
    null,
  );
});

test('pending annotation capture projection reports fallback and fail-closed states honestly', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capture-state-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-state-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const fallbackPath = await writeJSON(fixtureRoot, 'fallback.json', savedCaptureFixture({ snapshot: 'snap-fallback', refs: [] }));
  const fallback = parseJSON(run([
    'create',
    '--id',
    'ann-capture-fallback',
    '--from-capture-json',
    fallbackPath,
    '--json',
  ], env));
  const fallbackRead = parseJSON(run(['read', 'ann-capture-fallback', '--json'], env));
  assert.equal(fallback.annotation.state, 'pending');
  assert.equal(fallback.annotation.capability_status, 'fallback_only');
  assert.equal(fallbackRead.annotation.target.saved_ref, null);
  assert.equal(fallbackRead.annotation.fallback_evidence[0].reason, 'saved_ref_unavailable');
  validateJSONFile(fallback.annotation.path);

  const stalePath = await writeJSON(fixtureRoot, 'stale.json', savedCaptureFixture({
    snapshot: 'snap-stale',
    status: 'stale',
    refs: [savedRefFixture({ snapshot: 'snap-stale' })],
  }));
  const stale = parseJSON(run(['create', '--id', 'ann-stale', '--from-capture-json', stalePath, '--json'], env));
  assert.equal(stale.annotation.state, 'stale');
  assert.equal(stale.annotation.capability_status, 'blocked');
  const staleRead = parseJSON(run(['read', 'ann-stale', '--json'], env));
  const staleConsume = run(['consume', 'ann-stale', '--json'], env);
  assert.notEqual(staleConsume.status, 0);
  assert.equal(JSON.parse(staleConsume.stderr).state, 'stale');
  validateJSONFile(stale.annotation.path);

  const unsupportedPath = await writeJSON(fixtureRoot, 'unsupported.json', savedCaptureFixture({
    snapshot: 'snap-unsupported',
    refs: [savedRefFixture({ snapshot: 'snap-unsupported', backend: 'unknown' })],
  }));
  const unsupported = parseError(run(['create', '--id', 'ann-unsupported', '--from-capture-json', unsupportedPath, '--json'], env));
  assert.equal(unsupported.code, 'TARGET_HANDLE_INVALID');
  assert.equal(
    await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-unsupported.json')),
    null,
  );

  const ambiguousPath = await writeJSON(fixtureRoot, 'ambiguous.json', savedCaptureFixture({
    snapshot: 'snap-ambiguous',
    refs: [
      savedRefFixture({ ref: 'r1', snapshot: 'snap-ambiguous', summary: 'First target' }),
      savedRefFixture({ ref: 'r2', snapshot: 'snap-ambiguous', summary: 'Second target' }),
    ],
  }));
  const ambiguous = parseJSON(run(['create', '--id', 'ann-ambiguous', '--from-capture-json', ambiguousPath, '--json'], env));
  assert.equal(ambiguous.annotation.state, 'blocked');
  assert.equal(ambiguous.annotation.capability_status, 'ambiguous');
  const ambiguousRead = parseJSON(run(['read', 'ann-ambiguous', '--json'], env));
  const ambiguousConsume = run(['consume', 'ann-ambiguous', '--json'], env);
  assert.notEqual(ambiguousConsume.status, 0);
  assert.equal(JSON.parse(ambiguousConsume.stderr).capability_status, 'ambiguous');
  validateJSONFile(ambiguous.annotation.path);

  for (const annotation of [
    fallbackRead.annotation,
    staleRead.annotation,
    ambiguousRead.annotation,
  ]) {
    assert.equal(annotation.fallback_evidence.length, 1);
    assert.deepEqual(annotation.fallback_evidence[0].artifact_refs, annotation.artifact_refs);
    assert(annotation.recommended_next.length >= 1);
    assert.equal(annotation.source_capture.kind, 'saved_capture');
    assert.equal(typeof annotation.source_capture.snapshot_id, 'string');
  }
});

test('pending annotation create rejects terminal lifecycle state imports', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-terminal-state-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-terminal-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  for (const state of ['consumed', 'resolved', 'deleted']) {
    const inputPath = await writeJSON(fixtureRoot, `${state}.json`, {
      id: `ann-terminal-${state}`,
      state,
      target_kind: 'region',
      target_summary: `${state} import target`,
    });
    const result = run(['create', '--from-json', inputPath, '--json'], env);
    assert.notEqual(result.status, 0);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, 'INVALID_ARG');
    assert.equal(error.state, state);
    assert.equal(error.status, 'terminal_state_requires_transition');
    assert.equal(
      await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', `ann-terminal-${state}.json`)),
      null,
    );
  }
});

test('pending annotation fallback record stays explicit when no saved ref exists', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-fallback-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-fallback',
    '--target-kind',
    'region',
    '--target-summary',
    'Top-right fallback region',
    '--fallback-reason',
    'saved_ref_unavailable',
    '--json',
  ], env));

  const read = parseJSON(run(['read', 'ann-fallback', '--json'], env));
  assert.equal(created.annotation.capability_status, 'fallback_only');
  assert.equal(read.annotation.target.saved_ref, null);
  assert.equal(read.annotation.fallback_evidence[0].reason, 'saved_ref_unavailable');
  assert.deepEqual(read.annotation.recommended_next[0].argv, [
    'aos',
    'see',
    'capture',
    'main',
    '--save',
    '--workspace',
    'default',
    '--mode',
    'som',
  ]);
  validateJSONFile(created.annotation.path);
});
