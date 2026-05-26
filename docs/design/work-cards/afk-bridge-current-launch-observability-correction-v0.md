# Work Card: AFK Bridge Current-Launch Observability Correction V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `89f38803d61dff18d124941b3aa5adae44795286`
- Changed files:
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Foreman review: accepted. The prototype now classifies fixture-backed
  provider catalog evidence for current-launch observation without overclaiming
  stale sessions or stale telemetry. It distinguishes empty catalog, stale-only
  catalog, one current candidate without a known provider session id, exact
  provider-session-id match, and multiple current candidates. Telemetry is only
  reported for the matched/current catalog session.
- Foreman verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`
  - `git diff --check 795f68f412dc669991e82892a6d968144e4bbcb7..89f38803d61dff18d124941b3aa5adae44795286`
  - `./aos dev recommend --json`
- Key fixture proof: the Operator stale case is covered with launch observed
  around `2026-05-22T12:58Z`, a stale Codex catalog session updated at
  `2026-05-22T06:11:41Z`, catalog status
  `catalog_current_launch_not_observed`, and telemetry status
  `telemetry_current_launch_not_observed`.
- Local-only boundary confirmed: no Codex, Claude, Gemini, or other provider
  was launched; no provider config, real provider transcript, gateway state,
  dock profile, hook, GitHub state, push, or PR changed.
- Remaining gap: fixture-backed current-launch classification still needs a
  supervised live bridge-backed correlation proof before supervised
  real-launch attempt integration.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Source receipt:
  `docs/design/notes/manual-afk-receipts/2026-05-22-bridge-backed-provider-launch-gdi-partial.md`
- Source accepted card:
  `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
- Correction finding: the supervised bridge-backed Codex launch was visible
  through the process-driver bridge from `.docks/gdi`, but the current launch
  was not bound to provider catalog or telemetry. The catalog endpoint returned
  a stale pre-existing Codex session for the same cwd/provider, and
  `/session-inspector` worked only for that stale visible id.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, receipt, or prior
implementation state. Read and rediscover before editing.

## Goal

Make AFK launch-attempt observation classify current-launch catalog and
telemetry evidence honestly when a bridge-backed provider launch is visible but
the provider catalog only exposes stale or unrelated sessions.

This is a correction/observability slice before supervised real-launch attempt
integration. Prefer deterministic fixture-backed implementation and tests. Do
not launch Codex, Claude, Gemini, or another provider in this GDI round.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-bridge-backed-provider-launch-gdi-partial.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/session-inspector.mjs`
- `packages/host/src/session-catalog.ts`
- `packages/host/src/session-telemetry.ts`

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
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `gdi/afk-launch-attempt-prototype-no-provider-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `1595e2ee`
- expected output branch:
  `gdi/afk-bridge-current-launch-observability-correction-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - current no-schema
  `aos.afk_launch_attempt` prototype and terminal/catalog/telemetry fields.
- `tests/afk-launch-attempt-prototype.test.mjs` - focused deterministic
  coverage for no-provider launch-attempt records.
- `tests/afk-terminal-substrate-no-provider.test.mjs` - bridge substrate proof
  and current no-provider `/sessions` and `/session-inspector` expectations.
- `apps/sigil/codex-terminal/server.mjs` - bridge `/health`, `/ensure`,
  `/snapshot`, `/input`, `/sessions`, and `/session-inspector` endpoints.
- `apps/sigil/codex-terminal/session-inspector.mjs` - telemetry/mismatch
  output for catalog-visible provider sessions.
- `packages/host/src/session-catalog.ts` and
  `packages/host/src/session-telemetry.ts` - catalog and telemetry source
  behavior; inspect enough to avoid duplicating parser policy in AFK code.
- `tests/sigil-agent-terminal-server.test.mjs`,
  `packages/host/test/session-catalog.test.ts`, and
  `packages/host/test/session-telemetry.test.ts` - existing fixture patterns.

## Required Behavior

Implement the smallest source/test correction that lets an AFK launch-attempt
record distinguish these cases without overclaiming:

- no catalog sessions for the provider/cwd;
- only stale catalog sessions relative to the current launch observation
  window;
- one current candidate for the provider/cwd when no provider session id is
  known;
- exact catalog match when a provider session id is known;
- multiple current candidates or otherwise ambiguous matches;
- telemetry observed for the matched/current catalog session;
- telemetry not attempted or not observed when the current launch is not
  catalog-visible.

The output record should preserve the existing no-provider statuses, and should
add or refine fields only where needed to report the partial Operator result
truthfully. Good names may include:

- `catalog_current_launch_not_observed`;
- `catalog_candidate_current_launch_observed`;
- `catalog_matched`;
- `multiple_catalog_candidates`;
- `telemetry_current_launch_not_observed`;
- `telemetry_not_attempted_no_catalog_match`.

Exact enum names can differ if they fit existing code better, but the record
must make stale-catalog evidence visibly different from "catalog endpoint was
empty" and from "catalog matched the current launch."

If you touch bridge behavior, keep it generic and read-only. Do not make Sigil
the owner of AFK lifecycle. If the right correction is a new helper inside the
prototype rather than bridge code, prefer the narrower prototype/helper change.

## Fixture And Evidence Requirements

Use deterministic fixture data or temporary catalog roots. Do not read, write,
delete, or depend on real provider transcripts under the user's home directory.

At least one test should model the Operator result shape:

- bridge launch observed at approximately `2026-05-22T12:58Z`;
- provider/cwd filter returns a Codex session updated at
  `2026-05-22T06:11:41Z`;
- catalog status records current launch not observed rather than treating the
  stale session as a match;
- telemetry for the stale session does not become telemetry for the current
  launch.

Add exact-match and ambiguous-candidate coverage if it is cheap. If those cases
would force broad refactoring, document them as follow-up and keep this slice
focused on the stale-current-launch correction.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, or committed generated receipts.
- Do not add a public `./aos` command unless a minimal test-only helper proves
  insufficient.
- Do not add or migrate schemas.
- Do not mutate provider config, provider transcripts, gateway state, dock
  profiles, `.docks` role instructions, hooks, GitHub state, push, or PRs.
- Do not treat a stale provider catalog session as proof of the current launch.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If you add a new focused test file, run it explicitly. If you change
`apps/sigil/codex-terminal/server.mjs` or session inspector behavior, also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

If you change host catalog or telemetry code, run the focused host tests
recommended by `./aos dev recommend --json` and report exact pass/fail output.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether any live provider session was launched, expected answer: no;
- classification states implemented for catalog and telemetry;
- fixture/test cases added or changed, especially stale-current-launch
  behavior;
- exact verification commands and results;
- confirmation that no provider config, real provider transcript, gateway
  state, dock profile, hook, GitHub state, push, or PR changed;
- remaining gap before supervised real-launch attempt integration;
- local-only state or runtime blockers.
