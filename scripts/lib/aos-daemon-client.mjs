import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function aosStateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function aosRuntimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function aosSocketPath() {
  return path.join(aosStateRoot(), aosRuntimeMode(), 'sock');
}

function daemonLogPath() {
  return path.join(aosStateRoot(), aosRuntimeMode(), 'daemon.log');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function autoStartDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(process.env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase());
}

function autoStartAllowed() {
  return process.env.AOS_ALLOW_DAEMON_AUTOSTART === '1';
}

function connectOnce(timeoutMs = 1000, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const socket = net.createConnection(aosSocketPath());
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => {
      socket.destroy();
      finish(null);
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(null);
    }, timeoutMs);
    socket.once('connect', () => {
      finish(socket);
    });
    socket.once('error', () => {
      socket.destroy();
      finish(null);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortableDelay(milliseconds, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function startDaemon({ managed = false } = {}) {
  if (process.env.AOS_STATE_ROOT) {
    process.stderr.write('ipc: starting isolated daemon with explicit AOS_STATE_ROOT...\n');
    fs.mkdirSync(path.dirname(daemonLogPath()), { recursive: true });
    const log = fs.openSync(daemonLogPath(), 'a');
    const child = spawn(aosPath(), ['serve', '--idle-timeout', '5m'], {
      detached: !managed,
      stdio: ['ignore', 'ignore', log],
      env: process.env,
    });
    if (!managed) child.unref();
    return managed ? child : null;
  }
  process.stderr.write(`ipc: starting ${aosRuntimeMode()} daemon via launchd service...\n`);
  const child = spawn(aosPath(), ['service', 'start', '--mode', aosRuntimeMode(), '--json'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  child.unref();
  return null;
}

export async function connectWithAutoStart(options = {}) {
  const signal = options.signal ?? null;
  let socket = await connectOnce(1000, signal);
  if (signal?.aborted) {
    socket?.destroy();
    return null;
  }
  if (socket) return { socket, daemon: null };
  if (options.allowStart === false) return null;
  if (autoStartDisabled()) {
    process.stderr.write('ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART\n');
    return null;
  }
  if (!autoStartAllowed()) {
    process.stderr.write('ipc: daemon auto-start requires AOS_ALLOW_DAEMON_AUTOSTART=1\n');
    return null;
  }
  const daemon = startDaemon(options);
  if (daemon) options.onManagedDaemon?.(daemon);
  let terminationPromise = null;
  const terminateOwnedDaemon = () => {
    terminationPromise ??= stopManagedDaemon(daemon);
    return terminationPromise;
  };
  const onAbort = () => { void terminateOwnedDaemon(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    await terminateOwnedDaemon();
    signal?.removeEventListener('abort', onAbort);
    return null;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!await abortableDelay(100, signal)) break;
    socket = await connectOnce(1000, signal);
    if (signal?.aborted) {
      socket?.destroy();
      break;
    }
    if (socket) {
      signal?.removeEventListener('abort', onAbort);
      return { socket, daemon };
    }
  }
  await terminateOwnedDaemon();
  signal?.removeEventListener('abort', onAbort);
  return null;
}

export async function stopManagedDaemon(daemon, graceMs = 1500) {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  await new Promise((resolve) => {
    let killTimer = null;
    const finish = () => {
      if (killTimer) clearTimeout(killTimer);
      resolve();
    };
    daemon.once('exit', finish);
    if (daemon.exitCode !== null || daemon.signalCode !== null) {
      daemon.off('exit', finish);
      finish();
      return;
    }
    daemon.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL');
    }, graceMs);
  });
}
