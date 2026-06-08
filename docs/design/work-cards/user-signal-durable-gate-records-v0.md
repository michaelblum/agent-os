# User Signal Durable Gate Records V0

## Tracker

- GitHub issue: https://github.com/michaelblum/agent-os/issues/359
- Design note: `docs/design/user-signal-surface.md`
- Adjacent epics:
  - #141 Human Intent Sensing and Steerable Collection Sessions
  - #149 Supervised runs and HITL test console
- Recent landed context:
  - `befe11a fix(gate): reconcile user signal v1 contract`
  - `623f725 feat(gateway): add user_signal_surface MCP tool`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, prior implementation state, or local gate state. Read and
rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

## Goal

Make Human Input Gate decisions durable enough to audit and reuse as user-signal
evidence.

V0 should persist each `aos.gate.request.v1` lifecycle outcome to a local
runtime-mode-scoped record store, then expose a minimal JSON readback surface.
This is deliberately smaller than promoting the gate lifecycle into the
long-running daemon. `./aos gate ask` remains the caller-facing decision
surface for this slice.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/user-signal-surface.md`
- `docs/api/aos.md`
- `shared/schemas/CONTRACT-GOVERNANCE.md`
- `shared/schemas/aos.gate.request.v1.json`
- `src/commands/gate.swift`
- `src/shared/command-registry-data.swift`
- `packages/cli/verbs/gate-ask.js`
- `packages/daemon/gate/index.js`
- `packages/daemon/gate/GateReceptor.js`
- `packages/daemon/gate/LocalCanvasReceptor.js`
- `shared/gate/errors.mjs`
- `shared/gate/presets.mjs`
- `tests/daemon/gate-service.test.mjs`
- `tests/daemon/gate-receptor.test.mjs`
- `tests/gateway/user-signal-surface.test.mjs`
- `tests/help-contract.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos help gate --json
gh issue view 359 --json number,title,state,url,body,labels
```

Use an isolated `AOS_STATE_ROOT` for any command that writes gate records during
tests. Do not write test records into the canonical repo runtime state under
`~/.config/aos/repo/`.

## Existing Code To Inspect

- `packages/daemon/gate/index.js` - owns request normalization, pending gate
  lifecycle, timeout/dismiss/answer/error settlement, and logging hooks.
- `packages/cli/verbs/gate-ask.js` - command-facing Node verb that invokes the
  gate service and prints the resolved JSON.
- `src/commands/gate.swift` - Swift command router that shells to the Node gate
  verb.
- `src/shared/command-registry-data.swift` - discoverable help and command
  contract for `aos gate`.
- `shared/schemas/aos.gate.request.v1.json` - request contract. Add a separate
  record schema if the persisted record shape becomes a cross-tool contract.
- `packages/gateway/tools/user-signal-surface.js` - gateway adapter; useful for
  source metadata, but it must not own durable gate state.
- `packages/gateway/src/db.ts` and `packages/host/src/session-store.ts` -
  SQLite style references only. Do not put gate records in the gateway store.

## Required Behavior

### 1. Record Every Terminal Outcome

Each gate request must produce exactly one durable record for terminal outcomes:

- answered;
- dismissed;
- timeout;
- receptor or infrastructure error.

Records should be written for `./aos gate ask` calls regardless of whether the
caller is shell, a docked session, or `user_signal_surface`.

### 2. Runtime-Mode Scoped Storage

Gate records must be scoped under the active AOS runtime state root, respecting
`AOS_STATE_ROOT` for tests and repo/installed mode isolation for normal use.

Suggested V0 path if no existing AOS-owned JS SQLite store is available:

```text
~/.config/aos/{repo|installed}/gate/records.jsonl
```

The design note mentions a future `gate_decisions` SQLite table. If Implementer finds a
clean AOS-owned SQLite store for gate records, use it. If the only available
SQLite store is gateway-owned, prefer JSONL for V0 and document the reason in
the completion report: gateway is an adapter, not the gate authority.

### 3. Record Shape

Persist enough metadata to audit the decision without making response payloads
the default source of truth. A V0 record should include at least:

- `schema_version`, such as `aos.gate.record.v1`;
- `gate_id`;
- `request_schema_version`;
- `prompt_title`;
- `source` metadata from the request, including surface/session/agent when
  available;
- `receptor`;
- `ui_variant`;
- `field_kinds`;
- `timeout_ms`;
- `created_at`, `presented_at` when known, `resolved_at`, and `elapsed_ms`;
- `resolution`: `answered`, `dismissed`, `timeout`, or `error`;
- `status` for no-answer envelopes when applicable;
- `error_code` and `error_message` for operational failures;
- `response_stored`: boolean;
- `response` only when a deliberate opt-in is present.

### 4. Redaction / Payload Policy

Do not store full answer payloads by default. V0 may support one explicit opt-in
flag in the request metadata or CLI surface, but the safe default is metadata
only. No-answer envelopes can be represented by resolution/status metadata.

If an opt-in is added, make it obvious in docs and tests. Do not log prompt
body or free-text answers by accident.

### 5. Readback Surface

Expose a minimal command under `./aos gate` for JSON readback. Suggested shape:

```bash
./aos gate records --json
./aos gate records --limit 20 --json
./aos gate records --id <gate_id> --json
./aos gate records --status answered --json
```

If another shape fits the existing parser better, keep it under `./aos gate`
and update the help registry and docs. The readback command must not require a
live canvas or human interaction.

### 6. Contract And Docs

Update interface docs when the readback surface lands:

- `docs/design/user-signal-surface.md` should move durable records from Future
  Work into V0/Vnext implemented status, with the actual storage/readback
  contract.
- `docs/api/aos.md` should document `aos gate ask` if still absent and include
  the records readback command.
- `src/shared/command-registry-data.swift` should expose the new command shape.
- Add `shared/schemas/aos.gate.record.v1.json` and a short Markdown companion
  only if the record is a cross-tool contract rather than an internal file
  format.

## Scope

Likely ownership:

- Node gate service and CLI verb under `packages/daemon/gate/` and
  `packages/cli/verbs/`;
- Swift `src/commands/gate.swift` routing if a second Node verb or new gate
  subcommand is added;
- command registry/help docs;
- schema/docs if the record shape is public;
- deterministic tests.

This slice should not require toolkit UI changes or live canvas work.

## Hard Boundaries / Non-Goals

- Do not promote the gate lifecycle into the long-running daemon in this slice.
- Do not move durable state into `packages/gateway/src/db.ts`; gateway is a
  provider/MCP adapter, not the gate authority.
- Do not store free-text answers or prompt bodies by default.
- Do not alter `user_signal_surface` beyond metadata passthrough or test
  updates needed to preserve the thin adapter contract.
- Do not broaden into supervised-run artifact libraries, work records, or
  annotation mode.
- Do not require live visual/HITL verification for V0. Use deterministic mocked
  receptors and isolated state.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- Add a small gate record store module near `packages/daemon/gate/`, for example
  `packages/daemon/gate/records.js`, with append/list/show helpers.
- Add a small shared runtime path helper for Node gate code that mirrors
  `AOS_STATE_ROOT` and runtime-mode isolation. If `src/commands/gate.swift`
  needs to pass `AOS_RUNTIME_MODE` to the Node child, keep that change narrow.
- Thread a `recordStore` or `recordSink` option through `createGateService()` so
  tests can use a temp store and mocked receptors.
- Emit record updates from the same settlement path that currently resolves,
  rejects, dismisses, and clears pending gates.
- Add a Node verb such as `packages/cli/verbs/gate-records.js` if that keeps
  readback separate from `gate-ask.js`.
- Keep write failures visible but do not let a record-write failure silently
  authorize a guarded action. Prefer a machine-coded operational error unless
  Implementer finds a strong reason to degrade readback only.

## Verification

Run deterministic checks first:

```bash
./aos dev recommend --json
./aos dev build
node --test tests/daemon/gate-service.test.mjs tests/daemon/gate-receptor.test.mjs
node --test tests/gateway/user-signal-surface.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add a focused gate-record test. It should use a temporary `AOS_STATE_ROOT` and
mocked receptor where possible, and prove at least:

1. answered gates create one record;
2. dismissed gates create one record with no-answer status;
3. timeouts create one record with no-answer status;
4. receptor errors create one error record;
5. response payload is redacted by default;
6. explicit payload opt-in, if implemented, is tested;
7. `./aos gate records --json` reads from the isolated state root and does not
   need a live canvas;
8. canonical `~/.config/aos/repo` state is not mutated by tests.

If Swift command routing or command registry changes, `./aos dev build` and
`bash tests/help-contract.sh` are required. If Implementer keeps the change purely in
Node without discoverable command changes, explain why any Swift build was
skipped.

## Completion Report

Report:

- files changed;
- final record storage path and format;
- final readback command shape;
- persisted fields and redaction policy;
- how answered, dismissed, timeout, and error outcomes are recorded;
- exact tests run and pass/fail results;
- `./aos ready` result;
- whether any local gate records or other runtime state were created outside
  isolated test roots;
- remaining follow-up recommendation, especially daemon-owned gate lifecycle,
  durable audit UI, or supervised-run integration.
