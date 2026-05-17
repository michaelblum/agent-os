# Human Input Gate — Design Document

**Status:** Draft  
**Area:** Daemon / Toolkit / HITL  
**Date:** 2026-05-14

---

## Overview

The **Human Input Gate** is the canonical AOS contract for collecting bounded, structured human decisions during an agent turn. In v1 the lifecycle is owned by the `./aos gate ask` CLI process: it normalizes the request, starts the service, enforces the deadline, resolves the result, and cleans up. Promoting that lifecycle into the long-running daemon remains the intended daemon primitive, but it is deferred rather than missing from v1.

The native receptor in v1 is the **LocalCanvas receptor**: it spawns an interactive canvas on the user's display, mounts a `DecisionGate` panel built from toolkit primitives, and reports the result back. The result reaches the agent through two thin shells:

- `./aos gate ask` — CLI verb, works from dock sessions, scripts, and agent shell-outs
- `user_signal_surface` — MCP tool on `aos-gateway`, one `execFile` call to the CLI verb

From any agent's perspective the call is: post a structured request, receive either a typed answer value or a no-answer envelope. How the surface is rendered is a receptor detail the agent never sees.

V0.1 adds a deferred path for cases where the agent turn should end before the
human responds. `./aos gate defer` normalizes the same `aos.gate.request.v1`
request, writes a durable `aos.gate.continuation.v1` record, captures
provider-neutral session metadata, and returns immediately. A later local submit
bridge calls `./aos gate submit --continuation-id ...`, which marks the
continuation terminal exactly once and writes one human-authored
`aos.gate.resume-event.v1` for the original session. The resume event carries
the session id, harness/provider hint, continuation id, gate id, submitted
status, redacted answer summary, and adapter hint such as `codex_exec`. The
continuation record also carries resume entrypoint metadata such as
`codex_exec_adapter` plus `auto_resume=false`; AOS core does not auto-run
provider-specific resume commands, and V0 treats auto-resume as disabled even if
a future caller sets the field.

V0.2 adds the first durable local UI submit bridge for those deferred
continuations. A trusted AOS canvas can emit `gate.submit` through the existing
`headsup` WebView bridge with a `request_id`, `continuation_id`, response
payload, submitted-by metadata, and explicit `store_response` flag. The daemon
validates the continuation id before storage access, invokes the same
continuation submit semantics as `./aos gate submit` through an explicit
Process/temp-file path, and returns a `canvas.response` ack containing the
submit response and resume event metadata. The stock deferred DecisionGate
surface is launched with `./aos gate defer --show --json` and submits through
the toolkit runtime helper rather than polling `window.__gateResult`.

V0.3 adds a provider-neutral Guided User Signal Session for visual
human-in-the-loop capture. It is not another DecisionGate variant. A guided
session records the paused source operation, source surface, guidance media
(`callout`, `highlight`, `arrow`, `label`, or `overlay`), one requested human
signal (`click`, `point`, `region`, or `annotation`), one optional capture
result, optional gate/continuation/resume-event links, lifecycle state, and
redaction policy. The public record is
`aos.guided-user-signal.session.v1`.

The ownership boundary is explicit: toolkit owns reusable visual/session policy
for guidance overlays and one-response collection; daemon/native input owns
mouse capture and routing through `input_region` today or a future
`daemon_native_full_screen_input_capture` primitive for full-screen capture.
Apps own product copy, theming, and domain interpretation. If a guided session
includes a gate question, it reuses the existing `gate.submit` bridge and
`submitGateContinuation()` helper rather than adding a second WebView submit
path.

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

1. **The gate service owns time, receptor owns surface.** In v1 the gate service runs inside the `./aos gate ask` CLI process. It holds the deadline and resolves the gate. Receptors only present UI and report back. Moving the same service behind the long-running daemon is deferred.

2. **One agent-facing contract, many receptors.** `./aos gate ask` is canonical. `user_signal_surface` is the MCP adapter surface for that verb and shells into it. Adding a new receptor never changes what agents call.

