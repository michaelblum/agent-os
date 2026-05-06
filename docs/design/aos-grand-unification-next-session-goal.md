# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Continue the AOS grand unification foundation work by moving from command-backed
Work Records to one bounded live AOS action capture:

```text
see -> do -> see -> record -> verify
```

The previous capture/verifier slice landed on `main` at `0c28bb2`. AOS can now
generate a Work Record v0 from bounded repo command evidence, run the named
report-only verifier profile, open generated v0 records read-only in the Work
Record workbench, and keep replay/repair behind explicit workflow gates.

The immediate next slice is tracked in GitHub issue #271:

```text
https://github.com/michaelblum/agent-os/issues/271
```

The target branch for the next session is:

```text
codex/work-record-live-action-capture
```

Build the smallest serious proof that an actual AOS-observed/actioned surface can
emit Work Record v0 evidence. Keep this above the daemon and report-only. Do not
implement autonomous replay, repair, wiki-browser work, or broad new command
surface.

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

If GitHub context is needed, inspect issue #271 after local state is known. An
open issue or PR is not automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current workstream sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `shared/schemas/aos-subject-capabilities.md`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-work-record-v0.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `docs/design/worktree-session-scope.md`
- ADRs `docs/adr/0001-*` through `docs/adr/0010-*`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `0c28bb2`, and
`codex/work-record-live-action-capture` should be created from that commit.

Recent foundation commits include:

- `0c28bb2 docs: update work record v0 migration note`
- `f9dc018 docs: document work record capture profile`
- `446559f feat: capture command-backed work records`
- `985b680 feat: open work record v0 fixtures read-only`
- `4b04c89 feat: add work record v0 adapter and checker`
- `cd84141 docs: sketch work record v0 schema`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Choose one deterministic live AOS surface and action path. Prefer a stable
   toolkit/browser-compatible or canvas-backed surface with semantic refs and
   minimal visual dependency.
2. Capture or fixture a bounded AOS action source that contains:
   before perception, action metadata, after perception, target dialect,
   Target-with-Ref, State ID where available, and immutable evidence refs.
3. Add a source-specific builder above the daemon, likely
   `buildWorkRecordV0FromAosActionEvidence()` or an equivalent narrow adapter,
   that emits Work Record v0 from the saved AOS action evidence.
4. Emit Claims, Postconditions, Claim Results, Verifier Report, Health, and
   replay/repair workflow gates using the same v0 contract that command evidence
   now uses.
5. Run the existing named profile
   `aos.verifier.work-record.v0.report-only`; extend the deterministic checker
   only where the AOS action evidence shape requires it.
6. Add one generated fixture from the saved AOS action evidence and tests that
   prove the generated output matches the fixture, validates against the schema,
   and passes the named verifier profile.
7. Ensure the generated live-action Work Record opens read-only through the
   existing Work Record workbench model path with no patch capability.
8. Document how this evidence source becomes the first Playbook-step substrate
   without implementing replay or repair.
9. Run the workflow router with focused `--files`, then run the smallest relevant
   toolkit/schema tests, `bash tests/help-contract.sh` if docs/contracts changed,
   `git diff --check`, and `./aos ready`.
10. Commit in focused reversible slices. Do not wait until the entire epic is
    done to checkpoint.

## Acceptance Criteria

- A generated Work Record v0 fixture from AOS action evidence validates against
  `shared/schemas/aos-work-record-v0.schema.json`.
- The fixture passes `runWorkRecordVerifierProfile(..., profileId:
  "aos.verifier.work-record.v0.report-only")`.
- The fixture records at least one before/after perception pair, one bounded
  action, and one postcondition tied to post-action evidence.
- Evidence is immutable and report-only; replay and repair remain workflow-gated.
- Work Record workbench model tests prove the generated record opens read-only
  without patch capability.
- If a live display/runtime check is used, it goes through `./aos show/see/do`
  and cleans up any temporary canvas.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add broad command surface such as `aos audit` or `aos verify` in this
  slice.
- Do not implement autonomous replay or repair.
- Do not broaden into the wiki browser, subject-browser UX, or a toolkit-wide UI
  refactor.
- Do not change `aos.workbench.subject` live JSON Schema until the v-next shape
  and migration path are settled.
- Do not weaken the completed-record v0 contract silently. If draft or
  pre-verifier Work Records are needed, design that as an explicit lifecycle
  shape rather than making verifier output optional by accident.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.
- If visual or runtime surface work enters scope, verify through `./aos see/do`
  and respect the human-as-sensor rule when the user explicitly asks to inspect
  something themselves.

## Next Milestones After Live AOS Action Capture

1. Promote the live action evidence shape into the first Playbook step grammar.
2. Wire a browser-hosted Playbook prototype that emits Work Records without
   replaying automatically.
3. Add verifier checks that distinguish selector/ref drift from failed intent.
4. Split wiki document Subjects from domain Subjects in toolkit helpers.
5. Implement the Browser-Hosted Wiki Subject Browser only after Work Record
   evidence, verifier output, and subject descriptors are stable enough to avoid
   another drift loop.
