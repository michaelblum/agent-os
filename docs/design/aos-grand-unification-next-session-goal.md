# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Subject Browser related graph navigation V0
**Date:** 2026-05-06

## Goal

Use the canonical Subject graph/index to add the first related-Subject
navigation affordances in the Subject Browser.

The Subject Browser graph-index filters V0 landed on `main` at `2e337c4`. AOS
can now derive a canonical Subject graph/index, surface indexed Subjects through
search/list, filter by graph metadata, and maintain a compact navigation
trail/history for wiki and non-wiki Subject opens. The next practical step is to
let agents and humans inspect a focused Subject's graph neighborhood:
references, facets, and hosts, with open actions only where the target can be
resolved through existing Subject Browser opening paths.

The immediate next workstream is tracked in GitHub issue #287:

```text
https://github.com/michaelblum/agent-os/issues/287
```

The target branch for the next session is:

```text
codex/subject-browser-related-nav-v0
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
gh issue view 287 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`

Then read the current Subject model, graph/index, catalog, browser, filtering,
and navigation sources:

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

- `2e337c4 feat: add subject browser index filters`
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
   helpers, index search/filter state, trail/history state, and docs around
   Subject References, Facets, Hosts, and Subject Entry Handles.
2. Define the smallest V0 focused-subject details shape before wiring UI. It
   should include:
   - focused Subject id / entry handle;
   - outgoing and incoming Subject Reference edge summaries;
   - Facet summaries and Host references for the focused Subject;
   - related target resolution against existing indexed Subjects and catalog
     entries;
   - stable semantic refs for focus/details/open controls;
   - clear empty/unresolved states.
3. Add focus behavior from the Subject index. Prefer a simple "Inspect" or
   row-selection action over a broad router or new URL scheme.
4. Add open actions only for related Subjects that resolve to existing wiki or
   catalog entries. Unresolved graph targets should remain visible and
   inspectable but disabled/read-only.
5. Preserve existing wiki graph projection, text search/list behavior,
   graph-index filters, navigation trail/history, and Work Record catalog
   opening.
6. Add focused tests proving:
   - details/neighborhood derivation is deterministic from `subject_graph_index`;
   - outgoing/incoming reference edges, Facets, and Hosts are represented;
   - resolvable related targets can open through existing paths;
   - unresolved targets are visible but not openable;
   - existing search/filter/trail/opening behavior remains intact;
   - no dependency on `views[]`, `controls[]`, or dotted raw `capabilities[]`;
   - stable semantic refs exist for `./aos see/do`.
7. Update docs/API with the V0 related-navigation shape, scope, non-goals, and
   relationship to the underlying Subject graph/index.
8. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. Perform one live AOS verification:
   - launch the Subject Browser;
   - inspect with `./aos see`;
   - use `./aos do` to focus a Subject and inspect related graph details;
   - open one resolvable related Subject if present, or confirm disabled
     unresolved behavior if the fixture graph has no resolvable relation;
   - confirm existing wiki and non-wiki opening still work;
   - clean up created canvases;
   - record exact commands/results.
10. Commit in focused reversible slices.

## Acceptance Criteria

- Subject Browser can focus an indexed Subject and derive a deterministic
  details/neighborhood view from `subject_graph_index`.
- The view includes reference edges plus Facet/Host summaries for the focused
  Subject.
- Open actions are enabled only for resolvable related Subjects and reuse
  existing wiki/catalog open paths.
- Tests cover deterministic details derivation, resolvable vs unresolved related
  targets, semantic refs, and preservation of search/filter/trail/opening
  behavior.
- Live AOS verification uses `./aos see` and `./aos do` against stable semantic
  refs or state-guarded coordinates and cleans up canvases afterward.
- Docs distinguish graph-neighborhood navigation from the underlying graph
  derivation and from the existing wiki graph projection.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not replace the wiki graph projection tracked by #72.
- Do not reintroduce `views[]`, `controls[]`, or dotted raw `capabilities[]` as
  live dependencies.
- No new public `aos` command surface.
- No replay/repair implementation, macro playback, or live browser execution.
- No broad visual redesign or new URL/router system.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Related Graph Navigation V0

1. Add artifact bundle Subjects and make generated artifacts browseable through
   the same Subject Browser substrate.
2. Add richer related-node actions once more Subject types are present in the
   catalog and graph index.
3. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
4. Retire remaining legacy descriptor adapters once persisted/import evidence
   shows they are no longer needed.
