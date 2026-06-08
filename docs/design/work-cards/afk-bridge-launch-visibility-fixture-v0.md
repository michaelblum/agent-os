# AFK Bridge Launch Visibility Fixture V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `ee786994b02aeb62e9492c742f5ff38338d49427`
- Changed files:
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Foreman review: accepted. The prototype now supports
  `--bridge-visibility-fixture`, treats provider-shaped bridge commands as
  synthetic fixture evidence rather than executed commands, emits explicit
  launch-side `provider_acceptance` facts, records
  `provider_acceptance_unobserved` with `provider_session_id: not_observed`
  when no id is parseable, and binds a synthetic provider session id to a
  requested-cwd catalog match when the fixture supplies both sides.
- Existing catalog behavior remains intact: requested-cwd current absence stays
  `catalog_current_launch_not_observed`, unrelated all-cwd candidates remain in
  `catalog.unrelated_current_session_refs`, unrelated telemetry does not bind,
  and true wrong-cwd provider session behavior remains covered.
- Foreman verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`: 15/15 pass
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`: 1/1 pass
  - `git diff --check d288f242..ee786994`: pass
  - `./aos dev recommend --json --files scripts/afk-launch-attempt-prototype.mjs tests/afk-launch-attempt-prototype.test.mjs`: pass; focused changed test already run
  - `./aos dev recommend --json`: pass; broader branch-level recommendations
    are inherited from the long-lived feature branch, not this slice
- Local-only boundary confirmed: no live provider session was launched; no
  provider config, real provider transcript, gateway state, dock profile, hook,
  GitHub state, push, or PR changed.
- Remaining gap: define the repo-owned Codex provider-session/thread adapter
  contract that can resolve, inspect, correlate, and deeplink Codex sessions
  without depending on ad hoc skill behavior.
- Routed follow-up:
  `docs/design/work-cards/afk-codex-provider-session-adapter-inventory-v0.md`.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer implementation round
- Source artifact:
  `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `implementer/afk-bridge-launch-visibility-fixture-v0` from the required start ref.
  Keep the checkpoint local; do not push, open a PR, mutate GitHub, or run live
  provider checks.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, Operator report, or prior
implementation state. Read and rediscover before editing.

## Goal

Add deterministic provider-free launch-side visibility handling to the AFK
launch-attempt prototype so bridge terminal substrate can produce explicit
provider acceptance fields before catalog matching exists.

The intended outcome is not automated provider launch. It is a fixture-backed
classification surface that can say:

- terminal substrate exists for a provider-shaped command;
- selected provider, command, intended cwd, driver, and session handle are
  machine-observed from a bridge fixture;
- provider session id is `not_observed` when the bridge surface does not expose
  it;
- optional structured title/status facts such as cwd, branch, model, version,
  and head are captured when present in synthetic snapshot/title text;
- catalog and telemetry remain honest until a catalog fixture explicitly binds
  the launch.

## Read First

- the implementer native subagent instructions
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `docs/design/work-cards/afk-bridge-provider-launch-visibility-diagnosis-v0.md`
- `docs/design/work-cards/afk-all-cwd-unrelated-candidate-classification-v0.md`
- `docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
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

If live AOS readiness becomes necessary for a bounded non-provider check, run:

```bash
./aos ready
```

