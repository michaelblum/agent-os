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

function connectOnce(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(aosSocketPath());
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
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
  let socket = await connectOnce();
  if (socket) return { socket, daemon: null };
  if (autoStartDisabled()) {
    process.stderr.write('ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART\n');
    return null;
  }
  if (!autoStartAllowed()) {
    process.stderr.write('ipc: daemon auto-start requires AOS_ALLOW_DAEMON_AUTOSTART=1\n');
    return null;
  }
  const daemon = startDaemon(options);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket = await connectOnce();
    if (socket) return { socket, daemon };
  }
  stopManagedDaemon(daemon);
  return null;
}

export function stopManagedDaemon(daemon) {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  daemon.kill('SIGTERM');
  setTimeout(() => {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL');
  }, 250).unref();
}
