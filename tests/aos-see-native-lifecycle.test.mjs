import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..');
const wrapperPath = join(repoRoot, 'scripts/aos-see-native.mjs');

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForFile(path, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGone(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`process ${pid} remained alive`);
}

test('native see wrapper preserves child output and exit status', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-exit-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const fakeAos = join(root, 'fake-aos.mjs');
  await writeFile(fakeAos, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nprocess.stderr.write('fake stderr\\n');\nprocess.exit(7);\n`);
  await chmod(fakeAos, 0o755);

  const child = spawn(process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const result = await waitForExit(child);

  assert.deepEqual(result, { code: 7, signal: null });
  assert.match(stdout, /"__see","capture","--region","0,0,10,10"/u);
  assert.match(stderr, /fake stderr/u);
});

test('terminating the native see wrapper cannot orphan its capture child', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-signal-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const fakeAos = join(root, 'fake-aos.mjs');
  const childPidPath = join(root, 'child.pid');
  await writeFile(fakeAos, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CHILD_PID_PATH, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
  await chmod(fakeAos, 0o755);

  const wrapper = spawn(process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos, CHILD_PID_PATH: childPidPath },
    stdio: 'ignore',
  });
  const capturePid = Number(await waitForFile(childPidPath));
  assert.equal(processExists(capturePid), true);

  wrapper.kill('SIGTERM');
  const result = await waitForExit(wrapper);

  assert.deepEqual(result, { code: 143, signal: null });
  assert.equal(processExists(capturePid), false);
});

test('native see wrapper retires its capture when its owner disappears', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-owner-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const fakeAos = join(root, 'fake-aos.mjs');
  const launcherPath = join(root, 'launcher.mjs');
  const childPidPath = join(root, 'child.pid');
  const wrapperPidPath = join(root, 'wrapper.pid');
  await writeFile(fakeAos, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CHILD_PID_PATH, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
  await chmod(fakeAos, 0o755);
  await writeFile(launcherPath, `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst child = spawn(process.execPath, [${JSON.stringify(wrapperPath)}, 'capture', '--region', '0,0,10,10'], { env: process.env, stdio: 'ignore' });\nwriteFileSync(process.env.WRAPPER_PID_PATH, String(child.pid));\nsetInterval(() => {}, 1000);\n`);

  const launcher = spawn(process.execPath, [launcherPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAos,
      CHILD_PID_PATH: childPidPath,
      WRAPPER_PID_PATH: wrapperPidPath,
    },
    stdio: 'ignore',
  });
  const wrapperPid = Number(await waitForFile(wrapperPidPath));
  const capturePid = Number(await waitForFile(childPidPath));
  assert.equal(processExists(wrapperPid), true);
  assert.equal(processExists(capturePid), true);

  launcher.kill('SIGKILL');
  assert.deepEqual(await waitForExit(launcher), { code: null, signal: 'SIGKILL' });
  await waitForProcessGone(wrapperPid);
  await waitForProcessGone(capturePid);
});
