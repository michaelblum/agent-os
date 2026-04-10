# Chat-Native Agent Host — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Package:** `packages/host/`

## Overview

A chat-native agent host inside agent-os that runs model-backed agent loops with tool execution, streaming, and session persistence. Sigil is the first consumer; any app can use it via the agent-os SDK.

This is **not** a Claude Code clone or a drain-on-bridge. It's a platform primitive: model-agnostic by architecture, Anthropic-first by implementation.

## Architecture Decisions (Locked)

### Runtime Topology: Hybrid (Decision C)

| Process | Language | Socket | Responsibility |
|---------|----------|--------|----------------|
| `aos` daemon | Swift | `~/.config/aos/{mode}/sock` | Canvases, display, OS primitives, content server, events |
| `aos-host` | Node.js | `~/.config/aos/{mode}/host.sock` | Agent loop, provider adapters, tool registry, session store |
| Gateway | Node.js | `~/.config/aos-gateway/sdk.sock` | Coordination, script exec, MCP bridge — tool source for host |

**Why hybrid:** Swift daemon stays focused on what it's good at (canvases, IPC, OS). Node.js host gets the Anthropic TS SDK and broader ecosystem for tools/HTTP. Neither becomes a bottleneck or relay for the other's traffic.

### Communication Topology: Direct Sockets + Unified SDK (Decision A)

- SDK talks to Node host directly via `host.sock` for chat/session/tools
- SDK talks to Swift daemon directly via `sock` for canvas/OS primitives
- SDK abstracts both internally — apps see one coherent surface
- SDK owns connection lifecycle, retries, reconnection for both
- SDK presents one consistent event/streaming model regardless of backend
- Topology can be collapsed later without breaking SDK surface

### Package Location: `packages/host/`

Standalone Node.js service. Distinct from gateway (which stays focused on coordination + script/MCP). They share infra patterns (SQLite, TypeScript) but not concerns. Gateway becomes a tool source the host discovers.

### Process Lifecycle

Mode-scoped launchd label: `com.agent-os.host.{mode}` (alongside `com.agent-os.aos.{mode}` for daemon). Started/stopped alongside the daemon.

## Build / Adapt / Borrow Decisions

| Component | Decision | Source | Rationale |
|-----------|----------|--------|-----------|
| Provider adapters | **ADAPT** | Vercel AI SDK (`ai`) | Handles SSE parsing, streaming normalization for 3+ providers. We wrap thinly. |
| Tool definition shape | **BORROW PATTERN** | MCP `{name, description, inputSchema}` | Emerging standard; gateway already speaks MCP. We extend with `permissions`, `timeout`, `metadata`. |
| Tool execution | **BUILD** | — | MCP's model is RPC-to-server; we need in-process + provider-backed + future agent-backed. |
| Stream events | **ADAPT** | Vercel AI SDK stream types | Comes free with provider adapters. Mirror internally with extensions: `tool-progress`, `status`. |
| Session persistence | **BUILD** on `better-sqlite3` | — | ~50-line schema: `sessions`, `messages`, `tool_calls`. Queryable, resumable. |
| Permission model | **BUILD**, borrow pattern | Claude Code | Three states: `allow` / `deny` / `ask`. ~100 lines of logic; the UX matters more than the code. |
| Wiki integration | **BUILD** | SQLite FTS5 + `gray-matter` | Novel; markdown source of truth, FTS5 index, exposed as tools. Platform primitive, not app feature. |

## Core Interfaces

### ToolDefinition

Borrowed from MCP, extended with permissions and metadata.

```typescript
interface ToolDefinition {
  name: string                    // unique within registry
  description: string             // shown to model
  inputSchema: JSONSchema         // MCP-compatible
  permissions?: PermissionSpec    // our extension
  timeout?: number                // ms, default 30s
  metadata?: {
    type: 'simple' | 'provider-backed' | 'agent-backed'
    source?: string               // e.g., 'gateway', 'wiki', 'builtin'
  }
}
```

### ToolExecutor

```typescript
interface ToolExecutor {
  (input: JSONValue, context: ToolContext): Promise<ToolResult>
}

interface ToolContext {
  sessionId: string
  permissions: ResolvedPermissions
  signal: AbortSignal              // for cancellation
  emit: (event: StreamEvent) => void  // tool can stream progress
}

interface ToolResult {
  content: string | object         // serialized as tool_result block for the model
  isError?: boolean
}
```

