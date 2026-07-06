import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  annotationCapabilityFromSavedRef,
} from '../../scripts/lib/agent-workspace/refs.mjs';
import {
  pendingAnnotationInputFromOperatorSelection,
} from '../../scripts/lib/pending-annotations-surface-adapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-pending-annotation-v0.schema.json');
const cliPath = path.join(repoRoot, 'scripts/aos-pending-annotation.mjs');

function run(args, env) {
  return spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function parseJSON(result) {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

function parseError(result) {
  assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stderr);
}

function validateJSONFile(instancePath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

async function validateAllPendingRecordFiles(env) {
  const recordsDir = path.join(env.AOS_STATE_ROOT, env.AOS_RUNTIME_MODE, 'pending-annotations', 'records');
  let names = [];
  try {
    names = await fs.readdir(recordsDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    validateJSONFile(path.join(recordsDir, name));
  }
}

async function writeJSON(dir, name, value) {
  const file = path.join(dir, name);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function savedCaptureFixture({ snapshot = 'snap1', refs = [], status = 'success' } = {}) {
  return {
    schema_version: 'aos.agent-workspace.v0',
    status,
    workspace_id: 'ws1',
    snapshot_id: snapshot,
    capture_target: 'browser:fixture',
    capture_mode: 'som',
    query: 'operator selection',
    artifact_refs: [{ role: 'capture_summary', path: `/tmp/${snapshot}-summary.json` }],
    refs,
  };
}

function savedRefFixture({ ref = 'r1', snapshot = 'snap1', backend = 'browser', resolutionClass = 'stable', summary = 'Selected target' } = {}) {
  return {
    ref,
    workspace_id: 'ws1',
    snapshot_id: snapshot,
    backend,
    resolution_class: resolutionClass,
    confidence: 'high',
    target_summary: summary,
    action_target: `ref:${snapshot}:${ref}`,
    artifact_refs: [{ role: 'ref_summary', path: `/tmp/${snapshot}-${ref}.json` }],
  };
}

function sourceCaptureRecordFixture({ selectedRef = 'r1', refCount = 1 } = {}) {
  return {
    kind: 'saved_capture',
    schema_version: 'aos.agent-workspace.v0',
    status: 'success',
    workspace_id: 'ws1',
    snapshot_id: 'snap1',
    selected_ref: selectedRef,
    capture_target: 'browser:fixture',
    capture_mode: 'som',
    query: 'operator selection',
    ref_count: refCount,
    selected_backend: 'browser',
    selected_resolution_class: 'stable',
  };
}

test('pending annotation CLI creates compact saved-ref record and consumes it once', async () => {
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
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--ref',
    'r2',
    '--artifact',
    'screenshot=/tmp/aos-pending-annotation-test.png',
    '--json',
  ], env));

  assert.equal(created.status, 'created');
  assert.equal(created.annotation.id, 'ann-test');
  assert.equal(created.annotation.state, 'pending');
  assert.equal(created.annotation.saved_ref.workspace_id, 'ws1');
  assert.equal(created.annotation.saved_ref.snapshot_id, 'snap1');
  assert.equal(created.annotation.saved_ref.ref, 'r2');
  assert.equal(created.annotation.recommended_next_count, 1);

  const recordPath = created.annotation.path;
  validateJSONFile(recordPath);
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.target.saved_ref.ref, 'r2');
  assert.deepEqual(record.recommended_next[0].argv, [
    'aos',
    'see',
    'refs',
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--json',
  ]);
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

test('pending annotation capture projection maps browser canvas and native saved refs', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const cases = [
    ['browser', 'browser', 'snapshot_scoped'],
    ['canvas', 'aos_canvas', 'reacquirable'],
    ['native', 'native_ax', 'stable'],
  ];

  for (const [name, backend, resolutionClass] of cases) {
    const snapshot = `snap-${name}`;
    const capturePath = await writeJSON(fixtureRoot, `${name}.json`, savedCaptureFixture({
      snapshot,
      refs: [savedRefFixture({
        ref: 'r1',
        snapshot,
        backend,
        resolutionClass,
        summary: `${name} selected target`,
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
    assert.equal(read.annotation.target.kind, name === 'canvas' ? 'canvas' : name === 'native' ? 'native_ax' : 'browser');
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

  const nonActionablePath = await writeJSON(fixtureRoot, 'non-actionable.json', savedCaptureFixture({
    snapshot: 'snap-non-actionable',
    refs: [savedRefFixture({ snapshot: 'snap-non-actionable', resolutionClass: 'volatile' })],
  }));
  const nonActionable = parseJSON(run(['create', '--id', 'ann-non-actionable', '--from-capture-json', nonActionablePath, '--json'], env));
  assert.equal(nonActionable.annotation.state, 'pending');
  assert.equal(nonActionable.annotation.capability_status, 'fallback_only');
  const nonActionableRead = parseJSON(run(['read', 'ann-non-actionable', '--json'], env));
  assert.equal(nonActionableRead.annotation.fallback_evidence[0].reason, 'saved_ref_not_actionable');
  validateJSONFile(nonActionable.annotation.path);

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
    refs: [savedRefFixture({ snapshot: 'snap-unsupported', resolutionClass: 'unsupported' })],
  }));
  const unsupported = parseJSON(run(['create', '--id', 'ann-unsupported', '--from-capture-json', unsupportedPath, '--json'], env));
  assert.equal(unsupported.annotation.state, 'unsupported');
  assert.equal(unsupported.annotation.capability_status, 'unsupported');
  const unsupportedRead = parseJSON(run(['read', 'ann-unsupported', '--json'], env));
  const unsupportedConsume = run(['consume', 'ann-unsupported', '--json'], env);
  assert.notEqual(unsupportedConsume.status, 0);
  assert.equal(JSON.parse(unsupportedConsume.stderr).capability_status, 'unsupported');
  validateJSONFile(unsupported.annotation.path);

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
    nonActionableRead.annotation,
    staleRead.annotation,
    unsupportedRead.annotation,
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
