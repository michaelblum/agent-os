# Human Input Gate — Design Document

**Status:** Draft  
**Area:** Daemon / Toolkit / HITL  
**Date:** 2026-05-14  
**Supersedes:** initial `user_signal_surface` gateway-polling sketch

---

## Overview

The **Human Input Gate** is the canonical AOS primitive for collecting bounded, structured human decisions during an agent turn. It is daemon-owned, adapter-extensible, and always returns a typed terminal value or `null` on timeout.

The gate exposes three access surfaces that share one contract:

- `./aos gate ask` — shell invocation for dock sessions and CLI scripts
- `user_signal_surface` — MCP tool on `aos-gateway` for connected agent runtimes (Claude Code, Codex, etc.)
- Programmatic daemon API — for internal AOS subsystems

From any agent's perspective the call is identical: post a structured request, receive a structured response or `null`. How the signal is collected — local canvas, Sigil panel, Slack, or anything else — is an adapter detail the agent never sees.

---

## Problem

Agent runtimes (Claude Code, Codex CLI, etc.) are steered by system instructions toward human-in-the-loop checkpoints. When an agent reaches a decision gate it cannot resolve autonomously — "Should I delete these 47 files?", "Which of these three strategies?" — its only recourse today is to emit prose into the terminal and stall. That pattern is:

- **Slow** — the user must notice the terminal, read context, type a response, submit.
- **Unsafe** — the agent may time out, retry, or make a conservative default that was never explicitly authorized.
- **Opaque** — no structured record of the decision, who made it, or when.
- **Non-composable** — the signal is free text; consuming code must parse intent from natural language.
- **Unroutable** — there is no way to redirect the request to a different surface (Sigil, Slack, mobile) without rewriting the agent.

---

## Design Principles

1. **Daemon owns time, adapters own surface.** The daemon creates the gate request, holds the deadline, resolves the answer, and cleans up. Adapters only present UI and report back. The clock is never in the adapter.

2. **One agent-facing contract, many transports.** `./aos gate ask` and `user_signal_surface` are both thin shells over the same daemon gate service. Adding a new transport (Sigil, Slack, mobile) never changes what agents call.

3. **Polymorphic response schema, not a boolean API.** The base primitive is "return an arbitrary JSON value matching a schema." Approve/deny is a preset. So are yes/no, single choice, multi-select, freetext, coordinates, and any future shape.

4. **`null` is a first-class terminal outcome.** Timeout, dismissal, and escape-hatch with no input all resolve to `null`. `null` means "no decision received — end this agent turn cleanly." It is not an error.

5. **Inside AOS authority.** The daemon is the source of truth for gate lifecycle. Gateway is one possible transport, not the owner. This keeps the gate consistent with the rest of AOS's authority boundary.

---

## Authority Boundary

```
Inside AOS authority
  aos daemon
  gate request lifecycle (create, timeout, resolve, clean up)
  local canvas / WKWebView surfaces
  toolkit DecisionGatePanel component
  ./aos CLI

Outside AOS authority
  connected agent runtimes (Claude Code, Codex, etc.)
  aos-gateway (MCP server — adapter, not owner)
  Sigil WebSocket panel
  Slack / external channels
  any surface whose lifecycle AOS does not own
```

Gateway is outside AOS authority. It is a transport adapter for MCP clients. It should not hold polling loops, own canvas state, or be the deadline authority for human decisions.

---

## Architecture

### The Adapter Pattern

```
Agent (any runtime)
  │  ./aos gate ask <request.json>          ← shell path
  │  user_signal_surface MCP tool call      ← MCP path (thin shell to daemon)
  ▼
Daemon Gate Service
  │  owns: request ID, schema, timeout, result, cleanup
  │  runs: deadline clock
  ▼
SignalCollectorAdapter  (interface — swappable at runtime)
  ├── LocalCanvasAdapter     → createCanvas + toolkit DecisionGatePanel  [v1]
  ├── GatewayMCPAdapter      → forwards to MCP surface (headless / remote)  [future]
  ├── SigilPanelAdapter      → routes to Sigil over WebSocket  [future]
  └── SlackAdapter           → posts to Slack, collects reaction/reply  [future]
  ▼
Adapter presents surface → user acts → adapter reports value back to daemon
  ▼
Daemon resolves gate: typed value or null
  ▼
Agent receives response and resumes turn
```

The adapter interface is intentionally minimal:

