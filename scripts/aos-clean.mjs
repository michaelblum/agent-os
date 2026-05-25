#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function prettyError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const options = { dryRun: false, json: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else prettyError(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  if (result.error) {
    return { status: 127, stdout: '', stderr: `${result.error.message}\n` };
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function stateRoot() {
  if (process.env.AOS_STATE_ROOT) return path.resolve(process.env.AOS_STATE_ROOT);
  return path.join(os.homedir(), '.config', 'aos');
}

function runtimeMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'installed') return 'installed';
  return 'repo';
}

function otherMode(mode) {
  return mode === 'repo' ? 'installed' : 'repo';
}

function stateDir(mode) {
  return path.join(stateRoot(), mode);
}

function serviceLabel(mode) {
  return `com.agent-os.aos.${mode}`;
}

function daemonLockOwnerPID(mode) {
  try {
    const raw = fs.readFileSync(path.join(stateDir(mode), 'daemon.lock'), 'utf8');
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed.pid) ? parsed.pid : null;
  } catch {
    return null;
  }
}

function launchdManagedPID(label) {
  const domain = `gui/${process.getuid?.() ?? ''}/${label}`;
  const result = run('/bin/launchctl', ['print', domain]);
  if (result.status !== 0) return null;
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('pid = ')) {
      const pid = Number.parseInt(line.slice('pid = '.length), 10);
      return Number.isFinite(pid) ? pid : null;
    }
  }
  return null;
}

function allDaemonPIDs() {
  const output = run('/usr/bin/pgrep', ['-f', 'aos serve']);
  if (output.status !== 0) return [];
  return output.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter(Number.isFinite);
}

function processArgs(pid) {
  const output = run('/bin/ps', ['-p', String(pid), '-o', 'args=']);
  if (output.status !== 0) return 'unknown';
  return output.stdout.trim();
}

function parseJSON(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function listCanvases(mode) {
  const env = { ...process.env, AOS_RUNTIME_MODE: mode };
  const result = run(aosPath(), ['show', 'list', '--json'], { env });
  if (result.status !== 0) return [];
  const payload = parseJSON(result.stdout);
  const canvases = Array.isArray(payload?.canvases) ? payload.canvases : [];
  return canvases
    .filter((canvas) => typeof canvas.id === 'string')
    .map((canvas) => ({ id: canvas.id, mode }));
}

function removeAllCanvases(mode) {
  const env = { ...process.env, AOS_RUNTIME_MODE: mode };
  return run(aosPath(), ['show', 'remove-all'], { env }).status === 0;
}

function runClean(dryRun) {
  const mode = runtimeMode();
  const alternateMode = otherMode(mode);
  const protectedPIDs = new Set([
    launchdManagedPID(serviceLabel(mode)),
    launchdManagedPID(serviceLabel(alternateMode)),
    daemonLockOwnerPID(mode),
    daemonLockOwnerPID(alternateMode),
  ].filter((pid) => pid != null));

  const staleDaemons = [];
  const actions = [];
  const notes = [];
  for (const pid of allDaemonPIDs().filter((pid) => !protectedPIDs.has(pid))) {
    const args = processArgs(pid);
    staleDaemons.push({ pid, args });
    if (!dryRun) {
      try {
        process.kill(pid, 'SIGTERM');
        actions.push(`killed stale daemon pid=${pid}`);
      } catch {
        notes.push(`failed to kill stale daemon pid=${pid}`);
      }
    }
  }

  const currentCanvases = listCanvases(mode);
  const otherCanvases = listCanvases(alternateMode);
  if (otherCanvases.length > 0) {
    notes.push(`${otherCanvases.length} canvas(es) on ${alternateMode}-mode daemon`);
  }
  const canvases = [...currentCanvases, ...otherCanvases];

  if (!dryRun && canvases.length > 0) {
    if (currentCanvases.length > 0 && removeAllCanvases(mode)) {
      actions.push(`removed all canvases on ${mode} daemon`);
    }
    if (otherCanvases.length > 0 && removeAllCanvases(alternateMode)) {
      actions.push(`removed all canvases on ${alternateMode} daemon`);
    }
  }

  const status = staleDaemons.length === 0 && canvases.length === 0
    ? 'clean'
    : dryRun ? 'dirty' : 'cleaned';
  return {
    status,
    stale_daemons: staleDaemons,
    canvases,
    actions_taken: actions,
    notes,
  };
}

function printText(report, dryRun) {
  if (report.stale_daemons.length === 0 && report.canvases.length === 0) {
    process.stdout.write('clean: nothing to clean\n');
  } else {
    for (const daemon of report.stale_daemons) {
      const verb = dryRun ? 'found' : 'killed';
      process.stdout.write(`clean: ${verb} stale daemon pid=${daemon.pid} (${daemon.args})\n`);
    }
    if (report.canvases.length > 0) {
      const verb = dryRun ? 'found' : 'removed';
      const ids = report.canvases.map((canvas) => canvas.id).join(', ');
      process.stdout.write(`clean: ${verb} ${report.canvases.length} canvas(es): ${ids}\n`);
    }
  }
  for (const note of report.notes) {
    process.stdout.write(`clean: ${note}\n`);
  }
}

const options = parseArgs(process.argv.slice(2));
const report = runClean(options.dryRun);
if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printText(report, options.dryRun);
}
