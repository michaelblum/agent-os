# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Build the first browser-hosted Playbook prototype that emits Work Records through
the explicit-gate one-step harness.

The previous combined slice landed on `main` at `18b7ea6`. AOS now has Work
Record v0, saved AOS action evidence, Playbook step v0, Playbook-origin Work
Record generation, report-only verifier diagnostics, and an explicit-gate
one-step Playbook harness above the daemon.

The immediate next workstream is tracked in GitHub issue #274:

```text
https://github.com/michaelblum/agent-os/issues/274
```

The target branch for the next session is:

```text
codex/browser-playbook-prototype
```

Build the smallest browser-compatible prototype bridge from a Playbook step to a
Work Record. This should prove the browser Playbook path without building the
full Wiki Subject Browser, adding broad CLI commands, or enabling autonomous
replay/repair.

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

If GitHub context is needed, inspect issue #274 after local state is known. An
open issue or PR is not automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current workstream sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `packages/toolkit/workbench/playbook-step-harness.js`
- `packages/toolkit/workbench/work-record-capture.js`
- `packages/toolkit/workbench/work-record-verifier.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `tests/toolkit/playbook-step-harness.test.mjs`
- `tests/toolkit/work-record-capture.test.mjs`
- `tests/toolkit/work-record-workbench-model.test.mjs`
- `tests/schemas/aos-playbook-step-v0.test.mjs`
- `tests/schemas/aos-work-record-v0.test.mjs`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `18b7ea6`, and
`codex/browser-playbook-prototype` should be created from that commit.

Recent foundation commits include:

- `18b7ea6 feat: add gated playbook step harness`
- `034ecce feat: classify work record verifier diagnostics`
- `3b6696a feat: bridge playbook steps to work records`
- `7c199c4 docs: sketch playbook step v0 schema`
- `3cbec84 docs: document AOS action work record substrate`
- `d9fab5f feat: capture AOS action work records`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Choose the smallest browser-compatible prototype surface or harness fixture.
   Prefer the existing browser click/status Playbook path unless evidence shows a
   better deterministic step.
2. Present or select exactly one `aos.playbook_step` descriptor and run/simulate
   it through `runOneStepPlaybookHarness()` with an explicit workflow gate.
3. Emit or expose the resulting Playbook-origin Work Record v0 and verifier
   report through existing read-only Work Record inspection paths.
4. Use AOS browser target grammar and semantic refs as the contract. Raw
   Playwright may remain an adapter detail, not canonical truth.
5. Add the minimal subject/descriptor metadata needed for the prototype to be
   discoverable as an AOS artifact. Do not build the full Wiki Subject Browser.
6. Preserve report-only behavior. Do not add replay, repair, macro playback, or
   background loops.
7. Add deterministic tests first. Live browser/AOS checks may be included only if
   bounded, cleanup-safe, and routed through existing AOS primitives.
8. Document the boundary: this is a browser Playbook prototype bridge, not a
   general Playbook UI and not the Wiki Subject Browser.
9. Run the workflow router with focused `--files`, then run focused
   schema/toolkit tests, `bash tests/help-contract.sh` if public command docs
   changed, `git diff --check`, and `./aos ready`.
10. Commit in focused reversible slices.

## Acceptance Criteria

- A browser-compatible Playbook prototype path exists and is documented.
- It can run or simulate exactly one gated Playbook step through
  `runOneStepPlaybookHarness()`.
- The result is a Playbook-origin Work Record v0 that validates and passes
  `aos.verifier.work-record.v0.report-only` when evidence is good.
- The emitted Work Record opens read-only through the existing Work Record
  workbench model/path.
- Tests prove gate enforcement remains intact and no autonomous replay/repair
  path is introduced.
- Docs clarify this is not the Wiki Subject Browser, a general Playbook UI, or a
  new broad CLI surface.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos playbook`, `aos verify`, `aos audit`, or another broad command
  surface.
- Do not implement autonomous replay, repair, macro playback, or background
  loops.
- Do not build the full wiki/browser subject browser.
- Keep generated Work Records report-only and read-only.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Browser Playbook Prototype

1. Add richer verifier evidence adapters for screenshots, DOM/AX fragments, and
   canvas state.
2. Split wiki document Subjects from domain Subjects in toolkit helpers.
3. Promote the prototype into a browser-hosted Playbook workbench only after the
   artifact contracts prove stable.
4. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
