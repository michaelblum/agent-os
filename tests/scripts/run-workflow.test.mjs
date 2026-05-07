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
fs.mkdirSync(path.dirname(recordPath), { recursive: true });
fs.appendFileSync(recordPath, JSON.stringify({
  role,
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  workflowDir,
}) + '\\n');

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (role === 'gdi') {
  const handoffDir = path.join(workflowDir, 'handoff');
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(path.join(handoffDir, 'ready-for-foreman.json'), JSON.stringify({
    status: 'ready',
    role,
  }) + '\\n');
} else if (role === 'foreman') {
  const handoffDir = path.join(workflowDir, 'handoff');
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(path.join(handoffDir, 'done.json'), JSON.stringify({
    status: 'done',
    role,
    argv: process.argv.slice(2),
  }) + '\\n');
}
`);
  await chmod(fakeCodex, 0o755);
  return fakeCodex;
}

async function readRecords(recordPath) {
  const text = await readFile(recordPath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('parses supervisor arguments', () => {
  assert.deepEqual(parseArgs(['--workflow-id', 'pilot-1', '--codex-bin', '/tmp/codex', '--keep']), {
    workflowId: 'pilot-1',
    codexBin: '/tmp/codex',
    keep: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--workflow-id']), /--workflow-id requires a value/);
});

test('run-workflow launches GDI then foreman and injects the handoff path', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-'));
  const id = `test-run-workflow-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--workflow-id',
      id,
      '--codex-bin',
      fakeCodex,
      '--keep',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const records = await readRecords(recordPath);
    assert.deepEqual(records.map((record) => record.role), ['gdi', 'foreman']);
    assert.equal(records[0].cwd, path.join(dir, 'gdi'));
    assert.equal(records[1].cwd, path.join(dir, 'foreman'));
    assert.deepEqual(records[0].argv.slice(0, 2), ['--cd', repoRoot]);
    assert.deepEqual(records[1].argv.slice(0, 2), ['--cd', repoRoot]);
    const foremanPrompt = records[1].argv.slice(2).join(' ');
    assert.match(foremanPrompt, /GDI handoff is ready at:/);
    assert.match(foremanPrompt, /handoff\/ready-for-foreman\.json/);
    assert.match(foremanPrompt, /handoff\/done\.json/);

    assert.equal(await exists(path.join(dir, 'handoff', 'ready-for-foreman.json')), true);
    assert.equal(await exists(path.join(dir, 'handoff', 'done.json')), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-workflow cleans up the workflow directory by default', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-clean-'));
  const id = `test-run-workflow-clean-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const result = spawnSync(process.execPath, [
      'scripts/run-workflow.mjs',
      '--workflow-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
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

test('run-workflow handles SIGINT by terminating children and cleaning up', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-run-workflow-signal-'));
  const id = `test-run-workflow-signal-${process.pid}-${Date.now()}`;
  const dir = workflowDir(id);
  const recordPath = path.join(tempRoot, 'records.jsonl');
  try {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const child = spawn(process.execPath, [
      'scripts/run-workflow.mjs',
      '--workflow-id',
      id,
      '--codex-bin',
      fakeCodex,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_FAKE_CODEX_RECORD: recordPath,
        AOS_FAKE_CODEX_MODE: 'hang',
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
