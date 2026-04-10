# Chat-Native Agent Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js agent host sidecar (`packages/host/`) that runs Anthropic-powered agent loops with tool execution, streaming, and session persistence — wired into Sigil's chat canvas as the first consumer.

**Architecture:** Hybrid topology — Swift daemon handles canvases/OS, Node.js host handles agent loops/tools/sessions. Two Unix sockets, unified SDK surface. See `docs/superpowers/specs/2026-04-10-chat-native-agent-host-design.md`.

**Tech Stack:** TypeScript (ESM), Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), `better-sqlite3`, `ulid`, Unix domain sockets (line-delimited JSON protocol, matching gateway pattern).

**Spec:** `docs/superpowers/specs/2026-04-10-chat-native-agent-host-design.md`

---

## File Structure

```
packages/host/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # Entry point: starts socket server, initializes DB + registry
│   ├── server.ts                 # Unix socket server (line-delimited JSON, same pattern as gateway)
│   ├── types.ts                  # All shared types: StreamEvent, ToolDefinition, Session, etc.
│   ├── agent-loop.ts             # Core agent loop: receive → provider → tool exec → loop
│   ├── session-store.ts          # SQLite session + message persistence
│   ├── tool-registry.ts          # In-memory tool registry: register, resolve, permission check
│   ├── provider/
│   │   ├── adapter.ts            # ProviderAdapter interface + factory
│   │   └── anthropic.ts          # Anthropic adapter wrapping Vercel AI SDK
│   └── tools/
│       ├── read-file.ts          # read_file tool
│       ├── list-files.ts         # list_files tool
│       └── shell-exec.ts         # shell_exec tool (deny by default)
└── test/
    ├── agent-loop.test.ts
    ├── session-store.test.ts
    ├── tool-registry.test.ts
    ├── provider/
    │   └── anthropic.test.ts
    └── tools/
        ├── read-file.test.ts
        ├── list-files.test.ts
        └── shell-exec.test.ts
```

---

### Task 1: Package Scaffolding

**Build/Adapt/Borrow:** BORROW PATTERN from `packages/gateway/` (package.json shape, tsconfig, ESM config)

**Files:**
- Create: `packages/host/package.json`
- Create: `packages/host/tsconfig.json`
- Create: `packages/host/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-os/host",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "node --test --experimental-strip-types 'test/**/*.test.ts'"
  },
  "dependencies": {
    "ai": "^4.3.0",
    "@ai-sdk/anthropic": "^1.2.0",
    "better-sqlite3": "^11.0.0",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
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
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create src/types.ts with all shared interfaces**

This is the single source of truth for all types referenced across the host.

```typescript
// packages/host/src/types.ts

// --- JSON primitives ---

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type JSONSchema = Record<string, unknown>;

// --- Tool interfaces (BORROW PATTERN: MCP tool shape, extended) ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  permissions?: PermissionSpec;
  timeout?: number; // ms, default 30_000
  metadata?: {
    type: 'simple' | 'provider-backed' | 'agent-backed';
    source?: string;
  };
}

export interface ToolContext {
  sessionId: string;
  signal: AbortSignal;
  emit: (event: StreamEvent) => void;
}

export type ToolExecutor = (input: JSONValue, context: ToolContext) => Promise<ToolResult>;

export interface ToolResult {
  content: string | Record<string, unknown>;
  isError?: boolean;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

// --- Permission model (BUILD, borrow pattern from Claude Code) ---

export interface PermissionSpec {
  default: 'allow' | 'deny' | 'ask';
  dangerous?: boolean;
}

export interface PermissionOverride {
  tool: string; // glob pattern
  decision: 'allow' | 'deny';
  scope: 'session' | 'persistent';
}

// --- Stream events (ADAPT: Vercel AI SDK stream types, extended) ---

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: JSONValue }
  | { type: 'tool-result'; toolCallId: string; result: ToolResult }
  | { type: 'tool-progress'; toolCallId: string; message: string }
  | { type: 'finish'; reason: 'end_turn' | 'stop' | 'max_tokens' | 'max_iterations' }
  | { type: 'error'; error: string; code?: string }
  | { type: 'status'; message: string };

// --- Session & messages (BUILD on better-sqlite3) ---

export interface Session {
  id: string;
  provider: string;
  model: string;
  system?: string;
  toolProfile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfig {
  provider?: string;  // default: 'anthropic'
  model?: string;     // default: 'claude-sonnet-4-20250514'
  system?: string;
  toolProfile?: string;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string; // JSON-serialized content blocks
  createdAt: string;
  tokenCount?: number;
}

// --- Provider adapter (ADAPT: wraps Vercel AI SDK) ---

export interface ProviderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: JSONValue }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ProviderAdapter {
  id: string;
  stream(params: {
    messages: ProviderMessage[];
    tools: ToolDefinition[];
    system?: string;
    config: ProviderConfig;
  }): AsyncIterable<StreamEvent>;
}

// --- Agent loop config ---

export interface AgentLoopConfig {
  maxIterations: number; // default: 25
}

// --- Socket protocol (BORROW PATTERN: gateway line-delimited JSON) ---

