#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(sanitizeForJSON(value), null, 2)}\n`);
}

function exitError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function repoRoot() {
  if (process.env.AOS_REPO_ROOT) return path.resolve(process.env.AOS_REPO_ROOT);
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(scriptDir, '..');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(repoRoot(), 'aos');
}

function invocationName() {
  return process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
}

function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'repo' || override === 'installed') return override;
  return 'repo';
}

function parseArgs(args) {
  const options = { json: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} status [--json]`, 'UNKNOWN_FLAG');
  }
  return options;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${result.error.message}\n` : ''),
  };
}

function parseJSONOutput(result, label) {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    exitError(`${label} failed${detail ? `: ${detail}` : ''}`, 'STATUS_PRIMITIVE_FAILED');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    exitError(`${label} did not return JSON`, 'STATUS_PRIMITIVE_JSON_INVALID');
  }
}

function runAOS(args) {
  return run(aosPath(), args, {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
  });
}

function runNodeScript(script, args) {
  return run('/usr/bin/env', ['node', script, ...args], {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode(), AOS_PATH: aosPath() },
  });
}

function compactProcessDetail(output) {
  const combined = [output.stderr, output.stdout]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!combined) return undefined;

  try {
    const object = JSON.parse(combined);
    if (object.error && typeof object.error === 'object') {
      const code = object.error.code ?? 'unknown';
      const message = object.error.message ?? '';
      return message ? `error=${code}: ${message}` : `error=${code}`;
    }
    const parts = [
      object.status ? `status=${object.status}` : null,
      object.reason ? `reason=${object.reason}` : null,
      object.input_tap?.status ? `tap=${object.input_tap.status}` : null,
      object.input_tap?.attempts !== undefined ? `attempts=${object.input_tap.attempts}` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(' ');
  } catch {
    // Fall through to clipped text.
  }

  const clipped = combined.split(/\r?\n/).slice(0, 6).join('\n');
  return clipped.length <= 700 ? clipped : `${clipped.slice(0, 700)}...`;
}

function cleanReport() {
  const result = runNodeScript('scripts/aos-clean.mjs', ['--dry-run', '--json']);
  if (result.exitCode === 0) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { status: 'unknown', stale_daemons: [], canvases: [], notes: ['clean dry-run failed'] };
    }
  }
  return {
    status: 'unknown',
    stale_daemons: [],
    canvases: [],
    notes: [compactProcessDetail(result) || 'clean dry-run failed'],
  };
}

function gitStatus() {
  const root = repoRoot();
  if (!fs.existsSync(path.join(root, '.git'))) return null;
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

function repoCommitShort() {
  const result = run('/usr/bin/git', ['-C', repoRoot(), 'rev-parse', '--short', 'HEAD']);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

function binaryTimestamp(file) {
  try {
    return fs.statSync(file).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return undefined;
  }
}

function identity(runtime, permissionsFacts) {
  const permissionIdentity = permissionsFacts.identity ?? {};
  const mode = runtime.mode ?? currentMode();
  const value = {
    program: 'aos',
    mode,
    executable_path: permissionIdentity.executable_path || aosPath(),
    state_dir: runtime.state_dir,
    socket_path: runtime.socket_path,
  };
  if (mode === 'repo') {
    value.build_timestamp = binaryTimestamp(value.executable_path);
    value.repo_root = repoRoot();
    value.git_commit = repoCommitShort();
  }
  return value;
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

function inputTapRecoveryGuidance(status, attempts) {
  return [
    `Input tap is not active (status=${status}, attempts=${attempts}).`,
    'Try:',
    '  ./aos service restart              # restart the managed daemon and re-check readiness',
    '  ./aos permissions setup --once     # refresh macOS permission onboarding',
    '  ./aos serve --idle-timeout none    # temporary foreground fallback for this session',
  ].join('\n');
}

function inputMonitoringSubGuidance(tap, daemonBinaryPath) {
  const render = (value) => value === undefined || value === null ? 'unknown' : String(Boolean(value));
  return [
    `Daemon lacks Input Monitoring access (listen=${render(tap?.listen_access)}, post=${render(tap?.post_access)}).`,
    'In repo mode, prefer:',
    '  ./aos permissions reset-runtime --mode repo',
    '  ./aos permissions setup --once',
    '  ./aos ready --post-permission',
    'Manual Settings fallback: Privacy & Security > Input Monitoring for daemon binary:',
    `  ${daemonBinaryPath}`,
  ].join('\n');
}

function runtimeHealthNotes(runtime) {
  const notes = [];
  if (runtime.ownership_state === 'mismatch') {
    const serving = runtime.serving_pid ?? 'none';
    const lock = runtime.lock_owner_pid ?? 'none';
    const service = runtime.service_pid ?? 'none';
    notes.push(`Daemon ownership mismatch: serving pid=${serving}, lock pid=${lock}, service pid=${service}.`);
  } else if (runtime.ownership_state === 'unmanaged') {
    const owner = runtime.owner_pid ?? 'unknown';
    notes.push(`Reachable repo daemon is unmanaged: owner pid=${owner}, service pid=none. Use '${invocationName()} service start --mode ${runtime.mode}' or '${invocationName()} ready --repair'.`);
  }
  if (runtime.event_tap_expected && runtime.input_tap_status && runtime.input_tap_status !== 'active' && !runtime.input_tap) {
    notes.push(`Perception input tap is not active (status=${runtime.input_tap_status}).`);
  }
  return notes;
}

function expectedBinaryPath(mode) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') {
    const installPath = process.env.AOS_INSTALL_PATH || path.join(process.env.HOME || '', 'Applications/AOS.app');
    return path.join(installPath, 'Contents/MacOS/aos');
  }
  return path.join(repoRoot(), 'aos');
}

function statusNotes({ runtime, permissions, setup, clean, snapshot }) {
  const notes = [];
  if (!runtime.daemon_running) notes.push('Daemon is not running.');
  else if (!runtime.socket_reachable) notes.push('Daemon process appears to be running, but the socket is not reachable.');
  notes.push(...runtimeHealthNotes(runtime));
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

function setupState(marker) {
  return {
    marker_exists: Boolean(marker.marker_exists),
    marker_path: marker.marker_path,
    completed_at: marker.completed_at,
    bundle_path: marker.bundle_path,
    current_bundle_path: marker.current_bundle_path,
    bundle_matches_current: Boolean(marker.bundle_matches_current),
    setup_completed: Boolean(marker.setup_completed),
    recommended_command: marker.setup_completed ? undefined : 'aos permissions setup --once',
  };
}

function sanitizeForJSON(value) {
  if (Array.isArray(value)) return value.map(sanitizeForJSON);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, sanitizeForJSON(child)]));
  }
  return value;
}

async function buildStatusResponse() {
  const runtime = parseJSONOutput(runAOS(['__runtime', 'status-facts', '--json']), '__runtime status-facts');
  const permissionsFacts = parseJSONOutput(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  const setup = setupState(parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
  const clean = cleanReport();
  const snapshot = await daemonSnapshot(runtime.socket_path);
  const notes = statusNotes({
    runtime,
    permissions: permissionsFacts.permissions,
    setup,
    clean,
    snapshot,
  });
  return sanitizeForJSON({
    status: notes.length ? 'degraded' : 'ok',
    identity: identity(runtime, permissionsFacts),
    runtime,
    permissions: permissionsFacts.permissions,
    permissions_setup: setup,
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
  });
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
