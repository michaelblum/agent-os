# Work Card: AFK Sleep Lease Live Result Route Delivery Correction V0

**Status:** Accepted

## Acceptance Result

Accepted on `main` through merge commit
`21788bfbcfe657dc7ce435b2ce798662926dc18e`.

Correction head:
`3449c80b1a53497bbe86313f107c3e006ec1e294`.

Foreman verified that sleep-lease live launch now rejects
`local_artifact_path` result routes that cannot be delivered by the command's
confirmed `--out` write. A non-matching local artifact route rejects before
launch with `sleep_lease_live_result_route_undeliverable`,
`dispatch.provider_launch_allowed=false`, `launch_attempt_id=not_attempted`,
terminal substrate `not_attempted`, provider acceptance `not_attempted`, and
cleanup `not_attempted`.

Accepted routes remain:

- stdout, including accepted stdout shorthand objects;
- `local_artifact_path` whose resolved ref matches the resolved `--out` path.

Acceptance gates passed:

- `./aos ready`: `ready=true mode=repo daemon=reachable tap=active`;
- `node --test tests/afk-session-trigger-prototype.test.mjs`: 43/43 pass;
- `node --test tests/afk-launch-attempt-prototype.test.mjs`: 50/50 pass;
- `bash tests/dev-workflow-router.sh`: pass;
- `bash tests/help-contract.sh`: pass;
- `./aos dev build --no-restart`: pass / up to date;
- `git diff --check`: pass;
- targeted `sleep-lease live launch` tests: 7/7 pass;
- manual non-matching local artifact route smoke: pass.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: tighten sleep-lease live result-route start gates so a
  local artifact route that cannot be delivered by the command's confirmed
  `--out` write cannot launch a provider.
- Source artifacts:
  - `docs/design/work-cards/afk-sleep-lease-unattended-live-mode-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: origin/gdi/afk-sleep-lease-unattended-live-mode-v0`
  - `required_start_ref: origin/gdi/afk-sleep-lease-unattended-live-mode-v0`
  - rejected head under review:
    `f5f6a65bdf894fab4c0632427b3e2954d19fcfbb`
- Branch/output expectation: update the existing
  `gdi/afk-sleep-lease-unattended-live-mode-v0` branch or create a correction
  branch from it. Commit and push when verification passes. Do not open a PR,
  merge, mutate main, mutate GitHub issues/projects, start live providers, or
  route follow-up work.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, provider state, current CLI behavior, or prior sleep-lease details.
Read and rediscover before editing.

## Foreman Review Finding

Foreman did not accept
`gdi/afk-sleep-lease-unattended-live-mode-v0` at
`f5f6a65bdf894fab4c0632427b3e2954d19fcfbb`.

The implementation adds the expected command shape and most start gates, but
one result-route gate is too loose for sleep-lease live launch.

Manual fixture-backed smoke:

- packet `result_route`:
  `{ "kind": "local_artifact_path", "ref": "<tmp>/not-output.json" }`;
- lease `result_route`: `"<tmp>/not-output.json"`;
- command `--out`: `"<tmp>/output.json"`;
- action: `--sleep-lease-live-launch`;
- fixture-backed bridge/cleanup, no real provider.

Observed receipt summary:

```json
{
  "provider_launch_allowed": true,
  "result_route_status": "failed",
  "result_route_failure": ["result_route_write_not_confirmed"]
}
```

The current start gate checks only that the packet route is a
`local_artifact_path` with a string ref. The existing result-route classifier
can complete a local artifact route only when the route ref resolves to the
confirmed `--out` path, or when the route is stdout. Therefore this should be a
pre-launch rejection, not a launched attempt followed by a failed result route.

## Goal

Make sleep-lease live launch reject result routes that cannot be delivered by
the command's local output behavior before any provider launch attempt is
created.

## Required Behavior

- Preserve the accepted CLI shape:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --sleep-lease <lease.json> \
  --sleep-lease-live-launch \
  --json \
  --out <receipt.json>
```

- For `--sleep-lease-live-launch`, result routes are compatible only when every
  configured route can be completed by the existing classifier:
  - `stdout`, including accepted stdout shorthand objects; or
  - `local_artifact_path` whose resolved `ref` / `path` / `artifact_path`
    equals the resolved `--out` path.
- A `local_artifact_path` route with a ref different from `--out` must reject
  before launch with a named mismatch, such as
  `sleep_lease_live_result_route_undeliverable`.
- Rejected route delivery gates must produce:
  - top-level `status="rejected"`;
  - `scheduler.lease.status="rejected"` or another existing rejected lease
    summary;
  - `dispatch.provider_launch_allowed=false`;
  - terminal substrate `not_attempted`;
  - no launch attempt id;
  - no provider acceptance observation;
  - final `result_route` receipt may still report the classifier failure, but
    the launch must already have been blocked.
- Preserve accepted stdout behavior.
- Add an accepted fixture-backed test for a local artifact route whose ref
  exactly matches `--out`, with the lease result route matching that ref.
- Preserve all other sleep-lease live start gates, duplicate handling,
  pre-launch/final `--out` behavior, and existing dry-run / supervised-live /
  warm-reuse behavior.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-sleep-lease-unattended-live-mode-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/afk-sleep-lease-unattended-live-mode-v0 f5f6a65bdf894fab4c0632427b3e2954d19fcfbb
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,docs/design/work-cards/afk-sleep-lease-unattended-live-mode-v0.md
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

## Hard Boundaries

- Do not start live providers, tmux sessions, terminal bridges, Agent Terminal
  surfaces, or live schedulers.
- Do not change the accepted sleep-lease live command spelling except for this
  route-delivery gate.
- Do not remove or relax `--i-am-present` for existing supervised live mode.
- Do not enable queues, automatic follow-up card selection, branch push, PR
  creation, GitHub issue mutation, Slack/gateway notification, or external
  publication.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  follow-up work.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
git diff --check
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact route-delivery gate behavior after the fix;
- rejected non-matching local artifact route example and mismatch name;
- accepted matching `--out` local artifact route example;
- deterministic verification commands and results;
- explicit statement that no real provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, external notifier, durable work/evidence
  record beyond temp/local `--out`, unattended live trigger, or follow-up
  routing occurred beyond the expected GDI branch push.
