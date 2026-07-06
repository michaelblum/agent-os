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

test('agent workspace owns annotation capability projection for saved refs', () => {
  assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
    backend: 'browser',
    resolutionClass: 'snapshot_scoped',
  })), {
    status: 'saved_ref',
    target_kind: 'browser',
    reasons: [],
    saved_ref_available: true,
  });
  assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
    backend: 'aos_canvas',
    resolutionClass: 'reacquirable',
  })), {
    status: 'saved_ref',
    target_kind: 'canvas',
    reasons: [],
    saved_ref_available: true,
  });
  assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
    backend: 'native_ax',
    resolutionClass: 'stable',
  })), {
    status: 'saved_ref',
    target_kind: 'native_ax',
    reasons: [],
    saved_ref_available: true,
  });
  assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
    backend: 'browser',
    resolutionClass: 'volatile',
  })), {
    status: 'fallback_only',
    target_kind: 'browser',
    reasons: ['saved_ref_not_actionable:volatile'],
    saved_ref_available: false,
  });
  assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
    backend: 'unknown',
    resolutionClass: 'stable',
  })), {
    status: 'unsupported',
    target_kind: null,
    reasons: ['unsupported_saved_ref:unknown:stable'],
    saved_ref_available: false,
  });
});

test('pending annotation adapter owns conversion from operator selection evidence', () => {
  assert.deepEqual(pendingAnnotationInputFromOperatorSelection({
    origin: 'operator_annotation_surface',
    comment: 'Use this',
    target: {
      kind: 'browser',
      summary: 'Save button',
      savedRef: {
        workspace_id: 'default',
        snapshot_id: 'snap1',
        ref: 'r1',
      },
    },
    readiness: { status: 'saved_ref', reasons: [] },
    evidence: {
      fallback: [],
      artifacts: [{ role: 'capture_summary', path: '/tmp/capture.json' }],
      next: [{ kind: 'inspect_saved_refs', argv: ['aos', 'see', 'refs'] }],
      sourceCapture: { kind: 'saved_capture', selected_ref: 'r1' },
    },
  }), {
    source: 'operator_annotation_surface',
    comment: 'Use this',
    target_kind: 'browser',
    target_summary: 'Save button',
    saved_ref: {
      workspace_id: 'default',
      snapshot_id: 'snap1',
      ref: 'r1',
    },
    capability: { status: 'saved_ref', reasons: [] },
    fallback_evidence: [],
    artifact_refs: [{ role: 'capture_summary', path: '/tmp/capture.json' }],
    recommended_next: [{ kind: 'inspect_saved_refs', argv: ['aos', 'see', 'refs'] }],
    source_capture: { kind: 'saved_capture', selected_ref: 'r1' },
  });
});

test('pending annotation projection does not own saved-ref actionability policy constants', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/lib/pending-annotations-projection.mjs'), 'utf8');
  assert(!source.includes('SAVED_REF_BACKEND_TARGETS'));
  assert(!source.includes('ACTIONABLE_REF_CLASSES'));
  assert(!source.includes("aos.agent-workspace.v0';"));
});

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

test('pending annotation create rejects saved-ref capability without saved ref', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capability-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capability-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const savedRefStatusPath = await writeJSON(fixtureRoot, 'saved-ref-status.json', {
    id: 'ann-claimed-saved-ref',
    target_kind: 'region',
    target_summary: 'Claimed saved ref target',
    capability: { status: 'saved_ref' },
  });
  const savedRefStatus = parseError(run(['create', '--from-json', savedRefStatusPath, '--json'], env));
  assert.equal(savedRefStatus.code, 'INVALID_ARG');

  const savedRefAvailablePath = await writeJSON(fixtureRoot, 'saved-ref-available.json', {
    id: 'ann-claimed-available',
    target_kind: 'region',
    target_summary: 'Claimed availability target',
    capability: { saved_ref_available: true },
  });
  const savedRefAvailable = parseError(run(['create', '--from-json', savedRefAvailablePath, '--json'], env));
  assert.equal(savedRefAvailable.code, 'INVALID_ARG');

  await validateAllPendingRecordFiles(env);
});

