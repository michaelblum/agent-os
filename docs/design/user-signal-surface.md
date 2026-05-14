# user_signal_surface — Design Document

**Status:** Draft  
**Area:** Gateway / HITL  
**Date:** 2026-05-14

---

## Overview

`user_signal_surface` is a first-class MCP tool registered on the `aos-gateway` that allows an agent to request a bounded, structured decision from the user via a transient interactive canvas. The tool blocks the agent's turn for at most `timeout_seconds`, returns a terminal typed value, and always resolves — either with the user's explicit choice or with a declared `default_value` on timeout or dismissal.

This is the canonical HITL gate primitive for Agent-OS. Any agent that reaches a decision point, permission boundary, or destructive-action confirmation should route through this tool rather than producing conversational text and waiting indefinitely in the CLI.

---

## Problem

Agent runtimes (Claude Code, Codex CLI, etc.) are steered by system instructions toward human-in-the-loop checkpoints. When an agent reaches a decision gate it cannot resolve autonomously — e.g., "Should I delete these 47 files?", "Which of these four strategies should I pursue?" — its only recourse today is to emit prose into the terminal and stall. That pattern is:

- **Slow**: The user must notice the terminal, read context, type a response, and submit.
- **Unsafe**: The agent may time out, retry, or make a conservative default choice that was never explicitly authorized.
- **Opaque**: There is no structured record of the decision, who made it, or when.
- **Non-composable**: The signal is free text; consuming code must parse intent from natural language.

The aos display stack already supports interactive canvases (`createCanvas --interactive`, `evalCanvas`). The missing piece is a single gateway-level tool that wraps the canvas lifecycle, injects a structured UI appropriate to the decision type, polls for the result, enforces a deadline, and returns a typed value the agent can branch on immediately.

---

## Goals

- Provide a single tool call that presents a decision surface, waits for user input, and always returns a typed terminal value.
- Support common decision shapes: boolean (approve/deny), single choice (A/B/C/D), multi-select, short freetext, and structured JSON.
- Enforce a server-side timeout so the agent's turn is never held open indefinitely.
- Keep the implementation entirely within existing infra: `createCanvas`, `evalCanvas`, `removeCanvas` from `aos-proxy.ts`, no new IPC.
- Register as a named MCP tool so any connected agent can call it without scripting.
- Produce a clean audit trail: every request and its resolution (or timeout) is logged at the gateway level.

## Non-Goals

- Persistent approval queues or durable storage of decisions (out of scope for v1; see Future Work).
- Multi-agent or cross-session decision forwarding.
- Rich custom UI beyond the five `ui_hint` variants defined below.
- Replacing the existing `showOverlay` / `updateOverlay` non-interactive pattern.

---

## Architecture

### Placement in the Stack

```
Agent (Claude Code / Codex / etc.)
    │  MCP tool call: user_signal_surface(...)
    ▼
aos-gateway (Node, stdio MCP server)
    │  packages/gateway/src/tools/user-signal.ts
    ├─ createCanvas(id, html, at, interactive: true)  ──► aos binary ──► WKWebView surface
    ├─ poll: evalCanvas(id, "window.__signalResult")   ◄── user clicks
    └─ removeCanvas(id)  on resolution or timeout
    │
    Returns: typed terminal value (never hangs)
    ▼
Agent resumes turn with structured result
```

The tool lives at `packages/gateway/src/tools/user-signal.ts` and is registered in `packages/gateway/src/index.ts` alongside the existing execution tools.

### Why Not `run_os_script`?

The `run_os_script` path routes through the script engine, which adds subprocess overhead and is designed for perception/action scripts against the `aos` SDK. Signal surface management is a gateway-layer coordination primitive — it touches `aos-proxy.ts` functions directly and holds a polling loop for up to `timeout_seconds`. Placing it in the gateway tool layer keeps it fast, avoids engine startup latency on a latency-sensitive UX path, and keeps the session/correlation context owned by the gateway process.

---

## Tool Contract

