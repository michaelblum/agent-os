import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { generateRefRecords } from '../scripts/lib/agent-workspace/refs.mjs';
import {
  readRefsRecord,
  readSnapshotRecord,
  readWorkspaceIndex,
  readWorkspaceMetadata,
} from '../scripts/lib/agent-workspace/store.mjs';
import {
  nativeAXLocatorHandle,
} from '../scripts/lib/target-handle-runtime.mjs';
import {
  defaultWorkspaceMetadata,
  isolatedWorkspaceRoot as root,
  repoRoot as repo,
  writeJSON,
  writeWorkspace,
} from './lib/agent-workspace-v1-fixture.mjs';

const displayTopologyFixture = JSON.parse(fs.readFileSync(path.join(
  repo,
  'shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json',
), 'utf8'));

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function workspaceSchemaAccepts(file) {
  const result = spawnSync('python3', [
    '-c',
    `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

schema = json.loads(Path(sys.argv[1]).read_text())
handle_schema = json.loads(Path(sys.argv[2]).read_text())
topology_schema = json.loads(Path(sys.argv[3]).read_text())
instance = json.loads(Path(sys.argv[4]).read_text())
registry = Registry()
for dependency in (handle_schema, topology_schema):
    registry = registry.with_resource(dependency["$id"], Resource.from_contents(dependency))
sys.exit(0 if Draft202012Validator(schema, registry=registry).is_valid(instance) else 1)
`,
    path.join(repo, 'shared/schemas/aos-agent-workspace-v1.schema.json'),
    path.join(repo, 'shared/schemas/aos-target-handle-v1.schema.json'),
    path.join(repo, 'shared/schemas/display-topology-v1.schema.json'),
    file,
  ], { cwd: repo, encoding: 'utf8' });
  return result.status === 0;
}

