import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { generateRefRecords } from '../scripts/lib/agent-workspace/refs.mjs';
import { defaultWorkspaceMetadata } from '../scripts/lib/agent-workspace/core.mjs';
import {
  readRefsRecord,
  readSnapshotRecord,
  readWorkspaceIndex,
  readWorkspaceMetadata,
} from '../scripts/lib/agent-workspace/store.mjs';
import {
  nativeAXLocatorHandle,
  recordBrowserCaptureGeneration,
} from '../scripts/lib/target-handle-runtime.mjs';
import { resolveReviewedObservationRuntime } from '../scripts/lib/playwright-cli-runtime.mjs';

const repo = path.resolve(new URL('..', import.meta.url).pathname);

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-workspace-v1-'));
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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
instance = json.loads(Path(sys.argv[3]).read_text())
registry = Registry().with_resource(handle_schema["$id"], Resource.from_contents(handle_schema))
sys.exit(0 if Draft202012Validator(schema, registry=registry).is_valid(instance) else 1)
`,
    path.join(repo, 'shared/schemas/aos-agent-workspace-v1.schema.json'),
    path.join(repo, 'shared/schemas/aos-target-handle-v1.schema.json'),
    file,
  ], { cwd: repo, encoding: 'utf8' });
  return result.status === 0;
}

function fakePlaywrightRuntime(state, name, script, version = '0.1.15') {
  const dir = path.join(state, name, 'node_modules', '@playwright', 'cli');
  const executable = path.join(dir, 'playwright-cli');
  writeJSON(path.join(dir, 'package.json'), { name: '@playwright/cli', version });
  fs.writeFileSync(executable, script, { mode: 0o755 });
  const env = {
    ...process.env,
    AOS_STATE_ROOT: state,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PLAYWRIGHT_CLI: executable,
    AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '1',
  };
  return { executable, env, runtime: resolveReviewedObservationRuntime({ env }) };
}

function writeWorkspace(state, env, { target, capture }) {
  const workspace = 'default';
  const snapshotID = 'snap1';
  const dir = path.join(state, 'repo', 'agent-workspaces', workspace);
  const snapshotDir = path.join(dir, 'snapshots', snapshotID);
  const paths = {
    workspace: dir,
    snapshot: snapshotDir,
    snapshot_record: path.join(snapshotDir, 'snapshot.json'),
    capture: path.join(snapshotDir, 'capture.json'),
    summary: path.join(snapshotDir, 'summary.json'),
    refs: path.join(snapshotDir, 'refs.json'),
    artifacts: path.join(snapshotDir, 'artifacts'),
  };
  const createdAt = '2026-08-05T12:00:00Z';
  const context = {
    workspace_id: workspace,
    snapshot_id: snapshotID,
    target,
    capture_target: target,
    capture_mode: 'ax',
    artifact_refs: [],
  };
  const refs = generateRefRecords(capture, context);
  writeJSON(path.join(dir, 'workspace.json'), {
    ...defaultWorkspaceMetadata(workspace, env),
    created_at: createdAt,
    updated_at: createdAt,
  });
  writeJSON(paths.snapshot_record, {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    created_at: createdAt,
    runtime_mode: 'repo',
    capture_mode: 'ax',
    capture_target: target,
    target,
    query: null,
    ref_scope_grammar: 'saved handles use only ref:<snapshot-id>:<ref>',
    artifact_refs: [],
    ref_count: refs.length,
    paths,
    omitted_from_compact_stdout: [],
    known_limits: [],
  });
  writeJSON(paths.refs, {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    created_at: createdAt,
    refs,
  });
  writeJSON(path.join(snapshotDir, 'committed.json'), {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    committed_at: createdAt,
    snapshot_record: 'snapshot.json',
  });
  return refs[0];
}

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
  assert.ok(browser.known_limits.includes('browser_observation_identity_unproven'));
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

test('browser dry-run validates the stored pair then fails closed before backend ref resolution', () => {
  const state = root();
  try {
    const log = path.join(state, 'playwright.log');
    const { env, runtime } = fakePlaywrightRuntime(
      state, 'reviewed', `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\necho probe-ok\n`,
    );
    assert.equal(runtime.status, 'ok');
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] }, env, runtime.observation_identity,
    );
    const blocked = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_1', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    const blockedPayload = JSON.parse(blocked.stderr);
    assert.equal(blockedPayload.code, 'TARGET_ACTION_UNSUPPORTED');
    assert.equal(blockedPayload.reason, 'browser_observation_identity_unproven');

    const stale = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_old', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(stale.status, 1);
    assert.equal(JSON.parse(stale.stderr).code, 'TARGET_STATE_STALE');

    const duplicateState = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2',
      '--state-id', 'see_1', '--state-id', 'see_1', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(duplicateState.status, 1);
    assert.equal(JSON.parse(duplicateState.stderr).code, 'TARGET_HANDLE_INVALID');
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved browser capture hints do not bypass original-pair validation', () => {
  const state = root();
  try {
    const log = path.join(state, 'playwright.log');
    const resolved = fakePlaywrightRuntime(
      state, 'reviewed', `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\necho probe-ok\n`,
    );
    assert.equal(resolved.runtime.status, 'ok');
    const env = {
      ...resolved.env,
      AOS_PATH: path.join(state, 'must-not-run'),
    };
    const record = writeWorkspace(state, env, {
      target: 'browser:todo',
      capture: {
        state_id: 'see_1',
        elements: [{ ref: 'e2', role: 'button', label: 'Save', enabled: false }],
      },
    });
    assert.equal(record.hint_facts.enabled, false);
    assert.deepEqual(record.supported_actions, []);
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] }, env, resolved.runtime.observation_identity,
    );
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'click', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, 'TARGET_ACTION_UNSUPPORTED');
    assert.equal(payload.reason, 'browser_observation_identity_unproven');
    assert.equal(payload.state_id, 'see_1');
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('coordinate and canvas actions reject state before any backend dispatch', () => {
  const state = root();
  try {
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_PATH: path.join(state, 'must-not-run') };
    for (const argv of [
      ['scripts/aos-do-native.mjs', 'click', '10,20', '--state-id', 'see_1', '--dry-run'],
      ['scripts/aos-do-canvas.mjs', 'click', 'canvas:settings/save', '--state-id', 'see_1', '--dry-run'],
    ]) {
      const result = spawnSync(process.execPath, argv, { cwd: repo, env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stderr).code, 'TARGET_STATE_UNSUPPORTED');
    }
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('native AX Locator rejects simultaneous index and near before backend dispatch', () => {
  const state = root();
  try {
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
      '--index', '0', '--near', '1,2', '--dry-run',
    ], { cwd: repo, env: { ...process.env, AOS_PATH: path.join(state, 'must-not-run') }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'TARGET_HANDLE_INVALID');
    for (const [flag, value] of [['--depth', '129'], ['--timeout', '30001']]) {
      const bounded = spawnSync(process.execPath, [
        'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
        flag, value, '--dry-run',
      ], { cwd: repo, env: { ...process.env, AOS_PATH: path.join(state, 'must-not-run') }, encoding: 'utf8' });
      assert.equal(bounded.status, 1);
      assert.equal(JSON.parse(bounded.stderr).code, 'TARGET_HANDLE_INVALID');
    }
    const outOfBounds = spawnSync(process.execPath, [
      'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
      '--index', '1024', '--dry-run',
    ], { cwd: repo, env: { ...process.env, AOS_PATH: path.join(state, 'must-not-run') }, encoding: 'utf8' });
    assert.equal(outOfBounds.status, 1);
    assert.equal(JSON.parse(outOfBounds.stderr).code, 'TARGET_HANDLE_INVALID');
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved native AX Locator dry-run re-resolves its complete machine query', () => {
  const state = root();
  try {
    const log = path.join(state, 'aos.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf '{"status":"dry_run","mutation_performed":false}\\n'\n`, { mode: 0o755 });
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo', AOS_PATH: aos };
    const record = writeWorkspace(state, env, {
      target: 'main',
      capture: {
        elements: [{
          app_pid: 42,
          window_id: 7,
          role: 'AXButton',
          label: 'Save',
          identifier: 'save',
          enabled: true,
          action_names: ['AXPress'],
        }],
      },
    });
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'press', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).current_validation.status, 'resolved');
    assert.equal(
      fs.readFileSync(log, 'utf8').trim(),
      'do press --pid 42 --window 7 --role AXButton --label Save --identifier save --dry-run',
    );
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved Locator capture hints never bypass action-time resolution', () => {
  const state = root();
  try {
    const log = path.join(state, 'aos.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf '{"status":"dry_run","mutation_performed":false}\\n'\n`, { mode: 0o755 });
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo', AOS_PATH: aos };
    const record = writeWorkspace(state, env, {
      target: 'main',
      capture: {
        elements: [{
          app_pid: 42,
          role: 'AXButton',
          identifier: 'save',
          enabled: false,
          action_names: [],
        }],
      },
    });
    assert.equal(record.hint_facts.enabled, false);
    assert.deepEqual(record.supported_actions, []);

    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'press', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).current_validation.status, 'resolved');
    assert.equal(
      fs.readFileSync(log, 'utf8').trim(),
      'do press --pid 42 --role AXButton --identifier save --dry-run',
    );
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('direct and saved native set-value preserve window scope on effectful dispatch', () => {
  const state = root();
  try {
    const log = path.join(state, 'aos.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf '{"status":"success"}\\n'\n`, { mode: 0o755 });
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo', AOS_PATH: aos };
    const direct = spawnSync(process.execPath, [
      'scripts/aos-do-native.mjs', 'set-value', '--pid', '42', '--window', '7',
      '--role', 'AXTextField', '--identifier', 'name', '--value', 'updated',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(direct.status, 0, direct.stderr);

    const record = writeWorkspace(state, env, {
      target: 'main',
      capture: {
        elements: [{
          app_pid: 42, window_id: 7, role: 'AXTextField', identifier: 'name',
          enabled: true, action_names: ['AXSetValue'],
        }],
      },
    });
    const saved = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'set-value', record.copyable_action_target,
      '--workspace', 'default', '--value', 'updated',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(saved.status, 0, saved.stderr);
    const savedPayload = JSON.parse(saved.stdout);
    assert.equal(savedPayload.current_validation.status, 'resolved');
    assert.equal(savedPayload.resolved_action.resolution_status, 'validated');
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
      '__do set-value --pid 42 --window 7 --role AXTextField --identifier name --value updated',
      'do set-value --pid 42 --window 7 --role AXTextField --identifier name --value updated',
    ]);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved native set-value preserves an explicit empty value payload', () => {
  const state = root();
  try {
    const log = path.join(state, 'aos.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, `#!/bin/sh\nprintf '<%s>\n' "$@" >> "${log}"\nprintf '{"status":"success"}\n'\n`, { mode: 0o755 });
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo', AOS_PATH: aos };
    const record = writeWorkspace(state, env, {
      target: 'main',
      capture: {
        elements: [{
          app_pid: 42, role: 'AXTextField', identifier: 'name',
          enabled: true, action_names: ['AXSetValue'],
        }],
      },
    });
    const saved = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'set-value', record.copyable_action_target,
      '--workspace', 'default', '--value', '',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(saved.status, 0, saved.stderr);
    assert.match(fs.readFileSync(log, 'utf8'), /<--value>\n<>\n/);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('saved Locator failures preserve typed ambiguity and bounded candidates', () => {
  const state = root();
  try {
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, `#!/bin/sh
printf '%s\\n' '{"status":"error","code":"TARGET_AMBIGUOUS","error":"multiple current matches","candidate_count":2,"candidates":[{"role":"AXButton","label":"Save"},{"role":"AXButton","label":"Save As"}]}' >&2
exit 1
`, { mode: 0o755 });
    const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'repo', AOS_PATH: aos };
    const record = writeWorkspace(state, env, {
      target: 'main',
      capture: {
        elements: [{
          app_pid: 42, role: 'AXButton', label: 'Save', enabled: true,
          action_names: ['AXPress'],
        }],
      },
    });
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'press', record.copyable_action_target, '--workspace', 'default',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, 'TARGET_AMBIGUOUS');
    assert.equal(payload.candidate_count, 2);
    assert.deepEqual(payload.candidates, [
      { role: 'AXButton', label: 'Save' },
      { role: 'AXButton', label: 'Save As' },
    ]);
    assert.equal(payload.ref.handle.kind, 'locator');
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('effectful browser Observation Ref action fails closed without backend dispatch', () => {
  const state = root();
  try {
    const log = path.join(state, 'playwright.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const resolved = fakePlaywrightRuntime(
      state, 'reviewed', `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\necho ok\n`,
    );
    assert.equal(resolved.runtime.status, 'ok');
    const env = {
      ...resolved.env,
      AOS_PATH: aos,
    };
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] }, env, resolved.runtime.observation_identity,
    );
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_1',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, 'TARGET_ACTION_UNSUPPORTED');
    assert.equal(payload.reason, 'browser_observation_identity_unproven');
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('browser dry-run and effect fail identically before any potentially aliasing backend call', () => {
  const state = root();
  try {
    const log = path.join(state, 'playwright.log');
    const resolved = fakePlaywrightRuntime(
      state,
      'reviewed',
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\necho must-not-run >&2\nexit 9\n`,
    );
    assert.equal(resolved.runtime.status, 'ok');
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] },
      resolved.env, resolved.runtime.observation_identity,
    );
    for (const suffix of [['--dry-run'], []]) {
      const result = spawnSync(process.execPath, [
        'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_1', ...suffix,
      ], { cwd: repo, env: resolved.env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stderr);
      assert.equal(payload.code, 'TARGET_ACTION_UNSUPPORTED');
      assert.equal(payload.reason, 'browser_observation_identity_unproven');
    }
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('effectful browser action rejects a same-version replacement backend', () => {
  const state = root();
  try {
    const log = path.join(state, 'replacement.log');
    const minting = fakePlaywrightRuntime(state, 'minting', '#!/bin/sh\necho minting\n');
    const replacement = fakePlaywrightRuntime(
      state, 'replacement', `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`,
    );
    assert.equal(minting.runtime.status, 'ok');
    assert.equal(replacement.runtime.status, 'ok');
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] },
      minting.env, minting.runtime.observation_identity,
    );
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_1',
    ], { cwd: repo, env: replacement.env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'TARGET_STATE_STALE');
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('effectful browser Observation Refs fail closed on an unreviewed CLI version', () => {
  const state = root();
  try {
    const log = path.join(state, 'playwright.log');
    const aos = path.join(state, 'fake-aos');
    fs.writeFileSync(aos, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const minting = fakePlaywrightRuntime(state, 'minting', '#!/bin/sh\necho minting\n');
    assert.equal(minting.runtime.status, 'ok');
    const unreviewed = fakePlaywrightRuntime(
      state, 'unreviewed', `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, '0.1.16',
    );
    assert.equal(unreviewed.runtime.status, 'unsupported');
    const env = {
      ...unreviewed.env,
      AOS_PATH: aos,
    };
    recordBrowserCaptureGeneration(
      'todo', { state_id: 'see_1', elements: [{ ref: 'e2' }] }, minting.env, minting.runtime.observation_identity,
    );
    const missingState = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(missingState.status, 1);
    assert.equal(JSON.parse(missingState.stderr).code, 'TARGET_STATE_REQUIRED');
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-browser.mjs', 'click', 'browser:todo/e2', '--state-id', 'see_1',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'TARGET_ACTION_UNSUPPORTED');
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});
