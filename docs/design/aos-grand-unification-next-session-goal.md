# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Prototype Wiki Subject opening from browser-hosted graph selection.

The previous slice landed on `main` at `60ef457`. AOS now has Workbench Subject
descriptors with high-level `capabilities[]`, explicit `contracts[]`, concrete
Facets, Host entries, Subject References, and compatibility readers. Wiki KB can
render the graph/mind-map, and Markdown Workbench can already open and save
wiki-backed pages. The next step is the first small browse-select-open loop:
selecting a wiki graph node should resolve to a Subject Entry Handle /
descriptor and open the corresponding wiki page in a neighboring workbench pane
through an explicit message contract.

The immediate next workstream is tracked in GitHub issue #214:

```text
https://github.com/michaelblum/agent-os/issues/214
```

The target branch for the next session is:

```text
codex/wiki-subject-opening-prototype
```

The trust gap now is composition. The descriptor model is stable enough for a
small prototype, but Wiki KB selection and Markdown Workbench opening are still
coupled only by ad hoc page loading behavior. The next slice should prove that a
browser-hosted graph selection can open a wiki-backed subject using explicit
messages and the Workbench Subject compatibility API without building the full
Wiki Subject Browser.

## Required Rediscovery

Do not assume branch, worktree, PR, issue, daemon, or canvas state from prior
session summaries. Start by reading `AGENTS.md`, then rediscover state:

```bash
git status --short --branch
git worktree list
git branch --format='%(refname:short)' | sort
./aos ready
./aos show list --json
```

Before selecting verification commands, run:

```bash
./aos dev recommend --json
```

Use focused `--files` arguments after editing so the router sees the intended
slice instead of the whole branch diff.

Inspect GitHub issue #214 after local state is known. An open issue or PR is not
automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current subject and workbench sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/launch.sh`
- `packages/toolkit/components/markdown-workbench/save-current.sh`
- `packages/toolkit/panel/layouts/split-pane.js`
- `packages/toolkit/panel/mount.js`
- `tests/toolkit/wiki-kb*.test.mjs`
- `tests/toolkit/markdown-workbench*.test.mjs`
- `tests/toolkit/workbench-subject.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `60ef457`, and
`codex/wiki-subject-opening-prototype` should be created from that commit.

Recent foundation commits include:

- `60ef457 feat: move subject writers to contracts`
- `851263a feat: emit concrete subject facets`
- `7361920 feat: add workbench subject vnext compatibility`
- `d56a44a feat: split wiki and sigil subject helpers`
- `1b26ba6 docs: document work record evidence adapter boundary`
- `c7f0939 feat: add work record evidence adapters`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit Wiki KB selection/events and Markdown Workbench open behavior before
   designing anything new.
2. Define the minimal explicit message/event contract for selection-to-open:
   selected wiki path, Subject Entry Handle, and/or `aos.workbench.subject`
   descriptor payload. Keep it small and testable.
3. Keep Wiki KB generic. It may emit selected page identity and subject
   metadata, but it must not know Markdown Workbench internals.
4. Add a focused composed surface or launch/helper path where graph selection can
   populate/reveal a Markdown Workbench editor pane. Prefer existing
   `SplitPane`, panel mount, and markdown workbench primitives.
5. Keep graph-first behavior: the graph should be the initial primary view; the
   content/editor pane appears or is populated when a page is opened.
6. Use existing wiki-backed Markdown Workbench open/save behavior. Do not add a
   new wiki persistence path.
7. Use Workbench Subject compatibility readers where the opener decides whether
   a selection can be opened: `subjectFacets()`, `subjectHosts()`,
   `subjectContracts()`, `subjectReferences()`, `subjectLegacyViews()`, and
   `subjectLegacyControls()`.
8. Add focused tests for:
   - Wiki KB selection emits a stable subject/open payload;
   - the composed opener maps a selected wiki node to a wiki-backed Markdown
     Workbench open request/state;
   - legacy graph behavior still works;
   - descriptor compatibility readers are used rather than raw private fields.
9. Run the workflow router with focused `--files`, then run focused toolkit
   tests, `bash tests/help-contract.sh` if public command docs or CLI contracts
   changed, `git diff --check`, and `./aos ready`.
10. If live visual verification is needed, use `./aos` surfaces and `./aos see`.
    Avoid broad manual/UI work unless tests show the composed state needs it.
11. Commit in focused reversible slices.

## Acceptance Criteria

- Selecting a wiki graph node can open the corresponding page as a Workbench
  Subject in a neighboring editor pane or composed browser-hosted surface.
- The selection/open bridge uses explicit messages and subject descriptors.
- Wiki KB remains generic and does not depend on Markdown Workbench internals.
- Markdown Workbench continues to own wiki-backed open/save behavior.
- Focused tests cover the selection/open contract and composed surface state.
- No full Wiki Subject Browser, broad Playbook UI, autonomous replay, repair,
  macro playback, or new `aos` command surface is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not build the full Wiki Subject Browser yet.
- Do not duplicate the canonical graph projection work tracked by #72.
- Do not add a new wiki persistence path; use existing Markdown Workbench
  wiki-backed open/save behavior.
- Keep schema changes optional and backward-compatible unless the task explicitly
  includes a migration with fixtures, adapters, and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Subject Opening Prototype

1. Promote the prototype into a real Browser-Hosted Wiki Subject Browser only
   after the selection/open contract proves stable.
2. Promote the browser Playbook prototype into a browser-hosted Playbook
   workbench after subject opening and evidence-adapter diagnostics prove
   stable.
3. Start replacing legacy `views[]`/`controls[]` consumers with the compatibility
   API where the composed subject opener has proven the contract.
