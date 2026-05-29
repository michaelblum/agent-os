# AOS Dock Run Provenance Ledger V0 Dry-Run Correction

## Recipient

GDI

## Transfer Kind

Correction round

## Source Artifact

- Reviewed completion report: `d8dd1fa001ce35f18265525390143591b02299ae`
- Prior correction card: `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction.md`
- Foreman review profile: thermo-nuclear code quality review

## Branch / Base

- branch_from: `gdi/aos-dock-run-provenance-ledger-v0`
- required_start_ref: `d8dd1fa001ce35f18265525390143591b02299ae`
- output_branch: keep working on `gdi/aos-dock-run-provenance-ledger-v0`
- publication: do not push or open a PR unless Foreman explicitly asks later

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider transcript, dock state, or prior implementation state. Read and
rediscover before editing.

## Goal

Make provenance prune dry-run mode genuinely side-effect-free while preserving
the intended retained-summary behavior before apply deletes raw events.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0-correction.md`
- `scripts/aos-provenance-ledger.mjs`
- `tests/provenance-ledger.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git diff --stat 3c95a90593eb7895ac9877419f52e05782b587df..HEAD
./aos dev recommend --json --files scripts/aos-provenance-ledger.mjs tests/provenance-ledger.sh
```

This slice is deterministic command/storage/test work. Do not spend time on
live AOS readiness unless a chosen verification command unexpectedly requires
it.

## Review Finding To Fix

`scripts/aos-provenance-ledger.mjs:912` calls `materializeSummariesForEvents`
inside `prunePlan`, before `prune` has distinguished `--dry-run` from `--apply`.
That makes dry-run mutate ledger state by writing summary files.

Foreman reproduced the defect on `d8dd1fa001ce35f18265525390143591b02299ae`:

```text
before=1 after=2
repo/provenance/repos/<repo-key>/docks/gdi/events/2026-05-29.jsonl
repo/provenance/repos/<repo-key>/docks/gdi/summaries/2026-05-29.json
```

Required correction:

- `./aos dev provenance prune --dry-run` must not create, update, delete, or
  otherwise mutate any ledger file.
- `./aos dev provenance prune --apply` must still materialize retained daily
  summaries before deleting raw event partitions.
- Keep the implementation simple enough to scan. `scripts/aos-provenance-ledger.mjs`
  is already 999 lines after the previous correction; avoid adding another
  layer of ad-hoc branches. Prefer a small explicit plan/apply boundary where
  dry-run computes candidates and apply performs mutations.
- Add a regression test that records at least one event, captures the fixture
  file list or count, runs prune dry-run, and proves the fixture state is
  unchanged.
- Keep the retained-summary-after-apply test from the prior correction.

## Scope And Boundaries

- Stay within `scripts/aos-provenance-ledger.mjs` and
  `tests/provenance-ledger.sh` unless `./aos dev recommend` points to a directly
  required adjacent file.
- Do not resume selection-mode work-card cleanup.
- Do not push, open a PR, or mutate GitHub state.
- Do not convert this into a broad provenance module split unless it is the
  smallest way to make the dry-run/apply boundary clearer.

## Verification

Run at minimum:

```bash
git diff --check
bash tests/provenance-ledger.sh
bash tests/dev-workflow-router.sh
node --test tests/schemas/aos-dock-provenance-ledger-v0.test.mjs
```

If `./aos dev recommend --json --files scripts/aos-provenance-ledger.mjs tests/provenance-ledger.sh`
recommends additional focused checks, run those too.

## Completion Report

Report:

- files changed;
- exact dry-run side-effect semantics after the correction;
- exact apply summary-materialization semantics after the correction;
- regression test added for dry-run immutability;
- exact verification commands and pass/fail results;
- local-only state, including unrelated untracked work cards;
- any remaining follow-up that should not block V0 acceptance.
