# Work Card: matt-context-setup-scaffold-v0

**Status:** Ready for implementation
**Owner:** GDI

## Tracker

Implementation follow-up for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/design/work-cards/matt-context-integration-validation-v0.md`

The validated audit found that agent-os adopted the visible `CONTEXT.md` /
ADR pieces of Matt Pocock's engineering skills without the setup layer that
teaches agents how to consume those docs in this repo.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Install the first agent-os-specific Matt setup scaffold without changing source
behavior: add the repo-local `## Agent skills` pointer block and create the
`docs/agents/` consumer docs for issue tracking, triage label vocabulary, and
domain/context docs.

This is a setup/adaptation slice. It should teach future agents where to look;
it should not perform the larger `CONTEXT-MAP.md`, stale-doc repair, ADR
namespace cleanup, or context SOP work yet.

## Read First

- `AGENTS.md`
- `CLAUDE.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/SKILL.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/domain.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/triage-labels.md`

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

This work card and the validated audit live on the branch above, not on
`origin/main`. Do not reset to `origin/main` for this slice. Use
`gdi/matt-context-setup-scaffold-v0` as the output branch if creating a separate
GDI branch.

## Required Behavior

Create these docs surfaces:

- Add one `## Agent skills` block to root `AGENTS.md`.
- Create `docs/agents/domain.md`.
- Create `docs/agents/issue-tracker.md`.
- Create `docs/agents/triage-labels.md`.

Use agent-os's local rules, not Matt's defaults blindly:

- Root `CLAUDE.md` is only `@AGENTS.md`; keep that pointer untouched and add
  the block to `AGENTS.md`.
- Document GitHub Issues as the durable tracker for bugs, features, and durable
  workstream trackers, but keep repo-specific GitHub operations routed through
  `./aos dev gh` per `AGENTS.md`.
- Document that issue labels are repository vocabulary, not labels agents may
  freely create. If the exact configured label set is not discoverable through
  the repo's approved GitHub path, record the canonical triage roles as a
  mapping target and require future agents to inspect existing labels before
  applying or creating any.
- Document agent-os as multi-context in practice. Root `CONTEXT.md` is currently
  a governed "domain language plus contract terminology index" variant, not
  Matt's pure glossary shape.
- Document that `CONTEXT-MAP.md` is intentionally deferred to a later slice;
  until then, agents must read root `CONTEXT.md` plus the nearest subtree
  `AGENTS.md`, relevant `docs/api/`, `shared/schemas/`, and ADR/decision docs.
- Mention the split between `docs/adr/` and `docs/decisions/` as current
  consumer reality without resolving it in this slice.

The new `## Agent skills` block should be short and pointer-oriented:

```md
## Agent skills

### Issue tracker

[one-line local summary]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line local summary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line local summary]. See `docs/agents/domain.md`.
```

Place it where it reads as repo-wide guidance, and do not duplicate existing
sections.

## Suggested Doc Content

`docs/agents/domain.md` should cover:

- root `CONTEXT.md` as the current vocabulary/contract-term index;
- future `CONTEXT-MAP.md` as the intended multi-context map, not yet present;
- nearest subtree `AGENTS.md` as local policy;
- `ARCHITECTURE.md` for system narrative;
- `docs/api/` and `shared/schemas/` for live contracts;
- `docs/adr/` and `docs/decisions/` for durable decisions;
- `docs/recipes/` for SOPs;
- how to handle conflicts by surfacing the contradiction instead of silently
  choosing a stale source.

`docs/agents/issue-tracker.md` should cover:

- GitHub Issues as the durable tracker;
- the local `./aos dev gh` control surface;
- when to create issues versus docs/work cards;
- not using issues for session onboarding maps or memory dumps.

`docs/agents/triage-labels.md` should cover:

- Matt's five canonical triage roles;
- agent-os's current posture for label application;
- a warning not to create duplicate labels or invent new label names without
  user or maintainer confirmation.

## Scope

Edit only:

- `AGENTS.md`
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not create `CONTEXT-MAP.md` in this slice.
- Do not repair stale `say` / target-grammar sibling docs in this slice.
- Do not move or consolidate ADRs or decisions.
- Do not change `CONTEXT.md` except to report a blocker if the setup cannot be
  made coherent without it.
- Do not change Swift, JavaScript, schemas, tests, fixtures, or runtime
  behavior.
- Do not open or update GitHub issues or PRs.
- Do not edit `/Users/Michael/Code/mattpocock-skills`.

## Verification

Run:

```bash
git diff --check
rg -n "^## Agent skills$|docs/agents/domain.md|docs/agents/issue-tracker.md|docs/agents/triage-labels.md" AGENTS.md docs/agents
```

No Swift rebuild and no live AOS smoke are required for this docs-only setup
slice.

## Completion Report

Report:

- files changed;
- summary of the setup scaffold created;
- exact verification commands and pass/fail results;
- any GitHub label or issue-tracker evidence you inspected;
- whether `CONTEXT-MAP.md`, stale sibling-doc repairs, ADR cleanup, source
  behavior, schemas, tests, fixtures, GitHub issues, and PRs were untouched;
- local-only state or unrelated dirty files.
