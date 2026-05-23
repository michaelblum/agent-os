# Work Card: AFK Dev Session Trigger Provider Acceptance Observation V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI implementation round
- Single next goal: make the guarded live Codex/GDI trigger path observe
  provider acceptance from the live terminal snapshot, so a launch that exposes
  the same snapshot text already covered by fixtures promotes
  `provider_acceptance.status` to `provider_session_observed` without human
  confirmation.
- Source artifacts:
  - PR #377 merge on `main`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
- Branch/Base:
  - `branch_from: foreman/afk-provider-acceptance-observation-v0`
  - `required_start_ref: foreman/afk-provider-acceptance-observation-v0`
  - This Foreman branch is a local routing checkpoint that carries this card and
    the packet under `packets/`. Do not reset it to `origin/main` before reading
    the card.
- Branch/output expectation: create
  `gdi/afk-dev-session-trigger-provider-acceptance-observation-v0` from the
  required start ref. Commit and push that GDI branch when verification passes,
  per the active `agentic_relay` profile. Do not open a PR, merge, close issues,
  mutate GitHub state beyond the branch push, or start async result routing.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
bridge process, provider session, transcript/catalog state, PR state, or prior
implementation state. Read and rediscover before editing.

## Current State

PR #377 merged the supervised trigger prototype to `main`. The deterministic
suite was reported green at 15/15 tests, and cleanup is verified. The remaining
live-path gap is `provider_acceptance_unobserved`: the trigger starts the
terminal substrate and launches the provider command, but the no-fixture live
branch does not yet parse the terminal snapshot text to confirm that the
provider accepted and is executing the submitted prompt.

The fixture-backed trigger test already captures the desired snapshot shape.
`writeBridgeVisibilityFixture()` in
`tests/afk-session-trigger-prototype.test.mjs` includes snapshot text with:

```text
Codex CLI 0.133.0
provider_session_id: <uuid>
cwd /Users/Michael/Code/agent-os/.docks/gdi
branch gdi/afk-dev-session-trigger-supervised-bridge-launch-v0
model gpt-5.5
head a38d0da6
live-codex-session-trigger-supervised-bridge-launch
```

`scripts/afk-launch-attempt-prototype.mjs` already parses this shape for
fixtures through `parseBridgeVisibilityText()` and
`normalizeBridgeVisibilityFixture()`. The live no-fixture branch in
`observeProviderTerminalSubstrate()` currently records
`provider_acceptance_unobserved` instead of applying that parser to the live
snapshot text.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- `docs/design/work-cards/afk-dev-session-trigger-packet-validation-status-correction-v0.md`
- `docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-acceptance-observation-v0 origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-launch-attempt-prototype.mjs,scripts/afk-session-trigger-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/afk-session-trigger-prototype.test.mjs
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs`
  - `parseBridgeVisibilityText()` - parses provider session id, cwd, branch,
    head, Codex CLI version, and model from snapshot/title/status text.
  - `normalizeBridgeVisibilityFixture()` - fixture path that already promotes
    parsed provider session evidence to `provider_session_observed`.
  - `waitForSessionProcessSnapshot()` - current live polling helper that waits
    only for a command child PID.
  - `observeProviderTerminalSubstrate()` - live no-fixture provider branch that
    must parse the live snapshot and populate `provider_acceptance`.
  - `deriveLifecycleState()` - promotes launch attempts to
    `provider_session_observed` when provider acceptance is observed.
- `scripts/afk-session-trigger-prototype.mjs`
  - `launchAttemptMismatches()`, `statusFor()`, and `schedulerState()` - receipt
    classification once the launch attempt reports provider acceptance and
    cleanup state.
- `tests/afk-session-trigger-prototype.test.mjs`
  - fixture-backed supervised-live test and provider-timeout tests.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - launch-attempt provider acceptance and cwd/correlation tests.

## Required Behavior

- In the guarded no-fixture live Codex/GDI path, after the provider command is
  started, poll the bridge `/snapshot` output for a bounded window and parse the
  same text patterns currently parsed by fixture-backed bridge visibility.
- When a live snapshot contains a parseable provider session id, set:
  - `provider_acceptance.status: provider_session_observed`
  - `provider_acceptance.provider_session_id: <observed id>`
  - parsed `provider_reported_cwd`, `provider_reported_branch`,
    `provider_reported_head`, `provider_version`, and `model` when present.
