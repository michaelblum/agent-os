# Human Input Gate — Design Document

**Status:** Draft  
**Area:** Daemon / Toolkit / HITL  
**Date:** 2026-05-14

---

## Overview

The **Human Input Gate** is the canonical AOS primitive for collecting bounded, structured human decisions during an agent turn. The daemon owns the gate lifecycle — request intake, deadline enforcement, result resolution, and cleanup. A **receptor** interface decouples surface delivery from the gate contract so any author can supply their own collection surface without touching the daemon.

The native receptor in v1 is the **LocalCanvas receptor**: it spawns an interactive canvas on the user's display, mounts a `DecisionGate` panel built from toolkit primitives, and reports the result back. The result reaches the agent through two thin shells:

- `./aos gate ask` — CLI verb, works from dock sessions, scripts, and agent shell-outs
- `user_signal_surface` — MCP tool on `aos-gateway`, one `execFile` call to the CLI verb

From any agent's perspective the call is: post a structured request, receive a typed value or `null`. How the surface is rendered is a receptor detail the agent never sees.

---

## Problem

Agent runtimes (Claude Code, Codex CLI, etc.) are steered by system instructions toward human-in-the-loop checkpoints. When an agent reaches a decision gate it cannot resolve autonomously — "Should I delete these 47 files?", "Which of these three strategies?" — its only recourse today is to emit prose into the terminal and stall. That pattern is:

- **Slow** — the user must notice the terminal, read context, type a response, submit.
- **Unsafe** — the agent may time out, retry, or make a conservative default that was never explicitly authorized.
- **Opaque** — no structured record of the decision, who made it, or when.
- **Non-composable** — the signal is free text; consuming code must parse intent.
- **Unroutable** — no way to redirect to a different surface without rewriting the agent.

---

## Design Principles

1. **Daemon owns time, receptor owns surface.** The daemon holds the deadline and resolves the gate. Receptors only present UI and report back. The clock is never in the receptor.

2. **One agent-facing contract, many receptors.** `./aos gate ask` and `user_signal_surface` both shell into the daemon gate service. Adding a new receptor never changes what agents call.

3. **Receptor shape is open.** Any author can implement a receptor. The native form is a toolkit panel with form primitives. Other valid receptors: a raw HTML canvas, a third-party surface, a remote relay. The shape contract is minimal — `present(request)` → `CollectionHandle`, `dismiss(handle)`, `supports(kind)`.

4. **`null` is a first-class terminal outcome.** Timeout, dismissal, and empty escape-hatch all resolve to `null`. `null` means "no decision — end this agent turn cleanly." It is not an error.

5. **Toolkit grows to support this.** The gate is the first concrete use case that demands a general form primitive layer in toolkit. That work is in scope and described below.

---

## Authority Boundary

```
Inside AOS authority
  aos daemon
  gate lifecycle: create / deadline / resolve / dismiss
  LocalCanvas receptor
  toolkit form primitives and DecisionGate panel
  ./aos CLI

Outside AOS authority
  connected agent runtimes (Claude Code, Codex, etc.)
  aos-gateway  (thin MCP shell — not an owner)
  any third-party receptor surface
```

Gateway is outside AOS authority. It is a passthrough adapter for MCP clients. It does not hold polling loops, own canvas state, or enforce deadlines.

---

## Architecture

```
Agent (any runtime)
  │  ./aos gate ask <request>         ← shell path
  │  user_signal_surface MCP tool     ← thin shell to ./aos gate ask
  ▼
Daemon Gate Service
  │  assigns gate_id
  │  validates request
  │  selects receptor
  │  starts deadline clock
  ▼
Receptor  (interface — swappable)
  ├── LocalCanvas receptor             ← v1 native form
  │     createCanvas(interactive:true)
  │     mount DecisionGate panel
  │     poll window.__gateResult
  │     removeCanvas on resolution
  │
  └── <any author-supplied receptor>   ← future / third-party
  ▼
User interacts with surface
  ▼
Daemon resolves gate: typed value or null
  ▼
Agent receives result and resumes turn
```

### Receptor Interface

