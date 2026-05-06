# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Wiki Graph Taxonomy Alignment V0
**Date:** 2026-05-06

## Goal

Align the wiki graph legend, type filters, and graph payload taxonomy with the
current Workbench Subject model without replacing the wiki graph projection.

The Artifact Bundle Subject V0 slice landed on `main` at `3c8a130`. AOS now has
a read-only artifact bundle subject, fixture, toolkit projection, workbench, and
Subject Browser opening path. The next small follow-up is to remove a confusing
taxonomy drift in the wiki graph surface: `wiki-kb` still shows raw wiki
frontmatter kinds such as `agent` in its legend, while the canonical Subject
model says `sigil/agents/*` wiki documents remain wiki document Subjects and
separate `sigil.agent` domain Subjects are represented elsewhere.

The immediate workstream belongs under GitHub issue #72:

```text
https://github.com/michaelblum/agent-os/issues/72
```

The target branch for the next session is:

```text
codex/wiki-graph-taxonomy-alignment
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
gh issue view 72 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer, entry-path recipe, layered subject recipe, and
current Subject docs:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`
- `CONTEXT.md`
- `docs/api/toolkit.md`
- `docs/api/aos.md`
- `docs/design/aos-subject-model-compatibility-audit.md`

Then inspect the wiki graph and Subject Browser sources/tests:

- `src/commands/wiki-graph.swift`
- `src/content/server.swift`
- `packages/toolkit/components/wiki-kb/views/shared.js`
- `packages/toolkit/components/wiki-kb/views/graph.js`
- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/wiki-subject-opening.js`
- `packages/toolkit/workbench/sigil-subject.js`
- `packages/toolkit/workbench/subject-graph.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `tests/wiki-integration.sh`
- `tests/toolkit/wiki-kb.test.mjs`
- `tests/toolkit/wiki-subject.test.mjs`
- `tests/toolkit/wiki-subject-opening.test.mjs`
- `tests/toolkit/subject-graph.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- adjacent tests selected by `./aos dev recommend`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `3c8a130 feat: add artifact bundle subject v0`
- `797123d docs: refine gdi exit interview recipe`
- `4311f4a docs: document subject browser related navigation`
- `af2b660 feat: add subject browser related navigation`
- `2e337c4 feat: add subject browser index filters`
- `800103d docs: document subject browser navigation v0`
- `890515e feat: add subject graph index v0`

Treat these as orientation only. Rediscover before editing.

## Foreman Finding To Verify

This finding was collected read-only before the handoff:

- `./aos wiki graph --json` reported 38 nodes and 122 links.
- Its graph node type counts were `{ "entity": 7, "concept": 23, "agent": 1,
  "workflow": 7 }`.
- The `agent` node was `sigil/agents/default.md`.
- `wiki-kb` renders its legend from `filteredGraph.availableTypes`, which comes
  from graph node `type`.
- `wiki-subject.js` already maps `type: agent` and `sigil/agents/*` paths to the
  canonical wiki document Subject type `wiki.entity`.

The likely drift is limited to the wiki graph projection/page-kind taxonomy, not
the canonical Subject Browser index.

## Model Boundary

Keep these two surfaces distinct:

- `wiki-kb` force graph and mind map visualize wiki graph snapshots from
  `aos wiki graph` / `/wiki/.graph`.
- Subject Browser index/details visualize canonical Workbench Subject
  descriptors and catalog entries.

For this slice, keep the wiki graph legend page-kind oriented. Do not turn the
wiki graph payload into the Subject graph index, and do not replace #72's graph
projection with `subject_graph_index`.

## Immediate Work Plan

1. Audit `aos wiki graph`, `/wiki/.graph`, `wiki-kb` graph normalization,
   legend rendering, type filters, and `wiki.subject.selection` bridging before
   editing.
2. Decide and document the V0 wiki graph page-kind vocabulary. The expected
   narrow vocabulary is likely:
   - `page`
   - `concept`
   - `entity`
   - `workflow`
   - `reference`
3. Normalize old wiki frontmatter `type: agent` and paths under
   `sigil/agents/*` so the wiki graph page kind is `entity`, not `agent`.
4. Decide whether plugin reference pages should emit `reference` or remain
   `concept`; prefer `reference` if it can be done without breaking existing
   graph consumers. Document the decision either way.
5. Keep `wiki.subject.selection` behavior aligned:
   - selecting `sigil/agents/default.md` should produce a wiki document Subject;
   - its `subject_type` should be `wiki.entity`;
   - the selection path should still open in Markdown Workbench;
   - no graph selection should mint a `sigil.agent` domain Subject.
6. Keep canonical domain Subject types such as `sigil.agent`,
   `aos.work_record`, and `aos.artifact_bundle` in Subject Browser
   index/details, not in the wiki-kb page legend.
7. Update docs/API to name the distinction explicitly: wiki graph node `type`
   is a wiki page kind; Subject Browser `subject_type` is a canonical Workbench
   Subject type.
8. Add focused tests for:
   - `./aos wiki graph --json` no longer emits `agent` for `sigil/agents/*`;
   - graph payload/page-kind docs are current;
   - `wiki-kb` available types/legend inputs reflect the normalized page kinds;
   - `wiki.subject.selection` still produces `wiki.entity` for Sigil agent wiki
     docs;
   - Subject Browser `subject_type` filters remain canonical and unchanged.
9. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
10. If `wiki-kb` or Subject Browser rendering changes, perform one live AOS
    verification:
    - launch the wiki graph or Subject Browser surface;
    - inspect with `./aos see`;
    - confirm the legend/type filter no longer shows `agent`;
    - confirm the Sigil agent wiki document still opens as a wiki document;
    - clean up created canvases;
    - record exact commands/results.
11. Commit focused reversible slices.

## Acceptance Criteria

- `./aos wiki graph --json` no longer emits `agent` as a node type for
  `sigil/agents/*`.
- The wiki-kb legend/type filters no longer show `agent` when rendering the repo
  wiki graph.
- The wiki graph surface remains a wiki page graph, not the Subject graph index.
- Selecting a Sigil agent wiki node still emits `wiki.subject.selection` with a
  `wiki.entity` Subject and still opens in Markdown Workbench.
- Subject Browser canonical `subject_type` filters remain unchanged.
- Docs/API clarify wiki graph page kinds versus Workbench Subject types.
- Existing wiki, Subject Browser, and Subject graph tests remain green.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not replace the wiki graph projection with the Subject graph index.
- Do not move domain Subject types into the wiki-kb page legend.
- Do not broaden this into a graph layout, Subject Browser rewrite, artifact
  workbench change, or Sigil agent domain-subject implementation.
- No new public `aos` command surface unless rediscovery proves a missing
  primitive and the user explicitly approves broadening.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Known Follow-Up Outside This Slice

Issue #288 tracks a separate command-surface gap found during the Artifact
Bundle Subject V0 exit interview: agents need a ref-based AOS action for
xray/accessibility targets, such as `./aos do click-ref <ref> --state-id <id>`.
Do not mix that command work into this taxonomy slice.
