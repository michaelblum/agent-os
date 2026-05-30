import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('tracked status-item readiness stays generic with optional surface opt-in hook', () => {
  const statusItem = source('src/display/status-item.swift');

  assert.match(statusItem, /waitUntilPersistentCanvasReady/);
  assert.match(statusItem, /window\.headsup/);
  assert.match(statusItem, /statusItemReady/);
  assert.match(statusItem, /document\.readyState === "interactive"/);
  assert.match(statusItem, /document\.readyState === "complete"/);
  assert.doesNotMatch(statusItem, /__sigilDebug/);
  assert.doesNotMatch(statusItem, /liveJs\?\.avatarPos/);
  assert.doesNotMatch(statusItem, /avatarVisible === true/);
});

test('status item menu exposes a generic reload action for the configured target', () => {
  const statusItem = source('src/display/status-item.swift');

  assert.match(statusItem, /NSMenuItem\(title: "Reload"/);
  assert.match(statusItem, /#selector\(menuReload\)/);
  assert.match(statusItem, /private func reloadCanvas\(\)/);
  assert.match(statusItem, /removeCanvasTree\(toggleId\)/);
  assert.match(statusItem, /waitUntilPersistentCanvasReady\(timeout: visibilityTimeout\)/);
  assert.doesNotMatch(statusItem, /__sigilDebug/);
});

test('Sigil opts into deferred status-item readiness until avatar position is ready', () => {
  const hostRuntime = source('apps/sigil/renderer/live-modules/host-runtime.js');
  const main = source('apps/sigil/renderer/live-modules/main.js');

  assert.match(hostRuntime, /window\.headsup\.statusItemReady = false/);
  assert.match(main, /liveJs\.avatarPos = \{ x: position\.x, y: position\.y, valid: true \}/);
  assert.match(main, /window\.headsup\.statusItemReady = true/);
  const bootReadinessIndex = main.lastIndexOf('window.headsup.statusItemReady = true');
  const bootStatusStateIndex = main.indexOf('emitStatusItemState();', bootReadinessIndex);
  assert.ok(
    bootReadinessIndex >= 0 && bootStatusStateIndex > bootReadinessIndex,
    'Sigil should mark status-item readiness before publishing initial hidden state',
  );
});
