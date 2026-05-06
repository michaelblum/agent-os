# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Promote the completed AOS action Work Record capture into the first concrete
Playbook step grammar and Work Record origin bridge.

The previous slice landed on `main` at `3cbec84`. AOS can now take saved browser
`see -> do -> see` action evidence, generate Work Record v0, run the named
report-only verifier profile, validate the generated fixture, and open it
read-only in the Work Record workbench.

The immediate next slice is tracked in GitHub issue #272:

```text
https://github.com/michaelblum/agent-os/issues/272
```

The target branch for the next session is:

```text
codex/playbook-step-grammar
```

Build the smallest serious Playbook template layer above the proven evidence
path. A Playbook step is reusable execution knowledge. A Work Record is the
evidence log from one run. This session should define and test that bridge
without implementing autonomous replay, repair, macro playback, or a broad CLI
command surface.

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

If GitHub context is needed, inspect issue #272 after local state is known. An
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
- `packages/toolkit/workbench/work-record-capture.js`
- `packages/toolkit/workbench/work-record-verifier.js`
- `tests/toolkit/work-record-capture.test.mjs`
- `tests/schemas/aos-work-record-v0.test.mjs`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `3cbec84`, and
`codex/playbook-step-grammar` should be created from that commit.

Recent foundation commits include:

- `3cbec84 docs: document AOS action work record substrate`
- `d9fab5f feat: capture AOS action work records`
- `0c28bb2 docs: update work record v0 migration note`
- `f9dc018 docs: document work record capture profile`
- `446559f feat: capture command-backed work records`
- `985b680 feat: open work record v0 fixtures read-only`
- `4b04c89 feat: add work record v0 adapter and checker`
- `cd84141 docs: sketch work record v0 schema`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Define a minimal Playbook step v0 contract for:
   `see -> resolve -> do -> see -> verify`.
2. Keep the Playbook step as a reusable template and the Work Record as the run
   evidence. Do not collapse the two artifacts.
3. Represent step preconditions, target-resolution, action, postconditions,
   repair hints, and replay gates explicitly.
4. Define how a step postcondition can be promoted into a Work Record Claim. The
   Claim remains the durable intent assertion; the Postcondition remains the
   repairable execution-map check.
5. Add one realistic Playbook step fixture based on the existing browser
   click/status AOS action evidence.
6. Add one corresponding generated Work Record v0 fixture with
   `origin.kind: "playbook"` and `origin.ref` pointing back to the Playbook step
   or Playbook Subject handle.
7. Add a narrow builder/normalizer that combines a Playbook step descriptor plus
   saved AOS action evidence into Work Record v0, reusing
   `aos.verifier.work-record.v0.report-only`.
8. Add schema/toolkit tests that prove target refs, State IDs, evidence refs,
   postcondition refs, Claim Results, Verifier Report, Health, and workflow gates
   survive the bridge.
9. Keep generated Playbook-origin Work Records read-only in the existing Work
   Record workbench path.
10. Document the distinction between Playbook template and Work Record run
    evidence at the schema/design boundary.
11. Run the workflow router with focused `--files`, then run focused
    schema/toolkit tests, `bash tests/help-contract.sh` if public docs/contracts
    changed, `git diff --check`, and `./aos ready`.
12. Commit in focused reversible slices. Do not wait until the entire epic is
    done to checkpoint.

## Acceptance Criteria

- A Playbook step v0 schema or schema sketch exists with valid and invalid
  fixtures.
- The browser click/status Playbook step fixture declares preconditions,
  target-resolution, action, postconditions, repair hints, and claim-promotion
  metadata.
- A Playbook-origin generated Work Record v0 validates and passes
  `aos.verifier.work-record.v0.report-only`.
- Tests prove the builder preserves `origin.kind: "playbook"`, `origin.ref`,
  evidence refs, postcondition refs, Claim Results, Verifier Report, Health, and
  replay/repair workflow gates.
- Docs clearly distinguish Playbook template from Work Record run evidence.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not implement autonomous replay, repair, or macro playback.
- Do not add `aos playbook`, `aos verify`, `aos audit`, or other broad command
  surface in this slice.
- Do not build the wiki browser or a browser-hosted Playbook UI yet.
- Do not weaken Work Record v0 by making verifier output optional for completed
  records.
- Keep this above the daemon; use saved evidence and deterministic tests first.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Playbook Step Grammar

1. Add a report-only Playbook harness prototype that can execute one step only
   under an explicit workflow gate and emit a Work Record.
2. Add verifier checks that distinguish selector/ref drift from failed intent.
3. Wire a browser-hosted Playbook prototype that emits Work Records without
   replaying automatically.
4. Split wiki document Subjects from domain Subjects in toolkit helpers.
5. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