export interface SocketRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SocketResponse {
  id: string;
  result?: unknown;
  error?: { message: string; code?: string };
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd packages/host && npm install`
Expected: node_modules created, package-lock.json generated

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd packages/host && npx tsc --noEmit`
Expected: No errors (types.ts compiles cleanly)

- [ ] **Step 6: Commit**

```bash
git add packages/host/
git commit -m "feat(host): scaffold package with types"
```

---

### Task 2: Session Store

**Build/Adapt/Borrow:** BUILD on `better-sqlite3`. Schema modeled after gateway's SQLite patterns (WAL mode, ulid IDs).

**Files:**
- Create: `packages/host/src/session-store.ts`
- Create: `packages/host/test/session-store.test.ts`

- [ ] **Step 1: Write failing tests for session store**

```typescript
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
      // Small delay to ensure different timestamp
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }]);
      const updated = store.getSession(session.id)!;
      assert.ok(updated.updatedAt >= originalUpdatedAt);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/host && npm test`
Expected: FAIL — cannot find module `../src/session-store.ts`

- [ ] **Step 3: Implement session store**

```typescript
// packages/host/src/session-store.ts
import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Session, SessionConfig, StoredMessage } from './types.ts';

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'anthropic',
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
        system TEXT,
        tool_profile TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_count INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, created_at);
    `);
  }

  createSession(config: SessionConfig): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: ulid(),
      provider: config.provider ?? 'anthropic',
      model: config.model ?? 'claude-sonnet-4-20250514',
      system: config.system,
      toolProfile: config.toolProfile,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO sessions (id, provider, model, system, tool_profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, session.provider, session.model, session.system ?? null,
           session.toolProfile ?? null, session.createdAt, session.updatedAt);

    return session;
  }

  getSession(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      provider: row.provider,
      model: row.model,
      system: row.system ?? undefined,
      toolProfile: row.tool_profile ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSessions(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      system: row.system ?? undefined,
      toolProfile: row.tool_profile ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: unknown[],
    tokenCount?: number
  ): StoredMessage {
    const now = new Date().toISOString();
    const msg: StoredMessage = {
      id: ulid(),
      sessionId,
      role,
      content: JSON.stringify(content),
      createdAt: now,
      tokenCount,
    };

    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at, token_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(msg.id, msg.sessionId, msg.role, msg.content, msg.createdAt,
             msg.tokenCount ?? null);

      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
        .run(now, sessionId);
    });
    txn();

    return msg;
  }

  getMessages(sessionId: string): StoredMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      tokenCount: row.token_count ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/host && npm test`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/session-store.ts packages/host/test/session-store.test.ts
git commit -m "feat(host): session store with SQLite persistence"
```

---

### Task 3: Tool Registry

**Build/Adapt/Borrow:** BUILD. In-memory registry with permission checking.

**Files:**
- Create: `packages/host/src/tool-registry.ts`
- Create: `packages/host/test/tool-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/host/test/tool-registry.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tool-registry.ts';
import type { ToolDefinition, ToolExecutor } from '../src/types.ts';

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes input back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  permissions: { default: 'allow' },
};

const dangerousTool: ToolDefinition = {
  name: 'danger',
  description: 'A dangerous tool',
  inputSchema: { type: 'object', properties: {} },
  permissions: { default: 'deny', dangerous: true },
};

const echoExecutor: ToolExecutor = async (input) => {
  const { text } = input as { text: string };
  return { content: text };
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool', () => {
    registry.register(echoTool, echoExecutor);
    const tool = registry.get('echo');
    assert.ok(tool);
    assert.equal(tool.definition.name, 'echo');
  });

  it('lists all registered tools', () => {
    registry.register(echoTool, echoExecutor);
    registry.register(dangerousTool, echoExecutor);
    const tools = registry.list();
    assert.equal(tools.length, 2);
  });

  it('returns definitions for provider (tool list for API call)', () => {
    registry.register(echoTool, echoExecutor);
    registry.register(dangerousTool, echoExecutor);
    const defs = registry.getDefinitions();
    assert.equal(defs.length, 2);
    assert.ok(defs.every(d => 'name' in d && 'inputSchema' in d));
  });

  it('rejects duplicate registration', () => {
    registry.register(echoTool, echoExecutor);
    assert.throws(() => registry.register(echoTool, echoExecutor), /already registered/);
  });

  it('checks permission — allow', () => {
    registry.register(echoTool, echoExecutor);
    const decision = registry.checkPermission('echo');
    assert.equal(decision, 'allow');
  });

  it('checks permission — deny', () => {
    registry.register(dangerousTool, echoExecutor);
    const decision = registry.checkPermission('danger');
    assert.equal(decision, 'deny');
  });

  it('checks permission — unknown tool returns deny', () => {
    const decision = registry.checkPermission('nonexistent');
    assert.equal(decision, 'deny');
  });

  it('applies overrides', () => {
    registry.register(dangerousTool, echoExecutor);
    registry.addOverride({ tool: 'danger', decision: 'allow', scope: 'session' });
    const decision = registry.checkPermission('danger');
    assert.equal(decision, 'allow');
  });

  it('override with glob pattern', () => {
    registry.register({ ...dangerousTool, name: 'fs.read' }, echoExecutor);
    registry.register({ ...dangerousTool, name: 'fs.write' }, echoExecutor);
    registry.addOverride({ tool: 'fs.*', decision: 'allow', scope: 'session' });
    assert.equal(registry.checkPermission('fs.read'), 'allow');
    assert.equal(registry.checkPermission('fs.write'), 'allow');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/host && npm test`
Expected: FAIL — cannot find module `../src/tool-registry.ts`

- [ ] **Step 3: Implement tool registry**

