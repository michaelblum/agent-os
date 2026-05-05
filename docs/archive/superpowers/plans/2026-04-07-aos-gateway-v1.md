# AOS Gateway v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working aos-gateway with MCP server, coordination store, node-subprocess engine, and minimal SDK — enough to prove cross-harness coordination and off-stage script execution.

**Architecture:** A new Node.js package (`packages/gateway/`) exposes 8 MCP tools over stdio. Coordination state lives in SQLite. Scripts execute in Node subprocesses with a pre-loaded `aos-sdk.js` that talks back to the gateway over a persistent Unix socket. The gateway proxies system calls to the `aos` CLI.

**Tech Stack:** Node.js 20+, `@modelcontextprotocol/sdk`, `better-sqlite3`, `esbuild` (TS stripping), `ulid`

---

## v1 Scope

**In scope (this plan):**
- Gateway process with MCP server (stdio transport)
- Coordination tools: `register_session`, `set_state`, `get_state`, `post_message`, `read_stream`
- Execution: `run_os_script` (inline scripts + `script_id`), `save_script`, `list_scripts`
- Node-subprocess engine with TS→JS stripping
- `aos-sdk.js` with: `aos.getWindows`, `aos.click`, `aos.say`, full `aos.coordination.*` namespace
- SQLite-backed coordination store (sessions, state, messages)
- Persistent SDK socket for subprocess ↔ gateway communication
- End-to-end test of the cross-harness coordination scenario

**Deferred (Phase 2+):** See bottom of plan.

---

## File Map

```
packages/gateway/
  package.json                # deps: @modelcontextprotocol/sdk, better-sqlite3, esbuild, ulid
  tsconfig.json               # strict, ESM, outDir: dist/
  src/
    index.ts                  # Entry point: start MCP server + SDK socket
    db.ts                     # SQLite schema init + coordination queries
    tools/
      coordination.ts         # register_session, set_state, get_state, post_message, read_stream
      execution.ts            # run_os_script, save_script, list_scripts
    engine/
      interface.ts            # ScriptEngine, ScriptRequest, ScriptResult types
      router.ts               # EngineRouter: selects engine by intent/config
      node-subprocess.ts      # NodeSubprocessEngine: spawns node, captures result
    sdk-socket.ts             # Persistent Unix socket server for SDK ↔ gateway calls
    aos-proxy.ts              # Proxies SDK system calls to `aos` CLI (spawns process)
    strip-ts.ts               # esbuild-based TS→JS type stripping
    scripts.ts                # Script registry: save/load/list from filesystem
  sdk/
    aos-sdk.js                # Runtime injected into subprocesses (zero npm deps)
    aos-sdk.d.ts              # Type definitions (used by discover_capabilities)
  test/
    db.test.ts                # Coordination store unit tests
    coordination.test.ts      # MCP coordination tool tests
    engine.test.ts            # Node subprocess engine tests
    scripts.test.ts           # Script registry tests
    e2e.test.ts               # End-to-end: two "sessions" coordinating via gateway
```

---

## Task 1: Project Scaffold and Dependencies

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-os/gateway",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "aos-gateway": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test --loader ts-node/esm test/*.test.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.0.0",
    "esbuild": "^0.25.0",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd packages/gateway && npm install`

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/package.json packages/gateway/tsconfig.json packages/gateway/package-lock.json
git commit -m "feat(gateway): scaffold package with deps"
```

---

## Task 2: SQLite Coordination Store

**Files:**
- Create: `packages/gateway/src/db.ts`
- Create: `packages/gateway/test/db.test.ts`

- [ ] **Step 1: Write failing tests for the coordination store**

```typescript
// test/db.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CoordinationDB } from '../src/db.js';
import { unlinkSync } from 'node:fs';

const TEST_DB = '/tmp/aos-gateway-test.db';

describe('CoordinationDB', () => {
  let db: CoordinationDB;

  before(() => { db = new CoordinationDB(TEST_DB); });
  after(() => { db.close(); try { unlinkSync(TEST_DB); } catch {} });

  describe('sessions', () => {
    it('registers a session', () => {
      const s = db.registerSession('lead-dev', 'architecture', 'claude-code', ['file-editing']);
      assert.equal(s.name, 'lead-dev');
      assert.equal(s.status, 'online');
    });

    it('re-registers updates heartbeat', () => {
      const s1 = db.registerSession('lead-dev', 'architecture', 'claude-code');
      const s2 = db.registerSession('lead-dev', 'architecture', 'claude-code');
      assert.equal(s1.id, s2.id);
      assert.ok(s2.lastHeartbeat >= s1.lastHeartbeat);
    });

    it('lists online sessions', () => {
      db.registerSession('a', 'role-a', 'claude-code');
      db.registerSession('b', 'role-b', 'codex');
      const online = db.whoIsOnline();
      assert.ok(online.length >= 2);
    });
  });

  describe('state', () => {
    it('set mode: unconditional write', () => {
      const r = db.setState('key1', { foo: 'bar' }, { mode: 'set' });
      assert.equal(r.ok, true);
      assert.equal(r.version, 1);
    });

    it('set mode: overwrites and bumps version', () => {
      db.setState('key-v', { v: 1 }, { mode: 'set' });
      const r = db.setState('key-v', { v: 2 }, { mode: 'set' });
      assert.equal(r.version, 2);
    });

    it('cas mode: succeeds on matching version', () => {
      db.setState('cas-key', 'initial', { mode: 'set' });
      const r = db.setState('cas-key', 'updated', { mode: 'cas', expectedVersion: 1 });
      assert.equal(r.ok, true);
      assert.equal(r.version, 2);
    });

    it('cas mode: fails on version mismatch', () => {
      db.setState('cas-fail', 'v1', { mode: 'set' });
      const r = db.setState('cas-fail', 'v2', { mode: 'cas', expectedVersion: 99 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'version_mismatch');
    });

    it('acquire_lock: succeeds on unowned key', () => {
      const r = db.setState('lock:file.js', 'locked', { mode: 'acquire_lock', owner: 'dev-a' });
      assert.equal(r.ok, true);
    });

    it('acquire_lock: fails when owned by another', () => {
      db.setState('lock:taken', 'val', { mode: 'acquire_lock', owner: 'dev-a' });
      const r = db.setState('lock:taken', 'val', { mode: 'acquire_lock', owner: 'dev-b' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'owned_by_other');
    });

    it('release_lock: succeeds when caller is owner', () => {
      db.setState('lock:rel', 'val', { mode: 'acquire_lock', owner: 'dev-a' });
      const r = db.setState('lock:rel', null, { mode: 'release_lock', owner: 'dev-a' });
      assert.equal(r.ok, true);
    });

    it('getState: exact key', () => {
      db.setState('exact', { x: 1 }, { mode: 'set' });
      const entries = db.getState('exact');
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].value, { x: 1 });
    });

    it('getState: glob pattern', () => {
      db.setState('ns:a', 1, { mode: 'set' });
      db.setState('ns:b', 2, { mode: 'set' });
      const entries = db.getState('ns:*');
      assert.ok(entries.length >= 2);
    });
  });

  describe('messages', () => {
    it('posts and reads messages', () => {
      const id = db.postMessage('test-chan', { type: 'hello' }, 'sender-a');
      assert.ok(id);
      const msgs = db.readStream('test-chan');
      assert.ok(msgs.some(m => m.id === id));
    });

    it('reads with since cursor', () => {
      const id1 = db.postMessage('cursor-chan', { n: 1 }, 'a');
      const id2 = db.postMessage('cursor-chan', { n: 2 }, 'a');
      const msgs = db.readStream('cursor-chan', { since: id1 });
      assert.ok(msgs.every(m => m.id > id1));
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) db.postMessage('limit-chan', { i }, 'a');
      const msgs = db.readStream('limit-chan', { limit: 3 });
      assert.equal(msgs.length, 3);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/gateway && npm test -- test/db.test.ts`