test('compact V1 summaries validate optional display topology exactly', () => {
  const state = root();
  try {
    const summary = {
      status: 'success',
      schema_version: 'aos.agent-workspace.v1',
      workspace_id: 'default',
      snapshot_id: 'snap1',
      refs: [],
      display_topology: structuredClone(displayTopologyFixture),
    };
    const validFile = path.join(state, 'summary-valid.json');
    writeJSON(validFile, summary);
    assert.equal(workspaceSchemaAccepts(validFile), true);

    const invalidFile = path.join(state, 'summary-invalid.json');
    const invalid = structuredClone(summary);
    invalid.display_topology.identity = 7;
    writeJSON(invalidFile, invalid);
    assert.equal(workspaceSchemaAccepts(invalidFile), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

function writeBrowserWorkspace(state, env) {
  return writeWorkspace(state, env, {
    target: 'browser:todo',
    capture: {
      state_id: 'see_1',
      elements: [{ ref: 'e2', role: 'button', label: 'Save', enabled: true }],
    },
  });
}

test('saved records are scoped storage addresses to exactly one V1 handle', () => {
  const context = {
    workspace_id: 'default', snapshot_id: 'snap1', target: 'browser:todo',
    capture_target: 'browser:todo', capture_mode: 'ax', artifact_refs: [],
  };
  const [browser] = generateRefRecords({
    state_id: 'see_1',
    elements: [{ ref: 'e2', role: 'button', label: 'Save', enabled: true }],
  }, context);
  assert.deepEqual(browser.handle, {
    kind: 'observation_ref', backend: 'browser', state_id: 'see_1',
    scope: { session: 'todo' }, ref: 'e2',
  });
  assert.deepEqual(browser.supported_actions, []);
  assert.ok(browser.known_limits.includes('browser_ref_actions_unsupported'));
  assert.equal(browser.copyable_action_target, 'ref:snap1:r1');
  for (const removed of ['resolution_class', 'short_action_target', 'action_target', 'current_address', 'identity_facts']) {
    assert.equal(Object.hasOwn(browser, removed), false, removed);
  }

  const [canvas] = generateRefRecords({
    semantic_targets: [{
      ref: 'save', role: 'button', name: 'Save', enabled: true, actions: ['click'],
      provenance: { canvas_id: 'settings' },
    }],
  }, { ...context, target: 'canvas:settings', capture_target: 'canvas:settings' });
  assert.deepEqual(canvas.handle, {
    kind: 'locator', backend: 'aos_canvas', query: { canvas_id: 'settings', ref: 'save' },
  });

  const [native] = generateRefRecords({
    elements: [{ app_pid: 42, role: 'AXButton', label: 'Save', identifier: 'save', enabled: true, bounds: { x: 1, y: 2, width: 3, height: 4 } }],
  }, { ...context, target: 'main', capture_target: 'main' });
  assert.equal(native.handle.kind, 'locator');
  assert.equal(native.handle.backend, 'native_ax');
  assert.equal(native.handle.query.pid, 42);
  assert.equal(Object.hasOwn(native.handle, 'state_id'), false);
});

test('public workspace schema and active readers agree on every persisted V1 record shape', () => {
  const state = root();
  try {
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo' };
    const workspace = 'default';
    const snapshotID = 'snap1';
    const createdAt = '2026-08-05T12:00:00Z';
    const workspaceDir = path.join(state, 'repo', 'agent-workspaces', workspace);
    const snapshotDir = path.join(workspaceDir, 'snapshots', snapshotID);
    const paths = {
      workspace: workspaceDir,
      snapshot: snapshotDir,
      snapshot_record: path.join(snapshotDir, 'snapshot.json'),
      capture: path.join(snapshotDir, 'capture.json'),
      summary: path.join(snapshotDir, 'summary.json'),
      refs: path.join(snapshotDir, 'refs.json'),
      artifacts: path.join(snapshotDir, 'artifacts'),
    };
    const [record] = generateRefRecords({
      elements: [{
        app_pid: 42, role: 'AXButton', identifier: 'save', enabled: true,
        action_names: ['AXPress'],
      }],
    }, {
      workspace_id: workspace, snapshot_id: snapshotID, target: 'main',
      capture_target: 'main', capture_mode: 'ax', artifact_refs: [],
    });
    const metadata = {
      ...defaultWorkspaceMetadata(workspace, env),
      created_at: createdAt,
      updated_at: createdAt,
    };
    const snapshot = {
      schema_version: 'aos.agent-workspace.v1', workspace_id: workspace,
      snapshot_id: snapshotID, created_at: createdAt, runtime_mode: 'repo',
      capture_mode: 'ax', capture_target: 'main',
      ref_scope_grammar: 'saved handles use only ref:<snapshot-id>:<ref>',
      target: 'main', query: null, artifact_refs: [], ref_count: 1, paths,
      omitted_from_compact_stdout: [], known_limits: [],
    };
    const refs = {
      schema_version: 'aos.agent-workspace.v1', workspace_id: workspace,
      snapshot_id: snapshotID, created_at: createdAt, refs: [record],
    };
    const index = {
      schema_version: 'aos.agent-workspace.v1', workspace_id: workspace,
      runtime_mode: 'repo', current_snapshot_id: snapshotID, updated_at: createdAt,
      snapshots: [{
        snapshot_id: snapshotID, created_at: createdAt, capture_mode: 'ax',
        capture_target: 'main', target: 'main', query: null, ref_count: 1,
        artifact_count: 0, paths,
      }],
    };
    const cases = [
      ['workspace.json', metadata, (file) => readWorkspaceMetadata(file, workspace), 'created_at'],
      ['index.json', index, (file) => readWorkspaceIndex(file, workspace), 'updated_at'],
      ['snapshot.json', snapshot, (file) => readSnapshotRecord(file, workspace, snapshotID), 'paths'],
      ['refs.json', refs, (file) => readRefsRecord(file, workspace, snapshotID), 'created_at'],
    ];

    for (const [name, value, read, requiredField] of cases) {
      const validFile = path.join(state, 'schema-reader-valid', name);
      writeJSON(validFile, value);
      assert.equal(workspaceSchemaAccepts(validFile), true, `${name} schema acceptance`);
      assert.doesNotThrow(() => read(validFile), `${name} reader acceptance`);

      const invalidFile = path.join(state, 'schema-reader-invalid', name);
      const invalid = structuredClone(value);
      delete invalid[requiredField];
      writeJSON(invalidFile, invalid);
      assert.equal(workspaceSchemaAccepts(invalidFile), false, `${name} schema rejection`);
      assert.throws(() => read(invalidFile), (error) => error?.code === 'AGENT_WORKSPACE_STATE_CORRUPT');
    }

    for (const [name, mutate] of [
      ['legacy-grammar', (value) => { value.ref_scope_grammar = 'legacy bare refs permitted'; }],
      ['invalid-artifact', (value) => { value.artifact_refs = [42]; }],
    ]) {
      const invalidFile = path.join(state, 'schema-reader-invalid', `snapshot-${name}.json`);
      const invalid = structuredClone(snapshot);
      mutate(invalid);
      writeJSON(invalidFile, invalid);
      assert.equal(workspaceSchemaAccepts(invalidFile), false, `${name} schema rejection`);
      assert.throws(
        () => readSnapshotRecord(invalidFile, workspace, snapshotID),
        (error) => error?.code === 'AGENT_WORKSPACE_STATE_CORRUPT',
      );
    }

    for (const [name, mutate] of [
      ['invalid-current-snapshot-id', (value) => { value.current_snapshot_id = '../escape'; }],
      ['invalid-entry-snapshot-id', (value) => { value.snapshots[0].snapshot_id = '../escape'; }],
    ]) {
      const invalidFile = path.join(state, 'schema-reader-invalid', `index-${name}.json`);
      const invalid = structuredClone(index);
      mutate(invalid);
      writeJSON(invalidFile, invalid);
      assert.equal(workspaceSchemaAccepts(invalidFile), false, `${name} schema rejection`);
      assert.throws(
        () => readWorkspaceIndex(invalidFile, workspace),
        (error) => error?.code === 'AGENT_WORKSPACE_STATE_CORRUPT',
      );
    }
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved producers reject an emitted handle that disagrees with canonical capture facts', () => {
  const context = {
    workspace_id: 'default', snapshot_id: 'snap1', target: 'browser:todo',
    capture_target: 'browser:todo', capture_mode: 'ax', artifact_refs: [],
  };
  assert.throws(
    () => generateRefRecords({
      state_id: 'see_1',
      elements: [{
        ref: 'e2',
        handle: {
          kind: 'observation_ref', backend: 'browser', state_id: 'see_other',
          scope: { session: 'todo' }, ref: 'e2',
        },
      }],
    }, context),
    (error) => error.code === 'TARGET_HANDLE_INVALID',
  );
});

test('saved native capture skips role-less raw AX elements without poisoning valid Locators', () => {
  const records = generateRefRecords({
    elements: [
      { app_pid: 42, role: '', title: 'Raw role-less element', enabled: true, handle: null },
      {
        app_pid: 42,
        role: 'AXButton',
        title: '',
        label: '',
        ax_identifier: '',
        enabled: true,
        action_names: ['AXPress'],
        handle: nativeAXLocatorHandle({ pid: 42, role: 'AXButton' }),
      },
    ],
  }, {
    workspace_id: 'default', snapshot_id: 'snap1', target: 'main',
    capture_target: 'main', capture_mode: 'ax', artifact_refs: [],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].ref, 'r1');
  assert.deepEqual(records[0].handle, nativeAXLocatorHandle({ pid: 42, role: 'AXButton' }));
});

test('V0 workspace bytes are rejected without modification', () => {
  const state = root();
  try {
    const dir = path.join(state, 'repo', 'agent-workspaces', 'default');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workspace.json');
    const bytes = '{\n  "schema_version": "aos.agent-workspace.v0",\n  "workspace_id": "default"\n}\n';
    fs.writeFileSync(file, bytes);
    const before = hash(file);
    assert.throws(
      () => readWorkspaceMetadata(file, 'default'),
      (error) => error.code === 'AGENT_WORKSPACE_SCHEMA_UNSUPPORTED' && error.extra.recapture_required === true,
    );
    assert.equal(hash(file), before);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('V1 ref records reject any parallel target model', () => {
  const state = root();
  try {
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo' };
    writeBrowserWorkspace(state, env);
    const file = path.join(state, 'repo', 'agent-workspaces', 'default', 'snapshots', 'snap1', 'refs.json');
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    envelope.refs[0].selector = '#save';
    writeJSON(file, envelope);
    assert.throws(
      () => readRefsRecord(file, 'default', 'snap1'),
      (error) => error.code === 'AGENT_WORKSPACE_STATE_CORRUPT',
    );
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved browser Observation Ref actions fail closed before managed worker dispatch', () => {
  const state = root();
  try {
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_PATH: path.join(state, 'must-not-run') };
    const record = writeWorkspace(state, env, {
      target: 'browser:todo',
      capture: {
        state_id: 'see_1',
        elements: [{ ref: 'e2', role: 'button', label: 'Save', enabled: false }],
      },
    });
    assert.equal(record.hint_facts.enabled, false);
    assert.deepEqual(record.supported_actions, []);
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'click', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, 'TARGET_ACTION_UNSUPPORTED');
    assert.equal(payload.reason, 'browser_ref_actions_unsupported');
    assert.equal(payload.state_id, 'see_1');
    assert.equal(fs.existsSync(env.AOS_PATH), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});
