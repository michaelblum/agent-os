import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  isolatedWorkspaceRoot as root,
  repoRoot as repo,
  writeWorkspace,
} from './lib/agent-workspace-v1-fixture.mjs';

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
    const env = { ...process.env, AOS_PATH: path.join(state, 'must-not-run') };
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
      '--index', '0', '--near', '1,2', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'TARGET_HANDLE_INVALID');
    for (const [flag, value] of [['--depth', '129'], ['--timeout', '30001']]) {
      const bounded = spawnSync(process.execPath, [
        'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
        flag, value, '--dry-run',
      ], { cwd: repo, env, encoding: 'utf8' });
      assert.equal(bounded.status, 1);
      assert.equal(JSON.parse(bounded.stderr).code, 'TARGET_HANDLE_INVALID');
    }
    const outOfBounds = spawnSync(process.execPath, [
      'scripts/aos-do-native.mjs', 'press', '--pid', '42', '--role', 'AXButton',
      '--index', '1024', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
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
      target: 'main', capture: { elements: [{
        app_pid: 42, window_id: 7, role: 'AXButton', label: 'Save', identifier: 'save',
        enabled: true, action_names: ['AXPress'],
      }] },
    });
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'press', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).current_validation.status, 'resolved');
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'do press --pid 42 --window 7 --role AXButton --label Save --identifier save --dry-run');
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
      target: 'main', capture: { elements: [{
        app_pid: 42, role: 'AXButton', identifier: 'save', enabled: false, action_names: [],
      }] },
    });
    assert.equal(record.hint_facts.enabled, false);
    assert.deepEqual(record.supported_actions, []);
    const result = spawnSync(process.execPath, [
      'scripts/aos-do-ref.mjs', 'press', record.copyable_action_target, '--workspace', 'default', '--dry-run',
    ], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).current_validation.status, 'resolved');
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'do press --pid 42 --role AXButton --identifier save --dry-run');
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
      target: 'main', capture: { elements: [{
        app_pid: 42, window_id: 7, role: 'AXTextField', identifier: 'name',
        enabled: true, action_names: ['AXSetValue'],
      }] },
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
      target: 'main', capture: { elements: [{
        app_pid: 42, role: 'AXTextField', identifier: 'name', enabled: true, action_names: ['AXSetValue'],
      }] },
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
      target: 'main', capture: { elements: [{
        app_pid: 42, role: 'AXButton', label: 'Save', enabled: true, action_names: ['AXPress'],
      }] },
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
