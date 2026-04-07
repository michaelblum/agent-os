# AOS Gateway: MCP Surface, TypeScript SDK, and Cross-Harness Coordination

**Date:** 2026-04-07
**Status:** Approved design, pending implementation plan

## Problem

AI agents consume agent-os via bash calls to the `aos` CLI: `aos see --json`, `aos do click ...`, etc. This works but has compounding costs:

- **Context bloat**: Every CLI flag and output format must be documented in CLAUDE.md or system prompts. As aos grows, so does the token cost of teaching agents how to use it.
- **Multi-step inefficiency**: A perceive-decide-act loop requires 3+ sequential bash tool calls, each burning a round-trip through the agent harness.
- **Fragile parsing**: Agents reason over raw JSON output in-context (non-deterministic). Filtering and decision logic that should be deterministic code instead happens in the LLM's head.
- **No cross-harness coordination**: Multiple agent sessions (Claude Code CLI, Codex, Claude Desktop) coordinate via file edits (`task-queue.md`, scratchpad dropbox files). This is fragile, racy, and invisible to agents in other harnesses.

## Key Insight

The shift described in "Agentic Systems Engineering: From Bash to Secure Execution Layers" applies directly to agent-os: instead of agents being "terminal operators" chaining bash calls, they become "developers" writing typed scripts against a desktop API. The desktop becomes a programmable surface — "Browserbase for macOS."

Scripts execute **off-stage**: the agent writes code, the code runs outside the context window, and only filtered results come back. This makes data retrieval deterministic and reduces token usage significantly.

## Design

### Architecture Overview

Three layers with clear boundaries:

```
  Harnesses                    Gateway                         System
  (consumers)                  (contract + coordination)       (execution)
  ──────────                   ──────────────────────          ──────────

  Claude Code ─┐
  Codex ───────┤  MCP     ┌──────────────────────┐    Unix    ┌──────────┐
  Claude      ─┤  (stdio/ │    aos-gateway       │   socket   │   aos    │
   Desktop     │   SSE)   │                      │──────────→│  daemon   │
  Future      ─┘          │  - MCP server (10)   │            │  (Swift)  │
   harnesses              │  - Engine router     │            └──────────┘
                          │  - Coordination store│
                          │  - Script registry   │
                          └──────────────────────┘
```

- **aos daemon** (Swift): unchanged. Desktop execution layer — perception, action, display, voice. Speaks NDJSON over a Unix socket.
- **aos-gateway** (Node.js): new component. Owns the MCP contract, script execution, coordination store, and script registry. Connects to the daemon as a client.
- **Harnesses**: connect to the gateway via MCP. They see 10 tools. They never talk to the daemon directly.

### Separation of Concerns

| Component | Owns | Does NOT own |
|-----------|------|-------------|
| aos daemon | Desktop execution (see, do, show, say), system state, permissions, launchd lifecycle | Script execution, coordination, MCP protocol |
| aos-gateway | MCP contract, script execution engines, coordination store, script registry | Desktop APIs (proxies to daemon), daemon lifecycle |
| SDK (`aos-sdk.js`) | Typed interface scripts program against | Engine specifics, transport details |

---

## MCP Surface

### Tool Inventory (10 tools)

| # | Tool | Group | Purpose |
|---|------|-------|---------|
| 1 | `discover_capabilities` | Discovery | Browse SDK namespaces and method signatures |
| 2 | `search_tools` | Discovery | Semantic search for SDK methods + saved scripts |
| 3 | `run_os_script` | Execution | Execute a script off-stage against the SDK |
| 4 | `save_script` | Execution | Persist a script for reuse |
| 5 | `list_scripts` | Execution | List saved scripts with optional filters |
| 6 | `register_session` | Coordination | Register a harness session on the bus |
| 7 | `set_state` | Coordination | Write to shared key-value store (set, CAS, lock acquire/release) |
| 8 | `get_state` | Coordination | Read from shared key-value store (exact or glob) |
| 9 | `post_message` | Coordination | Post to a channel |
| 10 | `read_stream` | Coordination | Read messages from a channel with cursor |

### Script Language

Scripts are **TypeScript** at the authoring layer. The gateway **strips type annotations** using esbuild (`--loader=ts`, sub-millisecond syntax stripping, not full compilation) before dispatching to any engine. All engines receive pure JavaScript.