```typescript
interface SignalCollectorAdapter {
  // Present the surface. Returns an opaque handle used for cleanup.
  present(request: GateRequest): Promise<CollectionHandle>;

  // Dismiss/clean up regardless of how resolution happened.
  dismiss(handle: CollectionHandle): Promise<void>;

  // Declare what field kinds this adapter can render.
  supports(kind: FieldKind): boolean;
}
```

The daemon calls `adapter.present()`, starts the deadline clock, then waits. On resolution (user answer or timeout), the daemon calls `adapter.dismiss()` and resolves the gate. The adapter never owns the clock.

### MCP Tool as Thin Shell

The `user_signal_surface` MCP tool in `aos-gateway` is a one-step passthrough:

```
MCP client calls user_signal_surface(request)
  → gateway shells to: ./aos gate ask --json <request>
  → waits on stdout
  → returns stdout value or null to MCP client
```

No canvas management in the gateway. No polling loop in the gateway. The daemon owns all of it. Gateway just translates MCP protocol to a CLI call and forwards the result.

---

## Request Schema

Version string: `aos.gate.request.v1`

```jsonc
{
  "schema_version": "aos.gate.request.v1",

  // Human-readable context shown on the surface
  "prompt": {
    "title": "Continue?",          // required — short heading
    "body": null                   // optional — markdown body text
  },

  // What value the agent expects back. Standard JSON Schema.
  // The surface collects data that conforms to this shape.
  "response_schema": {
    "type": "object",
    "required": ["decision"],
    "properties": {
      "decision": { "type": "string", "enum": ["yes", "no", "other"] },
      "other_text": { "type": ["string", "null"] }
    }
  },

  // How AOS should collect it
  "ui": {
    "variant": "yes_no_with_escape",  // named preset (see Presets)

    // Fields that compose the response. Order determines render order.
    "fields": [
      {
        "id": "decision",
        "kind": "exclusive_choice",
        "style": "buttons",
        "options": [
          { "value": "yes",   "label": "Yes" },
          { "value": "no",    "label": "No" },
          { "value": "other", "label": "Something else" }
        ]
      },
      {
        "id": "other_text",
        "kind": "text",
        "placeholder": "Something else...",
        "visible_when": { "field": "decision", "equals": "other" }
      }
    ],

    // Timeout indicator configuration
    "timer": {
      "visible": true,
      "display": "digital",         // "digital" | "pie"
      "direction": "countDown",     // "countDown" | "countUp"
      "flash_threshold_ms": 0,      // 0 = no flash; >0 = flash begins N ms before timeout
      "flash_interval_ms": 1000,    // on/off cycle when flashing (default 1s)
      "colors": {
        "background": null,         // null = use surface default
        "primary": null,
        "threshold_background": null,
        "threshold_primary": null
      }
    }
  },

  // Gate lifecycle
  "timeout_ms": 20000              // default 20s; min 5s; max 120s; null on timeout
}
```

### Field Kinds

The field kind registry defines what the toolkit surface layer can render. Kinds are registered — new kinds can be added without changing the gate contract.

| Kind | Description | Returns |
|---|---|---|
| `boolean` | Single true/false toggle | `boolean` |
| `exclusive_choice` | Pick one from a labeled option set (radio / buttons) | `string` (selected value) |
| `multi_choice` | Pick any from a labeled option set (checkboxes) | `string[]` |
| `text` | Single-line freetext input | `string` |
| `number` | Numeric input with optional min/max/step | `number` |
| `point2d` | x,y coordinate pair | `{ x: number, y: number }` |
| `point3d` | x,y,z coordinate triple | `{ x: number, y: number, z: number }` |
| `object` | Grouped sub-fields | `object` |

V1 implements: `boolean`, `exclusive_choice`, `multi_choice`, `text`. Coordinate and object kinds are defined in schema now; surface rendering is deferred.

### Escape Hatch

Any field with `"id": "other_text"` and `"kind": "text"` whose `visible_when` condition references another field's `"other"` value is treated as the canonical escape hatch pattern. The surface renders it as a conditional freetext reveal. This is a convention, not a special field type — it composes naturally from existing field kinds.

---

## Response Contract

The gate always produces one of:

1. **User answer** — a JSON value conforming to `response_schema`. Shape varies by field configuration.
2. **`null`** — timeout, user dismissal without input, or escape hatch submitted empty.

`null` is terminal. The agent must handle it explicitly and must not continue the guarded action.

### Default invocation (zero-config)

```bash
./aos gate ask "Continue?"
```

Equivalent to posting the `yes_no_with_escape` preset with a 20s timeout. Stdout:

