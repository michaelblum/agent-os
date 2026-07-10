#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { guardedLiveOperation } from './lib/aos-live-operation.mjs';
import {
  branchScopedContentRootsEnabled,
  scopedRootName,
} from './lib/experience-manifest.mjs';

class LaunchFailure extends Error {
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
  throw new LaunchFailure(`${summary}: ${result.stderr || result.stdout}`.trim(), 'COMMAND_FAILED');
}

function parseArgs(argv) {
  let json = false;
  let dryRun = false;
  let allowStart = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--allow-start') allowStart = true;
    else if (arg.startsWith('--')) throw new LaunchFailure(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    else positional.push(arg);
  }
  const [app, entry, ...extra] = positional;
  if (!app) throw new LaunchFailure('Usage: aos launch <app> [entry] [--json] [--dry-run]', 'MISSING_ARG');
  if (extra.length) throw new LaunchFailure(`Unexpected argument: ${extra[0]}`, 'UNKNOWN_ARG');
  return { app, entry, json, dryRun, allowStart };
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new LaunchFailure(`Could not read ${file}: ${err.message}`, 'APP_MANIFEST_READ_FAILED');
  }
}

function discoverManifest(appID) {
  const appDir = path.join(repoRoot, 'apps', appID);
  const manifestPath = path.join(appDir, 'aos-app.json');
  if (!fs.existsSync(manifestPath)) throw new LaunchFailure(`App manifest not found: apps/${appID}/aos-app.json`, 'APP_NOT_FOUND');
  return { appDir, manifestPath, manifest: readJSON(manifestPath) };
}

function validateManifest(manifest, manifestPath) {
  const required = ['schema_version', 'id', 'title', 'version', 'default_entry', 'content_roots', 'entries'];
  for (const key of required) {
    if (!(key in manifest)) throw new LaunchFailure(`App manifest missing ${key}: ${manifestPath}`, 'INVALID_APP_MANIFEST');
  }
  if (manifest.schema_version !== 0) throw new LaunchFailure(`Unsupported app manifest schema_version: ${manifest.schema_version}`, 'INVALID_APP_MANIFEST');
  if (!Array.isArray(manifest.content_roots) || !manifest.content_roots.length) {
    throw new LaunchFailure(`App manifest must declare content_roots: ${manifestPath}`, 'INVALID_APP_MANIFEST');
  }
  if (!manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) {
    throw new LaunchFailure(`App manifest must declare entries: ${manifestPath}`, 'INVALID_APP_MANIFEST');
  }
  if (!manifest.entries[manifest.default_entry]) {
    throw new LaunchFailure(`Default entry not found: ${manifest.default_entry}`, 'INVALID_APP_MANIFEST');
  }
}

function resolveRepoPath(relPath, fieldName) {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)) {
    throw new LaunchFailure(`${fieldName} must be a repo-relative path`, 'INVALID_APP_MANIFEST');
  }
  const resolved = path.resolve(repoRoot, relPath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new LaunchFailure(`${fieldName} must stay under the repo: ${relPath}`, 'INVALID_APP_MANIFEST');
  }
  return resolved;
}

function resolveContentRoots(manifest) {
  const useBranchScopedRoots = branchScopedContentRootsEnabled(process.env);
  return manifest.content_roots.map((root) => {
    if (!root.id || !root.path) throw new LaunchFailure('content_roots entries require id and path', 'INVALID_APP_MANIFEST');
    const declaredBranchScoped = root.branch_scoped !== false;
    const activeBranchScoped = useBranchScopedRoots && declaredBranchScoped;
    return {
      id: root.id,
      key: activeBranchScoped ? scopedRootName(root.id, repoRoot) : root.id,
      path: resolveRepoPath(root.path, `content_roots.${root.id}.path`),
      branch_scoped: activeBranchScoped,
      declared_branch_scoped: declaredBranchScoped,
    };
  });
}

function rootMap(roots) {
  return Object.fromEntries(roots.map((root) => [root.id, root]));
}

function urlencode(value) {
  return encodeURIComponent(value);
}

