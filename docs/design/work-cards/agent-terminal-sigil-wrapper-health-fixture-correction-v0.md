# Agent Terminal Sigil Wrapper Health Fixture Correction V0

## Recipient

GDI

## Transfer Kind

Correction round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Source Artifact

Foreman reviewed:

- branch: `gdi/agent-terminal-sigil-wrapper-health-fixture-v0`
- reviewed head: `d6904e1f35d01b6d772e400d62e8f5a30d89de4d`
- original work card:
  `docs/design/work-cards/agent-terminal-sigil-wrapper-health-fixture-v0.md`

The reviewed slice correctly identified stale or drifted bridge health on the
requested port as the failure class. It added `bridge_health_matches`, but the
post-start wait loop still accepts any healthy bridge on that port.

## Goal

Correct the wrapper health guard so both the Sigil wrapper and generic toolkit
launcher only report bridge startup success when `/health` matches the requested
`defaultSession` and `defaultCwd`, including after an attempted start or
`--restart`.

## Branch / Base

- branch_from:
  `origin/foreman/agent-terminal-sigil-wrapper-health-fixture-correction-v0`
- required_start_ref:
  `origin/foreman/agent-terminal-sigil-wrapper-health-fixture-correction-v0`
- required_start_sha: `d6904e1f35d01b6d772e400d62e8f5a30d89de4d` plus this
  correction card
- output_branch:
  `gdi/agent-terminal-sigil-wrapper-health-fixture-correction-v0`

Do not reset to `origin/main`; the correction must apply on top of the reviewed
GDI branch.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/agent-terminal-sigil-wrapper-health-fixture-v0.md`
- `docs/design/work-cards/agent-terminal-sigil-wrapper-health-fixture-correction-v0.md`
- `apps/sigil/agent-terminal/launch.sh`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `tests/renderer/agent-terminal-chrome.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/foreman/agent-terminal-sigil-wrapper-health-fixture-correction-v0
```

This slice is deterministic. Do not run live launchers, providers, AOS canvases,
or tmux-dependent checks.

## Finding To Fix

In both launchers, `start_bridge` now skips initial reuse unless
`bridge_health_matches` succeeds. That part is good.

However, after starting the bridge, the wait loop still uses `bridge_running`:

```bash
for _ in $(seq 1 30); do
  bridge_running && return 0
  sleep 0.1
done
```

That means a stale bridge already occupying the requested port can still satisfy
the post-start wait even if it reports the wrong `defaultSession` or
`defaultCwd`. In the no-tmux path the new bridge process cannot bind the port,
but the old bridge keeps `/health` green; in the tmux path a bridge outside the
expected `$BRIDGE_SESSION` can do the same.

Observed review locations on `d6904e1`:

- `apps/sigil/agent-terminal/launch.sh`, post-start wait around lines 133-134;
- `packages/toolkit/components/agent-terminal/launch.sh`, post-start wait
  around lines 163-164.

## Required Behavior

1. Make the post-start wait loop require identity-matched health.

   The launcher should return success only when `bridge_health_matches` returns
   success. It should not treat generic `/health` success as enough after a
   failed initial reuse check, attempted start, or `--restart`.

2. Preserve the intended reuse behavior.

   - If `--restart` is not used and `/health` already matches the requested
     session and cwd, reuse is allowed.
   - If `--restart` is used, the launcher should bypass initial reuse, start the
     bridge path, and only return success when matching health is observed.
   - If a stale or wrong bridge owns the port, the launcher should fail with the
     existing bridge-start error path rather than silently accepting that bridge.

3. Add or update deterministic regression coverage.

   Extend `tests/renderer/agent-terminal-chrome.test.mjs` or another focused
   deterministic test so it proves both launchers' post-start wait uses
   `bridge_health_matches`, not `bridge_running`.

   Static coverage is acceptable for this correction if it specifically catches
   the reviewed hole. Do not rely only on the existing initial-reuse assertion.

4. Keep the original slice boundaries.

   Do not change provider acceptance, catalog correlation, shim retirement, or
   launcher ownership boundaries.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not open AOS canvases, drive live UI, mutate live dock sessions, or depend
  on tmux state for required evidence.
- Do not read provider transcript bodies or real provider session stores.
- Do not mutate provider config, gateway state, dock profiles, hooks, GitHub
  issues, PRs, release state, or unrelated runtime artifacts.
- Do not remove historical `apps/sigil/codex-terminal/*` shims.
- Do not add compatibility env aliases for old `SIGIL_AGENT_*`,
  `SIGIL_CODEX_*`, or `CODEX_COMMAND` names.
- Do not broaden into AFK scheduler, gateway, result-route, catalog, telemetry,
  or shim-retirement work.

## Verification

Run:

```bash
bash -n apps/sigil/agent-terminal/launch.sh
bash -n packages/toolkit/components/agent-terminal/launch.sh
bash -n apps/sigil/codex-terminal/launch.sh
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you change more than the two launchers and focused renderer test, run the
additional focused checks implied by the changed files and report them.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- exact correction made to the post-start wait;
- regression coverage added;
- confirmation that no live provider, AOS canvas, tmux session, provider
  transcript, or real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- remaining follow-up recommendation.