`ToolResult.content` is intentionally constrained — it's what gets sent back to the model as the tool_result block, so it must be small and serializable.

### ProviderAdapter

Thin wrapper around Vercel AI SDK. Consumers never see Vercel types.

```typescript
interface ProviderAdapter {
  id: string                       // 'anthropic', 'openai', 'google'

  stream(params: {
    messages: Message[]
    tools: ToolDefinition[]
    system?: string
    config: ProviderConfig         // model, temperature, maxTokens
  }): AsyncIterable<StreamEvent>
}
```

### StreamEvent

Adapted from Vercel AI SDK, with two extensions.

```typescript
type StreamEvent =
  | { type: 'text-delta';    text: string }
  | { type: 'tool-call';     toolCallId: string; toolName: string; args: JSONValue }
  | { type: 'tool-result';   toolCallId: string; result: ToolResult }
  | { type: 'tool-progress'; toolCallId: string; message: string }  // extension: long-running tools
  | { type: 'finish';        reason: 'end_turn' | 'stop' | 'max_tokens' }
  | { type: 'error';         error: string; code?: string }
  | { type: 'status';        message: string }  // extension: host lifecycle events
```

### Session & Messages

Persisted in SQLite.

```typescript
interface Session {
  id: string
  provider: string                 // 'anthropic'
  model: string                    // 'claude-sonnet-4-20250514'
  system?: string
  toolProfile?: string            // named toolset, e.g., 'default', 'devtools'
  createdAt: string
  updatedAt: string
}

interface StoredMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  content: MessageContent          // text, tool_use, tool_result blocks
  createdAt: string
  tokenCount?: number              // tracked for future context management
}
```

`Session.toolProfile` is a simple string hook for v1. Future: named toolsets like "safe-default", "devtools".

### Permission Model

```typescript
interface PermissionSpec {
  default: 'allow' | 'deny' | 'ask'
  dangerous?: boolean              // UI hint: show warning
}

interface PermissionOverride {
  tool: string                     // glob pattern: 'fs.*', 'shell.exec'
  decision: 'allow' | 'deny'
  scope: 'session' | 'persistent'
}
```

When `ask` is triggered: host pauses loop, emits `status` event, waits for SDK to relay user's decision via approval canvas.

### SDK Surface

```typescript
interface AosSDK {
  chat: {
    create(config: SessionConfig): Promise<Session>
    send(sessionId: string, text: string): AsyncIterable<StreamEvent>
    stop(sessionId: string): Promise<void>
    resume(sessionId: string): Promise<Session>
    list(): Promise<Session[]>
  }
  tools: {
    list(): Promise<ToolDefinition[]>
    register(def: ToolDefinition, executor: ToolExecutor): void
  }
  os: {
    // existing aos-proxy surface: perceive, act, display, voice
  }
  wiki: {
    search(query: string): Promise<WikiEntry[]>
    read(path: string): Promise<WikiDocument>
    list(options?: { tag?: string }): Promise<WikiEntry[]>
  }
}
```

`sdk.chat.send()` returns `AsyncIterable<StreamEvent>` — one stream for the consumer regardless of internal complexity (text, tool calls, tool results all flow through).

## Agent Loop

```
receive message
  │
  ├─ append to history
  ├─ resolve tools (registry.getTools(session.toolProfile))
  ├─ build messages array (system + history + new message)
  │
  ▼
┌─────────────────────────────────┐
│  call provider adapter.stream() │◄──────────────────┐
│  (Anthropic first)              │                    │
└──────────┬──────────────────────┘                    │
           │                                           │
           ▼                                           │
     for await (event of stream)                       │
           │                                           │
           ├─ text-delta → emit to SDK consumer        │
           │                                           │
           ├─ tool-call → permission check             │
           │               ├─ allow → execute          │
           │               ├─ deny → tool_result       │
           │               │         with error        │
           │               └─ ask → emit status,       │
           │                   wait for approval,      │
           │                   then execute or deny    │
           │                                           │
           │   execute → emit tool-progress (opt)      │
           │            → get ToolResult               │
           │            → emit tool-result             │
           │            → append to messages           │
           │            → LOOP BACK ───────────────────┘
           │
           ├─ finish → persist session, emit finish
           │
           └─ error → emit error, persist partial
```

### Loop Behavior

