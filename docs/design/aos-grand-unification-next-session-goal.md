# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Add the first richer verifier evidence adapters for browser and canvas-style
artifacts.

The previous slice landed on `main` at `f0ad3e4`. AOS now has Work Record v0,
saved AOS action evidence, Playbook step v0, Playbook-origin Work Record
generation, report-only verifier diagnostics, an explicit-gate one-step
Playbook harness, and a browser-compatible Playbook prototype bridge that emits
read-only Work Records.

The immediate next workstream is tracked in GitHub issue #275:

```text
https://github.com/michaelblum/agent-os/issues/275
```

The target branch for the next session is:

```text
codex/verifier-evidence-adapters
```

The trust gap now is evidence quality. The report-only verifier should be able
to inspect deterministic structured evidence payloads for browser DOM/ARIA-like
semantic targets, AX/canvas-like semantic targets, and screenshot/artifact
metadata instead of only checking internal references.

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

If GitHub context is needed, inspect issue #275 after local state is known. An
open issue or PR is not automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current workstream sources:

- `CONTEXT.md`
- `docs/design/browser-playbook-prototype.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `packages/toolkit/workbench/work-record-verifier.js`
- `packages/toolkit/workbench/work-record-capture.js`
- `packages/toolkit/workbench/playbook-step-harness.js`
- `packages/toolkit/workbench/browser-playbook-prototype.js`
- `tests/toolkit/work-record-verifier.test.mjs`
- `tests/toolkit/browser-playbook-prototype.test.mjs`
- `tests/schemas/aos-work-record-v0.test.mjs`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `f0ad3e4`, and
`codex/verifier-evidence-adapters` should be created from that commit.

Recent foundation commits include:

- `f0ad3e4 feat: add browser playbook prototype bridge`
- `18b7ea6 feat: add gated playbook step harness`
- `034ecce feat: classify work record verifier diagnostics`
- `3b6696a feat: bridge playbook steps to work records`
- `7c199c4 docs: sketch playbook step v0 schema`
- `3cbec84 docs: document AOS action work record substrate`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Add narrow report-only evidence adapter helpers above the daemon. Keep them
   deterministic and fixture-backed first.
2. Support browser semantic target or DOM/ARIA-style evidence checks for
   postcondition kinds already used by Work Record fixtures.
3. Support one AX/canvas-like semantic target shape so the verifier contract is
   not browser-only.
4. Treat screenshot/artifact metadata as metadata only for this slice: presence,
   URI, digest, dimensions, or attachment metadata can be checked, but do not
   claim visual semantic understanding unless a deterministic image-check
   contract is added.
5. Wire adapters into `aos.verifier.work-record.v0.report-only` diagnostics so
   postconditions can be checked against evidence payloads where payloads are
   present.
6. Preserve existing verifier reference-integrity checks and failure classes.
7. Add valid and failing fixtures/tests for:
   target/ref drift, missing semantic target, value mismatch, role/name mismatch,
   and artifact metadata mismatch.
8. Keep all behavior report-only: no Work Record mutation, no execution-map
   patching, no replay, and no repair.
9. Document the evidence-adapter boundary and what remains out of scope.
10. Run the workflow router with focused `--files`, then run focused
    schema/toolkit tests, `bash tests/help-contract.sh` if public command docs
    changed, `git diff --check`, and `./aos ready`.
11. Commit in focused reversible slices.

## Acceptance Criteria

- Evidence adapter module/API exists above the daemon.
- Tests prove adapter-backed verification for browser semantic targets and one
  canvas/AX-like semantic target shape.
- Failing evidence fixtures produce clear report-only diagnostics with useful
  failure classes.
- Existing Work Record, Playbook harness, and browser prototype tests continue
  to pass.
- Docs explain the adapter boundary and why screenshots are metadata-only in
  this slice.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not implement autonomous replay, repair, macro playback, or background
  loops.
- Do not build the Wiki Subject Browser or general Playbook UI.
- Do not make screenshots a source of unverifiable visual claims beyond metadata
  unless a deterministic image-check contract is added.
- Keep generated Work Records report-only and read-only.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Evidence Adapters

1. Split wiki document Subjects from domain Subjects in toolkit helpers.
2. Promote the browser prototype into a browser-hosted Playbook workbench only
   after evidence-adapter diagnostics prove stable.
3. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
