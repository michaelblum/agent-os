import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const componentDir = new URL('../../packages/toolkit/components/agent-terminal/', import.meta.url);
const html = readFileSync(new URL('index.html', componentDir), 'utf8');
const launcher = readFileSync(new URL('launch.sh', componentDir), 'utf8');
const bridgeServer = readFileSync(new URL('bridge-server.mjs', componentDir), 'utf8');

test('Agent Terminal is a neutral toolkit panel', () => {
  assert.match(html, /await import\('\.\.\/\.\.\/panel\/index\.js'\)/);
  assert.match(html, /mountChrome\(document\.body/);
  assert.match(html, /createFixedSidebarPane/);
  assert.match(html, /draggable:\s*true/);
  assert.match(html, /minimize:\s*true/);
  assert.match(html, /maximize:\s*true/);
  assert.match(html, /resizable:\s*true/);
  assert.match(html, /const surfaceTitle = 'AOS Agent Terminal'/);
  assert.match(html, /window\.__aosAgentTerminal/);
  assert.doesNotMatch(html, /\bSigil\b|__sigil|avatar_toggle|surface=sigil|avatar-main/i);
});

test('Agent Terminal delegates bridge and terminal behavior to toolkit owners', () => {
  for (const modulePath of [
    './bridge-client.js',
    './session-rail-model.js',
    './session-rail-view.js',
    './session-inspector-view.js',
    './terminal-controller.js',
  ]) {
    assert.match(html, new RegExp(modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(bridgeServer, /createTerminalSessionManager\(\{/);
  assert.match(bridgeServer, /\.\/provider-session-routes\.mjs/);
  assert.match(bridgeServer, /\.\/bridge-observation-routes\.mjs/);
});

test('Agent Terminal launcher owns its bridge and runtime assets', () => {
  assert.match(launcher, /BRIDGE_DIR="\$REPO_ROOT\/packages\/toolkit\/components\/agent-terminal"/);
  assert.match(launcher, /"\$BRIDGE_DIR\/bridge-server\.mjs"/);
  assert.match(launcher, /ensure_runtime_assets\(\)/);
  assert.match(launcher, /components\/agent-terminal\/index\.html/);
  assert.doesNotMatch(launcher, /apps\/sigil|SIGIL_|avatar-main/i);
  assert.ok(existsSync(new URL('package.json', componentDir)));
  assert.ok(existsSync(new URL('package-lock.json', componentDir)));
});
