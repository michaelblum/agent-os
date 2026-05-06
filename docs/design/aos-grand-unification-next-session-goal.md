# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Artifact Bundle Subject V0
**Date:** 2026-05-06

## Goal

Define and render the first read-only AOS Artifact Bundle workbench subject.

The Subject Browser related graph navigation V0 landed on `main` at `797123d`.
AOS can now derive a canonical Subject graph/index, search/filter indexed
Subjects, maintain navigation trail/history, and inspect a focused Subject's
references, Facets, and Hosts. The next practical step is to add a new
non-wiki, non-work-record Subject type that can participate in the same
substrate: an artifact bundle representing generated or collected outputs such
as HTML prototypes, Markdown reports, screenshots, exports, provenance, and
validation state.

The immediate next workstream is tracked in GitHub issue #263:

```text
https://github.com/michaelblum/agent-os/issues/263
```

The target branch for the next session is:

```text
codex/artifact-bundle-subject-v0
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
gh issue view 263 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the fresh-session primer, live entry-path recipe, and exit-interview
recipe:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/layered-subject-expressions.md`
- `docs/recipes/aos-gdi-exit-interview.md`

Then read the current Subject model, artifact research, graph/index, catalog,
and browser sources:

- `CONTEXT.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/design/open-design-workbench-cross-reference.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-catalog.js`
- `packages/toolkit/workbench/subject-graph.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `packages/toolkit/components/work-record-workbench/index.js`
- `tests/toolkit/subject-graph.test.mjs`
- `tests/toolkit/subject-catalog.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- adjacent tests selected by `./aos dev recommend`

Local reference checkouts may exist adjacent to this repo and are research
inputs only:

- `/Users/Michael/Code/pi-computer-use`
- `/Users/Michael/Code/open-design`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `797123d docs: refine gdi exit interview recipe`
- `4311f4a docs: document subject browser related navigation`
- `af2b660 feat: add subject browser related navigation`
- `50a8f63 docs: add aos gdi exit interview recipe`
- `2e337c4 feat: add subject browser index filters`
- `800103d docs: document subject browser navigation v0`
- `3e872f0 feat: add subject browser navigation v0`
- `890515e feat: add subject graph index v0`
- `35cc4a6 feat: add subject browser catalog opening`

Treat these as orientation only. Rediscover before editing.

## Immediate Work Plan

1. Audit current artifact-related docs, Workbench Subject helpers, Subject
   Catalog, Subject Browser opening paths, Work Record subject projection, and
   Open Design adaptation notes.
2. Define the smallest V0 artifact-bundle subject shape before wiring UI. It
   should include:
   - stable Subject identity and `subject_type: aos.artifact_bundle`;
   - canonical `capabilities[]`, `contracts[]`, `facets[]`, `facets[].hosts[]`,
     and `subject_references[]`;
   - artifact metadata for one HTML artifact and one Markdown/report artifact;
   - source folder/entry file/supporting files;
   - renderer ids, export metadata, provenance/work-record links, and validation
     state;
   - no legacy `views[]`, `controls[]`, or dotted raw `capabilities[]`.
3. Add docs-only fixture files under a narrow fixture path, preferably
   `docs/design/fixtures/aos-artifacts/example-design-pass/`.
4. Add a pure toolkit projection/helper only after the fixture shape is clear.
   Prefer `packages/toolkit/workbench/artifact-bundle-subject.js` if a helper is
   needed.
5. Add a read-only artifact gallery/preview workbench or reusable model over the
   subject shape. Keep V0 read-only: no generation, export implementation,
   save/lock-in, agent execution, or broad renderer registry.
6. Wire the artifact-bundle subject into the existing Subject Catalog/Subject
   Browser opening path only if it can reuse existing catalog/opening contracts
   without a broad shell rewrite.
