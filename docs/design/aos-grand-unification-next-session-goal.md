# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Emit concrete Facets and Host entries from selected live
`aos.workbench.subject` helpers.

The previous slice landed on `main` at `7361920`. AOS now has optional schema
support for `contracts[]`, `subject_references[]`, `facets[]`, and
`facets[].hosts[]`, plus compatibility readers that preserve legacy
`views[]`, `controls[]`, and dotted operation/event strings in
`capabilities[]`. The next step is to make those v-next fields useful in real
descriptors instead of leaving them as schema-only scaffolding.

The immediate next workstream is tracked in GitHub issue #277:

```text
https://github.com/michaelblum/agent-os/issues/277
```

The target branch for the next session is:

```text
codex/workbench-subject-facets-hosts
```

The trust gap now is projection quality. Consumers can technically read Facets
and Host entries, but most live helpers still communicate projections through
legacy `views[]` / `controls[]` summaries. The next slice should migrate a small
representative set of helpers to emit concrete Facets with Layer membership,
operation contracts, and Host entries while preserving all legacy summaries.

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

Inspect GitHub issue #277 after local state is known. An open issue or PR is not
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
- `tests/toolkit/work-record-subject.test.mjs`
- `tests/toolkit/workflow-subject.test.mjs`
- `tests/renderer/radial-item-editor.test.mjs`
- adjacent workbench subject tests selected by `./aos dev recommend`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `7361920`, and
`codex/workbench-subject-facets-hosts` should be created from that commit.

Recent foundation commits include:

- `7361920 feat: add workbench subject vnext compatibility`
- `d56a44a feat: split wiki and sigil subject helpers`
- `1b26ba6 docs: document work record evidence adapter boundary`
- `c7f0939 feat: add work record evidence adapters`
- `f0ad3e4 feat: add browser playbook prototype bridge`
- `18b7ea6 feat: add gated playbook step harness`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit the current helper outputs and tests for existing `views[]`,
   `controls[]`, `contracts[]`, and source/persistence information.
2. Add Facets and Host entries only where the shape is obvious and already
   implied by existing descriptor fields. Prefer a small high-confidence set
   over broad speculative modeling.
3. Start with these representative helpers:
   - wiki document Subjects from `wiki-subject.js`;
   - Sigil agent domain Subjects from `sigil-subject.js`;
   - Work Record Subjects from `work-record-subject.js`;
   - radial item Subjects from `apps/sigil/radial-item-editor/model.js`.
4. For wiki document Subjects, model markdown narrative/source, markdown preview,
   and graph/outline-style projections where existing legacy views already name
   them.
5. For Sigil agent domain Subjects, model the narrative Facet backed by its
   Subject Reference plus Sigil preview/control Facets where existing legacy
   views/controls already name them.
6. For Work Record and radial item Subjects, add Facets only for stable
   descriptor, controls, artifacts/evidence, health, or preview projections that
   current helpers already expose.
7. Host entries should describe Browser Host or Canvas Host assumptions and
   target dialects, but must not invent runtime routes or launch behavior that
   does not exist. Use documented `aos://...` entries only when there is a real
   component URL or current helper/source to support it.
8. Preserve `views[]`, `controls[]`, legacy dotted `capabilities[]`, and
   existing `contracts[]` output. This slice is additive.
9. Use the compatibility readers in tests: `subjectFacets()`, `subjectHosts()`,
   `subjectContracts()`, `subjectReferences()`, `subjectLegacyViews()`, and
   `subjectLegacyControls()`.
10. Update docs/API migration wording with concrete helper examples and the
    boundary between descriptive Host metadata and actual runtime launch.
11. Run the workflow router with focused `--files`, then run focused schema and
    toolkit/renderer tests, `bash tests/help-contract.sh` if public command docs
    or CLI contracts changed, `git diff --check`, and `./aos ready`.
12. Commit in focused reversible slices.

## Acceptance Criteria

- At least wiki document, Sigil domain, Work Record, and radial item Subject
  helpers emit useful Facets with `key`, `layer`, `contracts`, and `hosts[]`
  where applicable.
- Facet Host entries distinguish Browser Host and Canvas Host assumptions
  without inventing new runtime behavior.
- Tests prove compatibility readers see coherent Facets, Hosts, Contracts,
  Subject References, legacy Views, and legacy Controls.
- Existing schema, toolkit, renderer, Playbook, verifier, and evidence-adapter
  tests continue to pass when selected by the router.
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

## Next Milestones After Facet/Host Emission

1. Move legacy dotted operation/event strings from `capabilities[]` toward
   `contracts[]` in individual helpers once all consumers use the compatibility
   API.
2. Add a small browser-hosted subject opening prototype only after the helper
   Facets and Host entries prove stable in tests.
3. Promote the browser Playbook prototype into a browser-hosted Playbook
   workbench only after subject references and evidence-adapter diagnostics
   prove stable.
4. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
