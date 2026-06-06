#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedLiveOperation } from './lib/aos-live-operation.mjs';

class ExperienceFailure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const repoRoot = process.cwd();
const aos = process.env.AOS_PATH && !process.env.AOS_PATH.startsWith('$')
  ? process.env.AOS_PATH
  : path.join(repoRoot, 'aos');
const mode = process.env.AOS_RUNTIME_MODE && !process.env.AOS_RUNTIME_MODE.startsWith('$')
  ? process.env.AOS_RUNTIME_MODE
  : 'repo';

function prettyJSON(value) {
  return `${JSON.stringify(value, null, 2).replace(/"([A-Za-z0-9_]+)":/g, '"$1" :')}\n`;
}

function emitJSON(value, stderr = false) {
  (stderr ? process.stderr : process.stdout).write(prettyJSON(value));
}

function fail(message, code) {
  emitJSON({ status: 'failure', code, error: message }, true);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    env: process.env,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
  };
}

function runAos(args, options = {}) {
  return run(aos, args, { timeout: 60000, ...options });
}

function requireSuccess(result, summary) {
  if (result.status === 0) return result;
  throw new ExperienceFailure(`${summary}: ${result.stderr || result.stdout}`.trim(), 'COMMAND_FAILED');
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ExperienceFailure(`Could not read ${file}: ${err.message}`, 'EXPERIENCE_MANIFEST_READ_FAILED');
  }
}

function discoverExperience(id) {
  const file = path.join(repoRoot, 'experiences', id, 'aos-experience.json');
  if (!fs.existsSync(file)) throw new ExperienceFailure(`Experience manifest not found: experiences/${id}/aos-experience.json`, 'EXPERIENCE_NOT_FOUND');
  const manifest = readJSON(file);
  if (manifest.id !== id) throw new ExperienceFailure(`Manifest id ${manifest.id} does not match experience ${id}`, 'INVALID_EXPERIENCE_MANIFEST');
  if (manifest.schema_version !== 0 || manifest.exclusive !== true) throw new ExperienceFailure(`Invalid experience manifest: ${file}`, 'INVALID_EXPERIENCE_MANIFEST');
  return manifest;
}

function findExperience(id) {
  if (!id) return null;
  const file = path.join(repoRoot, 'experiences', id, 'aos-experience.json');
  return fs.existsSync(file) ? discoverExperience(id) : null;
}

function branchName() {
  const result = run('git', ['-C', repoRoot, 'branch', '--show-current']);
  return result.status === 0 ? result.stdout.trim() : '';
}

function scopedRootName(prefix) {
  const branch = branchName();
  if (!branch || branch === 'main') return prefix;
  const suffix = branch.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'worktree';
  return `${prefix}_${suffix}`;
}

function resolveRepoPath(relPath, fieldName) {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)) {
    throw new ExperienceFailure(`${fieldName} must be a repo-relative path`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  const resolved = path.resolve(repoRoot, relPath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new ExperienceFailure(`${fieldName} must stay under the repo: ${relPath}`, 'INVALID_EXPERIENCE_MANIFEST');
  }
  return resolved;
}

function resolveContentRoots(manifest) {
  return (manifest.content_roots || []).map((root) => {
    if (!root.id || !root.path) throw new ExperienceFailure('content_roots entries require id and path', 'INVALID_EXPERIENCE_MANIFEST');
    return {
      id: root.id,
      key: root.branch_scoped === false ? root.id : scopedRootName(root.id),
      path: resolveRepoPath(root.path, `content_roots.${root.id}.path`),
      branch_scoped: root.branch_scoped !== false,
    };
  });
}

function rootMap(roots) {
  return Object.fromEntries(roots.map((root) => [root.id, root]));
}

function template(value, rootsByID) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{root:([A-Za-z0-9_-]+)\}/g, (_, id) => {
      const root = rootsByID[id];
      if (!root) throw new ExperienceFailure(`Unknown content root template: ${id}`, 'INVALID_EXPERIENCE_MANIFEST');
      return root.key;
    })
    .replace(/\$\{mode\}/g, mode)
    .replace(/\$\{repo_root\}/g, repoRoot);
}