This means:
- Agents write TS naturally and benefit from type context in `discover_capabilities`
- No TypeScript compiler in any engine's hot path
- The same script runs identically in Node subprocess and future JSC contexts
- Saved scripts are stored as authored (with type annotations) for readability

### Tool Schemas

#### `discover_capabilities`

```json
{
  "name": "discover_capabilities",
  "description": "Returns SDK namespaces and method signatures. Call before writing scripts to learn what the SDK can do.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "namespace": {
        "type": "string",
        "enum": ["perception", "action", "display", "voice", "coordination", "scripts"],
        "description": "Filter to a specific namespace. Omit for all namespace summaries."
      }
    }
  }
}
```

Returns: namespace summaries (when no filter) or full method signatures with TS-style type annotations (when filtered). Also surfaces saved scripts alongside built-in SDK methods.

#### `search_tools`

```json
{
  "name": "search_tools",
  "description": "Search SDK methods and saved scripts by keyword or intent. Returns matching items with signatures and usage examples.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "What you're trying to do, e.g. 'find a button in a window' or 'coordinate with another session'"
      }
    },
    "required": ["query"]
  }
}
```

#### `run_os_script`

```json
{
  "name": "run_os_script",
  "description": "Execute a TypeScript/JavaScript script against the aos SDK. The script runs off-stage; only the return value and logs come back to your context. The `aos` object is pre-loaded.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "script": {
        "type": "string",
        "description": "Inline JS/TS code. Mutually exclusive with script_id."
      },
      "script_id": {
        "type": "string",
        "description": "Name of a saved script. Mutually exclusive with script."
      },
      "params": {
        "type": "object",
        "description": "Parameters injected as the `params` global. Used with both inline scripts and saved scripts."
      },
      "intent": {
        "type": "string",
        "enum": ["perception", "action", "coordination", "mixed"],
        "description": "Hint for engine selection, logging, and approval policy. Agents should always provide this."
      },
      "timeout": {
        "type": "number",
        "default": 10000,
        "description": "Max execution time in milliseconds."
      },
      "engine": {
        "type": "string",
        "enum": ["auto", "node-subprocess", "daemon-jsc"],
        "default": "auto",
        "description": "Engine override for advanced use. Normally leave as 'auto' — the gateway selects based on intent + policy. May be denied or overridden by gateway policy."
      }
    }
  }
}
```

**Engine selection semantics**: `engine: "auto"` combined with `intent` is the normal operating mode. The gateway's config-based policy determines which engine handles each intent. Explicit engine selection is for advanced cases, testing, or experiments, and the gateway may override it if policy dictates (e.g., a `daemon-jsc` request when that engine isn't available falls back to `node-subprocess`).

Returns:
```json
{
  "result": "/* script return value, JSON-serialized */",
  "logs": ["/* captured console.log output */"],
  "duration_ms": 142,
  "engine": "node-subprocess"
}
```

#### `save_script`

```json
{
  "name": "save_script",
  "description": "Save a script for reuse. Saved scripts appear in discover_capabilities and search_tools, and can be invoked via run_os_script with script_id.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Unique script name, e.g. 'close-mail-drafts'. Alphanumeric + hyphens.",
        "pattern": "^[a-z0-9][a-z0-9-]*$"
      },
      "script": { "type": "string", "description": "The JS/TS source code" },
      "description": { "type": "string", "description": "What the script does" },
      "intent": { "type": "string", "enum": ["perception", "action", "coordination", "mixed"] },
      "parameters": {
        "type": "object",
        "description": "JSON Schema describing the `params` the script expects"
      },
      "overwrite": {
        "type": "boolean",
        "default": false,
        "description": "If true, overwrite an existing script with the same name (previous version is backed up). If false, error on name collision."
      }
    },
    "required": ["name", "script", "description", "intent"]
  }
}
```

**Name collision behavior**: By default, `save_script` errors if a script with the same name exists. Pass `overwrite: true` to replace it; the previous version is moved to `<name>.prev.ts` as a one-deep backup. This prevents accidental overwrites while keeping updates simple.

#### `list_scripts`

```json
{
  "name": "list_scripts",
  "description": "List saved scripts with optional filters.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string", "enum": ["perception", "action", "coordination", "mixed"] },
      "query": { "type": "string", "description": "Keyword search over name and description" }
    }
  }
}
```

