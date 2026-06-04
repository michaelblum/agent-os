#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';

import {
  currentMode,
  exitError,
  expectedBinaryPath,
  invocationName,
  printJSON,
  repoRoot,
  run,
} from './lib/aos-cli.mjs';
import {
  brokerFacts,
  cleanReport,
  identity,
  runtimeHealthNotes,
} from './lib/aos-facts.mjs';
import {
  inputMonitoringSubGuidance,
  inputTapRecoveryGuidance,
} from './lib/aos-readiness.mjs';

function parseArgs(args) {
  const options = { json: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} status [--json]`, 'UNKNOWN_FLAG');
  }
  return options;
}

function gitStatus() {
  const root = repoRoot();
  if (!fs.existsSync(`${root}/.git`)) return null;
  const branch = run('/usr/bin/git', ['-C', root, 'branch', '--show-current']);
  const ahead = run('/usr/bin/git', ['-C', root, 'rev-list', '--count', 'origin/main..HEAD']);
  const dirty = run('/usr/bin/git', ['-C', root, 'status', '--porcelain']);
  const worktrees = run('/usr/bin/git', ['-C', root, 'worktree', 'list']);
  if (branch.exitCode !== 0 && dirty.exitCode !== 0) return null;
  const aheadCount = Number.parseInt(ahead.stdout.trim(), 10);
  return {
    branch: branch.stdout.trim() || '?',
    ahead_of_origin_main: Number.isFinite(aheadCount) ? aheadCount : undefined,
    dirty_files: dirty.stdout.split(/\r?\n/).filter(Boolean).length,
    worktrees: Math.max(worktrees.stdout.split(/\r?\n/).filter(Boolean).length, 1),
  };
}

function connectOnce(socketPath, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
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

function readOneJSON(socket, timeoutMs = 1000) {
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
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch {
        resolve(false);
      }
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function daemonSnapshot(socketPath) {
  const socket = await connectOnce(socketPath);
  if (!socket) return { snapshot: null, notes: ['Daemon snapshot is unavailable.'] };
  socket.write(`${JSON.stringify({ v: 1, service: 'see', action: 'snapshot', data: {} })}\n`);
  const response = await readOneJSON(socket);
  socket.end();
  if (!response) return { snapshot: null, notes: ['Daemon snapshot is unavailable.'] };
  if (response === false) return { snapshot: null, notes: ['Failed to decode daemon snapshot.'] };
  if (typeof response.error === 'string') return { snapshot: null, notes: [response.error] };
  if (response.error && typeof response.error === 'object') {
    return { snapshot: null, notes: [response.error.message || response.error.code || 'Daemon snapshot is unavailable.'] };
  }
  const snapshot = response.data?.snapshot ?? response.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return { snapshot: null, notes: ['Failed to decode daemon snapshot.'] };
  }
  return {
    snapshot: {
      focused_app: snapshot.focused_app,
      displays: snapshot.displays,
      windows: snapshot.windows,
      channels: snapshot.channels,
    },
    notes: [],
  };
}

function statusNotes({ runtime, permissions, setup, clean, snapshot }) {
  const notes = [];
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');
  notes.push(...runtimeHealthNotes(runtime, invocationName()));
  if (runtime.socket_reachable && runtime.input_tap && runtime.input_tap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(runtime.input_tap.status, runtime.input_tap.attempts));
    if (runtime.input_tap.listen_access === false || runtime.input_tap.post_access === false) {
      notes.push(inputMonitoringSubGuidance(runtime.input_tap, expectedBinaryPath(runtime.mode)));
    }
  }
  if (!permissions.accessibility) notes.push('Accessibility permission is not granted.');
  if (!permissions.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) {
    notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  }
  if (clean.status === 'dirty') {
    const canvasIDs = (clean.canvases ?? []).map((canvas) => canvas.id).filter(Boolean);
    if (canvasIDs.length) notes.push(`Stale canvas cleanup recommended: ${canvasIDs.join(', ')}.`);
    if (clean.stale_daemons?.length) {
      notes.push(`Stale daemon cleanup recommended: ${clean.stale_daemons.map((daemon) => daemon.pid).join(', ')}.`);
    }
    notes.push(...(clean.notes ?? []));
  }
  notes.push(...snapshot.notes);
  return notes;
}

async function buildStatusResponse() {
  const facts = brokerFacts({
    failureCode: 'STATUS_PRIMITIVE_FAILED',
    jsonCode: 'STATUS_PRIMITIVE_JSON_INVALID',
    includeRuntime: true,
  });
  const runtime = facts.runtime;
  const clean = cleanReport();
  const snapshot = await daemonSnapshot(runtime.socket_path);
  const notes = statusNotes({
    runtime,
    permissions: facts.permissions,
    setup: facts.setup,
    clean,
    snapshot,
  });
  return {
    status: notes.length ? 'degraded' : 'ok',
    identity: identity(runtime, facts.permissionsFacts),
    runtime,
    permissions: facts.permissions,
    permissions_setup: facts.setup,
    daemon_snapshot: snapshot.snapshot,
    stale_resources: {
      status: clean.status,
      stale_daemons: clean.stale_daemons?.length ?? 0,
      canvases: (clean.canvases ?? []).map((canvas) => canvas.id).filter(Boolean),
      notes: clean.notes ?? [],
    },
    git: gitStatus(),
    recommended_entrypoints: [
      `${invocationName()} help <command> [--json]`,
      `${invocationName()} introspect review`,
      `${invocationName()} clean`,
    ],
    notes,
  };
}

function printText(response) {
  const snapshot = response.daemon_snapshot;
  const focusedApp = snapshot?.focused_app ?? '?';
  const displays = snapshot?.displays ?? 0;
  const windows = snapshot?.windows ?? 0;
  const channels = snapshot?.channels ?? 0;
  const staleCanvasCount = response.stale_resources?.canvases?.length ?? 0;
  const tapValue = !response.runtime.socket_reachable
    ? 'unknown'
    : response.runtime.input_tap_status ?? 'unknown';
  const daemonState = response.runtime.socket_reachable
    ? 'reachable'
    : (response.runtime.daemon_running ? 'running' : 'down');
  let line = `status=${response.status} mode=${response.runtime.mode} daemon=${daemonState} pid=${response.runtime.daemon_pid ?? '?'} tap=${tapValue} focused_app=${focusedApp} displays=${displays} windows=${windows} channels=${channels} stale_canvases=${staleCanvasCount}`;
  if (response.git) {
    line += ` branch=${response.git.branch} ahead=${response.git.ahead_of_origin_main ?? '?'} dirty=${response.git.dirty_files}`;
  }
  process.stdout.write(`${line}\n`);
  for (const note of response.notes) process.stdout.write(`${note}\n`);
  process.stdout.write(`Next: ${invocationName()} help <command> | ${invocationName()} introspect review\n`);
}

const options = parseArgs(process.argv.slice(2));
const response = await buildStatusResponse();
if (options.json) printJSON(response);
else printText(response);
