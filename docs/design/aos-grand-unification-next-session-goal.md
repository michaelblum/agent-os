# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-05

## Goal

Continue the AOS grand unification foundation work deliberately: turn the
resolved subject/work-record/playbook/verifier vocabulary into a real
evidence-backed capture and verification loop without adding autonomous replay
or broad command-surface sprawl.

The Work Record runtime foundation is complete on `main` at `985b680`. AOS can
now read Work Record v0 payloads, project them as workbench Subjects, open them
read-only in the Work Record workbench, and run a deterministic report-only
checker.

The immediate next slice is Work Record capture + verifier profile: generate a
realistic Work Record v0 from a bounded AOS-shaped work unit, run a named
report-only verifier profile over it, and inspect the result through existing
workbench paths.

The target is tracked in GitHub issue #270:
`https://github.com/michaelblum/agent-os/issues/270`

Carry forward these resolved distinctions:

- Work Record is the durable execution artifact.
- Playbook, Recipe, and Workflow are reusable execution or orchestration
  artifacts that can emit Work Records.
- Claims live on the durable intent spine.
- Postconditions live in the repairable execution map.
- Claim Results are verifier output.
- Evidence is immutable.
- Replay or repair loops require explicit workflow gates.

Do not expand into wiki browser, broad UI refactors, broad CLI nouns, or
autonomous replay. This session should prove that AOS can produce and verify a
Work Record from actual evidence, not just hand-authored fixtures.

## Required Rediscovery

Do not assume branch, worktree, PR, issue, daemon, or canvas state from any prior
session. Start by reading `AGENTS.md`, then rediscover state:

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

If GitHub context is needed, inspect relevant open PRs/issues after local state
is known. An open issue or PR is not automatically current.

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
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `docs/design/worktree-session-scope.md`
- ADRs `docs/adr/0001-*` through `docs/adr/0010-*`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, the active branch is expected to be
`codex/work-record-capture-verify`, created from current `main` at `985b680`.

Recent foundation commits on `main` include:

- `985b680 feat: open work record v0 fixtures read-only`
- `4b04c89 feat: add work record v0 adapter and checker`
- `cd84141 docs: sketch work record v0 schema`
- `c7ddce9 docs: restore session continuation docs`
- `579d33d docs: sketch subject capability schema`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Promote the report-only checker shape into a named verifier profile
   contract. Keep it above the daemon and report-only.
2. Add a small builder/normalizer that can produce Work Record v0 from one
   bounded AOS-shaped evidence source. Prefer deterministic repo command/test
   evidence or a saved `see/do/see` fixture before live browser complexity.
3. Add one realistic generated Work Record fixture. It should validate against
   `aos-work-record-v0.schema.json`, pass the verifier profile, and include
   meaningful targets/state ids or command evidence, immutable evidence,
   Claims, Postconditions, Claim Results, Verifier Report, and Health.
4. Ensure the generated record opens read-only through the existing Work Record
   workbench model path. Add rendered/live `./aos show` verification only if the
   implementation changes rendered behavior.
5. Document how the capture + verify path becomes the substrate for future
   browser playbooks without implementing replay yet.
6. Run the workflow router with focused `--files`, then run the smallest
   relevant schema/toolkit tests plus `git diff --check`.
7. Commit in focused reversible slices. Do not wait until the entire epic is
   done to checkpoint.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not perform a broad toolkit/UI refactor in this session unless the user
  explicitly pivots. The current goal is Work Record capture and verification.
- Do not change `aos.workbench.subject` live JSON Schema until the v-next shape
  and migration path are settled.
- Do not change wiki/domain helper behavior until Subject References and the
  wiki/domain split have schema examples and tests planned.
- Do not weaken the completed-record v0 contract silently. If draft or
  pre-verifier Work Records are needed, design that as an explicit lifecycle
  shape rather than making verifier output optional by accident.
- Do not add broad command surface such as `aos audit` unless a smaller
  existing surface cannot host the behavior.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.
- If visual or runtime surface work enters scope, verify through `./aos see/do`
  and respect the human-as-sensor rule when the user explicitly asks to inspect
  something themselves.

## Next Milestones After Capture + Verify

1. Capture Work Records from one live AOS browser or canvas action path.
2. Wire verified Work Records into a browser Playbook prototype.
3. Split wiki document Subjects from domain Subjects in toolkit helpers.
4. Move operation/event dotted strings from `capabilities[]` toward
   `contracts[]` only after consumers read both locations.
5. Implement the Browser-Hosted Wiki Subject Browser and browser playbooks only
   after Work Record evidence, verifier output, and subject descriptors are
   stable enough to avoid another drift loop.
