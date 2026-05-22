# AFK Codex Provider Session Adapter Time Window Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Source artifact:
  `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- Review finding source: Foreman review of
  `9797450d4ab0980134a3eefca5cc118796168e65`
- Required start ref: `gdi/afk-codex-provider-session-adapter-v0`
- Branch/output expectation: reuse the local branch
  `gdi/afk-codex-provider-session-adapter-v0`. Keep the checkpoint local; do
  not push, open a PR, mutate GitHub, or run live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, local transcripts, skill internals, or prior
review state. Read and rediscover before editing.

## Goal

Correct `correlateLaunch` so cwd-only fallback correlation never binds a Codex
thread when no provider session id is observed and no launch time window was
provided.

The accepted adapter contract says cwd/time fallback applies only when both an
intended cwd/project path and a launch time window exist. A cwd match alone can
select an unrelated old Codex thread and must remain `not_observed`.

## Review Finding

- `packages/host/src/codex-thread-adapter.ts:305` calls
  `listCandidateThreads` whenever `intendedCwd` exists, passing
  `timeWindow: input.timeWindow` even when it is undefined.
- `packages/host/src/codex-thread-adapter.ts:334` then returns
  `matched_by_cwd_time_window` for exactly one candidate. With no time window,
  this can bind an arbitrary old same-cwd thread to a launch.
- This conflicts with
  `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md:141` and
  `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md:148`, which
  require cwd and launch time window before fallback matching and say not to bind
  unrelated all-cwd candidates.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`
- `packages/host/src/session-catalog.ts`
- `packages/host/test/session-catalog.test.ts`
- `packages/host/package.json`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short gdi/afk-codex-provider-session-adapter-v0
./aos dev recommend --json
```

This is provider-free correction work. If live AOS readiness somehow becomes
necessary, stop and explain why before running live checks.

## Branch / Base

- branch_from: `gdi/afk-codex-provider-session-adapter-v0`
- required_start_ref: `gdi/afk-codex-provider-session-adapter-v0`
- rejected implementation commit:
  `9797450d4ab0980134a3eefca5cc118796168e65`
- expected output branch:
  `gdi/afk-codex-provider-session-adapter-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Required Behavior

- Preserve all adapter exports and existing successful fixture behavior.
- If a real `providerSessionId` is observed, keep exact id correlation behavior
  unchanged: resolve the id and require cwd match before returning
  `matched_by_provider_session_id`.
- If no provider id is observed, require both:
  - an intended cwd or project path; and
  - a launch `timeWindow` with at least one usable boundary;
  before calling cwd/time fallback correlation.
- If no provider id is observed and no usable time window exists, return
  `not_observed` with `confidence: 'none'`. Do not set `thread`, and do not
  return `matched_by_cwd_time_window` or `multiple_candidates` based on cwd
  alone.
- Preserve `provider_session_id_not_observed` as a mismatch/fact when terminal
  substrate exists.
- Keep malformed or missing metadata as soft failures with diagnostics.

## Fixture Requirements

Add a focused synthetic fixture test proving a single same-cwd Codex thread does
not get bound when `providerSessionId: 'not_observed'` and no `timeWindow` is
provided.

The test must use an explicit temporary `codexHome` fixture and must not read
real `~/.codex` state.

## Hard Boundaries

- Do not copy, vendor, or import personal skill scripts from `~/.codex`.
- Do not read real Codex sessions/transcripts in tests.
- Do not launch Codex, Claude, Gemini, Sigil, gateway, or the AOS daemon.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not integrate the adapter into
  `scripts/afk-launch-attempt-prototype.mjs` or a public `./aos` command in
  this correction.

## Verification

Required:

```bash
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
node --test --experimental-strip-types packages/host/test/session-catalog.test.ts
npm --prefix packages/host run check
npm --prefix packages/host test
git diff --check
./aos dev recommend --json
```

If `./aos dev recommend --json` recommends broad checks because of unrelated
branch history, explain which recommendations are outside the correction delta.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact correction behavior implemented;
- fixture proof that same-cwd/no-time-window does not bind a thread;
- exact verification commands and results;
- confirmation that no real Codex sessions/transcripts, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changed;
- whether the next follow-up remains adapter integration into
  `scripts/afk-launch-attempt-prototype.mjs` after Foreman accepts the adapter.
