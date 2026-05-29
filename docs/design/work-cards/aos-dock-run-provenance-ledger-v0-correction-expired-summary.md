# AOS Dock Run Provenance Ledger V0 Expired Summary Correction

## Recipient

GDI

## Transfer Kind

Correction round

## Source Artifact

- Current implementation head: `32ca5ead72f1af9647cfaffd324b97d4d2f16273`
- Original card: `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- Prior correction cards:
  - `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction.md`
  - `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction-dry-run.md`

## Branch / Base

- branch_from: `gdi/aos-dock-run-provenance-ledger-v0`
- required_start_ref: branch commit containing this card. Foreman dispatch must include the exact start commit.
- output_branch: keep working on `gdi/aos-dock-run-provenance-ledger-v0`
- publication: do not push or open a PR unless Foreman explicitly asks later

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider transcript, dock state, or prior implementation state. Read and
rediscover before editing.

## Goal

Fix provenance prune apply so it does not materialize or leave retained-summary
files that are already outside summary retention, while preserving dry-run
immutability and retained-summary behavior for raw events that are still within
the summary retention window.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction-dry-run.md`
- `scripts/aos-provenance-ledger.mjs`
- `tests/provenance-ledger.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git diff --stat 4f0d4e91004d2d5a3915766b759ca8dbb371e6ea..HEAD
./aos dev recommend --json --files scripts/aos-provenance-ledger.mjs tests/provenance-ledger.sh
```

This is deterministic command/storage/test work. Do not spend time on live AOS
readiness unless a chosen verification command unexpectedly requires it.

## Review Finding To Fix

`scripts/aos-provenance-ledger.mjs` currently computes the prune plan before
`applyPrune()` materializes summaries. On `--apply`, `applyPrune()` then calls
`materializeSummariesForEvents(options)` and deletes the raw-event candidates.

That preserves summaries for recently pruned raw events, but it also creates
summary files for raw events whose dates are already beyond
`SUMMARY_RETENTION_DAYS`. Those newly materialized summaries are not in the
precomputed prune plan, so they remain after apply.

Foreman reproduced on `32ca5ead72f1af9647cfaffd324b97d4d2f16273`:

```text
before_files=2 after_files=3 expired_summary_count=1 expired_event_count=0
```

The scenario was:

- record one raw event dated `2026-01-01`;
- run `AOS_PROVENANCE_NOW=2026-05-29T00:00:00.000Z ./aos dev provenance prune --apply`;
- raw event is deleted;
- `summaries/2026-01-01.json` is created and retained even though it is older
  than the 90-day summary retention default.

## Required Correction

- `prune --dry-run` must remain side-effect-free.
- `prune --apply` must preserve retained summaries for raw events that are
  older than raw retention but still within summary retention.
- `prune --apply` must not leave summaries whose dates are already outside
  summary retention.
- Summary cap enforcement must account for summaries created during apply, or
  the implementation must materialize only summaries that can be retained under
  the current retention/cap policy.
- Keep the plan/apply boundary easy to audit. Avoid reintroducing hook-time
  aggregate mutation.

## Suggested Test

Extend `tests/provenance-ledger.sh` with a fixture-state case:

1. Record a raw event with `AOS_PROVENANCE_NOW=2026-01-01T00:00:00.000Z`.
2. Run prune apply with `AOS_PROVENANCE_NOW=2026-05-29T00:00:00.000Z`.
3. Assert `events/2026-01-01.jsonl` is gone.
4. Assert `summaries/2026-01-01.json` does not exist.
5. Keep the existing test that a May raw event gets summarized and retained
   after raw pruning.

## Scope And Boundaries

- Stay within `scripts/aos-provenance-ledger.mjs` and
  `tests/provenance-ledger.sh` unless `./aos dev recommend` requires an adjacent
  file.
- Do not resume Selection Mode, Sigil trail, or unrelated work-card cleanup.
- Do not push, open a PR, or mutate GitHub state.

## Verification

Run at minimum:

```bash
git diff --check
bash tests/provenance-ledger.sh
bash tests/dev-workflow-router.sh
node --test tests/schemas/aos-dock-provenance-ledger-v0.test.mjs
```

If `./aos dev recommend --json --files scripts/aos-provenance-ledger.mjs tests/provenance-ledger.sh`
recommends more focused checks, run those too.

## Completion Report

Report:

- files changed;
- exact prune apply semantics after the correction;
- dry-run immutability result;
- retained-summary behavior for inside-retention and outside-retention raw
  event dates;
- exact verification commands and pass/fail results;
- local-only state, including unrelated untracked work cards;
- any remaining follow-up that should not block V0 acceptance.
