# Work Card: architecture-context-doc-update-v0

**Status:** Accepted 2026-05-20
**Owner:** Foreman

## Tracker

Doc update follow-up for:

- `docs/design/notes/architecture-context-codebase-audit-2026-05-20.md`
- `docs/design/work-cards/architecture-context-audit-validation-v0.md`

The second-pass validation confirmed all named findings or confirmed them with
wording adjustments. No findings were refuted.

Accepted evidence:

- Checked after PR #368 merged to `main`.
- No implementation edits were needed in `ARCHITECTURE.md` or `CONTEXT.md`; the
  merged main state already applies the validated audit findings.
- Verification passed:
  `rg -n "No tool emits unstructured text|No DOM involved|schema work still needs to define the handle shape|screen:<state-id>/<x,y>|When tell gains new capabilities, say inherits them" ARCHITECTURE.md CONTEXT.md`
  produced no matches.
- Manual spot checks confirmed the remaining JSON contract, browser target,
  `say`/`tell human`, State ID, Subject Entry Handle, toolkit roster, and Work
  Record references are qualified consistently with the validation findings.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Update `ARCHITECTURE.md` and `CONTEXT.md` so their prose matches the current
codebase and validated audit findings, without changing source behavior,
schemas, or tests.

This is a documentation correction slice, not an architecture redesign.

## Read First

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `docs/design/notes/architecture-context-codebase-audit-2026-05-20.md`
- `docs/design/work-cards/architecture-context-audit-validation-v0.md`
- `packages/toolkit/AGENTS.md`
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-work-record-v0.schema.json`

## Rediscover State

Run from the repo root:

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
`origin/main` for this slice. Use `gdi/architecture-context-doc-update-v0` as
the output branch if creating a separate GDI branch.

## Findings To Apply

Apply the validated findings from the audit note:

- A1: revise the global JSON-only command contract. Keep the JSON-first,
  machine-readable contract for agent-facing command forms, but document that
  discovery/user-facing surfaces such as help may intentionally default to text.
- A2: reconcile the feedback-loop section with in-repo browser target support.
  Do not leave an unqualified "No DOM involved" claim that contradicts
  `browser:<session>[/<ref>]`.
- A3: correct the position-state invariant. Either describe daemon-held
  Sigil/renderer position state as transitional or avoid claiming the invariant
  is fully implemented today.
- A4: make `say` versus `tell human` conceptual rather than literal
  implementation inheritance. `say` is a direct TTS convenience path; `tell
  human` is daemon-routed communication.
- A5: refresh the monorepo and toolkit roster. Include current package roots
  and describe toolkit through the canonical layer intent. Include
  `adapters/zag` or `adapters` where useful, but do not turn the prose into an
  exhaustive directory listing.
- C1: update `CONTEXT.md` target grammar for live `screen` and AX behavior.
  Current live coordinate actions use raw `x,y` plus `--state-id`; AX action
  selection is flag-based. If `screen:` or `ax:` remain, mark them as
  target-model or future vocabulary instead of current CLI wire grammar.
- C2: remove or narrow the stale Subject Entry Handle ambiguity note. The
  handle shape exists in toolkit; only a future shared JSON schema, if desired,
  remains pending.

Preserve the validated aligned areas:

- Workbench Subject model: high-level `capabilities[]`, dotted `contracts[]`,
  `facets[]`, `facets[].hosts[]`, and top-level `subject_references[]`.
- Work Record v0 terminology: origin, references, execution map, evidence,
  claims, claim results, verifier report, and health. Keep the caveat that the
  v0 schema is a design-schema sketch not wired to live toolkit helpers yet.

## Existing Code To Use As Evidence

Inspect these paths as needed while editing:

- `src/shared/command-help.swift`
- `src/shared/command-registry-data.swift`
- `src/shared/helpers.swift`
- `src/browser/target-parser.swift`
- `src/perceive/capture-pipeline.swift`
- `src/voice/say.swift`
- `src/commands/tell.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-entry-handle.js`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-work-record-v0.schema.json`

## Scope

Edit only:

- `ARCHITECTURE.md`
- `CONTEXT.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not change Swift, JavaScript, schemas, tests, fixtures, or runtime
  behavior.
- Do not open or update GitHub issues or PRs.
- Do not broaden this into a full architecture rewrite.
- Do not remove valid historical context unless it directly contradicts current
  live behavior.
- Do not reintroduce private or non-canonical toolkit taxonomy. Use the
  canonical toolkit layers from `packages/toolkit/AGENTS.md`.

## Verification

Run:

```bash
git diff --check
git diff -- ARCHITECTURE.md CONTEXT.md
```

Then run a stale-phrase check. It should produce no unqualified stale claims:

```bash
rg -n "No tool emits unstructured text|No DOM involved|schema work still needs to define the handle shape|screen:<state-id>/<x,y>|When tell gains new capabilities, say inherits them" ARCHITECTURE.md CONTEXT.md
```

If that `rg` command still returns matches, report why each remaining match is
intentionally qualified and no longer stale.

No Swift rebuild is required for this docs-only slice.

## Completion Report

Report:

- files changed;
- summary of doc behavior corrected by finding id;
- exact verification commands and pass/fail results;
- any stale-phrase matches left intentionally, with rationale;
- whether source behavior, schemas, tests, fixtures, GitHub issues, or PRs were
  untouched;
- local-only state or unrelated dirty files.
