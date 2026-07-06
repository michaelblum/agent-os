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

test('pending annotation store rejects symlinked records directory before read or write', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-symlink-state-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-symlink-outside-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const pendingRoot = path.join(stateRoot, 'repo', 'pending-annotations');
  const recordsDir = path.join(pendingRoot, 'records');
  await fs.mkdir(pendingRoot, { recursive: true });
  await fs.symlink(outsideRoot, recordsDir);

  const create = run([
    'create',
    '--id',
    'ann-symlink-write',
    '--target-kind',
    'region',
    '--target-summary',
    'Symlink write target',
    '--json',
  ], env);
  assert.notEqual(create.status, 0);
  assert.equal(JSON.parse(create.stderr).code, 'PENDING_ANNOTATION_STATE_CORRUPT');

  const outsideNames = await fs.readdir(outsideRoot);
  assert.deepEqual(outsideNames.filter((name) => /^ann-.*\.json$/.test(name)), []);

  await fs.writeFile(path.join(outsideRoot, 'ann-symlink-read.json'), JSON.stringify({
    schema_version: 'aos.pending-annotation.v0',
    id: 'ann-symlink-read',
  }), 'utf8');
  assert.equal(parseError(run(['read', 'ann-symlink-read', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(parseError(run(['list', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation create preflights existing records before writing new durable state', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-create-preflight-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const existing = parseJSON(run([
    'create',
    '--id',
    'ann-existing-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Existing corrupt target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(existing.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  const corruptText = `${JSON.stringify(record, null, 2)}\n`;
  await fs.writeFile(existing.annotation.path, corruptText, 'utf8');

  const created = run([
    'create',
    '--id',
    'ann-new-after-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Should not be written',
    '--json',
  ], env);
  assert.notEqual(created.status, 0);
  assert.equal(JSON.parse(created.stderr).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-new-after-corrupt.json')), null);
  assert.equal(await fs.readFile(existing.annotation.path, 'utf8'), corruptText);
});

test('pending annotation mutations preflight existing records before changing target record', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-mutation-preflight-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const target = parseJSON(run([
    'create',
    '--id',
    'ann-target-healthy',
    '--target-kind',
    'browser',
    '--target-summary',
    'Healthy target',
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--ref',
    'r1',
    '--json',
  ], env));
  const corrupt = parseJSON(run([
    'create',
    '--id',
    'ann-other-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Other corrupt target',
    '--json',
  ], env));
  const corruptRecord = JSON.parse(await fs.readFile(corrupt.annotation.path, 'utf8'));
  corruptRecord.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-name.json');
  await fs.writeFile(corrupt.annotation.path, `${JSON.stringify(corruptRecord, null, 2)}\n`, 'utf8');

  const beforeConsume = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run(['consume', 'ann-target-healthy', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeConsume);

  const beforeLink = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run([
    'link-work-record',
    'ann-target-healthy',
    '--work-record',
    'work-record:should-not-link',
    '--json',
  ], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeLink);

  const beforeDelete = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run(['delete', 'ann-target-healthy', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeDelete);
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