#### `register_session`

```json
{
  "name": "register_session",
  "description": "Register this agent session on the coordination bus. Call once at session start.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Session name, e.g. 'lead-dev', 'studio-ui'" },
      "role": { "type": "string", "description": "What this session does, e.g. 'renderer-work'" },
      "harness": { "type": "string", "description": "'claude-code', 'codex', 'claude-desktop', etc." },
      "capabilities": { "type": "array", "items": { "type": "string" }, "description": "What this session can do, e.g. ['visual-preview', 'file-editing']" }
    },
    "required": ["name", "role", "harness"]
  }
}
```

#### `set_state`

```json
{
  "name": "set_state",
  "description": "Write to the shared key-value store. Supports unconditional set, compare-and-swap, and lock acquire/release.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "value": { "description": "Any JSON value. Pass null to delete the key (on mode 'set' only)." },
      "mode": {
        "type": "string",
        "enum": ["set", "cas", "acquire_lock", "release_lock"],
        "default": "set",
        "description": "set: unconditional write. cas: write only if version matches expected_version. acquire_lock: set if unowned/expired/owned-by-caller. release_lock: clear ownership if owned by caller."
      },
      "expected_version": { "type": "number", "description": "Required when mode is 'cas'." },
      "owner": { "type": "string", "description": "Session name. Required for lock modes." },
      "ttl": { "type": "number", "description": "Seconds until expiry." }
    },
    "required": ["key"]
  }
}
```

Returns:
```json
{
  "ok": true,
  "version": 3,
  "key": "lock:sigil/studio/js/ui.js"
}
```

On failure:
```json
{
  "ok": false,
  "reason": "owned_by_other",
  "current_owner": "ui-designer",
  "current_version": 2,
  "expires_at": "2026-04-07T13:00:00Z"
}
```

#### `get_state`

```json
{
  "name": "get_state",
  "description": "Read from the shared key-value store. Supports exact key or prefix glob.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "key": { "type": "string", "description": "Exact key or prefix glob (e.g. 'lock:sigil/*')" }
    },
    "required": ["key"]
  }
}
```

Returns an array of `StateEntry` objects. For exact key matches, the array contains zero or one entry. For glob matches, it contains all matching entries. Callers always receive an array — no format ambiguity based on input.

#### `post_message`

```json
{
  "name": "post_message",
  "description": "Post a message to a channel. Use a session name as channel for direct messages, or a topic name for broadcasts.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": { "type": "string", "description": "Channel name. 'all' for broadcast." },
      "payload": { "description": "Any JSON-serializable content." },
      "from": { "type": "string", "description": "Sender session name." }
    },
    "required": ["channel", "payload", "from"]
  }
}
```

#### `read_stream`

```json
{
  "name": "read_stream",
  "description": "Read messages from a channel. Returns messages in chronological order.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": { "type": "string", "description": "Channel to read from." },
      "since": { "type": "string", "description": "Message ID or ISO timestamp. Returns messages after this point. Omit for most recent." },
      "limit": { "type": "number", "default": 50, "description": "Max messages to return." }
    },
    "required": ["channel"]
  }
}
```

---

## TypeScript SDK Interface

The SDK exists as two artifacts:
- **`aos-sdk.d.ts`**: Type definitions. Used by `discover_capabilities` to generate agent-facing documentation and by saved scripts for self-documentation.
- **`aos-sdk.js`**: Runtime implementation. A single file with zero npm dependencies. Injected into every script execution context by the engine.

### Script Sandboxing

Scripts should treat the SDK as their **primary affordance for interacting with the world**. The SDK is the desktop API.

In the v1 Node subprocess engine, scripts technically have access to the full Node.js runtime (`fs`, `net`, `child_process`, etc.). However:

- The SDK documentation and `discover_capabilities` output should frame the SDK as the standard way to interact with the desktop and coordination bus.
- Direct Node API usage is treated as **advanced/opt-in** — not forbidden, but not the norm. The `discover_capabilities` output does not advertise Node APIs.
- This constraint exists for **portability**: scripts that stick to the SDK surface will work identically on the future `daemon-jsc` engine (which has no Node APIs). Scripts that use Node APIs are implicitly pinned to `node-subprocess`.
- The gateway does not attempt to restrict Node APIs at the runtime level in v1. Sandboxing is by convention and documentation, not enforcement. Enforcement can be added later if needed (via V8 isolates, Deno permissions, or a restricted Node loader).

