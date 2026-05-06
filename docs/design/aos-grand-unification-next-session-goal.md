# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-05

## Goal

Continue the AOS grand unification foundation work deliberately: turn the
resolved subject/work-record/playbook/verifier vocabulary into live,
schema-backed, testable runtime contracts without losing backward
compatibility.

The Work Record v0 schema-design slice is complete on `main` at `cd84141`
(`docs: sketch work record v0 schema`). The immediate next slice is the Work
Record runtime foundation: migrate live helper/read paths conservatively so AOS
can open, inspect, and verify v0 Work Records while preserving older Work
Record fixtures and toolkit behavior.

The target is tracked in GitHub issue #269:
`https://github.com/michaelblum/agent-os/issues/269`

Carry forward these resolved distinctions:

- Work Record is the durable execution artifact.
- Playbook, Recipe, and Workflow are reusable execution or orchestration
  artifacts that can emit Work Records.
- Claims live on the durable intent spine.
- Postconditions live in the repairable execution map.
- Claim Results are verifier output.
- Evidence is immutable.
- Replay or repair loops require explicit workflow gates.

Do not expand into wiki browser, broad UI refactors, or autonomous replay. This
session should make v0 Work Records survive contact with existing toolkit code.

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
`codex/work-record-runtime-foundation`, created from current `main` at
`cd84141`.

Recent foundation commits on `main` include:

- `cd84141 docs: sketch work record v0 schema`
- `c7ddce9 docs: restore session continuation docs`
- `579d33d docs: sketch subject capability schema`
- `65b0207 docs: align subject model terminology`
- `a5de521 docs: audit subject model compatibility drift`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Add a small compatibility adapter for Work Record payloads. It should read
   both legacy helper-shaped records and v0 schema-shaped records, normalize the
   parts needed by toolkit consumers, and preserve source data without lossy
   rewriting.
2. Update or wrap `packages/toolkit/workbench/work-record-subject.js` so
   `createWorkRecordSubject` can project v0 records into an
   `aos.workbench.subject` descriptor while preserving existing callers.
3. Add focused tests for legacy and v0 records. Existing toolkit Work Record
   tests must continue to pass.
4. Teach the Work Record workbench to open a v0 fixture read-only. It should
   expose intent, execution-map postconditions, evidence, claims, claim results,
   verifier report, and health without adding broad edit/save behavior yet.
5. Add the first report-only verifier bridge/checker over saved Work Record
   evidence. Start deterministic: validate internal refs, derive claim indexes
   from `claim_results[]`, and report diagnostics. Do not mutate records unless
   an explicit save/patch path is chosen in a later slice.
6. Run the workflow router with focused `--files`, then run the smallest
   relevant schema/toolkit tests plus `git diff --check`.
7. Commit in focused reversible slices. Do not wait until the entire epic is
   done to checkpoint.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not perform a broad toolkit/UI refactor in this session unless the user
  explicitly pivots. The current goal is Work Record runtime foundation.
- Do not change `aos.workbench.subject` live JSON Schema until the v-next shape
  and migration path are settled.
- Do not change wiki/domain helper behavior until Subject References and the
  wiki/domain split have schema examples and tests planned.
- Do not weaken the completed-record v0 contract silently. If draft or
  pre-verifier Work Records are needed, design that as an explicit lifecycle
  shape rather than making verifier output optional by accident.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.
- If visual or runtime surface work enters scope, verify through `./aos see/do`
  and respect the human-as-sensor rule when the user explicitly asks to inspect
  something themselves.

## Next Milestones After Runtime Foundation

1. Promote the report-only verifier bridge into a reusable AOS verifier profile.
2. Add Work Record capture from one real AOS action path.
3. Split wiki document Subjects from domain Subjects in toolkit helpers.
4. Move operation/event dotted strings from `capabilities[]` toward
   `contracts[]` only after consumers read both locations.
5. Implement the Browser-Hosted Wiki Subject Browser and browser playbooks only
   after Work Record evidence, verifier output, and subject descriptors are
   stable enough to avoid another drift loop.