```typescript
interface GateReceptor {
  // Render the surface. Returns an opaque handle used for cleanup.
  present(request: GateRequest): Promise<ReceptorHandle>;

  // Clean up the surface unconditionally.
  dismiss(handle: ReceptorHandle): Promise<void>;

  // Declare which field kinds this receptor can render.
  supports(kind: FieldKind): boolean;
}
```

The daemon calls `receptor.present()`, starts the deadline clock, and waits. On any resolution path — user answer, timeout, dismiss, or receptor error — the daemon calls `receptor.dismiss()` and returns the result to the caller. The receptor never owns the clock.

### MCP Tool as Thin Shell

```typescript
// packages/gateway/src/tools/user-signal.ts
import { execFile } from 'node:child_process';

export async function userSignalSurface(req: UserSignalRequest): Promise<unknown> {
  const requestJson = JSON.stringify(buildGateRequest(req));
  return new Promise((resolve) => {
    execFile(
      'aos',
      ['gate', 'ask', '--json', requestJson],
      { timeout: ((req.timeout_seconds ?? 20) + 5) * 1000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const s = stdout.trim();
        resolve(s === 'null' ? null : JSON.parse(s));
      }
    );
  });
}
```

No canvas management. No polling loop. No gateway-owned deadline. Twelve lines.

---

## Request Schema

Version: `aos.gate.request.v1`

```jsonc
{
  "schema_version": "aos.gate.request.v1",

  "prompt": {
    "title": "Continue?",      // required — short heading
    "body": null              // optional — markdown body text
  },

  // What value the agent expects back. Standard JSON Schema.
  "response_schema": {
    "type": "object",
    "required": ["decision"],
    "properties": {
      "decision": { "type": "string", "enum": ["yes", "no", "other"] },
      "other_text": { "type": ["string", "null"] }
    }
  },

  // How the receptor should collect it.
  // Absent = receptor picks defaults for its surface type.
  "ui": {
    "variant": "yes_no_with_escape",   // named preset (expands fields below)

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

    "timer": {
      "visible": true,
      "display": "digital",           // "digital" | "pie"
      "direction": "countDown",
      "flash_threshold_ms": 3000,
      "flash_interval_ms": 1000
    }
  },

  "timeout_ms": 20000
}
```

### Field Kinds

Field kinds are the vocabulary the form layer speaks. Each kind maps to a toolkit control. New kinds can be registered without changing the gate contract.

| Kind | Toolkit control | Returns |
|---|---|---|
| `boolean` | Toggle / checkbox | `boolean` |
| `exclusive_choice` | Button group or radio set | `string` (selected value) |
| `multi_choice` | Checkbox set | `string[]` |
| `text` | Text input | `string` |
| `number` | Number field (existing `controls/number-field.js`) | `number` |
| `point2d` | x,y coordinate pair *(v2)* | `{ x, y }` |
| `point3d` | x,y,z triple *(v2)* | `{ x, y, z }` |

V1 implements: `boolean`, `exclusive_choice`, `multi_choice`, `text`, `number`.

### Escape Hatch

The escape hatch is a composable pattern, not a special field type. A `text` field with `visible_when` referencing another field's `"other"` value is the canonical form. The surface reveals the freetext input when triggered. Any receptor rendering the form spec gets this behavior automatically from the field definitions — no special-case code.

---

## Response Contract

The gate always produces:

1. **User answer** — JSON conforming to `response_schema`.
2. **`null`** — timeout, dismissal, or empty escape-hatch submission.

`null` is terminal. The agent must handle it explicitly and must not continue the guarded action.

```bash
# CLI stdout — user answered
{"decision":"yes","other_text":null}

# CLI stdout — timeout or dismiss
null
```

---

## Presets

Presets are named `ui.variant` values that expand to a full `fields` + `response_schema`. They are the ergonomic layer — agents and scripts use preset names; the daemon and toolkit work with the expanded field config.

| Preset | Description | Return shape |
|---|---|---|
| `yes_no_with_escape` | Yes / No + conditional freetext escape hatch | `{ decision: "yes"\|"no"\|"other", other_text: string\|null }` |
| `approve_deny` | Approve (green) / Deny (red) + escape hatch | `{ decision: "approve"\|"deny", other_text: string\|null }` |
| `single_choice` | Labeled button set, pick one | `{ decision: string }` |
| `multi_choice` | Labeled checkbox set, pick many | `{ decisions: string[] }` |
| `freetext` | Text input only | `{ text: string }` |