### The `aos` Global Object

```typescript
declare const aos: AOS;
declare const params: Record<string, unknown>;  // injected from run_os_script params

interface AOS {
  // ── Perception (flat, high-frequency) ──────────────
  getWindows(filter?: WindowFilter): Promise<Window[]>;
  getScreen(options?: ScreenOptions): Promise<ScreenCapture>;
  getCursor(): Promise<CursorInfo>;
  inspect(target: ElementRef): Promise<AXNode>;
  findElements(criteria: ElementCriteria): Promise<AXNode[]>;

  // ── Action (flat, high-frequency) ──────────────────
  click(target: ClickTarget, options?: ClickOptions): Promise<void>;
  type(text: string, options?: TypeOptions): Promise<void>;
  press(...keys: string[]): Promise<void>;
  focus(target: ElementRef): Promise<void>;
  scroll(target: ScrollTarget, direction: Direction, amount?: number): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;

  // ── Display (namespaced) ───────────────────────────
  show: DisplayNamespace;

  // ── Voice ──────────────────────────────────────────
  say(text: string, options?: SayOptions): Promise<void>;

  // ── Coordination (namespaced, 1:1 with MCP tools) ─
  coordination: CoordinationNamespace;

  // ── Scripts (namespaced) ───────────────────────────
  scripts: ScriptRegistryNamespace;
}
```

### Display Namespace

```typescript
interface DisplayNamespace {
  canvas(options: CanvasOptions): Promise<CanvasHandle>;
  update(canvasId: string, html: string): Promise<void>;
  remove(canvasId: string): Promise<void>;
}

interface CanvasOptions {
  display?: number;
  html: string;
  frame?: Rect;
  transparent?: boolean;
}

interface CanvasHandle {
  id: string;
  display: number;
  frame: Rect;
}
```

### Coordination Namespace

Maps 1:1 to the MCP coordination tools. Calling `aos.coordination.setState(...)` in a script invokes the exact same gateway operation as calling the `set_state` MCP tool directly from a harness.

```typescript
interface CoordinationNamespace {
  // Session management
  register(name: string, role: string, harness: string, capabilities?: string[]): Promise<Session>;
  whoIsOnline(): Promise<Session[]>;

  // Shared state (1:1 with set_state / get_state MCP tools)
  // Always returns an array. Exact key → 0 or 1 entry. Glob pattern → all matches.
  getState(key: string): Promise<StateEntry[]>;
  setState(key: string, value: unknown, options?: SetStateOptions): Promise<StateResult>;

  // Messaging (1:1 with post_message / read_stream MCP tools)
  postMessage(channel: string, payload: unknown, from?: string): Promise<{ id: string }>;
  readStream(channel: string, options?: ReadStreamOptions): Promise<Message[]>;

  // ── Lock convenience helpers ──
  // These are ergonomic wrappers over setState, not new primitives.

  /**
   * Acquire a lock. Retries with backoff if owned by another session.
   * Returns a release function for use in try/finally.
   *
   * Usage:
   *   const unlock = await aos.coordination.acquireLock("lock:file.js", "my-session", { ttl: 3600 });
   *   try { ... } finally { await unlock(); }
   */
  acquireLock(key: string, owner: string, options?: { ttl?: number; retries?: number; backoffMs?: number }): Promise<() => Promise<void>>;

  /**
   * Run a callback while holding a lock. Automatically acquires and releases.
   *
   * Usage:
   *   await aos.coordination.withLock("lock:file.js", "my-session", async () => { ... });
   */
  withLock(key: string, owner: string, fn: () => Promise<unknown>, options?: { ttl?: number }): Promise<unknown>;
}

interface SetStateOptions {
  mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
  expectedVersion?: number;
  owner?: string;
  ttl?: number;
}

interface StateResult {
  ok: boolean;
  version?: number;
  reason?: string;
  currentOwner?: string;
  currentVersion?: number;
}

interface ReadStreamOptions {
  since?: string;  // message ID or ISO timestamp
  limit?: number;  // default 50
}
```

`whoIsOnline()` is a query over the `sessions` table filtered by `status = 'online'` and `last_heartbeat` within a staleness threshold. It is not a separate mechanism.

### Script Registry Namespace