### Tool Name

`user_signal_surface`

### Description (as exposed to agents via MCP)

> Request a bounded structured user signal via a transient interactive surface on the user's display. Always returns a terminal value — either the user's explicit selection or `default_value` on timeout or dismissal. `null` as `default_value` signals "no decision = abort current action". This is a synchronous approval gate from the agent's perspective; do not continue the guarded action until this tool returns.

### Input Schema

```typescript
type UserSignalRequest = {
  // Required
  ui_hint: 'boolean' | 'single_choice' | 'multi_choice' | 'text' | 'structured';
  default_value: unknown;          // Returned on timeout/dismissal. null = abort.

  // Recommended
  title?: string;                  // Short heading shown on the surface
  message?: string;                // Explanatory body text; markdown supported
  timeout_seconds?: number;        // Default: 20. Min: 5. Max: 120.

  // Required when ui_hint is 'single_choice' or 'multi_choice'
  choices?: Array<{
    value: string;                 // Machine-readable key returned on selection
    label: string;                 // Human-readable button text
    description?: string;          // Optional subtitle shown below label
    danger?: boolean;              // Renders in error/red color
  }>;

  // Optional when ui_hint is 'structured'
  data_schema?: object;            // JSON Schema describing expected return shape
  placeholder?: string;            // Placeholder text for 'text' ui_hint

  // Positioning
  at?: [x: number, y: number, width: number, height: number];
  // Default: centered on primary display, 440×auto

  // Internal (injected by gateway, not set by agent)
  // __sessionId is forwarded from the MCP request context
};
```

### Return Value

The tool always returns a JSON-serializable value. The specific type depends on `ui_hint`:

| `ui_hint` | User resolution | Timeout / dismiss |
|---|---|---|
| `boolean` | `true` (approved) or `false` (denied) | `default_value` |
| `single_choice` | `string` — the selected `choice.value` | `default_value` |
| `multi_choice` | `string[]` — array of selected `choice.value`s | `default_value` |
| `text` | `string` — trimmed freetext input | `default_value` |
| `structured` | `object` — parsed JSON matching `data_schema` | `default_value` |

The agent should always handle the `default_value` case explicitly. The canonical pattern for a destructive-action gate is `default_value: null` and `if (result === null) return;`.

---

## UI Variants

Each `ui_hint` maps to a specific canvas HTML template. All variants share a common chrome: backdrop blur, dark surface, `--interactive: true`, and a countdown timer that depletes visually toward the timeout.

### `boolean`

Two buttons: **Approve** (green, primary) and **Deny** (red). On click, sets `window.__signalResult = true` or `false` respectively. An optional **Escape** link (small, muted) sets `window.__signalResult = null`.

```
┌─────────────────────────────────────────┐
│  title                                  │
│  message                                │
│                                         │
│  [  ✓ Approve  ]   [  ✗ Deny  ]        │
│                         dismiss ↗       │
│  █████████████████░░░░░ 14s              │
└─────────────────────────────────────────┘
```

### `single_choice`

Renders each `choice` as a full-width button. Up to 6 choices. Danger choices render with error coloring. Sets `window.__signalResult = choice.value` on click.

### `multi_choice`

Renders choices as checkboxes. A **Submit** button appears once at least one item is selected. Sets `window.__signalResult = [selectedValues]` on submit.

### `text`

A single-line input with placeholder and a **Submit** button. Submit is disabled when input is empty. Sets `window.__signalResult = input.value.trim()` on submit.

### `structured`

Renders a compact JSON textarea with optional `data_schema` displayed as a comment block. Submit validates against schema before setting `window.__signalResult`. If validation fails, an inline error is shown without dismissing the surface.

---

## Implementation

### File: `packages/gateway/src/tools/user-signal.ts`

