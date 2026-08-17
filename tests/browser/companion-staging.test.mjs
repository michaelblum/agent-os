import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { externalRouteMatches } from '../../scripts/lib/external-command-routes.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const temporaryRoots = new Set();
const TIMEOUT_MS = 5_000;

function temporaryRoot(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(directory);
  return directory;
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: TIMEOUT_MS, ...options,
  });
}

function resolveRouteValue(value, { aosRoot, callerRoot, env }) {
  if (value === '$AOS_REPO_ROOT') return aosRoot;
  if (value.startsWith('$AOS_REPO_ROOT/')) return path.join(aosRoot, value.slice('$AOS_REPO_ROOT/'.length));
  if (value === '$REPO_ROOT') return callerRoot;
  if (value.startsWith('$REPO_ROOT/')) return path.join(callerRoot, value.slice('$REPO_ROOT/'.length));
  if (value === '$AOS_RUNTIME_MODE') return env.AOS_RUNTIME_MODE;
  if (value === '$AOS_STATE_ROOT') return env.AOS_STATE_ROOT;
  if (value === '$AOS_PATH') return 'aos';
  if (value === '$AOS_INVOCATION_DISPLAY_NAME') return 'aos';
  return value;
}

function runExternalRoute(manifest, args, options) {
  const command = manifest.commands
    .filter((candidate) => externalRouteMatches(candidate, args))
    .sort((left, right) => right.path.length - left.path.length)[0];
  assert.ok(command, `missing route for ${args.join(' ')}`);
  const resolve = (value) => resolveRouteValue(value, options);
  const argv = command.argv_prefix.map(resolve).concat(args.slice(command.path.length));
  const cwd = command.cwd === 'repo' ? options.callerRoot : command.cwd ? resolve(command.cwd) : options.callerRoot;
  const env = { ...options.env };
  for (const [key, value] of Object.entries(command.env ?? {})) env[key] = resolve(value);
  return {
    command,
    argv,
    cwd,
    result: spawnSync(resolve(command.executable), argv, { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS }),
  };
}

after(() => {
  for (const directory of temporaryRoots) fs.rmSync(directory, { recursive: true, force: true });
});

test('CLI errors are content-free and preserve parsed operation attribution', () => {
  const root = temporaryRoot('aos-browser-companion-cli-');
  const env = { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'installed' };
  const cli = path.join(repoRoot, 'scripts/aos-browser-companion.mjs');
  const status = runNode([cli, 'status', '--json'], { cwd: root, env });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).state, 'missing');
  const update = runNode([cli, 'update', '--json'], { cwd: root, env });
  assert.equal(update.status, 1);
  assert.equal(JSON.parse(update.stderr).code, 'COMPANION_UPDATE_MISSING');
  let publicBytes = `${status.stdout}${status.stderr}${update.stdout}${update.stderr}`;
  for (const operation of ['install', 'update', 'uninstall']) {
    const invalid = runNode([cli, operation, '--dry-run', '--json'], { cwd: root, env });
    assert.equal(JSON.parse(invalid.stderr).operation, operation);
    assert.equal(JSON.parse(invalid.stderr).code, 'COMPANION_INVALID_ARGUMENT');
    publicBytes += `${invalid.stdout}${invalid.stderr}`;
  }
  assert.equal(publicBytes.includes(root), false);
  assert.doesNotMatch(publicBytes, /https?:|registry\.npmjs|\.tgz|playwright-cli\.js/u);
});

