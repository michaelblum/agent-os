import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { detectMode, stateRoot, hasExplicitStateRootOverride } from '../src/mode.js';

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('detectMode: AOS_RUNTIME_MODE=repo env wins over installed-looking path', () => {
  const installedPath = '/Applications/AOS.app/Contents/Resources/gateway/dist/index.js';
  assert.equal(detectMode(installedPath, { AOS_RUNTIME_MODE: 'repo' }), 'repo');
});

test('detectMode: AOS_RUNTIME_MODE=installed env wins over repo-looking path', () => {
  const repo = makeTmp('mode-repo-');
  try {
    mkdirSync(join(repo, '.git'));
    const pkgDir = join(repo, 'packages', 'gateway');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@agent-os/gateway' }));
    const scriptPath = join(pkgDir, 'dist', 'index.js');
    mkdirSync(join(pkgDir, 'dist'));
    writeFileSync(scriptPath, '');
    assert.equal(detectMode(scriptPath, { AOS_RUNTIME_MODE: 'installed' }), 'installed');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('detectMode: git ancestor with matching package.json -> repo', () => {
  const repo = makeTmp('mode-repo-');
  try {
    mkdirSync(join(repo, '.git'));
    const pkgDir = join(repo, 'packages', 'gateway');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@agent-os/gateway' }));
    mkdirSync(join(pkgDir, 'dist'));
    const scriptPath = join(pkgDir, 'dist', 'index.js');
    writeFileSync(scriptPath, '');
    assert.equal(detectMode(scriptPath, {}), 'repo');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('detectMode: .app/Contents/ in path -> installed', () => {
  const scriptPath = '/Users/x/Applications/AOS.app/Contents/Resources/gateway/dist/index.js';
  assert.equal(detectMode(scriptPath, {}), 'installed');
});

test('detectMode: unknown path + no env -> installed (safe default)', () => {
  assert.equal(detectMode('/some/random/path/index.js', {}), 'installed');
});

test('stateRoot: no override -> ~/.config/aos', () => {
  assert.equal(stateRoot({}), join(homedir(), '.config', 'aos'));
});

test('stateRoot: AOS_STATE_ROOT override resolved', () => {
  assert.equal(stateRoot({ AOS_STATE_ROOT: '/tmp/sandbox' }), '/tmp/sandbox');
});

test('hasExplicitStateRootOverride: unset -> false', () => {
  assert.equal(hasExplicitStateRootOverride({}), false);
});

test('hasExplicitStateRootOverride: empty string -> false', () => {
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: '' }), false);
});

test('hasExplicitStateRootOverride: default absolute path -> false', () => {
  const defaultPath = join(homedir(), '.config', 'aos');
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: defaultPath }), false);
});

test('hasExplicitStateRootOverride: explicit non-default -> true', () => {
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: '/tmp/sandbox' }), true);
});
