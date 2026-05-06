# AOS Grand Unification Next Session Goal

**Status:** handoff goal for bounded Workbench Subject v-next cutover
**Date:** 2026-05-06

## Goal

Make the Workbench Subject v-next descriptor shape canonical for live writers
and live consumers.

The previous Playbook Workbench V0 slice landed on `main` at `b85774b`. The
interrupted #281 path started migrating representative consumers to
compatibility readers, but that compatibility-first route is now superseded.
Because agent-os is still early-stage and no concrete external or persisted
compatibility requirement has been identified, the next practical slice should
cut over live code to the canonical v-next descriptor shape instead of
extending legacy compatibility layers.

The superseding workstream is tracked in GitHub issue #282:

```text
https://github.com/michaelblum/agent-os/issues/282
```

The superseded compatibility-reader issue is #281:

```text
https://github.com/michaelblum/agent-os/issues/281
```

The target branch for the next implementation session is:

```text
codex/workbench-subject-vnext-cutover
```

## Required Rediscovery

Do not assume branch, worktree, PR, issue, daemon, canvas, or dirty state from
prior summaries. Start by reading `AGENTS.md`, then rediscover state:

```bash
git status --short --branch
git worktree list
git branch --format='%(refname:short)' | sort
./aos ready
./aos show list --json
./aos dev recommend --json
gh issue view 282 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the cutover steering and current subject model sources:

- `docs/design/workbench-subject-vnext-cutover-foreman-note.md`
- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/wiki-subject-opening.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/workbench/browser-playbook-prototype.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/playbook-workbench/model.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts may exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

GitNexus is useful as a research signal for graph/index ideas, not as an AOS
architecture authority:

```text
https://github.com/abhigyanpatwari/GitNexus
```

## Current Checkpoint

At this handoff, `main` is expected to include:

- `b85774b feat: add playbook workbench v0 shell`
- `3c5fcdb feat: add wiki subject browser v0 shell`
- `b2b9622 feat: add wiki subject opening bridge`
- `60ef457 feat: move subject writers to contracts`
- `851263a feat: emit concrete subject facets`
- `7361920 feat: add workbench subject vnext compatibility`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit live raw reads and writers for `views[]`, `controls[]`, dotted
   `capabilities[]`, `contracts[]`, `facets[]`, `facets[].hosts[]`, and
   `subject_references[]`.
2. Classify each hit before editing:
   - **live writer**: should emit canonical v-next fields;
   - **live consumer**: should derive affordances from canonical fields;
   - **fixture/schema compatibility**: should remain only if it tests an
     explicit boundary;
   - **persisted/import boundary**: may keep one adapter if evidence requires
     legacy input;
   - **unrelated domain field**: leave it alone.
3. Move live writers to the canonical shape:
   - high-level registry names in `capabilities[]`;
   - operation/event strings in `contracts[]`;
   - projections in `facets[]`;
   - host implementations in `facets[].hosts[]`;
   - typed links in `subject_references[]`.
4. Stop emitting legacy `views[]` and `controls[]` from live writers unless a
   concrete persisted/import adapter requires them.
5. Migrate representative live consumers to use canonical fields directly.
   Do not preserve compatibility merely because old in-repo code still reads
   old fields.
6. Keep at most one explicit legacy adapter for archived fixtures or old
   persisted records if implementation evidence proves it is needed.
7. Update schema, docs, and tests so legacy fields are intentional boundary
   behavior rather than the live model.
8. Run the workflow router with focused `--files`, focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. Commit in focused reversible slices.

## Acceptance Criteria

- Live Workbench Subject writers emit the canonical v-next descriptor shape.
- Representative live consumers no longer depend on `views[]`, `controls[]`,
  or dotted operation strings in raw `capabilities[]`.
- Legacy descriptor handling is removed from live code or isolated behind an
  explicit, documented adapter boundary with tests.
- Docs and schemas state the canonical model clearly enough that future work
  does not keep extending the old compatibility layer by default.
- Focused and router-selected verification passes.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add new public `aos` command surface.
- Do not add replay, repair, macro playback, background loops, or live browser
  execution in this slice.
- Do not perform a broad workbench rewrite beyond the bounded Subject
  descriptor cutover.
- Do not migrate unrelated domain fields named `controls` or `views`.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Cutover

1. Extend the browser-hosted Subject Browser beyond wiki pages only after the
   canonical descriptor contract is stable in live consumers.
2. Add live browser execution only behind a separate Workflow-gated design and
   verifier plan.
3. Retire any remaining legacy descriptor adapters once persisted/import
   evidence shows they are no longer needed.