```json
{"decision":"yes","other_text":null}
```
or
```json
{"decision":"no","other_text":null}
```
or
```json
{"decision":"other","other_text":"check the staging branch first"}
```
or on timeout / dismissal:
```
null
```

---

## Presets

Presets are named `ui.variant` values that expand to a full `fields` + `response_schema` configuration. They are the ergonomic layer on top of the raw schema — agents and scripts use presets; the daemon and toolkit work with expanded field configs.

| Preset | Description | Default return shape |
|---|---|---|
| `yes_no_with_escape` | Yes / No buttons + conditional freetext escape hatch | `{ decision: "yes"\|"no"\|"other", other_text: string\|null }` |
| `approve_deny` | Approve (green) / Deny (red) + optional escape hatch | `{ decision: "approve"\|"deny", other_text: string\|null }` |
| `single_choice` | Labeled button set, pick one | `{ decision: string }` |
| `multi_choice` | Labeled checkbox set, pick many | `{ decisions: string[] }` |
| `freetext` | Text input only, no choices | `{ text: string }` |

Custom variants can be composed inline by omitting `ui.variant` and specifying `ui.fields` directly.

---

## Toolkit Component Stack

The v1 `LocalCanvasAdapter` renders gate requests using a toolkit component stack hosted in a daemon-managed interactive canvas. The component hierarchy maps directly to the gate request schema.

```
DecisionGatePanel                   ← top-level gate surface component
  GateShell                         ← chrome: backdrop, border, positioning
    GateHeader                      ← title + optional body text
    GateBody                        ← field rendering region
      FieldRenderer                 ← dispatches to field kind components
        BooleanField
        ExclusiveChoiceField        ← renders as buttons or radio set
          ChoiceOption              ← individual option with danger variant
        MultiChoiceField            ← renders as checkbox set
          ChoiceOption
        TextField                   ← single-line input
        NumberField
        Point2DField                ← (v2)
        Point3DField                ← (v2)
    EscapeHatch                     ← conditional freetext reveal
      EscapeHatchTrigger            ← "Something else..." reveal button
      EscapeHatchInput              ← text input, shown on trigger
    GateActions                     ← submit/confirm button when needed
    TimeoutIndicator                ← countdown display
      DigitalTimer                  ← HH:MM.S or SS.s display
      PieTimer                      ← SVG arc depleting to zero
```

### File Layout

```
packages/toolkit/
  components/
    decision-gate/
      index.html          ← self-contained gate surface entry point
      index.js            ← mounts DecisionGatePanel with request config
      styles.css          ← gate-specific chrome and animation
      model.js            ← request parsing, field state, submit logic
      semantics.js        ← response_schema validation, null resolution

  controls/
    field-renderer.js     ← dispatches to field kind by "kind" property
    boolean-field.js
    exclusive-choice-field.js
    multi-choice-field.js
    text-field.js
    number-field.js
    escape-hatch.js       ← conditional reveal pattern
    choice-option.js      ← shared option atom (button + danger variant)
    gate-actions.js       ← submit button, disabled state logic
    timeout-indicator.js  ← mounts digital or pie sub-component
    digital-timer.js
    pie-timer.js
```

### Signal Protocol

The canvas communicates resolution back to the daemon by setting `window.__gateResult` to a JSON-stringified value. The daemon's `LocalCanvasAdapter` polls this via `evalCanvas` at a fixed interval. On detection, the adapter calls back into the gate service, which resolves the request, dismisses the surface, and returns the value to the caller.

This is an adapter-internal detail. Future adapters use different back-channels (WebSocket message, Slack event webhook, etc.) — the gate service contract is identical regardless.

---

## Daemon Gate Service

### Responsibilities

- Accept gate requests from any caller (CLI, MCP shell-out, internal API)
- Assign a unique `gate_id` per request
- Select and invoke the appropriate `SignalCollectorAdapter`
- Own the deadline clock — fire `null` resolution on timeout
- Resolve the gate with the adapter's reported value
- Call `adapter.dismiss()` on all resolution paths
- Log gate lifecycle events (request, resolution, elapsed)

### Adapter Selection

In v1, the daemon uses `LocalCanvasAdapter` unconditionally. Future policy:

- Default: `LocalCanvasAdapter` (display available)
- Fallback: configurable — e.g., `SlackAdapter` if no display
- Override: per-session or per-request adapter hint

### Timeout Enforcement

Timeout is daemon-authoritative. The countdown displayed in the canvas is cosmetic. The daemon's deadline fires at `timeout_ms` and resolves the gate with `null` regardless of canvas state. The adapter's `dismiss()` is always called — it never holds an open surface after resolution.

