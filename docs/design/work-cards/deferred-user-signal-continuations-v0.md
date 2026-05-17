# Deferred User Signal Continuations V0

## Tracker

- GitHub issue: https://github.com/michaelblum/agent-os/issues/360
- Design note: `docs/design/user-signal-surface.md`
- Prior slice: #359 durable `aos.gate.record.v1` records
- Adjacent design notes:
  - `docs/design/remote-session-control.md`
  - `docs/design/work-cards/workbench-human-checkpoint-v0.md`
  - `shared/schemas/workbench-human-checkpoint-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, prior implementation state, local gate records, or Codex session
state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Add the first durable deferred user-signal path: an agent can publish a
user-signal continuation, end the current turn, and later accept a human submit
event that creates a provider-neutral resume message/event for the associated
session.

V0 is the contract and local mechanics slice. It should make the continuation
state real and testable without requiring a long-running agent process to wait
for the UI. Blocking `./aos gate ask` remains supported and should not regress.

## Product Shape

There are now two gate modes:

- **Blocking gate:** `./aos gate ask` waits for answer, dismissal, timeout, or
  error in the current process.
- **Deferred gate:** a new command or mode creates a durable continuation and
  returns immediately. A later submit event records the human signal, marks the
  continuation terminal exactly once, and emits or queues a resume payload for
  the original session.

The user-facing idea is:

1. Agent reaches a HITL point and creates a deferred user-signal continuation.
2. A signal UI can remain on screen after the agent turn ends.
3. The human clicks submit or triggers the submit event.
4. AOS records the submitted signal as human-authored session input.
5. A provider adapter can resume the session with `codex exec` or another
   backend-specific mechanism.

Keep AOS as the owner of continuation/session records. Codex exec is one resume
backend, not the core primitive.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/user-signal-surface.md`
- `docs/api/aos.md`
- `docs/design/remote-session-control.md`
- `docs/design/work-cards/workbench-human-checkpoint-v0.md`
- `shared/schemas/workbench-human-checkpoint-v0.md`
- `shared/schemas/aos.gate.request.v1.json`
- `shared/schemas/aos.gate.record.v1.json`
- `src/commands/gate.swift`
- `src/shared/command-registry-data.swift`
- `packages/cli/verbs/gate-ask.js`
- `packages/cli/verbs/gate-records.js`
- `packages/daemon/gate/index.js`
- `packages/daemon/gate/records.js`
- `packages/daemon/gate/LocalCanvasReceptor.js`
- `packages/toolkit/components/decision-gate/index.js`
- `packages/toolkit/components/decision-gate/index.html`
- `packages/gateway/tools/user-signal-surface.js`
- `src/commands/tell.swift`
- `src/commands/listen.swift`
- `tests/daemon/gate-records.test.mjs`
- `tests/daemon/gate-service.test.mjs`
- `tests/gateway/user-signal-surface.test.mjs`
- `tests/final-response-hook.sh`
- `tests/help-contract.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos help gate --json
./aos dev gh issue view --json 360
```

If `./aos ready` is blocked by macOS TCC or input tap state, report the exact
blocker and continue deterministic contract/tests only. Do not route live UI
verification as complete unless readiness is green.

Use isolated state for any command that writes continuation, record, or resume
payloads:

```bash
AOS_STATE_ROOT="$(mktemp -d -t aos-deferred-gate)" AOS_RUNTIME_MODE=repo ...
```

Tests must not mutate canonical `~/.config/aos/repo` state.

## Existing Code To Inspect

- `packages/daemon/gate/records.js` - current runtime-mode-scoped JSONL gate
  record path and redaction behavior.
- `packages/daemon/gate/index.js` - blocking gate service lifecycle,
  normalization, settlement, and record writes.
- `packages/cli/verbs/gate-ask.js` - current command-facing blocking ask
  parser. Reuse parsing where sensible; avoid duplicating incompatible request
  shapes.
- `packages/cli/verbs/gate-records.js` - readback command shape to mirror for
  continuations.
- `src/commands/gate.swift` - Swift router for gate subcommands and runtime
  mode forwarding.
- `src/shared/command-registry-data.swift` - discoverable help and command
  contract.
- `packages/toolkit/components/decision-gate/` - current form UI. Inspect for a
  safe submit bridge before adding UI wiring.
- `packages/gateway/tools/user-signal-surface.js` - gateway adapter. It should
  remain thin; do not make it own continuation state.