```typescript
interface ScriptRegistryNamespace {
  list(filter?: { intent?: Intent; query?: string }): Promise<SavedScript[]>;
  load(name: string): Promise<string>;  // returns script source
  save(name: string, script: string, meta: ScriptMeta, overwrite?: boolean): Promise<void>;
  run(name: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface SavedScript {
  name: string;
  description: string;
  intent: Intent;
  parameters?: Record<string, unknown>;  // JSON Schema
  createdBy?: string;
  createdAt?: string;
}

interface ScriptMeta {
  description: string;
  intent: Intent;
  parameters?: Record<string, unknown>;
}
```

### Core Types

```typescript
// ── Geometry (consistent with shared/schemas/spatial-topology) ──
interface Point { x: number; y: number; }
interface Size { width: number; height: number; }
interface Rect { x: number; y: number; width: number; height: number; }

// ── Perception types ──
interface WindowFilter { app?: string; title?: string; focused?: boolean; }
interface Window {
  id: string; app: string; title: string; frame: Rect;
  focused: boolean; minimized: boolean;
  buttons: { role: string; title?: string; enabled: boolean }[];
}
interface ScreenOptions { displayId?: number; region?: Rect; }
interface ScreenCapture { displayId: number; image: string; dimensions: Size; }
interface CursorInfo { position: Point; app: string; window?: string; element?: AXNode; }
interface AXNode {
  role: string; title?: string; value?: string;
  frame?: Rect; enabled?: boolean; focused?: boolean;
  children?: AXNode[]; actions?: string[];
}
interface ElementCriteria { app?: string; role?: string; title?: string; value?: string; }

// ── Action types ──
type ClickTarget = Point | ElementRef | { windowId: string; role: string; title?: string };
type ElementRef = { pid?: number; windowId?: string; role: string; title?: string; path?: string };
type ScrollTarget = Point | ElementRef | 'cursor';
type Direction = 'up' | 'down' | 'left' | 'right';
interface ClickOptions { button?: 'left' | 'right'; count?: 1 | 2; }
interface TypeOptions { delay?: number; }
interface SayOptions { voice?: string; rate?: number; }
type Intent = 'perception' | 'action' | 'coordination' | 'mixed';

// ── Coordination types ──
interface Session {
  id: string; name: string; role: string; harness: string;
  capabilities: string[]; status: 'online' | 'offline';
  registeredAt: string; lastHeartbeat: string;
}
interface StateEntry {
  key: string; value: unknown; version: number;
  owner?: string; updatedAt: string; expiresAt?: string;
}
interface Message {
  id: string; channel: string; from: string;
  payload: unknown; createdAt: string;
}
```

### Transport Abstraction (Internal)

Not exposed to script authors. The SDK runtime communicates with the gateway through an abstract transport, configured by the engine at setup time:

```typescript
// Internal to aos-sdk.js
interface SDKTransport {
  call(domain: 'system' | 'coordination' | 'scripts', method: string, params: unknown): Promise<unknown>;
}
```

**Node subprocess engine**: The gateway starts a lightweight HTTP server on a per-execution Unix socket. The SDK connects via `AOS_GATEWAY_SOCK` environment variable. The subprocess's stdout is reserved for capturing `console.log` output; the script's return value is sent back via the transport.

**JSC engine (future)**: System-domain calls (`getWindows`, `click`, etc.) become bridged Swift functions — in-process, zero overhead. Coordination-domain calls go to the gateway via socket.

The engine sets a single config global before script execution:

```javascript
globalThis.__aos_config = {
  daemonSocket: "/Users/Michael/.config/aos/repo/sock",
  gatewaySocket: "/tmp/aos-gateway-exec-<id>.sock",
  sessionId: "lead-dev"
};
```

The SDK reads this on first use. This is the **only** thing that varies between engines.

---

## Gateway Architecture

### Process Model

The gateway is a single Node.js process:

