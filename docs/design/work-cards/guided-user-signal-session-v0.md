# Guided User Signal Session V0

## Tracker

- GitHub issue: https://github.com/michaelblum/agent-os/issues/362
- Prior slice: #361 deferred user-signal UI submit bridge
- Prior slice: #360 deferred `aos.gate.continuation.v1` and
  `aos.gate.resume-event.v1`
- Prior slice: #359 durable `aos.gate.record.v1` records
- Design note: `docs/design/user-signal-surface.md`
- Toolkit runtime docs: `docs/api/toolkit/runtime.md`
- Toolkit workbench docs: `docs/api/toolkit/workbench.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, permission state, prior implementation state, local gate records,
or live UI state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Define and implement the first provider-neutral Guided User Signal Session: a
paused operation can project simple guidance overlays onto live
desktop/app/browser content, capture one human click/region/annotation, optionally
ask a gate question, and write one durable record linking the whole interaction.

V0 is the bridge from form-only user signals to "show me what you mean" signals.
Keep the contract narrow, durable, and layer-correct.

## Current State

Deferred gates can now outlive the creating agent process:

```text
./aos gate defer --show --json
  -> opens deferred DecisionGate surface
  -> canvas emits gate.submit
  -> daemon writes continuation, resume event, and gate record
```

The richer owner intent is not another DecisionGate variant. It is a supervised
session that can pair visual media with a user signal:

```text
pause operation
  -> project callouts/highlights/arrows over a live subject
  -> capture one click, region, or annotation
  -> optionally ask a gate question
  -> write one linked durable record
  -> optionally hand off to deferred continuation/resume event