Custom forms omit `ui.variant` and specify `ui.fields` directly.

---

## Toolkit Work Required

The gate is the first component in AOS that needs a **general form primitive layer** in toolkit. The existing `controls/number-field.js` is the only form control today. Everything below is new work.

### What toolkit currently has

- `controls/number-field.js` — wheel/key stepping for numeric inputs. Good foundation.
- `controls/defaults.css` — base control visual tokens.
- `panel/` — chrome, drag/resize, router, layouts (Single, SplitPane, Tabs). Solid.
- `components/` — higher-level Content units (inspector, log-console, etc.).
- `runtime/bridge.js`, `canvas.js` — the interop foundation everything sits on.

Missing: a general set of UI controls covering the interactions a gate (or any other interactive panel) needs.

### Controls to add (`controls/`)

These are Layer 1a controls — reusable, not opinionated about a specific use case. Same pattern as `number-field.js`: a focused behavior module that can be wired into any surface.

```
controls/
  text-field.js           single-line text input — focus, validation, value, placeholder
  toggle.js               boolean toggle / checkbox — checked state, change events
  button.js               pressable button — variants (primary, secondary, danger, ghost),
                          disabled state, active/focus feedback
  button-group.js         exclusive-choice button set — mutual selection, keyboard nav
  checkbox-group.js       multi-choice checkbox set — indeterminate state, select-all
  select.js               single-value dropdown
  timer-bar.js            depleting visual timer — countDown/countUp, digital/pie display,
                          flash threshold, configurable colors
  index.js                re-exports all controls
```

Each control is a plain JS module: exports a factory function, takes a config object, returns a `{ el, getValue, setValue, on, destroy }` shape. No framework dependency. Styled via `controls/defaults.css` tokens.

### Form harness (`panel/form.js`)

A form harness lives at the panel layer (Layer 1b) — it sits between raw controls and the Content component. It consumes a `fields[]` array from the gate request schema, renders each field via the appropriate control, tracks per-field state, enforces `visible_when` conditions reactively, and exposes a `getValues()` / `isValid()` / `onChange` API.

```
panel/
  form.js                 field-schema → DOM form
                            renderFields(fields, container)
                            getValues() → object
                            isValid() → boolean
                            onChange(callback)
                            visible_when reactive evaluation
```

The form harness is the reusable piece that makes any panel interactive. The gate uses it. Future components (config panels, search filters, etc.) use it too.

### Gate component (`components/decision-gate/`)

Built on the form harness. A Content unit that accepts a `GateRequest`, mounts inside a `Single` panel layout, and sets `window.__gateResult` on submit or dismiss.

```
components/decision-gate/
  index.js                DecisionGate Content factory
                            accepts GateRequest via channel message or URL param
                            mounts: GateHeader, form harness, GateActions, TimerBar
                            on submit: validates, sets window.__gateResult, emits
                            on dismiss / escape hatch empty: sets window.__gateResult = null
  index.html              mountPanel({ title, layout: Single(DecisionGate) })
  styles.css              gate chrome: backdrop, surface elevation, action row spacing
```

### Dependency graph

```
controls/text-field.js
controls/toggle.js
controls/button.js
controls/button-group.js
controls/checkbox-group.js
controls/timer-bar.js
  └─ panel/form.js              consumes controls, implements visible_when
       └─ components/decision-gate/   consumes form.js + panel chrome
            └─ LocalCanvas receptor   spawns canvas, mounts component, polls result
```

Each layer is independently useful. `panel/form.js` and the new controls have value outside the gate.

---

## LocalCanvas Receptor

The v1 native receptor. Lives in the daemon package.

```
packages/daemon/src/receptors/
  local-canvas.ts          LocalCanvasReceptor implements GateReceptor
                             present(): createCanvas(interactive:true) → launch decision-gate component
                             poll:      evalCanvas(id, 'window.__gateResult ...')
                             dismiss(): removeCanvas(id)
  index.ts                 re-exports
```