- **Auto-loops on tool calls.** After every tool result, calls provider again with updated history. Continues until `end_turn` / `stop` / max iterations.
- **Max iteration limit:** configurable, default 25. Explicit and enforced.
- **Permission checks are synchronous from the loop's perspective.** When `ask` is needed, loop pauses and waits. No timeout pressure — provider stream is already consumed at that point.
- **Stop/cancel:** `AbortSignal` propagates through adapter and into tool execution. Partial response persisted.
- **No context window management in v1.** `tokenCount` tracked per message but not acted on. Schema supports future sliding window or summarization.

## Tool Types

The tool registry supports three types through the same `ToolDefinition` + `ToolExecutor` interface:

### Simple Tools
Local function calls. `read_file`, `list_files`, `shell_exec`.

### Provider-Backed Tools (future, post-thin-slice)
Implementation internally calls another model provider (e.g., Gemini for audio/video). The agent sees a normal tool; Gemini auth/payload/upload is hidden behind the executor.

Examples: `transcribe_audio`, `get_youtube_transcript`, `analyze_video`.

### Agent-Backed Capabilities (future)
Specialist sub-agents with their own instructions, provider choice, and tools — exposed as a tool to the main agent. Implementation is a nested agent loop.

Example: "Media Analyst" agent invoked via a tool interface.

**All three types share:** same discovery, same permission flow, same JSON envelope, same `ToolExecutor` signature. Callers cannot distinguish them.

## Session Provider ≠ Tool Provider

The host picks a **session provider** (Anthropic) for the conversation loop. Individual tools may call **different providers** internally (e.g., Gemini for video analysis). The agent never sees the internal provider — it sees `analyze_video` return a result.

This is by design, not a hack. The tool registry and permission engine treat all tools uniformly regardless of their internal implementation.

## Wiki as Platform Primitive

The wiki (`aos wiki`) is an agent-os primitive, not a Sigil feature:
- Markdown files are the canonical store
- SQLite FTS5 index is a rebuildable materialized view for search and link traversal
- Exposed via SDK: `sdk.wiki.search()`, `sdk.wiki.read()`, `sdk.wiki.list()`
- Also exposed as tools in the registry: `wiki.search`, `wiki.read`
- Host can use wiki for context (reading entities/concepts) and workflow invocation (plugins/skills)
- Sigil is just the first consumer of this capability

## v1 Thin Slice

### In Scope

| Component | Details |
|-----------|---------|
| `packages/host/` scaffolding | TypeScript, `better-sqlite3`, Vercel AI SDK, Unix socket server |
| Agent loop | Core loop: receive, call Anthropic, handle tool calls, stream back |
| Anthropic adapter | Single concrete `ProviderAdapter` using `@ai-sdk/anthropic` |
| 3 simple tools | `read_file` (allow), `list_files` (allow), `shell_exec` (deny by default — requires explicit override) |
| Tool registry | In-memory, `ToolDefinition` + `ToolExecutor` interface |
| Session store | SQLite: `sessions` + `messages` tables |
| Permission engine | `allow`/`deny` only (no `ask` UI — needs canvas integration) |
| SDK client | `sdk.chat.create()`, `sdk.chat.send()`, `sdk.chat.stop()` over Unix socket |
| Sigil integration | Wire chat canvas `emit('user_message')` → SDK → host → stream back to canvas |

### Out of Scope (architecture supports, not wired)

- `ask` permission flow (needs interactive canvas work)
- Provider-backed tools (Gemini etc.)
- Wiki integration (separate track, same tool interface when ready)
- OpenAI/Gemini session providers (interfaces exist, no concrete adapter)
- Context window management (`tokenCount` tracked, not acted on)
- `sdk.chat.resume()` (sessions persist, resumption UX deferred)

### Success Criteria

1. User types in Sigil chat window
2. Message flows through SDK → host socket → Anthropic API
3. Model responds with text — streams back to Sigil chat in real time
4. Model calls `read_file` — host executes, sends result to model, model continues
5. Full conversation persists in SQLite — survives host restart
6. Stop button in Sigil aborts the stream cleanly

## Standing Rules

1. **Max-iteration limit** is explicit and configurable (default 25).
2. **Build/adapt/borrow** is tagged on every major component boundary.
3. **`shell_exec`** is the sharpest tool — default permission posture is conservative (`ask` when we have it, `deny` in v1 thin slice unless explicitly overridden).
4. **Sigil is a consumer, not the definition.** Keep "Future App" in all architecture views. Don't hard-bake Sigil specifics into the core.
5. **Don't blindly reinvent.** For each piece: build, adapt a focused library, or borrow the pattern. Note the choice.