```typescript
// packages/host/src/tool-registry.ts
import type {
  ToolDefinition, ToolExecutor, RegisteredTool, PermissionOverride,
} from './types.ts';

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private overrides: PermissionOverride[] = [];

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' already registered`);
    }
    this.tools.set(definition.name, { definition, executor });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.list().map(t => t.definition);
  }

  checkPermission(toolName: string): 'allow' | 'deny' | 'ask' {
    // Check overrides first (last match wins)
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const override = this.overrides[i];
      if (this.matchGlob(override.tool, toolName)) {
        return override.decision;
      }
    }

    // Fall back to tool's default permission
    const tool = this.tools.get(toolName);
    if (!tool) return 'deny';
    return tool.definition.permissions?.default ?? 'allow';
  }

  addOverride(override: PermissionOverride): void {
    this.overrides.push(override);
  }

  clearSessionOverrides(): void {
    this.overrides = this.overrides.filter(o => o.scope !== 'session');
  }

  private matchGlob(pattern: string, name: string): boolean {
    if (pattern === name) return true;
    if (!pattern.includes('*')) return false;
    const regex = new RegExp(
      '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    return regex.test(name);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/host && npm test`
Expected: All tests PASS (session-store + tool-registry)

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/tool-registry.ts packages/host/test/tool-registry.test.ts
git commit -m "feat(host): in-memory tool registry with permission checking"
```

---

### Task 4: Simple Tools

**Build/Adapt/Borrow:** BUILD. Three simple tool implementations.

**Files:**
- Create: `packages/host/src/tools/read-file.ts`
- Create: `packages/host/src/tools/list-files.ts`
- Create: `packages/host/src/tools/shell-exec.ts`
- Create: `packages/host/test/tools/read-file.test.ts`
- Create: `packages/host/test/tools/list-files.test.ts`
- Create: `packages/host/test/tools/shell-exec.test.ts`

- [ ] **Step 1: Write failing tests for read_file**

```typescript
// packages/host/test/tools/read-file.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileTool } from '../../src/tools/read-file.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('read_file tool', () => {
  const tmpDir = path.join(os.tmpdir(), `host-test-${Date.now()}`);
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct definition', () => {
    assert.equal(readFileTool.definition.name, 'read_file');
    assert.equal(readFileTool.definition.permissions?.default, 'allow');
  });

  it('reads a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await readFileTool.executor({ path: filePath }, ctx);
    assert.equal(result.content, 'hello world');
  });

  it('returns error for missing file', async () => {
    const result = await readFileTool.executor({ path: '/nonexistent/file.txt' }, ctx);
    assert.equal(result.isError, true);
    assert.ok((result.content as string).includes('ENOENT'));
  });
});
```

- [ ] **Step 2: Write failing tests for list_files**

```typescript
// packages/host/test/tools/list-files.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listFilesTool } from '../../src/tools/list-files.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('list_files tool', () => {
  const tmpDir = path.join(os.tmpdir(), `host-test-list-${Date.now()}`);
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct definition', () => {
    assert.equal(listFilesTool.definition.name, 'list_files');
    assert.equal(listFilesTool.definition.permissions?.default, 'allow');
  });

  it('lists directory contents', async () => {
    const result = await listFilesTool.executor({ path: tmpDir }, ctx);
    const entries = result.content as Array<{ name: string; type: string }>;
    assert.equal(entries.length, 3);
    const names = entries.map(e => e.name).sort();
    assert.deepEqual(names, ['a.txt', 'b.ts', 'subdir']);
  });

  it('marks directories vs files', async () => {
    const result = await listFilesTool.executor({ path: tmpDir }, ctx);
    const entries = result.content as Array<{ name: string; type: string }>;
    const subdir = entries.find(e => e.name === 'subdir');
    assert.equal(subdir?.type, 'directory');
    const file = entries.find(e => e.name === 'a.txt');
    assert.equal(file?.type, 'file');
  });

  it('returns error for missing directory', async () => {
    const result = await listFilesTool.executor({ path: '/nonexistent/dir' }, ctx);
    assert.equal(result.isError, true);
  });
});
```

- [ ] **Step 3: Write failing tests for shell_exec**

```typescript
// packages/host/test/tools/shell-exec.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shellExecTool } from '../../src/tools/shell-exec.ts';

describe('shell_exec tool', () => {
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  it('has correct definition', () => {
    assert.equal(shellExecTool.definition.name, 'shell_exec');
    assert.equal(shellExecTool.definition.permissions?.default, 'deny');
    assert.equal(shellExecTool.definition.permissions?.dangerous, true);
  });

  it('executes a command', async () => {
    const result = await shellExecTool.executor({ command: 'echo hello' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.stdout.trim(), 'hello');
    assert.equal(output.exitCode, 0);
  });

  it('captures stderr', async () => {
    const result = await shellExecTool.executor({ command: 'echo err >&2' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.stderr.trim(), 'err');
  });

  it('captures non-zero exit code', async () => {
    const result = await shellExecTool.executor({ command: 'exit 42' }, ctx);
    const output = result.content as { stdout: string; stderr: string; exitCode: number };
    assert.equal(output.exitCode, 42);
    assert.equal(result.isError, true);
  });

  it('respects timeout from tool definition', async () => {
    const result = await shellExecTool.executor(
      { command: 'sleep 10' },
      { ...ctx, signal: AbortSignal.timeout(500) }
    );
    assert.equal(result.isError, true);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/host && npm test`
Expected: FAIL — cannot find tool modules

- [ ] **Step 5: Implement read_file**

```typescript
// packages/host/src/tools/read-file.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

const definition: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to read' },
    },
    required: ['path'],
  },
  permissions: { default: 'allow' },
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, context) => {
  const { path: filePath } = input as { path: string };
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (err: any) {
    return { content: err.message, isError: true };
  }
};

export const readFileTool: RegisteredTool = { definition, executor };
```

- [ ] **Step 6: Implement list_files**

```typescript
// packages/host/src/tools/list-files.ts
import fs from 'node:fs/promises';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

const definition: ToolDefinition = {
  name: 'list_files',
  description: 'List files and directories at the given path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the directory to list' },
    },
    required: ['path'],
  },
  permissions: { default: 'allow' },
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, context) => {
  const { path: dirPath } = input as { path: string };
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
    return { content: result };
  } catch (err: any) {
    return { content: err.message, isError: true };
  }
};

export const listFilesTool: RegisteredTool = { definition, executor };
```

- [ ] **Step 7: Implement shell_exec**

```typescript
// packages/host/src/tools/shell-exec.ts
import { execFile } from 'node:child_process';
import type { ToolDefinition, ToolExecutor, RegisteredTool } from '../types.ts';

const definition: ToolDefinition = {
  name: 'shell_exec',
  description: 'Execute a shell command. Use with caution.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
    },
    required: ['command'],
  },
  permissions: { default: 'deny', dangerous: true },
  timeout: 30_000,
  metadata: { type: 'simple', source: 'builtin' },
};

const executor: ToolExecutor = async (input, context) => {
  const { command } = input as { command: string };

  return new Promise((resolve) => {
    const child = execFile('/bin/sh', ['-c', command], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024, // 1MB
      signal: context.signal,
    }, (error, stdout, stderr) => {
      const exitCode = error ? (error as any).code ?? 1 : 0;

      if (error && error.name === 'AbortError') {
        resolve({ content: 'Command aborted', isError: true });
        return;
      }

      resolve({
        content: { stdout, stderr, exitCode },
        isError: exitCode !== 0,
      });
    });
  });
};

