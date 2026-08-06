import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '../..');
export const schemaPath = path.join(repoRoot, 'shared/schemas/aos-pending-annotation-v0.schema.json');
export const cliPath = path.join(repoRoot, 'scripts/aos-pending-annotation.mjs');

export function run(args, env) {
  return spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

export function runAsync(args, env) {
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

export function parseJSON(result) {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

export function parseError(result) {
  assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stderr);
}

export function validateJSONFile(instancePath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
target_schema = json.loads(Path(sys.argv[3]).read_text())
Draft202012Validator.check_schema(schema)
registry = Registry().with_resource(target_schema["$id"], Resource.from_contents(target_schema))
validator = Draft202012Validator(schema, registry=registry)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
      path.join(repoRoot, 'shared/schemas/aos-target-handle-v1.schema.json'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

export function rejectJSONFile(instancePath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
target_schema = json.loads(Path(sys.argv[3]).read_text())
registry = Registry().with_resource(target_schema["$id"], Resource.from_contents(target_schema))
validator = Draft202012Validator(schema, registry=registry)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
sys.exit(0 if errors else 1)
`,
      schemaPath,
      instancePath,
      path.join(repoRoot, 'shared/schemas/aos-target-handle-v1.schema.json'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

export async function validateAllPendingRecordFiles(env) {
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

export async function writeJSON(dir, name, value) {
  const file = path.join(dir, name);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

export async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function pendingAnnotationTempEnv(prefix = 'aos-pending-annotation-') {
  return {
    AOS_STATE_ROOT: await fs.mkdtemp(path.join(os.tmpdir(), prefix)),
    AOS_RUNTIME_MODE: 'repo',
  };
}

export function savedCaptureFixture({ snapshot = 'snap1', refs = [], status = 'success' } = {}) {
  return {
    schema_version: 'aos.agent-workspace.v1',
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

export function savedRefFixture({ ref = 'r1', snapshot = 'snap1', backend = 'browser', summary = 'Selected target', supportedActions = null } = {}) {
  const handle = backend === 'browser'
    ? { kind: 'observation_ref', backend: 'browser', state_id: 'see_1', scope: { session: 'fixture' }, ref: 'e1' }
    : backend === 'aos_canvas'
      ? { kind: 'locator', backend: 'aos_canvas', query: { canvas_id: 'fixture', ref: 'save' } }
      : backend === 'native_ax'
        ? { kind: 'locator', backend: 'native_ax', query: { pid: 42, role: 'AXButton', identifier: 'save' } }
        : null;
  return {
    ref,
    ref_scope: 'snapshot',
    workspace_id: 'ws1',
    snapshot_id: snapshot,
    capture_target: 'browser:fixture',
    capture_mode: 'som',
    backend,
    handle,
    confidence: 'high',
    supported_actions: supportedActions ?? (backend === 'aos_canvas' ? ['click'] : backend === 'native_ax' ? ['press'] : []),
    target_summary: summary,
    hint_facts: {},
    copyable_action_target: `ref:${snapshot}:${ref}`,
    artifact_refs: [{ role: 'ref_summary', path: `/tmp/${snapshot}-${ref}.json` }],
    warnings: [],
    known_limits: backend === 'browser' ? ['browser_observation_identity_unproven'] : [],
  };
}

export function sourceCaptureRecordFixture({ selectedRef = 'r1', refCount = 1 } = {}) {
  return {
    kind: 'saved_capture',
    schema_version: 'aos.agent-workspace.v1',
    status: 'success',
    workspace_id: 'ws1',
    snapshot_id: 'snap1',
    selected_ref: selectedRef,
    capture_target: 'browser:fixture',
    capture_mode: 'som',
    query: 'operator selection',
    ref_count: refCount,
    selected_backend: 'browser',
    selected_handle_kind: 'observation_ref',
  };
}
