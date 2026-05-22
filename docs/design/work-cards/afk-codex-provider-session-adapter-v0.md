# AFK Codex Provider Session Adapter V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI implementation round
- Source artifact:
  `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `gdi/afk-codex-provider-session-adapter-v0` from the required start ref. Keep
  the checkpoint local; do not push, open a PR, mutate GitHub, or run live
  provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, local transcripts, skill internals, or prior
implementation state. Read and rediscover before editing.

## Goal

Implement a small read-only Codex metadata adapter under `packages/host` with
fixture-only tests. The adapter should support AFK launch correlation by
listing, resolving, inspecting, correlating, and emitting references for Codex
threads/sessions without reading real user `~/.codex` state in tests and
without vendoring personal skill scripts.

This slice implements the adapter contract only. Do not integrate it into
`scripts/afk-launch-attempt-prototype.mjs` or a public `./aos` command unless
the implementation cannot be tested otherwise.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-inventory-v0.md`
- `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `packages/host/src/session-catalog.ts`
- `packages/host/test/session-catalog.test.ts`
- `packages/host/package.json`
- `/Users/Michael/.codex/skills/codex-thread-workbench/SKILL.md`
- `/Users/Michael/.codex/skills/codex-thread-workbench/scripts/thread_workbench.py`
- `/Users/Michael/.codex/skills/codex-thread-insights/scripts/thread_insights.py`

Use the Codex skill files as reference only. Do not import, copy, vendor, or
depend on them from the repo implementation.

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is provider-free implementation work. If live AOS readiness somehow
becomes necessary, stop and explain why before running live checks.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `5db132fcbb39767e650098d829bb89781f2d5056`
- expected output branch:
  `gdi/afk-codex-provider-session-adapter-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `packages/host/src/session-catalog.ts` - current read-only provider catalog
  parsing, configurable roots, soft per-record failure, recency sorting, and
  fixture-test style.
- `packages/host/test/session-catalog.test.ts` - temporary filesystem fixture
  patterns for Codex and Claude metadata.
- `packages/host/src/session-telemetry.ts` and
  `packages/host/test/session-telemetry.test.ts` - adjacent provider metadata
  parsing and diagnostics style.
- `packages/host/package.json` and `packages/host/tsconfig.json` - test and
  typecheck commands.
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
  - method contract and fixture expectations.

## Required Behavior

Implement the smallest read-only module that satisfies the accepted contract.
Suggested path:

`packages/host/src/codex-thread-adapter.ts`

The module should expose behavior equivalent to:

- `listCandidateThreads(input)`;
- `getThreadInfo(input)`;
- `resolveProviderSessionId(input)`;
- `correlateLaunch(input)`;
- `emitThreadReference(input)`.

Use TypeScript exports and plain data objects. Exact names can differ if the
local code style suggests better names, but the five capabilities must be
present and testable.

Core requirements:

- Accept an explicit `codexHome` root. Tests must use fixture roots.
- Defaulting to `~/.codex` is acceptable for local diagnostics, but no test may
  read real user Codex state.
- Read only metadata needed for launch correlation:
  - `.codex-global-state.json` when present;
  - early JSONL `session_meta` records in `sessions/` and optionally
    `archived_sessions/`;
  - rollout filenames as fallback ids when needed.
- Avoid user/assistant message bodies for normal launch correlation. If a title
  fallback is implemented, keep it optional and avoid making body reads required
  for adapter success.
- Emit stable refs:
  - `codex://threads/<thread_id>`;
  - local evidence refs such as `codex-thread:<thread_id>`;
  - file/evidence refs for fixture metadata consulted.
- Support exact id and unique prefix resolution.
- Return `ambiguous` for ambiguous prefixes rather than guessing.
- Normalize cwd/project matching enough to match absolute project paths and
  nested project paths consistently with `session-catalog.ts` expectations.
- Preserve archived inclusion policy as an explicit option, defaulting to true
  unless a narrower choice is justified in code/tests.

Correlation requirements:

- If `providerSessionId` is observed, resolve it and return
  `matched_by_provider_session_id` only when the resolved thread cwd matches the
  intended cwd/project path.
- If the resolved thread cwd differs, return `wrong_cwd` with expected and
  observed cwd mismatch evidence.
- If provider session id is `not_observed` but cwd and launch time window exist,
  list cwd/time candidates and return:
  - `matched_by_cwd_time_window` for exactly one candidate;
  - `multiple_candidates` for more than one;
  - `not_observed` when none match.
- Preserve `provider_session_id_not_observed` as a mismatch/fact when terminal
  substrate exists but no provider id exists.
- Do not bind unrelated all-cwd candidates to a launch.

## Fixture Requirements

Use temporary or committed synthetic fixtures only. Do not read, write, delete,
or depend on real provider transcripts under the user's home directory.

Focused tests should cover at least:

- exact provider session id resolves to a Codex thread;
- unique prefix resolves;
- ambiguous prefix returns `ambiguous`;
- project/cwd thread listing returns normalized matching records sorted
  deterministically;
- time-window candidate filtering;
- `correlateLaunch` exact id plus matching cwd;
- `correlateLaunch` wrong cwd;
- `correlateLaunch` provider id not observed but terminal substrate exists;
- `correlateLaunch` multiple cwd/time candidates;
- `emitThreadReference` returns `codex://threads/<id>` and a stable local ref;
- missing or malformed metadata is a soft failure with diagnostics;
- tests prove they use an explicit fixture `codexHome`, not real `~/.codex`.

## Hard Boundaries

- Do not copy, vendor, or import personal skill scripts from `~/.codex`.
- Do not run broad real-thread searches, open real threads, perform hygiene, or
  delete/move Codex local files.
- Do not read real Codex sessions/transcripts in tests.
- Do not launch Codex, Claude, Gemini, Sigil, gateway, or AOS daemon.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not implement scheduler, gateway routes, broker integration, result-route
  delivery, committed generated receipts, or schemas.
- Do not integrate the adapter into AFK launch-attempt records in this slice;
  report that as the next follow-up if the adapter is accepted.
- Do not generalize to Claude Code beyond keeping provider-neutral result names
  compatible with a later adapter.

## Verification

Required:

```bash
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
node --test --experimental-strip-types packages/host/test/session-catalog.test.ts
npm --prefix packages/host run check
git diff --check
./aos dev recommend --json
```

If `./aos dev recommend --json` recommends additional focused host tests for
changed files, run them or explain why the adapter and session-catalog tests
cover the delta.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- adapter module path and exported capabilities;
- fixture shape and proof that tests did not read real `~/.codex`;
- exact statuses implemented for resolve/list/correlate/deeplink;
- exact verification commands and results;
- confirmation that no real Codex sessions/transcripts, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changed;
- recommended next follow-up, especially whether to integrate the adapter into
  `scripts/afk-launch-attempt-prototype.mjs` or add a diagnostic `./aos dev`
  wrapper.