7. Add focused tests proving:
   - artifact-bundle subjects use canonical descriptor fields;
   - artifact metadata includes entry, renderer, files, exports, provenance,
     work-record linkage, and validation state;
   - read-only gallery/preview state preserves payloads without lossy rewriting;
   - Subject Browser/catalog can list or open the artifact bundle if wired;
   - no dependency on `views[]`, `controls[]`, or dotted raw `capabilities[]`;
   - existing wiki, Work Record, search/filter/trail, and related-navigation
     behavior remains intact.
8. Update docs/API with the artifact-bundle V0 shape, scope, non-goals, and
   relationship to Open Design as an AOS adaptation rather than a copied product
   architecture.
9. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
10. If a UI/workbench view changes, perform one live AOS verification:
    - launch the relevant workbench/Subject Browser;
    - inspect with `./aos see`;
    - use `./aos do` against semantic refs or state-guarded coordinates where
      practical;
    - confirm existing wiki and non-wiki opening still work;
    - clean up created canvases;
    - record exact commands/results.
11. Commit in focused reversible slices.
12. After implementation, verification, and commits are complete, run the
    read-only GDI exit interview recipe before marking the goal complete.

## Acceptance Criteria

- A small artifact-bundle subject fixture exists.
- The fixture includes at least one HTML artifact and one Markdown/report
  artifact.
- Artifact metadata includes entry file, renderer, supporting files, exports,
  provenance/work-record linkage, and validation state.
- A read-only workbench/gallery/preview model or surface can render/inspect the
  artifact bundle without lossy rewriting.
- Subject descriptor output uses canonical v-next fields and does not
  reintroduce legacy live fields.
- Existing Subject Browser and Work Record behavior remains intact.
- Docs/API frame the pattern as an AOS workbench adaptation of Open Design
  lessons, not a Sigil-owned feature and not a copied Open Design daemon/model.
- The final response includes a compact GDI exit interview using
  `docs/recipes/aos-gdi-exit-interview.md`.

## Exit Interview Requirement

After implementation, verification, and commits are complete, but before marking
the goal complete or writing the final handoff, run the read-only recipe in:

```text
docs/recipes/aos-gdi-exit-interview.md
```

Use it to produce a compact AOS ergonomics exit-interview section in the final
response. Keep the headings from the recipe, but prefer one to three high-signal
bullets per section unless a serious incident needs more detail.

Use `origin/main...HEAD` as the default diff base for the evidence packet unless
this session explicitly used a different integration base. Do not edit files,
create commits, create issues, open PRs, or create canvases for the interview.
If a read-only evidence command is unavailable or irrelevant, skip it and say
why.

The exit interview is product ergonomics evidence, not a performance review.
Separate observed facts from inference and cite concrete commands, help output,
errors, recovery steps, or time/attention costs where available.

Apply the Durability Gate from the recipe: do not create durable follow-up by
default. Recommend durable follow-up only for repeated, high-severity, or
contract-level issues, and name the correct target boundary.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not copy Open Design's product shape, daemon, `.od` state model, SQLite
  persistence, or streamed `<artifact>` tag interface into AOS.
- Do not make artifact generation, export execution, save/lock-in, or renderer
  registry implementation part of V0.
- Do not replace the wiki graph projection tracked by #72.
- Do not reintroduce `views[]`, `controls[]`, or dotted raw `capabilities[]` as
  live dependencies.
- No new public `aos` command surface unless a missing primitive is proven and
  explicitly documented first.
- No replay/repair implementation, macro playback, or live browser execution.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Next Milestones After Artifact Bundle Subject V0

1. Add explicit save/export/lock-in handoffs owned by the artifact subject's
   persistence adapter.
2. Add artifact-bundle entries to broader Subject Browser catalog fixtures and
   related graph navigation once the read-only workbench path is stable.
3. Add workflow-gated artifact generation and validation only after read-only
   artifact inspection is solid.
4. Retire remaining legacy descriptor adapters once persisted/import evidence
   shows they are no longer needed.
