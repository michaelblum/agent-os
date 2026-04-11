// packages/host/test/session-store.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session-store.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SessionStore', () => {
  let store: SessionStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `host-test-${Date.now()}.db`);
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('sessions', () => {
    it('creates a session with defaults', () => {
      const session = store.createSession({});
      assert.ok(session.id);
      assert.equal(session.provider, 'anthropic');
      assert.equal(session.model, 'claude-sonnet-4-20250514');
      assert.ok(session.createdAt);
      assert.ok(session.updatedAt);
    });

    it('creates a session with custom config', () => {
      const session = store.createSession({
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        system: 'You are a helpful assistant.',
        toolProfile: 'devtools',
      });
      assert.equal(session.model, 'claude-opus-4-20250514');
      assert.equal(session.system, 'You are a helpful assistant.');
      assert.equal(session.toolProfile, 'devtools');
    });

    it('gets a session by id', () => {
      const created = store.createSession({});
      const fetched = store.getSession(created.id);
      assert.deepEqual(fetched, created);
    });

    it('returns undefined for unknown session', () => {
      const fetched = store.getSession('nonexistent');
      assert.equal(fetched, undefined);
    });

    it('lists sessions', () => {
      store.createSession({});
      store.createSession({});
      const sessions = store.listSessions();
      assert.equal(sessions.length, 2);
    });
  });

  describe('messages', () => {
    it('appends and retrieves messages', () => {
      const session = store.createSession({});
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }]);
      store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'hi there' }]);

      const messages = store.getMessages(session.id);
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, 'user');
      assert.equal(messages[1].role, 'assistant');
    });

    it('stores token count when provided', () => {
      const session = store.createSession({});
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }], 10);
      const messages = store.getMessages(session.id);
      assert.equal(messages[0].tokenCount, 10);
    });

    it('returns empty array for session with no messages', () => {
      const session = store.createSession({});
      const messages = store.getMessages(session.id);
      assert.deepEqual(messages, []);
    });

    it('updates session updatedAt on message append', () => {
      const session = store.createSession({});
      const originalUpdatedAt = session.updatedAt;
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }]);
      const updated = store.getSession(session.id)!;
      assert.ok(updated.updatedAt >= originalUpdatedAt);
    });
  });
});
