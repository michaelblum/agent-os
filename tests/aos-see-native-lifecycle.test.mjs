import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..');
const wrapperPath = join(repoRoot, 'scripts/aos-see-native.mjs');
const externalDispatchPath = join(repoRoot, 'tests/external-command-dispatch.sh');
const EXIT_TIMEOUT_MS = 5_000;

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function waitForExit(child, timeoutMs = EXIT_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`process ${child.pid ?? 'unknown'} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code, signal) => {
      cleanup();
      resolveExit({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('close', onClose);
    };
    child.once('error', onError);
    child.once('close', onClose);
  });
}

async function waitForFile(path, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await delay(10);
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
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
    await delay(20);
  }
  throw new Error(`process ${pid} remained alive`);
}

async function stopExactPID(pid) {
  if (!processExists(pid)) return;
  process.kill(pid, 'SIGTERM');
  try {
    await waitForProcessGone(pid, 1_500);
    return;
  } catch {}
  if (processExists(pid)) process.kill(pid, 'SIGKILL');
  await waitForProcessGone(pid, 1_500);
}

function parentPID(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], {
    encoding: 'utf8',
    timeout: 500,
  });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isSafeInteger(value) && value > 1 ? value : null;
}

function createTestCleanup(t, root) {
  const children = new Set();
  const pids = new Set();
  const pidFiles = new Set();
  t.after(async () => {
    for (const child of children) {
      if (child.pid && processExists(child.pid)) child.kill('SIGTERM');
    }
    for (const pidPath of pidFiles) {
      try { pids.add(Number(await readFile(pidPath, 'utf8'))); } catch {}
    }
    for (const child of children) {
      try {
        await waitForExit(child, 500);
      } catch {
        if (child.pid && processExists(child.pid)) child.kill('SIGKILL');
        await waitForExit(child, 500).catch(() => {});
      }
    }
    for (const pid of pids) await stopExactPID(pid);
    await rm(root, { force: true, recursive: true });
  });
  return {
    trackChild(child) {
      children.add(child);
      return child;
    },
    trackPID(pid) {
      pids.add(pid);
      return pid;
    },
    trackPIDFile(path) {
      pidFiles.add(path);
      return path;
    },
  };
}

async function createHangingFakeAos(root) {
  const fakeAos = join(root, 'fake-aos.mjs');
  await writeFile(fakeAos, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CHILD_PID_PATH, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
  await chmod(fakeAos, 0o755);
  return fakeAos;
}

async function processArgumentsContain(pid, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 500,
    });
    if (result.status === 0 && result.stdout.includes(expected)) return;
    await delay(10);
  }
  throw new Error(`process ${pid} never exposed expected arguments: ${expected}`);
}

async function runCaptured(cleanup, command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.trackChild(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  return { ...(await waitForExit(child)), stdout, stderr };
}

test('native see wrapper preserves child output and exit status', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-exit-'));
  const cleanup = createTestCleanup(t, root);
  const fakeAos = join(root, 'fake-aos.mjs');
  await writeFile(fakeAos, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nprocess.stderr.write('fake stderr\\n');\nprocess.exit(7);\n`);
  await chmod(fakeAos, 0o755);

  const result = await runCaptured(cleanup, process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos },
  });

  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 7, signal: null });
  assert.match(result.stdout, /"__see","capture","--region","0,0,10,10"/u);
  assert.match(result.stderr, /fake stderr/u);
});

test('saved native capture succeeds through the shared guardian', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-saved-success-'));
  const cleanup = createTestCleanup(t, root);
  const fakeAos = join(root, 'fake-aos.mjs');
  await writeFile(fakeAos, `#!/usr/bin/env node\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { dirname } from 'node:path';\nconst index = process.argv.indexOf('--out');\nif (process.argv[2] !== '__see' || process.argv[3] !== 'capture' || index < 0) process.exit(9);\nconst output = process.argv[index + 1];\nmkdirSync(dirname(output), { recursive: true });\nwriteFileSync(output, 'fixture image');\nprocess.stdout.write(JSON.stringify({ status: 'success', state_id: 'fixture', files: [output], elements: [] }) + '\\n');\n`);
  await chmod(fakeAos, 0o755);

  const result = await runCaptured(cleanup, process.execPath, [
    wrapperPath,
    'capture',
    'main',
    '--save',
    '--workspace',
    'lifecycle-test',
    '--name',
    'saved-success',
    '--mode',
    'vision',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAos,
      AOS_STATE_ROOT: join(root, 'state'),
    },
  });

  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'success');
  assert.equal(summary.counts.files, 1);
});

test('terminating the native see wrapper cannot orphan its capture child', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-signal-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = join(root, 'child.pid');
  cleanup.trackPIDFile(childPidPath);
  const fakeAos = await createHangingFakeAos(root);

  const wrapper = spawn(process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos, CHILD_PID_PATH: childPidPath },
    stdio: 'ignore',
  });
  cleanup.trackChild(wrapper);
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  wrapper.kill('SIGTERM');
  assert.deepEqual(await waitForExit(wrapper), { code: 143, signal: null });
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