Expected: FAIL — `CoordinationDB` doesn't exist yet.

- [ ] **Step 3: Implement CoordinationDB**

```typescript
// src/db.ts
import Database from 'better-sqlite3';
import { ulid } from 'ulid';

export interface Session {
  id: string; name: string; role: string; harness: string;
  capabilities: string[]; status: 'online' | 'offline';
  registeredAt: string; lastHeartbeat: string;
}

export interface StateEntry {
  key: string; value: unknown; version: number;
  owner?: string; updatedAt: string; expiresAt?: string;
}

export interface StateResult {
  ok: boolean; version?: number; key?: string;
  reason?: string; currentOwner?: string; currentVersion?: number;
}

export interface SetStateOptions {
  mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
  expectedVersion?: number;
  owner?: string;
  ttl?: number;
}

export interface Message {
  id: string; channel: string; from: string;
  payload: unknown; createdAt: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
    harness TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]',
    registered_at INTEGER NOT NULL, last_heartbeat INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'online'
  );
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, owner TEXT,
    updated_at INTEGER NOT NULL, expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL,
    from_session TEXT NOT NULL, payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);
  CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at) WHERE expires_at IS NOT NULL;
`;

export class CoordinationDB {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  registerSession(name: string, role: string, harness: string, capabilities: string[] = []): Session {
    const now = Date.now();
    const existing = this.db.prepare('SELECT id FROM sessions WHERE name = ?').get(name) as { id: string } | undefined;
    const id = existing?.id ?? ulid();

    this.db.prepare(`
      INSERT INTO sessions (id, name, role, harness, capabilities, registered_at, last_heartbeat, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'online')
      ON CONFLICT(name) DO UPDATE SET role=?, harness=?, capabilities=?, last_heartbeat=?, status='online'
    `).run(id, name, role, harness, JSON.stringify(capabilities), now, now, role, harness, JSON.stringify(capabilities), now);

    return { id, name, role, harness, capabilities, status: 'online',
      registeredAt: new Date(now).toISOString(), lastHeartbeat: new Date(now).toISOString() };
  }

  whoIsOnline(): Session[] {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const rows = this.db.prepare(
      "SELECT * FROM sessions WHERE status = 'online' AND last_heartbeat > ?"
    ).all(fiveMinAgo) as any[];
    return rows.map(r => ({
      id: r.id, name: r.name, role: r.role, harness: r.harness,
      capabilities: JSON.parse(r.capabilities), status: r.status,
      registeredAt: new Date(r.registered_at).toISOString(),
      lastHeartbeat: new Date(r.last_heartbeat).toISOString(),
    }));
  }

  setState(key: string, value: unknown, opts: SetStateOptions = {}): StateResult {
    const mode = opts.mode ?? 'set';
    const now = Date.now();
    const expiresAt = opts.ttl ? now + opts.ttl * 1000 : null;

    if (mode === 'set') {
      if (value === null) {
        this.db.prepare('DELETE FROM state WHERE key = ?').run(key);
        return { ok: true, key };
      }
      const existing = this.db.prepare('SELECT version FROM state WHERE key = ?').get(key) as { version: number } | undefined;
      const newVersion = (existing?.version ?? 0) + 1;
      this.db.prepare(`
        INSERT INTO state (key, value, version, owner, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=?, version=?, owner=?, updated_at=?, expires_at=?
      `).run(key, JSON.stringify(value), newVersion, opts.owner ?? null, now, expiresAt,
             JSON.stringify(value), newVersion, opts.owner ?? null, now, expiresAt);
      return { ok: true, version: newVersion, key };
    }

    if (mode === 'cas') {
      const row = this.db.prepare('SELECT version FROM state WHERE key = ?').get(key) as { version: number } | undefined;
      if (!row || row.version !== opts.expectedVersion) {
        return { ok: false, reason: 'version_mismatch', currentVersion: row?.version };
      }
      const newVersion = row.version + 1;
      this.db.prepare('UPDATE state SET value=?, version=?, updated_at=? WHERE key=?')
        .run(JSON.stringify(value), newVersion, now, key);
      return { ok: true, version: newVersion, key };
    }

    if (mode === 'acquire_lock') {
      const row = this.db.prepare('SELECT owner, expires_at, version FROM state WHERE key = ?').get(key) as
        { owner: string | null; expires_at: number | null; version: number } | undefined;

      const isAvailable = !row || !row.owner || row.owner === opts.owner ||
        (row.expires_at !== null && row.expires_at < now);

      if (!isAvailable) {
        return { ok: false, reason: 'owned_by_other', currentOwner: row!.owner!, currentVersion: row!.version };
      }

      const newVersion = (row?.version ?? 0) + 1;
      this.db.prepare(`
        INSERT INTO state (key, value, version, owner, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=?, version=?, owner=?, updated_at=?, expires_at=?
      `).run(key, JSON.stringify(value), newVersion, opts.owner!, now, expiresAt,
             JSON.stringify(value), newVersion, opts.owner!, now, expiresAt);
      return { ok: true, version: newVersion, key };
    }

    if (mode === 'release_lock') {
      const row = this.db.prepare('SELECT owner, version FROM state WHERE key = ?').get(key) as
        { owner: string | null; version: number } | undefined;
      if (!row || row.owner !== opts.owner) {
        return { ok: false, reason: 'not_owner', currentOwner: row?.owner ?? undefined };
      }
      const newVersion = row.version + 1;
      this.db.prepare('UPDATE state SET owner=NULL, version=?, updated_at=? WHERE key=?')
        .run(newVersion, now, key);
      return { ok: true, version: newVersion, key };
    }

    return { ok: false, reason: 'unknown_mode' };
  }

