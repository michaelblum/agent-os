# Deferred User Signal UI Submit Bridge V0

## Tracker

- GitHub issue: https://github.com/michaelblum/agent-os/issues/361
- Prior slice: #360 deferred `aos.gate.continuation.v1` and
  `aos.gate.resume-event.v1`
- Prior slice: #359 durable `aos.gate.record.v1` records
- Design note: `docs/design/user-signal-surface.md`
- Toolkit runtime docs: `docs/api/toolkit/runtime.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, permission state, prior implementation state, local gate records,
or live UI state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Make deferred user-signal continuations submittable from an AOS-hosted UI after
the creating agent process has exited.

V0 should add a local AOS bridge path from canvas content to the continuation
submit logic. A user can open a deferred signal surface, click submit, and AOS
will mark the continuation submitted exactly once and write the provider-neutral
resume event. The WebView must not shell out or run arbitrary host commands.

## Current State

Blocking gates are already rendered by `LocalCanvasReceptor` and
`DecisionGate`. That flow is intentionally process-owned:

```text
./aos gate ask
  -> create canvas
  -> poll window.__gateResult
  -> resolve and remove canvas
```

Deferred gates now have durable state:

```bash
./aos gate defer ... --json
./aos gate submit ... --json
./aos gate continuations ... --json
```

But there is no durable UI submit bridge. The missing primitive is:

```text
canvas UI emits gate.submit
  -> daemon receives bridge message
  -> daemon invokes trusted continuation submit path
  -> daemon acks canvas with success/error
  -> continuation/resume-event stores are updated