```
┌──────────────────────────────────────────────────────┐
│  aos-gateway                                          │
│                                                       │
│  ┌────────────┐                                       │
│  │ MCP Server │ ← stdio (Claude Code, Codex)          │
│  │            │ ← SSE  (Claude Desktop, others)       │
│  └─────┬──────┘                                       │
│        │                                              │
│  ┌─────┴──────────────────────────────────────────┐   │
│  │              Request Router                     │   │
│  │                                                 │   │
│  │  ┌──────────────┐ ┌───────────┐ ┌───────────┐  │   │
│  │  │ Engine Router │ │ Coord     │ │ Script    │  │   │
│  │  │              │ │ Service   │ │ Registry  │  │   │
│  │  │ ┌──────────┐ │ │ (SQLite)  │ │ (files)   │  │   │
│  │  │ │node-sub  │ │ │           │ │           │  │   │
│  │  │ └──────────┘ │ └───────────┘ └───────────┘  │   │
│  │  │ ┌──────────┐ │                               │   │
│  │  │ │daemon-jsc│ │ (v2, same ScriptEngine i/f)   │   │
│  │  │ └──────────┘ │                               │   │
│  │  └──────────────┘                               │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                              │
│                         │ NDJSON over Unix socket       │
│                         ▼                              │
│                  ┌─────────────┐                       │
│                  │ aos daemon  │ (unchanged Swift)      │
│                  │ connection  │                       │
│                  └─────────────┘                       │
└──────────────────────────────────────────────────────┘
```

### State Directory

```
~/.config/aos-gateway/
  gateway.db            # SQLite — coordination state (sessions, state, messages)
  scripts/              # saved script files
    close-mail-drafts.ts
    close-mail-drafts.meta.json
    check-codex-status.ts
    check-codex-status.meta.json
  config.json           # gateway settings
```

Separate from `~/.config/aos/{mode}/` to maintain clean separation between the gateway and daemon concerns.

### Engine Interface

```typescript
interface ScriptEngine {
  readonly name: string;
  execute(request: ScriptRequest): Promise<ScriptResult>;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

interface ScriptRequest {
  script: string;                       // JS (type annotations already stripped)
  params: Record<string, unknown>;
  intent: Intent;
  timeout: number;
  context: {
    daemonSocket: string;               // path to aos daemon Unix socket
    gatewaySocket: string;              // per-execution socket for SDK ↔ gateway calls
    sessionId: string;                  // calling session's ID
  };
}

interface ScriptResult {
  result: unknown;
  logs: string[];
  durationMs: number;
  engine: string;
}
```

### Engine Router

```typescript
class EngineRouter {
  private engines: Map<string, ScriptEngine>;
  private config: {
    defaultEngine: string;
    intentPolicy: Record<Intent, string[]>;   // ordered preference per intent
  };

  async route(request: ScriptRequest, preferredEngine?: string): Promise<ScriptResult> {
    // 1. If preferredEngine is set and available → use it
    //    (policy may override: e.g., deny 'daemon-jsc' if not ready)
    // 2. Look up intent in intentPolicy → try engines in preference order
    // 3. Fall back to defaultEngine
    // 4. Fall back to any available engine
  }
}
```

Default config:
```json
{
  "defaultEngine": "node-subprocess",
  "intentPolicy": {
    "perception": ["daemon-jsc", "node-subprocess"],
    "action": ["daemon-jsc", "node-subprocess"],
    "coordination": ["node-subprocess"],
    "mixed": ["node-subprocess"]
  }
}
```

When `daemon-jsc` doesn't exist, every route silently falls through to `node-subprocess`. When it's added later, perception and action scripts automatically prefer it. **No MCP or SDK changes needed.**

### v1 Engine: NodeSubprocessEngine

```typescript
class NodeSubprocessEngine implements ScriptEngine {
  readonly name = 'node-subprocess';

  async execute(request: ScriptRequest): Promise<ScriptResult> {
    // 1. Create a per-execution Unix socket for SDK ↔ gateway communication
    // 2. Start a mini HTTP-like server on that socket to handle SDK calls
    // 3. Assemble the execution script:
    //    a. Set __aos_config global (daemonSocket, gatewaySocket, sessionId)
    //    b. Load aos-sdk.js
    //    c. Set `const params = <serialized params>`
    //    d. Wrap user script in async IIFE, capture return value
    //    e. Write JSON result to a known fd or temp file
    // 4. Spawn: node --no-warnings <assembled-script-path>
    // 5. Capture stdout → logs array
    // 6. Read result from fd/temp file
    // 7. Enforce timeout via AbortController on the child process
    // 8. Clean up per-execution socket
  }
}
```

### v2 Engine: DaemonJSCEngine (future addition)