```typescript
import { createCanvas, removeCanvas, evalCanvas, getDisplays } from '../aos-proxy.js';

export type UserSignalRequest = { /* see Input Schema above */ };

export async function userSignalSurface(req: UserSignalRequest): Promise<unknown> {
  const timeout = Math.min(Math.max((req.timeout_seconds ?? 20) * 1000, 5000), 120000);
  const canvasId = `uss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const at = req.at ?? (await defaultPosition());
  const html = buildSignalHtml(req, timeout);

  await createCanvas({ id: canvasId, html, at, interactive: true });

  return new Promise((resolve) => {
    const deadline = setTimeout(async () => {
      clearInterval(poll);
      try { await removeCanvas(canvasId); } catch {}
      resolve(req.default_value ?? null);
    }, timeout + 500); // slight grace over the in-canvas countdown

    const poll = setInterval(async () => {
      try {
        const { result } = await evalCanvas(
          canvasId,
          'window.__signalResult !== undefined ? JSON.stringify(window.__signalResult) : null'
        );
        if (result !== null && result !== 'null') {
          clearTimeout(deadline);
          clearInterval(poll);
          try { await removeCanvas(canvasId); } catch {}
          try { resolve(JSON.parse(result as string)); }
          catch { resolve(req.default_value ?? null); }
        }
      } catch {
        // canvas gone (user closed window, display error) → resolve as default
        clearTimeout(deadline);
        clearInterval(poll);
        resolve(req.default_value ?? null);
      }
    }, 400);
  });
}

async function defaultPosition(): Promise<[number, number, number, number]> {
  try {
    const displays = await getDisplays();
    const primary = displays.find(d => d.primary) ?? displays[0];
    const w = 440;
    const h = 220;
    return [
      Math.round((primary.width - w) / 2),
      Math.round((primary.height - h) / 2),
      w,
      h,
    ];
  } catch {
    return [500, 350, 440, 220];
  }
}
```

The `buildSignalHtml(req, timeoutMs)` function produces self-contained HTML for each `ui_hint` variant. The HTML uses only inline styles (no external resources), renders the countdown via `setInterval` decrementing a CSS `width` bar, and sets `window.__signalResult` on any terminal user action.

### Registration: `packages/gateway/src/index.ts`

```typescript
import { userSignalSurface } from './tools/user-signal.js';

// Add to allHandlers:
allHandlers['user_signal_surface'] = (args) => userSignalSurface(args);

