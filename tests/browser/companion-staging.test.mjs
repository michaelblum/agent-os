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
  const env = { ...process.env, AOS_STATE_ROOT: state, AOS_RUNTIME_MODE: 'installed' };
  const stage = runNode([path.join(repoRoot, 'scripts/stage-browser-companion-runtime.mjs'), staged]);
  assert.equal(stage.status, 0, stage.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, 'manifests/commands/aos-external-commands.json'), 'utf8'));
  assert.equal(manifest.commands.length, 6);
  assert.equal(manifest.commands.filter((command) => command.path[0] === 'browser' && command.path[1] === 'companion').length, 5);
  assert.equal(manifest.commands.filter((command) => command.path.length === 1 && command.path[0] === 'help').length, 1);
  for (const required of [
    'scripts/aos-help-proxy.mjs', 'scripts/lib/external-command-routes.mjs',
    'manifests/commands/aos-commands.json', 'scripts/aos-browser-companion.mjs',
  ]) assert.equal(fs.statSync(path.join(staged, required)).isFile(), true);
  const registry = JSON.parse(fs.readFileSync(path.join(staged, 'manifests/commands/aos-commands.json'), 'utf8'));
  assert.ok(registry.commands.some((command) => command.path.join(' ') === 'browser companion'));

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
  const dispatcher = fs.readFileSync(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  assert.match(dispatcher, /value\.hasPrefix\("\$AOS_REPO_ROOT\/"\)/u);
  assert.match(dispatcher, /command\.cwd\.map \{ resolveExternalArg/u);
  for (const packageScript of ['scripts/package-aos-runtime', 'package.sh']) {
    assert.match(fs.readFileSync(path.join(repoRoot, packageScript), 'utf8'), /stage-browser-companion-runtime\.mjs/u);
  }
});