test('killing the native see wrapper cannot orphan its guardian or capture child', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-kill-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = join(root, 'child.pid');
  cleanup.trackPIDFile(childPidPath);
  const fakeAos = await createHangingFakeAos(root);

  const wrapper = spawn(process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos, CHILD_PID_PATH: childPidPath },
    stdio: 'ignore',
  });
  cleanup.trackChild(wrapper);
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  wrapper.kill('SIGKILL');
  assert.deepEqual(await waitForExit(wrapper), { code: null, signal: 'SIGKILL' });
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

test('killing the direct-capture guardian makes its wrapper retire the native process group', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-guardian-kill-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = cleanup.trackPIDFile(join(root, 'child.pid'));
  const fakeAos = await createHangingFakeAos(root);

  const wrapper = cleanup.trackChild(spawn(process.execPath, [wrapperPath, 'capture', '--region', '0,0,10,10'], {
    cwd: repoRoot,
    env: { ...process.env, AOS_PATH: fakeAos, CHILD_PID_PATH: childPidPath },
    stdio: 'ignore',
  }));
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  process.kill(guardianPid, 'SIGKILL');
  assert.deepEqual(await waitForExit(wrapper), { code: 1, signal: null });
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

test('killing a saved-capture wrapper cannot orphan its native capture child', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-saved-kill-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = join(root, 'child.pid');
  cleanup.trackPIDFile(childPidPath);
  const fakeAos = await createHangingFakeAos(root);

  const wrapper = spawn(process.execPath, [
    wrapperPath,
    'capture',
    'main',
    '--save',
    '--workspace',
    'lifecycle-test',
    '--name',
    'saved-kill',
    '--mode',
    'vision',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAos,
      AOS_STATE_ROOT: join(root, 'state'),
      CHILD_PID_PATH: childPidPath,
    },
    stdio: 'ignore',
  });
  cleanup.trackChild(wrapper);
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  wrapper.kill('SIGKILL');
  assert.deepEqual(await waitForExit(wrapper), { code: null, signal: 'SIGKILL' });
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

test('killing the saved-capture guardian makes its wrapper retire the native process group', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-saved-guardian-kill-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = cleanup.trackPIDFile(join(root, 'child.pid'));
  const fakeAos = await createHangingFakeAos(root);

  const wrapper = cleanup.trackChild(spawn(process.execPath, [
    wrapperPath,
    'capture',
    'main',
    '--save',
    '--workspace',
    'lifecycle-test',
    '--name',
    'saved-guardian-kill',
    '--mode',
    'vision',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAos,
      AOS_STATE_ROOT: join(root, 'state'),
      CHILD_PID_PATH: childPidPath,
    },
    stdio: 'ignore',
  }));
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  process.kill(guardianPid, 'SIGKILL');
  assert.deepEqual(await waitForExit(wrapper), { code: 1, signal: null });
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

test('native see wrapper retires its capture when its owner disappears', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aos-see-native-owner-'));
  const cleanup = createTestCleanup(t, root);
  const childPidPath = join(root, 'child.pid');
  const wrapperPidPath = join(root, 'wrapper.pid');
  cleanup.trackPIDFile(childPidPath);
  cleanup.trackPIDFile(wrapperPidPath);
  const fakeAos = await createHangingFakeAos(root);
  const launcherPath = join(root, 'launcher.mjs');
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
  cleanup.trackChild(launcher);
  const wrapperPid = Number(await waitForFile(wrapperPidPath));
  const capturePid = Number(await waitForFile(childPidPath));
  const guardianPid = cleanup.trackPID(parentPID(capturePid));

  launcher.kill('SIGKILL');
  assert.deepEqual(await waitForExit(launcher), { code: null, signal: 'SIGKILL' });
  await waitForProcessGone(wrapperPid);
  await waitForProcessGone(capturePid);
  await waitForProcessGone(guardianPid);
});

for (const daemonTitle of [`${join(repoRoot, 'aos')} __serve`, './aos __serve']) {
  test(`external dispatch refuses a live raw daemon launched as ${daemonTitle}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'aos-external-dispatch-preflight-'));
    const cleanup = createTestCleanup(t, root);
    const daemon = spawn('/usr/bin/perl', ['-e', '$0 = $ARGV[0]; sleep 30', daemonTitle], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    cleanup.trackChild(daemon);
    await processArgumentsContain(daemon.pid, daemonTitle);

    const result = await runCaptured(cleanup, '/bin/bash', [externalDispatchPath, '--preflight-only'], {
      cwd: repoRoot,
      env: process.env,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /refuses while raw AOS is live/u);
    assert.equal(processExists(daemon.pid), true);
  });
}
