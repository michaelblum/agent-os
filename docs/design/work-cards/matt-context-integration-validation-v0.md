# Work Card: matt-context-integration-validation-v0

**Status:** Ready for validation
**Owner:** GDI

## Tracker

Second-pass validation for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`

This validates whether agent-os partially adopted Matt Pocock's
`/grill-with-docs` and `CONTEXT.md` model without the setup, context-map, and
maintenance surfaces that make it reliable in a large monorepo.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Validate the Matt context integration audit against the current agent-os repo
and the latest local `mattpocock-skills` checkout. Amend the audit only where
the evidence requires it, and leave a per-finding validation record that Foreman
can use to choose the next implementation slice.

This is a validation/documentation slice, not a root-doc implementation pass.

## Read First

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `/Users/Michael/Code/mattpocock-skills/README.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/SKILL.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/domain.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/grill-with-docs/SKILL.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/grill-with-docs/CONTEXT-FORMAT.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/improve-codebase-architecture/SKILL.md`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

Inspect the local Matt skills checkout without editing it:

```bash
git -C /Users/Michael/Code/mattpocock-skills status --short --branch
git -C /Users/Michael/Code/mattpocock-skills log -1 --oneline
```

The Matt checkout may have unrelated untracked `.DS_Store` files. Do not delete
or stage them.

## Branch/Base

branch_from: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`
required_start_ref: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`

This work card and the audit note live on the branch above, not on
`origin/main`. Do not reset to `origin/main` for this slice. Use
`gdi/matt-context-integration-validation-v0` as the output branch if creating a
separate GDI branch.

## Validation Questions

Validate these claims with concrete file/path evidence:

- Does Matt's setup flow expect `docs/agents/domain.md` and an `## Agent skills`
  block before the engineering skills are used?
- Does Matt's domain model distinguish single-context `CONTEXT.md` from
  multi-context `CONTEXT-MAP.md`?
- Does Matt's `/grill-with-docs` model treat `CONTEXT.md` primarily as a
  glossary, and does agent-os's root `CONTEXT.md` exceed that boundary?
- Does agent-os currently lack `docs/agents/`, `CONTEXT-MAP.md`, and a context
  maintenance SOP?
- Are the named sibling-doc conflicts still real after the recent
  `ARCHITECTURE.md` / `CONTEXT.md` update?
- Is the ADR namespace split between `docs/adr/` and `docs/decisions/` material
  to Matt-style domain setup?
- Are there additional high-value misses not captured in the audit, especially
  under `.docks/`, subtree `AGENTS.md` files, `docs/api/`, or `docs/recipes/`?

## Required Output

Edit `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`.

If a finding is confirmed, add a concise validation note. If a finding is
wrong, overstated, or incomplete, amend the finding text and record why. Add a
short "Recommended Next Slice" section naming the smallest docs-only
implementation pass that should follow validation.

## Scope

Edit only:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not implement `docs/agents/domain.md`, `CONTEXT-MAP.md`, SOPs, or root doc
  changes in this slice.
- Do not change source behavior, schemas, tests, fixtures, or runtime behavior.
- Do not open or update GitHub issues or PRs.
- Do not edit `/Users/Michael/Code/mattpocock-skills`.
- Do not delete unrelated untracked files in the Matt skills checkout.

## Verification

Run:

```bash
git diff --check
git diff -- docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md
```

No Swift rebuild and no live AOS smoke are required for this docs-only
validation slice.

## Completion Report

Report:

- files changed;
- per-finding validation result;
- any amended or newly added findings;
- the recommended next implementation slice;
- exact verification commands and pass/fail results;
- whether source behavior, schemas, tests, fixtures, GitHub issues, or PRs were
  untouched;
- local-only state or unrelated dirty files.
