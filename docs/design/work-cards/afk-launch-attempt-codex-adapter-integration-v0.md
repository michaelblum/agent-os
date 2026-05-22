# AFK Launch Attempt Codex Adapter Integration V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI implementation round
- Source artifacts:
  - `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
  - `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `gdi/afk-launch-attempt-codex-adapter-integration-v0` from the required start
  ref. Keep the checkpoint local; do not push, open a PR, mutate GitHub, or run
  live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, local transcripts, bridge state, or prior
implementation state. Read and rediscover before editing.

## Goal

Integrate the accepted read-only Codex thread adapter into the experimental AFK
launch-attempt prototype so fixture-backed launch records can carry Codex thread
correlation evidence.

This slice remains deterministic and fixture-only. It must not launch a real
provider or read real `~/.codex` state unless a caller explicitly provides a
diagnostic root outside tests.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- `docs/design/work-cards/afk-codex-provider-session-adapter-time-window-correction-v0.md`
- `docs/design/notes/afk-codex-provider-session-adapter-contract-2026-05-22.md`
- `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`
- `packages/host/package.json`

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
- routed_from_sha: `af8256c7dc0d6f78c603292268e7f16bde53170d`
- expected output branch:
  `gdi/afk-launch-attempt-codex-adapter-integration-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - current launch-attempt record
  creation, synthetic bridge visibility, provider acceptance parsing, catalog
  fixture classification, telemetry fields, and direct `node` CLI behavior.
- `tests/afk-launch-attempt-prototype.test.mjs` - deterministic launch-attempt
  fixture coverage, including synthetic provider session id, wrong-cwd catalog
  classification, and all-cwd non-binding behavior.
- `packages/host/src/codex-thread-adapter.ts` - accepted adapter exports:
  `listCandidateThreads`, `getThreadInfo`, `resolveProviderSessionId`,
  `correlateLaunch`, and `emitThreadReference`.

## Required Behavior

- Add fixture-driven Codex adapter correlation to
  `scripts/afk-launch-attempt-prototype.mjs`.
- Preserve the current direct script command shape:
  `node scripts/afk-launch-attempt-prototype.mjs ...` must still work without a
  caller passing Node TypeScript flags. If the accepted TypeScript adapter cannot
  be imported directly from the script under that command, choose the smallest
  maintainable bridge that preserves direct-node prototype execution and avoids
  duplicating adapter logic.
- Add an explicit option for fixture roots, such as `--codex-home-fixture` or
  `--codex-home`, and use it in tests. Tests must prove they use a temporary
  fixture root and do not read real `~/.codex`.
- When a Codex provider session id is observed from `--provider-session-id` or
  bridge visibility, call the adapter equivalent of `correlateLaunch` using:
  - `providerSessionId`;
  - the intended launch cwd;
  - a launch time window derived from launch observation/timestamp fields; and
  - terminal substrate evidence from the bridge visibility when present.
- When no provider session id is observed, only let the adapter return cwd/time
  candidates when both intended cwd and a usable launch time boundary exist.
  Preserve the accepted no-time-window behavior: no cwd-only binding.
- Surface adapter results in the launch-attempt record without replacing the
  existing catalog fixture fields:
  - include `codex://threads/<thread_id>` and `codex-thread:<thread_id>` refs in
    `evidence.observed_refs` when the adapter matches a thread;
  - include adapter evidence refs in a stable local field, preferably under a
    provider-session or catalog-adjacent object;
  - mirror adapter mismatch codes such as `provider_session_id_not_observed`,
    `wrong_cwd`, `multiple_candidates`, or `not_observed` into existing
    mismatch/reporting conventions where appropriate.
- Keep existing catalog fixture behavior intact. Catalog records can corroborate
  provider-session evidence, but they must not replace Codex adapter metadata or
  bind unrelated all-cwd candidates.
- Preserve existing no-provider launch behavior and tests.

## Fixture Requirements

Add focused tests with synthetic Codex rollout metadata under a temporary
`codexHome` fixture. Cover at least:

- observed provider session id plus matching Codex thread cwd emits Codex thread
  refs in the launch-attempt record;
- observed provider session id plus wrong Codex thread cwd records a structured
  mismatch and does not mark a matched thread;
- provider id not observed plus cwd/time window returns exactly one Codex
  candidate when the fixture contains one current same-cwd thread;
- provider id not observed without a usable time window does not bind a
  same-cwd Codex thread.

## Hard Boundaries

- Do not read real Codex sessions/transcripts in tests.
- Do not copy, vendor, or import personal skill scripts from `~/.codex`.
- Do not launch Codex, Claude, Gemini, Sigil, gateway, or the AOS daemon.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not add a public `./aos` command, scheduler, gateway route, result-route
  delivery, schema, committed generated receipt, or real provider launch in this
  slice.

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

If adapter integration touches shared bridge behavior, also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

Run one manual prototype smoke with a temp packet and a temp Codex home fixture,
then report the key record facts. Remove temp artifacts afterward.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact prototype option and record fields added for Codex adapter evidence;
- fixture shape and proof that tests did not read real `~/.codex`;
- exact statuses implemented for matched thread, wrong cwd, not observed, and
  multiple candidates if covered;
- exact verification commands and results;
- manual smoke key facts: lifecycle state, provider acceptance, adapter
  correlation status, observed thread refs, catalog status, telemetry status,
  mismatches, and evidence refs;
- confirmation that no real Codex sessions/transcripts, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changed;
- recommended next follow-up before the first supervised real provider launch.
