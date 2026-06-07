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

test('status item menu is a native shell over external descriptors and actions', () => {
  const statusItem = source('src/display/status-item.swift');
  const canvas = source('src/display/canvas.swift');
  const hostRuntime = source('apps/sigil/renderer/live-modules/host-runtime.js');
  const main = source('apps/sigil/renderer/live-modules/main.js');

  assert.match(statusItem, /StatusItemMenuDescriptor/);
  assert.match(statusItem, /statusMenuItems/);
  assert.match(statusItem, /#selector\(menuExternalItem\(_:?\)\)/);
  assert.match(statusItem, /"type": "status_item\.menu_action"/);
  assert.match(statusItem, /primePersistentCanvas\(reason: "setup"\)/);
  assert.match(statusItem, /primePersistentCanvas\(reason: "config"\)/);
  assert.match(canvas, /payload\?\["items"\]/);
  assert.match(hostRuntime, /setStatusMenuItems\(items = \[\]\)/);
  assert.match(main, /function publishStatusMenuItems\(\)/);
  assert.match(main, /status_item\.menu_action/);
  assert.match(main, /function reloadFromStatusMenu\(\)/);
  assert.match(main, /window\.location\.reload\(\)/);
  assert.doesNotMatch(statusItem, /NSMenuItem\(title: "Reload"/);
  assert.doesNotMatch(statusItem, /NSMenuItem\(title: "Remove"/);
  assert.doesNotMatch(statusItem, /NSMenuItem\(title: "Console Log"/);
  assert.doesNotMatch(statusItem, /NSMenuItem\(title: "Surface Inspector"/);
  assert.doesNotMatch(statusItem, /#selector\(menuReload\)/);
  assert.doesNotMatch(statusItem, /private func reloadCanvas\(\)/);
  assert.doesNotMatch(statusItem, /removeCanvasDescendants\(toggleId\)/);
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
