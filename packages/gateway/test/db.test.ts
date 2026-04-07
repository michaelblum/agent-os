import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationDB } from '../src/db.js';

let tmpDir: string;
let db: CoordinationDB;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gateway-db-test-'));
  db = new CoordinationDB(join(tmpDir, 'test.db'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe('Sessions', () => {
  test('registerSession creates a session with online status', async () => {
    const session = await db.registerSession('agent-alpha', 'orchestrator', 'node', ['tools']);
    assert.equal(session.name, 'agent-alpha');
    assert.equal(session.role, 'orchestrator');
    assert.equal(session.harness, 'node');
    assert.deepEqual(session.capabilities, ['tools']);
    assert.equal(session.status, 'online');
    assert.ok(typeof session.id === 'string' && session.id.length > 0);
    assert.ok(typeof session.registeredAt === 'string');
    assert.ok(typeof session.lastHeartbeat === 'string');
  });

  test('re-registering same name updates heartbeat, keeps same ID', async () => {
    const first = await db.registerSession('agent-beta', 'worker', 'python');
    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 5));
    const second = await db.registerSession('agent-beta', 'worker', 'python');
    assert.equal(first.id, second.id, 'ID should be stable across re-registration');
    // heartbeat should be updated (or equal — both valid if < 1ms)
    assert.ok(second.lastHeartbeat >= first.lastHeartbeat);
  });

  test('whoIsOnline returns registered sessions', async () => {
    await db.registerSession('agent-gamma', 'worker', 'node');
    const online = await db.whoIsOnline();
    const names = online.map(s => s.name);
    assert.ok(names.includes('agent-alpha'));
    assert.ok(names.includes('agent-beta'));
    assert.ok(names.includes('agent-gamma'));
    online.forEach(s => assert.equal(s.status, 'online'));
  });
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

describe('State — set mode', () => {
  test('unconditional write, version starts at 1', async () => {
    const result = await db.setState('ns:counter', 42, { mode: 'set' });
    assert.equal(result.ok, true);
    assert.equal(result.version, 1);
  });

  test('version bumps on overwrite', async () => {
    await db.setState('ns:bumpy', 'first', { mode: 'set' });
    const result = await db.setState('ns:bumpy', 'second', { mode: 'set' });
    assert.equal(result.ok, true);
    assert.equal(result.version, 2);
  });

  test('set with null deletes the key', async () => {
    await db.setState('ns:todelete', 'exists', { mode: 'set' });
    await db.setState('ns:todelete', null, { mode: 'set' });
    const entries = await db.getState('ns:todelete');
    assert.equal(entries.length, 0);
  });
});

describe('State — cas mode', () => {
  test('succeeds when version matches', async () => {
    await db.setState('ns:cas-key', 'v1', { mode: 'set' });
    const result = await db.setState('ns:cas-key', 'v2', { mode: 'cas', expectedVersion: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.version, 2);
  });

  test('fails with version_mismatch when version does not match', async () => {
    await db.setState('ns:cas-wrong', 'v1', { mode: 'set' });
    const result = await db.setState('ns:cas-wrong', 'v2', { mode: 'cas', expectedVersion: 99 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'version_mismatch');
    assert.ok(typeof result.currentVersion === 'number');
  });
});

describe('State — acquire_lock mode', () => {
  test('succeeds on unowned key', async () => {
    const result = await db.setState('ns:lock-fresh', 'locked', {
      mode: 'acquire_lock',
      owner: 'agent-alpha',
    });
    assert.equal(result.ok, true);
  });

  test('fails with owned_by_other when locked by another session', async () => {
    await db.setState('ns:lock-taken', 'locked', {
      mode: 'acquire_lock',
      owner: 'agent-alpha',
    });
    const result = await db.setState('ns:lock-taken', 'mine', {
      mode: 'acquire_lock',
      owner: 'agent-beta',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'owned_by_other');
    assert.equal(result.currentOwner, 'agent-alpha');
  });
});

describe('State — release_lock mode', () => {
  test('succeeds when caller is owner, clears ownership', async () => {
    await db.setState('ns:to-release', 'locked', {
      mode: 'acquire_lock',
      owner: 'agent-alpha',
    });
    const result = await db.setState('ns:to-release', null, {
      mode: 'release_lock',
      owner: 'agent-alpha',
    });
    assert.equal(result.ok, true);

    // Owner should be cleared
    const entries = await db.getState('ns:to-release');
    if (entries.length > 0) {
      assert.equal(entries[0].owner, undefined);
    }
  });

  test('fails when caller is not the owner', async () => {
    await db.setState('ns:someone-elses-lock', 'locked', {
      mode: 'acquire_lock',
      owner: 'agent-alpha',
    });
    const result = await db.setState('ns:someone-elses-lock', null, {
      mode: 'release_lock',
      owner: 'agent-beta',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_owner');
  });
});

describe('State — getState', () => {
  test('exact key returns array with 0 or 1 entry', async () => {
    await db.setState('exact:key', 'hello', { mode: 'set' });
    const found = await db.getState('exact:key');
    assert.equal(found.length, 1);
    assert.equal(found[0].key, 'exact:key');
    assert.equal(found[0].value, 'hello');

    const missing = await db.getState('exact:nonexistent');
    assert.equal(missing.length, 0);
  });

  test('glob pattern (ns:*) returns matching entries', async () => {
    await db.setState('glob:alpha', 1, { mode: 'set' });
    await db.setState('glob:beta', 2, { mode: 'set' });
    await db.setState('other:gamma', 3, { mode: 'set' });

    const entries = await db.getState('glob:*');
    const keys = entries.map(e => e.key);
    assert.ok(keys.includes('glob:alpha'));
    assert.ok(keys.includes('glob:beta'));
    assert.ok(!keys.includes('other:gamma'));
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe('Messages', () => {
  test('postMessage + readStream: posts to channel, reads back', async () => {
    const id = await db.postMessage('chan:test', { hello: 'world' }, 'agent-alpha');
    assert.ok(typeof id === 'string' && id.length > 0);

    const msgs = await db.readStream('chan:test');
    assert.ok(msgs.length >= 1);
    const msg = msgs.find(m => m.id === id);
    assert.ok(msg, 'posted message should be in stream');
    assert.equal(msg!.channel, 'chan:test');
    assert.equal(msg!.from, 'agent-alpha');
    assert.deepEqual(msg!.payload, { hello: 'world' });
  });

  test('readStream with since cursor returns only messages after cursor', async () => {
    const id1 = await db.postMessage('chan:cursor', 'first', 'agent-alpha');
    const id2 = await db.postMessage('chan:cursor', 'second', 'agent-alpha');
    const id3 = await db.postMessage('chan:cursor', 'third', 'agent-alpha');

    const msgs = await db.readStream('chan:cursor', { since: id1 });
    const ids = msgs.map(m => m.id);
    assert.ok(!ids.includes(id1), 'since cursor should be excluded');
    assert.ok(ids.includes(id2));
    assert.ok(ids.includes(id3));
  });

  test('readStream with limit respects max count', async () => {
    for (let i = 0; i < 5; i++) {
      await db.postMessage('chan:limited', `msg-${i}`, 'agent-alpha');
    }
    const msgs = await db.readStream('chan:limited', { limit: 3 });
    assert.equal(msgs.length, 3);
  });
});
