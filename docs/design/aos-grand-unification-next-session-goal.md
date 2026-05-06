# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Build the first explicit-gate Playbook harness and harden verifier diagnostics.

The previous slice landed on `main` at `3b6696a`. AOS now has Work Record v0,
command evidence capture, saved AOS action evidence capture, Playbook step v0,
Playbook-origin Work Record generation, the named report-only verifier profile,
and read-only Work Record workbench inspection.

That is the inflection point where the next two slices can be combined safely.
The immediate next workstream is tracked in GitHub issue #273:

```text
https://github.com/michaelblum/agent-os/issues/273
```

The target branch for the next session is:

```text
codex/playbook-harness-verifier-hardening
```

Build one narrow harness above the daemon that can run or simulate exactly one
Playbook step only when an explicit workflow gate is supplied, emit Work Record
v0, and run the named report-only verifier. In the same session, harden verifier
diagnostics enough to classify target/ref drift, precondition failure, action
failure, postcondition failure, and evidence/State ID inconsistency.

Do not implement autonomous replay, autonomous repair, macro playback,
background loops, broad CLI commands, the wiki browser, or a Playbook UI.

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

If GitHub context is needed, inspect issue #273 after local state is known. An
open issue or PR is not automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current workstream sources:

- `CONTEXT.md`
- `docs/adr/0002-work-records-and-playbooks-are-distinct-artifacts.md`
- `docs/adr/0003-claims-and-postconditions-split-along-intent-and-execution.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `packages/toolkit/workbench/work-record-capture.js`
- `packages/toolkit/workbench/work-record-verifier.js`
- `tests/toolkit/work-record-capture.test.mjs`
- `tests/toolkit/work-record-verifier.test.mjs`
- `tests/schemas/aos-work-record-v0.test.mjs`
- `tests/schemas/aos-playbook-step-v0.test.mjs`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `3b6696a`, and
`codex/playbook-harness-verifier-hardening` should be created from that commit.

Recent foundation commits include:

- `3b6696a feat: bridge playbook steps to work records`
- `7c199c4 docs: sketch playbook step v0 schema`
- `3cbec84 docs: document AOS action work record substrate`
- `d9fab5f feat: capture AOS action work records`
- `0c28bb2 docs: update work record v0 migration note`
- `f9dc018 docs: document work record capture profile`
- `446559f feat: capture command-backed work records`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Add a narrow Playbook harness module above the daemon. It should execute or
   simulate one Playbook step and emit Work Record v0 through the existing
   Playbook step bridge.
2. Require an explicit workflow gate token/ref before any execution path can run.
   Tests must prove ungated execution is rejected before action code is reached.
3. Keep the harness report-only. It may emit evidence, Work Records, and verifier
   diagnostics. It must not replay, repair, mutate records, or loop.
4. Reuse the existing named verifier profile:
   `aos.verifier.work-record.v0.report-only`.
5. Add deterministic fixtures/tests first. If live AOS execution enters scope,
   keep it bounded, cleanup-safe, and still gated.
6. Harden verifier diagnostics for these classes:
   target/ref drift, precondition failure, action failure, postcondition failure,
   evidence ref drift, and State ID inconsistency.
7. Keep diagnostics report-only. They may classify likely repairability but must
   not change the Work Record or execution map.
8. Preserve read-only Work Record workbench behavior.
9. Document the difference between:
   Playbook step template, harness run, Work Record evidence, verifier report,
   and future replay/repair.
10. Run the workflow router with focused `--files`, then run focused
    schema/toolkit tests, `bash tests/help-contract.sh` if public command docs
    changed, `git diff --check`, and `./aos ready`.
11. Commit in focused reversible slices. Do not wait until the entire combined
    goal is done to checkpoint.

## Acceptance Criteria

- A one-step Playbook harness API or module exists above the daemon.
- Ungated harness execution is rejected before any action path runs.
- A gated deterministic run emits a Playbook-origin Work Record v0 that validates
  and passes the named report-only verifier when evidence is good.
- Failure fixtures/tests produce verifier diagnostics for at least:
  target/ref drift, precondition failure, action failure, and postcondition
  failure.
- Diagnostics classify failures without mutating the Work Record.
- Docs explain report-only harness execution and future replay/repair boundaries.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos playbook`, `aos verify`, `aos audit`, or another broad command
  surface in this slice.
- Do not implement autonomous replay, repair, macro playback, or background
  loops.
- Do not build the wiki browser or browser-hosted Playbook UI.
- Keep the harness above the daemon and explicit-gate-only.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Harness + Verifier Hardening

1. Wire one browser-hosted Playbook prototype that emits Work Records without
   replaying automatically.
2. Add richer verifier evidence adapters for screenshots, DOM/AX fragments, and
   canvas state.
3. Split wiki document Subjects from domain Subjects in toolkit helpers.
4. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