---

## Agent-Facing Surfaces

### CLI: `./aos gate ask`

```bash
# Zero-config — yes/no + escape + 20s timer
./aos gate ask "Continue?"

# Full request from file
./aos gate ask --request gate-request.json

# Inline JSON
./aos gate ask --json '{"prompt":{"title":"Delete files?"},"ui":{"variant":"approve_deny"},"timeout_ms":20000}'

# Preset shorthand
./aos gate ask --preset approve_deny --title "Run disruptive TCC test?" --timeout 30
```

Stdout is always the response value or the literal string `null`. Callers should parse stdout as JSON, treating the bare string `null` as the terminal no-response case.

### MCP Tool: `user_signal_surface`

Registered on `aos-gateway`. Implementation:

```typescript
// packages/gateway/src/tools/user-signal.ts
import { execFile } from 'node:child_process';

export async function userSignalSurface(req: UserSignalRequest): Promise<unknown> {
  const requestJson = JSON.stringify(buildGateRequest(req));
  return new Promise((resolve, reject) => {
    execFile(
      'aos',
      ['gate', 'ask', '--json', requestJson],
      { timeout: ((req.timeout_seconds ?? 20) + 5) * 1000 },
      (err, stdout) => {
        if (err) { resolve(null); return; } // treat exec error as timeout
        const trimmed = stdout.trim();
        resolve(trimmed === 'null' ? null : JSON.parse(trimmed));
      }
    );
  });
}
```

No canvas management. No polling loop. No gateway-owned deadline. The daemon handles all of it.

**Tool definition** (in `TOOL_DEFS`):

```typescript
{
  name: 'user_signal_surface',
  description:
    'Request a bounded structured human decision via a transient AOS surface. ' +
    'Always returns a typed value or null. null means no response received — ' +
    'end the current agent turn cleanly. Do not continue a guarded action until this returns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title:           { type: 'string' },
      message:         { type: 'string' },
      preset:          { type: 'string',
                         enum: ['yes_no_with_escape','approve_deny','single_choice','multi_choice','freetext'] },
      choices:         { type: 'array', items: { type: 'object' } },
      timeout_seconds: { type: 'number' },
      request:         { type: 'object',
                         description: 'Full aos.gate.request.v1 object. Overrides all other params.' },
    },
    required: ['title'],
  },
}
```

For simple cases, agents pass `title` + optional `preset` + optional `choices`. For full control, agents pass a `request` object conforming to `aos.gate.request.v1`.

---

## Usage Examples

### Approve / Deny (Destructive Action Gate)

```bash
# CLI
result=$(./aos gate ask --preset approve_deny --title "Delete 47 files in ~/Downloads/old-project?")
if [ "$result" = "null" ] || [ "$(echo $result | jq -r .decision)" = "deny" ]; then
  echo "aborted"; exit 0
fi
```

```typescript
// MCP tool call
const result = await callTool('user_signal_surface', {
  title: 'Delete 47 files in ~/Downloads/old-project?',
  message: 'This cannot be undone.',
  preset: 'approve_deny',
  timeout_seconds: 20,
});
if (result === null || result.decision === 'deny') return { aborted: true };
```

### Strategy Selection

```typescript
const result = await callTool('user_signal_surface', {
  title: 'Choose Refactor Strategy',
  message: 'Which approach should I pursue?',
  preset: 'single_choice',
  choices: [
    { value: 'incremental', label: 'Incremental', description: 'Module-by-module, lower risk' },
    { value: 'big_bang',    label: 'Big Bang',    description: 'Full rewrite, faster but riskier', danger: true },
    { value: 'hybrid',      label: 'Hybrid',      description: 'Rewrite core, migrate edges' },
  ],
  timeout_seconds: 30,
});
if (result === null) return; // no decision
```

### Full Custom Request

```typescript
const result = await callTool('user_signal_surface', {
  title: 'placeholder — overridden by request object',
  request: {
    schema_version: 'aos.gate.request.v1',
    prompt: { title: 'Coordinate target?', body: 'Click to select a point on the active display.' },
    response_schema: {
      type: 'object',
      required: ['point'],
      properties: { point: { type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } } } }
    },
    ui: { variant: null, fields: [{ id: 'point', kind: 'point2d' }],
          timer: { visible: true, display: 'digital', direction: 'countDown', flash_threshold_ms: 3000 } },
    timeout_ms: 15000,
  },
});
```

