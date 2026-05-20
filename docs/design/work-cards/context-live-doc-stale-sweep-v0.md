# Work Card: context-live-doc-stale-sweep-v0

**Status:** Ready for implementation
**Owner:** GDI

## Tracker

Implementation follow-up for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `CONTEXT-MAP.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`

The validated Matt/context audit identified live sibling docs that still carry
stale claims after `ARCHITECTURE.md` and `CONTEXT.md` were corrected. The
context setup and map now make those conflicts easier to find; this slice fixes
the known live-doc conflicts only.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Align the known live docs with the current `ARCHITECTURE.md` / `CONTEXT.md`
wording for:

- `say` versus `tell human`;
- coordinate action target grammar and State ID handling;
- `screen:` / `ax:` target-dialect examples that need live-CLI qualification.

This is a documentation stale-sweep slice, not a behavior or architecture
change.

## Read First

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `docs/agents/domain.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `src/CLAUDE.md`
- `docs/api/aos.md`
- `docs/adr/0004-anchor-is-a-role-resolved-into-a-binding.md`
- `docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is docs-only. Do not run `./aos ready` unless you discover a need for live
runtime evidence, which is not expected.

## Branch/Base

branch_from: `origin/main`
required_start_ref: `origin/main`

This work card is present on `origin/main` after PR #368 merged. Start from
`origin/main` for this slice. Use `gdi/context-live-doc-stale-sweep-v0` as the
output branch if creating a separate GDI branch.

## Required Behavior

Update these live docs:

- `AGENTS.md`
- `src/CLAUDE.md`
- `docs/api/aos.md`
- `docs/adr/0004-anchor-is-a-role-resolved-into-a-binding.md`
- `docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md`

Apply these corrections:

- Replace unqualified "`say` is sugar for `tell human`" or "`tell human` is the
  same as `say`" wording. Use the current architecture distinction: `say` is a
  direct TTS convenience path conceptually aligned with speaking to the human;
  `tell human` is daemon-routed communication. Consumers that need routed
  communication, session metadata, channels, or future sinks should prefer
  `tell`.
- Update coordinate action wording that presents
  `screen:<state-id>/<x,y>` as the current live wire form. Current live
  coordinate actions use raw `x,y` plus optional `--state-id`; State ID still
  guards the action premise and is not yet enforced for stale-coordinate
  rejection.
- Qualify ADR-0004 target examples. `browser:` and `canvas:` remain live target
  dialects. `screen:` and `ax:` can remain target-model vocabulary only if the
  text says the current CLI exposes screen coordinates and AX actions through
  live command arguments/flags rather than those exact target strings.

## Scope

Edit only:

- `AGENTS.md`
- `src/CLAUDE.md`
- `docs/api/aos.md`
- `docs/adr/0004-anchor-is-a-role-resolved-into-a-binding.md`
- `docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not change Swift, JavaScript, schemas, tests, fixtures, or runtime
  behavior.
- Do not rewrite `ARCHITECTURE.md`, `CONTEXT.md`, or `CONTEXT-MAP.md`.
- Do not create the context maintenance SOP in this slice.
- Do not move or consolidate ADRs or decisions.
- Do not edit old archived specs or design notes just to remove historical
  wording.
- Do not open or update GitHub issues or PRs.

## Verification

Run:

```bash
git diff --check
rg -n "say.*sugar|same as aos say|screen:<state-id>/<x,y>|When tell gains new capabilities, say inherits them" AGENTS.md src/CLAUDE.md docs/api/aos.md docs/adr/0004-anchor-is-a-role-resolved-into-a-binding.md docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md
```

The `rg` command should produce no matches in the scoped live docs. If a match
remains, report why it is intentionally qualified and no longer stale.

No Swift rebuild and no live AOS smoke are required for this docs-only stale
sweep.

## Completion Report

Report:

- files changed;
- summary of each stale claim corrected;
- exact verification commands and pass/fail results;
- any remaining matches intentionally left with rationale;
- whether `ARCHITECTURE.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, SOP work, ADR
  namespace cleanup, source behavior, schemas, tests, fixtures, GitHub issues,
  and PRs were untouched;
- local-only state or unrelated dirty files.
