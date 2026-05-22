# AFK Codex Workspace Root Correlation Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the Codex adapter/prototype correlation handle the
  observed live shape where Codex `session_meta.cwd` records the repo/workspace
  root while the terminal launch cwd is a dock root.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-codex-adapter-live-correlation-v0.md`
  - `docs/design/work-cards/afk-launch-attempt-codex-adapter-integration-v0.md`
  - `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-codex-workspace-root-correlation-correction-v0`. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or run live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, local transcripts, bridge state, or prior
implementation state. Read and rediscover before editing.

## Goal

Correct the deterministic Codex launch correlation path so a supervised launch
from `.docks/gdi` can match Codex metadata that reports the repo/workspace root
as `session_meta.cwd`, without allowing stale cwd-only binding.

## Triggering Evidence

Operator's supervised run on `2026-05-22` was a `partial_pass`:

- bridge launched Codex from
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- no provider session id was independently visible in the bridge snapshot;
- prototype `codex_adapter.correlation_status` was `not_observed`;
- `codex_adapter.candidate_thread_ids` was `[]`;
- catalog current-launch proof was also `not_observed`;
- cleanup succeeded and the worktree remained clean.

Foreman then ran a read-only adapter count against explicit
`/Users/Michael/.codex` for the same launch window. It found:

- zero post-launch candidates for
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- one post-launch candidate for `/Users/Michael/Code/agent-os`, timestamp
  `2026-05-22T17:20:48.588Z`.

Treat this as diagnostic evidence only. Do not depend on Michael's real Codex
home in tests.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/operator-afk-codex-adapter-live-correlation-v0.md`
- `docs/design/work-cards/afk-launch-attempt-codex-adapter-integration-v0.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is deterministic implementation work. Do not launch Codex, Sigil,
gateway, or the AOS daemon for this slice. If live AOS readiness somehow
becomes necessary, stop and explain why before running live checks.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `dc0de0d8456e1360ed2e516f25df4bac4c87a4fe`
- expected output branch:
  `gdi/afk-codex-workspace-root-correlation-correction-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `packages/host/src/codex-thread-adapter.ts` - owns cwd/time filtering,
  provider session id resolution, mismatch classification, and returned
  candidate thread refs.
- `packages/host/test/codex-thread-adapter.test.ts` - current deterministic
  adapter fixture coverage.
- `scripts/afk-launch-attempt-prototype.mjs` - currently calls
  `correlateLaunch` with `intendedCwd: context.intendedLaunchCwd` and already
  has `context.worktree`.
- `tests/afk-launch-attempt-prototype.test.mjs` - current prototype fixture
  coverage for `matched_by_provider_session_id`, `wrong_cwd`,
  `matched_by_cwd_time_window`, and no-window `not_observed`.

## Required Behavior

- Preserve `launch_intent.intended_launch_cwd` as the dock launch root. Do not
  rewrite launch intent to the repo root.
- Allow Codex adapter correlation to consider an explicit workspace/project
  root from the transfer packet worktree when Codex metadata reports that root
  instead of the dock launch cwd.
- Keep the no-provider-id safety rule: when provider session id is not observed,
  do not bind by cwd alone. A usable launch time boundary is still required.
- Keep wrong-cwd protection meaningful. A thread outside both the intended
  launch cwd and the explicit workspace/project root must remain `wrong_cwd` or
  `not_observed`, depending on whether a provider id was observed.
- Make the accepted live partial shape deterministic in fixtures: no observed
  provider session id, intended launch cwd `.docks/gdi`, worktree/repo root
  `/Users/Michael/Code/agent-os`, and Codex `session_meta.cwd` equal to the
  worktree root within the launch window should produce a matched adapter
  result with a clear status/evidence shape.
- Add or update record fields only where useful for review. If a new field is
  added, prefer a stable `codex_adapter` field that explains which cwd basis
  matched, such as intended launch cwd vs workspace root.
- Preserve existing fixture-backed behavior and statuses unless the tests are
  intentionally refined for this correction.

## Scope

This slice is limited to the repo-owned Codex adapter, the experimental
launch-attempt prototype, and deterministic tests around those paths.

## Hard Boundaries

- Do not read real `~/.codex` in tests.
- Do not launch Codex, Claude, Gemini, Sigil, gateway, or the AOS daemon.
- Do not mutate provider configs, gateway state, dock profiles, `.docks` role
  instructions, hooks, provider transcript files, GitHub state, push, or PRs.
- Do not add a public `./aos` command, scheduler, gateway route, result-route
  delivery, schema, committed generated receipt, or real provider launch in
  this slice.
- Do not relax correlation to match arbitrary parent directories without an
  explicit packet/worktree/project-root basis.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
node --test --experimental-strip-types packages/host/test/session-catalog.test.ts
npm --prefix packages/host run check
npm --prefix packages/host test
git diff --check
./aos dev recommend --json
```

Run one manual prototype smoke with a temp packet and temp Codex home fixture
covering the workspace-root match. Remove temp artifacts afterward. Do not use
real `/Users/Michael/.codex` for the smoke.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- the exact correlation rule added for workspace/project-root cwd matching;
- any new or refined `codex_adapter` fields/statuses;
- fixture proof that tests use temporary Codex metadata and do not read real
  `~/.codex`;
- exact verification commands and results;
- manual smoke key facts: lifecycle state, adapter correlation status, matched
  thread id/ref, cwd basis, observed refs, catalog status, telemetry status,
  and mismatches;
- confirmation that no real Codex sessions/transcripts, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changed;
- recommended next follow-up before another supervised live Operator run.
