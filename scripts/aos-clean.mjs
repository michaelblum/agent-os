#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explicitStateRootOverride } from './lib/aos-cli.mjs';

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
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
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
  const info = daemonLockInfo(mode);
  return info && info.live ? info.pid : null;
}

function daemonLockPath(mode) {
  return path.join(stateDir(mode), 'daemon.lock');
}

function daemonLockInfo(mode) {
  const lockPath = daemonLockPath(mode);
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    const pid = Number.isInteger(parsed.pid) ? parsed.pid : null;
    return {
      mode,
      path: lockPath,
      pid,
      live: pid != null && pidExists(pid),
      reason: pid == null ? 'malformed daemon lock' : 'daemon lock owner pid is not running',
    };
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

function isAOSDaemonArgs(args) {
  return /(?:^|[\/\s])aos (?:serve|__serve)(?:\s|$)/.test(String(args ?? ''));
}

function processTable() {
  const output = run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,stat=,args='], {
    maxBuffer: 32 * 1024 * 1024,
  });
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

function addDaemonCleanupFamily(pids) {
  const table = processTable();
  const cleanupPIDs = new Set();
  for (const pid of pids.filter((value) => value != null)) {
    cleanupPIDs.add(pid);
    for (const child of table) {
      if (child.ppid === pid && isAOSDaemonArgs(child.args)) cleanupPIDs.add(child.pid);
    }
  }
  return cleanupPIDs;
}

function parseJSON(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function runtimeFacts(mode) {
  const result = run(aosPath(), ['__runtime', 'status-facts', '--json'], {
    env: { ...process.env, AOS_RUNTIME_MODE: mode },
  });
  if (result.status !== 0) return null;
  return parseJSON(result.stdout);
}

function defaultRootForegroundDevOwner(mode) {
  if (explicitStateRootOverride()) return null;
  const facts = runtimeFacts(mode);
  if (!facts || facts.ownership_kind !== 'foreground_dev') return null;
  const pid = Number.isInteger(facts.owner_pid) ? facts.owner_pid : facts.serving_pid;
  if (!Number.isInteger(pid)) return null;
  return {
    mode,
    pid,
    args: processArgs(pid),
    socket_path: facts.socket_path,
    state_dir: facts.state_dir,
    reason: 'default runtime is owned by a foreground dev daemon; use launchd for the shared runtime or isolate foreground development with AOS_STATE_ROOT',
  };
}

function readJSONFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function validExperienceID(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);
}

function readExperienceManifest(id) {
  if (!validExperienceID(id)) return null;
  const manifest = readJSONFile(path.join(process.cwd(), 'experiences', id, 'aos-experience.json'));
  if (!manifest || manifest.id !== id || manifest.schema_version !== 0) return null;
  return manifest;
}