The receptor is entirely local — no network, no relay. The daemon controls the canvas lifecycle through `aos-proxy.ts` calls exactly as other canvas operations do.

### Signal protocol

The canvas reports resolution by setting `window.__gateResult` to a JSON-stringified value (or the string `"null"` for no-response). The receptor polls at 400ms via `evalCanvas`. On detection, it calls back into the gate service, which resolves the request, dismisses the surface, and returns the value to the caller.

This is a receptor-internal detail. The gate service contract is identical regardless of how any receptor communicates back.

---

## Daemon Gate Service

Responsibilities:

- Accept gate requests from CLI (`./aos gate ask`) and any internal caller
- Assign a unique `gate_id`
- Validate the request against `aos.gate.request.v1`
- Select a receptor (v1: always `LocalCanvasReceptor`)
- Start the deadline clock
- Resolve the gate on any terminal event (user answer / timeout / dismiss / receptor error)
- Call `receptor.dismiss()` on all resolution paths
- Log gate lifecycle events

### Timeout enforcement

Timeout is daemon-authoritative. The `TimerBar` in the canvas is cosmetic feedback only. The daemon's deadline fires at `timeout_ms` and resolves to `null` regardless of canvas state.

---

## Agent-Facing Surfaces

### CLI: `./aos gate ask`

```bash
# Zero-config — yes/no + escape + 20s timer
./aos gate ask "Continue?"

# Preset shorthand
./aos gate ask --preset approve_deny --title "Run disruptive TCC test?" --timeout 30

# Full request from file
./aos gate ask --request gate-request.json

# Inline JSON
./aos gate ask --json '{"prompt":{"title":"Delete files?"},"ui":{"variant":"approve_deny"},"timeout_ms":20000}'
```

Stdout is always the response value or the bare string `null`. Callers parse stdout as JSON, treating `null` as the no-response terminal case.

### MCP Tool: `user_signal_surface`

Registered on `aos-gateway`. One `execFile` to `./aos gate ask --json <request>`. No gateway-owned state. See implementation in Architecture section above.

**Tool definition:**

```typescript
{
  name: 'user_signal_surface',
  description:
    'Request a bounded structured human decision via a transient AOS surface. ' +
    'Always returns a typed value or null. null = no response — end the current ' +
    'agent turn cleanly. Do not continue a guarded action until this returns.',
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

---

## Usage Examples

### Approve / Deny (Destructive Action Gate)

```bash
result=$(./aos gate ask --preset approve_deny --title "Delete 47 files in ~/Downloads/old-project?")
if [ "$result" = "null" ] || [ "$(echo $result | jq -r .decision)" = "deny" ]; then
  echo "aborted"; exit 0
