# Work Card: AFK Provider Session CWD Mismatch Classification V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commits:
  - `c5a3508d9d72a562cc735274af09bea5ff30ad7f`
  - `50b74f413a79ef4a2e56a326ee37b937fb40dec2`
- Changed files:
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Foreman review: accepted after correction. The prototype now classifies an
  observed provider-session cwd mismatch as structured
  `provider_session_wrong_cwd` and `catalog_provider_session_wrong_cwd`, keeps
  wrong-cwd telemetry from binding, and preserves the observed provider session
  id and reported cwd in `provider_acceptance`. The follow-up correction
  prevents missing cwd metadata from being converted into a false wrong-cwd
  signal; absent cwd stays `not_observed`, and sessions without cwd metadata
  are ignored for cwd matching.
- Foreman verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`
  - `git diff --check 29b500790e15ccd59939ca4b90f17abf0e0043a5..50b74f413a79ef4a2e56a326ee37b937fb40dec2`
  - `./aos dev recommend --json`
- Key fixture proofs:
  - Operator wrong-cwd case records provider session id
    `019e4fdc-7236-7db0-9f77-29f8f4108b3f`, expected `.docks/gdi`, observed
    `.docks/operator`, `catalog_provider_session_wrong_cwd`, and
    `telemetry_not_attempted_wrong_cwd`.
  - Missing provider-session cwd keeps `provider_reported_cwd: not_observed`,
    does not emit wrong-cwd statuses or mismatches, and does not bind telemetry.
  - Earlier stale-GDI current-launch absence behavior still passes.
- Local-only boundary confirmed: no Codex, Claude, Gemini, or other provider
  was launched; no provider config, real provider transcript, gateway state,
  dock profile, hook, GitHub state, push, or PR changed.
- Remaining gap: fixture-backed classification needs another supervised live
  bridge correlation proof before supervised real-launch attempt integration.

## Foreman Review Finding

- Reviewed output commit:
  `c5a3508d9d72a562cc735274af09bea5ff30ad7f`
- Result: correction required before acceptance.
- Passing verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`
  - `git diff --check f2d8f108691e89e00b788cab336670a6a0f99cd7..c5a3508d9d72a562cc735274af09bea5ff30ad7f`
  - `./aos dev recommend --json`
- Finding: `classifyCatalogAndTelemetry` currently resolves a missing
  provider-session cwd with `resolve(normalizeSessionCwd(session) ?? '')`.
  That turns an unobserved cwd into the process cwd and can classify a session
  with no cwd metadata as `provider_session_wrong_cwd`. Wrong-cwd should only
  be emitted when the provider/session catalog actually supplies an observed
  cwd that differs from the intended launch cwd.

## Correction Goal

Keep the implemented Operator wrong-cwd fixture behavior, but add the missing
guard and test coverage for an observed provider session id whose catalog record
does not include cwd metadata.

Required correction:

- if the matching provider session id has no cwd value, keep
  `provider_acceptance.provider_session_id` but report
  `provider_acceptance.provider_reported_cwd: not_observed`;
- do not emit `provider_session_wrong_cwd`,
  `catalog_provider_session_wrong_cwd`, or
  `telemetry_not_attempted_wrong_cwd` when cwd is missing/unobserved;
- do not bind telemetry from that session as current-launch telemetry unless
  the session is otherwise a valid current/matched session for the intended cwd;
- add a focused deterministic test for this case;
- preserve the accepted wrong-cwd fixture case and the stale-GDI current-launch
  absence case.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Source receipt:
  `docs/design/notes/manual-afk-receipts/2026-05-22-live-bridge-current-launch-correlation-gdi-wrong-cwd.md`
- Source accepted card:
  `docs/design/work-cards/afk-bridge-current-launch-observability-correction-v0.md`
- Correction finding: the live bridge correlation smoke observed provider
  session id `019e4fdc-7236-7db0-9f77-29f8f4108b3f`, but that provider-owned
  transcript recorded cwd `/Users/Michael/Code/agent-os/.docks/operator`
  while the bridge launch intent requested
  `/Users/Michael/Code/agent-os/.docks/gdi`. The current classifier correctly
  refused stale GDI cwd matches, but it cannot yet classify an observed
  provider-session cwd mismatch directly.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, receipt, or prior
implementation state. Read and rediscover before editing.

## Goal

