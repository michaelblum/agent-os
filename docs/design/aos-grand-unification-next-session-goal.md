# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-05

## Goal

Continue the AOS grand unification foundation work deliberately: turn the
resolved subject/work-record/playbook/verifier vocabulary into schema-backed,
testable contracts before migrating live toolkit helpers or UI surfaces.

The immediate next slice is a Work Record v0 schema-design pass. Define the
shape for `origin`, `references[]`, `claims[]`, `postconditions`,
`claim_results[]`, `verifier_report`, and verifier health using the already
resolved distinctions:

- Work Record is the durable execution artifact.
- Playbook, Recipe, and Workflow are reusable execution or orchestration
  artifacts that can emit Work Records.
- Claims live on the durable intent spine.
- Postconditions live in the repairable execution map.
- Claim Results are verifier output.
- Evidence is immutable.
- Replay or repair loops require explicit workflow gates.

Do not migrate `packages/toolkit/workbench/work-record-subject.js` until the
schema sketch and examples are coherent.

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
`codex/toolkit-style-contracts`, with recent focused commits:

- `579d33d docs: sketch subject capability schema`
- `65b0207 docs: align subject model terminology`
- `a5de521 docs: audit subject model compatibility drift`
- `5e39371 chore: enable codex goals setting`
- `67dca25 docs: codify subject vocabulary decisions`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Draft a Work Record v0/v-next schema sketch, preferably under
   `shared/schemas/`, that defines the contract in JSON-like examples before
   changing runtime code.
2. Include at least two examples:
   - an ad-hoc Work Record with no reusable origin;
   - a Playbook-origin Work Record with `origin.kind: "playbook"` and
     references to Claims/Postconditions/Claim Results.
3. Update `CONTEXT.md` and
   `docs/design/aos-subject-model-compatibility-audit.md` only enough to point
   at the new sketch and mark the design gap narrowed.
4. Run the workflow router, then run the smallest recommended verification.
   For docs/schema sketches, expect `git diff --check` and
   `node --test tests/schemas/*.test.mjs`; run help-contract only if public CLI
   docs or command examples changed.
5. Commit the slice separately with a narrow message.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not perform a broad toolkit/UI refactor in this session unless the user
  explicitly pivots. The current goal is schema/design hardening.
- Do not change `aos.workbench.subject` live JSON Schema until the v-next shape
  and migration path are settled.
- Do not change wiki/domain helper behavior until Subject References and the
  wiki/domain split have schema examples and tests planned.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.
- If visual or runtime surface work enters scope, verify through `./aos see/do`
  and respect the human-as-sensor rule when the user explicitly asks to inspect
  something themselves.

## Next Milestones After Work Record Schema

1. Add a verifier report schema sketch and decide whether it lives inside the
   Work Record sketch or as a separate schema note.
2. Add backward-compatible optional fields to helpers and fixtures.
3. Split wiki document Subjects from domain Subjects in toolkit helpers.
4. Move operation/event dotted strings from `capabilities[]` toward
   `contracts[]` only after consumers read both locations.
5. Implement the Browser-Hosted Wiki Subject Browser and browser playbooks only
   after the descriptor contracts are stable enough to avoid another drift loop.