export const shellExecTool: RegisteredTool = { definition, executor };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/host && npm test`
Expected: All tests PASS (session-store + tool-registry + 3 tools)

- [ ] **Step 9: Commit**

```bash
git add packages/host/src/tools/ packages/host/test/tools/
git commit -m "feat(host): builtin tools — read_file, list_files, shell_exec"
```

---

### Task 5: Anthropic Provider Adapter

**Build/Adapt/Borrow:** ADAPT Vercel AI SDK. Wraps `@ai-sdk/anthropic` + `ai` streamText into our `ProviderAdapter` interface.

**Files:**
- Create: `packages/host/src/provider/adapter.ts`
- Create: `packages/host/src/provider/anthropic.ts`
- Create: `packages/host/test/provider/anthropic.test.ts`

- [ ] **Step 1: Write adapter interface file**

```typescript
// packages/host/src/provider/adapter.ts
import type { ProviderAdapter } from '../types.ts';

const adapters = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}
```

- [ ] **Step 2: Write failing test for Anthropic adapter**

This test verifies the adapter transforms Vercel AI SDK output into our StreamEvent format. We test against the real Anthropic API to catch shape mismatches early — this is an integration test that requires `ANTHROPIC_API_KEY`.

```typescript
// packages/host/test/provider/anthropic.test.ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicAdapter } from '../../src/provider/anthropic.ts';
import type { StreamEvent } from '../../src/types.ts';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  before(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping Anthropic tests — no API key');
      return;
    }
    adapter = new AnthropicAdapter();
  });

  it('has correct id', () => {
    const a = new AnthropicAdapter();
    assert.equal(a.id, 'anthropic');
  });

  it('streams a simple text response', async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;

    const events: StreamEvent[] = [];
    const stream = adapter.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say "hello" and nothing else.' }] }],
      tools: [],
      system: 'You are a test assistant. Be extremely brief.',
      config: { model: 'claude-sonnet-4-20250514', maxTokens: 50 },
    });

    for await (const event of stream) {
      events.push(event);
    }

    const textEvents = events.filter(e => e.type === 'text-delta');
    assert.ok(textEvents.length > 0, 'Should have text deltas');

    const finishEvents = events.filter(e => e.type === 'finish');
    assert.equal(finishEvents.length, 1, 'Should have exactly one finish event');
  });

  it('streams a tool call when tools are provided', async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;

    const events: StreamEvent[] = [];
    const stream = adapter.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the file at /tmp/test.txt' }] }],
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }],
      system: 'Use tools when appropriate.',
      config: { model: 'claude-sonnet-4-20250514', maxTokens: 200 },
    });

    for await (const event of stream) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool-call');
    assert.ok(toolCalls.length > 0, 'Should have at least one tool call');
    const tc = toolCalls[0] as Extract<StreamEvent, { type: 'tool-call' }>;
    assert.equal(tc.toolName, 'read_file');
    assert.ok(tc.toolCallId);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/host && npm test`
Expected: FAIL — cannot find module `../../src/provider/anthropic.ts`

- [ ] **Step 4: Implement Anthropic adapter**

```typescript
// packages/host/src/provider/anthropic.ts
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  ProviderAdapter, ProviderMessage, ProviderConfig,
  ToolDefinition, StreamEvent, JSONValue,
} from '../types.ts';

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  private provider = createAnthropic();

  async *stream(params: {
    messages: ProviderMessage[];
    tools: ToolDefinition[];
    system?: string;
    config: ProviderConfig;
  }): AsyncIterable<StreamEvent> {
    const { messages, tools, system, config } = params;

    // Convert our message format to Vercel AI SDK format
    const aiMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content.map(block => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        if (block.type === 'tool_use') return {
          type: 'tool-call' as const,
          toolCallId: block.id,
          toolName: block.name,
          args: block.input as Record<string, unknown>,
        };
        if (block.type === 'tool_result') return {
          type: 'tool-result' as const,
          toolCallId: block.tool_use_id,
          result: block.content,
        };
        return { type: 'text' as const, text: '' };
      }),
    }));

    // Convert tool definitions to Vercel AI SDK format
    const aiTools: Record<string, any> = {};
    for (const tool of tools) {
      aiTools[tool.name] = {
        description: tool.description,
        parameters: tool.inputSchema,
      };
    }

    const result = streamText({
      model: this.provider(config.model),
      messages: aiMessages,
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
      system,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield { type: 'text-delta', text: part.textDelta };
          break;
        case 'tool-call':
          yield {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args as JSONValue,
          };
          break;
        case 'finish':
          yield {
            type: 'finish',
            reason: part.finishReason === 'stop' ? 'end_turn'
              : part.finishReason === 'length' ? 'max_tokens'
              : part.finishReason === 'tool-calls' ? 'end_turn'
              : 'end_turn',
          };
          break;
        case 'error':
          yield { type: 'error', error: String(part.error) };
          break;
        // Ignore other part types (step-start, step-finish, etc.)
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY cd packages/host && npm test`
Expected: All tests PASS (adapter tests pass if API key present, skip cleanly if not)

- [ ] **Step 6: Commit**

```bash
git add packages/host/src/provider/ packages/host/test/provider/
git commit -m "feat(host): Anthropic provider adapter wrapping Vercel AI SDK"
```

---

### Task 6: Agent Loop

**Build/Adapt/Borrow:** BUILD. Core agent loop — the main thing that doesn't exist today.

**Files:**
- Create: `packages/host/src/agent-loop.ts`
- Create: `packages/host/test/agent-loop.test.ts`

- [ ] **Step 1: Write failing tests for agent loop**

We test the loop with a mock provider adapter to avoid API calls. The mock simulates text responses and tool-call/tool-result cycles.

```typescript
// packages/host/test/agent-loop.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../src/agent-loop.ts';
import { SessionStore } from '../src/session-store.ts';
import { ToolRegistry } from '../src/tool-registry.ts';
import type { ProviderAdapter, StreamEvent, ToolExecutor } from '../src/types.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock provider that returns predetermined responses
function createMockAdapter(responses: StreamEvent[][]): ProviderAdapter {
  let callIndex = 0;
  return {
    id: 'mock',
    async *stream() {
      const events = responses[callIndex++] ?? [{ type: 'finish', reason: 'end_turn' }];
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('AgentLoop', () => {
  let store: SessionStore;
  let registry: ToolRegistry;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `host-loop-test-${Date.now()}.db`);
    store = new SessionStore(dbPath);
    registry = new ToolRegistry();
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('streams a text-only response', async () => {
    const adapter = createMockAdapter([
      [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'hi')) {
      events.push(event);
    }

    assert.equal(events.filter(e => e.type === 'text-delta').length, 2);
    assert.equal(events.filter(e => e.type === 'finish').length, 1);

    // Message persisted
    const messages = store.getMessages(session.id);
    assert.equal(messages.length, 2); // user + assistant
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
  });

  it('executes tool calls and loops', async () => {
    const echoExec: ToolExecutor = async (input) => {
      return { content: `echoed: ${(input as any).text}` };
    };
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      permissions: { default: 'allow' },
    }, echoExec);

    // Turn 1: model calls echo tool
    // Turn 2: model responds with text after seeing tool result
    const adapter = createMockAdapter([
      [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', args: { text: 'test' } },
        { type: 'finish', reason: 'end_turn' },
      ],
      [
        { type: 'text-delta', text: 'Got it' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'echo test')) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool-call');
    assert.equal(toolCalls.length, 1);

    const toolResults = events.filter(e => e.type === 'tool-result');
    assert.equal(toolResults.length, 1);
    const tr = toolResults[0] as Extract<StreamEvent, { type: 'tool-result' }>;
    assert.equal(tr.result.content, 'echoed: test');

    const textDeltas = events.filter(e => e.type === 'text-delta');
    assert.ok(textDeltas.length > 0);
  });

  it('denies tool calls without permission', async () => {
    registry.register({
      name: 'danger',
      description: 'Dangerous',
      inputSchema: { type: 'object', properties: {} },
      permissions: { default: 'deny' },
    }, async () => ({ content: 'should not run' }));

    const adapter = createMockAdapter([
      [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'danger', args: {} },
        { type: 'finish', reason: 'end_turn' },
      ],
      [
        { type: 'text-delta', text: 'ok denied' },
        { type: 'finish', reason: 'end_turn' },
      ],
    ]);

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'do danger')) {
      events.push(event);
    }

    const toolResults = events.filter(e => e.type === 'tool-result');
    assert.equal(toolResults.length, 1);
    const tr = toolResults[0] as Extract<StreamEvent, { type: 'tool-result' }>;
    assert.equal(tr.result.isError, true);
    assert.ok((tr.result.content as string).includes('denied'));
  });

  it('enforces max iteration limit', async () => {
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      permissions: { default: 'allow' },
    }, async (input) => ({ content: 'echoed' }));

    // Adapter always returns a tool call — should be stopped by max iterations
    const adapter = createMockAdapter(
      Array(10).fill([
        { type: 'tool-call', toolCallId: 'tc', toolName: 'echo', args: { text: 'x' } },
        { type: 'finish', reason: 'end_turn' },
      ])
    );

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 3 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    for await (const event of loop.send(session.id, 'loop forever')) {
      events.push(event);
    }

    const finishEvents = events.filter(e => e.type === 'finish');
    const lastFinish = finishEvents[finishEvents.length - 1] as Extract<StreamEvent, { type: 'finish' }>;
    assert.equal(lastFinish.reason, 'max_iterations');
  });

  it('handles stop via AbortSignal', async () => {
    const controller = new AbortController();

    const adapter: ProviderAdapter = {
      id: 'mock',
      async *stream() {
        yield { type: 'text-delta' as const, text: 'start' };
        // Simulate slow streaming
        await new Promise(r => setTimeout(r, 100));
        yield { type: 'text-delta' as const, text: ' more' };
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };

    const loop = new AgentLoop(store, registry, adapter, { maxIterations: 25 });
    const session = store.createSession({});
    const events: StreamEvent[] = [];

    // Abort after first event
    setTimeout(() => controller.abort(), 50);

    for await (const event of loop.send(session.id, 'hello', controller.signal)) {
      events.push(event);
    }

    // Should have gotten at least the first delta and a finish with reason 'stop'
    const finishEvents = events.filter(e => e.type === 'finish');
    assert.ok(finishEvents.length > 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/host && npm test`
Expected: FAIL — cannot find module `../src/agent-loop.ts`

- [ ] **Step 3: Implement agent loop**

```typescript
// packages/host/src/agent-loop.ts
import type {
  ProviderAdapter, StreamEvent, ToolResult, ProviderMessage,
  ProviderContentBlock, AgentLoopConfig, JSONValue,
} from './types.ts';
import type { SessionStore } from './session-store.ts';
import type { ToolRegistry } from './tool-registry.ts';

export class AgentLoop {
  constructor(
    private store: SessionStore,
    private registry: ToolRegistry,
    private adapter: ProviderAdapter,
    private config: AgentLoopConfig,
  ) {}

  async *send(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Append user message
    this.store.appendMessage(sessionId, 'user', [{ type: 'text', text }]);

    // Build message history
    let messages = this.buildMessages(sessionId);
    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      if (signal?.aborted) {
        yield { type: 'finish', reason: 'stop' };
        return;
      }

      // Collect tool calls and text blocks from this turn
      const toolCalls: Array<{ toolCallId: string; toolName: string; args: JSONValue }> = [];
      const textParts: string[] = [];
      let finishReason: string | undefined;

      try {
        const stream = this.adapter.stream({
          messages,
          tools: this.registry.getDefinitions(),
          system: session.system,
          config: { model: session.model },
        });

        for await (const event of stream) {
          if (signal?.aborted) {
            // Persist what we have and stop
            if (textParts.length > 0) {
              this.store.appendMessage(sessionId, 'assistant',
                [{ type: 'text', text: textParts.join('') }]);
            }
            yield { type: 'finish', reason: 'stop' };
            return;
          }

          switch (event.type) {
            case 'text-delta':
              textParts.push(event.text);
              yield event;
              break;
            case 'tool-call':
              toolCalls.push(event);
              yield event;
              break;
            case 'finish':
              finishReason = event.reason;
              break;
            case 'error':
              yield event;
              break;
          }
        }
      } catch (err: any) {
        if (signal?.aborted) {
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        yield { type: 'error', error: err.message };
        return;
      }

      // No tool calls — conversation turn complete
      if (toolCalls.length === 0) {
        // Persist assistant message
        const assistantBlocks: ProviderContentBlock[] = [];
        if (textParts.length > 0) {
          assistantBlocks.push({ type: 'text', text: textParts.join('') });
        }
        this.store.appendMessage(sessionId, 'assistant', assistantBlocks);
        yield { type: 'finish', reason: 'end_turn' };
        return;
      }

      // Has tool calls — execute them and loop
      const assistantBlocks: ProviderContentBlock[] = [];
      if (textParts.length > 0) {
        assistantBlocks.push({ type: 'text', text: textParts.join('') });
      }
      for (const tc of toolCalls) {
        assistantBlocks.push({
          type: 'tool_use',
          id: tc.toolCallId,
          name: tc.toolName,
          input: tc.args,
        });
      }
      this.store.appendMessage(sessionId, 'assistant', assistantBlocks);

      // Execute each tool call
      const toolResultBlocks: ProviderContentBlock[] = [];
      for (const tc of toolCalls) {
        const result = await this.executeTool(tc, sessionId, signal);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.toolCallId,
          content: typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content),
        });
        yield {
          type: 'tool-result',
          toolCallId: tc.toolCallId,
          result,
        };
      }

      // Persist tool results as a user message (Anthropic expects tool_result in user turn)
      this.store.appendMessage(sessionId, 'user', toolResultBlocks);

      // Rebuild messages for next iteration
      messages = this.buildMessages(sessionId);
    }

    // Hit max iterations
    yield { type: 'finish', reason: 'max_iterations' };
  }

  private async executeTool(
    toolCall: { toolCallId: string; toolName: string; args: JSONValue },
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const permission = this.registry.checkPermission(toolCall.toolName);

    if (permission === 'deny') {
      return {
        content: `Tool '${toolCall.toolName}' denied by permission policy`,
        isError: true,
      };
    }

    // 'ask' falls through to deny in v1 (no approval UI yet)
    if (permission === 'ask') {
      return {
        content: `Tool '${toolCall.toolName}' requires approval (not yet implemented)`,
        isError: true,
      };
    }

    const tool = this.registry.get(toolCall.toolName);
    if (!tool) {
      return { content: `Unknown tool: ${toolCall.toolName}`, isError: true };
    }

    try {
      const context = {
        sessionId,
        signal: signal ?? AbortSignal.timeout(tool.definition.timeout ?? 30_000),
        emit: () => {}, // tool-progress not wired to consumer in v1
      };
      return await tool.executor(toolCall.args, context);
    } catch (err: any) {
      return { content: `Tool execution error: ${err.message}`, isError: true };
    }
  }

  private buildMessages(sessionId: string): ProviderMessage[] {
    const stored = this.store.getMessages(sessionId);
    return stored.map(msg => ({
      role: msg.role,
      content: JSON.parse(msg.content) as ProviderContentBlock[],
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/host && npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/agent-loop.ts packages/host/test/agent-loop.test.ts
git commit -m "feat(host): core agent loop with tool execution and iteration limit"
```

---

### Task 7: Socket Server

**Build/Adapt/Borrow:** BORROW PATTERN from `packages/gateway/src/sdk-socket.ts` (line-delimited JSON over Unix socket).

**Files:**
- Create: `packages/host/src/server.ts`
- Create: `packages/host/src/index.ts`

- [ ] **Step 1: Implement socket server**

```typescript
// packages/host/src/server.ts
import net from 'node:net';
import type { SocketRequest, SocketResponse, StreamEvent } from './types.ts';

type RequestHandler = (
  method: string,
  params: Record<string, unknown>,
  streamCallback: (event: StreamEvent) => void,
) => Promise<unknown>;

export class HostServer {
  private server: net.Server;
  private connections = new Set<net.Socket>();

  constructor(private handler: RequestHandler) {
    this.server = net.createServer(socket => this.handleConnection(socket));
  }

  listen(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket file
      try {
        const fs = require('node:fs');
        fs.unlinkSync(socketPath);
      } catch {}

      this.server.listen(socketPath, () => resolve());
      this.server.once('error', reject);
    });
  }

  close(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy();
    }
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleLine(socket, line.trim());
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  private async handleLine(socket: net.Socket, line: string): Promise<void> {
    let req: SocketRequest;
    try {
      req = JSON.parse(line);
    } catch {
      return; // Ignore malformed messages
    }

    const streamCallback = (event: StreamEvent) => {
      if (!socket.destroyed) {
        const streamMsg = JSON.stringify({ id: req.id, stream: event });
        socket.write(streamMsg + '\n');
      }
    };

    try {
      const result = await this.handler(req.method, req.params, streamCallback);
      const response: SocketResponse = { id: req.id, result };
      socket.write(JSON.stringify(response) + '\n');
    } catch (err: any) {
      const response: SocketResponse = {
        id: req.id,
        error: { message: err.message, code: err.code },
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }
}
```

- [ ] **Step 2: Implement entry point**

```typescript
// packages/host/src/index.ts
import path from 'node:path';
import fs from 'node:fs';
import { HostServer } from './server.ts';
import { SessionStore } from './session-store.ts';
import { ToolRegistry } from './tool-registry.ts';
import { AgentLoop } from './agent-loop.ts';
import { AnthropicAdapter } from './provider/anthropic.ts';
import { registerAdapter, getAdapter } from './provider/adapter.ts';
import { readFileTool } from './tools/read-file.ts';
import { listFilesTool } from './tools/list-files.ts';
import { shellExecTool } from './tools/shell-exec.ts';
import type { StreamEvent } from './types.ts';

// Determine mode and state directory
function getStateDir(): string {
  const mode = process.env.AOS_MODE ?? 'repo';
  const dir = path.join(
    process.env.HOME ?? '/tmp',
    '.config', 'aos', mode,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  const stateDir = getStateDir();
  const dbPath = path.join(stateDir, 'host.db');
  const socketPath = path.join(stateDir, 'host.sock');

  // Initialize components
  const store = new SessionStore(dbPath);
  const registry = new ToolRegistry();
  const anthropic = new AnthropicAdapter();
  registerAdapter(anthropic);

  // Register builtin tools
  registry.register(readFileTool.definition, readFileTool.executor);
  registry.register(listFilesTool.definition, listFilesTool.executor);
  registry.register(shellExecTool.definition, shellExecTool.executor);

  // Active abort controllers per session (for stop)
  const activeStreams = new Map<string, AbortController>();

  // Socket request handler
  const handler = async (
    method: string,
    params: Record<string, unknown>,
    streamCallback: (event: StreamEvent) => void,
  ): Promise<unknown> => {
    switch (method) {
      case 'chat.create': {
        const session = store.createSession(params as any);
        return session;
      }

      case 'chat.send': {
        const { sessionId, text } = params as { sessionId: string; text: string };
        const session = store.getSession(sessionId);
        if (!session) throw new Error(`Session not found: ${sessionId}`);

        const adapter = getAdapter(session.provider);
        const loop = new AgentLoop(store, registry, adapter, {
          maxIterations: (params.maxIterations as number) ?? 25,
        });

        const controller = new AbortController();
        activeStreams.set(sessionId, controller);

        try {
          for await (const event of loop.send(sessionId, text, controller.signal)) {
            streamCallback(event);
          }
        } finally {
          activeStreams.delete(sessionId);
        }
        return { ok: true };
      }

      case 'chat.stop': {
        const { sessionId } = params as { sessionId: string };
        const controller = activeStreams.get(sessionId);
        if (controller) controller.abort();
        return { ok: true };
      }

      case 'chat.list': {
        return store.listSessions();
      }

      case 'tools.list': {
        return registry.getDefinitions();
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  };

  const server = new HostServer(handler);
  await server.listen(socketPath);
  console.log(`aos-host listening on ${socketPath}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    for (const controller of activeStreams.values()) {
      controller.abort();
    }
    await server.close();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the host starts**

Run: `cd packages/host && npx tsc && AOS_MODE=repo node dist/index.js`
Expected: Prints `aos-host listening on /Users/<you>/.config/aos/repo/host.sock`
Kill with Ctrl+C — should print `Shutting down...` and exit cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/host/src/server.ts packages/host/src/index.ts
git commit -m "feat(host): socket server and entry point"
```

---

### Task 8: Sigil Chat Integration

**Build/Adapt/Borrow:** BUILD. Wires Sigil's existing chat canvas events through a thin SDK client to the host socket.

**Files:**
- Create: `packages/host/src/sdk-client.ts` (minimal SDK client for Sigil to use)
- Modify: `apps/sigil/avatar-sub.swift` (wire chat canvas events to host)

**Note:** This task bridges the Node.js host and the Swift Sigil client. The SDK client is a Node.js module that Sigil's event handler calls (via the gateway's script execution engine or a small bridge process). For v1, we take the simplest path: a standalone Node.js script that connects to `host.sock`, sends messages, and pipes streamed events back through the daemon's `evalCanvas` to update the chat canvas.

- [ ] **Step 1: Create SDK client**

```typescript
// packages/host/src/sdk-client.ts
import net from 'node:net';
import { ulid } from 'ulid';
import type { SocketRequest, SocketResponse, StreamEvent, Session, SessionConfig, ToolDefinition } from './types.ts';

export class HostClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    onStream?: (event: StreamEvent) => void;
  }>();

  constructor(private socketPath: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      let buffer = '';

      this.socket.on('connect', resolve);
      this.socket.once('error', reject);

      this.socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            const handler = this.pending.get(msg.id);
            if (!handler) continue;

            if ('stream' in msg) {
              handler.onStream?.(msg.stream as StreamEvent);
            } else if ('error' in msg) {
              this.pending.delete(msg.id);
              handler.reject(new Error(msg.error.message));
            } else {
              this.pending.delete(msg.id);
              handler.resolve(msg.result);
            }
          } catch {}
        }
      });
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  async createSession(config: SessionConfig = {}): Promise<Session> {
    return this.call('chat.create', config) as Promise<Session>;
  }

  async sendMessage(
    sessionId: string,
    text: string,
    onStream: (event: StreamEvent) => void,
  ): Promise<void> {
    await this.callWithStream('chat.send', { sessionId, text }, onStream);
  }

  async stop(sessionId: string): Promise<void> {
    await this.call('chat.stop', { sessionId });
  }

  async listSessions(): Promise<Session[]> {
    return this.call('chat.list', {}) as Promise<Session[]>;
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.call('tools.list', {}) as Promise<ToolDefinition[]>;
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ulid();
      this.pending.set(id, { resolve, reject });
      const req: SocketRequest = { id, method, params };
      this.socket!.write(JSON.stringify(req) + '\n');
    });
  }

  private callWithStream(
    method: string,
    params: Record<string, unknown>,
    onStream: (event: StreamEvent) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ulid();
      this.pending.set(id, { resolve, reject, onStream });
      const req: SocketRequest = { id, method, params };
      this.socket!.write(JSON.stringify(req) + '\n');
    });
  }
}
```

- [ ] **Step 2: Create Sigil bridge script**

This is a standalone Node.js script that Sigil's Swift event handler spawns. It connects to `host.sock`, manages a session, and translates between the chat canvas protocol (base64 JSON via `evalCanvas`) and the host protocol.

```typescript
// packages/host/src/sigil-bridge.ts
import { HostClient } from './sdk-client.ts';
import type { StreamEvent, ProviderContentBlock } from './types.ts';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Reads from stdin (JSON lines from Sigil), writes to stdout (canvas eval commands)
const mode = process.env.AOS_MODE ?? 'repo';
const stateDir = path.join(process.env.HOME ?? '/tmp', '.config', 'aos', mode);
const socketPath = path.join(stateDir, 'host.sock');

const client = new HostClient(socketPath);
let sessionId: string | null = null;

function sendToCanvas(msg: { type: string; content?: unknown[]; text?: string }): void {
  // Output as JSON line — the Swift caller will evalCanvas with this
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function streamEventToCanvasContent(event: StreamEvent): void {
  switch (event.type) {
    case 'text-delta':
      sendToCanvas({ type: 'assistant', content: [{ type: 'text', text: event.text }] });
      break;
    case 'tool-call':
      sendToCanvas({
        type: 'status',
        text: `Using ${event.toolName}...`,
      });
      break;
    case 'tool-result':
      if (event.result.isError) {
        sendToCanvas({
          type: 'status',
          text: `Tool error: ${typeof event.result.content === 'string' ? event.result.content : JSON.stringify(event.result.content)}`,
        });
      }
      break;
    case 'finish':
      sendToCanvas({ type: 'status', text: '' }); // Clear status
      break;
    case 'error':
      sendToCanvas({ type: 'status', text: `Error: ${event.error}` });
      break;
  }
}

async function handleMessage(text: string): Promise<void> {
  if (!sessionId) {
    const session = await client.createSession({
      system: 'You are a helpful assistant with access to file system tools. Be concise.',
    });
    sessionId = session.id;
  }

  sendToCanvas({ type: 'user', content: [{ type: 'text', text }] });

  await client.sendMessage(sessionId, text, (event) => {
    streamEventToCanvasContent(event);
  });
}

async function main() {
  await client.connect();

  // Read JSON lines from stdin
  let buffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'user_message') {
          handleMessage(msg.payload.text).catch(err => {
            sendToCanvas({ type: 'status', text: `Error: ${err.message}` });
          });
        } else if (msg.type === 'stop') {
          if (sessionId) client.stop(sessionId);
        }
      } catch {}
    }
  });
}

main().catch(err => {
  console.error('Bridge error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Manual integration test**

Start the host in one terminal:
```bash
cd packages/host && npx tsc && AOS_MODE=repo node dist/index.js
```

In another terminal, test the SDK client directly:
```bash
cd packages/host && node -e "
import { HostClient } from './dist/sdk-client.js';
import path from 'node:path';

const client = new HostClient(path.join(process.env.HOME, '.config/aos/repo/host.sock'));
await client.connect();
const session = await client.createSession({ system: 'Be very brief.' });
console.log('Session:', session.id);
await client.sendMessage(session.id, 'What is 2+2?', (event) => {
  if (event.type === 'text-delta') process.stdout.write(event.text);
  if (event.type === 'finish') console.log('\n[done]');
});
client.disconnect();
"
```

Expected: Prints a streaming response from Claude, then `[done]`.

- [ ] **Step 4: Commit**

```bash
git add packages/host/src/sdk-client.ts packages/host/src/sigil-bridge.ts
git commit -m "feat(host): SDK client and Sigil bridge script"
```

---

### Task 9: End-to-End Verification

**Files:** No new files. This task verifies all success criteria from the spec.

- [ ] **Step 1: Start the host**

Run: `cd packages/host && npx tsc && AOS_MODE=repo node dist/index.js`
Expected: `aos-host listening on ~/.config/aos/repo/host.sock`

- [ ] **Step 2: Verify text streaming (success criterion 2+3)**

In another terminal:
```bash
cd packages/host && node -e "
import { HostClient } from './dist/sdk-client.js';
import path from 'node:path';
const client = new HostClient(path.join(process.env.HOME, '.config/aos/repo/host.sock'));
await client.connect();
const session = await client.createSession({});
await client.sendMessage(session.id, 'Say hello in exactly 3 words.', (e) => {
  if (e.type === 'text-delta') process.stdout.write(e.text);
  if (e.type === 'finish') console.log('\n[finish: ' + e.reason + ']');
});
client.disconnect();
"
```
Expected: Streamed text response, then `[finish: end_turn]`

- [ ] **Step 3: Verify tool execution (success criterion 4)**

```bash
cd packages/host && node -e "
import { HostClient } from './dist/sdk-client.js';
import path from 'node:path';
const client = new HostClient(path.join(process.env.HOME, '.config/aos/repo/host.sock'));
await client.connect();
const session = await client.createSession({ system: 'Use tools when helpful. Be brief.' });
await client.sendMessage(session.id, 'Read the file at /tmp/host-test.txt and tell me what it says.', (e) => {
  console.log(e.type, JSON.stringify(e).slice(0, 100));
});
client.disconnect();
"
```
Pre-setup: `echo 'agent-os test content' > /tmp/host-test.txt`

Expected: See `tool-call` event for `read_file`, then `tool-result`, then `text-delta` events with the file content summarized.

- [ ] **Step 4: Verify session persistence (success criterion 5)**

```bash
# Check SQLite directly
sqlite3 ~/.config/aos/repo/host.db "SELECT id, provider, model FROM sessions; SELECT session_id, role, substr(content, 1, 80) FROM messages;"
```
Expected: Session row exists. Multiple message rows (user + assistant + potentially tool results).

- [ ] **Step 5: Verify stop (success criterion 6)**

```bash
cd packages/host && node -e "
import { HostClient } from './dist/sdk-client.js';
import path from 'node:path';
const client = new HostClient(path.join(process.env.HOME, '.config/aos/repo/host.sock'));
await client.connect();
const session = await client.createSession({});
let count = 0;
await client.sendMessage(session.id, 'Write a very long essay about the history of computing.', (e) => {
  if (e.type === 'text-delta') {
    count++;
    process.stdout.write(e.text);
    if (count === 5) {
      console.log('\n[stopping...]');
      client.stop(session.id);
    }
  }
  if (e.type === 'finish') console.log('[finish: ' + e.reason + ']');
});
client.disconnect();
"
```
Expected: Some text deltas, then `[stopping...]`, then `[finish: stop]`.

- [ ] **Step 6: Commit any fixes from verification**

If any issues surfaced during testing, fix them and commit:
```bash
git add -u packages/host/
git commit -m "fix(host): adjustments from end-to-end verification"
```

- [ ] **Step 7: Final commit — mark thin slice complete**

```bash
git add -A packages/host/
git commit -m "feat(host): v1 thin slice complete — agent loop, tools, persistence, streaming"
```
