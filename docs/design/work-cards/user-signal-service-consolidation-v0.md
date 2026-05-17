# User Signal Service Consolidation V0

## Tracker

- Platform debt map: `docs/design/2026-05-17-platform-debt-map.md`
- Design note: `docs/design/user-signal-surface.md`
- Related closed issues:
  - #359 Persist user signal gate decisions as durable records
  - #360 Add deferred user signal continuations for turn-ending HITL
  - #361 Add deferred user signal UI submit bridge
  - #362 Add Guided User Signal Session V0
- Adjacent open epics:
  - #141 Human Intent Sensing and Steerable Collection Sessions
  - #149 Supervised runs and HITL test console
  - #295 Display-first Annotation Mode and Sigil reticle

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
issue, runtime state, local gate records, continuation records, resume events,
guided-session records, or prior implementation state. Read and rediscover
before editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Pay down the consolidation debt created by the fast user-signal sequence:
durable gate records, deferred continuations, local UI submit, and guided user
signal sessions should share the same small service conventions for terminal
state, idempotency, redaction, runtime-mode storage, and provider-adapter
boundaries.

This is a cleanup/refactor slice. It should not add a new receptor, promote the
gate lifecycle into the daemon, or auto-run any provider resume backend.

## Read First

- `AGENTS.md`
- `packages/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/2026-05-17-platform-debt-map.md`
- `docs/design/user-signal-surface.md`
- `docs/design/work-cards/user-signal-durable-gate-records-v0.md`
- `docs/design/work-cards/deferred-user-signal-continuations-v0.md`
- `docs/design/work-cards/deferred-user-signal-ui-submit-bridge-v0.md`
- `docs/design/work-cards/guided-user-signal-session-v0.md`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos.gate.record.v1.json`
- `shared/schemas/aos.gate.continuation.v1.json`
- `shared/schemas/aos.gate.resume-event.v1.json`
- `shared/schemas/aos.guided-user-signal.session.v1.json`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos dev gh issue view 359 --json
./aos dev gh issue view 360 --json
./aos dev gh issue view 361 --json
./aos dev gh issue view 362 --json
```

If `./aos ready` is blocked by macOS TCC or input tap state, report the exact
blocker and continue deterministic tests only. Do not run permission repair
unless Foreman or the human explicitly routes runtime repair work.

Use isolated runtime state for any command that writes records:

```bash
AOS_STATE_ROOT="$(mktemp -d -t aos-user-signal-consolidation)" AOS_RUNTIME_MODE=repo ...
```

Do not mutate canonical `~/.config/aos/repo` state in tests.

## Existing Code To Inspect

- `packages/daemon/gate/index.js` - CLI-owned gate service and terminal record
  write path.
- `packages/daemon/gate/records.js` - durable gate record store and redaction
  policy.
- `packages/daemon/gate/continuations.js` - continuation store, idempotent
  submit, resume event formation, and adapter hint boundary.
- `packages/daemon/gate/LocalCanvasReceptor.js` - blocking receptor and
  `window.__gateResult` polling path that must remain distinct from durable UI
  submit.
- `packages/cli/verbs/gate-ask.js`, `gate-defer.js`, `gate-submit.js`,
  `gate-continuations.js`, and `gate-records.js` - public CLI surfaces.
- `packages/toolkit/runtime/gate.js` - toolkit helper for `gate.submit`.
- `packages/toolkit/components/decision-gate/index.js` and `deferred.html` -
  terminal-state UI behavior and deferred submit path.
- `packages/toolkit/workbench/guided-user-signal-session.js` - guided-session
  record normalization/store behavior.
- `src/daemon/unified.swift` - daemon bridge dispatch for `gate.submit` and
  related input/canvas boundaries.
- Current tests under `tests/daemon/`, `tests/toolkit/`, `tests/gateway/`, and
  `tests/schemas/` that mention gate, continuation, resume, or guided signal.

## Required Behavior

### 1. Inventory The Service Boundary

Write a short implementation note in the completion report, or in a small docs
update if useful, classifying current user-signal pieces as:

- blocking gate service;
- durable gate records;
- deferred continuation and resume event store;
- trusted local UI submit bridge;
- guided user signal session record;
- provider adapter hints only.

Call out duplicated helpers, policy drift, and intentionally separate code.

### 2. Consolidate Shared Runtime Store Mechanics

If inspection finds duplicated state-root/runtime-mode/path/id-validation logic,
extract the smallest shared helper at the existing ownership layer. Prefer
`packages/daemon/gate/` or a nearby shared gate/user-signal module over broad
new abstractions.

