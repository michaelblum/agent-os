# Work Card: AFK Dev Session Trigger Live Cleanup Proof V0

**Status:** Accepted 2026-05-22

## Foreman Acceptance

Accepted after the process-cleanup correction in
`docs/design/work-cards/afk-dev-session-trigger-live-cleanup-process-correction-v0.md`.

Accepted correction commit:
`dd7ce32f5d39e16d226a7a97ffcea9ce57758f3e`
(`fix(afk): require helper child cleanup proof`).

The accepted source behavior keeps the guarded live trigger Codex/GDI scoped,
selects `codex --no-alt-screen` only after the supervised-live gates pass, and
now reports source-owned cleanup proof only after the helper-owned bridge,
process-driver child, and provider command child/process group are proven gone.
Provider acceptance timeout with verified cleanup remains
`provider_acceptance_unobserved`; failed or insufficient cleanup proof remains
`cleanup_unverified`.

Next routed proof:
`docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`.

## Foreman Review Finding

First GDI output:
`e7645ff38ee266cd04a0e0794066d157c6a4cac2`
(`fix(afk): record supervised bridge cleanup proof`).

Foreman reran the required verification successfully:

```text
./aos ready
ready=true mode=repo daemon=reachable tap=active

node --test tests/afk-session-trigger-prototype.test.mjs
14 tests passed

node --test tests/afk-launch-attempt-prototype.test.mjs
24 tests passed

git diff --check 7fcdae5d1d760ea0af35d803a68eaa8325f298e5..HEAD
passed
```

However, Foreman did not accept the slice. A deterministic fake-`codex` smoke
that put a temporary non-provider `codex` binary first on `PATH` returned a
receipt with source-owned cleanup marked verified while a helper-owned
`pty-proxy.py codex --no-alt-screen` process was still visible immediately
after the trigger command returned:

```json
{
  "exit": 1,
  "receipt_status": "provider_acceptance_unobserved",
  "provider_acceptance_status": "provider_acceptance_unobserved",
  "cleanup_status": "verified",
  "terminal_command": "codex --no-alt-screen",
  "lingering_matches_sample": [
    "80877 .../pty-proxy.py codex --no-alt-screen"
  ]
}
```

The process exited by the time Foreman inspected it manually, and no unrelated
process was killed. The acceptance blocker is still real: cleanup verification
currently proves the bridge server process and health endpoint are gone, but
does not prove the helper-owned terminal child/session launched for
`codex --no-alt-screen` has exited before the receipt reports
`cleanup.status=verified`.

