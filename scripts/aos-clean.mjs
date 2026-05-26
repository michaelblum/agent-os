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
    else prettyError(`Unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`, arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
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
  const output = run('/usr/bin/pgrep', ['-f', 'aos (serve|__serve)']);
  if (output.status !== 0) return [];
  return output.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter(Number.isFinite);
}

function processTable() {
  const output = run('/bin/ps', ['-axo', 'pid=,ppid=,stat=,args=']);
  if (output.status !== 0) return [];
  return output.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1], 10),
        ppid: Number.parseInt(match[2], 10),
        stat: match[3],
        args: match[4],
      };
    })
    .filter((row) => row && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}

function orphanedClientProcesses() {
  return processTable().filter((row) => {
    if (row.pid === process.pid) return false;
    if (row.ppid !== 1) return false;
    return row.args.includes('scripts/aos-show-client.mjs listen')
      || row.args.includes('scripts/aos-inspect.mjs');
  });
}

function processArgs(pid) {
  const output = run('/bin/ps', ['-p', String(pid), '-o', 'args=']);
  if (output.status !== 0) return 'unknown';
  return output.stdout.trim();
}

function addProcessFamily(pids) {
  const table = processTable();
  const byPID = new Map(table.map((row) => [row.pid, row]));
  const protectedPIDs = new Set();
  for (const pid of pids.filter((value) => value != null)) {
    protectedPIDs.add(pid);
    const row = byPID.get(pid);
    if (row && row.ppid > 1) protectedPIDs.add(row.ppid);
    for (const child of table) {
      if (child.ppid === pid) protectedPIDs.add(child.pid);
    }
  }
  return protectedPIDs;
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
    .map((canvas) => ({ ...canvas, mode }));
}

function activeExperience(mode) {
  for (const file of [
    path.join(stateDir(mode), 'experience-state.json'),
    path.join(stateRoot(), 'experience-state.json'),
  ]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed.active_experience || null;
    } catch {
      // Fall through to the legacy unscoped state path if the canonical file is absent.
    }
  }
  return null;
}

const SIGIL_OWNED_CANVAS_IDS = new Set([
  'avatar-main',
  'sigil-hit-avatar-main',
  'sigil-radial-menu-avatar-main',
  'sigil-agent-terminal',
  'sigil-wiki-workbench',
  'sigil-render-performance',
  'sigil-interaction-trace',
]);

function sigilOwnedCanvas(canvas) {
  const id = canvas.id || '';
  const parent = canvas.parent || '';
  return SIGIL_OWNED_CANVAS_IDS.has(id)
    || (id === 'aos-desktop-world-stage' && SIGIL_OWNED_CANVAS_IDS.has(parent));
}

function staleCanvasesForMode(mode) {
  const active = activeExperience(mode);
  return listCanvases(mode).filter((canvas) => {
    if (active === 'sigil' && sigilOwnedCanvas(canvas)) return false;
    return true;
  });
}

function removeCanvas(mode, id) {
  const env = { ...process.env, AOS_RUNTIME_MODE: mode };
  return run(aosPath(), ['show', 'remove', '--id', id], { env }).status === 0;
}

function waitForCanvasRemoval(mode, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  let remaining = staleCanvasesForMode(mode);
  while (remaining.length > 0 && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    remaining = staleCanvasesForMode(mode);
  }
  return remaining;
}

function runClean(dryRun) {
  const mode = runtimeMode();
  const alternateMode = otherMode(mode);
  const protectedRoots = [
    launchdManagedPID(serviceLabel(mode)),
    launchdManagedPID(serviceLabel(alternateMode)),
    daemonLockOwnerPID(mode),
    daemonLockOwnerPID(alternateMode),
  ].filter((pid) => pid != null);
  const protectedPIDs = addProcessFamily(protectedRoots);

  const staleDaemons = [];
  const orphanedClients = orphanedClientProcesses();
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
  for (const client of orphanedClients) {
    if (!dryRun) {
      try {
        process.kill(client.pid, 'SIGTERM');
        actions.push(`killed orphaned client pid=${client.pid}`);
      } catch {
        notes.push(`failed to kill orphaned client pid=${client.pid}`);
      }
    }
  }

  let currentCanvases = staleCanvasesForMode(mode);
  let otherCanvases = staleCanvasesForMode(alternateMode);
  if (otherCanvases.length > 0) {
    notes.push(`${otherCanvases.length} canvas(es) on ${alternateMode}-mode daemon`);
  }
  const canvases = [...currentCanvases, ...otherCanvases];

  if (!dryRun && canvases.length > 0) {
    if (currentCanvases.length > 0) {
      for (const canvas of currentCanvases) {
        if (removeCanvas(mode, canvas.id)) {
          actions.push(`removed canvas id=${canvas.id} mode=${mode}`);
        } else {
          notes.push(`failed to remove canvas id=${canvas.id} mode=${mode}`);
        }
      }
      currentCanvases = waitForCanvasRemoval(mode);
      for (const canvas of currentCanvases) {
        notes.push(`failed to remove canvas id=${canvas.id} mode=${mode}`);
      }
    }
    if (otherCanvases.length > 0) {
      for (const canvas of otherCanvases) {
        if (removeCanvas(alternateMode, canvas.id)) {
          actions.push(`removed canvas id=${canvas.id} mode=${alternateMode}`);
        } else {
          notes.push(`failed to remove canvas id=${canvas.id} mode=${alternateMode}`);
        }
      }
      otherCanvases = waitForCanvasRemoval(alternateMode);
      for (const canvas of otherCanvases) {
        notes.push(`failed to remove canvas id=${canvas.id} mode=${alternateMode}`);
      }
    }
  }

  const remainingCanvases = dryRun ? canvases : [...currentCanvases, ...otherCanvases];
  const foundResources = staleDaemons.length > 0 || canvases.length > 0 || orphanedClients.length > 0;
  let status = 'clean';
  if (dryRun && foundResources) {
    status = 'dirty';
  } else if (!dryRun && remainingCanvases.length > 0) {
    status = 'failed';
  } else if (!dryRun && foundResources) {
    status = 'cleaned';
  }
  return {
    status,
    stale_daemons: staleDaemons,
    orphaned_clients: orphanedClients,
    canvases: dryRun ? canvases : remainingCanvases,
    actions_taken: actions,
    notes,
  };
}

function printText(report, dryRun) {
  if (report.stale_daemons.length === 0 && report.orphaned_clients.length === 0 && report.canvases.length === 0) {
    process.stdout.write('clean: nothing to clean\n');
  } else {
    for (const daemon of report.stale_daemons) {
      const verb = dryRun ? 'found' : 'killed';
      process.stdout.write(`clean: ${verb} stale daemon pid=${daemon.pid} (${daemon.args})\n`);
    }
    for (const client of report.orphaned_clients) {
      const verb = dryRun ? 'found' : 'killed';
      process.stdout.write(`clean: ${verb} orphaned client pid=${client.pid} (${client.args})\n`);
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
