import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { collectReport, renderText } from '../src/doctor.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'doc-')); }

function seedShared(stateDir: string) {
  mkdirSync(join(stateDir, 'scripts'), { recursive: true });
  const db = new Database(join(stateDir, 'gateway.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE state (key TEXT PRIMARY KEY, owner TEXT, expires_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE integration_jobs (id TEXT PRIMARY KEY);
  `);
  db.close();
}

test('healthy: both roles alive', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'gateway.log'), '{"ts":"t","level":"info","msg":"m1"}\n{"ts":"t","level":"info","msg":"m2"}\n');
    writeFileSync(join(stateDir, 'broker.log'), '{"ts":"t","level":"info","msg":"b1"}\n');
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, true);
    assert.equal(report.processes.broker.pidfile.alive, true);
    assert.equal(report.processes.mcp.socket!.exists, true);
    assert.ok(report.db.row_counts);
    assert.equal(report.warnings.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mcp up, broker down -> warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, true);
    assert.equal(report.processes.broker.pidfile.pid, null);
    assert.equal(report.processes.broker.pidfile.alive, null);
    assert.ok(report.warnings.some((w) => /broker/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stale pidfile -> alive=false, warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), '999999');
    writeFileSync(join(stateDir, 'broker.pid'), '999998');
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, false);
    assert.equal(report.processes.broker.pidfile.alive, false);
    assert.ok(report.warnings.length >= 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing sdk.sock under mcp block -> warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.socket!.exists, false);
    assert.ok(report.warnings.some((w) => /socket/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('corrupt db -> integrity failure', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    mkdirSync(join(stateDir, 'scripts'), { recursive: true });
    writeFileSync(join(stateDir, 'gateway.db'), 'not-a-db-file');
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.notEqual(report.db.integrity, 'ok');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--quick: db fields omitted', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root }, { quick: true });
    assert.equal(report.db.row_counts, undefined);
    assert.equal(report.db.integrity, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--tail: per-role tail capped at N', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const lines = Array.from({ length: 20 }, (_, i) => `{"ts":"t","level":"info","msg":"m${i}"}`).join('\n') + '\n';
    writeFileSync(join(stateDir, 'gateway.log'), lines);
    writeFileSync(join(stateDir, 'broker.log'), lines);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root }, { tail: 5 });
    assert.ok(report.processes.mcp.log.tail!.length <= 5);
    assert.ok(report.processes.broker.log.tail!.length <= 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('renderText produces non-empty human-readable output', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    const text = renderText(report);
    assert.ok(text.includes('mcp'));
    assert.ok(text.includes('broker'));
    assert.ok(text.includes(stateDir));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
