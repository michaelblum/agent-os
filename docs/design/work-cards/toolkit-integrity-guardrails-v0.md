# Toolkit Integrity Guardrails V0

**Status:** Accepted 2026-05-20
**Owner:** Foreman

## Tracker

Toolkit integrity guardrails for the existing layered toolkit model. This card
owns only the first warn-mode reporting/test slice.

Accepted evidence:

- Implemented and merged through PR #368:
  `https://github.com/michaelblum/agent-os/pull/368`, merge commit
  `28330aa27be7df0cb00ebc3e9f218c7713a784ee`.
- `scripts/toolkit-debt-report.mjs` exists and reports `mode: "warn"` with six
  advisory debt categories.
- `tests/toolkit/toolkit-integrity.test.mjs` exists and verifies the warn-mode
  report structure and CLI behavior.
- Post-merge verification passed:
  `node --test tests/toolkit/toolkit-integrity.test.mjs`,
  `node scripts/toolkit-debt-report.mjs --json`, and `git diff --check`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Purpose

Create the first non-blocking guardrail that makes toolkit debt visible before
the next controls and feedback primitives land. The guardrail must preserve the
existing taxonomy, report likely debt, and stay warn-mode until Foreman promotes
specific findings into gates.

The first planned consumers to name in the report context are `InfoTag` in
`controls/` and the feedback molecules `ThumbsFeedback`, `StarRating`, and
`StarRatingWithComment`. This slice must not implement those consumers.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `tests/toolkit/style-contracts.test.mjs`
- `tests/toolkit/toolkit-api-docs-contract.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
```

If `./aos ready` reports a repo-mode input tap or TCC blocker, do not chase live
verification for this slice. Record the blocker and continue with deterministic
Node tests because this work only adds docs, a script, and a warn-mode test.

## Exact File Scope

Edit exactly these three files and no others:

- `docs/design/work-cards/toolkit-integrity-guardrails-v0.md`
- `tests/toolkit/toolkit-integrity.test.mjs`
- `scripts/toolkit-debt-report.mjs`

Do not create new folders.

## Taxonomy Summary

Use the existing toolkit taxonomy:

- `runtime/`: generic in-canvas bridge over daemon primitives.
- `controls/`: reusable semantic app-control behavior for WKWebView surfaces.
- `adapters/zag/`: browser-safe behavior adapters for disclosure, selection,
  focus, and related Zag-style primitives.
- `panel/`: reusable panel/window primitives and layouts, including chrome,
  tabs, split panes, and stage affordances.
- `workbench/`: reusable subject/workbench contracts and helpers.
- `components/`: reusable panels, surfaces, and content units built from lower
  layers.

Do not rename these layers or invent a competing taxonomy.

## Promotion Rule

`Molecule` means a composed reusable pattern, not a new folder. Examples include
tab strip plus body, segmented group, toolbar section, pane header, list row,
disclosure stack, and feedback group.

Create a new folder or durable molecule module only after 2-3 real consumers
demonstrate the same composed pattern. Until then, document the pattern and use
tests/reporting to keep likely duplication visible.

## Required Behavior

`scripts/toolkit-debt-report.mjs` must scan existing toolkit files and report
likely debt in these categories:

- private tab styling;
- segmented-as-tab misuse;
- primitive CSS imports;
- legacy or undefined tokens;
- hardcoded style values where tokens likely exist;
- duplicated composed patterns that may become molecules.

The report must include:

- `mode: "warn"`;
- the canonical taxonomy summary;
- the promotion rule;
- the planned consumer context for `InfoTag`, `ThumbsFeedback`, `StarRating`,
  and `StarRatingWithComment`;
- category counts and bounded sample findings.

Findings are advisory. Existing debt must not make the script or test exit
non-zero.

## Hard Boundaries

- Do not implement `InfoTag`, `ThumbsFeedback`, `StarRating`, or
  `StarRatingWithComment`.
- Do not implement primitives, controls, molecules, panels, or app UI.
- Do not add a `molecules/` folder or any other new folder.
- Do not make integrity findings a hard gate in this slice.
- Do not rename toolkit layers.
- Do not move toolkit policy into daemon code or app code.

## Suggested Implementation

Add `scripts/toolkit-debt-report.mjs` as a Node script with an exported report
runner plus CLI output. Prefer `--json` for tests and a readable text summary
for humans. Keep scanning heuristic and conservative: it should surface likely
debt for planning, not claim semantic certainty.

Add `tests/toolkit/toolkit-integrity.test.mjs` to assert that the script exists,
runs, returns the expected warn-mode structure, includes all debt categories,
and names the planned consumers. The test may inspect report shape and CLI exit
status, but must not assert that debt counts are zero.

## Verification

Run:

```bash
node --test tests/toolkit/toolkit-integrity.test.mjs
node scripts/toolkit-debt-report.mjs --json
git diff --check
```

No Swift rebuild is required unless unrelated Swift changes are introduced,
which this card prohibits.

## Completion Report

Report:

- the three changed files;
- the exact verification commands and pass/fail results;
- whether `./aos ready` passed or the exact readiness blocker;
- confirmation that no primitives, controls, molecules, panels, app UI, or new
  folders were added;
- any follow-up debt categories that look ready for a future hard gate.
