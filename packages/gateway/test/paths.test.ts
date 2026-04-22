import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { commonPaths, mcpPaths, brokerPaths } from '../src/paths.js';

test('commonPaths: repo mode defaults to ~/.config/aos/repo/gateway', () => {
  const p = commonPaths('repo', {});
  assert.equal(p.stateDir, join(homedir(), '.config', 'aos', 'repo', 'gateway'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
  assert.equal(p.scriptsDir, join(p.stateDir, 'scripts'));
});

test('commonPaths: installed mode defaults to ~/.config/aos/installed/gateway', () => {
  const p = commonPaths('installed', {});
  assert.equal(p.stateDir, join(homedir(), '.config', 'aos', 'installed', 'gateway'));
});

test('commonPaths: AOS_STATE_ROOT shifts root', () => {
  const p = commonPaths('repo', { AOS_STATE_ROOT: '/tmp/x' });
  assert.equal(p.stateDir, join('/tmp/x', 'repo', 'gateway'));
});

test('mcpPaths: adds socket, gateway.pid, gateway.log inside stateDir', () => {
  const p = mcpPaths('repo', {});
  assert.equal(p.socketPath, join(p.stateDir, 'sdk.sock'));
  assert.equal(p.pidPath, join(p.stateDir, 'gateway.pid'));
  assert.equal(p.logPath, join(p.stateDir, 'gateway.log'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
});

test('brokerPaths: adds broker.pid, broker.log; no socketPath', () => {
  const p = brokerPaths('repo', {});
  assert.equal(p.pidPath, join(p.stateDir, 'broker.pid'));
  assert.equal(p.logPath, join(p.stateDir, 'broker.log'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
  assert.equal((p as any).socketPath, undefined);
});

test('shared db path across roles', () => {
  const a = mcpPaths('repo', {});
  const b = brokerPaths('repo', {});
  assert.equal(a.dbPath, b.dbPath);
  assert.equal(a.scriptsDir, b.scriptsDir);
  assert.equal(a.stateDir, b.stateDir);
});

test('distinct pidfile paths across roles', () => {
  const a = mcpPaths('repo', {});
  const b = brokerPaths('repo', {});
  assert.notEqual(a.pidPath, b.pidPath);
  assert.notEqual(a.logPath, b.logPath);
});
