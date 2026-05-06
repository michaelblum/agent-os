# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Subject Browser search/navigation V0
**Date:** 2026-05-06

## Goal

Use the canonical Subject graph/index v0 to add the first Subject Browser
navigation affordances: a deterministic search/list over indexed Subjects and a
compact navigation trail/history for opened Subjects.

The Subject graph/index v0 landed on `main` at `890515e`. AOS can now derive a
pure toolkit graph from canonical `aos.workbench.subject` descriptors and
`aos.subject_catalog.entry` records. The next practical step is to make that
substrate usable inside the Subject Browser without replacing the existing wiki
graph projection or broadening the public `aos` command surface.

The immediate next workstream is tracked in GitHub issue #285:

```text
https://github.com/michaelblum/agent-os/issues/285
```

The target branch for the next session is:

```text
codex/subject-browser-nav-v0
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
gh issue view 285 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`

Then read the current Subject model, graph/index, catalog, and browser sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-catalog.js`
- `packages/toolkit/workbench/subject-graph.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-subject-browser/styles.css`
- `packages/toolkit/components/wiki-kb/views/graph.js`
- `packages/toolkit/components/wiki-kb/views/shared.js`
- `tests/toolkit/subject-graph.test.mjs`
- `tests/toolkit/subject-catalog.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts may exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `890515e feat: add subject graph index v0`
- `35cc4a6 feat: add subject browser catalog opening`
- `1d3390d docs: refresh subject model context`
- `ee67881 feat: cut over workbench subject descriptors`
- `b85774b feat: add playbook workbench v0 shell`
- `3c5fcdb feat: add wiki subject browser v0 shell`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit current Subject Browser state/model/rendering, Subject graph/index
   helpers, catalog/opening helpers, and docs around Subject Entry Handles and
   Navigation Trails.
2. Define the smallest V0 navigation shape before wiring UI. It should include:
   - indexed Subject search/list entries derived from `subject_graph_index`;
   - a compact trail/history entry shape using Subject Entry Handles;
   - stable semantic refs for search/list/trail controls;
   - a clear empty/no-results state.
3. Implement search/list as a deterministic Subject Browser affordance over the
   derived graph/index, not over legacy wiki graph internals.
4. Implement compact navigation trail/history updates when opening wiki Subjects
   and non-wiki catalog Subjects. Keep the trail useful but small; avoid a broad
   breadcrumb ontology or URL/router rewrite.
5. Preserve existing wiki graph projection and catalog opening behavior. This is
   navigation UX over the Subject graph/index, not a replacement for #72.
6. Add focused tests proving:
   - search/list derives from canonical graph/index fields;
   - opening wiki and Work Record Subjects updates trail/history;
   - existing wiki graph and non-wiki catalog opening behavior remain intact;
   - no dependency on `views[]`, `controls[]`, or dotted raw `capabilities[]`;
   - stable semantic refs exist for `./aos see/do`.
7. Update docs/API with the V0 navigation/trail shape, scope, non-goals, and
   relationship to the underlying Subject graph/index.
8. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. Perform one live AOS verification:
   - launch the Subject Browser;
   - inspect with `./aos see`;
   - use `./aos do` to operate search/list or trail where practical;
   - confirm existing wiki and non-wiki opening still work;
   - clean up created canvases;
   - record exact commands/results.
10. Commit in focused reversible slices.

## Acceptance Criteria

- Subject Browser can surface indexed Subjects through a deterministic
  search/list affordance.
- Opening wiki and non-wiki Subjects updates a compact navigation trail/history.
- Tests cover canonical graph/index inputs, search/list behavior, trail updates,
  and existing catalog opening behavior.
- Live AOS verification uses `./aos see` and `./aos do` against semantic or
  state-guarded targets and cleans up canvases afterward.
- Docs distinguish Subject Browser navigation UX from the underlying Subject
  graph/index and from the existing wiki graph projection.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not replace the wiki graph projection tracked by #72.
- Do not reintroduce `views[]`, `controls[]`, or dotted raw `capabilities[]` as
  live dependencies.
- No new public `aos` command surface.
- No replay/repair implementation, macro playback, or live browser execution.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Subject Browser Navigation V0

1. Add graph-index-backed filtering by relationship type, layer, capability, or
   health once the basic list/trail affordance is stable.
2. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
3. Retire remaining legacy descriptor adapters once persisted/import evidence
   shows they are no longer needed.
