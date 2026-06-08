# Work Card: AFK Bridge Catalog Scope Correction V0

**Status:** Accepted 2026-05-22

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Source receipt:
  `docs/design/notes/manual-afk-receipts/2026-05-22-live-bridge-cwd-mismatch-classifier-implementer-partial.md`
- Source accepted card:
  `docs/design/work-cards/afk-provider-session-cwd-mismatch-classification-v0.md`
- Correction finding: the live bridge smoke showed that
  `/sessions?provider=codex` is not an all-cwd query today. The bridge applies
  `defaultCwd` when `cwd` is omitted, so the response was the same
  Implementer-scoped catalog view as `/sessions?cwd=the implementer native subagent&provider=codex`. This
  forced Operator to guess an observed cwd and query `the operator native subagent`
  separately.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, receipt, or prior
implementation state. Read and rediscover before editing.

## Goal

Add an explicit read-only all-cwd provider catalog query mode to the Sigil
codex-terminal bridge, without changing the existing default cwd-scoped rail
behavior.

The next live AFK proof needs to distinguish:

- requested-cwd catalog current launch absent;
- current provider session exists under another cwd;
- no current provider session exists anywhere visible to the provider catalog.

It should not require ad hoc guesses such as querying `the operator native subagent`.

## Read First

- the implementer native subagent instructions
- `docs/design/notes/manual-afk-receipts/2026-05-22-live-bridge-cwd-mismatch-classifier-implementer-partial.md`
- `docs/design/work-cards/afk-provider-session-cwd-mismatch-classification-v0.md`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `packages/host/src/session-catalog.ts`
- `packages/host/test/session-catalog.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

If live AOS readiness becomes necessary, run:

```bash
./aos ready
```

If repo-mode Accessibility, Input Monitoring, or input-tap readiness blocks a
live check, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `134418ee`
- expected output branch:
  `implementer/afk-bridge-catalog-scope-correction-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `apps/sigil/codex-terminal/server.mjs` - `sessionCatalogForUrl` currently
  calls `listProviderSessions` with `cwd: url.searchParams.get('cwd') ||
  defaultCwd`, which makes omitted `cwd` default to bridge cwd.
- `tests/sigil-agent-terminal-server.test.mjs` - existing process-driver bridge
  fixture tests for `/sessions` and `/session-inspector`.
- `packages/host/src/session-catalog.ts` - `listProviderSessions` already
  supports all-cwd discovery when `cwd` is omitted.
- `packages/host/test/session-catalog.test.ts` - host catalog behavior tests;
  inspect if bridge changes suggest host coverage, but avoid host changes unless
  needed.

## Required Behavior

Implement the smallest read-only bridge correction that makes all-cwd discovery
explicit and testable.

Keep existing behavior:

- `/sessions` with no explicit all-cwd flag should remain scoped to the bridge
  `defaultCwd`, so existing UI rail behavior does not suddenly scan and display
  every provider session.
- `/sessions?cwd=<path>&provider=codex` should keep filtering by the requested
  cwd.
- `/session-inspector?cwd=<path>&provider=codex&session_id=<id>` should keep
  working for selected records.

Add explicit all-cwd behavior, for example one of these shapes:

- `/sessions?provider=codex&all_cwd=true`;
- `/sessions?provider=codex&scope=all`;
- `/sessions?provider=codex&cwd=*`.

Choose the smallest shape that fits the existing URL parsing style. The
response must make the scope reviewable, either through documented test names
and behavior or a small response field such as `scope`/`cwd_filter`. Avoid a
large response schema migration.

Focused test coverage should prove:

- default `/sessions?provider=codex` remains default-cwd scoped;
- explicit all-cwd query returns provider records from at least two cwd values;
- explicit cwd query still filters to that cwd;
- provider filtering still works for all-cwd mode;
- no provider transcripts or real home-directory sessions are read in tests.

If the endpoint already has a hidden all-cwd path, document it in tests and use
that instead of adding a new spelling.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not inspect, edit, delete, or depend on real provider transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, or generated committed receipts.
- Do not change `packages/host` catalog semantics unless the bridge cannot
  support explicit all-cwd scope through existing `listProviderSessions`
  options.
- Do not make all-cwd scanning the default bridge rail behavior.

## Verification

Required:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
./aos dev recommend --json
```

If you touch AFK prototype tests, also run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
```

If you touch host catalog code, run the focused host catalog tests recommended
by `./aos dev recommend --json`.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- chosen all-cwd query spelling;
- default `/sessions` behavior retained;
- exact fixture cases added or changed;
- exact verification commands and results;
- confirmation that no live provider session was launched and no real provider
  transcript/config, gateway state, dock profile, hook, GitHub state, push, or
  PR changed;
- remaining gap before the next supervised live bridge correlation proof;
- local-only state or runtime blockers.

## Foreman Acceptance - 2026-05-22

Accepted commit:
`e4b1ed89b0899ff62f860878364e67d5ed9c3956`.

Review result:

- Chosen all-cwd query spelling:
  `/sessions?provider=codex&all_cwd=true`.
- Default `/sessions?provider=codex` behavior remains scoped to the bridge
  `defaultCwd`.
- Explicit `cwd` queries still filter to the requested cwd.
- Explicit all-cwd mode returns provider records from multiple cwd values and
  still honors provider filtering.
- The `/sessions` response now includes small review fields, `scope` and
  `cwd_filter`, without changing the existing `sessions` payload shape.

Foreman verification:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check 62d17f36d8bad9ae52f6d367c8d9e11addf09466..e4b1ed89b0899ff62f860878364e67d5ed9c3956
./aos dev recommend --json
```

Results:

- `node --test tests/sigil-agent-terminal-server.test.mjs`: pass, 7/7.
- Range `git diff --check`: pass.
- `./aos dev recommend --json`: pass; recommendations are noisy because this
  branch is stacked on the broader durable workstream base, but the focused
  bridge test covers this delta.

No live provider session was launched during Foreman acceptance. No real
provider transcript/config, gateway state, dock profile, hook, GitHub state,
push, or PR was changed. The remaining gap is a supervised live bridge
correlation proof using the explicit all-cwd query spelling.