3. **Receptor shape is open.** Any author can implement a receptor. The native form is a toolkit panel with form primitives. Other valid receptors: a raw HTML canvas, a third-party surface, a remote relay. The shape contract is minimal — `present(request)` → `CollectionHandle`, `dismiss(handle)`, `supports(kind)`.

4. **No-answer is explicit.** Human dismissal resolves to `{ "result": null, "status": "dismissed" }`; human timeout resolves to `{ "result": null, "status": "timeout" }`. These are not MCP errors. Infrastructure failures that prevent presentation, such as no display or receptor failure, are errors with machine-readable codes.

5. **Toolkit grows to support this.** The gate is the first concrete use case that demands a general form primitive layer in toolkit. That work is in scope and described below.

---

## Authority Boundary

```
Inside AOS authority
  ./aos gate ask CLI-owned service in v1
  gate lifecycle: normalize / create / deadline / resolve / dismiss
  LocalCanvas receptor shelling through AOS show primitives
  toolkit form primitives and DecisionGate panel
  ./aos CLI

Deferred AOS authority
  long-running daemon-owned gate lifecycle primitive

Outside AOS authority
  connected agent runtimes (Claude Code, Codex, etc.)
  aos-gateway  (thin MCP shell — not an owner)
  any third-party receptor surface
```

Gateway is outside AOS authority. It is a passthrough adapter for MCP clients. It accepts ergonomic MCP shorthand or a full v1 request, normalizes to `aos.gate.request.v1`, writes the request to a tempfile, and shells to `./aos gate ask`. It does not hold polling loops, own canvas state, or enforce deadlines.

Deferred continuation state is also inside AOS authority, not gateway authority.
Continuation JSON files live under the active runtime state root at
`gate/continuations/`, and resume events live at `gate/resume-events/`. The
gateway may create or submit through the CLI later, but it must not own a
separate continuation database.

---

## Architecture

```
Agent (any runtime)
  │  ./aos gate ask <request>         ← shell path
  │  user_signal_surface MCP tool     ← thin shell to ./aos gate ask
  ▼
CLI-owned Gate Service (v1)
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
Gate service resolves: typed value or no-answer envelope
  ▼
Agent receives result and resumes turn
```

Deferred flow:

```text
Agent (any runtime)
  │  ./aos gate defer --request ... --session-id ... --harness ...
  ▼
AOS continuation store
  │  writes aos.gate.continuation.v1 with lifecycle.state=pending
  ▼
Agent turn ends
  ▼
Human submits through a local bridge or CLI
  │  ./aos gate submit --continuation-id ...
  ▼
AOS continuation store
  │  marks submitted exactly once
  │  appends terminal aos.gate.record.v1
  │  writes aos.gate.resume-event.v1
  ▼
Provider adapter
  │  reads the provider-neutral event and chooses an opt-in resume backend
```

The current `DecisionGate` LocalCanvas receptor is intentionally still the
blocking receptor. It works by polling `window.__gateResult` from the creating
`./aos gate ask` process and removing the canvas on resolution. That is not a
safe durable bridge after the creator exits. UI-driven deferred submit should be
added as a later receptor/input-bridge primitive that can call back into AOS
without WebView shell execution or brittle polling.

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

The v1 gate service calls `receptor.present()`, starts the deadline clock, and waits. On any terminal user path — answer, timeout, or dismiss — it calls `receptor.dismiss()` and returns the result to the caller. On infrastructure failure it still attempts cleanup, then returns an error with a machine-readable code. The receptor never owns the authoritative clock.

### MCP Tool as Thin Shell

```typescript
// packages/gateway/src/tools/user-signal.ts
import { execFile } from 'node:child_process';

export async function userSignalSurface(req: UserSignalRequest): Promise<unknown> {
  const request = normalizeToGateRequestV1(req); // expands presets and top-level fields
  const requestJson = JSON.stringify(request);
  return new Promise((resolve, reject) => {
    execFile(
      'aos',
      ['gate', 'ask', '--json', requestJson],
      { timeout: ((req.timeout_seconds ?? 20) + 5) * 1000 },
      (err, stdout, stderr) => {
        if (err) { reject(parseGateError(err, stderr)); return; }
        const s = stdout.trim();
        resolve(JSON.parse(s));
      }
    );
  });
}
```

