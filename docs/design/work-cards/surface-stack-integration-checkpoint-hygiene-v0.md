# Surface Stack Integration Checkpoint Hygiene V0

## Tracker

- Epic: #223 AOS Surface System
- Completed V0 closure: #304, #303, #122, #120, #123, #261, #305, #118, #119
- Parked historical tracker: #45
- Source-of-truth ledger:
  `docs/design/aos-surface-stack-v0-integration-ledger.md`
- Retrospective follow-up queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

## Fresh Context Contract

Foreman starts from a fresh context window. Do not assume branch, worktree,
daemon, canvas, GitHub issue, or prior verification state. Read and rediscover
before editing. The worktree is expected to be substantially dirty from the
surface-stack workstream; do not revert unrelated changes.

## Goal

Turn the completed V0 surface-stack work into a reviewable integration
checkpoint before starting new feature slices.

This is git and verification hygiene, not new product/platform implementation.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/work-cards/surface-stack-v0-integration-closure.md`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- `docs/dev/workflow-rules.json`

## Rediscover State

Run:

```bash
git status --short --branch
git diff --stat
./aos ready
./aos dev recommend --json
gh issue view 223 --repo michaelblum/agent-os --json number,title,state,url,comments
```

If `./aos ready` reports only runtime readiness blockers, continue with
diff/classification work and report the blocker before live AOS verification.

## Required Work

### 1. Classify The Dirty Worktree

Produce a concise path-scoped map of the dirty files:

- accepted V0 implementation;
- accepted V0 tests;
- accepted V0 docs/work cards;
- retrospective follow-up cards;
- unrelated or pre-existing dirty files;
- files that need human review before commit.

Do not rely on `git status` alone. Use path-scoped `git diff --stat`,
representative diffs, and issue/work-card references to decide which changes
belong together.

### 2. Re-run The Full Branch Verification Gate

Use `./aos dev recommend --json` to select the required build/test set for the
whole dirty branch. At the time this card was written, the router saw Swift,
schema, CLI-doc, toolkit, dev-workflow, app, and shell-test classes. Expect at
least these categories unless state has changed:

```bash
bash tests/help-contract.sh
node --test tests/schemas/*.test.mjs
./aos dev build
node --test tests/schemas/dev-workflow-rules.test.mjs
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
```

Also run the focused surface-stack tests named in the ledger when they are not
already covered by the router's chosen commands.

### 3. Resolve Reviewability Blockers

Run `git diff --check`.

If the only blocker is the known pre-existing
`.docks/foreman/AGENTS.md` blank-line-at-EOF issue, fix that tiny hygiene issue
in place and rerun `git diff --check`. If new whitespace errors appear in
surface-stack files, fix them. If unrelated user-authored changes have
substantive conflicts, do not rewrite them; classify and report them.

### 4. Prepare Commit And PR Shape

Do not silently commit. Prepare an intentional checkpoint plan:

- proposed commit groups;
- exact verification evidence for each group;
- issue comments already posted;
- remaining open issue state;
- files that should stay out of the checkpoint;
- whether a PR should be opened or updated.

If the user authorizes committing, use scoped path commits and do not include
AI attribution.

## Hard Boundaries

- Do not start the retrospective implementation follow-ups in this card.
- Do not add new daemon, toolkit, Sigil, or inspector behavior.
- Do not close #223; it remains the broad Surface System epic unless the user
  explicitly asks for epic closure after reviewing remaining capability areas.
- Do not discard or revert unrelated dirty files.

## Verification

Minimum:

```bash
./aos ready
./aos dev recommend --json
git diff --check
```

Then run the router-required commands and any focused surface-stack tests needed
to support the proposed checkpoint.

## Completion Report

Include:

- dirty-worktree classification;
- commands run and exact pass/fail result;
- any runtime readiness blocker;
- whitespace/diff-check result;
- proposed commit/PR grouping;
- files intentionally left out;
- recommended next implementation card after checkpoint hygiene.