function activeExperienceContext(mode) {
  const id = activeExperience(mode);
  const manifest = readExperienceManifest(id);
  if (!manifest) {
    return {
      id,
      manifest: null,
      preserveCanvasIDs: new Set(),
    };
  }
  const preserveCanvasIDs = new Set(
    Array.isArray(manifest.cleanup?.preserve_canvas_ids)
      ? manifest.cleanup.preserve_canvas_ids.filter((id) => typeof id === 'string' && id.length > 0)
      : [],
  );

  return {
    id,
    manifest,
    preserveCanvasIDs,
  };
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

function activeExperienceOwnedCanvas(canvas, context, canvasesByID) {
  if (!context.manifest || context.preserveCanvasIDs.size === 0) return false;
  const seen = new Set();
  let id = canvas.id || '';
  while (id && !seen.has(id)) {
    if (context.preserveCanvasIDs.has(id)) return true;
    seen.add(id);
    id = canvasesByID.get(id)?.parent || '';
  }
  return false;
}

function staleCanvasesForMode(mode) {
  const canvases = listCanvases(mode);
  const activeContext = activeExperienceContext(mode);
  const canvasesByID = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  return canvases.filter((canvas) => !activeExperienceOwnedCanvas(canvas, activeContext, canvasesByID));
}

function parentFirstCanvases(canvases) {
  const byId = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  const depthFor = (canvas, seen = new Set()) => {
    const parent = canvas?.parent;
    if (!parent || seen.has(parent) || !byId.has(parent)) return 0;
    seen.add(parent);
    return 1 + depthFor(byId.get(parent), seen);
  };
  return [...canvases].sort((a, b) => depthFor(a) - depthFor(b));
}

function canvasRemovalRoots(canvases) {
  const staleIds = new Set(canvases.map((canvas) => canvas.id));
  return parentFirstCanvases(canvases).filter((canvas) => !canvas.parent || !staleIds.has(canvas.parent));
}

function removeCanvas(mode, id) {
  const env = { ...process.env, AOS_RUNTIME_MODE: mode };
  return run(aosPath(), ['show', 'remove', '--id', id], { env }).status === 0;
}

function cleanStaleCanvasesForMode(mode, actions, notes) {
  let remaining = parentFirstCanvases(staleCanvasesForMode(mode));
  let pass = 0;
  const maxPasses = 4;
  const attempted = new Set();

  while (remaining.length > 0 && pass < maxPasses) {
    pass += 1;
    const beforeIds = new Set(remaining.map((canvas) => canvas.id));
    for (const canvas of canvasRemovalRoots(remaining)) {
      const attemptKey = `${mode}:${canvas.id}`;
      if (attempted.has(attemptKey)) continue;
      attempted.add(attemptKey);
      if (removeCanvas(mode, canvas.id)) {
        actions.push(`removed canvas id=${canvas.id} mode=${mode}`);
      } else {
        notes.push(`failed to remove canvas id=${canvas.id} mode=${mode}`);
      }
    }

    remaining = parentFirstCanvases(waitForCanvasRemoval(mode, 750));
    const afterIds = new Set(remaining.map((canvas) => canvas.id));
    let changed = beforeIds.size !== afterIds.size;
    if (!changed) {
      for (const id of beforeIds) {
        if (!afterIds.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  return remaining;
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForDaemonExit(pids, timeoutMs = 2500) {
  const pending = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const pid of Array.from(pending)) {
      if (!pidExists(pid)) pending.delete(pid);
    }
    if (pending.size > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  for (const pid of Array.from(pending)) {
    if (!pidExists(pid)) pending.delete(pid);
  }
  return Array.from(pending);
}

function staleDaemonLocks(modes) {
  return modes
    .map((mode) => daemonLockInfo(mode))
    .filter((lock) => lock && !lock.live);
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
  const foregroundDevOwners = [
    defaultRootForegroundDevOwner(mode),
    defaultRootForegroundDevOwner(alternateMode),
  ].filter(Boolean);
  const foregroundDevOwnerPIDs = new Set(foregroundDevOwners.map((owner) => owner.pid));
  const foregroundDevCleanupFamilies = foregroundDevOwners.map((owner) => ({
    owner,
    pids: addDaemonCleanupFamily([owner.pid]),
  }));
  const foregroundDevCleanupTargets = new Set(foregroundDevCleanupFamilies.flatMap((item) => [...item.pids]));
  const foregroundDevProtectedFamily = addProcessFamily([...foregroundDevOwnerPIDs]);
  const foregroundOwnerForPID = (pid) => foregroundDevCleanupFamilies.find((item) => item.pids.has(pid))?.owner;
  const protectedRoots = [
    launchdManagedPID(serviceLabel(mode)),
    launchdManagedPID(serviceLabel(alternateMode)),
  ].filter((pid) => pid != null);
  if (explicitStateRootOverride()) {
    protectedRoots.push(
      ...[
        daemonLockOwnerPID(mode),
        daemonLockOwnerPID(alternateMode),
      ].filter((pid) => pid != null),
    );
  }
  const protectedPIDs = addProcessFamily(protectedRoots);

  const staleDaemons = [];
  let remainingStaleDaemons = [];
  let remainingForegroundDevOwners = foregroundDevOwners;
  const orphanedClients = orphanedClientProcesses();
  const staleLocks = staleDaemonLocks([mode, alternateMode]);
  let remainingStaleLocks = staleLocks;
  const actions = [];
  const notes = [];
  for (const lock of staleLocks) {
    if (!dryRun) {
      try {
        fs.rmSync(lock.path, { force: true });
        actions.push(`removed stale daemon lock mode=${lock.mode} pid=${lock.pid ?? 'unknown'}`);
      } catch {
        notes.push(`failed to remove stale daemon lock mode=${lock.mode} path=${lock.path}`);
      }
    }
  }
  if (!dryRun && staleLocks.length > 0) {
    remainingStaleLocks = staleDaemonLocks([mode, alternateMode]);
  }
  const candidateDaemonPIDs = new Set([...allDaemonPIDs(), ...foregroundDevCleanupTargets]);
  for (const pid of [...candidateDaemonPIDs].filter((pid) => {
    if (foregroundDevProtectedFamily.has(pid) && !foregroundDevCleanupTargets.has(pid)) return false;
    return foregroundDevCleanupTargets.has(pid) || !protectedPIDs.has(pid);
  })) {
    const args = processArgs(pid);
    const foregroundOwner = foregroundOwnerForPID(pid) ?? (foregroundDevOwnerPIDs.has(pid) ? foregroundDevOwners.find((owner) => owner.pid === pid) : null);
    staleDaemons.push({
      pid,
      args,
      reason: foregroundOwner ? 'default_foreground_dev_owner' : undefined,
      mode: foregroundOwner?.mode,
    });
    if (!dryRun) {
      try {
        process.kill(pid, 'SIGTERM');
        actions.push(`killed stale daemon pid=${pid}`);
      } catch {
        notes.push(`failed to kill stale daemon pid=${pid}`);
      }
    }
  }
  if (!dryRun && staleDaemons.length > 0) {
    const stalePIDs = staleDaemons.map((daemon) => daemon.pid);
    const remainingPIDs = waitForDaemonExit(stalePIDs);
    remainingStaleDaemons = staleDaemons.filter((daemon) => remainingPIDs.includes(daemon.pid));
    remainingForegroundDevOwners = foregroundDevOwners.filter((owner) => pidExists(owner.pid));
    for (const daemon of remainingStaleDaemons) {
      notes.push(`failed to verify stale daemon exit pid=${daemon.pid}`);
    }
  } else if (!dryRun && foregroundDevOwners.length > 0) {
    remainingForegroundDevOwners = foregroundDevOwners.filter((owner) => pidExists(owner.pid));
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

  let currentCanvases = parentFirstCanvases(staleCanvasesForMode(mode));
  let otherCanvases = parentFirstCanvases(staleCanvasesForMode(alternateMode));
  if (otherCanvases.length > 0) {
    notes.push(`${otherCanvases.length} canvas(es) on ${alternateMode}-mode daemon`);
  }
  const canvases = [...currentCanvases, ...otherCanvases];

  if (!dryRun && canvases.length > 0) {
    if (currentCanvases.length > 0) {
      currentCanvases = cleanStaleCanvasesForMode(mode, actions, notes);
      for (const canvas of currentCanvases) {
        notes.push(`failed to remove canvas id=${canvas.id} mode=${mode}`);
      }
    }
    if (otherCanvases.length > 0) {
      otherCanvases = cleanStaleCanvasesForMode(alternateMode, actions, notes);
      for (const canvas of otherCanvases) {
        notes.push(`failed to remove canvas id=${canvas.id} mode=${alternateMode}`);
      }
    }
  }

  const remainingCanvases = dryRun ? canvases : [...currentCanvases, ...otherCanvases];
  const foundResources = staleDaemons.length > 0 || foregroundDevOwners.length > 0 || staleLocks.length > 0 || canvases.length > 0 || orphanedClients.length > 0 || experienceDrift != null;
  let status = 'clean';
  if (dryRun && foundResources) {
    status = 'dirty';
  } else if (!dryRun && (remainingCanvases.length > 0 || remainingForegroundDevOwners.length > 0 || remainingStaleDaemons.length > 0 || remainingStaleLocks.length > 0)) {
    status = 'failed';
  } else if (!dryRun && foundResources) {
    status = 'cleaned';
  }
  return {
    status,
    foreground_dev_owners: dryRun ? foregroundDevOwners : remainingForegroundDevOwners,
    stale_daemons: dryRun ? staleDaemons : remainingStaleDaemons,
    stale_locks: dryRun ? staleLocks : remainingStaleLocks,
    orphaned_clients: orphanedClients,
    canvases: dryRun ? canvases : remainingCanvases,
    actions_taken: actions,
    notes,
  };
}

function printText(report, dryRun) {
  if ((report.foreground_dev_owners ?? []).length === 0 && report.stale_daemons.length === 0 && report.stale_locks.length === 0 && report.orphaned_clients.length === 0 && report.canvases.length === 0) {
    process.stdout.write('clean: nothing to clean\n');
  } else {
    for (const owner of report.foreground_dev_owners ?? []) {
      const verb = dryRun ? 'found' : 'cleaned';
      process.stdout.write(`clean: ${verb} default foreground dev owner pid=${owner.pid} mode=${owner.mode} (${owner.args})\n`);
    }
    for (const daemon of report.stale_daemons) {
      const verb = dryRun ? 'found' : 'killed';
      process.stdout.write(`clean: ${verb} stale daemon pid=${daemon.pid} (${daemon.args})\n`);
    }
    for (const lock of report.stale_locks) {
      const verb = dryRun ? 'found' : 'removed';
      process.stdout.write(`clean: ${verb} stale daemon lock mode=${lock.mode} pid=${lock.pid ?? 'unknown'} (${lock.reason})\n`);
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