No canvas management. No polling loop. No gateway-owned deadline. Operational failures stay errors.

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

  // Reserved for future response validation. V1 validates field requiredness only.
  "response_schema": {
    "type": "object",
    "required": ["decision"],
    "properties": {
      "decision": { "type": "string", "enum": ["yes", "no", "other"] },
      "other_text": { "type": ["string", "null"] }
    }
  },

  // Canonical field definitions. Adapters expand presets into top-level fields
  // before forwarding to the service.
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

  // Presentation hints only. ui.fields is accepted by adapters as legacy
  // input and normalized into top-level fields before service handoff.
  "ui": {
    "variant": "yes_no_with_escape",

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

The gate produces one of three outcomes:

1. **User answer** — the typed JSON value assembled from visible fields.
2. **No answer** — `{ "result": null, "status": "dismissed" }` when the human dismissed the gate.
3. **Timeout** — `{ "result": null, "status": "timeout" }` when the presented gate timed out.

No-answer envelopes are terminal. The agent must handle them explicitly and must not continue the guarded action. Infrastructure failures that prevent presentation are errors, not `null`.

```bash
# CLI stdout — user answered
{"decision":"yes","other_text":null}

# CLI stdout — timeout
{"result":null,"status":"timeout"}

# CLI stdout — dismiss
{"result":null,"status":"dismissed"}
```

---

## Presets

Presets are named `ui.variant` values that expand to top-level `fields`. They are the ergonomic layer for CLI and MCP adapters. The expansion function lives in `shared/gate/presets.mjs`; the service and adapters call that shared function rather than owning private preset tables. Browser-loaded toolkit components consume canonical top-level `fields` so they do not depend on a cross-root import from `aos://toolkit`.

| Preset | Description | Return shape |
|---|---|---|
| `yes_no_with_escape` | Yes / No + conditional freetext escape hatch | `{ decision: "yes"\|"no"\|"other", other_text: string\|null }` |
| `approve_deny` | Approve (green) / Deny (red) + escape hatch | `{ decision: "approve"\|"deny", other_text: string\|null }` |
| `single_choice` | Labeled button set, pick one | `{ decision: string }` |
| `multi_choice` | Labeled checkbox set, pick many | `{ decisions: string[] }` |
| `freetext` | Text input only | `{ text: string }` |

Custom forms omit `ui.variant` and specify top-level `fields` directly. Adapters may accept old `ui.fields` input, but must normalize it into top-level `fields` before forwarding.

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

Built on the form harness. A Content unit that accepts a canonical `GateRequest` with top-level `fields`, mounts inside a `Single` panel layout, and sets `window.__gateResult` on submit, dismiss, or visual timer expiry.

```
components/decision-gate/
  index.js                DecisionGate Content factory
                            accepts GateRequest via channel message or URL param
                            mounts: GateHeader, form harness, GateActions, TimerBar
                            on submit: validates, sets window.__gateResult, emits
                            on dismiss: sets {"result":null,"status":"dismissed"}
                            on timer expiry: sets {"result":null,"status":"timeout"}
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

The v1 native receptor. It lives in the daemon package namespace today, but is invoked by the CLI-owned v1 service.

```
packages/daemon/gate/
  LocalCanvasReceptor.js   LocalCanvasReceptor implements GateReceptor
                             present(): createCanvas(interactive:true) → launch decision-gate component
                             poll:      evalCanvas(id, 'window.__gateResult ...')
                             dismiss(): removeCanvas(id)
  index.ts                 re-exports
```

The receptor is entirely local — no network, no relay. It controls the canvas lifecycle by shelling to `./aos show` just like other CLI-owned surface operations.

### Signal protocol

The canvas reports resolution by setting `window.__gateResult` to a JSON-stringified answer value or no-answer envelope. The receptor polls at 400ms via `evalCanvas`. On detection, it calls back into the gate service, which resolves the request, dismisses the surface, and returns the value or envelope to the caller.

This is a receptor-internal detail. The gate service contract is identical regardless of how any receptor communicates back.

---

## Gate Service

Responsibilities:

- Accept canonical gate requests from CLI (`./aos gate ask`) and any internal caller
- Assign a unique `gate_id`
- Validate the request against `aos.gate.request.v1`
- Select a receptor (v1: always `LocalCanvasReceptor`)
- Start the deadline clock
- Resolve the gate on terminal user events: answer, timeout, or dismiss
- Return machine-coded errors for operational failures such as receptor errors
- Call `receptor.dismiss()` on terminal and error cleanup paths
- Log gate lifecycle events

### Timeout enforcement

Timeout is service-authoritative. The service deadline fires at `timeout_ms` and resolves to `{ "result": null, "status": "timeout" }`. The `TimerBar` in the canvas mirrors the same deadline for feedback and may also report a timeout envelope if it expires first.

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

# Deliberately persist the resolved answer payload in the audit record
./aos gate ask --store-response --preset freetext --title "Why?"
```

Stdout is always JSON: either the typed answer value or a no-answer envelope. Operational failures exit non-zero and print a machine-readable code in stderr.

Each terminal `aos.gate.request.v1` outcome also appends one runtime-scoped durable record to JSONL at `~/.config/aos/{repo|installed}/gate/records.jsonl`, or `$AOS_STATE_ROOT/{repo|installed}/gate/records.jsonl` when an explicit state root is set. The CLI-owned service writes these records for answered, dismissed, timeout, and receptor/infrastructure error outcomes, so callers through shell, dock sessions, or `user_signal_surface` share the same audit path. Gateway remains a thin adapter and does not own this state.

The record schema is `aos.gate.record.v1`. Records include `gate_id`, request schema version, prompt title, source `surface`/`session_id`/`agent`, receptor, UI variant, field kinds, timeout, created/presented/resolved timestamps, elapsed milliseconds, resolution, no-answer status when applicable, and operational error code/message when applicable. Answer payloads and prompt bodies are redacted by default; `response_stored` is `false` unless the request carries `metadata.record_response: true` or the CLI is invoked with `--store-response`.

Readback is intentionally local and JSON-only:

```bash
./aos gate records --json
./aos gate records --limit 20 --json
./aos gate records --id gate-abc123 --json
./aos gate records --status answered --json
```

### MCP Tool: `user_signal_surface`

Registered on `aos-gateway`. It accepts ergonomic shorthand or a full request, normalizes to canonical `aos.gate.request.v1`, writes a tempfile, and runs one `execFile` to `./aos gate ask --request <file>`. No gateway-owned state. See implementation in Architecture section above.

**Tool definition:**

```typescript
{
  name: 'user_signal_surface',
	description:
	  'Request a bounded structured human decision via a transient AOS surface. ' +
	  'Returns a typed value, or { result: null, status: "dismissed"|"timeout" }. ' +
	  'Operational failures are tool errors with machine-readable codes.',
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
    required: [],
  },
}
```

---

## Usage Examples

### Approve / Deny (Destructive Action Gate)

```bash
result=$(./aos gate ask --preset approve_deny --title "Delete 47 files in ~/Downloads/old-project?")
if [ "$(echo "$result" | jq -r '.status // empty')" != "" ] || [ "$(echo "$result" | jq -r .decision)" = "deny" ]; then
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
if (result?.result === null || result.decision === 'deny') return { aborted: true };
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
if (result?.result === null) return;
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
    fields: [
      { id: 'env',     kind: 'exclusive_choice', style: 'buttons',
        options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production', danger: true }] },
      { id: 'dry_run', kind: 'boolean', label: 'Dry run only' },
      { id: 'notes',   kind: 'text', placeholder: 'Optional notes...' },
    ],
    ui: {
      variant: null,
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
  │  service assigns gate_id, validates, selects receptor
  ▼
PRESENTING
  │  receptor.present() called; deadline clock starts
  ├─ user submits value ────────────────────────────────────────► RESOLVED (answer)
  ├─ user dismisses ───────────────────────────────────────────► RESOLVED ({result:null,status:"dismissed"})
  ├─ deadline fires ───────────────────────────────────────────► RESOLVED ({result:null,status:"timeout"})
  └─ receptor error ───────────────────────────────────────────► ERROR (machine code)
                                                                        │
                                                         receptor.dismiss() called
                                                         result returned to caller
```

Terminal and error cleanup paths call `receptor.dismiss()` when a handle exists. Bare `null` is not a service result in v1; no-answer states are explicit envelopes.

---

## Logging

```json
{ "event": "gate.requested", "gate_id": "gate-abc123", "session_id": "...", "variant": "approve_deny", "timeout_ms": 20000 }
{ "event": "gate.presented", "gate_id": "gate-abc123", "receptor": "LocalCanvasReceptor" }
{ "event": "gate.resolved",  "gate_id": "gate-abc123", "resolution": "answered", "elapsed_ms": 7430 }
```

Resolution values: `"answered"` | `"timeout"` | `"dismissed"` | `"error"`. Response value is not logged in v1.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `timeout_ms` < 5000 | Clamped to 5000 |
| `timeout_ms` > 120000 | Clamped to 120000 |
| No display available | `LocalCanvasReceptor` fails with `AOS_GATE_PRESENT_FAILED`; caller receives an operational error |
| Canvas window force-closed | Receptor poll throws `AOS_GATE_RECEPTOR_ERROR` |
| CLI subprocess times out in MCP adapter | Adapter raises `AOS_GATE_PROCESS_TIMEOUT` |
| `single_choice` with empty `choices` | Service rejects with `AOS_GATE_INVALID_REQUEST` |
| `response_schema` present | Preserved as reserved metadata; not enforced in v1 |
| Multiple concurrent gate requests | Each has unique `gate_id` and independent surface; service manages concurrently |

---

## V1 Scope

### CLI-Owned Service
- [x] Gate service — intake, receptor dispatch, deadline clock, resolution, logging
- [x] `GateReceptor` interface
- [x] `LocalCanvasReceptor`
- [x] `aos.gate.request.v1` schema definition and field validation
- [x] `./aos gate ask` CLI verb (`--preset`, `--title`, `--timeout`, `--json`, `--request`)
- [x] Durable gate records — runtime-scoped JSONL audit records plus `./aos gate records --json` readback

### Toolkit — Controls (`controls/`)
- [x] `text-field.js`
- [x] `toggle.js`
- [x] `button.js`
- [x] `button-group.js`
- [x] `checkbox-group.js`
- [x] `timer-bar.js` (digital + pie variants, countDown/countUp, flash threshold, colors)
- [x] `controls/defaults.css` — extend with form control tokens

### Toolkit — Panel layer (`panel/`)
- [x] `form.js` — field-schema → DOM form, `visible_when` reactivity, `getValues()`, `isValid()`

### Toolkit — Component (`components/decision-gate/`)
- [x] `index.js` — DecisionGate Content factory
- [x] `index.html` — standalone entry point
- [x] `styles.css` — gate chrome

### Gateway
- [x] `user_signal_surface` MCP tool — thin shell to `./aos gate ask`

### Deferred
- [ ] Promote CLI-owned gate service into the long-running daemon primitive
- [ ] Move gate records from JSONL into an AOS-owned SQLite store if/when a daemon-owned store becomes available

---

## Future Work

- **Author-supplied receptors** — document the `GateReceptor` interface so third-party AOS panel authors can register their own receptor shapes.
- **Receptor selection policy** — per-session or per-request receptor hint; fallback chain if primary receptor unavailable (e.g., no display → queued / deferred).
- **Async non-blocking variant** — `./aos gate queue` returns a `gate_id` immediately; agent polls `./aos gate result <gate_id>` asynchronously.
- **`point2d` / `point3d` field kinds** — coordinate collection controls and surface rendering.
- **`user_signal_sequence`** — wizard-style chained gate requests returning a structured aggregate.
- **System prompt injection block** — standardized agent instruction fragment describing when and how to call `./aos gate ask` / `user_signal_surface`, replacing ad-hoc HITL guidance in per-agent configs.
- **Remote relay receptor** — gate requests relayed over an external channel (WebSocket, webhook, etc.) for headless, CI, or mobile decision scenarios. Author-supplied via the receptor interface.
