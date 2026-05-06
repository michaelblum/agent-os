# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Subject graph/index v0
**Date:** 2026-05-06

## Goal

Derive a Subject graph/index v0 from canonical Workbench Subject descriptors.

The Subject Browser catalog/opening slice landed on `main` at `35cc4a6`. AOS can
now open both wiki Subjects and a non-wiki Work Record Subject through the
canonical descriptor model. The next practical step is not another one-off
opening path; it is a deterministic graph/index over canonical
`aos.workbench.subject` descriptors so agents and browser/workbench surfaces can
navigate Subject relationships consistently.

The immediate next workstream is tracked in GitHub issue #284:

```text
https://github.com/michaelblum/agent-os/issues/284
```

The target branch for the next session is:

```text
codex/subject-graph-index-v0
```

## Required Rediscovery

Do not assume branch, worktree, PR, issue, daemon, canvas, or dirty state from
prior summaries. Start by reading `AGENTS.md`, then rediscover state:

```bash
git status --short --branch
git worktree list
git branch --format='%(refname:short)' | sort
./aos ready
./aos show list --json
./aos dev recommend --json
gh issue view 284 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`

Then read the current subject model, catalog, browser, and graph sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-catalog.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/workbench/browser-playbook-prototype.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-kb/views/graph.js`
- `packages/toolkit/components/wiki-kb/views/shared.js`
- `tests/toolkit/subject-catalog.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts may exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `35cc4a6 feat: add subject browser catalog opening`
- `1d3390d docs: refresh subject model context`
- `ee67881 feat: cut over workbench subject descriptors`
- `b85774b feat: add playbook workbench v0 shell`
- `3c5fcdb feat: add wiki subject browser v0 shell`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit current wiki graph projection context, Subject catalog/opening helpers,
   canonical Subject descriptor helpers, and docs around Subject Browser and
   Subject References.
2. Define a small Subject graph/index v0 shape in toolkit docs/tests before
   wiring UI. It should include:
   - Subject nodes;
   - optional Facet summaries or Facet nodes;
   - Host references;
   - typed Subject Reference edges;
   - source/evidence/health metadata where available.
3. Implement a pure toolkit graph/index derivation from canonical descriptors
   and/or `aos.subject_catalog.entry` records.
4. Keep the existing wiki graph projection intact. This graph/index is a
   cross-subject navigation index, not a replacement for the wiki graph layout
   tracked by #72.
5. Add a minimal Subject Browser inspection affordance for the derived
   graph/index only if it can be done without a broad UI rewrite.
6. Add focused tests with at least one wiki Subject and one Work Record catalog
   entry, proving:
   - deterministic nodes and typed edges;
   - canonical descriptor field usage;
   - no dependency on `views[]`, `controls[]`, or dotted raw `capabilities[]`;
   - existing wiki graph and non-wiki catalog opening behavior remains intact.
7. Update docs/API with the graph/index shape, scope, non-goals, and
   relationship to #72.
8. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. If UI affordance changed, perform one live AOS verification:
   - launch the Subject Browser;
   - inspect with `./aos see`;
   - confirm existing wiki and non-wiki opening still work;
   - inspect the graph/index affordance;
   - clean up created canvases;
   - record exact commands/results.
10. Commit in focused reversible slices.

## Acceptance Criteria

- A deterministic Subject graph/index v0 can be derived from canonical
  descriptors/catalog entries.
- Tests cover wiki and non-wiki Subject inputs and typed edges.
- Existing wiki graph and subject catalog opening behavior remain intact.
- Docs/API distinguish the Subject graph/index from the existing wiki graph
  projection.
- No new public `aos` command surface, broad graph rewrite, replay/repair,
  macro playback, or live browser execution is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not replace the wiki graph projection tracked by #72.
- Do not reintroduce `views[]`, `controls[]`, or dotted raw `capabilities[]` as
  live dependencies.
- Keep graph/index derivation pure toolkit logic unless a missing primitive is
  proven.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Subject Graph Index V0

1. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
2. Expand the Subject Browser navigation trail/search UX once the graph/index
   contract is stable.
3. Retire remaining legacy descriptor adapters once persisted/import evidence
   shows they are no longer needed.
