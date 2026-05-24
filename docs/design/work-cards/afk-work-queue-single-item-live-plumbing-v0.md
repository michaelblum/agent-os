# Work Card: AFK Work Queue Single Item Live Plumbing V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: bridge the AFK work queue path into the existing guarded
  live launch pipeline for exactly one queue item, without running a real
  provider during the GDI round.
- Source artifact: accepted
  `docs/design/work-cards/afk-work-queue-fixture-run-receipt-v0.md`.
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-work-queue-single-item-live-plumbing-v0` from `origin/main`.
  Commit and push that GDI branch when verification passes. Do not open a PR,
  merge, mutate main, mutate GitHub issues/projects, launch real providers, or
  route follow-up work from inside the GDI round.

## Product Direction

This is still an approved AFK run over an ordered queue. Keep the language
plain: AFK authorization, AFK work queue, approved work item, live queue item.

This slice is intentionally not full multi-item live execution. It removes the
current blanket real-queue rejection by proving that a one-item queue can enter
the same guarded launch machinery as a single packet. The next Operator slice
can then live-prove one queued item before source work broadens to multiple
sequential live items.

## Goal

Support this command shape for a queue with exactly one item:

```bash
./aos dev afk-session-trigger \
  --afk-work-queue queue.json \
  --afk-authorization authorization.json \
  --afk-live-launch \
  --json \
  --out receipt.json
```

When the queue has exactly one valid item, adapt that item to the existing
single-packet guarded live launch path. Use existing bridge/provider fixture
options in tests. Do not perform a real provider launch in this GDI round.

## Required Behavior

1. One queued item:

   - Validates the queue and authorization as today.
   - Resolves the single queued packet.
   - Produces a queue-shaped receipt that records the selected item and embeds
     or references the existing single-packet live receipt facts.
   - Preserves existing start gates, result route checks, provider/dock checks,
     cleanup proof, idempotence, and duplicate/replacement behavior from the
     single-packet live path.
   - Does not use `--queue-run-fixture`; that remains a deterministic fixture
     mode.

2. Multiple queued items:

   - Keep real multi-item execution rejected in this slice.
   - Use a clear mismatch such as `multi_item_live_queue_not_implemented`.
   - Keep `provider_launch_allowed=false` for rejected multi-item live queues.

3. Hard stop behavior:

   - Any queue validation, authorization, start-gate, result-route, provider,
     dock, duplicate, or cleanup mismatch stops before launch.
   - The no-provider-launch guarantee for tests must remain intact.

4. Compatibility:

   - Existing single-packet live behavior remains unchanged.
   - Existing queue dry-run and queue fixture-run behavior remains unchanged.
   - Existing compatibility aliases may remain stable.

## Read First

- `AGENTS.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- `docs/design/work-cards/afk-work-queue-dry-run-validation-v0.md`
- `docs/design/work-cards/afk-work-queue-fixture-run-receipt-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/afk-session-trigger-prototype.test.mjs,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/work-cards/afk-work-queue-dry-run-validation-v0.md,docs/design/work-cards/afk-work-queue-fixture-run-receipt-v0.md
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

- Do not implement multi-item real queue execution in this slice.
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

- one-item queue live path with existing bridge/provider/cleanup fixtures
  completes through the guarded single-packet path;
- one-item queue live path with duplicate accepted receipt does not relaunch;
- one-item queue live path with cleanup failure reports cleanup unverified;
- multi-item queue live path without fixture rejects before launch;
- queue dry-run and fixture-run tests still pass.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact one-item live queue command shape;
- receipt shape summary and compatibility decision;
- deterministic verification commands and results;
- statement confirming no real provider launch occurred and hard boundaries
  were respected.
