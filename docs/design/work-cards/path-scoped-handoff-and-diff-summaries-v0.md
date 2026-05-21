# Path-Scoped Handoff And Diff Summaries V0

## Tracker

- Epic: #223 AOS Surface System
- Source queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- Checkpoint PR: #307 Surface Stack V0 checkpoint
- Preceding follow-up:
  `docs/design/work-cards/compact-real-input-scenario-output-v0.md`
- Draft evidence to classify:
  `.docks/gdi/skills/work-retrospective/SKILL.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
issue, or prior implementation state. Read and rediscover before editing. The
branch is expected to still have unrelated local state such as `.vscode/` and a
dock-local retrospective skill edit. Classify that state; do not stage it unless
this slice intentionally retains or amends it.

## Goal

Make narrow GDI completion reports and Foreman handoffs easier to review in a
dirty worktree by documenting a lightweight path-scoped summary convention.

This is a small docs/governance slice, not a new harness. The convention should
help GDI report exactly what changed, what was verified, and what unrelated
dirty state remains without turning every small fix into a heavy template.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/recipes/gdi-work-card-authoring.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/design/work-cards/surface-stack-integration-checkpoint-hygiene-v0.md`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- `.docks/gdi/skills/work-retrospective/SKILL.md`

## Rediscover State

Run:

```bash
git status --short --branch
git diff --stat
git diff -- .docks/gdi/skills/work-retrospective/SKILL.md
./aos dev recommend --json
rg -n "Completion Report|path-scoped|dirty|unrelated|worktree|verification|handoff|diff summary|retrospective" AGENTS.md .docks/foreman/AGENTS.md docs/recipes docs/design/work-cards .docks/gdi/skills/work-retrospective/SKILL.md
```

This slice does not need `./aos ready` unless the chosen verification path or
changed docs require runtime examples. If `./aos dev recommend --json` points to
runtime checks, follow it.

## Required Work

### 1. Classify Existing Draft Evidence

The dirty `.docks/gdi/skills/work-retrospective/SKILL.md` appears to add a temp
artifact path/readback convention for GDI retrospectives. Decide whether that is
part of this slice:

- retain or amend it if the dock skill is the correct local contract for
  retrospective artifacts;
- supersede it with provider-neutral recipe text if the behavior belongs in
  `docs/recipes/`;
- leave it unstaged and explicitly report why if it is unrelated or needs human
  review.

Do not silently commit dock-local skill edits just to clean the tree.

### 2. Document The Lightweight Convention

Add or amend repo docs so a completion report for non-trivial GDI work includes:

- path-scoped changed files;
- exact verification commands and pass/fail results;
- live AOS readiness or the explicit reason live checks were skipped;
- known unrelated dirty state;
- artifact paths for large proof payloads when applicable;
- remaining follow-up recommendation, if one exists.

Keep the convention short. It should be a default reporting shape for reviewable
work, not a mandatory bureaucratic form for tiny one-line fixes.

### 3. Clarify Foreman Handoff Expectations

If needed, update Foreman-specific routing language so future work cards and
handoffs ask for the path-scoped summary only when it helps review. Avoid
duplicating the same long checklist across root instructions, Foreman dock
instructions, and recipes.

### 4. Update The Retrospective Queue If Appropriate

If this is the last queued retrospective follow-up, either mark that in the
queue or add a short note that the queue's earlier items have been routed and
completed on PR #307. Do not rewrite the queue into a changelog unless it is the
smallest clear way to prevent stale "next follow-up" recommendations.

## Scope

This is docs/governance and dock-local workflow hygiene. Likely files are:

- `docs/recipes/gdi-work-card-authoring.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/skills/work-retrospective/SKILL.md`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

Choose the smallest write set after inspection.

## Hard Boundaries

- Do not add a new reporting framework or schema.
- Do not force a heavy template on tiny fixes.
- Do not edit root `AGENTS.md` unless a repo-wide contract genuinely changes.
- Do not stage `.vscode/`.
- Do not revert or discard unrelated dirty state.
- Do not reopen completed runtime follow-ups such as mark contract, canvas
  reload, subject-family cleanup, or compact real-input output.

## Verification

Minimum:

```bash
git diff --check
./aos dev recommend --json
```

If only Markdown/dock skill docs changed, add a focused grep or readback check
that proves the convention is present in the right source of truth. If a shell
or scripted skill file changes, run the smallest syntax check available.

## Completion Report

Include:

- files changed;
- whether the dock-local retrospective skill edit was retained, amended,
  superseded, or left unstaged;
- exact convention wording or section added;
- tests/checks run and results;
- remaining dirty state;
- whether the retrospective follow-up queue is now complete or what remains.
