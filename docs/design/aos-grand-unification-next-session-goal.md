# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Move selected Workbench Subject writers from dotted operation strings in raw
`capabilities[]` toward explicit `contracts[]`.

The previous slice landed on `main` at `851263a`. AOS now has optional
v-next subject fields, compatibility readers, and selected live helpers emitting
concrete Facets and Host entries. The next step is to reduce the remaining
schema ambiguity: writer helpers should use `capabilities[]` for high-level
capability classes and `contracts[]` for dotted operation/event contracts, while
legacy readers continue to accept older descriptors.

The immediate next workstream is tracked in GitHub issue #278:

```text
https://github.com/michaelblum/agent-os/issues/278
```

The target branch for the next session is:

```text
codex/workbench-subject-contract-writers
```

The trust gap now is writer clarity. Consumers can read both legacy and v-next
descriptor shapes, but many helper outputs still duplicate dotted operation
strings in raw `capabilities[]`. That keeps the old ambiguity alive and makes it
harder for Subject Browsers, verifiers, and workbench consumers to use
capabilities as high-level negotiation contracts.

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

Inspect GitHub issue #278 after local state is known. An open issue or PR is not
automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current subject-model sources:

- `CONTEXT.md`
- `docs/adr/0010-capabilities-are-named-contracts-not-buttons-or-facets.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/sigil-subject.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/workbench/workflow-subject.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- `apps/sigil/radial-item-editor/model.js`
- `tests/schemas/aos-workbench-subject.test.mjs`
- `tests/toolkit/workbench-subject.test.mjs`
- `tests/toolkit/wiki-subject.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`
- `tests/toolkit/work-record-subject.test.mjs`
- `tests/toolkit/workflow-subject.test.mjs`
- `tests/toolkit/markdown-workbench-model.test.mjs`
- `tests/renderer/radial-item-editor.test.mjs`
- adjacent workbench subject tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `851263a`, and
`codex/workbench-subject-contract-writers` should be created from that commit.

Recent foundation commits include:

- `851263a feat: emit concrete subject facets`
- `7361920 feat: add workbench subject vnext compatibility`
- `d56a44a feat: split wiki and sigil subject helpers`
- `1b26ba6 docs: document work record evidence adapter boundary`
- `c7f0939 feat: add work record evidence adapters`
- `f0ad3e4 feat: add browser playbook prototype bridge`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit all current Workbench Subject writer helpers and tests that assert
   dotted operation/event strings directly in raw `subject.capabilities`.
2. Keep `subjectContracts(subject)` backward-compatible: it must continue to
   read dotted strings from both `contracts[]` and legacy `capabilities[]`.
3. Move a small representative set of writer outputs toward the target shape:
   - wiki document Subjects;
   - Sigil agent domain Subjects;
   - Work Record Subjects;
   - workflow Subjects;
   - markdown workbench Subjects;
   - radial item Subjects, if the change stays focused and testable.
4. For migrated writers, raw `capabilities[]` should contain high-level names
   from the registry such as `inspectable`, `editable`, `verifier-target`,
   `replayable`, and `exportable`.
5. Move dotted operation/event strings to top-level `contracts[]` and
   Facet-local `contracts[]` where appropriate.
6. Update tests to assert operation contracts through `subjectContracts()` and
   high-level capability classes through `subjectCapabilities()` or
   `subjectSupportsCapability()`. Avoid new raw `capabilities.includes("x.y")`
   assertions unless deliberately testing legacy compatibility.
7. Preserve `views[]`, `controls[]`, Facets, Host entries, Subject References,
   and existing compatibility readers.
8. Update docs/API migration guidance with before/after examples and explicit
   compatibility policy.
9. Run the workflow router with focused `--files`, then run focused schema and
   toolkit/renderer tests, `bash tests/help-contract.sh` if public command docs
   or CLI contracts changed, `git diff --check`, and `./aos ready`.
10. Commit in focused reversible slices.

## Acceptance Criteria

- Selected writer helpers no longer duplicate dotted operation/event strings in
  raw `capabilities[]` unless a compatibility exception is documented and
  tested.
- `subjectCapabilities()` returns high-level capability classes for migrated
  descriptors.
- `subjectContracts()` returns the full operation/event contract set for both
  migrated and legacy descriptors.
- Tests prove legacy descriptors with dotted strings in `capabilities[]` still
  read correctly.
- Existing schema, toolkit, renderer, Playbook, verifier, evidence-adapter, and
  help-contract tests continue to pass when selected by the router.
- No full Wiki Subject Browser, browser UI, autonomous replay, repair, macro
  playback, or new `aos` command surface is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not build the Wiki Subject Browser or general Playbook UI.
- Do not remove compatibility reading for legacy dotted `capabilities[]`.
- Do not remove `views[]`, `controls[]`, Facets, Hosts, or Subject References.
- Keep schema changes optional and backward-compatible unless the task explicitly
  includes a migration with fixtures, adapters, and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Contract Writer Migration

1. Add a small browser-hosted subject opening prototype only after the helper
   descriptors consistently expose capabilities, contracts, facets, hosts, and
   references through the compatibility API.
2. Promote the browser Playbook prototype into a browser-hosted Playbook
   workbench only after subject references and evidence-adapter diagnostics
   prove stable.
3. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