function template(value, context) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{root:([A-Za-z0-9_-]+)\}/g, (_, id) => {
      const root = context.rootsByID[id];
      if (!root) throw new LaunchFailure(`Unknown content root template: ${id}`, 'INVALID_APP_MANIFEST');
      return root.key;
    })
    .replace(/\$\{repo_root\}/g, repoRoot)
    .replace(/\$\{mode\}/g, mode)
    .replace(/\$\{surface_home_x\}/g, String(surfaceHome().x))
    .replace(/\$\{surface_home_y\}/g, String(surfaceHome().y))
    .replace(/\$\{env:([A-Za-z0-9_]+):([^}]+)\}/g, (_, name, fallback) => process.env[name] || template(fallback, context))
    .replace(/\$\{urlenv:([A-Za-z0-9_]+):([^}]+)\}/g, (_, name, fallback) => urlencode(process.env[name] || template(fallback, context)));
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

function requireLivePermission(operationId, allowStart) {
  const guarded = guardedLiveOperation({ operationId, allowStart, mode, prefix: aos });
  if (!guarded.ok) {
    emitJSON(guarded.failure, true);
    process.exit(1);
  }
  return guarded.preflight;
}

function ensureContentRoots(roots, steps, allowStart) {
  for (const root of roots) {
    requireSuccess(runAos(['set', `content.roots.${root.key}`, root.path]), `set content root ${root.key}`);
    steps.push({ id: `content-root:${root.key}`, status: 'success', path: root.path });
  }
  if (!rootsLive(roots)) {
    requireLivePermission('launch.content-roots', allowStart);
    runAos(['service', 'restart', '--mode', mode]);
    steps.push({ id: 'service:restart', status: 'success', reason: 'content-roots-not-live' });
  }
  const args = ['content', 'wait'];
  for (const root of roots) args.push('--root', root.key);
  args.push('--auto-start', '--allow-start', '--timeout', '15s');
  requireSuccess(runAos(args), 'wait for content roots');
  steps.push({ id: 'content:wait', status: 'success', roots: roots.map((root) => root.key) });
}

function configureStatusItem(manifest, entries, rootsByID, steps) {
  const item = manifest.status_item;
  if (!item) return;
  const toggleEntry = entries[item.toggle_entry];
  const toggleSurface = toggleEntry?.surfaces?.[0];
  if (!toggleSurface) throw new LaunchFailure(`status_item.toggle_entry has no surface: ${item.toggle_entry}`, 'INVALID_APP_MANIFEST');
  const context = { rootsByID };
  const values = [
    ['status_item.enabled', String(Boolean(item.enabled))],
    ['status_item.toggle_id', template(toggleSurface.id, context)],
    ['status_item.toggle_url', template(toggleSurface.url, context)],
  ];
  if (item.toggle_track) values.push(['status_item.toggle_track', item.toggle_track]);
  for (const [key, value] of values) {
    requireSuccess(runAos(['set', key, value]), `set ${key}`);
  }
  steps.push({ id: 'status-item', status: 'success', toggle_entry: item.toggle_entry });
}

function displayPayload() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = runAos(['graph', 'displays'], { timeout: 2000 });
    if (result.status === 0) {
      try {
        const parsed = JSON.parse(result.stdout);
        if (displaysFromPayload(parsed).length) return parsed;
      } catch {
        // Retry below; display graph can lag daemon startup in isolated tests.
      }
    }
    spawnSync('/bin/sleep', ['0.1']);
  }
  return { displays: [] };
}

function displaysFromPayload(raw) {
  if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') return raw.data.displays || [];
  if (raw && typeof raw === 'object') return raw.displays || (Array.isArray(raw) ? raw : []);
  return [];
}

function mainBounds() {
  const displays = displaysFromPayload(displayPayload());
  const main = displays.find((display) => display.is_main) || displays[0];
  return main?.visible_bounds || main?.visibleBounds || main?.bounds || null;
}

