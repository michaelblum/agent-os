# Work Card: AFK Session Trigger Local Result Route Delivery V0

**Status:** Accepted with compatibility follow-up 2026-05-23

## Result

- Foreman review: accepted for object-shaped local result routes.
- Branch/ref gates passed on
  `gdi/afk-session-trigger-local-result-route-delivery-v0` at
  `319e46db15fe6973dd0ead5784e0bd3e1ff64ab7`, based on
  `c6e31b77a13c02d9282d53fb3041abdd3153d436`.
- Diff was scoped to:
  - `scripts/afk-launch-attempt-prototype.mjs`;
  - `scripts/afk-session-trigger-prototype.mjs`;
  - `tests/afk-launch-attempt-prototype.test.mjs`;
  - `tests/afk-session-trigger-prototype.test.mjs`.
- Behavior accepted: object-shaped `local_artifact_path` routes now record
  attempts and delivered refs for stdout and confirmed `--out` writes;
  unsupported/external route kinds remain explicit and non-completed; result
  route completion does not promote the launch-attempt lifecycle state.
- Verification rerun by Foreman passed:
  - `./aos ready` returned
    `ready=true mode=repo daemon=reachable tap=active`;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 18/18
    passing;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 37/37
    passing;
  - `git diff --check`.
- Follow-up routed: `--result-route <ref>` is still part of the command surface
  but currently normalizes a string override such as `stdout` to
  `kind=not_observed`, `ref=not_observed`, and `result_route.status=unsupported`.
  Foreman routed
  `docs/design/work-cards/afk-session-trigger-result-route-override-normalization-v0.md`
  before gateway/external route work.
- No live provider launch, transcript body read, provider store/catalog/telemetry
  mutation, gateway/dock runtime mutation, GitHub issue/PR/main mutation, main
  merge, PR creation, external notifier, durable work/evidence record,
  unsupervised trigger, or non-local async routing occurred during this slice.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: implement the first bounded async result-route slice for the
  AFK prototypes by delivering/accounting for local-only `local_artifact_path`
  routes, without adding gateway, Slack/GitHub, durable work-record, or
  unsupervised trigger behavior.
- Source artifacts:
  - `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
  - `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
  - `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
  - `docs/design/work-cards/operator-afk-dev-session-trigger-goal-prefix-provider-acceptance-live-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Branch/Base:
  - `branch_from: gdi/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0`
  - `required_start_ref: gdi/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0`
  - Accepted provider-acceptance live gate route head:
    `09b84c86dda2753f278f9a4079db13b0066a0044`
  - Accepted receipt-hygiene source head:
    `e4e029f406ae2c452ee61181d9286565d9740ae2`
  - Foreman acceptance/documentation head:
    `1a19cb894a9ea070effa2a7f73cc86709b044abb`
- Branch/output expectation: create
  `gdi/afk-session-trigger-local-result-route-delivery-v0` from the required
  start ref. Commit and push that GDI branch when verification passes under the
  active `agentic_relay` profile. Do not open a PR, merge, mutate main, mutate
  GitHub issues/projects, or broaden into external publication.

## Why This Is Now Unblocked

The previous Foreman stop point was too conservative. The active profile and
role contracts make this procedural:

- Dock persona: Foreman coordinates, GDI implements deterministic slices,
  Operator collects supervised live proof.
- Entry path: this is AOS developer plus testing, not Operator/HITL.
- Workflow profile: `agentic_relay` means GDI pushes a `gdi/*` branch and
  Foreman/review authority handles merge/publication; PR is not required.
- Workstream gate: live Codex/GDI provider acceptance and receipt hygiene are
  now accepted, so the obvious implementation follow-up is the first result
  route slice, not another human decision.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, live proof artifacts, or prior implementation state.
Read and rediscover before editing.

## Current Behavior

The prototypes already parse packet result routes and expose them in receipts,
but they leave routing unattempted:

- `scripts/afk-session-trigger-prototype.mjs` emits:
  - `result_route.status=not_attempted`;
  - `result_route.refs=<packet routes>`.
- `scripts/afk-launch-attempt-prototype.mjs` emits:
  - `result_route.status=not_attempted`;
  - `attempt_refs=[]`;
  - `delivered_refs=[]`.
- Tests currently assert `not_attempted` for local stdout routes.

This was correct while provider acceptance was blocked. It is now the next
implementation gap.

## Required Behavior

Implement a local-only result-route delivery/accounting layer for the prototype
receipts:

- Support `result_route` / `result_routes` entries with
  `kind=local_artifact_path`.
- Treat `ref=stdout` as delivered when the prototype emits the final receipt to
  stdout.
- Treat explicit local output paths, including `--out <path>` and/or a route
  `ref` that resolves to a local path, as delivered only when the file write is
  confirmed.
- Record route attempts and delivered refs in the receipt with enough detail for
  Foreman review. Prefer existing fields where present:
  - session trigger: preserve `result_route.refs`; add the smallest additional
    attempt/delivery fields needed;
  - launch attempt: use `result_route.attempt_refs` and
    `result_route.delivered_refs`.
- Mark route status as delivered/completed only for successful local deliveries.
  Keep invalid, unsupported, external, or failed routes explicit and
  non-completed.
- Preserve local-only behavior. Do not call gateway, Slack, GitHub, issue/PR
  comment, broker, or notifier routes.
- Preserve the provider/live safety envelope:
  - do not run a live provider launch in this GDI round;
  - do not read provider transcript bodies;
  - do not remove or relax `--i-am-present`;
  - do not implement unsupervised trigger execution.

## Design Constraints

- This is prototype behavior, not a schema migration.
- Keep route status vocabulary aligned with existing notes:
  - attempted;
  - delivered/completed for successful local artifact routes;
  - not_attempted where no route exists or delivery is intentionally disabled;
  - failed/unsupported with structured failure details when a configured route
    cannot be delivered.
- Route delivery must be idempotent for repeated same-output prototype runs.
  Re-emitting stdout or rewriting the explicit `--out` file in the same command
  is acceptable; do not create extra side-effect files unless explicitly routed.
- Do not make `result_route.status=completed` imply provider acceptance. It only
  means the result route was delivered. The top-level receipt status/lifecycle
  still owns work completion.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0 1a19cb894a9ea070effa2a7f73cc86709b044abb e4e029f406ae2c452ee61181d9286565d9740ae2
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

## Suggested Implementation Areas

- `scripts/afk-session-trigger-prototype.mjs`
  - parse and classify local artifact result routes after the receipt is built
    and before final output/write;
  - record stdout and `--out` delivery honestly.
- `scripts/afk-launch-attempt-prototype.mjs`
  - mirror the smallest compatible local route accounting needed by launch
    attempt receipts, or document why session-trigger owns the first route
    delivery layer and launch-attempt remains not attempted.
- `tests/afk-session-trigger-prototype.test.mjs`
  - update existing local stdout route expectations from `not_attempted` to the
    new delivered/completed shape;
  - add `--out` local artifact delivery coverage.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - add or preserve focused launch-attempt route assertions based on the chosen
    ownership boundary.

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
- Do not mutate Codex config/keymaps.
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

If implementation touches host/gateway code unexpectedly, also run:

```bash
cd packages/host && npm test
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact route behavior added;
- result-route receipt examples for `stdout` and `--out` local artifact
  delivery;
- unsupported/external route behavior;
- remaining next slice recommendation after this local-only route layer;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, external notifier,
  durable work/evidence record, unsupervised trigger, or non-local async routing
  occurred beyond the expected GDI branch push.