function runContentStatus() {
  const result = runAos(['content', 'status', '--json']);
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout).roots || {};
  } catch {
    return {};
  }
}

function norm(value) {
  return path.resolve(value);
}

function rootsLive(roots) {
  const live = runContentStatus();
  return roots.every((root) => live[root.key] && norm(live[root.key]) === norm(root.path));
}

function configGet(key) {
  const result = runAos(['config', 'get', key, '--json']);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).value ?? null;
  } catch {
    return result.stdout.trim() || null;
  }
}

function nestedGet(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), object);
}

function stateDir() {
  const root = process.env.AOS_STATE_ROOT && !process.env.AOS_STATE_ROOT.startsWith('$')
    ? path.resolve(process.env.AOS_STATE_ROOT)
    : path.join(os.homedir(), '.config', 'aos');
  return path.join(root, mode);
}

function statePath() {
  return path.join(stateDir(), 'experience-state.json');
}

function configPath() {
  return path.join(stateDir(), 'config.json');
}

function legacyStatePath() {
  const root = process.env.AOS_STATE_ROOT && !process.env.AOS_STATE_ROOT.startsWith('$')
    ? path.resolve(process.env.AOS_STATE_ROOT)
    : path.join(os.homedir(), '.config', 'aos');
  return path.join(root, 'experience-state.json');
}

function readRuntimeConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeRuntimeConfig(config) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(configPath(), prettyJSON(config), 'utf8');
}

function readActiveExperience() {
  for (const file of [statePath(), legacyStatePath()]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed.active_experience || null;
    } catch {
      // Fall through to the legacy path during the one-time state migration.
    }
  }
  return null;
}

function writeActiveExperience(id) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(), prettyJSON({ active_experience: id || null, exclusive: true }), 'utf8');
  const legacy = legacyStatePath();
  if (legacy !== statePath()) {
    try {
      fs.rmSync(legacy, { force: true });
    } catch {
      // Best-effort cleanup; the mode-scoped state file is authoritative.
    }
  }
}