Make the AFK launch-attempt prototype classify an observed provider-session cwd
mismatch as a structured `wrong_cwd`/provider-session mismatch instead of
collapsing it into generic `catalog_current_launch_not_observed`.

This is deterministic fixture-backed correction work. Do not launch Codex,
Claude, Gemini, or another provider in this GDI round.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-live-bridge-current-launch-correlation-gdi-wrong-cwd.md`
- `docs/design/work-cards/afk-bridge-current-launch-observability-correction-v0.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
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

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `2329c725`
- expected output branch:
  `gdi/afk-provider-session-cwd-mismatch-classification-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - current fixture-backed
  `classifyCatalogAndTelemetry` helper and no-schema launch-attempt record
  fields.
- `tests/afk-launch-attempt-prototype.test.mjs` - current coverage for stale
  catalog sessions, empty catalog, one current candidate, exact match, and
  ambiguous candidates.
- `packages/host/src/session-catalog.ts` - catalog record cwd/provider/session
  semantics to mirror in deterministic fixtures.
- `packages/host/src/session-telemetry.ts` - telemetry should stay attached
  only to a valid matched/current session, not to a wrong-cwd session unless the
  record explicitly marks it as mismatch evidence.

## Required Behavior

Implement the smallest source/test correction that makes this case explicit:

- Input includes an observed `provider_session_id`.
- Catalog/session fixture includes that provider session id for provider
  `codex`.
- The session's cwd differs from the intended launch cwd.
- The output does not report this as an ordinary current-launch catalog miss.
- The output records a structured cwd mismatch with:
  - expected/intended launch cwd;
  - observed provider/session cwd;
  - provider session id;
  - mismatch code such as `wrong_cwd` or `provider_session_wrong_cwd`;
  - lifecycle/catalog/provider status that makes the mismatch reviewable.

Prefer preserving existing field groups:

- `provider_acceptance.provider_session_id` should be able to carry the
  observed session id when supplied.
- `provider_acceptance.provider_reported_cwd` should be able to carry the
  observed wrong cwd when supplied by the catalog/session fixture.
- `catalog.status` should distinguish wrong-cwd observation from
  `catalog_current_launch_not_observed`.
- `telemetry.status` should not imply current-launch telemetry for the
  requested cwd when the only observed provider session is wrong-cwd.

Good status names may include:

- `provider_session_wrong_cwd`;
- `catalog_provider_session_wrong_cwd`;
- `telemetry_not_attempted_wrong_cwd`;
- `wrong_cwd`.

Exact names can differ if they fit existing code better, but the difference
between stale/absent GDI catalog evidence and observed wrong-cwd provider
session evidence must be visible in JSON and tests.

## Fixture And Evidence Requirements

Use deterministic fixture data or temporary catalog roots. Do not read, write,
delete, or depend on real provider transcripts under the user's home directory.

At least one test should model the Operator finding:

- intended launch cwd:
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- observed provider session id:
  `019e4fdc-7236-7db0-9f77-29f8f4108b3f`;
- catalog/session metadata cwd:
  `/Users/Michael/Code/agent-os/.docks/operator`;
- result: structured wrong-cwd mismatch rather than
  `catalog_current_launch_not_observed`.

Keep the earlier stale-GDI test intact: stale GDI cwd records with no observed
provider session id should still classify as `catalog_current_launch_not_observed`.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, or committed generated receipts.
- Do not add a public `./aos` command unless a minimal test-only helper proves
  insufficient.
- Do not add or migrate schemas.
- Do not mutate provider config, provider transcripts, gateway state, dock
  profiles, `.docks` role instructions, hooks, GitHub state, push, or PRs.
- Do not treat wrong-cwd provider metadata as a successful current launch for
  the requested dock.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If you change host catalog or telemetry code, run the focused host tests
recommended by `./aos dev recommend --json` and report exact pass/fail output.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether any live provider session was launched, expected answer: no;
- wrong-cwd classification state and mismatch fields implemented;
- fixture/test cases added or changed, especially the Operator wrong-cwd case;
- confirmation that stale-GDI current-launch absence still behaves as before;
- exact verification commands and results;
- confirmation that no provider config, real provider transcript, gateway
  state, dock profile, hook, GitHub state, push, or PR changed;
- remaining gap before another supervised live bridge correlation proof;
- local-only state or runtime blockers.
