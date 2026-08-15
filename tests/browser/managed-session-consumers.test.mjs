import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseManagedBrowserTarget, requireSessionOnlyTarget } from '../../scripts/lib/browser-companion/session-target.mjs';
import { repoRoot } from './managed-runtime-test-fixture.mjs';

function runNode(relative, args) {
  return spawnSync(process.execPath, [path.join(repoRoot, relative), ...args], {
    cwd: repoRoot, encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, AOS_STATE_ROOT: path.join(repoRoot, '.nonexistent-managed-session-test-state') },
  });
}

test('target grammar requires an explicit managed session and session-only consumers reject refs', () => {
  assert.deepEqual(parseManagedBrowserTarget('browser:todo'), { session: 'todo', ref: null });
  assert.deepEqual(parseManagedBrowserTarget('browser:todo/e2'), { session: 'todo', ref: 'e2' });
  assert.throws(() => parseManagedBrowserTarget('browser:'), (error) => error.code === 'BROWSER_SESSION_INVALID');
  assert.throws(() => requireSessionOnlyTarget('browser:todo/e2'), (error) => error.code === 'BROWSER_SESSION_OPERATION_UNSUPPORTED');
  assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'scripts/lib/browser-companion/session-target.mjs'), 'utf8'), /PLAYWRIGHT_CLI_SESSION/u);
});

test('browser ref actions fail before managed worker dispatch and anchor route is absent', () => {
  for (const [script, args] of [
    ['scripts/aos-do-browser.mjs', ['fill', 'browser:todo/e2', 'secret']],
    ['scripts/aos-do-browser.mjs', ['click', 'browser:todo/e2']],
  ]) {
    const result = runNode(script, args);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /TARGET_ACTION_UNSUPPORTED/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /playwright-cli\.js|node_modules|https?:/u);
  }
  const anchor = runNode('scripts/aos-browser-internal.mjs', ['_resolve-anchor', 'browser:todo', '--json']);
  assert.equal(anchor.status, 1);
  assert.match(anchor.stderr, /UNKNOWN_SUBCOMMAND/u);
});

test('extension attach grammar admits only the reviewed chrome channel value', () => {
  for (const args of [
    ['focus', 'create', '--id', 'bridge', '--target', 'browser://attach', '--extension'],
    ['focus', 'create', '--id', 'bridge', '--target', 'browser://attach', '--extension=firefox'],
    ['focus', 'create', '--id', 'bridge', '--target', 'browser://attach', '--extension=chrome', '--cdp', 'http://127.0.0.1:9222'],
    ['focus', 'create', '--id', 'bridge', '--target', 'browser://attach', '--extension=chrome', '--headless'],
    ['focus', 'create', '--id', 'bridge', '--target', 'browser://attach', '--cdp', 'http://127.0.0.1:9222', '--persistent'],
  ]) {
    const result = runNode('scripts/aos-focus-graph.mjs', args);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /MISSING_ARG|INVALID_ARG/u);
  }
});

test('focus browser target grammar is literal and removal requires an exact backend', () => {
  for (const target of ['browser://NEW', 'browser://new/', 'browser://new?mode=1', 'browser://attach:9222']) {
    const result = runNode('scripts/aos-focus-graph.mjs', ['focus', 'create', '--id', 'literal', '--target', target]);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /INVALID_ARG/u);
  }
  const missing = runNode('scripts/aos-focus-graph.mjs', ['focus', 'remove', '--id', 'literal']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /MISSING_ARG/u);
});

test('all maintained consumers reference managed authority and retired resolver surfaces are absent', () => {
  const required = new Map([
    ['scripts/aos-focus-graph.mjs', /createManagedSession/u],
    ['scripts/aos-do-browser.mjs', /executeManagedSessionOperation/u],
    ['scripts/aos-see-native.mjs', /managedSessionIdentity/u],
    ['scripts/lib/agent-workspace/browser-identity.mjs', /executeManagedSessionOperation/u],
    ['src/browser/browser-adapter.swift', /managedBrowserBrokerRequest/u],
  ]);
  for (const [relative, pattern] of required) assert.match(fs.readFileSync(path.join(repoRoot, relative), 'utf8'), pattern, relative);
  for (const relative of [
    'scripts/lib/playwright-cli-runtime.mjs', 'scripts/aos-browser-resolve-runtime.mjs',
    'scripts/aos-browser-check-version', 'scripts/aos-playwright-cli',
    'src/browser/playwright-process.swift', 'src/browser/playwright-version-check.swift',
    'src/browser/session-registry.swift', 'src/browser/window-resolver.swift',
    'src/browser/anchor-resolver.swift', 'src/browser/eval-result-parser.swift',
    'scripts/lib/browser-companion/dom-query.mjs',
  ]) assert.equal(fs.existsSync(path.join(repoRoot, relative)), false, relative);
});

test('source manifests expose no generic runner, registry, version probe, or upstream list route', () => {
  const internal = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/commands/source/aos/33-browser.json'), 'utf8'));
  const external = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/commands/source/external/22-browser.json'), 'utf8'));
  const tokens = new Set([
    ...internal.commands.flatMap((command) => command.forms.flatMap((form) => [form.id, ...form.usage.split(/\s+/u)])),
    ...external.commands.flatMap((command) => [...command.path, ...command.argv_prefix]),
  ]);
  for (const forbidden of ['_run', '_registry', '_check-version', '_resolve-anchor', '_bounds', '_window-geometry', 'run-code', 'tab-new', 'tab-list']) assert.equal(tokens.has(forbidden), false, forbidden);
  assert.ok(internal.commands[0].forms.some((form) => form.id === 'browser-identity'));
  assert.ok(external.commands.every((command) => command.argv_prefix[1]?.startsWith('$AOS_REPO_ROOT/scripts/')));
});
