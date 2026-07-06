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
  for (const [backend, resolutionClass, targetKind] of [
    ['browser', 'snapshot_scoped', 'browser'],
    ['aos_canvas', 'reacquirable', 'canvas'],
    ['native_ax', 'stable', 'native_ax'],
  ]) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend,
      resolutionClass,
    })), {
      status: 'saved_ref',
      target_kind: targetKind,
      reasons: [],
      saved_ref_available: true,
    });
  }

  for (const [backend, resolutionClass, targetKind] of [
    ['native_ax', 'snapshot_scoped', 'native_ax'],
    ['browser', 'stable', 'browser'],
    ['aos_canvas', 'stable', 'canvas'],
    ['browser', 'reacquirable', 'browser'],
    ['browser', 'volatile', 'browser'],
  ]) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend,
      resolutionClass,
    })), {
      status: 'fallback_only',
      target_kind: targetKind,
      reasons: [`saved_ref_not_actionable:${backend}:${resolutionClass}`],
      saved_ref_available: false,
    });
  }

  for (const resolutionClass of ['stable', 'snapshot_scoped', 'reacquirable']) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend: 'unknown',
      resolutionClass,
    })), {
      status: 'unsupported',
      target_kind: null,
      reasons: [`unsupported_saved_ref:unknown:${resolutionClass}`],
      saved_ref_available: false,
    });
  }
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
  // This protects an import-graph boundary: the saved-ref policy owner is the
  // agent workspace refs module, and projection intentionally only consumes it.
  const source = await fs.readFile(path.join(repoRoot, 'scripts/lib/pending-annotations-projection.mjs'), 'utf8');
  assert(!source.includes('SAVED_REF_BACKEND_TARGETS'));
  assert(!source.includes('ACTIONABLE_REF_CLASSES'));
  assert(!source.includes("aos.agent-workspace.v0';"));
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
