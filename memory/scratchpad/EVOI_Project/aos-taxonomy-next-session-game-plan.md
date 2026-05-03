# AOS Taxonomy Rationalization: Next Session Game Plan

> Superseded for active handoff by
> `memory/scratchpad/EVOI_Project/2026-05-01-readiness-preflight-session-handoff.md`.
> Keep this file as historical planning context only.

## Context

This file is a handoff strategy for continuing the AOS taxonomy and artifact
rationalization work without relying on chat history. It builds on:

- `memory/scratchpad/EVOI_Project/playbook_prototype.md`
- `memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md`
- the live AOS perception test where `./aos see target --json` was enough for
  structured reasoning and pixels were intentionally left uninspected
- issue overlap checks against #129, #134, #156, #158, #160, #162, #163, and
  #165
- review of Matt Pocock's engineering skills, especially
  `improve-codebase-architecture`, `grill-with-docs`, `to-issues`, and
  `zoom-out`

This is provisional scratchpad material, not canonical AOS doctrine.

## Current Read

AOS should not classify EVOI yet. The repo first needs a clearer taxonomy for
artifact types and their homes.

The strongest near-term framing is:

- Use AOS vocabulary and source-of-truth rules as the authority.
- Borrow Matt Pocock's skills as a review lens, not as an installed workflow.
- Treat `grill-with-docs` and `improve-codebase-architecture` as useful
  methods for stress-testing names, seams, and shallow/deep surfaces.
- Do not run `setup-matt-pocock-skills` yet; it would introduce `CONTEXT.md`,
  `docs/adr/`, and `docs/agents/` conventions before AOS has decided its own
  taxonomy.

## Recommended Next Session Shape

### Phase 1: Rehydrate Facts

Read, in this order:

1. `memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md`
2. `AGENTS.md`
3. `ARCHITECTURE.md`
4. `docs/recipes/agent-entry-paths-and-verification.md`
5. `docs/reference/aos-dev-workflow-rules.json`
6. `wiki-seed/README.md`
7. `src/commands/wiki.swift`
8. `src/commands/ops.swift`
9. `shared/schemas/ops-recipe.schema.json`

Then re-check GitHub issue status for:

- #129
- #134
- #156
- #158
- #160
- #162
- #163
- #165

Do not assume the status from this file is still current.

### Phase 2: Decide The Work Surface

Pick one of these paths:

1. **Issue-first path**: refine the draft epic and create/update GitHub issues.
   Use this if the user wants coordination artifacts before repo docs.
2. **Doc-first path**: write `docs/api/aos-taxonomy.md` as a provisional but
   canonicalizing taxonomy doc, then use it to update/create issues.
   Use this if the user wants the repo to lead.
3. **Planning-only path**: keep working in scratchpad until the taxonomy shape is
   stable.
   Use this if the user still wants exploration without repo doctrine changes.

Recommended default: issue-first, but only after one human confirmation. The
work is cross-cutting enough that GitHub coordination helps prevent accidental
scope creep.

### Phase 3: Use The Upstream Skills As Lenses

Do not install the full upstream skill suite. Instead, adapt the useful review
questions:

- From `zoom-out`: what is the map of relevant AOS artifact surfaces and callers?
- From `grill-with-docs`: which terms are overloaded, vague, or contradicted by
  existing docs/code?
- From `improve-codebase-architecture`: which surfaces are shallow, which hide
  useful complexity, and where do interfaces leak implementation burden?
- From `to-issues`: are child issues vertical, independently useful, and
  reviewable?

Translate all of this into AOS language. Do not replace AOS terms with upstream
terms such as `CONTEXT.md`, `ADR`, or `seam` unless the user deliberately wants
that vocabulary.

### Phase 4: Produce One Concrete Artifact

Do exactly one durable thing in the next session:

- create/update the GitHub epic and child issues, or
- create `docs/api/aos-taxonomy.md`, or
- refine the scratchpad epic draft and ask for approval.

Avoid doing all three in one pass. The topic is governance-heavy; batching too
much risks baking in terminology before the user has reacted.

## Recommended Issue Split

Keep the epic to roughly five child issues:

1. Inventory current AOS artifact surfaces and define canonical taxonomy.
2. Audit and reconcile agent-facing instructions, recipes, playbooks, skills,
   and plugins.
3. Classify executable surfaces: CLI, ops recipes, reusable scripts, tests, and
   dev workflows.
4. Define runtime wiki, plugin, and playbook boundaries.
5. Gate EVOI placement with a decision memo after taxonomy lands.

Avoid creating separate issues for every term. The fault lines are coupled.

## Risk Controls

- Do not inspect pixels from the earlier mouse-target capture unless explicitly
  asked.
- Do not touch unrelated dirty worktree files.
- Do not promote `memory/scratchpad/EVOI_Project/*` into canonical docs without
  human confirmation.
- Do not run `setup-matt-pocock-skills` before deciding whether AOS wants
  `CONTEXT.md` / `docs/adr` conventions.
- Do not duplicate #129's `aos ops` implementation scope.
- Treat #160 as completed infrastructure unless new evidence says otherwise.

## Starter Prompt

```text
We are in /Users/Michael/Code/agent-os. Continue AOS taxonomy and artifact
rationalization planning.

Read first:
- memory/scratchpad/EVOI_Project/aos-taxonomy-next-session-game-plan.md
- memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md
- AGENTS.md
- ARCHITECTURE.md
- docs/recipes/agent-entry-paths-and-verification.md
- docs/reference/aos-dev-workflow-rules.json

Goal:
- AOS must be sorted before EVOI is classified.
- Do not implement EVOI.
- Re-check GitHub issues #129, #134, #156, #158, #160, #162, #163, #165.
- Refine the epic/child issue plan or propose `docs/api/aos-taxonomy.md`.
- Ask before creating/editing GitHub issues or canonical repo docs.

Important constraints:
- Preserve AOS vocabulary.
- Use Matt Pocock's engineering skills only as review lenses unless explicitly
  asked to install/use them.
- Do not inspect the earlier mouse-target image pixels unless explicitly asked.
- Do not touch unrelated dirty worktree changes.
```
