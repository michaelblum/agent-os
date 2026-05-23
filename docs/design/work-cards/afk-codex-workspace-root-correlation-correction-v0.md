# AFK Codex Workspace Root Correlation Correction V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commits:
  - `64d52394449fb68eefd03718390b9112a029109a`
  - `9295f48cdbc86247bc8d85e80b3c7a97fe381de4`
- Foreman review: accepted. The adapter now accepts an explicit
  `workspaceRoot`, correlates Codex metadata cwd against either the intended
  launch cwd or the exact workspace root, and records `cwd_match_basis` in the
  correlation result. The prototype passes packet worktree as `workspaceRoot`
  and records `codex_adapter.matched_cwd_basis`.
- Correction finding resolved: provider-session-id correlation now returns
  `wrong_cwd` whenever any explicit cwd basis exists and the resolved Codex
  thread matches none of them, including the `workspaceRoot`-only case.
- Changed files:
  - `packages/host/src/codex-thread-adapter.ts`
  - `packages/host/test/codex-thread-adapter.test.ts`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Foreman verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`: 21/21
  - `node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts`: 16/16
  - `node --test --experimental-strip-types packages/host/test/session-catalog.test.ts`: 4/4
  - `npm --prefix packages/host run check`
  - `npm --prefix packages/host test`: 63/63
  - `git diff --check`
  - `./aos dev recommend --json`
- Foreman regression repro after correction returned
  `status=wrong_cwd`, `cwd_match_basis=not_observed`, and a `wrong_cwd`
  mismatch for observed provider id plus `workspaceRoot` only with a resolved
  thread outside that workspace.
- Foreman temp-fixture smoke passed for the primary live shape: no observed
  provider id, dock launch cwd `.docks/gdi`, workspace-root Codex metadata,
  `codex_adapter.correlation_status=matched_by_cwd_time_window`,
  `matched_cwd_basis=workspace_root`, and both `codex://threads/<id>` plus
  `codex-thread:<id>` refs emitted.
- Local-only boundary confirmed: no real Codex sessions/transcripts, provider
  config, gateway state, dock profile, hook, GitHub state, push, or PR changed.
- Next routed slice:
  `docs/design/work-cards/operator-afk-codex-workspace-root-live-correlation-v0.md`.

## Foreman Review

- Reviewed output commit:
  `64d52394449fb68eefd03718390b9112a029109a`
- Branch:
  `gdi/afk-codex-workspace-root-correlation-correction-v0`
- Base:
  `287a76214b5d092868f1912fbcb22c1d2bff4f2e`
- Local verification passed:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`: 21/21
  - `node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts`: 15/15
  - `node --test --experimental-strip-types packages/host/test/session-catalog.test.ts`: 4/4
  - `npm --prefix packages/host run check`
  - `npm --prefix packages/host test`: 62/62
  - `git diff --check`
  - `./aos dev recommend --json`
- Foreman temp-fixture smoke passed for the primary live shape: no observed
  provider id, dock launch cwd `.docks/gdi`, workspace-root Codex metadata,
  `codex_adapter.correlation_status=matched_by_cwd_time_window`,
  `matched_cwd_basis=workspace_root`, and both
  `codex://threads/<id>` plus `codex-thread:<id>` refs emitted.

### Correction Finding

`correlateLaunch` can still falsely accept a provider-session-id match when
`workspaceRoot` is the only cwd basis and the resolved Codex thread is outside
that workspace root.

Observed from a Foreman read-only temp fixture:

```json
{
  "status": "matched_by_provider_session_id",
  "cwd_match_basis": "not_observed",
  "mismatches": []
}
```

The triggering code is in `packages/host/src/codex-thread-adapter.ts`: after
`matchCwdBasis(...)` returns `not_observed`, the wrong-cwd branch is gated by
`intendedCwd` instead of by the presence of any explicit cwd basis. This violates
the required behavior that a provider-id-resolved thread outside both the
intended launch cwd and explicit workspace/project root remains `wrong_cwd`.

Required correction:

- Treat `workspaceRoot` as an explicit cwd basis for provider-id wrong-cwd
  protection even when `intendedCwd` is absent.
- Add a focused adapter test where `providerSessionId` is observed,
  `workspaceRoot` is supplied, `intendedCwd` is absent, and the resolved thread
  cwd is outside the workspace root. Expected result: `wrong_cwd`,
  `cwd_match_basis=not_observed`, and a `wrong_cwd` mismatch.
- Preserve the accepted primary behavior and the existing deterministic test
  results.

Continue from the current correction branch/work surface. Do not restart from
the durable accepted base for this follow-up.

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