Next correction:
`docs/design/work-cards/afk-dev-session-trigger-live-cleanup-process-correction-v0.md`.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: make the no-fixture supervised
  `./aos dev afk-session-trigger` provider branch record source-owned cleanup
  proof after it tears down its bridge/provider launch substrate, so an
  unobserved provider acceptance timeout is not conflated with unchecked
  cleanup.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-dev-session-trigger-supervised-bridge-live-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-launch-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-provider-command-correction-v0.md`
- Branch/base:
  - `branch_from: docs/durable-agent-cognition-v0`
  - `required_start_ref: docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-dev-session-trigger-live-cleanup-proof-v0`. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
bridge process, provider session, transcript/catalog state, Operator report
details, or implementation shape beyond this card. Read and rediscover before
editing.

## Foreman Review Finding

The accepted Operator run proved the real no-fixture supervised trigger branch
selects the provider-shaped command and launches from `.docks/gdi`, but the
receipt still reports cleanup as unchecked:

```text
dispatch.provider_launch_allowed=true
terminal_substrate.command=codex --no-alt-screen
terminal_substrate.cwd=/Users/Michael/Code/agent-os/.docks/gdi
provider_acceptance.status=provider_acceptance_unobserved
cleanup.status=cleanup_unverified
mismatch classes=provider_acceptance_unobserved, cleanup_unverified
```

Operator then verified externally that no new bridge server, `pty-proxy.py`, or
nested `codex --no-alt-screen` process remained and final `./aos ready` passed.
That means the current source can tear down the bridge path, but the receipt
cannot yet distinguish "provider acceptance was not observed" from "cleanup was
not checked." This blocks a clean next live proof because `cleanup_unverified`
currently outranks `provider_acceptance_unobserved` in the trigger status.

## Goal

Add source-owned cleanup proof for the no-fixture supervised provider branch:

- when `createLaunchAttempt` starts a real supervised-provider bridge process,
  the helper should record bounded cleanup/teardown evidence after it stops the
  bridge it owns;
- `./aos dev afk-session-trigger` should use that proof when no
  `--cleanup-proof-fixture` is supplied;
- if provider acceptance is unobserved but cleanup is verified, the trigger
  receipt should report the provider-acceptance timeout as the primary
  non-completed state rather than `cleanup_unverified`;
- if cleanup cannot be verified, keep `cleanup_unverified` and do not report
  `completed`;
- keep cleanup proof required before `completed`.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/work-cards/operator-afk-dev-session-trigger-supervised-bridge-live-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-launch-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-provider-command-correction-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs
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

- `scripts/afk-launch-attempt-prototype.mjs` - owns
  `observeProviderTerminalSubstrate`, bridge process lifetime, launch-attempt
  evidence, and the no-provider substrate cleanup pattern.
- `scripts/afk-session-trigger-prototype.mjs` - owns cleanup classification,
  mismatch ordering, and trigger status.
- `tests/afk-session-trigger-prototype.test.mjs` - covers provider timeout and
  cleanup classification for the trigger receipt.
- `tests/afk-launch-attempt-prototype.test.mjs` - covers launch-attempt record
  vocabulary and should remain provider-free in deterministic tests.

## Required Behavior

- Do not change the guarded live gates: provider launch remains impossible
  unless `--supervised-live-launch`, `--i-am-present`, `--json`,
  `--provider codex`, and `--dock gdi` all pass.
- Do not change duplicate suppression before bridge/provider start.
- Preserve fixture-backed behavior. If a cleanup fixture is supplied, it should
  still be honored for deterministic tests and Operator-mode evidence shaping.
- For no-fixture supervised-provider attempts, record cleanup proof generated by
  the helper that owns the bridge process lifetime. Suitable evidence may be a
  bounded bridge process exit/termination proof, bridge health unreachable
  after teardown, and/or no helper-owned session/process remaining.
- The cleanup proof must be bounded to helper-owned bridge/provider processes.
  Do not kill or classify unrelated pre-existing Codex sessions as cleanup
  evidence.
- When provider acceptance remains unobserved and cleanup is verified, return a
  non-zero receipt with `status` or primary mismatch equivalent to
  `provider_acceptance_unobserved`, not `cleanup_unverified`.
- When cleanup proof fails or is missing after a launched bridge/provider
  attempt, keep `cleanup_unverified` and do not report `completed`.
- Do not make `completed` possible unless provider acceptance is observed and
  cleanup is verified.
- Keep result route and work receipt delivery as `not_attempted`.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this GDI round.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not add final `aos session ...` spelling, unattended scheduling, gateway
  result-route delivery, schema promotion, prompt submission, or multi-provider
  live parity.

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

One likely shape is for the launch-attempt helper to include a `cleanup` or
`terminal_cleanup` section when it owns and stops a supervised-provider bridge,
then for the session-trigger cleanup classifier to use that section when no
external cleanup fixture exists. Choose the smallest shape that keeps existing
record vocabulary understandable.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Add or update focused tests proving:

- no-fixture supervised-provider command-shape tests can represent cleanup
  verified without executing a live provider;
- provider acceptance timeout with cleanup verified returns
  `provider_acceptance_unobserved` or equivalent, not `cleanup_unverified`;
- cleanup proof failure or missing proof still returns `cleanup_unverified`;
- fixture-backed completed behavior still requires provider acceptance plus
  cleanup verified;
- guard failures and duplicate states still do not select or clean up a provider
  command.

Run if Swift/help surfaces change:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Do not run live Codex in this GDI round. If deterministic verification passes,
report the exact Operator scenario Foreman should route for the next live proof.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- cleanup proof cannot be represented without touching unrelated provider
  processes;
- source-owned cleanup proof would require reading real transcript bodies;
- provider acceptance observation, prompt submission, final command spelling,
  unattended behavior, gateway delivery, or multi-provider support becomes
  necessary to complete this cleanup-proof slice.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this slice;
- exact cleanup proof fields and status behavior added;
- provider-timeout, cleanup-failure, completed, guard, and duplicate behavior;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened;
- whether the source branch is ready for another Operator supervised live
  evidence run, including the proposed bounded command/scenario.
