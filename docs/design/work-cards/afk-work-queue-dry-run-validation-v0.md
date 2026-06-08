# Work Card: AFK Work Queue Dry-Run Validation V0

**Status:** Accepted

## Foreman Acceptance

Accepted on 2026-05-24.

- Implementer implementation branch: `implementer/afk-work-queue-dry-run-validation-v0`
- Implementer implementation commit: `ac23815edd4b7c1303d8d7631aa80b7f91c1c4e6`
- Main merge commit: `e278b5b27ba98e1e91a372029998b305dce179c0`

Accepted behavior:

- Primary command shape:
  `./aos dev afk-session-trigger --afk-work-queue queue.json --afk-authorization authorization.json --dry-run --json --out receipt.json`
- Queue JSON shape uses a `queue_id` plus finite ordered `items` containing
  unique `item_id` values and local `packet_ref` paths.
- Receipt `record_type` is `aos.afk_work_queue_dry_run`.
- Accepted queues report `status="dry_run_ready"` and
  `provider_launch_allowed=false`.
- Per-item summaries include packet refs, packet IDs, work refs, validation
  status, authorization status, and mismatch classes.
- The queue path rejects invalid shape, too many items, duplicate item IDs,
  invalid packet refs, packet validation failures, and authorization/work-ref
  mismatches.
- Existing single-packet `--packet` behavior remains stable.

Foreman verification:

- `./aos dev build`: passed.
- `./aos ready --post-permission`: ready.
- `node --test tests/afk-session-trigger-prototype.test.mjs`: 49/49 passed.
- `node --test tests/schemas/dev-workflow-rules.test.mjs
  tests/schemas/dev-active-profile.test.mjs
  tests/schemas/dev-workflow-profiles.test.mjs`: 10/10 passed.
- `bash tests/dev-workflow-router.sh`: passed.
- `bash tests/help-contract.sh`: passed.
- `bash tests/dev-audit.sh`: passed.
- `git diff --check`: passed.
- Foreman CLI smoke with two temporary packet refs returned
  `status="dry_run_ready"`, `record_type="aos.afk_work_queue_dry_run"`,
  `item_count=2`, `provider_launch_allowed=false`, both item statuses `valid`,
  and zero mismatches.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: add deterministic dry-run validation for a small ordered
  AFK work queue so an approved AFK run is not limited to one work item.
- Source artifact: user direction on 2026-05-24: one approved task is too
  limiting; keep the AFK surface simple.
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create `implementer/afk-work-queue-dry-run-validation-v0`
  from `origin/main`. Commit and push that Implementer branch when verification passes.
  Do not open a PR, merge, mutate main, mutate GitHub issues/projects, launch
  providers, or route follow-up work from inside the Implementer round.

## Product Direction

This is still just an approved AFK run. The next capability should let the
human approve a finite ordered set of work items before stepping away.

Do not add another branded term. Use plain language:

- AFK authorization
- AFK work queue
- approved work item
- queue dry run

## Goal

Add a deterministic, no-provider-launch queue validation path to the existing
AFK session trigger prototype.

Target command shape:

```bash
./aos dev afk-session-trigger \
  --afk-work-queue queue.json \
  --afk-authorization authorization.json \
  --dry-run \
  --json \
  --out receipt.json
```

`--packet <packet.json>` remains the single-packet path. `--afk-work-queue` is
an alternative to `--packet` for dry-run queue validation only.

## Queue Shape

Use a simple local JSON object:

```json
{
  "queue_id": "operator-afk-work-queue-example",
  "items": [
    {
      "item_id": "one",
      "packet_ref": "tmp/packet-one.json"
    },
    {
      "item_id": "two",
      "packet_ref": "tmp/packet-two.json"
    }
  ]
}
```

Required validation:

- queue is a JSON object;
- `queue_id` is a non-empty string;
- `items` is a non-empty finite array;
- cap V0 at a small explicit maximum such as five items;
- every `item_id` is a non-empty unique string;
- every `packet_ref` is a local file path, not a URL, glob, command, or remote
  route;
- every packet loads and passes the existing packet validation;
- every packet work ref/source artifact is allowed by the AFK authorization;
- queue dry run rejects the whole queue if any item is invalid;
- queue dry run never launches a provider, terminal, gateway, notifier, or
  result route.

## Required Receipt Behavior

Emit a reviewable JSON receipt with:

- top-level status `dry_run_ready` only when every queue item is valid;
- `provider_launch_allowed=false`;
- queue id, item count, and per-item validation summaries;
- packet refs and work refs as bounded metadata;
- AFK authorization status reused from the existing authorization validation;
- deterministic mismatch classes for missing queue, invalid queue shape,
  too many items, duplicate item ids, invalid packet refs, packet validation
  failure, and authorization/work-ref mismatch.

Keep existing single-packet receipt behavior stable. Existing receipt fields
with old compatibility names may remain unchanged in this slice if renaming
would increase risk.

## Read First

- `AGENTS.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/afk-session-trigger-prototype.test.mjs,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Hard Boundaries

- Do not implement live queue execution in this slice.
- Do not perform a real provider launch.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  another session from inside the Implementer round.

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

- accepted queue with two valid packet refs;
- rejected queue with one invalid packet ref;
- rejected queue with duplicate item ids;
- rejected queue with a work ref not allowed by the AFK authorization;
- old single-packet `--packet` behavior unchanged.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact `--afk-work-queue` command shape and queue JSON shape;
- receipt shape summary;
- deterministic verification commands and results;
- statement confirming the hard boundaries were respected.