If repo-mode Accessibility, Input Monitoring, or input-tap readiness blocks a
check, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `8cf12323bc909fc6cd78769f5561ca703c179bd7`
- expected output branch:
  `implementer/afk-bridge-launch-visibility-fixture-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - owns the experimental
  `aos.afk_launch_attempt` record, bridge terminal substrate observation,
  provider acceptance, catalog fixture classification, and telemetry fields.
- `tests/afk-launch-attempt-prototype.test.mjs` - existing deterministic
  coverage for no-provider substrate, stale catalog, unrelated all-cwd
  candidates, true wrong-cwd provider sessions, exact matches, and ambiguous
  candidates.
- `apps/sigil/codex-terminal/server.mjs` - bridge `/health`, `/ensure`,
  `/snapshot`, `/sessions`, and `/session-inspector` shapes to mirror in
  fixtures without launching providers.
- `packages/host/src/session-catalog.ts` - catalog records appear only after
  provider-owned metadata is discoverable; do not duplicate broad catalog
  policy in this slice.
- `packages/host/src/session-telemetry.ts` - telemetry remains unavailable
  unless catalog/session-inspector evidence exists.

## Required Behavior

Implement the smallest source/test change that lets the prototype consume a
synthetic bridge visibility fixture and emit launch-side provider acceptance
facts without launching a provider.

Suggested shape, but inspect before choosing exact names:

- Add a fixture input path or inline option for bridge launch visibility facts,
  for example `--bridge-visibility-fixture <path>`, or extend the existing
  catalog fixture only if that is cleaner.
- The fixture should include synthetic `health`, `ensure`, `command`, and
  `snapshot` or title/status text matching the diagnosis note's shape.
- When the command is provider-shaped, classify selected provider from the
  explicit `--provider`, packet hint, or command without executing that command.
- Record launch-side acceptance under existing `provider_acceptance` fields or
  a narrow adjacent field group:
  - status such as `provider_acceptance_unobserved` when terminal substrate is
    present but provider session id is not parseable;
  - `provider_session_id: not_observed`;
  - `provider_reported_cwd`, `provider_reported_branch`,
    `provider_reported_head`, `provider_version`, and `model` when synthetic
    snapshot/title text contains parseable values;
  - explicit mismatch/absence evidence when terminal substrate exists but
    provider acceptance is incomplete.
- Preserve catalog behavior:
  - requested-cwd current absence remains `catalog_current_launch_not_observed`;
  - unrelated all-cwd candidates remain under
    `catalog.unrelated_current_session_refs`;
  - telemetry from unrelated sessions does not bind to the launched provider.
- Add a true-positive synthetic fixture where a snapshot/title includes a
  parseable provider session id and the requested-cwd catalog fixture contains
  the same id with cwd `the implementer native subagent`. This should prove a future catalog polling
  path can bind an observed provider id without launching a provider.

Prefer a small helper function in `scripts/afk-launch-attempt-prototype.mjs`
over a new framework. Do not add a public `./aos` command or schemas in this
slice.

## Fixture Requirements

Use synthetic fixture data only. Do not read, write, delete, or depend on real
provider transcripts under the user's home directory.

At minimum cover:

1. Bridge-visible provider-shaped command with no provider session id:
   - health default cwd `/Users/Michael/Code/agent-os/the implementer native subagent`;
   - ensure session `afk-bridge-all-cwd-proof`;
   - command `codex --no-alt-screen`;
   - snapshot/title text contains cwd `the implementer native subagent`, branch, model, version, and
     head but no provider session id;
   - output has terminal substrate observed,
     `provider_acceptance.status: provider_acceptance_unobserved`,
     `provider_session_id: not_observed`, requested-cwd catalog current launch
     not observed, and unrelated all-cwd context retained.
2. Bridge-visible provider-shaped command with a synthetic provider session id:
   - snapshot/title text includes a parseable session id;
   - requested-cwd catalog fixture includes that same id with cwd `the implementer native subagent`;
   - output binds the provider session id as a current matched catalog session
     without launching a provider.
3. Existing tests for no-provider launch, stale catalog, unrelated all-cwd
   candidate, true wrong-cwd provider session, missing cwd metadata, exact
   match, and ambiguous candidates still pass.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not run a supervised live bridge proof.
- Do not read, write, delete, or depend on real provider transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, committed generated receipts, or
  schemas.
- Do not repair `apps/sigil/agent-terminal/launch.sh` wrapper health in this
  slice unless a tiny deterministic fixture exposes a one-line bug. Report it
  as a separate follow-up otherwise.
- Do not weaken the accepted all-cwd endpoint behavior, unrelated all-cwd
  classification, true wrong-cwd classification, or no-provider safety guard.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If `apps/sigil/codex-terminal/server.mjs`, session inspector, host catalog, or
telemetry code changes, run the focused tests recommended by
`./aos dev recommend --json` and report exact pass/fail output.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether any live provider session was launched, expected answer: no;
- fixture input shape added;
- provider acceptance statuses/fields implemented;
- how catalog matching behaves for no-id and synthetic-id cases;
- exact verification commands and results;
- confirmation that no provider config, real provider transcript, gateway
  state, dock profile, hook, GitHub state, push, or PR changed;
- remaining follow-up, especially whether catalog polling/matching or wrapper
  health should come next.