function frameFor(kind) {
  const bounds = mainBounds();
  if (!bounds) return kind === 'agent_terminal' ? '240,180,860,560' : '120,120,960,720';
  if (kind === 'agent_terminal') {
    const w = Math.min(940, Math.max(720, Math.round(bounds.w - 240)));
    const h = Math.min(720, Math.max(480, Math.round(bounds.h - 180)));
    const x = Math.round(bounds.x + Math.min(120, Math.max(28, bounds.w - w - 28)));
    const y = Math.round(bounds.y + Math.min(90, Math.max(28, bounds.h - h - 28)));
    return `${x},${y},${w},${h}`;
  }
  const marginX = 32;
  const marginY = 28;
  const usableW = Math.max(480, Number(bounds.w) - marginX * 2);
  const usableH = Math.max(360, Number(bounds.h) - marginY * 2);
  const w = Math.max(480, Math.round((usableW * 2) / 3));
  const h = usableH;
  const x = Number(bounds.x) + Number(bounds.w) - marginX - w;
  const y = Number(bounds.y) + marginY;
  return `${x},${y},${w},${h}`;
}

function surfaceHome() {
  const bounds = mainBounds();
  if (!bounds) return { x: 240, y: 180 };
  return { x: Number(bounds.x) + Number(bounds.w) / 6, y: Number(bounds.y) + Number(bounds.h) / 6 };
}

function surfaceExists(id) {
  const result = runAos(['show', 'exists', '--id', id, '--json']);
  if (result.status !== 0) return false;
  try {
    return JSON.parse(result.stdout).exists === true;
  } catch {
    return false;
  }
}

function removeSurfaces(ids, steps) {
  for (const id of ids || []) {
    runAos(['show', 'remove', '--id', id]);
    const deadline = Date.now() + 5000;
    while (surfaceExists(id) && Date.now() < deadline) {
      spawnSync('/bin/sleep', ['0.1']);
    }
    if (surfaceExists(id)) {
      throw new LaunchFailure(`Timed out waiting for removed surface to disappear: ${id}`, 'SURFACE_REMOVE_TIMEOUT');
    }
    steps.push({ id: `surface:remove:${id}`, status: 'success' });
  }
}

function runHooks(entry, phase, context, steps) {
  for (const hook of entry.hooks || []) {
    if (hook.phase !== phase) continue;
    const scriptPath = resolveRepoPath(hook.script, `hook.script`);
    const argv = (hook.argv || []).map((arg) => template(arg, context));
    requireSuccess(run(scriptPath, argv, { cwd: repoRoot }), `hook ${hook.script}`);
    steps.push({ id: `hook:${phase}:${hook.script}`, status: 'success', argv });
  }
}

function createSurface(surface, context, steps) {
  const id = template(surface.id, context);
  if (surface.create_if_missing && surfaceExists(id)) {
    steps.push({ id: `surface:${id}`, status: 'exists' });
    return;
  }
  const args = ['show', 'create', '--id', id, '--url', template(surface.url, context)];
  if (surface.frame?.kind) args.push('--at', frameFor(surface.frame.kind));
  if (surface.track) args.push('--track', surface.track);
  if (surface.interactive) args.push('--interactive');
  if (surface.focus) args.push('--focus');
  requireSuccess(runAos(args), `create surface ${id}`);
  if (!surfaceExists(id)) {
    spawnSync('/bin/sleep', ['0.2']);
    if (!surfaceExists(id)) {
      requireSuccess(runAos(args), `retry create surface ${id}`);
    }
  }
  steps.push({ id: `surface:create:${id}`, status: 'success' });
}

function waitSurface(surface, context, steps) {
  if (!surface.wait_js) return;
  const id = template(surface.id, context);
  requireSuccess(
    runAos(['show', 'wait', '--id', id, '--js', surface.wait_js, '--timeout', surface.wait_timeout || '5s']),
    `wait for surface ${id}`,
  );
  steps.push({ id: `surface:wait:${id}`, status: 'success' });
}