```typescript
class DaemonJSCEngine implements ScriptEngine {
  readonly name = 'daemon-jsc';

  async execute(request: ScriptRequest): Promise<ScriptResult> {
    // 1. Connect to aos daemon socket
    // 2. Send NDJSON: { command: "exec_script", script: "...", params: {...}, timeout: ... }
    // 3. Daemon evaluates in a JavaScriptCore context:
    //    - SDK perception/action methods → direct Swift calls (in-process)
    //    - SDK coordination methods → socket calls back to gateway
    // 4. Receive NDJSON result: { result: ..., logs: [...], durationMs: ... }
    //
    // The daemon-side implementation is a future addition to src/
    // The gateway treats it as just another engine with the same contract
  }
}
```

Adding `daemon-jsc` requires:
1. A new `exec_script` command in the aos daemon (Swift, using JavaScriptCore framework)
2. A new `DaemonJSCEngine` class in the gateway (trivial — just sends/receives NDJSON)
3. Updating `config.json` to enable the new engine

None of these change the MCP tool schemas, SDK types, or coordination model.

---

## Coordination Data Model

### SQLite Schema

```sql
-- Who's connected to the coordination bus
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,             -- ULID
  name            TEXT UNIQUE NOT NULL,         -- 'lead-dev', 'studio-ui'
  role            TEXT NOT NULL,                -- 'architecture', 'ui-design'
  harness         TEXT NOT NULL,                -- 'claude-code', 'codex', 'claude-desktop'
  capabilities    TEXT NOT NULL DEFAULT '[]',   -- JSON array
  registered_at   INTEGER NOT NULL,             -- unix epoch ms
  last_heartbeat  INTEGER NOT NULL,             -- unix epoch ms
  status          TEXT NOT NULL DEFAULT 'online'
);

-- Shared key-value store with versioning and lock support
CREATE TABLE state (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,                -- JSON-encoded
  version         INTEGER NOT NULL DEFAULT 1,   -- incremented on every write
  owner           TEXT,                         -- session name (for lock semantics)
  updated_at      INTEGER NOT NULL,             -- unix epoch ms
  expires_at      INTEGER                       -- unix epoch ms, NULL = permanent
);

-- Append-only message log, partitioned by channel
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,             -- ULID (time-sortable)
  channel         TEXT NOT NULL,
  from_session    TEXT NOT NULL,
  payload         TEXT NOT NULL,                -- JSON-encoded
  created_at      INTEGER NOT NULL              -- unix epoch ms
);

-- Indexes
CREATE INDEX idx_messages_channel ON messages(channel, id);
CREATE INDEX idx_state_expires ON state(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_sessions_status ON sessions(status);
```

### Lock Semantics

| Mode | SQL behavior | Succeeds when | Fails when |
|------|-------------|---------------|------------|
| `set` | `INSERT OR REPLACE`, bump version | Always | Never |
| `cas` | `UPDATE ... WHERE version = expected` | Version matches | Version mismatch |
| `acquire_lock` | `INSERT ... WHERE NOT EXISTS` or `UPDATE ... WHERE owner = caller OR expires_at < now` | Key doesn't exist, is expired, or is already owned by caller | Key is owned by a different session and not expired |
| `release_lock` | `UPDATE SET owner = NULL WHERE owner = caller` | Caller is the owner | Caller is not the owner |

Expired keys (past `expires_at`) are treated as unowned for all lock operations. A periodic sweep (every 60s) deletes keys past `expires_at` + a grace period.

### Staleness and Heartbeats

Sessions send heartbeats by re-calling `register_session` (idempotent — updates `last_heartbeat`). A session with `last_heartbeat` older than 5 minutes is marked `status = 'offline'` by a periodic sweep. `whoIsOnline()` returns sessions where `status = 'online'` and `last_heartbeat` is within the staleness window.

### Message Retention

Messages are retained for 24 hours by default (configurable in `config.json`). A periodic sweep deletes messages older than the retention window. Channels are implicit — created on first `post_message`, no explicit creation needed.

---

## Script Registry

### Storage Layout

```
~/.config/aos-gateway/scripts/
  <name>.ts                 # script source (with TS annotations, as authored)
  <name>.meta.json          # metadata
  <name>.prev.ts            # one-deep backup (created on overwrite)
```

### Metadata File Format

