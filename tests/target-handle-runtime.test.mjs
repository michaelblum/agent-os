import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  TargetHandleError,
  browserObservationHandle,
  canvasLocatorHandle,
  nativeAXLocatorHandle,
  readBrowserCaptureGeneration,
  recordBrowserCaptureGeneration,
  validateBrowserObservationRef,
  validateDirectBrowserRef,
} from '../scripts/lib/target-handle-runtime.mjs';

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-target-handle-'));
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

function code(fn, expected) {
  assert.throws(fn, (error) => error instanceof TargetHandleError && error.code === expected);
}

const backendIdentity = {
  schema_version: 'aos.browser-backend-identity.v2',
  adapter: '@playwright/cli',
  version: '0.1.15',
  descriptor_sha256: 'a'.repeat(64),
  closure_sha256: 'b'.repeat(64),
  entrypoint: 'node_modules/@playwright/cli/playwright-cli.js',
  session_generation: 'c'.repeat(32),
};

test('one browser generation validates only its original state/ref pairs', () => {
  const { root, env } = isolated();
  try {
    recordBrowserCaptureGeneration('todo', {
      state_id: 'see_state_1',
      elements: [{ ref: 'e1' }, { ref: 'f2e9' }],
    }, env, backendIdentity);
    assert.deepEqual(validateDirectBrowserRef('todo', 'e1', 'see_state_1', env, backendIdentity), {
      session: 'todo', state_id: 'see_state_1', ref: 'e1',
    });
    code(() => validateDirectBrowserRef('todo', 'e7', 'see_state_1', env, backendIdentity), 'TARGET_HANDLE_INVALID');
    code(() => validateDirectBrowserRef('todo', 'e1', null, env), 'TARGET_STATE_REQUIRED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a newer capture atomically supersedes the prior generation even when a ref text repeats', () => {
  const { root, env } = isolated();
  try {
    const oldHandle = browserObservationHandle('todo', 'see_old', 'e1');
    recordBrowserCaptureGeneration('todo', { state_id: 'see_old', elements: [{ ref: 'e1' }] }, env, backendIdentity);
    recordBrowserCaptureGeneration('todo', { state_id: 'see_new', elements: [{ ref: 'e1' }] }, env, backendIdentity);
    code(() => validateBrowserObservationRef(oldHandle, env, backendIdentity), 'TARGET_STATE_STALE');
    assert.equal(readBrowserCaptureGeneration('todo', env).state_id, 'see_new');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a repeated state id fails closed without replacing the current generation', () => {
  const { root, env } = isolated();
  try {
    recordBrowserCaptureGeneration('todo', { state_id: 'see_same', elements: [{ ref: 'e1' }] }, env, backendIdentity);
    code(() => recordBrowserCaptureGeneration('todo', {
      state_id: 'see_same', elements: [{ ref: 'e2' }],
    }, env, backendIdentity), 'TARGET_HANDLE_INVALID');
    assert.deepEqual(readBrowserCaptureGeneration('todo', env).refs, ['e1']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a generation rejects duplicate or selector-shaped refs instead of permitting aliasing', () => {
  const { root, env } = isolated();
  try {
    code(() => recordBrowserCaptureGeneration('todo', {
      state_id: 'see_dup', elements: [{ ref: 'e1' }, { ref: 'e1' }],
    }, env, backendIdentity), 'TARGET_HANDLE_INVALID');
    code(() => recordBrowserCaptureGeneration('todo', {
      state_id: 'see_selector', elements: [{ ref: 'button' }],
    }, env, backendIdentity), 'TARGET_HANDLE_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a browser generation is stale when its independently verified backend identity changes', () => {
  const { root, env } = isolated();
  try {
    const handle = browserObservationHandle('todo', 'see_backend', 'e1');
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_backend', elements: [{ ref: 'e1' }] }, env, backendIdentity,
    );
    const replaced = { ...backendIdentity, session_generation: 'd'.repeat(32) };
    code(() => validateBrowserObservationRef(handle, env, replaced), 'TARGET_STATE_STALE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-free backend identity admits bounded immutable old-version provenance', () => {
  const { root, env } = isolated();
  try {
    const prior = { ...backendIdentity, version: '0.1.14-alpha.1', entrypoint: 'node_modules/@playwright/cli/legacy.js' };
    recordBrowserCaptureGeneration('prior', { state_id: 'see_prior', elements: [{ ref: 'e1' }] }, env, prior);
    assert.equal(readBrowserCaptureGeneration('prior', env).backend_identity.version, prior.version);
    code(() => recordBrowserCaptureGeneration('bad', {
      state_id: 'see_bad', elements: [{ ref: 'e1' }],
    }, env, { ...backendIdentity, version: 'latest' }), 'TARGET_ACTION_UNSUPPORTED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Locator constructors emit machine queries without state', () => {
  assert.deepEqual(canvasLocatorHandle('settings', 'save'), {
    kind: 'locator', backend: 'aos_canvas', query: { canvas_id: 'settings', ref: 'save' },
  });
  assert.deepEqual(nativeAXLocatorHandle({ pid: 42, role: 'AXButton', identifier: 'save' }), {
    kind: 'locator', backend: 'native_ax', query: { pid: 42, role: 'AXButton', identifier: 'save' },
  });
  assert.equal(nativeAXLocatorHandle({
    pid: 42, role: 'AXButton', depth: 128, timeout_ms: 30_000,
  }).query.timeout_ms, 30_000);
  code(() => nativeAXLocatorHandle({ pid: 42, role: 'AXButton', index: 0, near: '1,2' }), 'TARGET_HANDLE_INVALID');
  code(() => nativeAXLocatorHandle({ pid: 42, index: 0 }), 'TARGET_HANDLE_INVALID');
  code(() => nativeAXLocatorHandle({ pid: 42, role: 'AXButton', index: 1024 }), 'TARGET_HANDLE_INVALID');
  code(() => nativeAXLocatorHandle({ pid: 42, role: 'AXButton', selector: '#save' }), 'TARGET_HANDLE_INVALID');
  code(() => nativeAXLocatorHandle({ pid: 42, role: 'AXButton', depth: 129 }), 'TARGET_HANDLE_INVALID');
  code(() => nativeAXLocatorHandle({ pid: 42, role: 'AXButton', timeout_ms: 30_001 }), 'TARGET_HANDLE_INVALID');
});

test('the public handle schema has exactly the three V1 variants', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../shared/schemas/aos-target-handle-v1.schema.json', import.meta.url)));
  assert.deepEqual(schema.oneOf.map((entry) => entry.$ref), [
    '#/$defs/browser_observation_ref',
    '#/$defs/canvas_locator',
    '#/$defs/native_ax_locator',
  ]);
  assert.equal(schema.$defs.browser_observation_ref.properties.ref.pattern, '^(f[0-9]+)?e[0-9]+$');
  assert.equal(schema.$defs.canvas_locator.properties.query.properties.state_id, undefined);
  assert.equal(schema.$defs.native_ax_locator.properties.query.properties.state_id, undefined);
  assert.equal(schema.$defs.native_ax_locator.properties.query.properties.index.maximum, 1023);
  assert.equal(schema.$defs.native_ax_locator.properties.query.properties.depth.maximum, 128);
  assert.equal(schema.$defs.native_ax_locator.properties.query.properties.timeout_ms.maximum, 30000);
});

test('public schemas accept each V1 handle and reject backend mismatch or legacy fields', () => {
  const script = String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

handle_schema = json.loads(Path(sys.argv[1]).read_text())
workspace_schema = json.loads(Path(sys.argv[2]).read_text())
registry = Registry().with_resource(handle_schema["$id"], Resource.from_contents(handle_schema))
handle_validator = Draft202012Validator(handle_schema, registry=registry)
workspace_validator = Draft202012Validator(workspace_schema, registry=registry)

handles = [
  {"kind":"observation_ref","backend":"browser","state_id":"see_1","scope":{"session":"todo"},"ref":"e2"},
  {"kind":"locator","backend":"aos_canvas","query":{"canvas_id":"settings","ref":"save"}},
  {"kind":"locator","backend":"native_ax","query":{"pid":42,"role":"AXButton","identifier":"save"}},
]
assert all(handle_validator.is_valid(value) for value in handles)
assert not handle_validator.is_valid({**handles[1], "state_id":"see_1"})
assert not handle_validator.is_valid({"kind":"locator","backend":"native_ax","query":{"pid":42,"role":"AXButton","index":0,"near":"1,2"}})
assert not handle_validator.is_valid({"kind":"locator","backend":"native_ax","query":{"pid":42,"role":"AXButton","index":1024}})
assert not handle_validator.is_valid({"kind":"locator","backend":"native_ax","query":{"pid":42,"index":0}})
assert not handle_validator.is_valid({"kind":"locator","backend":"native_ax","query":{"pid":42,"role":"AXButton","depth":129}})
assert not handle_validator.is_valid({"kind":"locator","backend":"native_ax","query":{"pid":42,"role":"AXButton","timeout_ms":30001}})

record = {
  "ref":"r1", "ref_scope":"snapshot",
  "workspace_id":"default", "snapshot_id":"snap1", "capture_target":"browser:todo",
  "capture_mode":"ax", "copyable_action_target":"ref:snap1:r1", "backend":"browser",
  "handle":handles[0], "confidence":"medium", "supported_actions":[],
  "target_summary":"Save", "hint_facts":{}, "artifact_refs":[], "warnings":[], "known_limits":["browser_ref_actions_unsupported"]
}
envelope = {"status":"success", "schema_version":"aos.agent-workspace.v1", "workspace_id":"default", "snapshot_id":"snap1", "refs":[record]}
assert workspace_validator.is_valid(envelope)
actionable_browser = json.loads(json.dumps(envelope)); actionable_browser["refs"][0]["supported_actions"] = ["click"]
assert not workspace_validator.is_valid(actionable_browser)
bad_backend = json.loads(json.dumps(envelope)); bad_backend["refs"][0]["backend"] = "aos_canvas"
assert not workspace_validator.is_valid(bad_backend)
legacy = json.loads(json.dumps(envelope)); legacy["refs"][0]["resolution_class"] = "snapshot_scoped"
assert not workspace_validator.is_valid(legacy)
parallel = json.loads(json.dumps(envelope)); parallel["refs"][0]["selector"] = "#save"
assert not workspace_validator.is_valid(parallel)
`;
  const result = spawnSync('python3', [
    '-c', script,
    path.resolve('shared/schemas/aos-target-handle-v1.schema.json'),
    path.resolve('shared/schemas/aos-agent-workspace-v1.schema.json'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('external-command saved-capture fixture remains a schema-valid V1 summary', () => {
  const source = fs.readFileSync(new URL('./external-command-dispatch.sh', import.meta.url), 'utf8');
  const match = source.match(/cat >\/tmp\/aos-see-annotation-capture\.json <<'JSON'\n([\s\S]*?)\nJSON/);
  assert(match, 'external-command saved-capture fixture was not found');
  const fixture = JSON.parse(match[1]);
  const script = String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

handle_schema = json.loads(Path(sys.argv[1]).read_text())
workspace_schema = json.loads(Path(sys.argv[2]).read_text())
registry = Registry().with_resource(handle_schema["$id"], Resource.from_contents(handle_schema))
validator = Draft202012Validator(workspace_schema, registry=registry)
fixture = json.load(sys.stdin)
errors = list(validator.iter_errors(fixture))
assert not errors, "\n".join(error.message for error in errors)
`;
  const result = spawnSync('python3', [
    '-c', script,
    path.resolve('shared/schemas/aos-target-handle-v1.schema.json'),
    path.resolve('shared/schemas/aos-agent-workspace-v1.schema.json'),
  ], { encoding: 'utf8', input: JSON.stringify(fixture) });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