function parseArgs(argv) {
  const [subcommand, ...tail] = argv;
  let json = false;
  let dryRun = false;
  let allowStart = false;
  const extra = [];
  let id = null;
  for (const arg of tail) {
    if (arg === '--json') json = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--allow-start') allowStart = true;
    else if (arg.startsWith('--')) throw new ExperienceFailure(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    else if (subcommand === 'activate' && id === null) id = arg;
    else extra.push(arg);
  }
  if (!subcommand || !['status', 'activate', 'deactivate'].includes(subcommand)) {
    throw new ExperienceFailure('Usage: aos experience <status|activate|deactivate> [id] [--json] [--dry-run]', 'MISSING_ARG');
  }
  if (subcommand === 'activate' && !id) throw new ExperienceFailure('Usage: aos experience activate <id> [--json] [--dry-run]', 'MISSING_ARG');
  if (extra.length) throw new ExperienceFailure(`Unexpected argument: ${extra[0]}`, 'UNKNOWN_ARG');
  return { subcommand, id, json, dryRun, allowStart };
}

function vanillaFallback() {
  return {
    status_item: false,
    tools: [],
  };
}

function status(asJSON) {
  const activeID = readActiveExperience();
  const result = {
    status: 'success',
    code: 'OK',
    mode,
    active_experience: activeID,
    exclusive: true,
    vanilla_fallback: vanillaFallback(),
  };
  if (asJSON) emitJSON(result);
  else process.stdout.write(activeID ? `active experience: ${activeID}\n` : 'active experience: none\n');
}

function plan(manifest, roots, dryRun) {
  const rootsByID = rootMap(roots);
  return {
    experience: {
      id: manifest.id,
      title: manifest.title,
      version: manifest.version,
      exclusive: manifest.exclusive,
    },
    mode,
    dry_run: dryRun,
    active_experience: dryRun ? null : manifest.id,
    replaces_active_experience: readActiveExperience(),
    vanilla_fallback: manifest.vanilla_fallback,
    default_activation: manifest.default_activation,
    content_roots: roots,
    status_item: {
      ...manifest.status_item,
      toggle_surface: {
        ...manifest.status_item.toggle_surface,
        url: template(manifest.status_item.toggle_surface.url, rootsByID),
      },
    },
    branding: manifest.branding,
    menu: manifest.menu,
  };
}

function requireLivePermission(operationId, allowStart) {
  const guarded = guardedLiveOperation({ operationId, allowStart, mode, prefix: aos });
  if (!guarded.ok) {
    emitJSON(guarded.failure, true);
    process.exit(1);
  }
  return guarded.preflight;
}

function ensureContentRoots(roots, steps, allowStart) {
  const removedRoots = reconcileExperienceContentRoots(roots);
  if (removedRoots.length > 0) {
    steps.push({ id: 'content-root:reconcile', status: 'success', removed: removedRoots });
  }
  for (const root of roots) {
    requireSuccess(runAos(['config', 'set', `content.roots.${root.key}`, root.path]), `set content root ${root.key}`);
    steps.push({ id: `content-root:${root.key}`, status: 'success', path: root.path });
  }
  if (!rootsLive(roots)) {
    requireLivePermission('experience.content-roots', allowStart);
    runAos(['service', 'restart', '--mode', mode]);
    steps.push({ id: 'service:restart', status: 'success', reason: 'content-roots-not-live' });
  }
  const args = ['content', 'wait'];
  for (const root of roots) args.push('--root', root.key);
  args.push('--auto-start', '--allow-start', '--timeout', '15s');
  requireSuccess(runAos(args), 'wait for content roots');
  steps.push({ id: 'content:wait', status: 'success', roots: roots.map((root) => root.key) });
}

function reconcileExperienceContentRoots(roots) {
  const config = readRuntimeConfig();
  const currentRoots = config.content?.roots;
  if (!currentRoots || typeof currentRoots !== 'object') return [];

  const keepKeys = new Set(roots.map((root) => root.key));
  const owned = roots
    .filter((root) => root.branch_scoped)
    .map((root) => ({
      id: root.id,
      prefix: `${root.id}_`,
      path: norm(root.path),
    }));
  const removed = [];

  for (const [key, value] of Object.entries(currentRoots)) {
    if (keepKeys.has(key)) continue;
    const root = owned.find((candidate) => (
      key.startsWith(candidate.prefix)
      && typeof value === 'string'
      && norm(value) === candidate.path
    ));
    if (!root) continue;
    delete currentRoots[key];
    removed.push(key);
  }

  if (removed.length > 0) writeRuntimeConfig(config);
  return removed.sort();
}

function configureStatusItem(manifest, roots, steps) {
  const rootsByID = rootMap(roots);
  const surface = manifest.status_item.toggle_surface;
  const previousConfig = readRuntimeConfig();
  const previousToggleID = nestedGet(previousConfig, 'status_item.toggle_id');
  const previousToggleURL = nestedGet(previousConfig, 'status_item.toggle_url');
  const nextToggleURL = template(surface.url, rootsByID);
  const values = [
    ['status_item.enabled', String(Boolean(manifest.status_item.enabled))],
    ['status_item.toggle_id', surface.id],
    ['status_item.toggle_url', nextToggleURL],
    ['status_item.toggle_track', surface.track],
  ];
  for (const [key, value] of values) requireSuccess(runAos(['config', 'set', key, value]), `set ${key}`);
  if (previousToggleID === surface.id && previousToggleURL && previousToggleURL !== nextToggleURL) {
    const remove = runAos(['show', 'remove', '--id', surface.id], { timeout: 10000 });
    steps.push({
      id: `status-item:stale-target:${surface.id}`,
      status: remove.status === 0 ? 'success' : 'skipped',
      previous_url: previousToggleURL,
      current_url: nextToggleURL,
      action: remove.status === 0 ? 'removed-canvas' : 'canvas-not-present-or-daemon-unavailable',
    });
  }
  steps.push({ id: 'status-item', status: 'success', mode: 'experience', label: manifest.status_item.label });
}

function runHooks(manifest, phase, roots, steps) {
  const rootsByID = rootMap(roots);
  for (const hook of manifest.hooks || []) {
    if (hook.phase !== phase) continue;
    const scriptPath = resolveRepoPath(hook.script, 'hook.script');
    const argv = (hook.argv || []).map((arg) => template(arg, rootsByID));
    requireSuccess(run(scriptPath, argv, { cwd: repoRoot }), `hook ${hook.script}`);
    steps.push({ id: `hook:${phase}:${hook.script}`, status: 'success', argv });
  }
}

function activate(id, asJSON, dryRun, allowStart) {
  const manifest = discoverExperience(id);
  const roots = resolveContentRoots(manifest);
  const planned = plan(manifest, roots, dryRun);
  if (dryRun) {
    if (asJSON) emitJSON({ status: 'dry_run', code: 'OK', ...planned });
    else process.stdout.write(`dry-run activate experience ${id}: ${manifest.default_activation.kind}\n`);
    return;
  }
  const steps = [];
  requireLivePermission('experience.activate', allowStart);
  ensureContentRoots(roots, steps, allowStart);
  runHooks(manifest, 'before_activate', roots, steps);
  configureStatusItem(manifest, roots, steps);
  writeActiveExperience(manifest.id);
  steps.push({ id: 'experience:active', status: 'success', active_experience: manifest.id, exclusive: true });
  runHooks(manifest, 'after_activate', roots, steps);
  if (asJSON) emitJSON({ status: 'success', code: 'OK', ...planned, active_experience: manifest.id, steps });
  else process.stdout.write(`${manifest.title} experience active.\n`);
}

function deactivate(asJSON, dryRun) {
  const activeID = readActiveExperience();
  const planned = {
    mode,
    dry_run: dryRun,
    active_experience: activeID,
    next_active_experience: null,
    vanilla_fallback: vanillaFallback(),
    status_item: {
      enabled: false,
      label: 'AOS',
      icon: 'aos',
      menu: [],
      note: 'vanilla status-item menu is not implemented yet; status item disabled',
    },
  };
  if (dryRun) {
    if (asJSON) emitJSON({ status: 'dry_run', code: 'OK', ...planned });
    else process.stdout.write('dry-run deactivate experience: disable status item\n');
    return;
  }
  const manifest = findExperience(activeID);
  const roots = manifest ? resolveContentRoots(manifest) : [];
  const steps = [];
  if (manifest) runHooks(manifest, 'before_deactivate', roots, steps);
  const values = [
    ['status_item.enabled', 'false'],
    ['status_item.toggle_id', 'status-item-canvas'],
    ['status_item.toggle_url', ''],
    ['status_item.toggle_track', 'none'],
    ['status_item.icon', 'aos'],
  ];
  for (const [key, value] of values) requireSuccess(runAos(['config', 'set', key, value]), `set ${key}`);
  writeActiveExperience(null);
  steps.push({ id: 'experience:inactive', status: 'success' }, { id: 'status-item', status: 'success', mode: 'disabled' });
  if (manifest) runHooks(manifest, 'after_deactivate', roots, steps);
  if (asJSON) emitJSON({ status: 'success', code: 'OK', ...planned, active_experience: null, steps });
  else process.stdout.write('active experience cleared; status item disabled until vanilla menu is implemented.\n');
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.subcommand === 'status') status(args.json);
  else if (args.subcommand === 'activate') activate(args.id, args.json, args.dryRun, args.allowStart);
  else deactivate(args.json, args.dryRun);
} catch (err) {
  if (err instanceof ExperienceFailure) fail(err.message, err.code);
  fail(err?.message || String(err), 'INTERNAL');
}
