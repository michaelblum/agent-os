import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, migrateFromEnv } from '../src/migrate.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'mig-')); }

function seedLegacy(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gateway.db'), 'fake-db');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'foo.ts'), 'export {};');
}

test('legacy exists, target missing -> move succeeds', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    const result = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(result.migrated, true);
    assert.equal(existsSync(legacy), false);
    assert.ok(existsSync(join(target, 'gateway.db')));
    assert.ok(existsSync(join(target, 'scripts', 'foo.ts')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy exists, target has substantive state -> exit 1 (throws)', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'gateway.db'), 'existing');
    assert.throws(
      () => migrate({ legacyDir: legacy, target, env: {}, exitFn: (code) => { throw new Error('EXIT:' + code); } }),
      /EXIT:1/,
    );
    assert.ok(existsSync(join(legacy, 'gateway.db')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy exists, target is empty mkdir -> move proceeds', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    mkdirSync(target);
    const result = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(result.migrated, true);
    assert.ok(existsSync(join(target, 'gateway.db')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy missing -> no-op', () => {
  const root = makeTmp();
  try {
    const result = migrate({ legacyDir: join(root, 'nope'), target: join(root, 'target'), env: {} });
    assert.equal(result.migrated, false);
    assert.equal(result.skipped, 'no-legacy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('concurrent migrate: second call finds legacy already drained', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    const first = migrate({ legacyDir: legacy, target, env: {} });
    const second = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(first.migrated, true);
    assert.equal(second.migrated, false);
    assert.equal(second.skipped, 'no-legacy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migrateFromEnv with AOS_STATE_ROOT set -> sandbox-safe no-op, never stats legacy', () => {
  const root = makeTmp();
  try {
    const fakeLegacy = join(root, 'never-stat-me');
    const statCalls: string[] = [];
    const result = migrateFromEnv({
      env: { AOS_STATE_ROOT: join(root, 'sandbox') },
      target: join(root, 'sandbox', 'repo', 'gateway'),
      legacyDirOverride: fakeLegacy,
      statFn: (p: string) => { statCalls.push(p); return undefined; },
    });
    assert.equal(result.migrated, false);
    assert.equal(result.skipped, 'explicit-state-root-override');
    assert.deepEqual(statCalls.filter((p) => p.includes('never-stat-me')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
