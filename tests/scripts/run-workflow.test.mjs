import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
} from '../../scripts/run-workflow.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const orderingDelayMs = 250;

function workflowDir(id) {
  return path.join(repoRoot, '.aos-test-tmp', 'workflows', id);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function waitForFile(filePath) {
  if (fs.existsSync(filePath)) return Promise.resolve(filePath);
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    let watcher = null;
    const timeout = setTimeout(() => {
      watcher?.close();
      reject(new Error(`timed out waiting for ${filePath}`));
    }, 5000);
    watcher = fs.watch(dir, (_eventType, filename) => {
      if ((!filename || filename.toString() === basename) && fs.existsSync(filePath)) {
        clearTimeout(timeout);
        watcher.close();
        resolve(filePath);
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExit(child) {
  let exited = false;
  const promise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  return {
    promise,
    get exited() {
      return exited;
    },
  };
}

async function writeFakeCodex(tempRoot) {
  const fakeCodex = path.join(tempRoot, 'fake-codex.mjs');
  await writeFile(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = process.env.AOS_WORKFLOW_DIR;
const role = process.env.AOS_WORKFLOW_ROLE;
const recordPath = process.env.AOS_FAKE_CODEX_RECORD;
const mode = process.env.AOS_FAKE_CODEX_MODE || 'complete';
if (!workflowDir || !role || !recordPath) {
  throw new Error('missing fake codex env');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload) + '\\n');
}

function writeMarker(envName) {
  const markerPath = process.env[envName];
  if (!markerPath) return;
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, 'ok\\n');
}

function waitForPath(filePath) {
  if (fs.existsSync(filePath)) return Promise.resolve(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      watcher?.close();
      reject(new Error(\`timed out waiting for \${filePath}\`));
    }, 5000);
    let watcher = fs.watch(path.dirname(filePath), (_eventType, filename) => {
      if ((!filename || filename.toString() === path.basename(filePath)) && fs.existsSync(filePath)) {
        clearTimeout(timeout);
        watcher.close();
        resolve(filePath);
      }
    });
  });
}

fs.mkdirSync(path.dirname(recordPath), { recursive: true });
const roleFilePath = path.join(process.cwd(), 'role.md');
const taskFilePath = path.join(process.cwd(), 'task.md');
const roleReadmePath = path.join(process.cwd(), 'README.md');
const roleHooksPath = path.join(process.cwd(), '.codex', 'hooks.json');
const dockJsonPath = path.join(workflowDir, 'dock-template', 'dock.json');
const dockRunPath = path.join(workflowDir, 'dock-run.json');
const roleHooks = fs.existsSync(roleHooksPath)
  ? JSON.parse(fs.readFileSync(roleHooksPath, 'utf8')).hooks.Stop.flatMap((matcher) => matcher.hooks).map((hook) => hook.command)
  : [];
fs.appendFileSync(recordPath, JSON.stringify({
  role,
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  workflowDir,
  roleSessionId: process.env.AOS_WORKFLOW_ROLE_SESSION_ID,
  roleHooks,
  roleFile: fs.existsSync(roleFilePath) ? fs.readFileSync(roleFilePath, 'utf8') : null,
  taskFile: fs.existsSync(taskFilePath) ? fs.readFileSync(taskFilePath, 'utf8') : null,
  roleReadme: fs.existsSync(roleReadmePath) ? fs.readFileSync(roleReadmePath, 'utf8') : null,
  dockTemplateType: fs.existsSync(dockJsonPath)
    ? JSON.parse(fs.readFileSync(dockJsonPath, 'utf8')).type
    : null,
  dockRunType: fs.existsSync(dockRunPath)
    ? JSON.parse(fs.readFileSync(dockRunPath, 'utf8')).type
    : null,
}) + '\\n');

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (role === 'gdi') {
  const handoffDir = path.join(workflowDir, 'handoff');
  writeJson(path.join(handoffDir, 'ready-for-foreman.json'), {
    status: 'ready',
    role,
  });
  if (mode === 'gdi-ready-then-fail') {
    process.exit(42);
  }
  if (mode === 'gdi-ready-then-wait') {
    writeMarker('AOS_FAKE_CODEX_GDI_READY_MARKER');
    await waitForPath(process.env.AOS_FAKE_CODEX_GDI_EXIT_FILE);
  }
} else if (role === 'foreman') {
  const handoffDir = path.join(workflowDir, 'handoff');
  writeJson(path.join(handoffDir, 'done.json'), {
    status: 'done',
    role,
    argv: process.argv.slice(2),
  });
  if (mode === 'foreman-done-then-wait') {
    writeMarker('AOS_FAKE_CODEX_FOREMAN_DONE_MARKER');
    await waitForPath(process.env.AOS_FAKE_CODEX_FOREMAN_EXIT_FILE);
  }
}
`);
  await chmod(fakeCodex, 0o755);
  return fakeCodex;
}

async function writeFakeAos(tempRoot) {
  const fakeAos = path.join(tempRoot, 'fake-aos.mjs');
  await writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';

const recordPath = process.env.AOS_FAKE_AOS_RECORD;
if (!recordPath) throw new Error('missing AOS_FAKE_AOS_RECORD');
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(recordPath, JSON.stringify({
  argv: process.argv.slice(2),
  stdin,
}) + '\\n');
process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');
`);
  await chmod(fakeAos, 0o755);
  return fakeAos;
}

async function readRecords(recordPath) {
  const text = await readFile(recordPath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function assertCodexExecInvocation(record, options = {}) {
  const goalPrefix = options.goalPrefix ?? false;
  assert.equal(record.argv[0], 'exec');
  assert.equal(record.argv[1], '--model');
  assert.equal(record.argv[2], 'gpt-5.5');
  assert.equal(record.argv[3], '-c');
  assert.equal(record.argv[4], 'model_reasoning_effort="high"');
  assert.equal(record.argv.includes('--cd'), false);
  assert.equal(record.argv.includes(repoRoot), false);
  if (goalPrefix) {
    assert.match(record.argv.at(-1), /^\/goal /);
  } else {
    assert.doesNotMatch(record.argv.at(-1), /^\/goal /);
  }
}

function promptArg(record) {
  return record.argv.at(-1);
}

test('parses supervisor arguments', () => {
  assert.equal(parseArgs(['--workflow-id', 'pilot-1']).workflowId, 'pilot-1');
  assert.deepEqual(parseArgs(['--run-id', 'pilot-1', '--codex-bin', '/tmp/codex']), {
    workflowId: 'pilot-1',
    codexBin: '/tmp/codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: null,
    tts: true,
    keep: true,
    list: false,
    status: false,
    json: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--run-id', 'pilot-1', '--clean']), {
    workflowId: 'pilot-1',
    codexBin: 'codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: null,
    tts: true,
    keep: false,
    list: false,
    status: false,
    json: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--run-id', 'pilot-1', '--gdi-task-file', 'task.md', '--tts']), {
    workflowId: 'pilot-1',
    codexBin: 'codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: 'task.md',
    tts: true,
    keep: true,
    list: false,
    status: false,
    json: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--run-id', 'pilot-1', '--no-tts']), {
    workflowId: 'pilot-1',
    codexBin: 'codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: null,
    tts: false,
    keep: true,
    list: false,
    status: false,
    json: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--list', '--json']), {
    workflowId: null,
    codexBin: 'codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: null,
    tts: true,
    keep: true,
    list: true,
    status: false,
    json: true,
    help: false,
  });
  assert.deepEqual(parseArgs(['--status', '--run-id', 'pilot-1', '--json']), {
    workflowId: 'pilot-1',
    codexBin: 'codex',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    gdiTaskFile: null,
    tts: true,
    keep: true,
    list: false,
    status: true,
    json: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--run-id']), /--run-id requires a value/);
  assert.throws(() => parseArgs(['--gdi-task-file']), /--gdi-task-file requires a value/);
  assert.throws(() => parseArgs(['--list', '--status']), /mutually exclusive/);
});

test('parses explicit Codex role profile overrides', () => {
  assert.deepEqual(parseArgs(['--run-id', 'pilot-1', '--model', 'gpt-5.4', '--reasoning-effort', 'xhigh']), {
    workflowId: 'pilot-1',
    codexBin: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    gdiTaskFile: null,
    tts: true,
    keep: true,
    list: false,
    status: false,
    json: false,
    help: false,
  });
});

test('run-workflow seeds the dock template, launches GDI then foreman with codex exec, and keeps state by default', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-'));
  const id = `test-run-workflow-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const aosRecordPath = path.join(tempRoot, 'aos-records.jsonl');
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: aosRecordPath,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const records = await readRecords(recordPath);
    assert.deepEqual(records.map((record) => record.role), ['gdi', 'foreman']);
    assert.equal(records[0].cwd, path.join(dir, 'gdi'));
    assert.equal(records[1].cwd, path.join(dir, 'foreman'));
    assert.equal(records[0].roleSessionId, `${id}:gdi`);
    assert.equal(records[1].roleSessionId, `${id}:foreman`);
    assertCodexExecInvocation(records[0], { goalPrefix: true });
    assertCodexExecInvocation(records[1], { goalPrefix: false });
    const gdiPrompt = promptArg(records[0]);
    assert.match(gdiPrompt, /You are the GDI role/);
    assert.match(gdiPrompt, /handoff\/ready-for-foreman\.json/);
    const foremanPrompt = promptArg(records[1]);
    assert.match(foremanPrompt, /You are the foreman role/);
    assert.match(foremanPrompt, /handoff\/ready-for-foreman\.json/);
    assert.match(foremanPrompt, /handoff\/done\.json/);
    assert.equal(records[0].dockTemplateType, 'aos.dock_template.v0');
    assert.equal(records[1].dockTemplateType, 'aos.dock_template.v0');
    assert.equal(records[0].dockRunType, 'aos.docked_workflow_run.v0');
    assert.equal(records[1].dockRunType, 'aos.docked_workflow_run.v0');
    assert.match(records[0].roleFile, /You are the GDI role/);
    assert.match(records[1].roleFile, /You are the foreman role/);
    assert.match(records[0].taskFile, /\{\{taskBody\}\}/);
    assert.match(records[1].taskFile, /Read the GDI handoff sentinel/);
    assert.equal(records[0].roleHooks.some((command) => command.includes('workflow-tts.sh')), true);
    assert.equal(records[1].roleHooks.some((command) => command.includes('workflow-tts.sh')), true);
    assert.match(records[0].roleReadme, /GDI Role Dock/);
    assert.match(records[1].roleReadme, /Foreman Role Dock/);
    assert.doesNotMatch(records[0].roleFile, /\{\{repoRoot\}\}/);
    assert.doesNotMatch(records[1].roleFile, /\{\{readyPath\}\}/);

    assert.equal(await exists(path.join(dir, 'dock-template', 'README.md')), true);
    assert.equal(await exists(path.join(dir, 'dock-template', 'dock.json')), true);
    assert.equal(await exists(path.join(dir, 'dock-run.json')), true);
    assert.equal(await exists(path.join(dir, 'gdi', 'README.md')), true);
    assert.equal(await exists(path.join(dir, 'foreman', 'role.md')), true);
    assert.equal(await exists(path.join(dir, 'foreman', 'task.md')), true);
    assert.equal(await exists(path.join(dir, 'handoff', 'ready-for-foreman.json')), true);
    assert.equal(await exists(path.join(dir, 'handoff', 'done.json')), true);

    const statusResult = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--status',
      '--run-id',
      id,
      '--json',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.type, 'aos.docked_workflow.status.v0');
    assert.equal(status.workflow_id, id);
    assert.equal(status.state, 'completed');
    assert.equal(status.active_role, null);
    assert.equal(status.sentinels.ready_for_foreman.exists, true);
    assert.equal(status.sentinels.done.exists, true);
    assert.equal(status.tts_enabled.gdi, true);
    assert.equal(status.tts_enabled.foreman, true);
    assert.equal(status.role_sessions.gdi.session_id, `${id}:gdi`);
    assert.equal(status.role_sessions.foreman.session_id, `${id}:foreman`);
    assert.equal(status.role_sessions.gdi.latest_register.success, true);
    assert.equal(status.role_sessions.gdi.latest_voice_bind.success, true);
    assert.equal(status.role_sessions.gdi.latest_unregister.success, true);
    assert.equal(status.role_sessions.foreman.latest_register.success, true);
    assert.equal(status.role_sessions.foreman.latest_voice_bind.success, true);
    assert.equal(status.role_sessions.foreman.latest_unregister.success, true);

    const aosCalls = await readRecords(aosRecordPath);
    assert.deepEqual(aosCalls.map((call) => call.argv.slice(0, 3)), [
      ['tell', '--register', '--session-id'],
      ['voice', 'bind', '--session-id'],
      ['tell', '--unregister', '--session-id'],
      ['tell', '--register', '--session-id'],
      ['voice', 'bind', '--session-id'],
      ['tell', '--unregister', '--session-id'],
    ]);
    assert.equal(aosCalls[0].argv[3], `${id}:gdi`);
    assert.deepEqual(aosCalls[1].argv.slice(3), [
      `${id}:gdi`,
      '--quality-tier',
      'premium',
      '--language',
      'en',
      '--gender',
      'female',
    ]);
    assert.equal(aosCalls[2].argv[3], `${id}:gdi`);
    assert.equal(aosCalls[3].argv[3], `${id}:foreman`);
    assert.deepEqual(aosCalls[4].argv.slice(3), [
      `${id}:foreman`,
      '--quality-tier',
      'premium',
      '--language',
      'en',
      '--gender',
      'male',
    ]);
    assert.equal(aosCalls[5].argv[3], `${id}:foreman`);

    const listResult = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--list',
      '--json',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(listResult.status, 0, listResult.stderr);
    const list = JSON.parse(listResult.stdout);
    assert.equal(list.type, 'aos.docked_workflow.list.v0');
    assert.ok(list.workflows.some((workflow) => workflow.workflow_id === id));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow waits for GDI to exit after ready sentinel before launching foreman', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-order-gdi-'));
  const id = `test-run-workflow-order-gdi-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  const gdiReadyMarker = path.join(tempRoot, 'gdi-ready.marker');
  const gdiExitFile = path.join(tempRoot, 'release-gdi-exit');
  const stderr = [];
  let child = null;

  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    child = spawn(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_FAKE_CODEX_MODE: 'gdi-ready-then-wait',
        AOS_FAKE_CODEX_GDI_READY_MARKER: gdiReadyMarker,
        AOS_FAKE_CODEX_GDI_EXIT_FILE: gdiExitFile,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

    await waitForFile(gdiReadyMarker);
    await delay(orderingDelayMs);
    assert.deepEqual((await readRecords(recordPath)).map((record) => record.role), ['gdi']);

    const statusResult = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--status',
      '--run-id',
      id,
      '--json',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.state, 'gdi_finishing');
    assert.equal(status.active_role, 'gdi');
    assert.equal(status.sentinels.ready_for_foreman.exists, true);
    assert.equal(status.sentinels.done.exists, false);
    assert.ok(status.processes.some((processRow) => processRow.role === 'supervisor'));
    assert.ok(status.processes.some((processRow) => processRow.role === 'gdi'));

    await writeFile(gdiExitFile, 'release\n');
    const exit = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(exit.code, 0, stderr.join(''));
    assert.deepEqual((await readRecords(recordPath)).map((record) => record.role), ['gdi', 'foreman']);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow fails if GDI exits non-zero after writing ready sentinel', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-gdi-fail-'));
  const id = `test-run-workflow-gdi-fail-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');

  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_FAKE_CODEX_MODE: 'gdi-ready-then-fail',
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /GDI exited with code 42/);
    assert.deepEqual((await readRecords(recordPath)).map((record) => record.role), ['gdi']);
    assert.equal(await exists(path.join(dir, 'handoff', 'ready-for-foreman.json')), true);
    assert.equal(await exists(path.join(dir, 'handoff', 'done.json')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow waits for foreman to exit after done sentinel before completing', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-order-foreman-'));
  const id = `test-run-workflow-order-foreman-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  const foremanDoneMarker = path.join(tempRoot, 'foreman-done.marker');
  const foremanExitFile = path.join(tempRoot, 'release-foreman-exit');
  const stderr = [];
  let child = null;

  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    child = spawn(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_FAKE_CODEX_MODE: 'foreman-done-then-wait',
        AOS_FAKE_CODEX_FOREMAN_DONE_MARKER: foremanDoneMarker,
        AOS_FAKE_CODEX_FOREMAN_EXIT_FILE: foremanExitFile,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    const exit = processExit(child);

    await waitForFile(foremanDoneMarker);
    await delay(orderingDelayMs);
    assert.equal(exit.exited, false, 'supervisor exited before foreman process exited');
    assert.equal(await exists(path.join(dir, 'handoff', 'done.json')), true);

    await writeFile(foremanExitFile, 'release\n');
    const result = await exit.promise;
    assert.equal(result.code, 0, stderr.join(''));
    assert.deepEqual((await readRecords(recordPath)).map((record) => record.role), ['gdi', 'foreman']);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow appends a GDI task file to the codex exec GDI prompt', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-task-'));
  const id = `test-run-workflow-task-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  const taskPath = path.join(tempRoot, 'task.md');
  const taskBody = 'Fix exactly the GDI/foreman ordering race.\nKeep the sentinel watcher intact.';

  try {
    await writeFile(taskPath, `${taskBody}\n`);
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
      '--gdi-task-file',
      taskPath,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const records = await readRecords(recordPath);
    assertCodexExecInvocation(records[0], { goalPrefix: true });
    assertCodexExecInvocation(records[1], { goalPrefix: false });
    const gdiPrompt = promptArg(records[0]);
    const foremanPrompt = promptArg(records[1]);
    assert.match(gdiPrompt, /## Task/);
    assert.match(gdiPrompt, /Fix exactly the GDI\/foreman ordering race/);
    assert.match(gdiPrompt, /Keep the sentinel watcher intact/);
    assert.doesNotMatch(foremanPrompt, /Fix exactly the GDI\/foreman ordering race/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow disables role-local TTS hooks with --no-tts', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-tts-'));
  const id = `test-run-workflow-tts-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
      '--no-tts',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const records = await readRecords(recordPath);
    assert.equal(records[0].roleHooks.some((command) => command.includes('workflow-tts.sh')), false);
    assert.equal(records[1].roleHooks.some((command) => command.includes('workflow-tts.sh')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow cleans up the workflow directory with --clean', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-clean-'));
  const id = `test-run-workflow-clean-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
      '--clean',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await exists(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow handles SIGINT by terminating children and honoring --clean', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-signal-'));
  const id = `test-run-workflow-signal-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const fakeAos = await writeFakeAos(tempRoot);
    const child = spawn(process.execPath, [
      'scripts/run-workflow.mjs',
      '--run-id',
      id,
      '--codex-bin',
      fakeCodex,
      '--clean',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_FAKE_CODEX_MODE: 'hang',
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_AOS_RECORD: path.join(tempRoot, 'aos-records.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForFile(recordPath);
    child.kill('SIGINT');
    const exit = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(exit.code, 130);
    assert.equal(await exists(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow uses native fs.watch and no polling interval for sentinels', async () => {
  const source = await readFile(path.join(repoRoot, 'scripts', 'run-workflow.mjs'), 'utf8');
  assert.match(source, /fs\.watch\(/);
  assert.doesNotMatch(source, /setInterval\(/);
});
