# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Create a browser-hosted Wiki Subject Browser V0 shell.

The previous slice landed on `main` at `b2b9622`. AOS now has the explicit
Wiki Subject opening bridge: Wiki KB emits `wiki.subject.selection` /
`wiki_subject.open.requested`, Markdown Workbench opens wiki selections through
Workbench Subject compatibility readers, and wiki-backed open/save behavior
already exists. The next step is to turn that bridge into a small named
browser-hosted surface that a user or agent can launch, see, and operate.

The immediate next workstream is tracked in GitHub issue #279:

```text
https://github.com/michaelblum/agent-os/issues/279
```

The target branch for the next session is:

```text
codex/wiki-subject-browser-v0
```

The trust gap now is lived composition. The selection/open contract is tested,
but there is not yet a named Wiki Subject Browser V0 shell with a clear launch
path, graph-first layout, semantic controls, and live AOS verification. This
slice should stay small: compose existing Wiki KB and wiki-backed Markdown
Workbench through the landed bridge rather than inventing a broad new browser,
router, or persistence system.

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

Inspect GitHub issue #279 after local state is known. An open issue or PR is not
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
- `packages/toolkit/workbench/wiki-subject-opening.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/wiki-kb/styles.css`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/index.html`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/launch.sh`
- `packages/toolkit/components/markdown-workbench/save-current.sh`
- `packages/toolkit/panel/layouts/split-pane.js`
- `packages/toolkit/panel/mount.js`
- `tests/toolkit/wiki-subject-opening.test.mjs`
- `tests/toolkit/wiki-kb*.test.mjs`
- `tests/toolkit/markdown-workbench*.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `b2b9622`, and
`codex/wiki-subject-browser-v0` should be created from that commit.

Recent foundation commits include:

- `b2b9622 feat: add wiki subject opening bridge`
- `60ef457 feat: move subject writers to contracts`
- `851263a feat: emit concrete subject facets`
- `7361920 feat: add workbench subject vnext compatibility`
- `d56a44a feat: split wiki and sigil subject helpers`
- `1b26ba6 docs: document work record evidence adapter boundary`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit the current Markdown Workbench graph integration and the new
   `wiki-subject-opening.js` bridge before adding a surface.
2. Add the smallest named browser-hosted surface or launch path that can
   honestly be called Wiki Subject Browser V0. Prefer composition over new
   infrastructure.
3. Preserve graph-first behavior: the graph is primary initially; opening a
   subject reveals or populates the Markdown Workbench content pane.
4. Use the existing `wiki.subject.selection` / `wiki_subject.open.requested`
   bridge and Workbench Subject compatibility readers. Do not bypass them with
   private ad hoc state.
5. Use existing wiki-backed Markdown Workbench open/save behavior. Do not add a
   new wiki persistence path.
6. Expose stable semantic controls/refs so `./aos see` can inspect the surface
   and `./aos do` can operate at least one minimal open path where practical.
7. Add focused tests for:
   - the named shell/surface initial graph-first state;
   - selection/open bridge integration into the content pane;
   - semantic refs or message payloads needed by agents;
   - legacy Wiki KB and Markdown Workbench behavior remaining intact.
8. Update docs/API with the launch path, event contract, and V0 boundaries.
9. Run the workflow router with focused `--files`, then run focused toolkit
   tests, `bash tests/help-contract.sh` if public command docs or CLI contracts
   changed, `git diff --check`, and `./aos ready`.
10. Perform one live AOS verification:
    - launch the V0 shell through its repo-mode launch path;
    - use `./aos show wait` if there is a canvas id;
    - use `./aos see` to confirm the surface is visible/inspectable;
    - exercise one graph-selection/open path if stable controls are available;
    - clean up created canvases;
    - record exact commands/results in the final response.
11. Commit in focused reversible slices.

## Acceptance Criteria

- There is a named browser-hosted Wiki Subject Browser V0 surface or launch
  path.
- The surface starts graph-first and opens a selected wiki subject into a
  neighboring Markdown Workbench content/editor pane.
- The flow uses explicit subject-opening messages and Workbench Subject
  descriptors/compatibility readers.
- Wiki KB remains generic and Markdown Workbench continues to own wiki-backed
  open/save behavior.
- Focused tests cover the shell and the selection/open flow.
- One live AOS verification confirms the surface can be launched and perceived.
- No broad Playbook UI, autonomous replay, repair, macro playback, or new `aos`
  command surface is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not duplicate the canonical graph projection work tracked by #72.
- Do not add a new wiki persistence path; use existing Markdown Workbench
  wiki-backed open/save behavior.
- Keep schema changes optional and backward-compatible unless the task explicitly
  includes a migration with fixtures, adapters, and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Wiki Subject Browser V0

1. Promote the browser Playbook prototype into a browser-hosted Playbook
   workbench after subject opening and evidence-adapter diagnostics prove
   stable.
2. Start replacing legacy `views[]`/`controls[]` consumers with the compatibility
   API where the composed subject browser proves the contract.
3. Extend the browser-hosted Subject Browser beyond wiki pages only after the V0
   wiki path is stable and verified.
