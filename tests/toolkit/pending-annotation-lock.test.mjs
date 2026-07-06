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
