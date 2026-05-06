# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Add backward-compatible v-next fields and compatibility helpers for
`aos.workbench.subject`.

The previous slice landed on `main` at `d56a44a`. AOS now has stable wiki
document Subjects, a separate Sigil agent domain Subject helper, and an explicit
compatibility bridge where Sigil domain Subjects reference their source wiki
document through `metadata.subject_references[]` because the live
`2026-05-03` schema does not yet allow a top-level Subject Reference field.

The immediate next workstream is tracked in GitHub issue #276:

```text
https://github.com/michaelblum/agent-os/issues/276
```

The target branch for the next session is:

```text
codex/workbench-subject-vnext-fields
```

The trust gap now is schema compatibility. The ADR/glossary pass defines the
target subject descriptor shape (`subject_references[]`, `facets[]`,
`facets[].hosts[]`, and `contracts[]`), but live helpers still emit the older
shape with `views[]`, `controls[]`, and dotted operation/event contracts mixed
into `capabilities[]`. The next slice should add optional v-next fields and
reader/writer compatibility helpers without breaking existing `2026-05-03`
descriptors or forcing the full Wiki Subject Browser into scope.

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

Inspect GitHub issue #276 after local state is known. An open issue or PR is not
automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current subject-model sources:

- `CONTEXT.md`
- `docs/adr/0001-facets-belong-to-layers.md`
- `docs/adr/0005-subjects-are-host-neutral-facets-declare-hosts.md`
- `docs/adr/0007-subject-type-is-kind-not-projection.md`
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
- `apps/sigil/radial-item-editor/model.js`
- `tests/schemas/aos-workbench-subject.test.mjs`
- `tests/toolkit/workbench-subject.test.mjs`
- `tests/toolkit/wiki-subject.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`
- `tests/renderer/radial-item-editor.test.mjs`
- adjacent workbench subject tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `d56a44a`, and
`codex/workbench-subject-vnext-fields` should be created from that commit.

Recent foundation commits include:

- `d56a44a feat: split wiki and sigil subject helpers`
- `1b26ba6 docs: document work record evidence adapter boundary`
- `c7f0939 feat: add work record evidence adapters`
- `f0ad3e4 feat: add browser playbook prototype bridge`
- `18b7ea6 feat: add gated playbook step harness`
- `034ecce feat: classify work record verifier diagnostics`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit the active schema and subject helpers for the legacy fields:
   `capabilities[]`, `views[]`, `controls[]`, and
   `metadata.subject_references[]`.
2. Add optional schema support for v-next fields where safe:
   `subject_references[]`, `facets[]`, `facets[].hosts[]`, and `contracts[]`.
   Keep required identity fields and current descriptors backward-compatible.
3. Add toolkit compatibility helpers that normalize both legacy and v-next
   descriptors. The helpers should make it easy for consumers to read:
   high-level capabilities, dotted operation/event contracts, Subject
   References, Facets, Host entries, legacy views, and legacy controls.
4. Preserve `views[]` and `controls[]` as legacy summaries. Do not force
   consumers to derive all UI affordances from Facets in this slice.
5. Treat dotted strings currently in `capabilities[]` as legacy operation
   contracts. Add `contracts[]` for new writers while preserving reader
   compatibility for older descriptors.
6. Move or bridge `createSigilAgentSubject()` from
   `metadata.subject_references[]` to top-level `subject_references[]` once the
   schema allows it. Keep a tested compatibility fallback if older consumers
   still inspect metadata.
7. Add representative schema/helper tests for:
   - wiki document Subjects;
   - Sigil domain Subjects;
   - Work Record Subjects;
   - radial item Subjects;
   - legacy descriptors with dotted strings only in `capabilities[]`;
   - v-next descriptors with `contracts[]`, `subject_references[]`, and Facets.
8. Update docs/API wording to define the reader/writer migration policy.
9. Run the workflow router with focused `--files`, then run focused schema and
   toolkit tests, `bash tests/help-contract.sh` if public command docs or CLI
   contracts changed, `git diff --check`, and `./aos ready`.
10. Commit in focused reversible slices.

## Acceptance Criteria

- Schema validation accepts optional v-next fields without rejecting current
  `2026-05-03` descriptors.
- Toolkit helpers expose a clear compatibility API for capabilities,
  contracts, Subject References, Facets, Host entries, legacy views, and legacy
  controls.
- `createSigilAgentSubject()` uses top-level `subject_references[]` or a tested
  top-level-plus-metadata bridge.
- Legacy dotted operation/event strings remain readable from `capabilities[]`,
  while new descriptors can use `contracts[]`.
- Existing wiki, markdown, work-record, radial item, Playbook, verifier, and
  evidence-adapter tests continue to pass when selected by the router.
- No full Wiki Subject Browser, browser UI, autonomous replay, repair, macro
  playback, or new `aos` command surface is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not build the Wiki Subject Browser or general Playbook UI.
- Do not remove `views[]`, `controls[]`, or legacy dotted `capabilities[]`
  support in this slice.
- Keep schema changes optional and backward-compatible unless the task explicitly
  includes a migration with fixtures, adapters, and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After V-Next Subject Fields

1. Migrate selected live helpers to emit Facets and Host entries where the shape
   is obvious and well-tested.
2. Move legacy dotted operation/event strings from `capabilities[]` toward
   `contracts[]` in individual helpers once all readers use the compatibility
   API.
3. Promote the browser prototype into a browser-hosted Playbook workbench only
   after subject references and evidence-adapter diagnostics prove stable.
4. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
