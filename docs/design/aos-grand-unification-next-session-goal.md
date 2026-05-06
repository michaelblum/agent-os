# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the browser-first workbench stream
**Date:** 2026-05-06

## Goal

Create a browser-hosted Playbook Workbench V0 shell.

The previous slice landed on `main` at `3c5fcdb`. AOS now has a named
browser-hosted Wiki Subject Browser V0 shell that composes Wiki KB and
Markdown Workbench through the explicit subject-opening bridge. The next
practical step is to do the same kind of lived composition for the browser
Playbook prototype: turn the proven model-only bridge into a launchable
browser-hosted toolkit surface without adding replay, repair, macro playback,
or new public CLI surface.

The immediate next workstream is tracked in GitHub issue #280:

```text
https://github.com/michaelblum/agent-os/issues/280
```

The target branch for the next session is:

```text
codex/playbook-workbench-v0
```

The trust gap now is the Playbook workbench loop. The pure toolkit prototype
already proves:

```text
createBrowserPlaybookPrototype()
  -> runBrowserPlaybookPrototype()
  -> runOneStepPlaybookHarness()
  -> Playbook-origin Work Record v0
  -> work_record.open message for the existing Work Record workbench model
```

What does not yet exist is a named browser-hosted Playbook Workbench V0 surface
that a user or agent can launch, inspect with `./aos see`, gate explicitly,
simulate exactly one saved-evidence browser step, see the report-only verifier
result, and open the emitted Work Record through the existing read-only Work
Record workbench path.

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

Inspect GitHub issue #280 after local state is known. An open issue or PR is not
automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current Playbook, Work Record, and toolkit surface sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/browser-playbook-prototype.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/fixtures/aos-playbook-step-v0/valid/browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json`
- `packages/toolkit/workbench/browser-playbook-prototype.js`
- `packages/toolkit/workbench/playbook-step-harness.js`
- `packages/toolkit/workbench/work-record-capture.js`
- `packages/toolkit/workbench/work-record-verifier.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `packages/toolkit/components/work-record-workbench/index.js`
- `packages/toolkit/components/wiki-subject-browser/launch.sh`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/panel/layouts/split-pane.js`
- `packages/toolkit/panel/mount.js`
- `tests/toolkit/browser-playbook-prototype.test.mjs`
- `tests/toolkit/playbook-step-harness.test.mjs`
- `tests/toolkit/work-record-workbench-model.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `3c5fcdb`, and
`codex/playbook-workbench-v0` should be created from that commit.

Recent foundation commits include:

- `3c5fcdb feat: add wiki subject browser v0 shell`
- `b2b9622 feat: add wiki subject opening bridge`
- `60ef457 feat: move subject writers to contracts`
- `851263a feat: emit concrete subject facets`
- `7361920 feat: add workbench subject vnext compatibility`
- `1b26ba6 docs: document work record evidence adapter boundary`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit the browser Playbook prototype, one-step harness, Work Record workbench
   model, and current toolkit launch patterns before adding UI.
2. Add the smallest named browser-hosted surface or launch path that can
   honestly be called Playbook Workbench V0. Prefer composition over new
   infrastructure.
3. Keep V0 fixture-backed and report-only. It should simulate exactly one
   browser-compatible Playbook step from saved evidence behind an explicit
   workflow gate ref/token.
4. Use `createBrowserPlaybookPrototype()`, `runBrowserPlaybookPrototype()`,
   `runOneStepPlaybookHarness()`, and the existing Work Record workbench open
   path. Do not bypass them with private ad hoc state.
5. Show the Playbook step descriptor, target/ref summary, gate status, verifier
   status, diagnostics, and emitted Work Record summary.
6. Open the emitted Work Record through the existing read-only Work Record
   workbench model instead of inventing another Work Record view.
7. Expose stable semantic controls/refs so `./aos see` can inspect the surface
   and `./aos do` can operate the minimal gate/simulate/open path where
   practical.
8. Add focused tests for:
   - named shell/surface initial state;
   - gate rejection and gated simulation;
   - Work Record open handoff;
   - semantic refs or message payloads needed by agents;
   - no replay, repair, macro, background-loop, or broad-CLI controls.
9. Update docs/API with the launch path, event/message contract, and V0
   boundaries.
10. Run the workflow router with focused `--files`, then run focused toolkit
    tests, `bash tests/help-contract.sh` if public command docs or CLI
    contracts changed, `git diff --check`, and `./aos ready`.
11. Perform one live AOS verification:
    - launch the V0 shell through its repo-mode launch path;
    - use `./aos show wait` if there is a canvas id;
    - use `./aos see` to confirm the surface is visible/inspectable;
    - exercise one gate/simulate/open path if stable controls are available;
    - confirm the emitted Work Record opens read-only;
    - clean up created canvases;
    - record exact commands/results in the final response.
12. Commit in focused reversible slices.

## Acceptance Criteria

- There is a named browser-hosted Playbook Workbench V0 surface or launch path.
- The surface starts inspectable and exposes the known browser Playbook
  prototype state.
- The flow requires an explicit workflow gate ref/token before simulation.
- The flow simulates exactly one saved-evidence browser Playbook step and emits
  a Playbook-origin Work Record v0.
- The emitted Work Record opens through the existing read-only Work Record
  workbench path.
- Focused tests cover the shell, gate behavior, simulation, Work Record handoff,
  and forbidden controls.
- One live AOS verification confirms the surface can be launched, perceived,
  operated, and cleaned up.
- No public `aos playbook`, `aos verify`, `aos audit`, recorder, replay, repair,
  macro playback, background loop, or live browser execution is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos playbook`, `aos verify`, `aos audit`, or another broad command
  surface.
- Do not add autonomous replay or repair.
- Do not add macro playback, background loops, or live browser execution in this
  slice.
- Do not create a second Work Record viewer. Use the existing Work Record
  workbench model and read-only opening path.
- Keep schema changes optional and backward-compatible unless the task
  explicitly includes a migration with fixtures, adapters, and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Playbook Workbench V0

1. Start replacing legacy `views[]`/`controls[]` consumers with the
   compatibility API where the composed browser surfaces prove the contract.
2. Extend the browser-hosted Subject Browser beyond wiki pages only after the
   V0 wiki and Playbook paths are stable and verified.
3. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