```

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/user-signal-surface.md`
- `docs/design/work-cards/deferred-user-signal-continuations-v0.md`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/components.md`
- `packages/daemon/gate/continuations.js`
- `packages/cli/verbs/gate-submit.js`
- `packages/cli/verbs/gate-defer.js`
- `packages/daemon/gate/LocalCanvasReceptor.js`
- `packages/toolkit/components/decision-gate/index.js`
- `packages/toolkit/components/decision-gate/index.html`
- `packages/toolkit/runtime/bridge.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/index.js`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `src/commands/gate.swift`
- `src/shared/command-registry-data.swift`
- `tests/daemon/gate-continuations.test.mjs`
- `tests/toolkit/decision-gate.test.mjs`
- `tests/help-contract.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos help gate --json
./aos dev gh issue view --json 361
```

If `./aos ready` is blocked by macOS TCC or input tap state, report the exact
blocker and continue deterministic tests only. If readiness is green, include a
bounded live smoke using a temporary `AOS_STATE_ROOT`.

Use isolated state for any command that writes continuation, gate record, or
resume-event state:

```bash
AOS_STATE_ROOT="$(mktemp -d -t aos-deferred-gate-ui)" AOS_RUNTIME_MODE=repo ...
```

Tests must not mutate canonical `~/.config/aos/repo` state.

## Existing Code To Inspect

- `src/daemon/unified.swift` - owns the bridge dispatch for canvas messages such
  as `canvas.create`, `canvas.eval`, `input_region.register`, and lifecycle
  events. Add the new trusted `gate.submit` bridge handler here or in a nearby
  daemon helper.
- `src/display/canvas.swift` - receives `window.webkit.messageHandlers.headsup`
  messages and forwards typed payloads to the daemon callback.
- `packages/toolkit/runtime/bridge.js` - exposes `emit(type, payload)` from
  canvas content to daemon.
- `packages/toolkit/runtime/canvas.js` - shows request/ack patterns for bridge
  helpers that include `request_id`.
- `packages/daemon/gate/continuations.js` and
  `packages/cli/verbs/gate-submit.js` - canonical V0 continuation submit logic.
- `packages/toolkit/components/decision-gate/index.js` - current form UI; keep
  reusable form behavior rather than duplicating controls.
- `packages/toolkit/components/decision-gate/index.html` - current standalone
  blocking entry point; likely needs a deferred mode or sibling entry point.
- `tests/toolkit/decision-gate.test.mjs` and
  `tests/daemon/gate-continuations.test.mjs` - deterministic coverage to extend.

## Required Behavior

### 1. Trusted Canvas Bridge Message

Add a daemon-handled bridge message, suggested shape:

```js
emit('gate.submit', {
  request_id,
  continuation_id,
  response,
  submitted_by,
  store_response
})
```

The daemon must:

- accept messages only through the existing local canvas bridge;
- validate `continuation_id` shape before any file path access;
- use the same runtime mode and `AOS_STATE_ROOT` environment as the daemon;
- call the same continuation submit semantics as `./aos gate submit`;
- return an ack/error to the caller canvas using the existing request-id
  response pattern;
- include the resume event metadata on success;
- preserve idempotency for duplicate submits.

Implementation note: if reusing the Node submit logic from Swift, use a
hard-coded repo/bundled script path and `Process` with explicit args or a temp
JSON file. Do not invoke a shell with user-controlled strings. If GDI finds a
small Swift-native storage helper is safer than spawning Node from the daemon,
that is acceptable, but it must preserve the public schemas and tests.

### 2. Toolkit Runtime Helper

Expose a small toolkit helper, suggested module:

```text
packages/toolkit/runtime/gate.js
```

Suggested API:

```js
submitGateContinuation({ continuationId, response, submittedBy, storeResponse, timeoutMs })
```

It should:

- emit `gate.submit` with a generated request id;
- resolve on daemon success ack;
- reject on daemon error ack or timeout;
- be exported from `packages/toolkit/runtime/index.js`;
- have deterministic tests without a live WebView where practical.

### 3. Deferred DecisionGate Surface

Add a UI surface that uses the existing `DecisionGate` form controls but submits
through the bridge instead of `window.__gateResult` polling.

Acceptable approaches:

- extend `createDecisionGate()` with an explicit `onSubmit` callback and create
  a deferred standalone entry point; or
- add a sibling component/entry point such as
  `components/deferred-decision-gate/index.html` that wraps `DecisionGate`.

The surface must:

- load a canonical gate request plus `continuation_id`;
- render the same expected fields/presets as the blocking gate;
- disable repeated submits while pending;
- show terminal success for first submit and duplicate submit success;
- show explicit non-submittable/error state for cancelled, expired, missing, or
  invalid continuations;
- avoid storing prompt bodies or answer payloads outside the continuation policy;
- use accessible button semantics and status text.

### 4. Launch Surface

Add a CLI or documented launch path for a deferred continuation UI. Keep it
under `./aos gate` if it is command-facing, or keep it as a toolkit component
launch helper if GDI judges that narrower.

Suggested command shape:

```bash
./aos gate defer --request gate-request.json --session-id <id> --harness codex --show --json
```

or:

```bash
./aos gate show --continuation-id <id> --json
```

Choose the smallest shape that fits existing parser boundaries. The important
behavior is that create can return and the UI submit still works later.

### 5. Security And Authority Boundary

- Do not add WebView shell execution.
- Do not expose a network listener.
- Do not allow arbitrary command execution through bridge payloads.
- Do not let a canvas submit an arbitrary path.
- Treat the daemon as the local authority for validating and writing
  continuation state.
- Keep gateway a thin adapter. Do not put continuation state or submit polling
  in `packages/gateway/src/db.ts`.

### 6. Records And Resume Events

Submitting through UI must produce the same durable state as CLI submit:

- continuation lifecycle becomes `submitted`;
- exactly one resume event exists for the continuation;
- exactly one terminal gate record is appended when appropriate;
- duplicate UI submits return the existing event and do not append duplicate
  events;
- response payloads stay redacted by default.

## Scope

Likely ownership:

- Swift daemon bridge dispatch in `src/daemon/unified.swift`;
- possibly small Swift helper for trusted Node verb invocation;
- toolkit runtime helper under `packages/toolkit/runtime/`;
- DecisionGate or sibling deferred component under
  `packages/toolkit/components/`;
- optional `./aos gate` command routing/help docs if a launch command is added;
- `docs/api/aos.md`, `docs/api/toolkit/runtime.md`,
  `docs/design/user-signal-surface.md`;
- deterministic and bounded live tests.

## Hard Boundaries / Non-Goals

- Do not build full overlay/callout/full-screen input capture in this slice.
- Do not auto-run `codex exec`.
- Do not promote the whole gate lifecycle into the long-running daemon yet.
- Do not replace blocking `./aos gate ask`.
- Do not move continuation state into gateway.
- Do not build remote relay or network submit.
- Do not make the UI submit bridge depend on a still-running creator process.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- Add `case "gate.submit"` to the canvas bridge dispatch in
  `src/daemon/unified.swift`.
- Add `handleGateSubmit(callerID:payload:)` that validates payload, calls a
  trusted submit helper, and dispatches response to caller.
- Add a small Swift helper to run `packages/cli/verbs/gate-submit.js` with
  explicit environment and a temp submission file.
- Add `packages/toolkit/runtime/gate.js` and export it.
- Add deferred mode support to `packages/toolkit/components/decision-gate/`.
- Add `tests/toolkit/deferred-decision-gate.test.mjs` or extend existing
  `tests/toolkit/decision-gate.test.mjs`.
- Add a shell smoke test only if the rebuilt `./aos` can launch and interact
  with the surface under an isolated `AOS_STATE_ROOT`.

## Verification

Run deterministic checks first:

```bash
./aos dev recommend --json
./aos dev build
node --test tests/daemon/gate-continuations.test.mjs tests/daemon/gate-records.test.mjs tests/daemon/gate-service.test.mjs tests/daemon/gate-receptor.test.mjs
node --test tests/toolkit/decision-gate.test.mjs
node --test tests/gateway/user-signal-surface.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add focused tests proving:

1. bridge `gate.submit` success returns one resume event;
2. duplicate bridge submit is idempotent;
3. invalid continuation id is rejected before storage access;
4. cancelled/expired continuations produce a clear UI/bridge error;
5. toolkit helper resolves success and rejects error/timeout;
6. deferred UI disables repeated submits and shows terminal state;
7. canonical `~/.config/aos/repo` state is not mutated by tests.

If `./aos ready` passes, run one bounded live smoke:

1. create a temp `AOS_STATE_ROOT`;
2. create a deferred continuation;
3. launch the deferred signal UI;
4. use a deterministic UI action or `aos do click` only if a real interaction
   is required and safe;
5. prove `./aos gate continuations --id <id> --json` reports `submitted`;
6. prove exactly one resume event exists.

If live readiness fails, report the exact blocker and do not claim live UI
completion.

## Completion Report

Report:

- files changed;
- final bridge message name and payload/ack shape;
- final UI launch command or component URL;
- how the daemon invokes or shares the continuation submit logic;
- verification commands and results;
- live smoke result or readiness blocker;
- confirmation that canonical repo runtime state was not mutated;
- branch name and final commit SHA;
- recommended next slice, especially whether overlay/callout/full-screen input
  capture can now build on this bridge.