```

Full-screen mouse input ownership belongs in daemon/native input primitives.
Visual/session policy belongs in toolkit. Product-specific behavior belongs in
apps.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/user-signal-surface.md`
- `docs/design/work-cards/deferred-user-signal-ui-submit-bridge-v0.md`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos.gate.record.v1.json`
- `shared/schemas/aos.gate.continuation.v1.json`
- `shared/schemas/aos.gate.resume-event.v1.json`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/input-event-v2.schema.json`
- `packages/toolkit/runtime/gate.js`
- `packages/toolkit/runtime/input-region.js`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`
- `src/daemon/unified.swift`
- `tests/toolkit/runtime-gate.test.mjs`
- `tests/toolkit/decision-gate.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos dev gh issue view 362 --json
```

If `./aos ready` is blocked by macOS TCC or input tap state, report the exact
blocker and continue deterministic tests only. If readiness is green, include a
bounded live smoke using isolated state and clean up canvases afterwards.

Use isolated state for any command that writes signal, gate, continuation, or
resume-event state:

```bash
AOS_STATE_ROOT="$(mktemp -d -t aos-guided-user-signal)" AOS_RUNTIME_MODE=repo ...
```

Tests must not mutate canonical `~/.config/aos/repo` state.

## Existing Code To Inspect

- `src/daemon/unified.swift` - owns canvas bridge dispatch, `gate.submit`,
  `input_region.*`, and input event routing.
- `packages/toolkit/runtime/input-region.js` - existing request/ack helper for
  daemon-owned input regions.
- `packages/toolkit/runtime/gate.js` - deferred gate submit helper that a guided
  session may call when it includes a question.
- `packages/toolkit/workbench/annotation-session.js` and
  `packages/toolkit/workbench/annotation-overlay-renderer.js` - existing neutral
  annotation/session and overlay-render concepts to reuse instead of inventing a
  parallel annotation model.
- `docs/api/toolkit/workbench.md` - current annotation session and projection
  contracts.
- `shared/schemas/annotation.schema.json`,
  `shared/schemas/annotation-projection-v0.schema.json`, and
  `shared/schemas/input-event-v2.schema.json` - canonical shape for annotation
  intent, projection, and input event evidence.

## Required Behavior

### 1. Provider-Neutral Session Contract

Add a documented Guided User Signal Session record. The final name is GDI's
choice after reading local schema conventions, but use a clear `aos.*.v1`
contract and keep it provider-neutral.

The record should be able to carry:

- session id and source operation metadata;
- subject reference and source surface identity;
- guidance media: callout, highlight, arrow, label, or overlay descriptor;
- capture request: click, point, region, or annotation;
- captured input evidence, using existing input-event or annotation contracts
  where possible;
- optional linked gate record, continuation id, and resume event id/path;
- lifecycle state with one terminal outcome;
- redaction policy for prompt bodies and free-text answers.

### 2. Layer-Correct Input Ownership

Model full-screen or live desktop mouse capture as a daemon/native input
capability or a clear extension of existing `input_region` primitives. Do not
fake full-screen capture by making a WebView panel own the whole desktop.

V0 may use an existing input-region mechanism when that is enough, but the
contract must state what daemon primitive is authoritative for future
full-screen capture.

### 3. Toolkit Guided Session Shell

Add the smallest reusable toolkit surface/helper that can render simple guidance
media and collect one response. It may be fixture-backed or deterministic in V0,
but it must establish the boundary:

- toolkit owns overlay/callout/highlight presentation policy;
- daemon owns native input capture/routing;
- apps own product-specific copy, theme, and domain behavior.

### 4. Optional Gate Question

If the session includes a gate question, reuse the #361 deferred continuation
submit bridge. Do not duplicate `gate.submit` logic and do not add WebView shell
execution.

### 5. Durable Linked Record

Write or normalize one durable record that links all relevant artifacts:

- guided session id;
- visual guidance shown;
- captured click/region/annotation;
- optional gate record id or continuation id;
- optional resume event id/path;
- source surface and runtime mode.

The store must honor `AOS_STATE_ROOT` and runtime-mode isolation.

## Scope

Likely ownership:

- shared schema(s) and docs for the guided session record;
- toolkit runtime/workbench helper for guidance/capture session state;
- daemon input primitive or documented extension point if implementation is too
  large for V0;
- optional `./aos gate` or `./aos show` launch path only if it stays small;
- deterministic tests for normalization, persistence, and terminal-state
  behavior.

## Hard Boundaries / Non-Goals

- Do not auto-run `codex exec`.
- Do not add network submit or remote relay.
- Do not give WebView content arbitrary command execution.
- Do not build a full product UI or Sigil-specific workflow.
- Do not move toolkit overlay policy into the daemon.
- Do not invent a second annotation model when existing annotation contracts can
  represent the captured intent.
- Do not mutate canonical runtime state in tests.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- `shared/schemas/` - guided session record schema and fixture tests.
- `docs/api/aos.md` and `docs/design/user-signal-surface.md` - public contract
  and design narrative.
- `packages/toolkit/workbench/` - reusable session model or overlay helper.
- `packages/toolkit/runtime/` - small helper only if a generic daemon bridge
  capability is needed.
- `src/daemon/unified.swift` - only for native/input primitives or bridge
  messages that must survive individual canvases.
- `tests/toolkit/` and `tests/schemas/` - deterministic coverage first.

## Verification

Run deterministic checks first:

```bash
./aos dev recommend --json
node --test tests/toolkit/<focused-guided-session-test>.test.mjs
node --test tests/schemas/*.test.mjs
git diff --check
```

If Swift or command help changes:

```bash
./aos dev build
bash tests/help-contract.sh
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
```

If `./aos ready` passes, run one bounded live smoke:

1. create a temp `AOS_STATE_ROOT`;
2. launch a guided session fixture with one visible callout/highlight;
3. capture one deterministic click/region only if safe;
4. prove the guided session record is terminal and linked to any optional gate
   continuation/resume event;
5. clean up canvases.

If live readiness fails, report the exact blocker and do not claim live UI
completion.

## Foreman Review Correction - 2026-05-17

The first GDI implementation on `gdi/guided-user-signal-session-v0` is close but
not accepted yet. It documents and defaults to redaction for guided-session
prompt bodies, free text, and answer payloads, but
`packages/toolkit/workbench/guided-user-signal-session.js` currently persists
`capture_request.prompt` and `capture_result.free_text` unchanged even when the
record says:

```json
{
  "prompt_bodies": "redact",
  "free_text_answers": "redact",
  "answer_payloads": "redact"
}
```

Correct the guided-session normalizer/store so the durable record honors its
redaction policy by default, matching the gate record behavior. Raw prompt text,
free-text answers, and optional gate/answer payloads should be stored only when
the corresponding policy is `store`. Keep safe summaries if useful, but do not
silently persist private text under a `redact` policy.

Add focused tests that fail on the current behavior and pass after the fix:

- default redaction does not persist `capture_request.prompt`;
- default redaction does not persist `capture_result.free_text`;
- explicit `redaction.prompt_bodies = "store"` and
  `redaction.free_text_answers = "store"` preserve those values;
- schema validation still passes for both redacted and stored records.

Preserve the existing layer boundary: toolkit owns the normalizer/store and
shell plan, daemon owns input capture authority, and optional gate questions
continue to route through the existing `gate.submit` bridge.

## Completion Report

Report:

- files changed;
- final schema/record name and key fields;
- final input ownership boundary;
- final toolkit helper or surface entry point;
- whether optional gate submit uses the existing `gate.submit` bridge;
- verification commands and results;
- live smoke result or readiness blocker;
- confirmation that canonical repo runtime state was not mutated;
- branch name and final commit SHA;
- recommended next slice.
