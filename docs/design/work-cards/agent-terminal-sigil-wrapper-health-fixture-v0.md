# Agent Terminal Sigil Wrapper Health Fixture V0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Tracker

Accepted roadmap:

- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`

Foreman post-review classification:

- The roadmap's provider-launch acceptance visibility fixture is already
  represented on `main` by the accepted
  `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md` work and
  current `scripts/afk-launch-attempt-prototype.mjs` / test coverage.
- The roadmap's catalog correlation enrichment is already represented on `main`
  by the accepted Codex adapter integration and workspace-root correlation work.
- The remaining distinct roadmap slice is the Sigil wrapper health track.

## Goal

Make the canonical Sigil Agent Terminal wrapper health path deterministic and
reviewable. Isolate why the historical live receipt saw
`apps/sigil/agent-terminal/launch.sh --new-codex --restart` fail to produce a
reachable bridge health endpoint while direct bridge startup worked, then add
the smallest provider-free fixture, test, or code correction needed to prevent
that failure shape from recurring.

Do not launch a real provider. Do not route back into launch acceptance,
catalog correlation, or shim retirement work.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `545a7972048d65c0c9b884a3ebe415a56fd17324` or later with this work card
- output_branch: `implementer/agent-terminal-sigil-wrapper-health-fixture-v0`

## Read First

- `AGENTS.md`
- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-bridge-backed-provider-launch-implementer-partial.md`
- `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md`
- `docs/design/work-cards/afk-launch-attempt-codex-adapter-integration-v0.md`
- `docs/design/work-cards/afk-codex-workspace-root-correlation-correction-v0.md`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/launch.sh`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos dev recommend --json --files \
  apps/sigil/agent-terminal/launch.sh \
  packages/toolkit/components/agent-terminal/launch.sh \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/sigil-agent-terminal-server.test.mjs
```

This slice should be deterministic. Do not run `./aos ready` or live launch
scripts unless your investigation proves deterministic evidence is insufficient
and you first report the exact reason in the completion report. Prefer tests and
provider-free local server fixtures.

## Existing Code To Inspect

- `apps/sigil/agent-terminal/launch.sh` - canonical Sigil wrapper launch; starts
  the toolkit bridge, ensures a bridge session, creates the Sigil avatar, and
  opens the Sigil Agent Terminal canvas.
- `packages/toolkit/components/agent-terminal/launch.sh` - generic toolkit
  launcher; useful parity reference for bridge startup, runtime asset
  preparation, and health behavior.
- `apps/sigil/codex-terminal/launch.sh` - historical path shim; should stay a
  thin `exec` wrapper around the canonical Sigil launcher.
- `packages/toolkit/components/agent-terminal/bridge-server.mjs` - bridge
  `/health` and `/ensure` implementation.
- `tests/renderer/agent-terminal-chrome.test.mjs` and
  `tests/sigil-agent-terminal-server.test.mjs` - current launcher, bridge, shim,
  and canonical env assertions.

## Required Behavior

1. Reconstruct the failure shape without launching Codex, Claude, Gemini, tmux
   sessions, or AOS canvases.

   Use the manual receipt and current launcher code to identify the likely
   deterministic failure class. Examples to consider:

   - wrapper and toolkit launcher drift;
   - missing Sigil wrapper parity with toolkit runtime asset preparation;
   - stale bridge health on the requested port;
   - `--restart` semantics that do not restart an already healthy bridge;
   - missing or unreported bridge log evidence;
   - content-root setup failure being hidden by broad output redirection.

   Do not assume one of these is the cause. Inspect first.

2. Add the smallest durable guard.

   Prefer one of these shapes:

   - a shell/static test that proves the Sigil launcher keeps health-critical
     behavior in parity with the toolkit launcher;
   - a provider-free local bridge/server fixture that exercises the wrapper's
     bridge startup or `/ensure` health path without creating canvases;
   - a tiny launcher correction if the defect is visible from deterministic
     inspection.

   Keep the correction scoped. If a larger launcher refactor is tempting, route
   it as a follow-up instead.

3. Preserve accepted ownership boundaries.

   - `AGENT_TERMINAL_*` remains the active bridge env contract.
   - `apps/sigil/agent-terminal/launch.sh` remains the canonical Sigil wrapper.
   - `packages/toolkit/components/agent-terminal/launch.sh` remains generic and
     must not learn Sigil avatar behavior.
   - `apps/sigil/codex-terminal/launch.sh` remains only a historical shim.
   - Do not add broad legacy env aliases or make the historical shim own new
     behavior.

4. Keep provider acceptance and catalog work untouched.

   The launch-attempt fixture, Codex adapter, catalog correlation, warm reuse,
   and result-route work already exist on `main`. Do not rework them in this
   slice unless a changed launcher test requires a tiny assertion update.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not open AOS canvases, drive live UI, mutate live dock sessions, or depend
  on tmux state for required evidence.
- Do not read provider transcript bodies or real provider session stores.
- Do not mutate provider config, gateway state, dock profiles, hooks, GitHub
  issues, PRs, release state, or unrelated runtime artifacts.
- Do not remove historical `apps/sigil/codex-terminal/*` shims in this slice.
- Do not add compatibility env aliases for old `SIGIL_AGENT_*`,
  `SIGIL_CODEX_*`, or `CODEX_COMMAND` names.
- Do not broaden into AFK scheduler, gateway, result-route, catalog, telemetry,
  or shim-retirement work.

## Verification

Run at minimum:

```bash
bash -n apps/sigil/agent-terminal/launch.sh
bash -n packages/toolkit/components/agent-terminal/launch.sh
bash -n apps/sigil/codex-terminal/launch.sh
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

Also run any focused command recommended by:

```bash
./aos dev recommend --json --files \
  apps/sigil/agent-terminal/launch.sh \
  packages/toolkit/components/agent-terminal/launch.sh \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/sigil-agent-terminal-server.test.mjs
```

If live readiness becomes the only meaningful proof, stop and report the exact
reason instead of driving providers or canvases in this Implementer round.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- failure class identified or ruled out;
- behavior changed, if any;
- fixture/test coverage added;
- whether any live provider, AOS canvas, tmux session, provider transcript, or
  real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- remaining follow-up recommendation, especially whether wrapper health now
  needs Operator live proof or whether shim retirement can be reconsidered
  later.
