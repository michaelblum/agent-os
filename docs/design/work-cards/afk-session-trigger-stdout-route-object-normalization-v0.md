# Work Card: AFK Session Trigger Stdout Route Object Normalization V0

**Status:** Accepted 2026-05-24

## Result

- Foreman review: accepted.
- Branch/ref gates passed on
  `gdi/afk-session-trigger-stdout-route-object-normalization-v0` at
  `198117a63f1af7040c7b22f4c660ede922c28586`, based on
  `fe12b509d95e33044b3761671dd2fa1278fe6e24`.
- Diff was scoped to:
  - `scripts/afk-launch-attempt-prototype.mjs`;
  - `scripts/afk-session-trigger-prototype.mjs`;
  - `tests/afk-launch-attempt-prototype.test.mjs`;
  - `tests/afk-session-trigger-prototype.test.mjs`.
- Behavior accepted: both AFK prototypes now normalize stdout route-object
  shorthands to `{ "kind": "local_artifact_path", "ref": "stdout" }` for:
  `{ "kind": "stdout" }`, `{ "ref": "stdout" }`, `{ "path": "stdout" }`, and
  `{ "artifact_path": "stdout" }`.
- Unsupported/external objects remain explicit and non-completed, including
  arbitrary non-stdout route objects and external route kinds such as
  `gateway_notifier`.
- Verification rerun by Foreman passed:
  - `./aos ready` returned
    `ready=true mode=repo daemon=reachable tap=active`;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 24/24
    passing;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 50/50
    passing;
  - `git diff --check origin/main...HEAD`.
- No live provider launch, transcript body read, provider store/catalog/telemetry
  mutation, gateway/dock runtime mutation, GitHub issue/PR/main mutation, main
  merge, PR creation, external notifier, durable work/evidence record,
  unsupervised trigger, or non-local async routing occurred during this GDI
  round.
- Follow-up routed:
  `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make stdout result-route object shorthand deterministic for
  the AFK prototypes, so a local stdout route object is either normalized to the
  existing `local_artifact_path` stdout route or rejected with a clearer
  contract diagnostic before the next live Operator proof.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`
  - `docs/design/work-cards/afk-session-trigger-local-result-route-delivery-v0.md`
  - `docs/design/work-cards/afk-session-trigger-result-route-override-normalization-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
  - accepted live proof head:
    `d629afa5a40ce386b462775b32bfbec3016d1b4b`
- Branch/output expectation: create
  `gdi/afk-session-trigger-stdout-route-object-normalization-v0` from
  `origin/main`. Commit and push that GDI branch when verification passes. Do
  not open a PR, merge, mutate main, mutate GitHub issues/projects, or broaden
  into external publication.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, live proof artifacts, or prior implementation state.
Read and rediscover before editing.

## Foreman Review Finding

The 2026-05-24 Operator headless scheduler proof passed the provider and cleanup
gate, but surfaced a route-shape compatibility gap:

```text
result_route.status=unsupported
failure.code=result_route_unsupported
```

The route was intended to be the card's "one local stdout route", but it was
represented as a stdout route object that the current normalizer did not treat
as the existing local stdout delivery shape.

Current accepted behavior already supports:

- string route entries such as `result_route: "stdout"`;
- CLI override `--result-route stdout`;
- explicit packet objects:

```json
{ "kind": "local_artifact_path", "ref": "stdout" }
```

Current accepted behavior also intentionally keeps external/unsupported objects
explicit and non-completed, such as:

```json
{ "kind": "gateway_notifier", "ref": "slack-thread-123" }
```

The gap is narrower: a local stdout shorthand object should not accidentally
look like a failed external route in a live receipt.

## Goal

Normalize local stdout route-object shorthand into the existing
`local_artifact_path` stdout route, with tests that prove unsupported external
objects remain unsupported.

Choose this specific policy unless source reading proves it is unsafe:

- `{ "kind": "stdout" }` normalizes to
  `{ "kind": "local_artifact_path", "ref": "stdout" }`;
- `{ "ref": "stdout" }` normalizes to
  `{ "kind": "local_artifact_path", "ref": "stdout" }`;
- `{ "path": "stdout" }` and `{ "artifact_path": "stdout" }` normalize only if
  the existing classifier already treats those fields as a route ref;
- arbitrary object routes without `kind=local_artifact_path` and without an
  exact stdout ref remain unsupported;
- external/object routes such as `gateway_notifier` remain unsupported.

If GDI finds a stronger reason to keep stdout route objects unsupported, do not
implement a behavior change. Instead, update the packet/work-card wording and
tests so the failure diagnostic says the exact allowed shape:

```json
{ "kind": "local_artifact_path", "ref": "stdout" }
```

Report that as a failed/stopped correction with evidence. Do not silently leave
the ambiguity.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`
- `docs/design/work-cards/afk-session-trigger-local-result-route-delivery-v0.md`
- `docs/design/work-cards/afk-session-trigger-result-route-override-normalization-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main d629afa5a40ce386b462775b32bfbec3016d1b4b
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

- `scripts/afk-session-trigger-prototype.mjs`
  - `normalizeResultRoutes()`;
  - `classifyLocalResultRoutes()`;
  - final stdout/`--out` result-route classification.
- `scripts/afk-launch-attempt-prototype.mjs`
  - same route normalization/classification behavior for launch-attempt
    records.
- `tests/afk-session-trigger-prototype.test.mjs`
  - accepted local stdout route tests and unsupported route tests.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - accepted launch-attempt local route and unsupported route tests.

## Required Behavior

- Preserve all accepted local route behavior:
  - `result_route: "stdout"` completes when the receipt is emitted to stdout;
  - `--result-route stdout` completes when the receipt is emitted to stdout;
  - `{ "kind": "local_artifact_path", "ref": "stdout" }` completes when the
    receipt is emitted to stdout;
  - local `--out` delivery remains confirmed only when the file write is
    confirmed.
- Normalize local stdout route-object shorthand according to the policy in this
  card, or stop with a clear diagnostic/docs-only correction if that policy is
  unsafe after source reading.
- Preserve unsupported/external route behavior. Do not let missing/alternate
  object shape normalization accidentally turn gateway, Slack, GitHub, broker,
  or other external routes into local artifact routes.
- Keep result-route delivery status independent from provider acceptance,
  scheduler lifecycle, and top-level receipt status.
- Apply consistent normalization to both prototypes where they share the same
  route semantics.

## Hard Boundaries

- Do not implement gateway/broker integration-job start/complete/fail routes.
- Do not implement Slack, Foreman inbox, GitHub issue/PR comment, or external
  notifier routes.
- Do not implement durable work records or evidence records.
- Do not implement unsupervised triggers.
- Do not run live Codex/provider launches.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not remove or relax `--i-am-present`.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

If implementation unexpectedly touches host/gateway code, also run:

```bash
cd packages/host && npm test
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact stdout route-object behavior chosen;
- receipt examples for accepted stdout shorthand objects;
- proof unsupported/external route objects remain non-completed;
- remaining next slice recommendation, expected: warm-dock GDI reuse proof;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, external notifier,
  durable work/evidence record, unsupervised trigger, or non-local async routing
  occurred beyond the expected GDI branch push.