  getState(keyOrPattern: string): StateEntry[] {
    const now = Date.now();
    const isGlob = keyOrPattern.includes('*');
    let rows: any[];

    if (isGlob) {
      const likePattern = keyOrPattern.replace(/\*/g, '%');
      rows = this.db.prepare(
        'SELECT * FROM state WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?)'
      ).all(likePattern, now);
    } else {
      rows = this.db.prepare(
        'SELECT * FROM state WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)'
      ).all(keyOrPattern, now);
    }

    return rows.map(r => ({
      key: r.key, value: JSON.parse(r.value), version: r.version,
      owner: r.owner ?? undefined,
      updatedAt: new Date(r.updated_at).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : undefined,
    }));
  }

  postMessage(channel: string, payload: unknown, from: string): string {
    const id = ulid();
    const now = Date.now();
    this.db.prepare('INSERT INTO messages (id, channel, from_session, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, channel, from, JSON.stringify(payload), now);
    return id;
  }

  readStream(channel: string, opts?: { since?: string; limit?: number }): Message[] {
    const limit = opts?.limit ?? 50;
    let rows: any[];

    if (opts?.since) {
      rows = this.db.prepare(
        'SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id ASC LIMIT ?'
      ).all(channel, opts.since, limit);
    } else {
      rows = this.db.prepare(
        'SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?'
      ).all(channel, limit).reverse();
    }

    return rows.map(r => ({
      id: r.id, channel: r.channel, from: r.from_session,
      payload: JSON.parse(r.payload),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/gateway && npm test -- test/db.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db.ts packages/gateway/test/db.test.ts
git commit -m "feat(gateway): SQLite coordination store with sessions, state, messages"
```

---

## Task 3: TS Stripping + AOS CLI Proxy

**Files:**
- Create: `packages/gateway/src/strip-ts.ts`
- Create: `packages/gateway/src/aos-proxy.ts`

- [ ] **Step 1: Implement TS stripping**

```typescript
// src/strip-ts.ts
import { transformSync } from 'esbuild';

export function stripTypeAnnotations(source: string): string {
  const result = transformSync(source, { loader: 'ts', target: 'es2022' });
  return result.code;
}
```

- [ ] **Step 2: Implement AOS CLI proxy**

This module shells out to `aos` for perception/action/voice. The gateway resolves the `aos` binary from the repo root (adjacent to `packages/`) or via PATH.

```typescript
// src/aos-proxy.ts
import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findAosBinary(): string {
  // Check repo root (../../aos relative to src/)
  const repoAos = resolve(__dirname, '..', '..', '..', 'aos');
  if (existsSync(repoAos)) return repoAos;
  return 'aos'; // fall back to PATH
}

const AOS_BIN = findAosBinary();

function runAos(args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(AOS_BIN, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`aos ${args.join(' ')} failed: ${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

export async function getWindows(filter?: { app?: string; title?: string }): Promise<unknown[]> {
  const raw = await runAos(['see', 'cursor']);
  // aos see cursor outputs JSON with window list
  try {
    const data = JSON.parse(raw);
    let windows = data.windows ?? [data];
    if (filter?.app) windows = windows.filter((w: any) => w.app?.includes(filter.app));
    if (filter?.title) windows = windows.filter((w: any) => w.title?.includes(filter.title));
    return windows;
  } catch {
    return [{ raw }];
  }
}

export async function click(target: { x: number; y: number }): Promise<void> {
  await runAos(['do', 'click', `${target.x},${target.y}`]);
}

export async function say(text: string): Promise<void> {
  await runAos(['say', text]);
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/strip-ts.ts packages/gateway/src/aos-proxy.ts
git commit -m "feat(gateway): TS stripping via esbuild + aos CLI proxy for system calls"
```

---

## Task 4: SDK Socket Server + SDK Runtime

**Files:**
- Create: `packages/gateway/src/sdk-socket.ts`
- Create: `packages/gateway/sdk/aos-sdk.js`
- Create: `packages/gateway/sdk/aos-sdk.d.ts`

- [ ] **Step 1: Implement the SDK socket server**

The gateway runs a persistent Unix socket. Subprocesses connect and send JSON-RPC requests. The gateway handles coordination calls itself and proxies system calls to `aos`.

```typescript
// src/sdk-socket.ts
import { createServer, Socket } from 'node:net';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CoordinationDB } from './db.js';
import * as aosProxy from './aos-proxy.js';

export interface SDKSocketOptions {
  socketPath: string;
  db: CoordinationDB;
}

export function startSDKSocket(opts: SDKSocketOptions) {
  const { socketPath, db } = opts;
  mkdirSync(dirname(socketPath), { recursive: true });
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((conn: Socket) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        handleRequest(conn, line, db);
      }
    });
  });

  server.listen(socketPath);
  return server;
}

async function handleRequest(conn: Socket, line: string, db: CoordinationDB) {
  let req: { id: string; domain: string; method: string; params: any };
  try { req = JSON.parse(line); } catch { return; }

  let result: unknown;
  try {
    if (req.domain === 'coordination') {
      result = handleCoordination(req.method, req.params, db);
    } else if (req.domain === 'system') {
      result = await handleSystem(req.method, req.params);
    } else {
      result = { error: `Unknown domain: ${req.domain}` };
    }
  } catch (err: any) {
    result = { error: err.message };
  }

  conn.write(JSON.stringify({ id: req.id, result }) + '\n');
}

function handleCoordination(method: string, params: any, db: CoordinationDB): unknown {
  switch (method) {
    case 'register': return db.registerSession(params.name, params.role, params.harness, params.capabilities);
    case 'whoIsOnline': return db.whoIsOnline();
    case 'getState': return db.getState(params.key);
    case 'setState': return db.setState(params.key, params.value, params.options);
    case 'postMessage': return { id: db.postMessage(params.channel, params.payload, params.from) };
    case 'readStream': return db.readStream(params.channel, params.options);
    default: return { error: `Unknown coordination method: ${method}` };
  }
}

async function handleSystem(method: string, params: any): Promise<unknown> {
  switch (method) {
    case 'getWindows': return aosProxy.getWindows(params?.filter);
    case 'click': return aosProxy.click(params.target);
    case 'say': return aosProxy.say(params.text);
    default: return { error: `Unknown system method: ${method}` };
  }
}
```

- [ ] **Step 2: Create aos-sdk.js (runtime injected into subprocesses)**

```javascript
// sdk/aos-sdk.js
// AOS SDK Runtime — injected into script execution contexts.
// Zero npm dependencies. Communicates with gateway via Unix socket NDJSON.

const net = require('node:net');
let _conn = null;
let _reqId = 0;
const _pending = new Map();

function getConnection() {
  if (_conn) return _conn;
  const sockPath = globalThis.__aos_config?.gatewaySocket;
  if (!sockPath) throw new Error('__aos_config.gatewaySocket not set');
  _conn = net.createConnection(sockPath);
  let buffer = '';
  _conn.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      try {
        const resp = JSON.parse(line);
        const resolve = _pending.get(resp.id);
        if (resolve) { _pending.delete(resp.id); resolve(resp.result); }
      } catch {}
    }
  });
  return _conn;
}

function call(domain, method, params) {
  return new Promise((resolve) => {
    const id = String(++_reqId);
    _pending.set(id, resolve);
    const conn = getConnection();
    conn.write(JSON.stringify({ id, domain, method, params }) + '\n');
  });
}

const aos = {
  getWindows: (filter) => call('system', 'getWindows', { filter }),
  click: (target) => call('system', 'click', { target }),
  say: (text) => call('system', 'say', { text }),

  coordination: {
    register: (name, role, harness, capabilities) =>
      call('coordination', 'register', { name, role, harness, capabilities }),
    whoIsOnline: () => call('coordination', 'whoIsOnline', {}),
    getState: (key) => call('coordination', 'getState', { key }),
    setState: (key, value, options) =>
      call('coordination', 'setState', { key, value, options }),
    postMessage: (channel, payload, from) =>
      call('coordination', 'postMessage', { channel, payload, from: from ?? globalThis.__aos_config?.sessionId }),
    readStream: (channel, options) =>
      call('coordination', 'readStream', { channel, options }),
  },
};

globalThis.aos = aos;
globalThis.__aos_call = call;
globalThis.__aos_cleanup = () => { if (_conn) _conn.destroy(); };
```

- [ ] **Step 3: Create aos-sdk.d.ts (type definitions for discovery)**

```typescript
// sdk/aos-sdk.d.ts
declare const aos: {
  getWindows(filter?: { app?: string; title?: string }): Promise<Array<{
    id: string; app: string; title: string;
    frame: { x: number; y: number; width: number; height: number };
    focused: boolean;
  }>>;
  click(target: { x: number; y: number }): Promise<void>;
  say(text: string): Promise<void>;

  coordination: {
    register(name: string, role: string, harness: string, capabilities?: string[]): Promise<{
      id: string; name: string; role: string; harness: string; status: string;
    }>;
    whoIsOnline(): Promise<Array<{
      id: string; name: string; role: string; harness: string; status: string;
    }>>;
    getState(key: string): Promise<Array<{
      key: string; value: unknown; version: number; owner?: string;
    }>>;
    setState(key: string, value: unknown, options?: {
      mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
      expectedVersion?: number; owner?: string; ttl?: number;
    }): Promise<{ ok: boolean; version?: number; reason?: string }>;
    postMessage(channel: string, payload: unknown, from?: string): Promise<{ id: string }>;
    readStream(channel: string, options?: { since?: string; limit?: number }): Promise<Array<{
      id: string; channel: string; from: string; payload: unknown; createdAt: string;
    }>>;
  };
};

declare const params: Record<string, unknown>;
```

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/sdk-socket.ts packages/gateway/sdk/
git commit -m "feat(gateway): SDK socket server + aos-sdk.js runtime + type definitions"
```

---

## Task 5: Node Subprocess Engine

**Files:**
- Create: `packages/gateway/src/engine/interface.ts`
- Create: `packages/gateway/src/engine/router.ts`
- Create: `packages/gateway/src/engine/node-subprocess.ts`
- Create: `packages/gateway/test/engine.test.ts`

- [ ] **Step 1: Define engine interface**

```typescript
// src/engine/interface.ts
export type Intent = 'perception' | 'action' | 'coordination' | 'mixed';

export interface ScriptRequest {
  script: string;
  params: Record<string, unknown>;
  intent: Intent;
  timeout: number;
  context: { gatewaySocket: string; sessionId: string };
}

export interface ScriptResult {
  result: unknown;
  logs: string[];
  durationMs: number;
  engine: string;
}

export interface ScriptEngine {
  readonly name: string;
  execute(request: ScriptRequest): Promise<ScriptResult>;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
```

- [ ] **Step 2: Implement NodeSubprocessEngine**

```typescript
// src/engine/node-subprocess.ts
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScriptEngine, ScriptRequest, ScriptResult } from './interface.js';
import { stripTypeAnnotations } from '../strip-ts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_PATH = resolve(__dirname, '..', '..', 'sdk', 'aos-sdk.js');

export class NodeSubprocessEngine implements ScriptEngine {
  readonly name = 'node-subprocess';

  async isAvailable(): Promise<boolean> { return true; }
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async execute(request: ScriptRequest): Promise<ScriptResult> {
    const start = Date.now();
    const js = stripTypeAnnotations(request.script);
    const resultFile = join(tmpdir(), `aos-result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

    const wrapper = `
globalThis.__aos_config = ${JSON.stringify(request.context)};
${readFileSync(SDK_PATH, 'utf-8')}
const params = ${JSON.stringify(request.params)};
(async () => {
  try {
    const __result = await (async () => { ${js} })();
    require('fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ok: true, value: __result }));
  } catch (err) {
    require('fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ok: false, error: err.message }));
  } finally {
    globalThis.__aos_cleanup?.();
  }
})();
`;

    const scriptFile = join(tmpdir(), `aos-script-${Date.now()}.cjs`);
    writeFileSync(scriptFile, wrapper);

    return new Promise<ScriptResult>((resolvePromise) => {
      const logs: string[] = [];
      const child = spawn('node', ['--no-warnings', scriptFile], { timeout: request.timeout });

      child.stdout.on('data', (d) => logs.push(d.toString().trimEnd()));
      child.stderr.on('data', (d) => logs.push(`[stderr] ${d.toString().trimEnd()}`));

      child.on('close', () => {
        let result: unknown = null;
        try {
          const raw = readFileSync(resultFile, 'utf-8');
          const parsed = JSON.parse(raw);
          result = parsed.ok ? parsed.value : { error: parsed.error };
          unlinkSync(resultFile);
        } catch {}
        try { unlinkSync(scriptFile); } catch {}

        resolvePromise({ result, logs, durationMs: Date.now() - start, engine: this.name });
      });
    });
  }
}
```

- [ ] **Step 3: Implement EngineRouter**

```typescript
// src/engine/router.ts
import type { ScriptEngine, ScriptRequest, ScriptResult, Intent } from './interface.js';

interface RouterConfig {
  defaultEngine: string;
  intentPolicy: Record<Intent, string[]>;
}

const DEFAULT_CONFIG: RouterConfig = {
  defaultEngine: 'node-subprocess',
  intentPolicy: {
    perception: ['node-subprocess'],
    action: ['node-subprocess'],
    coordination: ['node-subprocess'],
    mixed: ['node-subprocess'],
  },
};

export class EngineRouter {
  private engines = new Map<string, ScriptEngine>();
  private config: RouterConfig;

  constructor(config?: Partial<RouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  register(engine: ScriptEngine) {
    this.engines.set(engine.name, engine);
  }

  async route(request: ScriptRequest, preferred?: string): Promise<ScriptResult> {
    // 1. Explicit preference
    if (preferred && preferred !== 'auto') {
      const engine = this.engines.get(preferred);
      if (engine && await engine.isAvailable()) return engine.execute(request);
    }
    // 2. Intent policy
    const candidates = this.config.intentPolicy[request.intent] ?? [];
    for (const name of candidates) {
      const engine = this.engines.get(name);
      if (engine && await engine.isAvailable()) return engine.execute(request);
    }
    // 3. Default
    const def = this.engines.get(this.config.defaultEngine);
    if (def) return def.execute(request);
    throw new Error('No available engine');
  }
}
```

- [ ] **Step 4: Write engine tests**

```typescript
// test/engine.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NodeSubprocessEngine } from '../src/engine/node-subprocess.js';
import { EngineRouter } from '../src/engine/router.js';
import { CoordinationDB } from '../src/db.js';
import { startSDKSocket } from '../src/sdk-socket.js';
import { unlinkSync } from 'node:fs';

const TEST_DB = '/tmp/aos-gw-engine-test.db';
const TEST_SOCK = '/tmp/aos-gw-engine-test.sock';

describe('NodeSubprocessEngine', () => {
  let db: CoordinationDB;
  let sdkServer: ReturnType<typeof startSDKSocket>;
  let engine: NodeSubprocessEngine;

  before(() => {
    db = new CoordinationDB(TEST_DB);
    sdkServer = startSDKSocket({ socketPath: TEST_SOCK, db });
    engine = new NodeSubprocessEngine();
  });

  after(() => {
    sdkServer.close();
    db.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_SOCK); } catch {}
  });

  it('executes a simple script and returns result', async () => {
    const r = await engine.execute({
      script: 'return 2 + 2;',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 4);
    assert.equal(r.engine, 'node-subprocess');
  });

  it('passes params to script', async () => {
    const r = await engine.execute({
      script: 'return params.x + params.y;',
      params: { x: 10, y: 20 },
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 30);
  });

  it('captures console.log as logs', async () => {
    const r = await engine.execute({
      script: 'console.log("hello from script"); return "done";',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.ok(r.logs.some(l => l.includes('hello from script')));
  });

  it('strips TypeScript annotations', async () => {
    const r = await engine.execute({
      script: 'const x: number = 42; return x;',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 42);
  });

  it('accesses coordination via SDK', async () => {
    const r = await engine.execute({
      script: `
        await aos.coordination.setState("test-key", { from: "script" }, { mode: "set" });
        const entries = await aos.coordination.getState("test-key");
        return entries[0]?.value;
      `,
      params: {},
      intent: 'coordination',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.deepEqual(r.result, { from: 'script' });
  });
});

describe('EngineRouter', () => {
  it('routes to the only registered engine', async () => {
    const router = new EngineRouter();
    const engine = new NodeSubprocessEngine();
    router.register(engine);
    const r = await router.route({
      script: 'return "routed";',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: '/dev/null', sessionId: 'test' },
    });
    assert.equal(r.engine, 'node-subprocess');
  });
});
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd packages/gateway && npm test -- test/engine.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/engine/ packages/gateway/test/engine.test.ts
git commit -m "feat(gateway): node-subprocess engine with TS stripping and SDK socket integration"
```

---

## Task 6: Script Registry

**Files:**
- Create: `packages/gateway/src/scripts.ts`
- Create: `packages/gateway/test/scripts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/scripts.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptRegistry } from '../src/scripts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ScriptRegistry', () => {
  let dir: string;
  let registry: ScriptRegistry;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'aos-scripts-'));
    registry = new ScriptRegistry(dir);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('saves and loads a script', () => {
    registry.save('greet', 'return "hi";', {
      description: 'Says hi', intent: 'mixed',
    });
    const source = registry.load('greet');
    assert.equal(source, 'return "hi";');
  });

  it('lists scripts with metadata', () => {
    registry.save('task-a', 'return 1;', { description: 'A', intent: 'action' });
    const all = registry.list();
    assert.ok(all.some(s => s.name === 'task-a' && s.intent === 'action'));
  });

  it('errors on duplicate name without overwrite', () => {
    registry.save('dup', 'return 1;', { description: 'v1', intent: 'mixed' });
    assert.throws(() => {
      registry.save('dup', 'return 2;', { description: 'v2', intent: 'mixed' });
    }, /already exists/);
  });

  it('overwrites with overwrite flag', () => {
    registry.save('up', 'return 1;', { description: 'v1', intent: 'mixed' });
    registry.save('up', 'return 2;', { description: 'v2', intent: 'mixed' }, true);
    assert.equal(registry.load('up'), 'return 2;');
    const meta = registry.list().find(s => s.name === 'up')!;
    assert.equal(meta.version, 2);
  });

  it('filters by intent', () => {
    registry.save('percep', 'return 1;', { description: 'P', intent: 'perception' });
    const filtered = registry.list({ intent: 'perception' });
    assert.ok(filtered.some(s => s.name === 'percep'));
    assert.ok(!filtered.some(s => s.intent !== 'perception'));
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/gateway && npm test -- test/scripts.test.ts`
Expected: FAIL — `ScriptRegistry` not found.

- [ ] **Step 3: Implement ScriptRegistry**

```typescript
// src/scripts.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SavedScript {
  name: string; description: string; intent: string;
  portable: boolean; version: number;
  parameters?: Record<string, unknown>;
  createdBy?: string; createdAt?: string;
}

export interface ScriptMeta {
  description: string; intent: string;
  portable?: boolean; parameters?: Record<string, unknown>;
  note?: string;
}

export class ScriptRegistry {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(name: string, script: string, meta: ScriptMeta, overwrite = false, sessionId?: string) {
    const scriptPath = join(this.dir, `${name}.ts`);
    const metaPath = join(this.dir, `${name}.meta.json`);

    if (existsSync(scriptPath) && !overwrite) {
      throw new Error(`Script "${name}" already exists. Use overwrite: true to update.`);
    }

    let version = 1;
    let changelog: any[] = [];
    let createdAt = new Date().toISOString();
    let createdBy = sessionId;

    if (existsSync(metaPath) && overwrite) {
      const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
      version = (existing.version ?? 0) + 1;
      changelog = existing.changelog ?? [];
      createdAt = existing.createdAt ?? createdAt;
      createdBy = existing.createdBy ?? createdBy;
      // Backup previous
      renameSync(scriptPath, join(this.dir, `${name}.prev.ts`));
    }

    const now = new Date().toISOString();
    changelog.push({
      version, at: now, by: sessionId ?? 'unknown',
      note: meta.note ?? (overwrite ? `Updated by ${sessionId ?? 'unknown'}` : 'Initial version'),
    });
    if (changelog.length > 20) changelog = changelog.slice(-20);

    const metaJson = {
      name, description: meta.description, intent: meta.intent,
      portable: meta.portable ?? true, version,
      parameters: meta.parameters,
      createdBy, createdAt,
      updatedBy: sessionId, updatedAt: now,
      changelog,
    };

    writeFileSync(scriptPath, script, 'utf-8');
    writeFileSync(metaPath, JSON.stringify(metaJson, null, 2), 'utf-8');
  }

  load(name: string): string {
    const p = join(this.dir, `${name}.ts`);
    if (!existsSync(p)) throw new Error(`Script "${name}" not found.`);
    return readFileSync(p, 'utf-8');
  }

  list(filter?: { intent?: string; query?: string }): SavedScript[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.meta.json'));
    let results: SavedScript[] = files.map(f => {
      const raw = JSON.parse(readFileSync(join(this.dir, f), 'utf-8'));
      return {
        name: raw.name, description: raw.description, intent: raw.intent,
        portable: raw.portable ?? true, version: raw.version ?? 1,
        parameters: raw.parameters, createdBy: raw.createdBy, createdAt: raw.createdAt,
      };
    });
    if (filter?.intent) results = results.filter(s => s.intent === filter.intent);
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      results = results.filter(s => s.name.includes(q) || s.description.toLowerCase().includes(q));
    }
    return results;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/gateway && npm test -- test/scripts.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/scripts.ts packages/gateway/test/scripts.test.ts
git commit -m "feat(gateway): script registry with save/load/list and version tracking"
```

---

## Task 7: MCP Server and Tool Handlers

**Files:**
- Create: `packages/gateway/src/tools/coordination.ts`
- Create: `packages/gateway/src/tools/execution.ts`
- Create: `packages/gateway/src/index.ts`

- [ ] **Step 1: Implement coordination tool handlers**

```typescript
// src/tools/coordination.ts
import type { CoordinationDB } from '../db.js';

export function registerCoordinationTools(db: CoordinationDB) {
  return {
    register_session: (args: any) =>
      db.registerSession(args.name, args.role, args.harness, args.capabilities),

    set_state: (args: any) =>
      db.setState(args.key, args.value, {
        mode: args.mode, expectedVersion: args.expected_version,
        owner: args.owner, ttl: args.ttl,
      }),

    get_state: (args: any) =>
      db.getState(args.key),

    post_message: (args: any) =>
      ({ id: db.postMessage(args.channel, args.payload, args.from) }),

    read_stream: (args: any) =>
      db.readStream(args.channel, { since: args.since, limit: args.limit }),
  };
}
```

- [ ] **Step 2: Implement execution tool handlers**

```typescript
// src/tools/execution.ts
import type { EngineRouter } from '../engine/router.js';
import type { ScriptRegistry } from '../scripts.js';
import type { Intent } from '../engine/interface.js';
import { stripTypeAnnotations } from '../strip-ts.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_PATH = resolve(__dirname, '..', '..', 'sdk', 'aos-sdk.d.ts');

export function registerExecutionTools(
  router: EngineRouter,
  registry: ScriptRegistry,
  gatewaySocket: string,
) {
  return {
    run_os_script: async (args: any) => {
      let script: string;
      if (args.script_id) {
        script = registry.load(args.script_id);
      } else if (args.script) {
        script = args.script;
      } else {
        return { error: 'Either script or script_id is required' };
      }

      return router.route({
        script,
        params: args.params ?? {},
        intent: (args.intent ?? 'mixed') as Intent,
        timeout: args.timeout ?? 10000,
        context: { gatewaySocket, sessionId: args.__sessionId ?? 'anonymous' },
      }, args.engine);
    },

    save_script: (args: any) => {
      registry.save(args.name, args.script, {
        description: args.description,
        intent: args.intent,
        portable: args.portable,
        parameters: args.parameters,
        note: args.note,
      }, args.overwrite ?? false, args.__sessionId);
      return { saved: true, name: args.name };
    },

    list_scripts: (args: any) =>
      registry.list({ intent: args?.intent, query: args?.query }),

    discover_capabilities: (_args: any) => {
      let types: string;
      try { types = readFileSync(TYPES_PATH, 'utf-8'); } catch { types = '(type definitions not found)'; }
      return {
        namespaces: ['perception', 'action', 'voice', 'coordination'],
        description: 'Use the `aos` global object in scripts. Call with a namespace filter for full method signatures.',
        types,
        scripts: registry.list(),
      };
    },
  };
}
```

- [ ] **Step 3: Implement the MCP server entry point**

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CoordinationDB } from './db.js';
import { EngineRouter } from './engine/router.js';
import { NodeSubprocessEngine } from './engine/node-subprocess.js';
import { ScriptRegistry } from './scripts.js';
import { startSDKSocket } from './sdk-socket.js';
import { registerCoordinationTools } from './tools/coordination.js';
import { registerExecutionTools } from './tools/execution.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(homedir(), '.config', 'aos-gateway');
mkdirSync(STATE_DIR, { recursive: true });

const DB_PATH = join(STATE_DIR, 'gateway.db');
const SOCKET_PATH = join(STATE_DIR, 'sdk.sock');
const SCRIPTS_DIR = join(STATE_DIR, 'scripts');

// Initialize components
const db = new CoordinationDB(DB_PATH);
const sdkServer = startSDKSocket({ socketPath: SOCKET_PATH, db });
const engine = new NodeSubprocessEngine();
const router = new EngineRouter();
router.register(engine);
const registry = new ScriptRegistry(SCRIPTS_DIR);

const coordTools = registerCoordinationTools(db);
const execTools = registerExecutionTools(router, registry, SOCKET_PATH);
const allHandlers: Record<string, (args: any) => any> = { ...coordTools, ...execTools };

// MCP tool definitions (schemas)
const TOOL_DEFS = [
  { name: 'register_session', description: 'Register this agent session on the coordination bus.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, role: { type: 'string' }, harness: { type: 'string' },
      capabilities: { type: 'array', items: { type: 'string' } },
    }, required: ['name', 'role', 'harness'] } },
  { name: 'set_state', description: 'Write to the shared key-value store. Supports set, cas, acquire_lock, release_lock.',
    inputSchema: { type: 'object' as const, properties: {
      key: { type: 'string' }, value: {}, mode: { type: 'string', enum: ['set','cas','acquire_lock','release_lock'] },
      expected_version: { type: 'number' }, owner: { type: 'string' }, ttl: { type: 'number' },
    }, required: ['key'] } },
  { name: 'get_state', description: 'Read from the shared key-value store. Exact key or glob.',
    inputSchema: { type: 'object' as const, properties: {
      key: { type: 'string' },
    }, required: ['key'] } },
  { name: 'post_message', description: 'Post a message to a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, payload: {}, from: { type: 'string' },
    }, required: ['channel', 'payload', 'from'] } },
  { name: 'read_stream', description: 'Read messages from a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, since: { type: 'string' }, limit: { type: 'number' },
    }, required: ['channel'] } },
  { name: 'run_os_script', description: 'Execute a TS/JS script against the aos SDK. Runs off-stage.',
    inputSchema: { type: 'object' as const, properties: {
      script: { type: 'string' }, script_id: { type: 'string' }, params: { type: 'object' },
      intent: { type: 'string', enum: ['perception','action','coordination','mixed'] },
      timeout: { type: 'number' }, engine: { type: 'string', enum: ['auto','node-subprocess'] },
    } } },
  { name: 'save_script', description: 'Save a script for reuse.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, script: { type: 'string' }, description: { type: 'string' },
      intent: { type: 'string' }, portable: { type: 'boolean' },
      overwrite: { type: 'boolean' }, note: { type: 'string' },
    }, required: ['name', 'script', 'description', 'intent'] } },
  { name: 'list_scripts', description: 'List saved scripts.',
    inputSchema: { type: 'object' as const, properties: {
      intent: { type: 'string' }, query: { type: 'string' },
    } } },
  { name: 'discover_capabilities', description: 'Returns SDK namespaces and method signatures.',
    inputSchema: { type: 'object' as const, properties: {
      namespace: { type: 'string' },
    } } },
];

// Create MCP server
const server = new Server({ name: 'aos-gateway', version: '0.1.0' }, {
  capabilities: { tools: {} },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allHandlers[name];
  if (!handler) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };

  try {
    const result = await handler(args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('aos-gateway started');
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd packages/gateway && npm run build`
Expected: Compiles to `dist/` without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/tools/ packages/gateway/src/index.ts
git commit -m "feat(gateway): MCP server with 9 tool handlers (coordination + execution + discovery)"
```

---

## Task 8: End-to-End Test

**Files:**
- Create: `packages/gateway/test/e2e.test.ts`

- [ ] **Step 1: Write the end-to-end test**

This simulates the cross-harness coordination test case by calling tool handlers directly (no MCP transport — that's integration-tested by connecting Claude Code to the gateway).

```typescript
// test/e2e.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CoordinationDB } from '../src/db.js';
import { EngineRouter } from '../src/engine/router.js';
import { NodeSubprocessEngine } from '../src/engine/node-subprocess.js';
import { ScriptRegistry } from '../src/scripts.js';
import { startSDKSocket } from '../src/sdk-socket.js';
import { registerCoordinationTools } from '../src/tools/coordination.js';
import { registerExecutionTools } from '../src/tools/execution.js';
import { unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = '/tmp/aos-gw-e2e.db';
const TEST_SOCK = '/tmp/aos-gw-e2e.sock';

describe('E2E: Cross-harness coordination', () => {
  let db: CoordinationDB;
  let sdkServer: ReturnType<typeof startSDKSocket>;
  let coord: ReturnType<typeof registerCoordinationTools>;
  let exec: ReturnType<typeof registerExecutionTools>;
  let scriptsDir: string;

  before(() => {
    db = new CoordinationDB(TEST_DB);
    sdkServer = startSDKSocket({ socketPath: TEST_SOCK, db });
    const engine = new NodeSubprocessEngine();
    const router = new EngineRouter();
    router.register(engine);
    scriptsDir = mkdtempSync(join(tmpdir(), 'aos-e2e-scripts-'));
    const registry = new ScriptRegistry(scriptsDir);
    coord = registerCoordinationTools(db);
    exec = registerExecutionTools(router, registry, TEST_SOCK);
  });

  after(() => {
    sdkServer.close();
    db.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_SOCK); } catch {}
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('full coordination scenario: register → lock → message → release', async () => {
    // 1. Two sessions register
    const leadDev = coord.register_session({ name: 'lead-dev', role: 'architecture', harness: 'claude-code' });
    const uiDesigner = coord.register_session({ name: 'ui-designer', role: 'studio-refactor', harness: 'codex' });
    assert.equal(leadDev.status, 'online');
    assert.equal(uiDesigner.status, 'online');

    // 2. ui-designer acquires a lock
    const lock = coord.set_state({
      key: 'lock:sigil/studio/js/ui.js',
      value: { task: 'refactoring sidebar' },
      mode: 'acquire_lock', owner: 'ui-designer', ttl: 3600,
    });
    assert.equal(lock.ok, true);

    // 3. lead-dev checks locks
    const locks = coord.get_state({ key: 'lock:sigil/*' });
    assert.equal(locks.length, 1);
    assert.equal(locks[0].owner, 'ui-designer');

    // 4. lead-dev tries to acquire the same lock — fails
    const contested = coord.set_state({
      key: 'lock:sigil/studio/js/ui.js',
      value: { task: 'touching events' },
      mode: 'acquire_lock', owner: 'lead-dev',
    });
    assert.equal(contested.ok, false);
    assert.equal(contested.reason, 'owned_by_other');

    // 5. ui-designer posts a message
    const posted = coord.post_message({
      channel: 'all', payload: { type: 'file-claim', files: ['ui.js'] }, from: 'ui-designer',
    });
    assert.ok(posted.id);

    // 6. lead-dev reads the stream
    const msgs = coord.read_stream({ channel: 'all' });
    assert.ok(msgs.some((m: any) => m.payload.type === 'file-claim'));

    // 7. ui-designer releases the lock
    const released = coord.set_state({
      key: 'lock:sigil/studio/js/ui.js', value: null,
      mode: 'release_lock', owner: 'ui-designer',
    });
    assert.equal(released.ok, true);
  });

  it('run_os_script with coordination via SDK', async () => {
    // Script uses aos.coordination inside a subprocess
    const result = await exec.run_os_script({
      script: `
        await aos.coordination.setState("from-script", { hello: "world" }, { mode: "set" });
        const entries = await aos.coordination.getState("from-script");
        return entries[0]?.value;
      `,
      intent: 'coordination',
      timeout: 10000,
    });
    assert.deepEqual(result.result, { hello: 'world' });
  });

  it('save_script then run via script_id', async () => {
    // Save a coordination script
    exec.save_script({
      name: 'check-locks',
      script: 'const s = await aos.coordination.getState("lock:*"); return s.length;',
      description: 'Count active locks',
      intent: 'coordination',
    });

    // Set up a lock first
    coord.set_state({
      key: 'lock:test-file', value: 'locked',
      mode: 'acquire_lock', owner: 'tester',
    });

    // Run saved script by ID
    const result = await exec.run_os_script({
      script_id: 'check-locks',
      intent: 'coordination',
      timeout: 10000,
    });
    assert.ok((result.result as number) >= 1);
  });
});
```

- [ ] **Step 2: Run e2e test**

Run: `cd packages/gateway && npm test -- test/e2e.test.ts`
Expected: All pass.

- [ ] **Step 3: Run all tests together**

Run: `cd packages/gateway && npm test`
Expected: All test files pass.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/test/e2e.test.ts
git commit -m "test(gateway): end-to-end coordination + script execution + script_id promotion"
```

---

## Task 9: CLAUDE.md and Configuration

**Files:**
- Create: `packages/gateway/CLAUDE.md`
- Modify: `/Users/Michael/Code/agent-os/CLAUDE.md` (add gateway to structure)

- [ ] **Step 1: Write gateway CLAUDE.md**

```markdown
# aos-gateway

MCP server providing typed script execution and cross-harness coordination for agent-os.

## Quick Start

```bash
cd packages/gateway
npm install
npm run build
npm start          # Starts MCP server on stdio
```

## Configure in Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "aos-gateway": {
      "command": "node",
      "args": ["/path/to/agent-os/packages/gateway/dist/index.js"]
    }
  }
}
```

## Tools (9)

**Coordination:** register_session, set_state, get_state, post_message, read_stream
**Execution:** run_os_script, save_script, list_scripts, discover_capabilities

## State

All gateway state lives at `~/.config/aos-gateway/`:
- `gateway.db` — SQLite coordination store
- `sdk.sock` — SDK socket for subprocess communication
- `scripts/` — saved scripts
- `config.json` — gateway configuration (optional)

## Tests

```bash
npm test           # All tests
npm test -- test/db.test.ts    # Just coordination store
npm test -- test/e2e.test.ts   # End-to-end scenario
```
```

- [ ] **Step 2: Update root CLAUDE.md structure section**

Add `packages/gateway/` to the structure listing.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/CLAUDE.md CLAUDE.md
git commit -m "docs(gateway): add CLAUDE.md and update root structure"
```

---

## Acceptance Tests Summary

| # | Test | What it proves |
|---|------|---------------|
| 1 | Two sessions can register and appear in `whoIsOnline` | Session lifecycle works |
| 2 | `set_state` with `acquire_lock` blocks a second owner | Lock semantics are correct |
| 3 | `set_state` with `cas` fails on version mismatch | CAS contract holds |
| 4 | `post_message` + `read_stream` with cursor returns correct messages | Message bus works |
| 5 | Node subprocess executes `return 2+2` and returns `4` | Basic engine execution |
| 6 | Script with TS annotations (`const x: number = 42`) executes | TS stripping works |
| 7 | Script calls `aos.coordination.setState` and reads it back | SDK ↔ gateway socket works |
| 8 | `save_script` then `run_os_script({ script_id })` executes the saved script | Script persistence + promotion |
| 9 | Full register → lock → message → unlock flow across two sessions | Cross-harness coordination scenario |

---

## Phase 2+ (Deferred)

These are explicitly NOT part of this plan:

- **`daemon-jsc` engine** — JavaScriptCore embedded in the aos daemon. Requires Swift work in `src/`. Same `ScriptEngine` interface, same MCP surface.
- **`search_tools`** — Semantic search over SDK methods. Requires embedding or keyword index. v1 has `discover_capabilities` which returns the full type surface.
- **`discover_capabilities` with namespace filtering** — v1 returns everything; namespace filtering is a refinement.
- **Script namespacing** — Per-project or per-workspace script scopes. v1 is flat.
- **Lock convenience helpers** — `acquireLock()` / `withLock()` in the SDK. v1 has raw `setState` with lock modes.
- **Session heartbeat sweeps** — Periodic offline marking. v1 marks sessions online on register; staleness is checked at query time.
- **Message retention sweeps** — Periodic cleanup of old messages. v1 retains everything.
- **SSE transport** — For Claude Desktop and non-stdio harnesses. v1 is stdio only.
- **Runtime sandboxing** — V8 isolates, Deno permissions, restricted Node loader. v1 sandboxes by convention.
- **`display` namespace in SDK** — `aos.show.canvas()` etc. Requires daemon socket proxying for canvas operations. v1 has perception + action + voice + coordination.