- The live path should set a reviewable `terminal_substrate.snapshot_ref` and
  useful `snapshot_summary.text_excerpt` from the live snapshot, using bounded
  excerpting only.
- A receipt whose launch attempt reaches `provider_session_observed` and whose
  cleanup is verified should no longer contain a
  `provider_acceptance_unobserved` mismatch.
- If the bounded live snapshot window never exposes a parseable provider
  session id, preserve the current honest non-completed behavior:
  `provider_acceptance.status=provider_acceptance_unobserved`, top-level
  trigger status `provider_acceptance_unobserved` when cleanup is verified, and
  a provider-acceptance mismatch.
- Preserve cleanup proof requirements. Provider acceptance alone must not report
  `completed` unless cleanup is verified.
- Preserve the current live launch guard. Do not remove `--i-am-present` in this
  GDI slice; closing provider observation is the prerequisite for a later
  Foreman decision about unsupervised triggers.

## Scope And Hard Boundaries

- This is a source and deterministic-test slice for provider acceptance
  observation in the experimental AFK trigger/launch-attempt prototypes.
- Do not start async result routing.
- Do not remove, relax, rename, or bypass `--i-am-present`.
- Do not add final `aos session ...` command spelling.
- Do not broaden beyond the first Codex/GDI live path.
- Do not read provider transcript bodies outside the bounded bridge snapshot
  already produced by the terminal substrate.
- Do not mutate provider configs, provider session stores, provider catalogs,
  telemetry stores, gateway state, dock profiles, hooks, GitHub issues, PRs, or
  main.
- Do not run a live Codex provider launch in this GDI round. If deterministic
  verification passes, report whether an Operator supervised live proof is the
  next required evidence.

## Suggested Implementation Areas

- Prefer sharing the fixture parser with the live branch instead of duplicating
  regex logic.
- Consider a small helper that converts snapshot text plus fallback metadata
  into a `provider_acceptance` object and optional mismatch. Both
  `normalizeBridgeVisibilityFixture()` and `observeProviderTerminalSubstrate()`
  can use that helper.
- Consider changing `waitForSessionProcessSnapshot()` or adding a sibling helper
  so the live branch polls until either:
  - snapshot text parses to a provider session id, or
  - the bounded observation window expires after the command child exists.
- Add focused deterministic coverage that proves the live snapshot parser path
  promotes provider acceptance without executing a real provider. If exporting a
  narrowly named helper is the smallest clean seam for that test, keep the
  export explicit and limited.
- Keep provider-launch dry-run behavior honest: dry-run without live snapshot
  evidence should still report provider acceptance unobserved.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Run if router/help/Swift surfaces change:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Do not run live provider verification in this GDI round. If the implementation
changes the real bridge/session APIs enough that deterministic tests cannot
prove the intended behavior, stop and report the missing testability boundary
instead of launching a provider.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks and the GDI helper reports
  `human_needed`;
- live provider launch appears necessary to finish implementation;
- the only way to observe provider acceptance would require reading provider
  transcript bodies or mutating provider-owned stores;
- the fix requires async result routing, final session command design, or
  removing the human-presence guard;
- deterministic tests become flaky due to real provider timing or live process
  dependence.

## Completion Report

Report:

- profile from `docs/dev/active-profile.json`;
- branch and head SHA;
- base ref/SHA used;
- changed paths, path-scoped to this slice;
- exact behavior now used to parse live terminal snapshot text into
  `provider_acceptance`;
- how deterministic tests cover live-path parser promotion without executing
  Codex;
- exact receipt/status changes for observed and unobserved provider acceptance;
- exact tests/checks run with pass/fail results;
- `./aos ready` result or exact `human_needed` blocker;
- whether an Operator supervised live proof is still required before Foreman
  considers the provider-acceptance gate closed;
- confirmation that no live provider launch, provider transcript body read,
  provider store/catalog/telemetry mutation, gateway state, dock profile/hook
  mutation, GitHub issue/PR mutation, main merge, or async result routing
  occurred.

If this GDI session reused a completed goal, remind the human to run
`/goal clear` before retiring or starting unrelated work.