fi
```

```typescript
// MCP tool call from agent
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
    { value: 'big_bang',    label: 'Big Bang',    description: 'Full rewrite, riskier', danger: true },
    { value: 'hybrid',      label: 'Hybrid',      description: 'Rewrite core, migrate edges' },
  ],
  timeout_seconds: 30,
});
if (result === null) return;
```

### Custom Form Request

```typescript
const result = await callTool('user_signal_surface', {
  title: 'ignored — overridden by request',
  request: {
    schema_version: 'aos.gate.request.v1',
    prompt: { title: 'Configure run parameters', body: 'Set the values for this test run.' },
    response_schema: {
      type: 'object',
      required: ['env', 'dry_run'],
      properties: {
        env:     { type: 'string', enum: ['staging', 'production'] },
        dry_run: { type: 'boolean' },
        notes:   { type: ['string', 'null'] },
      },
    },
    ui: {
      variant: null,
      fields: [
        { id: 'env',     kind: 'exclusive_choice', style: 'buttons',
          options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production', danger: true }] },
        { id: 'dry_run', kind: 'boolean', label: 'Dry run only' },
        { id: 'notes',   kind: 'text', placeholder: 'Optional notes...' },
      ],
      timer: { visible: true, display: 'digital', direction: 'countDown', flash_threshold_ms: 5000 },
    },
    timeout_ms: 45000,
  },
});
```

---

## Gate Lifecycle State Machine

```
REQUESTED
  │  daemon assigns gate_id, validates, selects receptor
  ▼
PRESENTING
  │  receptor.present() called; deadline clock starts
  ├─ user submits value ────────────────────────────────────────► RESOLVED (answer)
  ├─ user dismisses / escape hatch empty ──────────────────────► RESOLVED (null)
  ├─ deadline fires ───────────────────────────────────────────► RESOLVED (null)
  └─ receptor error ───────────────────────────────────────────► RESOLVED (null)
                                                                        │
                                                         receptor.dismiss() called
                                                         result returned to caller
```

All paths call `receptor.dismiss()`. `null` is never an error — it is the designed terminal outcome for all non-answer paths.

---

## Logging

```json
{ "event": "gate.requested", "gate_id": "gate-abc123", "session_id": "...", "variant": "approve_deny", "timeout_ms": 20000 }
{ "event": "gate.presented", "gate_id": "gate-abc123", "receptor": "LocalCanvasReceptor" }
{ "event": "gate.resolved",  "gate_id": "gate-abc123", "resolution": "user", "elapsed_ms": 7430 }
```

Resolution values: `"user"` | `"timeout"` | `"dismiss"` | `"error"`. Response value is not logged in v1.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `timeout_ms` < 5000 | Clamped to 5000 |
| `timeout_ms` > 120000 | Clamped to 120000 |
| No display available | `LocalCanvasReceptor` fails; daemon resolves `null`; logs `resolution: error` |
| Canvas window force-closed | Receptor poll throws; daemon resolves `null` |
| Daemon restarts during active gate | Canvas orphaned; MCP call errors; caller treats as `null` |
| `single_choice` with empty `choices` | Daemon rejects; returns `null`; logs warning |
| `response_schema` validation fails on submit | Surface shows inline error; does not dismiss; user corrects or timeout fires |
| Multiple concurrent gate requests | Each has unique `gate_id` and independent surface; daemon manages concurrently |

---

## V1 Scope

### Daemon
- [ ] Gate service — intake, receptor dispatch, deadline clock, resolution, logging
- [ ] `GateReceptor` interface
- [ ] `LocalCanvasReceptor`
- [ ] `aos.gate.request.v1` schema definition and validation
- [ ] `./aos gate ask` CLI verb (`--preset`, `--title`, `--timeout`, `--json`, `--request`)

### Toolkit — Controls (`controls/`)
- [ ] `text-field.js`
- [ ] `toggle.js`
- [ ] `button.js`
- [ ] `button-group.js`
- [ ] `checkbox-group.js`
- [ ] `timer-bar.js` (digital + pie variants, countDown/countUp, flash threshold, colors)
- [ ] `controls/defaults.css` — extend with form control tokens

### Toolkit — Panel layer (`panel/`)
- [ ] `form.js` — field-schema → DOM form, `visible_when` reactivity, `getValues()`, `isValid()`

### Toolkit — Component (`components/decision-gate/`)
- [ ] `index.js` — DecisionGate Content factory
- [ ] `index.html` — mountPanel entry point
- [ ] `styles.css` — gate chrome

### Gateway
- [ ] `user_signal_surface` MCP tool — thin shell to `./aos gate ask`

---

## Future Work

- **Author-supplied receptors** — document the `GateReceptor` interface so third-party AOS panel authors can register their own receptor shapes.
- **Receptor selection policy** — per-session or per-request receptor hint; fallback chain if primary receptor unavailable (e.g., no display → queued / deferred).
- **Durable gate records** — persist request + resolution to `db.ts` SQLite store (`gate_decisions` table). Enables audit trail, replay, and inspection.
- **Async non-blocking variant** — `./aos gate queue` returns a `gate_id` immediately; agent polls `./aos gate result <gate_id>` asynchronously.
- **`point2d` / `point3d` field kinds** — coordinate collection controls and surface rendering.
- **`user_signal_sequence`** — wizard-style chained gate requests returning a structured aggregate.
- **System prompt injection block** — standardized agent instruction fragment describing when and how to call `./aos gate ask` / `user_signal_surface`, replacing ad-hoc HITL guidance in per-agent configs.
- **Remote relay receptor** — gate requests relayed over an external channel (WebSocket, webhook, etc.) for headless, CI, or mobile decision scenarios. Author-supplied via the receptor interface.