- `src/commands/tell.swift` and `src/commands/listen.swift` - existing session
  communication surfaces and session id conventions.
- `.agents/hooks/final-response.sh` and `tests/final-response-hook.sh` - useful
  context for Codex harness/session metadata, not a continuation mechanism to
  copy wholesale.

## Required Behavior

### 1. Deferred Continuation Create

Add a minimal CLI surface under `./aos gate` for creating a deferred
continuation. Suggested shape if it fits the parser:

```bash
./aos gate defer --request gate-request.json --session-id <id> --harness codex --json
./aos gate defer --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"approve_deny"}}' --session-id <id> --harness codex
```

If another name fits better, keep it under `./aos gate` and document it. It
must return immediately with JSON containing at least:

- `schema_version` for the create response;
- `continuation_id`;
- `gate_id`;
- lifecycle state, initially `pending`;
- storage path or record locator;
- session/resume metadata that was captured;
- clear human/adapter next action.

Creation must not block waiting for a human answer. It may create a surface only
if there is a safe existing bridge for later submit after the process exits. If
that bridge does not exist, implement the durable create/submit/readback path
first and document UI submit wiring as the next slice.

### 2. Continuation Record Shape

Add a public schema if the record crosses tools. Suggested name:

```text
shared/schemas/aos.gate.continuation.v1.json
```

The record should include at least:

- `schema_version`, such as `aos.gate.continuation.v1`;
- `continuation_id`;
- `gate_id`;
- request schema version and prompt title;
- source metadata from the gate request, redacted to safe public fields;
- session metadata:
  - `session_id`;
  - `harness` / provider, such as `codex`;
  - dock/role when available;
  - cwd;
  - branch and `head_sha` when available;
  - dirty summary when cheaply available;
- lifecycle state:
  - `pending`;
  - `submitted`;
  - `cancelled`;
  - `expired`;
  - optional `resume_queued`, `resume_started`, or `resume_failed` only if V0
    implements those states cleanly;
- `created_at`;
- optional `expires_at` or `abandoned_after_ms`;
- `submitted_at` when submitted;
- `submitted_by`, defaulting to human/local user when known;
- `response_stored` and `response` only under the same explicit opt-in policy
  as gate records;
- `resume` metadata:
  - mode, such as `new_agent_turn`;
  - policy, such as `manual`, `queue`, or `auto`;
  - adapter hint, such as `codex_exec`;
  - entrypoint metadata, such as `codex_exec_adapter`, identifying a future
    resume adapter rather than an executable path;
  - `auto_resume`, defaulting to false and treated as false by V0 regardless of
    value;
  - generated human-authored message/event id or path after submit.

Do not persist prompt bodies or free-text answer payloads by default.

### 3. Runtime-Mode Scoped Storage

Continuation state must live under the active AOS state root and honor both
`AOS_STATE_ROOT` and runtime mode isolation. Choose a simple V0 store that makes
idempotent submit reliable. JSON files per continuation are acceptable if they
make atomic updates easier than JSONL.

Suggested paths:

```text
~/.config/aos/{repo|installed}/gate/continuations/<continuation_id>.json
~/.config/aos/{repo|installed}/gate/resume-events/<event_id>.json
```

Avoid gateway-owned databases. Gateway is an adapter, not the authority.

### 4. Submit Surface

Add a local submit command/API under `./aos gate` that can be called by a future
UI submit bridge:

```bash
./aos gate submit --continuation-id <id> --request submission.json --json
```

or an equivalent shape. It must:

- load the pending continuation;
- validate that it is still submittable;
- produce one terminal durable gate/submission record;
- mark the continuation submitted exactly once;
- create one human-authored resume message/event;
- return the resume event metadata as JSON.

Duplicate submissions must be idempotent. A second submit for the same
continuation must not enqueue a second resume message/event.

### 5. Resume Message/Event

V0 should create a provider-neutral resume event even if it does not
automatically launch the provider. The event should be explicit that the message
is human-authored. It should carry:

- original `session_id`;
- harness/provider hint;
- continuation id;
- gate id;
- submitted resolution/status;
- redacted answer summary;
- full response only if explicitly opted in;
- suggested provider adapter command or adapter hint.

Codex exec should be represented as an adapter boundary. Do not make AOS core
depend on Codex internals. If an explicit Codex adapter command is added, it
must be opt-in, reviewable, and tested with a dry-run or fake executable first.

### 6. UI Bridge Boundary

