#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function runtimeMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  return override === 'installed' ? 'installed' : 'repo';
}

function socketPath() {
  return path.join(stateRoot(), runtimeMode(), 'sock');
}

function daemonLogPath() {
  return path.join(stateRoot(), runtimeMode(), 'daemon.log');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function autoStartDisabled() {
  const value = process.env.AOS_DISABLE_DAEMON_AUTOSTART?.toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function connectOnce(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath());
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
  process.stderr.write(`ipc: starting ${runtimeMode()} daemon via launchd service...\n`);
  const child = spawn(aosPath(), ['service', 'start', '--mode', runtimeMode(), '--json'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  child.unref();
  return null;
}

async function connectWithAutoStart(options = {}) {
  let socket = await connectOnce();
  if (socket) return { socket, daemon: null };
  if (autoStartDisabled()) {
    process.stderr.write('ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART\n');
    return null;
  }
  const daemon = startDaemon(options);
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket = await connectOnce();
    if (socket) return { socket, daemon };
  }
  stopManagedDaemon(daemon);
  return null;
}

function stopManagedDaemon(daemon) {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  daemon.kill('SIGTERM');
  setTimeout(() => {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL');
  }, 250).unref();
}

function readOneJSON(socket, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      const line = buffer.slice(0, newline);
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve(null);
      }
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function sendEnvelope(service, action, data = {}) {
  const connection = await connectWithAutoStart();
  const socket = connection?.socket ?? null;
  if (!socket) error('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  socket.write(`${JSON.stringify({ v: 1, service, action, data })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  if (!response) error('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  if (response.error) {
    process.stderr.write(`${JSON.stringify(response)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function valueAfter(args, key) {
  const idx = args.indexOf(key);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function legacyValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  const value = args[idx + 1];
  return value.startsWith('--') ? undefined : value;
}

function readStdinIfAvailable() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

async function tellCommand(args) {
  if (args.includes('--who')) {
    await sendEnvelope('session', 'who', {});
    return;
  }
  if (args.includes('--register')) {
    const sessionID = valueAfter(args, '--session-id') || process.env.AOS_SESSION_ID;
    if (!sessionID) error('--register requires --session-id <id>', 'MISSING_ARG');
    const payload = {
      session_id: sessionID,
      role: valueAfter(args, '--role') || 'worker',
      harness: valueAfter(args, '--harness') || 'unknown',
    };
    const name = valueAfter(args, '--name') || legacyValue(args, '--register');
    if (name) payload.name = name;
    await sendEnvelope('session', 'register', payload);
    return;
  }
  if (args.includes('--unregister')) {
    const sessionID = valueAfter(args, '--session-id') || process.env.AOS_SESSION_ID;
    const name = legacyValue(args, '--unregister');
    if (!sessionID && !name) error('--unregister requires --session-id <id> or a legacy name argument', 'MISSING_ARG');
    const payload = {};
    if (sessionID) payload.session_id = sessionID;
    if (name) payload.name = name;
    await sendEnvelope('session', 'unregister', payload);
    return;
  }

  const explicitSessionAudience = valueAfter(args, '--session-id');
  let audience = explicitSessionAudience;
  let jsonData;
  const textParts = [];
  const payload = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--json':
        i += 1;
        if (i >= args.length) error('--json requires a value', 'MISSING_ARG');
        jsonData = args[i];
        break;
      case '--from':
        i += 1;
        if (i >= args.length) error('--from requires a value', 'MISSING_ARG');
        payload.from = args[i];
        break;
      case '--from-session-id':
        i += 1;
        if (i >= args.length) error('--from-session-id requires a value', 'MISSING_ARG');
        payload.from_session_id = args[i];
        break;
      case '--purpose':
        i += 1;
        if (i >= args.length) error('--purpose requires a value', 'MISSING_ARG');
        payload.purpose = args[i];
        break;
      case '--session-id':
        i += 1;
        if (i >= args.length) error('--session-id requires a value', 'MISSING_ARG');
        break;
      default:
        if (!arg.startsWith('--')) {
          if (!explicitSessionAudience && !audience) audience = arg;
          else textParts.push(arg);
        }
    }
  }

  if (!audience) error('tell requires an audience. Usage: aos tell <audience>|--session-id <id> [text|--json <data>]', 'MISSING_ARG');

  let text = textParts.join(' ');
  if (!text && !jsonData) text = readStdinIfAvailable();
  if (!text && !jsonData) error('tell requires text or --json. Usage: aos tell <audience>|--session-id <id> [text|--json <data>]', 'MISSING_ARG');

  payload.audience = audience.split(',').map((item) => item.trim()).filter(Boolean);
  if (text) payload.text = text;
  if (jsonData) {
    try {
      payload.payload = JSON.parse(jsonData);
    } catch {
      error(`Invalid JSON: ${jsonData}`, 'INVALID_JSON');
    }
  }
  await sendEnvelope('tell', 'send', payload);
}

function parseListenArgs(args) {
  const options = { channel: undefined, sessionID: undefined, follow: false, since: undefined, limit: 50, channels: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--channels':
        options.channels = true;
        break;
      case '--follow':
      case '-f':
        options.follow = true;
        break;
      case '--since':
        i += 1;
        if (i >= args.length) error('--since requires a value', 'MISSING_ARG');
        options.since = args[i];
        break;
      case '--limit':
        i += 1;
        if (i >= args.length) error('--limit requires a value', 'MISSING_ARG');
        if (!/^-?\d+$/.test(args[i])) error(`Invalid --limit: ${args[i]}`, 'INVALID_ARG');
        options.limit = Number(args[i]);
        break;
      case '--session-id':
        i += 1;
        if (i >= args.length) error('--session-id requires a value', 'MISSING_ARG');
        options.sessionID = args[i];
        break;
      default:
        if (!arg.startsWith('--') && !options.channel) options.channel = arg;
    }
  }
  return options;
}

async function listenCommand(args) {
  const options = parseListenArgs(args);
  if (options.channels) {
    await sendEnvelope('listen', 'channels', {});
    return;
  }
  const channel = options.sessionID || options.channel;
  if (!channel) error('listen requires a channel. Usage: aos listen <channel>|--session-id <id> [--follow|--since|--limit]', 'MISSING_ARG');
  if (options.follow) {
    await listenFollow(channel, options.since);
  } else {
    const payload = { channel, limit: options.limit };
    if (options.since) payload.since = options.since;
    await sendEnvelope('listen', 'read', payload);
  }
}

async function listenFollow(channel, since) {
  const connection = await connectWithAutoStart({ managed: true });
  const socket = connection?.socket ?? null;
  const daemon = connection?.daemon ?? null;
  if (!socket) error('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  socket.write(`${JSON.stringify({ action: 'subscribe' })}\n`);
  await readOneJSON(socket, 2000);

  if (since) {
    socket.write(`${JSON.stringify({ v: 1, service: 'listen', action: 'read', data: { channel, limit: 100, since } })}\n`);
    const response = await readOneJSON(socket, 2000);
    const body = response?.data ?? response ?? {};
    for (const message of body.messages ?? []) {
      process.stdout.write(`${JSON.stringify(message)}\n`);
    }
  }

  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let json;
      try { json = JSON.parse(line); } catch { continue; }
      if (json.v !== 1 || json.service !== 'coordination' || json.event !== 'message') continue;
      if (json.data?.channel !== channel) continue;
      process.stdout.write(`${JSON.stringify(json.data)}\n`);
    }
  });
  const close = () => {
    socket.end();
    stopManagedDaemon(daemon);
    process.exit(0);
  };
  socket.on('close', close);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'tell') await tellCommand(rest);
else if (command === 'listen') await listenCommand(rest);
else error(`Unknown communication command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