test('pending annotation consume fails closed on corrupt saved-ref capability', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-corrupt-capability-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-corrupt-capability',
    '--target-kind',
    'region',
    '--target-summary',
    'Corrupt capability target',
    '--json',
  ], env));
  validateJSONFile(created.annotation.path);
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.capability.status = 'saved_ref';
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['consume', 'ann-corrupt-capability', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation source_capture is normalized to the public saved-capture shape', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-source-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-source-capture-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const invalidPath = await writeJSON(fixtureRoot, 'invalid-source-capture.json', {
    id: 'ann-invalid-source-capture',
    target_kind: 'region',
    target_summary: 'Invalid source capture target',
    source_capture: { kind: 'region' },
  });
  const invalid = parseError(run(['create', '--from-json', invalidPath, '--json'], env));
  assert.equal(invalid.code, 'INVALID_ARG');

  const acceptedPath = await writeJSON(fixtureRoot, 'accepted-source-capture.json', {
    id: 'ann-source-capture',
    target_kind: 'region',
    target_summary: 'Accepted source capture target',
    source_capture: {
      ...sourceCaptureRecordFixture(),
      ignored_private_field: 'drop me',
    },
  });
  const created = parseJSON(run(['create', '--from-json', acceptedPath, '--json'], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  assert.deepEqual(record.source_capture, sourceCaptureRecordFixture());
  validateJSONFile(created.annotation.path);
  await validateAllPendingRecordFiles(env);
});

test('pending annotation selected target does not manufacture fallback evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-no-fake-fallback-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-selected-target',
    '--target-kind',
    'region',
    '--target-summary',
    'Explicit selected target',
    '--json',
  ], env));
  const read = parseJSON(run(['read', 'ann-selected-target', '--json'], env));
  assert.equal(created.annotation.fallback_count, 0);
  assert.deepEqual(read.annotation.fallback_evidence, []);
  assert.equal(read.annotation.capability.fallback_used, false);
  validateJSONFile(created.annotation.path);
});

test('pending annotation corrupt record read fails closed', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-corrupt-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Corrupt me',
    '--json',
  ], env));
  await fs.writeFile(created.annotation.path, '{not json', 'utf8');
  const result = run(['read', 'ann-corrupt', '--json'], env);
  const err = parseError(result);
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record id must match its filename', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-id-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-id',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong id target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.id = 'ann-other-id';
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-id.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['read', 'ann-wrong-id', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record root must match the canonical runtime root', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-root-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-root',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong root target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record path must equal the canonical record path', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-record-path-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-path',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong path target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-path.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['read', 'ann-wrong-path', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record path escapes fail closed', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-path-escape-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-path-escape',
    '--target-kind',
    'region',
    '--target-summary',
    'Path escape target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', '..', 'outside.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation concurrent consume succeeds exactly once', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-concurrent-consume-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '10000',
  };
  parseJSON(run([
    'create',
    '--id',
    'ann-race',
    '--target-kind',
    'browser',
    '--target-summary',
    'Race target',
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--ref',
    'r1',
    '--json',
  ], env));

  const attempts = await Promise.all(Array.from({ length: 16 }, (_, index) => runAsync([
    'consume',
    'ann-race',
    '--actor',
    `consumer-${index}`,
    '--json',
  ], env)));
  const successes = attempts.filter((result) => result.status === 0).map((result) => JSON.parse(result.stdout));
  const failures = attempts.filter((result) => result.status !== 0).map((result) => JSON.parse(result.stderr));
  assert.equal(successes.length, 1, attempts);
  assert.equal(successes[0].status, 'consumed');
  assert.equal(failures.length, 15);
  assert(failures.every((failure) => failure.code === 'PENDING_ANNOTATION_NOT_CONSUMABLE'), failures);
  assert(failures.every((failure) => failure.state === 'consumed'), failures);

  const listed = parseJSON(run(['list', '--state', 'consumed', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-race');
});

test('pending annotation lock with live owner PID fails closed instead of reaping by age', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-live-lock-'));
  const lockDir = path.join(stateRoot, 'repo', 'pending-annotations', '.mutation.lock');
  await fs.mkdir(lockDir, { recursive: true });
  await writeJSON(lockDir, 'owner.json', {
    pid: process.pid,
    acquired_at: '2026-07-05T12:00:00Z',
  });
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockDir, old, old);
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '0',
    AOS_PENDING_ANNOTATION_STALE_LOCK_MS: '0',
  };

  const result = run([
    'create',
    '--id',
    'ann-live-lock',
    '--target-kind',
    'region',
    '--target-summary',
    'Live lock target',
    '--json',
  ], env);
  assert.notEqual(result.status, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.code, 'PENDING_ANNOTATION_LOCKED');
  assert.equal((await fs.stat(lockDir)).isDirectory(), true);
});