The desired product is a signal UI whose submit button can complete the
continuation after the agent process exits. Implement this only if an existing
AOS canvas/toolkit bridge can safely call back into AOS without unsafe shell
execution from WebView content.

If no safe bridge exists, do not fake it with brittle polling after the creator
process exits. Land the durable continuation and submit commands first, then
report the missing daemon/toolkit primitive needed for UI-driven submit. The
follow-on should be a receptor/input-bridge slice, not hidden behavior in the
gateway adapter.

### 7. Records And Readback

Expose readback for continuations under `./aos gate`, mirroring
`./aos gate records --json`. Suggested shape:

```bash
./aos gate continuations --json
./aos gate continuations --status pending --json
./aos gate continuations --id <continuation_id> --json
```

Update command help, `docs/api/aos.md`, and `docs/design/user-signal-surface.md`
with the final command names and record semantics.

## Scope

Likely ownership:

- Node gate modules under `packages/daemon/gate/`;
- CLI verbs under `packages/cli/verbs/`;
- Swift gate subcommand routing in `src/commands/gate.swift`;
- command registry/help docs;
- public schema/docs under `shared/schemas/` if the continuation/resume event
  shape is cross-tool;
- deterministic tests.

Optional only if a safe existing bridge is found:

- narrow `DecisionGate` or `LocalCanvasReceptor` extension for deferred submit.

## Hard Boundaries / Non-Goals

- Do not replace blocking `./aos gate ask`.
- Do not require a long-running Node or agent process to wait for deferred UI
  submission.
- Do not put continuation state in `packages/gateway/src/db.ts`.
- Do not auto-run `codex exec` by default.
- Do not store prompt bodies or free-text answers by default.
- Do not build the full overlay/callout/full-screen input capture system in
  this slice.
- Do not expose an unauthenticated remote-control surface.
- Do not add a broad scheduler or workflow engine.
- Do not modify unrelated workbench, Employer Brand, or report/export flows.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- Add `packages/daemon/gate/continuations.js` with path resolution, create,
  read/list, submit, cancel/expire helpers, and atomic/idempotent writes.
- Add CLI verbs such as:
  - `packages/cli/verbs/gate-defer.js`;
  - `packages/cli/verbs/gate-submit.js`;
  - `packages/cli/verbs/gate-continuations.js`.
- Reuse request normalization from `packages/daemon/gate/index.js`.
- Reuse/redaction policy from `packages/daemon/gate/records.js`.
- Add `shared/schemas/aos.gate.continuation.v1.json` and optionally
  `shared/schemas/aos.gate.resume-event.v1.json` if the resume event is public.
- Extend `src/commands/gate.swift` using the existing `runGateVerb()` runtime
  environment forwarding.
- Extend `src/shared/command-registry-data.swift`.
- Add focused tests under `tests/daemon/` and/or `tests/gate-*.sh`.

## Verification

Run deterministic checks first:

```bash
./aos dev recommend --json
./aos dev build
node --test tests/daemon/gate-records.test.mjs tests/daemon/gate-service.test.mjs tests/daemon/gate-receptor.test.mjs
node --test tests/gateway/user-signal-surface.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add focused continuation tests. They should use a temporary `AOS_STATE_ROOT` and
prove at least:

1. create returns immediately and writes one pending continuation;
2. records are runtime-mode scoped and preserve installed/repo isolation;
3. readback filters by id/status;
4. submit marks pending continuation submitted;
5. duplicate submit is idempotent and does not create duplicate resume events;
6. cancel/expire terminal states cannot be submitted;
7. response payloads are redacted by default;
8. explicit payload opt-in, if implemented, is tested;
9. resume event includes session id, harness/provider, continuation id, gate id,
   and human-authored message metadata;
10. canonical `~/.config/aos/repo` state is not mutated by tests.

If UI-driven submit is implemented and `./aos ready` passes, add one bounded
live smoke that proves a deferred signal surface can submit after the create
command exits. If readiness is blocked or no safe UI bridge exists, report that
as the follow-on instead of claiming live completion.

## Completion Report

Report:

- files changed;
- final command names and JSON shapes;
- final storage paths and formats;
- whether UI-driven submit was implemented or deferred because a lower-level
  bridge primitive is missing;
- whether Codex exec is only represented as an adapter hint/event or has an
  explicit dry-run adapter;
- exact verification commands and results;
- live AOS readiness or the exact blocker;
- confirmation that canonical `~/.config/aos/repo` state was not mutated by
  tests;
- branch name and final commit SHA;
- recommended next slice after V0.
