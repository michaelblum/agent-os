# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Subject Browser graph-index filters V0
**Date:** 2026-05-06

## Goal

Extend the Subject Browser navigation V0 with graph-index-backed filters for
indexed Subjects and relationships.

The Subject Browser search/navigation V0 landed on `main` at `800103d`. AOS can
now derive a canonical Subject graph/index, surface indexed Subjects through a
search/list affordance, and maintain a compact navigation trail/history for wiki
and non-wiki Subject opens. The next practical step is to make the index more
operable by adding deterministic filters over canonical graph metadata, not over
the existing wiki graph internals.

The immediate next workstream is tracked in GitHub issue #286:

```text
https://github.com/michaelblum/agent-os/issues/286
```

The target branch for the next session is:

```text
codex/subject-browser-index-filters-v0
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
gh issue view 286 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`

Then read the current Subject model, graph/index, catalog, browser, and
navigation sources:

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

- `800103d docs: document subject browser navigation v0`
- `3e872f0 feat: add subject browser navigation v0`
- `890515e feat: add subject graph index v0`
- `35cc4a6 feat: add subject browser catalog opening`
- `1d3390d docs: refresh subject model context`
- `ee67881 feat: cut over workbench subject descriptors`
- `b85774b feat: add playbook workbench v0 shell`
- `3c5fcdb feat: add wiki subject browser v0 shell`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit current Subject Browser state/model/rendering, Subject graph/index
   helpers, search/list state, trail/history state, and docs around Subject
   graph metadata.
2. Define the smallest V0 filter shape before wiring UI. It should include:
   - selected filter state;
   - derived filter option lists from `subject_graph_index`;
   - composable search + filter result derivation;
   - stable semantic refs for filter controls;
   - clear reset and empty/no-match behavior.
3. Prefer high-leverage filters that are already present in the graph/index:
   subject type, relationship type, layer, capability, and health. Implement at
   least two in the first slice; leave clean structure for additional filters if
   doing all five would make the slice too broad.
4. Render compact filter controls in the existing Subject Browser index area.
   Keep the surface utilitarian and avoid a broad visual redesign.
5. Preserve existing wiki graph projection, text search/list behavior,
   navigation trail/history, and Work Record catalog opening.
6. Add focused tests proving:
   - filter options derive from canonical graph/index fields;
   - search and filters compose deterministically;
   - reset and no-match states are stable;
   - wiki and Work Record opening/trail behavior remain intact;
   - no dependency on `views[]`, `controls[]`, or dotted raw `capabilities[]`;
   - stable semantic refs exist for `./aos see/do`.
7. Update docs/API with the V0 filter shape, scope, non-goals, and relationship
   to the underlying Subject graph/index.
8. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. Perform one live AOS verification:
   - launch the Subject Browser;
   - inspect with `./aos see`;
   - use `./aos do` to operate filter controls and open a filtered Subject;
   - confirm existing wiki and non-wiki opening still work;
   - clean up created canvases;
   - record exact commands/results.
10. Commit in focused reversible slices.

## Acceptance Criteria

- Subject Browser exposes graph-index-backed filters over indexed Subjects.
- Filters derive from canonical `subject_graph_index` metadata, not wiki graph
  internals.
- Search and filters compose deterministically.
- Tests cover filter option derivation, filtered results, reset/empty states,
  and preservation of existing opening/trail behavior.
- Live AOS verification uses `./aos see` and `./aos do` against stable semantic
  refs or state-guarded coordinates and cleans up canvases afterward.
- Docs distinguish filters from graph derivation and from the existing wiki
  graph projection.

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

## Next Milestones After Subject Browser Filters V0

1. Add richer Subject Browser navigation actions such as opening related
   Subjects from reference edges or host/facet summaries.
2. Add artifact bundle Subjects and make generated artifacts browseable through
   the same Subject Browser substrate.
3. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
4. Retire remaining legacy descriptor adapters once persisted/import evidence
   shows they are no longer needed.