---

## Gate Lifecycle State Machine

```
REQUESTED
  │  daemon assigns gate_id, selects adapter
  ▼
PRESENTING
  │  adapter.present() called; deadline clock starts
  ├─ user submits value ──────────────────────────────────────────► RESOLVED (answer)
  ├─ user dismisses / escape hatch empty ────────────────────────► RESOLVED (null)
  ├─ deadline fires ──────────────────────────────────────────────► RESOLVED (null)
  └─ adapter error (canvas fails, display gone) ──────────────────► RESOLVED (null)
                                                                         │
                                                          adapter.dismiss() called
                                                          result returned to caller
```

All resolved paths call `adapter.dismiss()`. `null` is never an error condition — it is the designed terminal outcome for all non-answer paths.

---

## Logging

Every gate lifecycle event is logged by the daemon:

```json
{ "event": "gate.requested",  "gate_id": "gate-abc123", "session_id": "...", "variant": "approve_deny", "timeout_ms": 20000 }
{ "event": "gate.presented",  "gate_id": "gate-abc123", "adapter": "LocalCanvasAdapter" }
{ "event": "gate.resolved",   "gate_id": "gate-abc123", "resolution": "user", "elapsed_ms": 7430 }
```

Resolution values: `"user"` | `"timeout"` | `"dismiss"` | `"error"`. The actual response value is not logged in v1 (privacy).

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `timeout_ms` < 5000 or negative | Clamped to 5000ms |
| `timeout_ms` > 120000 | Clamped to 120000ms |
| No display available at gate time | `LocalCanvasAdapter` fails; resolves `null`; logs `resolution: error` |
| Canvas window force-closed by user | Adapter poll throws; daemon resolves `null` |
| Daemon restarts during active gate | Canvas orphaned (`aos` binary owns canvas lifetime); MCP call errors; caller treats as `null` |
| Agent sends `single_choice` with empty `choices` | Daemon rejects request, returns `null`, logs warning |
| `response_schema` validation fails on submit | Surface shows inline error; does not dismiss; user must correct or timeout |
| Multiple concurrent gate requests | Each gets a unique `gate_id` and independent surface; daemon manages concurrently |

---

## V1 Scope

The following constitutes a shippable v1:

- [ ] `Daemon Gate Service` — request intake, adapter dispatch, deadline clock, resolution, logging
- [ ] `SignalCollectorAdapter` interface
- [ ] `LocalCanvasAdapter` — `createCanvas` + toolkit `DecisionGatePanel` + `evalCanvas` poll-back
- [ ] `DecisionGatePanel` component stack (see Toolkit Component Stack above)
- [ ] Field kinds: `boolean`, `exclusive_choice`, `multi_choice`, `text`
- [ ] `EscapeHatch` conditional reveal pattern
- [ ] `TimeoutIndicator` with `DigitalTimer` and `PieTimer`
- [ ] All `timer` config options (display, direction, flash threshold, colors)
- [ ] Presets: `yes_no_with_escape`, `approve_deny`, `single_choice`, `multi_choice`, `freetext`
- [ ] `./aos gate ask` CLI verb (zero-config + `--preset` + `--json` + `--request`)
- [ ] `user_signal_surface` MCP tool as thin shell to `./aos gate ask`
- [ ] `aos.gate.request.v1` schema definition and validation

---

## Future Work

- **`GatewayMCPAdapter`** — route gate requests to a remote MCP-connected surface instead of local canvas. Enables headless and CI gate scenarios.
- **`SigilPanelAdapter`** — route to a Sigil visualization panel over the existing WebSocket bus. Gate decision surfaces visible and actionable from Sigil.
- **`SlackAdapter`** — post gate request to a configured Slack channel; collect response from reaction or thread reply.
- **Adapter selection policy** — per-session or per-request adapter hint; fallback chain if primary adapter unavailable.
- **Durable gate records** — persist request + resolution to `db.ts` SQLite store with a `gate_decisions` table. Enables audit trail, replay, Sigil inspection.
- **`point2d` / `point3d` field kinds** — surface rendering for coordinate collection.
- **`user_signal_sequence`** — wizard-style chained gate requests returning a structured aggregate.
- **Async non-blocking variant** — `./aos gate queue` returns a `gate_id` immediately; agent polls `./aos gate result <gate_id>` asynchronously.
- **System prompt injection block** — standardized agent instruction fragment that teaches any agent when and how to use `./aos gate ask` / `user_signal_surface`, replacing ad-hoc HITL guidance in per-agent configs.