function postLaunch(action, context, steps) {
  if (action.kind === 'show_eval') {
    const id = template(action.surface, context);
    const js = template(action.js || '', context);
    const success = action.success_match || '';
    const retries = action.retries || 1;
    const delay = String((action.retry_delay_ms || 0) / 1000);
    for (let index = 0; index < retries; index += 1) {
      const result = runAos(['show', 'eval', '--id', id, '--js', js]);
      if (!success || result.stdout.includes(success)) {
        steps.push({ id: `post:show-eval:${id}`, status: 'success' });
        return;
      }
      if (index + 1 < retries && delay !== '0') spawnSync('/bin/sleep', [delay]);
    }
    steps.push({ id: `post:show-eval:${id}`, status: 'warning', warning: 'show eval success_match timed out' });
    return;
  }
  if (action.kind === 'show_post') {
    const id = template(action.surface, context);
    requireSuccess(runAos(['show', 'post', '--id', id, '--event', JSON.stringify(action.event || {})]), `post to ${id}`);
    steps.push({ id: `post:show:${id}`, status: 'success' });
    return;
  }
  throw new LaunchFailure(`Unsupported post_launch kind: ${action.kind}`, 'INVALID_APP_MANIFEST');
}

function entryClosure(entries, entryName, seen = new Set()) {
  if (seen.has(entryName)) return [];
  const entry = entries[entryName];
  if (!entry) throw new LaunchFailure(`Unknown launch entry: ${entryName}`, 'UNKNOWN_ENTRY');
  seen.add(entryName);
  const required = (entry.requires_entries || []).flatMap((name) => entryClosure(entries, name, seen));
  return [...required, entryName];
}

function plan(manifest, entryName, roots) {
  const entries = entryClosure(manifest.entries, entryName);
  return {
    app: { id: manifest.id, title: manifest.title, version: manifest.version },
    entry: entryName,
    mode,
    dry_run: true,
    content_roots: roots,
    status_item: manifest.status_item || null,
    entries,
  };
}

function launch(manifest, entryName, roots, asJSON, dryRun, allowStart) {
  const rootsByID = rootMap(roots);
  const entriesToRun = entryClosure(manifest.entries, entryName);
  const planned = plan(manifest, entryName, roots);
  if (dryRun) {
    if (asJSON) emitJSON({ status: 'dry_run', code: 'OK', ...planned });
    else process.stdout.write(`dry-run launch ${manifest.id} ${entryName}: ${entriesToRun.length} entr${entriesToRun.length === 1 ? 'y' : 'ies'}\n`);
    return;
  }

  const steps = [];
  const context = { rootsByID };
  requireLivePermission('launch.activate', allowStart);
  ensureContentRoots(roots, steps, allowStart);
  configureStatusItem(manifest, manifest.entries, rootsByID, steps);
  requireSuccess(runAos(['service', 'start', '--mode', mode]), 'start service');
  steps.push({ id: 'service:start', status: 'success' });

  for (const name of entriesToRun) {
    const entry = manifest.entries[name];
    runHooks(entry, 'before_surfaces', context, steps);
    removeSurfaces(entry.remove_surfaces, steps);
    for (const surface of entry.surfaces || []) createSurface(surface, context, steps);
    for (const surface of entry.surfaces || []) waitSurface(surface, context, steps);
    for (const action of entry.post_launch || []) postLaunch(action, context, steps);
    runHooks(entry, 'after_surfaces', context, steps);
  }

  const result = { status: 'success', code: 'OK', app: planned.app, entry: entryName, mode, dry_run: false, content_roots: roots, steps };
  if (asJSON) emitJSON(result);
  else {
    process.stdout.write(`${manifest.title} ${entryName} launched.\n`);
    for (const name of entriesToRun) {
      for (const surface of manifest.entries[name].surfaces || []) process.stdout.write(`  surface: ${template(surface.id, context)}\n`);
    }
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const { manifestPath, manifest } = discoverManifest(args.app);
  validateManifest(manifest, manifestPath);
  if (manifest.id !== args.app) throw new LaunchFailure(`Manifest id ${manifest.id} does not match app ${args.app}`, 'INVALID_APP_MANIFEST');
  const entry = args.entry || manifest.default_entry;
  if (!manifest.entries[entry]) throw new LaunchFailure(`Unknown launch entry: ${entry}`, 'UNKNOWN_ENTRY');
  const roots = resolveContentRoots(manifest);
  launch(manifest, entry, roots, args.json, args.dryRun, args.allowStart);
} catch (err) {
  if (err instanceof LaunchFailure || err?.code) fail(err.message, err.code);
  fail(err?.message || String(err), 'INTERNAL');
}