// Add to TOOL_DEFS:
{
  name: 'user_signal_surface',
  description: '...',  // see Tool Contract → Description above
  inputSchema: {
    type: 'object' as const,
    properties: {
      ui_hint:         { type: 'string', enum: ['boolean','single_choice','multi_choice','text','structured'] },
      default_value:   {},
      title:           { type: 'string' },
      message:         { type: 'string' },
      timeout_seconds: { type: 'number' },
      choices:         { type: 'array', items: { type: 'object' } },
      data_schema:     { type: 'object' },
      placeholder:     { type: 'string' },
      at:              { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
    },
    required: ['ui_hint', 'default_value'],
  },
}
```

---

## Timeout and Cancellation

Timeout is enforced in two places:

1. **In-canvas countdown**: The HTML renders a visible depleting timer bar. When it reaches zero, the canvas sets `window.__signalResult = null` and visually freezes. This gives the user feedback without requiring them to wait for the polling cycle.

2. **Gateway deadline**: A `setTimeout` in `userSignalSurface` fires at `timeout_ms + 500ms` (the grace window covers the last polling cycle). It calls `removeCanvas` and resolves with `default_value`. This is the authoritative source of truth — the in-canvas timer is cosmetic.

The escape hatch button sets `window.__signalResult = null` immediately, which the poll loop picks up within 400ms. This resolves via the normal polling path and returns `default_value` (typically `null`), identical to a timeout.

---

## Logging

Every call is logged at the gateway level with the following fields:

```json
{
  "tool": "user_signal_surface",
  "canvasId": "uss-abc123-def4",
  "sessionId": "...",
  "ui_hint": "boolean",
  "timeout_seconds": 20,
  "resolution": "user" | "timeout" | "error",
  "elapsed_ms": 7430,
  "result_type": "boolean"
}
```

The actual `result` value is not logged (privacy: the user's choice is not persisted to disk in v1). `resolution: "timeout"` and `resolution: "error"` both result in `default_value` being returned to the agent.

---

## Usage Examples

### Approve / Deny (Destructive Action Gate)

```typescript
const approved = await gateway.callTool('user_signal_surface', {
  ui_hint: 'boolean',
  default_value: false,
  title: 'Confirm File Deletion',
  message: 'Delete 47 files in `/Users/mblum/Downloads/old-project`? This cannot be undone.',
  timeout_seconds: 20,
});

if (!approved) {
  return { aborted: true, reason: 'user denied or timeout' };
}
// proceed with deletion
```

### Strategy Selection (Single Choice)

```typescript
const strategy = await gateway.callTool('user_signal_surface', {
  ui_hint: 'single_choice',
  default_value: null,
  title: 'Choose Refactor Strategy',
  message: 'The codebase supports three approaches. Which should I pursue?',
  timeout_seconds: 30,
  choices: [
    { value: 'incremental', label: 'Incremental', description: 'Migrate module by module, lower risk' },
    { value: 'big_bang',    label: 'Big Bang',    description: 'Rewrite in one pass, faster but riskier', danger: true },
    { value: 'hybrid',      label: 'Hybrid',      description: 'Rewrite core, migrate edges incrementally' },
  ],
});

if (strategy === null) return; // user dismissed or timed out
```

### Freetext Clarification

```typescript
const clarification = await gateway.callTool('user_signal_surface', {
  ui_hint: 'text',
  default_value: null,
  title: 'Clarify Target Audience',
  message: 'The brief mentions "enterprise users" but the tone spec says "developer-friendly." Who is the primary audience?',
  placeholder: 'e.g., Senior engineers at F500 companies',
  timeout_seconds: 60,
});

if (clarification === null) return; // no response
```

---

## State Machine

From the agent's perspective, the tool call is synchronous. Internally the tool transitions through:

```
CREATED → POLLING → RESOLVED (user)    → returns result
                  → RESOLVED (timeout) → returns default_value
                  → RESOLVED (error)   → returns default_value
```

There is no persistent state machine in v1. All state is in-memory in the gateway process. If the gateway restarts during a pending signal, the canvas is orphaned (the `aos` binary owns canvas lifetime independently) and the MCP tool call errors; the agent should treat any tool error from `user_signal_surface` as equivalent to `default_value`.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Agent calls tool with `timeout_seconds: 0` or negative | Clamped to 5 seconds |
| Canvas fails to create (display not available) | Tool returns `default_value` immediately; logs `resolution: error` |
| User force-closes the canvas window | `evalCanvas` throws; poll catches, resolves as `default_value` |
| Agent calls tool twice with same `canvasId` | Not possible — gateway generates unique IDs per call |
| Display goes to sleep before user responds | Timer expires; gateway deadline fires; returns `default_value` |
| Agent sends `ui_hint: 'single_choice'` with no `choices` | Returns `default_value` immediately; logs warning |

---

## Future Work

- **Durable approval records**: Persist decision requests and responses to the gateway's SQLite store (`db.ts`) with a `decisions` table. Enables audit trail, replay, and cross-session inspection via Sigil.
- **Remote signals**: Route `user_signal_surface` requests to a Sigil panel over the existing WebSocket bus, enabling decisions from a remote display or mobile device.
- **Chained gates**: A `user_signal_sequence` tool that presents a wizard-style series of `UserSignalRequest` steps, returning a structured aggregate.
- **Agent-system-prompt injection**: A standard block agents can include in system prompts to self-describe when to call `user_signal_surface`, replacing ad-hoc HITL guidance in individual agent configs.
- **Async non-blocking variant**: `queue_user_signal_surface` that returns immediately with a `request_id` and lets the agent proceed with other work, polling `get_signal_result(request_id)` later.
