# AOS Grand Unification Next Session Goal

**Status:** handoff goal for extending the post-cutover Subject Browser
**Date:** 2026-05-06

## Goal

Extend the browser-hosted Subject Browser beyond wiki pages.

The Workbench Subject v-next cutover landed on `main` at `ee67881`. Live
Workbench Subject writers and representative consumers now use the canonical
descriptor model: high-level `capabilities[]`, operation/event `contracts[]`,
concrete `facets[]`, host implementations in `facets[].hosts[]`, and typed
`subject_references[]`. Legacy `views[]`, `controls[]`, and dotted raw
`capabilities[]` are no longer the live model.

The browser-hosted Wiki Subject Browser V0 still proves only one path:
wiki graph selection opens a wiki-backed Markdown Workbench pane. The next
practical slice is to prove that the same Subject Browser class can open and
inspect at least one non-wiki Subject family through canonical descriptors,
without turning the wiki into an editor and without reintroducing old descriptor
summaries.

The immediate next workstream is tracked in GitHub issue #283:

```text
https://github.com/michaelblum/agent-os/issues/283
```

The target branch for the next session is:

```text
codex/subject-browser-catalog-v0
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
gh issue view 283 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`

Then read the current subject model and browser/workbench sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/wiki-subject-opening.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/workbench/browser-playbook-prototype.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-subject-browser/launch.sh`
- `packages/toolkit/components/playbook-workbench/model.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts may exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `ee67881 feat: cut over workbench subject descriptors`
- `b85774b feat: add playbook workbench v0 shell`
- `3c5fcdb feat: add wiki subject browser v0 shell`
- `b2b9622 feat: add wiki subject opening bridge`
- `60ef457 feat: move subject writers to contracts`
- `851263a feat: emit concrete subject facets`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Fix post-cutover documentation drift first. In particular, update stale
   `CONTEXT.md` language that still describes `sigil.agent`, dotted
   capabilities, or v-next descriptors as pending/migration-period work.
2. Audit the current Wiki Subject Browser shell, Wiki Subject opening bridge,
   Playbook Workbench, Work Record workbench, and canonical Subject helpers.
3. Add the smallest subject catalog/opening layer that can resolve non-wiki
   `aos.workbench.subject` descriptors through canonical fields.
4. Keep existing wiki graph and Markdown behavior intact.
5. Demonstrate one non-wiki opening path using canonical descriptors. Good
   candidates:
   - a Work Record Subject opening read-only through the existing Work Record
     Workbench path;
   - a Playbook prototype/Workbench Subject opening the existing Playbook
     Workbench path and/or emitted Work Record handoff.
6. Use `capabilities[]`, `contracts[]`, `facets[]`, `facets[].hosts[]`, and
   `subject_references[]` to decide available affordances. Do not use
   `views[]`, `controls[]`, or dotted raw `capabilities[]` as live behavior
   dependencies.
7. Expose stable semantic refs so `./aos see` can inspect the catalog/opening
   path and `./aos do` can operate one minimal selection/open path where
   practical.
8. Add focused tests for:
   - wiki behavior remaining intact;
   - non-wiki descriptor catalog/opening;
   - canonical descriptor field usage;
   - no legacy descriptor summary dependency;
   - semantic refs/message payloads needed by agents.
9. Update docs/API with the subject catalog/opening contract and V0 boundaries.
10. Run the workflow router with focused `--files`, then focused tests,
    router-selected tests, `git diff --check`, and `./aos ready`.
11. Perform one live AOS verification:
    - launch the browser-hosted Subject Browser surface;
    - inspect with `./aos see`;
    - open one wiki Subject to prove the existing path still works;
    - open one non-wiki Subject through the new canonical catalog/opening path;
    - clean up created canvases;
    - record exact commands/results.
12. Commit in focused reversible slices.

## Acceptance Criteria

- `CONTEXT.md` no longer steers agents back to the superseded compatibility
  migration.
- The browser-hosted Subject Browser can still browse wiki pages.
- The browser-hosted Subject Browser can open at least one non-wiki Subject
  family through canonical v-next descriptor fields.
- Tests cover the wiki path and the non-wiki path.
- One live AOS verification confirms the surface can be launched, perceived,
  operated, and cleaned up.
- No broad graph rewrite, new public `aos` command surface, replay/repair,
  macro playback, live browser execution, or second Work Record viewer is
  added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not turn the wiki into an editor.
- Do not reintroduce `views[]`, `controls[]`, or dotted raw `capabilities[]` as
  live Subject Browser dependencies.
- Do not create a second Work Record viewer; use the existing Work Record
  Workbench path.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Subject Browser Catalog V0

1. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
2. Add richer Subject graph/index generation after the catalog/opening contract
   proves stable.
3. Retire any remaining legacy descriptor adapters once persisted/import
   evidence shows they are no longer needed.
