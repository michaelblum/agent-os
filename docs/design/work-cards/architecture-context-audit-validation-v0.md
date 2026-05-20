# Work Card: architecture-context-audit-validation-v0

**Status:** Ready for validation
**Owner:** GDI

## Tracker

Second-pass validation for
`docs/design/notes/architecture-context-codebase-audit-2026-05-20.md`.

This card is validation-only. It should produce a corrected audit record and a
clear recommendation for later doc edits, not directly rewrite
`ARCHITECTURE.md` or `CONTEXT.md`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Validate or refute Foreman's first-pass audit findings comparing
`ARCHITECTURE.md` and `CONTEXT.md` against the current codebase. The output
should make it safe for Foreman to decide whether to route a later doc-update
slice.

## Read First

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `docs/design/notes/architecture-context-codebase-audit-2026-05-20.md`
- `docs/recipes/gdi-work-card-authoring.md`
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- `packages/toolkit/AGENTS.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-work-record-v0.schema.json`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is a docs/code audit. Do not run `./aos ready` unless you decide live
runtime evidence is essential. Prefer static source inspection and bounded CLI
dry-runs.

## Branch/Base

branch_from: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`
required_start_ref: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`

This validation card and the first-pass audit report live on the branch above,
not on `origin/main`. Do not reset to `origin/main` for this validation. A clean
worktree on the source branch is acceptable; router changed-file counts are
branch-diff context, not dirty local state.

Use `gdi/architecture-context-audit-validation-v0` as the validation output
branch if you need a separate branch. Start it from the required start ref.

## Existing Code To Inspect

Start with these files, then search as needed:

- `src/shared/command-help.swift` - help text versus JSON behavior.
- `src/shared/command-registry-data.swift` - live command grammar.
- `src/shared/helpers.swift` - JSON error output helper.
- `src/browser/target-parser.swift` - browser target grammar.
- `src/perceive/capture-pipeline.swift` - browser capture support.
- `src/voice/say.swift` - `say` implementation.
- `src/commands/tell.swift` - `tell` implementation.
- `src/daemon/unified.swift` - `tell human`, canvas position state, and daemon
  routing.
- `packages/toolkit/workbench/subject.js` - subject capabilities/contracts.
- `packages/toolkit/workbench/subject-entry-handle.js` - Subject Entry Handle
  shape.
- `packages/toolkit/workbench/wiki-subject.js` - wiki subject writer behavior.
- `packages/toolkit/workbench/sigil-subject.js` - domain subject reference
  behavior.
- `shared/schemas/aos-workbench-subject.schema.json` - subject schema.
- `shared/schemas/aos-work-record-v0.schema.json` - Work Record schema.

## Findings To Validate

Validate each finding in the report:

- A1: JSON-only command contract is overstated.
- A2: browser/DOM target support contradicts the feedback-loop wording.
- A3: daemon-held Sigil position state conflicts with the documented canvas
  boundary.
- A4: `say` is not literal `tell human` sugar.
- A5: monorepo and toolkit roster is outdated.
- C1: `CONTEXT.md` overstates live `screen:` and `ax:` target grammar.
- C2: Subject Entry Handle ambiguity note is stale.

Also validate the aligned-area claims:

- Workbench Subject model aligns with schema/helpers.
- Work Record v0 terminology aligns with the schema, with the caveat that the
  schema is not wired to live toolkit helpers yet.

For each item, classify it as:

- confirmed;
- confirmed with severity/wording adjustment;
- partly true but missing important context;
- refuted.

## Scope

Primary scope is docs/audit validation. Edit only:

- `docs/design/notes/architecture-context-codebase-audit-2026-05-20.md`

Only edit another file if the first-pass report path, references, or this work
card itself contain a blocking typo that prevents validation.

## Hard Boundaries

- Do not update `ARCHITECTURE.md` or `CONTEXT.md` in this validation slice.
- Do not implement source changes.
- Do not open or update GitHub issues or PRs.
- Do not chase live AOS runtime blockers unless static evidence cannot answer a
  finding.
- Do not broaden this into a full architecture audit beyond the report's named
  findings unless you discover a nearby contradiction that would make a named
  finding misleading.

## Suggested Validation Commands

Use focused commands like:

```bash
./aos help
./aos help say --json
./aos help tell --json
AOS_BYPASS_PREFLIGHT=1 ./aos do click 'screen:see_abc/1,2' --dry-run
AOS_BYPASS_PREFLIGHT=1 ./aos do click 1,2 --dry-run --state-id see_abc123def456
rg "browser:<|screen:<|ax:<|lastPositions|position.get|position.set|subject_entry_handle|SUBJECT_ENTRY_HANDLE" ARCHITECTURE.md CONTEXT.md docs src packages shared tests
rg "outJSONFlag|printFullRegistryText|deliverHumanVoiceRoute|sendEnvelopeRequest" src packages shared
find packages -maxdepth 2 -type d | sort
```

Use `nl -ba` on docs and source files when adding or correcting line-specific
evidence.

## Required Output

Amend
`docs/design/notes/architecture-context-codebase-audit-2026-05-20.md` with a
short "Second-Pass Validation" section. Include:

- validation date;
- commands run;
- per-finding classification;
- any evidence corrections;
- recommendation for the later doc-update slice.

If a finding is refuted, correct the main report body too so future readers do
not have to reconcile contradictory sections.

## Verification

Run:

```bash
git diff --check
```

No Swift rebuild is required unless you intentionally violate this card's scope,
which should not be necessary.

## Completion Report

Report:

- files changed;
- per-finding validation classification;
- exact commands run and pass/fail results;
- whether any findings were refuted or materially reframed;
- whether a later doc-update work card is ready to route;
- any local-only state or unrelated dirty files.