```json
{
  "name": "close-mail-drafts",
  "description": "Closes all draft windows in Mail.app",
  "intent": "action",
  "parameters": {
    "type": "object",
    "properties": {
      "app": { "type": "string", "default": "Mail", "description": "App to target" }
    }
  },
  "createdBy": "lead-dev",
  "createdAt": "2026-04-07T12:00:00Z",
  "updatedAt": "2026-04-07T14:30:00Z"
}
```

### Save/Overwrite Rules

- **New script**: `save_script` with `overwrite: false` (default). Writes `.ts` and `.meta.json`. Errors if name already exists.
- **Update**: `save_script` with `overwrite: true`. Moves existing `.ts` to `.prev.ts` (one-deep backup). Writes new `.ts` and updates `.meta.json`.
- **Name format**: lowercase alphanumeric + hyphens (`^[a-z0-9][a-z0-9-]*$`). No namespacing in v1.

### Future: Namespaced Scripts

The flat `scripts/` directory works for v1. If scoping becomes needed later, the path layout can accommodate namespaces:

```
~/.config/aos-gateway/scripts/
  global/                   # machine-wide scripts
    close-mail-drafts.ts
  project/                  # per-project scripts (keyed by repo path hash or name)
    agent-os/
      sync-renderer-state.ts
```

This would require adding an optional `namespace` field to `save_script` and `list_scripts`. The current flat layout doesn't preclude this — it just needs a directory restructure and a migration of existing scripts.

---

## Test Case: Cross-Harness Coordination

Three sessions across three harnesses coordinate on Sigil work:

### Setup

```
lead-dev     → Claude Code CLI   → register_session("lead-dev", "architecture", "claude-code")
ui-designer  → Codex             → register_session("ui-designer", "studio-refactor", "codex")
preview      → Claude Desktop    → register_session("preview", "visual-feedback", "claude-desktop")
```

### File Claim (ui-designer via Codex)

```
set_state("lock:sigil/studio/js/ui.js",
  { task: "refactoring sidebar", files: ["ui.js", "sidebar.css"] },
  { mode: "acquire_lock", owner: "ui-designer", ttl: 3600 })

post_message("all",
  { type: "file-claim", files: ["sigil/studio/js/ui.js"], by: "ui-designer" },
  "ui-designer")
```

### Check Before Working (lead-dev via Claude Code)

```
get_state("lock:sigil/studio/*")
→ [{ key: "lock:sigil/studio/js/ui.js", owner: "ui-designer",
     value: { task: "refactoring sidebar" }, version: 1 }]

// lead-dev sees the lock, sends a question:
post_message("ui-designer",
  { type: "question", body: "Are you touching event handlers or just layout?" },
  "lead-dev")
```

### Request Visual Preview (ui-designer via script)

```typescript
// run_os_script, intent: "mixed"
const html = `<div class="sidebar-redesign">...</div>`;
await aos.coordination.postMessage("preview", {
  type: "render-request",
  html,
  title: "Sidebar v2 — check proportions"
}, "ui-designer");
return { sent: true };
```

### Render Preview (preview via Claude Desktop script)

```typescript
// run_os_script, intent: "mixed"
const msgs = await aos.coordination.readStream("preview", { limit: 5 });
const req = msgs.find(m => m.payload.type === "render-request");
if (!req) return { rendered: false, reason: "no pending requests" };

const canvas = await aos.show.canvas({
  display: 0,
  html: req.payload.html
});

await aos.coordination.postMessage("ui-designer", {
  type: "preview-ready",
  canvasId: canvas.id,
  title: req.payload.title
}, "preview");

return { rendered: true, canvasId: canvas.id };
```

### Release (ui-designer)

```
set_state("lock:sigil/studio/js/ui.js", null,
  { mode: "release_lock", owner: "ui-designer" })

post_message("all",
  { type: "file-release", files: ["sigil/studio/js/ui.js"], by: "ui-designer" },
  "ui-designer")
```

### Script Promotion

After the preview session uses the "render on request" pattern a few times, it saves it:

```
save_script("render-preview", <script source>, {
  description: "Poll for render requests and display them on a canvas",
  intent: "mixed",
  parameters: {
    "channel": { "type": "string", "default": "preview" },
    "display": { "type": "number", "default": 0 }
  }
})
```

Next time, any session invokes it: `run_os_script({ script_id: "render-preview", params: { channel: "preview" } })`.
