# AOS Grand Unification Next Session Goal

**Status:** handoff goal for continuing the foundation-hardening workstream
**Date:** 2026-05-06

## Goal

Split wiki document Subjects from domain Subjects in live toolkit helpers.

The previous slice landed on `main` at `1b26ba6`. AOS now has Work Record v0,
saved command/action evidence, Playbook step v0, report-only verifier
diagnostics, an explicit-gate one-step Playbook harness, a browser-compatible
Playbook prototype bridge, and deterministic report-only evidence adapters for
browser, canvas/AX-like, and artifact-metadata evidence.

The immediate next workstream is tracked in GitHub issue #216:

```text
https://github.com/michaelblum/agent-os/issues/216
```

The target branch for the next session is:

```text
codex/wiki-domain-subject-split
```

The trust gap now is subject identity drift. The ADR/glossary pass settled that
`subject_type` names the stable kind of a Subject, not a contextual projection.
Current wiki helpers still violate that model by minting `subject_type:
sigil.agent` directly from wiki paths such as `sigil/agents/default.md`. The
next slice should unwind that legacy behavior deliberately:

- a wiki Markdown file remains a wiki document Subject (`wiki.entity`,
  `wiki.concept`, `wiki.workflow`, `wiki.reference`, or `wiki.page`);
- a domain concept such as a Sigil agent is a separate domain Subject
  (`sigil.agent`);
- the domain Subject references the wiki document Subject as the source of its
  narrative Facet through a Subject Reference;
- compatibility is preserved for existing consumers while the helpers and tests
  move toward the target model.

This is a foundation-hardening slice. Do not build the full Wiki Subject
Browser, do not add broad command surface, and do not change runtime UI unless a
small focused verification harness already depends on the migrated helper.

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

Inspect GitHub issue #216 after local state is known. An open issue or PR is not
automatically current.

## Read First

Read the fresh-session primer and live entry-path recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`

Then read the current subject-model sources:

- `CONTEXT.md`
- `docs/adr/0007-subject-type-is-kind-not-projection.md`
- `docs/adr/0008-subject-browser-is-a-surface-kind.md`
- `docs/adr/0010-capabilities-are-named-contracts-not-buttons-or-facets.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/subject.js`
- `tests/toolkit/wiki-subject.test.mjs`
- `tests/toolkit/workbench-subject.test.mjs`

Local reference checkouts should exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to be at `1b26ba6`, and
`codex/wiki-domain-subject-split` should be created from that commit.

Recent foundation commits include:

- `1b26ba6 docs: document work record evidence adapter boundary`
- `c7f0939 feat: add work record evidence adapters`
- `f0ad3e4 feat: add browser playbook prototype bridge`
- `18b7ea6 feat: add gated playbook step harness`
- `034ecce feat: classify work record verifier diagnostics`
- `3b6696a feat: bridge playbook steps to work records`
- `7c199c4 docs: sketch playbook step v0 schema`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit the current wiki subject helper, docs, and tests for places that derive
   domain Subject types directly from wiki paths.
2. Update `createWikiPageSubject` / `wikiSubjectType` so wiki pages stay
   wiki-oriented Subjects. `sigil/agents/*.md` should no longer become
   `subject_type: sigil.agent` through the wiki helper.
3. Add or identify a separate domain helper for Sigil agent Subjects. The helper
   should produce a stable `sigil.agent` domain Subject and include a Subject
   Reference to the wiki document Subject that sources its narrative Layer.
4. Keep compatibility explicit. If existing consumers need the older dotted
   capability strings, preserve them through legacy summaries or contracts
   rather than silently dropping them.
5. Add focused tests proving:
   - `sigil/agents/default.md` as a wiki page maps to a wiki document Subject;
   - the separate Sigil agent helper emits `subject_type: sigil.agent`;
   - the domain Subject references the wiki document Subject;
   - generic wiki concepts/entities/workflows/references still map correctly;
   - existing schema validation for `aos.workbench.subject` still passes.
6. Update docs/API wording so `docs/api/toolkit.md` no longer lists
   `sigil.agent` as a wiki page subject type without the domain-Subject
   distinction.
7. Do not promote the full v-next schema yet unless the migrated helper needs a
   tiny compatible optional field. Prefer a minimal shape that validates against
   the existing schema plus a documented forward path.
8. Run the workflow router with focused `--files`, then run focused toolkit and
   schema tests, `bash tests/help-contract.sh` if public command docs or CLI
   contracts changed, `git diff --check`, and `./aos ready`.
9. Commit in focused reversible slices.

## Acceptance Criteria

- Wiki document Subjects and Sigil agent domain Subjects are distinct in live
  helpers and tests.
- `wikiSubjectType` no longer returns `sigil.agent` for a wiki page path or
  wiki frontmatter alone.
- A tested domain helper emits `subject_type: sigil.agent` and carries an
  explicit Subject Reference to the source wiki document Subject.
- Docs explain the migration from legacy projection behavior to explicit Subject
  References.
- Existing Work Record, Playbook, verifier, and evidence-adapter tests continue
  to pass when selected by the router.
- No full Wiki Subject Browser, browser UI, autonomous replay, repair, macro
  playback, or new `aos` command surface is added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add `aos verify`, `aos audit`, or another broad command surface.
- Do not build the Wiki Subject Browser or general Playbook UI.
- Do not change the Work Record verifier loop unless a small subject-reference
  fixture needs read-only compatibility coverage.
- Keep the current JSON schema backward-compatible unless the task explicitly
  includes a schema migration with fixtures and docs.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Subject Split

1. Add optional v-next `facets[]`, `facets[].hosts[]`, `subject_references[]`,
   and `contracts[]` support to `aos.workbench.subject` fixtures and helpers.
2. Move legacy dotted operation/event strings from `capabilities[]` toward
   `contracts[]` while keeping readers backward-compatible.
3. Promote the browser prototype into a browser-hosted Playbook workbench only
   after subject references and evidence-adapter diagnostics prove stable.
4. Implement the Browser-Hosted Wiki Subject Browser only after Work Record,
   Playbook, verifier, and subject descriptor contracts are stable.