The helper must preserve:

- `AOS_STATE_ROOT` isolation;
- repo/installed runtime mode isolation;
- continuation id validation before filesystem access;
- deterministic resume event id semantics;
- existing JSON/JSONL file compatibility.

Do not migrate storage format in this slice.

### 3. Consolidate Terminal State And Idempotency Policy

Audit the terminal-state paths for:

- answered, dismissed, timeout, cancelled, submitted, captured, error;
- async submit pending behavior;
- duplicate submit idempotency;
- no-answer outcomes versus infrastructure errors.

If a shared helper makes behavior clearer, add it. If the existing separation is
correct, add focused comments/docs/tests instead of forcing an abstraction.

### 4. Consolidate Redaction Policy

Audit prompt-body, answer-payload, free-text answer, and annotation-comment
redaction across records, continuations, resume events, DecisionGate UI submit,
and guided sessions.

Expected default: redact sensitive human-authored payloads unless the request or
command explicitly opts into storage.

If possible, make this policy flow through one shared helper or one documented
normalizer. Add regressions where the most likely drift would occur.

### 5. Preserve Provider Boundaries

Codex exec or any other resume backend remains an adapter hint/event boundary.
AOS core must not auto-run provider commands in this slice. `auto_resume=false`
remains the V0 behavior even if metadata contains an entrypoint.

## Scope

Likely ownership:

- Node daemon/gate modules;
- toolkit runtime/component helpers for the existing bridge;
- guided-session normalizer/store if it shares redaction or state-root policy;
- schema/API/docs updates only where the public contract changes or a current
  design note needs correction;
- deterministic tests.

Swift changes are allowed only for a narrow bridge-contract bug found during the
audit. If Swift changes are needed, use `./aos dev build` for verification.

## Hard Boundaries / Non-Goals

- Do not promote `./aos gate ask` into a long-running daemon-owned lifecycle.
- Do not add `./aos gate queue` or a new receptor.
- Do not add network submit, remote relay, Slack, or gateway-owned state.
- Do not auto-run `codex exec`, Claude, or any provider resume backend.
- Do not change storage from JSON/JSONL to SQLite.
- Do not delete existing runtime records or canonical user state.
- Do not broaden into Display-first Annotation Mode implementation.
- Do not start the generated-artifact lifecycle policy card in the same diff.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- `packages/daemon/gate/` for shared state/redaction/idempotency helpers.
- `packages/toolkit/workbench/guided-user-signal-session.js` for guided-session
  alignment with gate redaction/state policy.
- `packages/toolkit/components/decision-gate/index.js` for any remaining
  terminal-state race tests.
- `tests/daemon/gate-continuations.test.mjs`,
  `tests/daemon/gate-records.test.mjs`, `tests/toolkit/decision-gate.test.mjs`,
  `tests/toolkit/guided-user-signal-session.test.mjs`, and schema tests for
  regressions.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  packages/daemon/gate/index.js \
  packages/daemon/gate/records.js \
  packages/daemon/gate/continuations.js \
  packages/toolkit/workbench/guided-user-signal-session.js \
  packages/toolkit/components/decision-gate/index.js
```

Run focused deterministic tests selected by the actual changed files. Expected
baseline candidates:

```bash
node --test tests/daemon/gate-continuations.test.mjs tests/daemon/gate-records.test.mjs tests/daemon/gate-service.test.mjs tests/daemon/gate-receptor.test.mjs
node --test tests/toolkit/decision-gate.test.mjs tests/toolkit/runtime-gate.test.mjs tests/toolkit/guided-user-signal-session.test.mjs
node --test tests/gateway/user-signal-surface.test.mjs
node --test tests/schemas/aos-gate-continuation.test.mjs tests/schemas/aos-guided-user-signal-session.test.mjs tests/schemas/*.test.mjs
bash tests/help-contract.sh
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
git diff --check
```

If Swift changes are made, also run:

```bash
./aos dev build
```

If `./aos ready` passes after the deterministic work, run one bounded isolated
defer/submit/readback smoke with a temporary `AOS_STATE_ROOT`. If readiness is
blocked, report the exact blocker and skip live smoke.

## Completion Report

Report:

- changed files;
- whether shared helpers were added, or why existing separation was retained;
- terminal-state/idempotency behavior checked;
- redaction behavior checked;
- exact tests run and results;
- live smoke result or readiness blocker;
- any remaining follow-up, especially whether daemon-owned gate lifecycle is now
  clearer as a future slice or still premature.