test('installed projection executes companion help and status from an unrelated caller', () => {
  const staged = temporaryRoot('aos-browser-companion-stage-');
  const caller = temporaryRoot('aos-browser-companion-caller-');
  const state = temporaryRoot('aos-browser-companion-installed-state-');
  const env = {
    ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'installed',
    AOS_DISABLE_DAEMON_AUTOSTART: '1',
  };
  const currentSourceManifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'manifests/commands/aos-external-commands.json'),
    'utf8',
  ));
  const retainedSourceCommand = currentSourceManifest.commands.find(
    (command) => command.path.join(' ') === 'work-record',
  );
  assert.ok(retainedSourceCommand);
  const stagedManifestPath = path.join(staged, 'manifests/commands/aos-external-commands.json');
  fs.mkdirSync(path.dirname(stagedManifestPath), { recursive: true });
  fs.writeFileSync(stagedManifestPath, `${JSON.stringify({
    ...currentSourceManifest,
    commands: [{ ...retainedSourceCommand, summary: 'stale retained object must not survive' }],
  }, null, 2)}\n`);
  const stage = runNode([path.join(repoRoot, 'scripts/stage-browser-companion-runtime.mjs'), staged]);
  assert.equal(stage.status, 0, stage.stderr);
  const manifest = JSON.parse(fs.readFileSync(stagedManifestPath, 'utf8'));
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.commands.length, 22);
  assert.deepEqual(
    manifest.commands.find((command) => command.path.join(' ') === 'work-record'),
    retainedSourceCommand,
  );
  assert.equal(manifest.commands.filter((command) => command.path[0] === 'browser' && command.path[1] === 'companion').length, 5);
  assert.equal(manifest.commands.filter((command) => command.path[0] === 'browser').length, 10);
  assert.equal(manifest.commands.filter((command) => command.path[0] === 'focus').length, 5);
  assert.equal(manifest.commands.filter((command) => command.path.length === 1 && command.path[0] === 'help').length, 1);
  for (const required of [
    'scripts/aos-help-proxy.mjs', 'scripts/lib/external-command-routes.mjs',
    'manifests/commands/aos-commands.json', 'scripts/aos-browser-companion.mjs',
    'scripts/aos-browser-broker.mjs', 'scripts/aos-browser-internal.mjs',
    'scripts/aos-browser-worker-guardian.mjs',
    'scripts/aos-browser-worker-group.mjs',
    'scripts/aos-do-browser.mjs', 'scripts/aos-focus-graph.mjs',
    'scripts/aos-see-native.mjs', 'scripts/aos-agent-workspace.mjs',
    'scripts/browser-evidence-capture.mjs', 'scripts/lib/focus-daemon.mjs',
    'scripts/lib/focus-depth.mjs',
    'scripts/lib/browser-companion/session-lifecycle.mjs',
    'scripts/lib/browser-companion/extension-profile.mjs',
    'scripts/lib/browser-companion/extension-profile-scan.mjs',
    'scripts/lib/browser-companion/package-version.mjs',
    'scripts/lib/browser-companion/see-capture-options.mjs',
    'scripts/lib/browser-companion/worker-protocol.mjs',
    'scripts/lib/browser-companion/worker-guardian-client.mjs',
    'scripts/lib/browser-companion/worker-guardian-state.mjs',
    'scripts/lib/browser-companion/worker-guardian-outcome.mjs',
    'scripts/lib/browser-companion/worker-guardian.mjs',
    'scripts/lib/browser-companion/worker-group-sentinel.mjs',
    'scripts/lib/browser-companion/worker-process-group.mjs',
    'scripts/lib/browser-companion/session-guardian-recovery.mjs',
    'scripts/lib/browser-companion/session-evidence-ack.mjs',
    'scripts/lib/browser-companion/session-evidence-operation.mjs',
    'scripts/lib/browser-companion/session-worker-pending.mjs',
    'scripts/lib/agent-workspace/actions.mjs',
    'scripts/lib/agent-workspace/browser-identity.mjs',
    'scripts/lib/agent-workspace/capture.mjs',
    'scripts/lib/agent-workspace/refs.mjs',
    'scripts/lib/agent-workspace/store.mjs',
    'packages/toolkit/package.json',
    'packages/toolkit/workbench/browser-evidence-capture.js',
    'shared/schemas/aos-browser-session-result-v1.schema.json',
    'shared/schemas/aos-browser-backend-identity-v2.schema.json',
  ]) assert.equal(fs.statSync(path.join(staged, required)).isFile(), true);
  assert.equal(fs.existsSync(path.join(staged, 'scripts/aos-show-client.mjs')), false);
  const registry = JSON.parse(fs.readFileSync(path.join(staged, 'manifests/commands/aos-commands.json'), 'utf8'));
  const installedForms = new Map([
    ['help', ['help-full', 'help-command']],
    ['browser companion', ['browser-companion-status', 'browser-companion-install', 'browser-companion-update', 'browser-companion-uninstall']],
    ['browser', ['browser-parse-target', 'browser-parse-snapshot', 'browser-identity', 'browser-page-identity']],
    ['focus', ['focus-create', 'focus-update', 'focus-list', 'focus-remove']],
    ['do', ['do-scroll-browser', 'do-type-browser', 'do-key-browser', 'do-navigate']],
    ['see', ['see-capture-browser', 'see-capture-browser-save']],
  ]);
  assert.deepEqual(new Set(registry.commands.map((command) => command.path.join(' '))), new Set(installedForms.keys()));
  for (const command of registry.commands) {
    assert.deepEqual(command.forms.map((form) => form.id).sort(), [...installedForms.get(command.path.join(' '))].sort());
  }

  const stagedCLI = path.join(staged, 'scripts/aos-browser-companion.mjs');
  const stagedStatus = runNode([stagedCLI, 'status', '--json'], { cwd: caller, env });
  assert.equal(stagedStatus.status, 0, stagedStatus.stderr);
  assert.equal(JSON.parse(stagedStatus.stdout).state, 'missing');
  const directHelp = runNode([path.join(repoRoot, 'scripts/aos-browser-companion.mjs'), '--help'], { cwd: caller, env });
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/commands/aos-external-commands.json'), 'utf8'));
  const repoHelp = runExternalRoute(sourceManifest, ['help', 'browser', 'companion'], {
    aosRoot: repoRoot, callerRoot: caller, env,
  });
  const stagedHelp = runExternalRoute(manifest, ['help', 'browser', 'companion'], {
    aosRoot: staged, callerRoot: caller, env,
  });
  assert.equal(repoHelp.result.status, 0, repoHelp.result.stderr);
  assert.equal(stagedHelp.result.status, 0, stagedHelp.result.stderr);
  assert.equal(repoHelp.cwd, repoRoot);
  assert.equal(stagedHelp.cwd, staged);
  assert.equal(repoHelp.argv[1], path.join(repoRoot, 'scripts/aos-help-proxy.mjs'));
  assert.equal(stagedHelp.argv[1], path.join(staged, 'scripts/aos-help-proxy.mjs'));
  assert.equal(repoHelp.result.stdout, directHelp.stdout);
  assert.equal(stagedHelp.result.stdout, directHelp.stdout);
  const helpPaths = [
    [], ['browser', 'companion'], ['browser', '_parse-target'], ['browser', '_parse-snapshot'],
    ['browser', '_identity'], ['browser', '_page-identity'], ['focus', 'create'], ['focus', 'update'],
    ['focus', 'list'], ['focus', 'remove'], ['do', 'scroll'], ['do', 'type'],
    ['do', 'key'], ['do', 'navigate'], ['see', 'capture'],
  ];
  for (const helpPath of helpPaths) {
    const routed = runExternalRoute(manifest, ['help', ...helpPath], { aosRoot: staged, callerRoot: caller, env });
    assert.equal(routed.result.status, 0, `${helpPath.join(' ')}: ${routed.result.stderr}`);
    assert.equal(routed.cwd, staged);
    assert.equal(routed.argv[1], path.join(staged, 'scripts/aos-help-proxy.mjs'));
  }
  const parsedTarget = runExternalRoute(manifest, ['browser', '_parse-target', 'browser:todo'], {
    aosRoot: staged, callerRoot: caller, env,
  });
  assert.equal(parsedTarget.result.status, 0, parsedTarget.result.stderr);
  assert.deepEqual(JSON.parse(parsedTarget.result.stdout), { session: 'todo', ref: null });
  assert.equal(parsedTarget.cwd, staged);
  const evidenceHelp = runNode([
    path.join(staged, 'scripts/browser-evidence-capture.mjs'), '--help',
  ], { cwd: caller, env });
  assert.equal(evidenceHelp.status, 0, evidenceHelp.stderr);
  assert.match(evidenceHelp.stdout, /--session <managed-id>/u);
  const focusList = runExternalRoute(manifest, ['focus', 'list'], {
    aosRoot: staged, callerRoot: caller, env,
  });
  assert.equal(focusList.result.status, 0, focusList.result.stderr);
  assert.deepEqual(JSON.parse(focusList.result.stdout), { status: 'ok', channels: [] });
  const workspaceList = runNode([
    path.join(staged, 'scripts/aos-agent-workspace.mjs'), 'workspaces', '--json',
  ], { cwd: caller, env });
  assert.equal(workspaceList.status, 0, workspaceList.stderr);
  assert.deepEqual(JSON.parse(workspaceList.stdout).workspaces, []);
  for (const unsupportedPath of [['do', 'click'], ['do', 'hover'], ['do', 'drag'], ['do', 'fill']]) {
    assert.equal(manifest.commands.some((command) => JSON.stringify(command.path) === JSON.stringify(unsupportedPath)), false);
  }
  for (const args of [
    ['do', 'scroll', 'browser:absent', '0,-1'],
    ['do', 'type', 'browser:absent', 'text'],
    ['do', 'key', 'browser:absent', 'Enter'],
    ['do', 'navigate', 'browser:absent', 'about:blank'],
    ['see', 'capture', 'browser:absent', '--region', '1,2,3,4'],
    ['focus', 'remove', '--id', 'absent'],
  ]) {
    const routed = runExternalRoute(manifest, args, { aosRoot: staged, callerRoot: caller, env });
    assert.equal(routed.result.status, 1, args.join(' '));
    assert.equal(routed.cwd, staged);
    assert.doesNotMatch(routed.result.stderr, /MODULE_NOT_FOUND|missing route/u);
  }
  const dispatcher = fs.readFileSync(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  assert.match(dispatcher, /value\.hasPrefix\("\$AOS_REPO_ROOT\/"\)/u);
  assert.match(dispatcher, /command\.cwd\.map \{ resolveExternalArg/u);
  for (const packageScript of ['scripts/package-aos-runtime', 'package.sh']) {
    assert.match(fs.readFileSync(path.join(repoRoot, packageScript), 'utf8'), /stage-browser-companion-runtime\.mjs/u);
  }
});

test('installed projection rejects a stale staged wire version', () => {
  const staged = temporaryRoot('aos-browser-companion-stale-stage-');
  const manifestPath = path.join(staged, 'manifests/commands/aos-external-commands.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schema_version: 1, commands: [] })}\n`);
  const stage = runNode([path.join(repoRoot, 'scripts/stage-browser-companion-runtime.mjs'), staged]);
  assert.equal(stage.status, 1);
  assert.match(stage.stderr, /external command manifest wire v2 is invalid/u);
});
