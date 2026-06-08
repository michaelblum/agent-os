# PR392 Next Breakage Inventory

## Tracker

- Source inventory: `BROKE.md`
- Prior correction: PR #394, merged to `main` at `7c93b35ca4eb7c4c69f6439b7d4b6eb490b39425`
- Transfer kind: Implementer round, validation only
- Branch/base: `main`, tracking `origin/main`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Refresh the PR #392 breakage inventory after the renderer correction. Confirm the remaining deterministic test surfaces that were not part of the renderer acceptance pass, update `BROKE.md` with exact evidence, and classify any failures into the next smallest follow-up slice.

This is an inventory slice, not an implementation slice. Do not fix failures unless Foreman explicitly routes a correction card afterward.

## Read First

- `AGENTS.md`
- `BROKE.md`
- `docs/design/work-cards/pr392-renderer-breakage-correction-v0.md`

## Rediscover State

```bash
git status --short --branch
git log -1 --oneline
```

Expected starting point:

- Branch is `main`.
- `origin/main` includes PR #394 merge commit `7c93b35ca4eb7c4c69f6439b7d4b6eb490b39425`.
- There may be unrelated local `.codex/config.toml` dirt from Foreman's environment; do not modify or revert it.

## Current Evidence

- `node --test tests/renderer/*.test.mjs` passes after PR #394: 455/455.
- `BROKE.md` already records broad passing evidence for toolkit, schemas, gateway, and host package tests from the original inventory.
- The earlier daemon broad-suite timing failure did not reproduce serially in the renderer correction acceptance card.

## Required Inventory

Run these deterministic checks from `main`:

```bash
node --test tests/daemon/*.test.mjs
node --test tests/*.test.mjs
```

Then decide whether any existing `BROKE.md` pass evidence is stale enough to rerun within this same validation-only slice. Prefer bounded verification over exhaustive reruns. If runtime or duration becomes unreasonable, stop and report the exact command, elapsed point, and last visible output.

## Update Contract

Update `BROKE.md` so it clearly distinguishes:

- resolved renderer inventory after PR #394;
- current daemon/top-level deterministic inventory from this slice;
- any remaining known breakages, with exact command, pass/fail count, failing test names, and first assertion/error;
- any likely environmental or load-sensitive failures, only when supported by rerun evidence.

If everything passes, say so plainly and add a short "Next Inventory Candidate" section naming the next bounded surface Foreman should route, if one remains.

## Scope

- Validation and documentation only.
- Owned output should normally be limited to `BROKE.md`.
- Do not edit implementation code.
- Do not modify `.codex/config.toml`.
- Do not run live AOS/HITL checks; this slice is deterministic Node/package evidence.

## Stop Conditions

Stop and report when:

- the required inventory commands pass and `BROKE.md` is updated;
- a deterministic failure is captured with enough detail for a correction card;
- a command hangs or becomes unbounded;
- local state blocks clean validation.

## Verification

After editing `BROKE.md`, run:

```bash
git diff --check -- BROKE.md
```

Do not rerun implementation test suites solely to prove a Markdown-only update unless the evidence in `BROKE.md` would otherwise be stale.

## Completion Report

Return:

- Commands run and exact pass/fail counts.
- `BROKE.md` sections changed.
- Any deterministic failures with exact failing test names and first assertion/error.
- Whether local `.codex/config.toml` remained untouched.
- Recommended next slice, if any.
