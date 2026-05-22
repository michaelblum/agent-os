# AFK Codex Provider Session Adapter Inventory V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI inventory/design round
- Source artifacts:
  - `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md`
  - `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
  - local skill seed:
    `/Users/Michael/.codex/skills/codex-thread-workbench/SKILL.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `gdi/afk-codex-provider-session-adapter-inventory-v0` from the required start
  ref. Keep the checkpoint local; do not push, open a PR, mutate GitHub, or run
  live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, skill internals, local transcript state, or
prior implementation state. Read and rediscover before editing.

## Goal

Inspect the existing Codex thread/session utility skill as a seed and define a
repo-owned Codex provider-session adapter contract for AFK launch correlation.

The target abstraction shape is Codex-first:

- list candidate Codex sessions/threads for a project path;
- inspect one session/thread;
- resolve a provider session id to local thread/session metadata;
- correlate a launch-side provider session id or project/cwd/time window to a
  Codex thread;
- emit a deeplink or stable local reference for evidence;
- leave Claude Code generalization as a later adapter.

This is an inventory/design slice, not implementation. Treat
`codex-thread-workbench` and its `codex-thread-insights` dependency as local
reference implementations. Do not promote scripts wholesale from `~/.codex`
into `agent-os` without a contract.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `packages/host/src/session-catalog.ts`
- `/Users/Michael/.codex/skills/codex-thread-workbench/SKILL.md`
- `/Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py`
- `/Users/Michael/.codex/skills/codex-thread-insights/scripts/thread_insights.py`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

For skill command discovery, use help/source inspection only unless the design
requires otherwise:

```bash
python3 /Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py --help
python3 /Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py resolve-session-id --help
python3 /Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py list-project-threads --help
python3 /Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py get-thread-info --help
python3 /Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py emit-deeplink --help
```

Do not run broad real-session searches, open deeplinks, or perform hygiene
actions in this round.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `ee786994b02aeb62e9492c742f5ff38338d49427`
- expected output branch:
  `gdi/afk-codex-provider-session-adapter-inventory-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Required Output

Create one durable design note under `docs/design/notes/`, for example:

`docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`

The note must include:

- the `codex-thread-workbench` command capabilities observed from help/source:
  `resolve-session-id`, `list-project-threads`, `get-thread-info`,
  `emit-deeplink`, `open-thread`, plus search/drill/aggregate/hygiene as
  non-contract reference capabilities;
- a proposed repo-owned Codex provider-session adapter interface with method
  names, inputs, outputs, failure states, and evidence refs;
- how the adapter would connect the accepted bridge visibility fixture fields
  to Codex local sessions/threads;
- what belongs in `packages/host`, `scripts/`, or a future `./aos dev` surface,
  and what should remain outside the repo;
- privacy/local-state boundaries for reading `~/.codex` session files;
- deterministic fixture/test strategy that does not depend on real user
  transcripts;
- explicit non-goals and later Claude Code generalization notes;
- a recommended next GDI implementation slice if the contract is clear.

## Hard Boundaries

- Do not copy, vendor, or import the Codex skill scripts into the repo.
- Do not run broad real-thread searches, open real threads, perform hygiene, or
  delete/move any Codex local files.
- Do not read real provider transcripts unless a small command-help/source
  inspection is insufficient; if unavoidable, stop and report the exact reason
  before doing it.
- Do not launch Codex, Claude, Gemini, or another provider.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not implement scheduler, gateway routes, broker integration, result-route
  delivery, committed generated receipts, or schemas.
- Do not generalize to Claude Code beyond naming a later adapter boundary.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json
./aos dev recommend --json --files docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md
```

If you only create/update docs, no runtime tests are expected unless
`./aos dev recommend` says otherwise. If you make source or test changes, run
the focused tests for those files and explain why implementation stayed in
scope.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- skill commands/source inspected;
- proposed adapter methods and output evidence refs;
- recommended next GDI slice;
- whether any real Codex sessions/transcripts were read, expected answer: no
  unless explicitly justified;
- exact verification commands and results;
- confirmation that no provider config, real provider transcript, gateway
  state, dock profile, hook, GitHub state, push, or PR changed.
