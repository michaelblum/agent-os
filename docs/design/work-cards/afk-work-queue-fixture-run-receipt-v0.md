# Work Card: AFK Work Queue Fixture Run Receipt V0

**Status:** Accepted

## Foreman Acceptance

Accepted on 2026-05-24.

- GDI implementation branch: `gdi/afk-work-queue-fixture-run-receipt-v0`
- GDI implementation commit: `53287f52e71ba06dfa6406329385bbffb876a4ad`
- Main merge commit: `4cd87e944787082ace17a78891a5a2385ee00907`

Accepted behavior:

- Command shape:
  `./aos dev afk-session-trigger --afk-work-queue queue.json --afk-authorization authorization.json --afk-live-launch --queue-run-fixture fixture.json --json --out receipt.json`
- Fixture JSON uses a matching `queue_id` and ordered per-item fixture entries.
- Receipt `record_type` is `aos.afk_work_queue_fixture_run`.
- Top-level `status="completed"` only when all fixture items complete with
  verified cleanup.
- Fixture-backed queue receipts keep `provider_launch_allowed=false` and
  terminal state `not_attempted`.
- The run stops at the first `failed` or `blocked` item or unverified cleanup.
- Real queue execution without a fixture remains rejected before launch.

Foreman verification:

- `./aos dev build`: passed.
- `./aos ready --post-permission`: ready.
- `node --test tests/afk-session-trigger-prototype.test.mjs`: 58/58 passed.
- `node --test tests/schemas/dev-workflow-rules.test.mjs
  tests/schemas/dev-active-profile.test.mjs
  tests/schemas/dev-workflow-profiles.test.mjs`: 10/10 passed.
- `bash tests/dev-workflow-router.sh`: passed.
- `bash tests/help-contract.sh`: passed.
- `bash tests/dev-audit.sh`: passed.
- `git diff --check`: passed.
- Foreman CLI smoke returned
  `record_type="aos.afk_work_queue_fixture_run"`, `status="completed"`,
  `item_count=2`, `provider_launch_allowed=false`, terminal states
  `not_attempted`, and zero mismatches.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add a deterministic fixture-backed AFK work queue run
  receipt that proves ordered queue advancement and stop behavior without
  launching real providers.
- Source artifact: accepted
  `docs/design/work-cards/afk-work-queue-dry-run-validation-v0.md`.
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create `gdi/afk-work-queue-fixture-run-receipt-v0`
  from `origin/main`. Commit and push that GDI branch when verification passes.
  Do not open a PR, merge, mutate main, mutate GitHub issues/projects, launch
  real providers, or route follow-up work from inside the GDI round.

## Product Direction

This is still just an approved AFK run over an ordered queue. Keep the naming
plain:

- AFK authorization
- AFK work queue
- approved work item
- fixture run

Do not add another branded concept.

## Goal

After a queue validates, prove the scheduler can walk the ordered work items,
record per-item outcomes, and stop on the first failure, using only deterministic
fixtures.

Target command shape:

```bash
./aos dev afk-session-trigger \
  --afk-work-queue queue.json \
  --afk-authorization authorization.json \
  --afk-live-launch \
  --queue-run-fixture fixture.json \
  --json \
  --out receipt.json
```

This is not real live queue execution. Without `--queue-run-fixture`,
`--afk-work-queue --afk-live-launch` should reject before any provider launch
with a clear message that real queue execution is not implemented in this
slice.

## Fixture Shape

Use a simple local JSON object:

```json
{
  "queue_id": "operator-afk-work-queue-example",
  "items": [
    {
      "item_id": "one",
      "status": "completed",
      "provider_session_id": "fixture-one",
      "cleanup": "verified"
    },
    {
      "item_id": "two",
      "status": "completed",
      "provider_session_id": "fixture-two",
      "cleanup": "verified"
    }
  ]
}
```

Required validation:

- fixture is a local file path and a JSON object;
- fixture `queue_id` matches the queue `queue_id`;
- fixture item IDs match the queue order exactly;
- allowed item statuses are finite and explicit, for example `completed`,
  `failed`, and `blocked`;
- cleanup must be `verified` for completed items;
- the run stops at the first non-completed item or cleanup mismatch;
- no real provider, terminal, gateway, notifier, or result route is launched.

## Required Receipt Behavior

Emit a JSON receipt with:

- `record_type="aos.afk_work_queue_fixture_run"`;
- top-level `status="completed"` only when every item fixture is completed with
  verified cleanup;
- `provider_launch_allowed=false` because this is fixture-backed only;
- queue id, item count, max item cap, and ordered per-item run summaries;
- each item summary includes item id, packet ref, work ref, packet id, fixture
  status, provider session id if supplied, cleanup status, and terminal state
  `not_attempted`;
- scheduler lifecycle and dispatch fields make clear this is a fixture run;
- deterministic mismatch classes for missing fixture, invalid fixture shape,
  queue ID mismatch, fixture order mismatch, failed/blocked item, cleanup
  unverified, and attempted real queue execution without a fixture.

Keep existing queue dry-run and single-packet behavior stable.

## Read First

- `AGENTS.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- `docs/design/work-cards/afk-work-queue-dry-run-validation-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/afk-session-trigger-prototype.test.mjs,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/work-cards/afk-work-queue-dry-run-validation-v0.md
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

- Do not implement real queue execution in this slice.
- Do not perform a real provider launch.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  another session from inside the GDI round.

## Verification

Run the checks recommended by `./aos dev recommend`. Expected minimum:

```bash
./aos dev build
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
git diff --check
```

Add tests for:

- fixture run completes two valid queue items;
- fixture run stops on the first failed or blocked item;
- fixture run rejects queue ID mismatch;
- fixture run rejects fixture item order mismatch;
- `--afk-work-queue --afk-live-launch` without a fixture rejects before launch;
- existing queue dry-run behavior remains unchanged.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact `--queue-run-fixture` command shape and fixture JSON shape;
- receipt shape summary;
- deterministic verification commands and results;
- statement confirming the hard boundaries were respected.
