# Work Card: AFK Launch Attempt Live Codex Record V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: make the no-schema AFK launch-attempt prototype truthfully
  represent the accepted supervised live Codex bridge pass using deterministic
  fixtures and tests, without launching a real provider in GDI.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-pty-rerun-v0.md`
  - `docs/design/work-cards/afk-bridge-codex-pty-observability-correction-v0.md`
  - `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
  - `docs/design/work-cards/afk-bridge-current-launch-observability-correction-v0.md`
  - `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-launch-attempt-live-codex-record-v0`. Keep the checkpoint local; do
  not push, open a PR, mutate GitHub, or publish externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Accepted live evidence:
  `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-pty-rerun-v0.md`
- Prototype surface:
  `scripts/afk-launch-attempt-prototype.mjs`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, Codex transcript, catalog, telemetry,
Operator report, or prior implementation state. Read and rediscover before
editing.

## Goal

Stabilize the launch-attempt prototype's live Codex record shape now that the
bridge can launch `codex --no-alt-screen`, submit a bounded prompt, receive a
response, materialize a separate rollout transcript, and correlate that rollout
through the Codex adapter.

This GDI round is fixture-backed implementation only. It should make the
prototype able to ingest a supervised live-result fixture shaped like the
accepted Operator pass and emit a record that no longer stays stuck at
`provider_acceptance_unobserved` when provider/Codex-thread evidence was
actually observed.

## Triggering Evidence

Accepted Operator pass:

- bridge launched `codex --no-alt-screen` from
  `/Users/Michael/Code/agent-os/.docks/gdi` through the process driver;
- `/health` reported terminal geometry `80x24`;
- `/resize` to `100x31` returned `resize_accepted=true`;
- `/input` accepted text and Enter, then one allowed `/key Enter` submitted the
  typed prompt;
- final snapshot showed the bounded response marker
  `live-codex-transcript-materialization-pty-rerun`;
- a separate Codex rollout appeared with provider session id
  `019e5107-5456-7f22-b08b-b977df1b35f4` and cwd
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- the corrected prototype, when pointed at the real Codex home and provider
  session id, reported `codex_adapter.status=observed`,
  `correlation_status=matched_by_provider_session_id`, `confidence=exact`, and
  `matched_cwd_basis=intended_launch_cwd`.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`
- `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-pty-rerun-v0.md`
- `docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md`
- `docs/design/work-cards/afk-bridge-current-launch-observability-correction-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is deterministic implementation work. Do not run live provider checks. If
live AOS readiness unexpectedly becomes necessary, run:

```bash
./aos ready
```

