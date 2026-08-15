import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function mode(env) {
  return env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function socketPath(env) {
  const root = path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
  return path.join(root, mode(env), 'sock');
}

function connectOnce(env, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath(env));
    const timer = setTimeout(() => { socket.destroy(); resolve(null); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve(null); });
  });
}

function startDaemon(env) {
  const executable = env.AOS_PATH || path.join(process.cwd(), 'aos');
  return spawnSync(executable, ['service', 'start', '--mode', mode(env), '--json'], {
    encoding: 'utf8', env,
  });
}

async function connect(env, autoStart) {
  let socket = await connectOnce(env);
  if (socket || !autoStart) return socket;
  if (['1', 'true', 'yes', 'on'].includes(env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase())) return null;
  startDaemon(env);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket = await connectOnce(env);
    if (socket) return socket;
  }
  return null;
}

function readOneJSON(socket, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); resolve(null); }, timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, newline))); } catch { resolve(null); }
    });
    socket.once('error', () => { clearTimeout(timer); resolve(null); });
  });
}

export async function focusDaemonRequest(service, action, data = {}, options = {}) {
  const env = options.env ?? process.env;
  const socket = await connect(env, options.autoStart !== false);
  if (!socket) return options.optional ? null : { error: 'Could not connect to daemon', code: 'DAEMON_UNAVAILABLE' };
  socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  return response ?? (options.optional ? null : { error: 'Could not read daemon response', code: 'DAEMON_UNAVAILABLE' });
}