test('pending annotation stale ownerless lock is reaped before mutation', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-stale-lock-'));
  const lockDir = path.join(stateRoot, 'repo', 'pending-annotations', '.mutation.lock');
  await fs.mkdir(lockDir, { recursive: true });
  await writeJSON(lockDir, 'owner.json', {
    pid: 'not-a-pid',
    acquired_at: '2026-07-05T12:00:00Z',
  });
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockDir, old, old);
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '1000',
    AOS_PENDING_ANNOTATION_STALE_LOCK_MS: '0',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-stale-lock',
    '--target-kind',
    'region',
    '--target-summary',
    'Stale lock target',
    '--json',
  ], env));
  assert.equal(created.annotation.id, 'ann-stale-lock');
  await assert.rejects(fs.stat(lockDir), /ENOENT/);
});

test('pending annotation list stays read-only while mutations repair stale index', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-recovery-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '10000',
  };
  const created = await Promise.all(Array.from({ length: 8 }, (_, index) => runAsync([
    'create',
    '--id',
    `ann-index-${index}`,
    '--target-kind',
    'region',
    '--target-summary',
    `Serialized target ${index}`,
    '--json',
  ], env)));
  assert(created.every((result) => result.status === 0), created);

  const linked = await Promise.all(Array.from({ length: 8 }, (_, index) => runAsync([
    'link-work-record',
    `ann-index-${index}`,
    '--work-record',
    `work-record:index-${index}`,
    '--json',
  ], env)));
  assert(linked.every((result) => result.status === 0), linked);

  const deleted = await Promise.all(Array.from({ length: 4 }, (_, index) => runAsync([
    'delete',
    `ann-index-${index}`,
    '--json',
  ], env)));
  assert(deleted.every((result) => result.status === 0), deleted);

  const all = parseJSON(run(['list', '--json'], env));
  assert.equal(all.count, 8);
  assert.equal(all.annotations.filter((item) => item.state === 'deleted').length, 4);
  assert.equal(all.annotations.filter((item) => item.work_record_link_count === 1).length, 8);

  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  const staleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  staleIndex.annotations[0].state = 'pending';
  staleIndex.annotations[0].work_record_link_count = 0;
  await fs.writeFile(indexPath, `${JSON.stringify(staleIndex, null, 2)}\n`, 'utf8');
  const staleText = await fs.readFile(indexPath, 'utf8');
  const staleStat = await fs.stat(indexPath);
  const listedStale = parseJSON(run(['list', '--json'], env));
  assert.equal(listedStale.annotations.filter((item) => item.state === 'deleted').length, 4);
  assert.equal(listedStale.annotations.filter((item) => item.work_record_link_count === 1).length, 8);
  assert.equal(await fs.readFile(indexPath, 'utf8'), staleText);
  assert.equal((await fs.stat(indexPath)).mtimeMs, staleStat.mtimeMs);

  const consumedRepair = parseJSON(run(['consume', 'ann-index-4', '--actor', 'test-agent', '--json'], env));
  assert.equal(consumedRepair.annotation.state, 'consumed');
  const repairedStaleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-0').state, 'deleted');
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-0').work_record_link_count, 1);
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-4').state, 'consumed');

  await fs.writeFile(indexPath, '{partial', 'utf8');
  const corruptText = await fs.readFile(indexPath, 'utf8');
  const corruptStat = await fs.stat(indexPath);
  const listedCorrupt = parseJSON(run(['list', '--state', 'deleted', '--json'], env));
  assert.equal(listedCorrupt.count, 4);
  assert.equal(await fs.readFile(indexPath, 'utf8'), corruptText);
  assert.equal((await fs.stat(indexPath)).mtimeMs, corruptStat.mtimeMs);

  const linkedRepair = parseJSON(run([
    'link-work-record',
    'ann-index-5',
    '--work-record',
    'work-record:index-repair-after-corrupt',
    '--json',
  ], env));
  assert.equal(linkedRepair.status, 'linked');
  const recoveredIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(recoveredIndex.annotations.length, 8);
  assert.equal(recoveredIndex.annotations.find((item) => item.id === 'ann-index-5').work_record_link_count, 2);
});

test('pending annotation list computes records without creating a missing index', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-missing-index-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-missing-index',
    '--target-kind',
    'region',
    '--target-summary',
    'Missing index target',
    '--json',
  ], env));
  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  await fs.unlink(indexPath);
  assert.equal(await readTextIfExists(indexPath), null);

  const listed = parseJSON(run(['list', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-missing-index');
  assert.equal(await readTextIfExists(indexPath), null);
  validateJSONFile(created.annotation.path);
});

test('pending annotation corrupt index rebuild fails closed on invalid records', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-invalid-record-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-index-invalid',
    '--target-kind',
    'region',
    '--target-summary',
    'Invalid record during rebuild',
    '--json',
  ], env));
  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.writeFile(indexPath, '{partial', 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});