If repo-mode Accessibility, Input Monitoring, or input-tap readiness blocks a
live check, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `4814cdcfdd065ed107a20df656164ae89ae10440`
- expected output branch:
  `gdi/afk-launch-attempt-live-codex-record-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - current no-schema
  `aos.afk_launch_attempt` prototype, bridge visibility fixture parsing,
  catalog classification, Codex adapter correlation, and lifecycle assignment.
- `tests/afk-launch-attempt-prototype.test.mjs` - deterministic fixture
  coverage for no-provider launch attempts, bridge-shaped provider visibility,
  catalog/current-launch classification, and Codex adapter correlation.
- `packages/host/src/codex-thread-adapter.ts` - Codex rollout/thread
  correlation rules, cwd basis, exact provider-session-id matching, and
  time-window fallback behavior.
- `packages/host/test/codex-thread-adapter.test.ts` - focused adapter
  behavior and fixture patterns.
- `apps/sigil/codex-terminal/server.mjs` and
  `tests/sigil-agent-terminal-server.test.mjs` - inspect only if the prototype
  needs to mirror bridge response fields exactly. Avoid bridge source changes
  unless deterministic tests prove the current surface cannot represent the
  accepted live result.

## Required Behavior

Implement the smallest source/test change that lets a launch-attempt record
represent the accepted live Codex pass without touching real provider files.

The prototype should be able to consume deterministic fixture data that records
the supervised live facts:

- process-driver health and ensure facts, including session, cwd, command, and
  terminal geometry;
- one resize result with accepted `cols=100`, `rows=31`;
- `/input` diagnostics with accepted text and Enter writes;
- optional `/key Enter` diagnostics when the first Enter typed but did not
  submit;
- snapshot or summary evidence distinguishing typed, submitted, responded, and
  marker-observed states;
- separate Codex rollout/session metadata with provider session id, timestamp,
  cwd, and marker-found fact;
- Codex adapter correlation result or enough fixture data for the existing
  adapter path to produce exact provider-session-id correlation.

The output record should preserve the existing no-provider behavior, and should
add or refine fields only where they make the live result honest. Exact field
names can differ if they fit the prototype better, but the record must make
these facts machine-readable:

- `launch_intent.provider_launch_performed` is true only for an explicit
  supervised/live fixture or future approved live mode, never for the default
  no-provider harmless-command path.
- Terminal substrate includes enough geometry/resize facts to explain why the
  accepted PTY correction mattered.
- Input/submission evidence records that text was accepted, an extra
  `/key Enter` was needed, and a response marker was observed.
- Provider acceptance or Codex adapter evidence records the concrete provider
  session id `019e5107-5456-7f22-b08b-b977df1b35f4` in the fixture-backed
  happy path.
- Lifecycle state is derived from observed evidence instead of being hard-coded
  to `provider_acceptance_unobserved`. Do not mark the attempt `completed`
  until a result route or worker completion receipt exists. Suitable states are
  expected to include `provider_acceptance_unobserved`,
  `provider_session_observed`, `catalog_matched`, or `failed`, depending on the
  available evidence.
- Exact Codex adapter matches should add Codex thread refs/deeplinks to
  evidence refs as existing adapter tests already expect.
- Wrong-cwd, no-provider, stale catalog, and no-provider-session-id cases must
  keep their current conservative behavior.

Prefer fixture parsing and record-shaping changes inside the prototype over
new bridge endpoints. Do not turn this into scheduler, gateway, result-route,
or schema work.

## Scope

This slice is limited to the experimental AFK launch-attempt prototype and
focused tests. Small shared helper extraction inside the same script/test is
allowed when it reduces duplication around lifecycle derivation or fixture
normalization.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, Sigil, gateway, or any provider.
- Do not read, write, delete, move, or depend on real provider transcripts under
  `/Users/Michael/.codex` or any other provider-owned home. Use fixture Codex
  homes or inline JSON fixtures only.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, pushes, PRs, or external routes.
- Do not add a public `./aos` command yet.
- Do not add or migrate schemas.
- Do not weaken Codex adapter cwd/provider-session safeguards or treat an
  unrelated current thread as the launched session.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
git diff --check
./aos dev recommend --json --files scripts/afk-launch-attempt-prototype.mjs tests/afk-launch-attempt-prototype.test.mjs packages/host/src/codex-thread-adapter.ts packages/host/test/codex-thread-adapter.test.ts
```

If bridge source or bridge tests change, also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

Run one manual fixture-backed prototype smoke with a temp packet and fixture
data modeling the accepted Operator pass. Report key facts and remove temp
files afterward.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact fixture-backed prototype command shape;
- lifecycle derivation implemented and the happy-path lifecycle state;
- where terminal geometry, resize, input, key, response marker, provider
  session id, and Codex adapter evidence appear in the record;
- tests/checks run and exact results;
- manual smoke key facts: provider launch performed flag, lifecycle state,
  provider session id, Codex adapter status/correlation/cwd basis, thread refs,
  terminal geometry, input/key status, catalog/telemetry/result-route status;
- confirmation that no live provider was launched and no provider config,
  provider transcript, gateway state, generated committed receipt artifact,
  GitHub state, push, or PR changed;
- remaining gap before an Operator live rerun of the stabilized record path.
