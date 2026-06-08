# Implementer Test Harness Ladder Prep Protocol V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: implementation and audit round.
- Single next goal: make the AOS test harness ecosystem easier to choose and
  evaluate by adding a foundational harness ladder, a lightweight Foreman
  harness-prep protocol, and reporting hooks for new test artifacts.
- Source artifact: Foreman/user discussion after the stale status-item root
  correction review found a fixture that erased the URL identity variable under
  test.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create a separate focused branch,
  commit and push. Foreman will review and fold into PR #378 if accepted.
- Stop conditions: complete, failed, manual_intervention, or blocker only if current
  docs/schema shape cannot represent the protocol without a product decision.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/test-harness-ladder-prep-protocol-v0`

This branch is separate from
`implementer/sigil-status-item-stale-root-recovery-v0`. Do not stack on the active
Sigil runtime correction branch.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
test catalog, or prior implementation state. Read and rediscover before
editing.

## Context

A review of `implementer/sigil-status-item-stale-root-recovery-v0` found a process
failure: the implementation added drift detection for status-item URL/canvas
identity, but the regression fixture created `avatar-main` with inline HTML.
The current runtime path creates that canvas from a URL, so the test erased the
canonical `aos://` versus resolved `http://127...` URL distinction that caused
the real failure.

The issue is not "run more tests" or "treat AOS like a mature customer product."
AOS is still greenfield and needs nimbleness.

The issue is harness selection:

- use the cheapest harness that exercises the actual variable at risk;
- avoid fixtures that fake away the variable under test;
- make new test helpers visible for later adoption, migration, or deletion;
- keep Implementer focused on implementation by giving Foreman a reusable harness-prep
  routine for runtime/canvas/input-heavy slices.

Use the phrase `canonical-path representative`, not `production-faithful`.
Here it means "representative of the current canonical runtime/design path,"
which may change as the greenfield product evolves.

## Goal

Add a repo-owned testing guidance layer that answers:

1. Which foundational harness/workspace should a Foreman/Implementer/Operator use for a
   given class of AOS change?
2. When is a cheaper fixture sufficient, and when does it fake away the defect?
3. What existing primitives, helpers, and harnesses should be reused before
   inventing new test code?
4. How should a new test primitive, harness, fixture, or scenario be reported so
   Foreman can evaluate its future utility?
5. Which existing harness/test artifacts are residue, candidates for migration,
   or candidates for promotion?

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/README.md`
- `docs/recipes/agent-tooling-contexts-and-verification.md`
- `docs/dev/README.md`
- `docs/dev/workflow-rules.json`
- `shared/schemas/dev-workflow-rules.schema.json`
- `tests/schemas/dev-workflow-rules.test.mjs`
- `docs/dev/reports/test-suite-contract-audit-v0.md`
- `tests/lib/isolated-daemon.sh`
- `tests/lib/live-canvas-serial.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/real-input-surface-primitives.mjs`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/status-item.sh`

Then inspect current usage:

```bash
rg -n "source .*tests/lib|tests/lib/|show create|show eval|AOS_STATE_ROOT|AOS_REAL_INPUT_OK|legacy|compat|diagnostic|ad hoc|harness|fixture|primitive" tests docs/dev/reports/test-suite-contract-audit-v0.md
```

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos dev recommend --json --paths tests/README.md,docs/recipes/agent-tooling-contexts-and-verification.md,docs/dev/workflow-rules.json
```

This is docs/test-governance work. Do not run live AOS readiness unless a change
you make requires it. If you unexpectedly hit a repo-mode TCC/input-tap blocker,
do not loop; report the blocker instead of expanding the slice.

## Required Work

### 1. Add A Foundational Harness Ladder

Update `tests/README.md` so foundational AOS harnesses are easy to choose before
the reader reaches Sigil-specific examples.

The ladder should distinguish at least:

- model/unit tests;
- toolkit/component contract tests;
- isolated daemon tests;
- shared repo-daemon live canvas tests;
- visual harness tests;
- status-item owner/click harnesses;
- real-input scenarios;
- supervised/HITL harnesses, if relevant to existing `tests/lib/` inventory.

For each level, describe:

- what it is for;
- what it deliberately does not cover;
- common helpers or entry files;
- when to escalate to the next level.

Keep this compact. The goal is a useful catalog, not a textbook.

### 2. Add A Harness Prep Recipe

Add a Markdown SOP under `docs/recipes/`, probably:

```text
docs/recipes/test-harness-ladder-and-prep.md
```

The recipe should be role-neutral but usable by Foreman as a "harness prep"
routine before routing complex Implementer work.

It should include:

- a small `Harness Plan` template:

  ```text
  Risk under test:
  Existing harness/workspace:
  Why this harness is enough:
  What this harness does not cover:
  Required representative fixture shape:
  Must not use as sole proof:
  Existing primitives/helpers to reuse:
  Candidate reusable artifact reporting:
  ```

- a rule that says `canonical-path representative` rather than
  `production-faithful`;
- a warning against fake fixtures that remove the defect variable;
- guidance for greenfield speed: use the cheapest adequate harness and skip this
  prep routine for tiny parser/docs/schema changes unless the work card asks
  for it;
- examples using generic AOS concepts first, then optional Sigil examples:
  URL-backed canvas versus inline HTML canvas, isolated daemon versus live
  repo daemon, real pointer input versus renderer state mutation.

### 3. Wire The Guidance Into Existing Dev Surfaces

Add minimal references so agents can find the recipe without memorizing it:

- `tests/README.md` should link to the new recipe near the test-authoring or
  harness-selection guidance.
- `docs/recipes/README.md` should list or describe the new recipe if that file
  maintains recipe discovery.
- `docs/recipes/agent-tooling-contexts-and-verification.md` should point to the new
  harness-prep recipe from its Testing section, but should not duplicate the
  whole protocol.
- `docs/dev/README.md` or `docs/dev/workflow-rules.json` should include a small
  pointer if it helps `./aos dev recommend` users find the harness ladder.

If updating `docs/dev/workflow-rules.json`, keep it provider-neutral and
repo-wide. Do not encode Sigil-specific playbooks in workflow rules.

### 4. Add A Harness Ecosystem Audit Report

Add a short report under:

```text
docs/dev/reports/test-harness-ladder-prep-protocol-v0.md
```

Include:

- current foundational harness inventory;
- known high-value shared primitives already available;
- obvious residue or migration candidates;
- candidate artifacts that should be promoted, kept local, or deleted later;
- gaps that would improve Implementer consistency without slowing every task.

This is not a mandate to refactor the whole suite. It is a map for the next
Foreman review decisions.

### 5. Add Completion-Report Slots

Update whichever durable guidance is most appropriate so future Implementer reports can
include, when relevant:

- `new_test_artifact_candidates`;
- `fixture_blind_spots`;
- `harness_selection`;
- `why_no_harness_prep_needed`.

Do not make every tiny Implementer report verbose. Phrase this as required for
runtime/canvas/input/status/lifecycle/cross-layer slices, optional otherwise.

## Hard Boundaries

- Do not implement actual sub-agent infrastructure in this round.
- Do not create a heavy mandatory design phase for every Implementer task.
- Do not touch Sigil runtime, status-item, radial menu, wiki graph, or canvas
  behavior.
- Do not rewrite broad test suites opportunistically.
- Do not delete tests unless the residue is obvious and low-risk; prefer listing
  candidates in the report.
- Do not make `docs/dev/workflow-rules.json` app-specific.
- Do not rename recipes/playbooks/workflows/test harnesses broadly.
- Do not require live AOS or real-input testing for this docs/governance slice.

## Suggested Implementation Areas

Likely files:

- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/recipes/README.md`
- `docs/recipes/agent-tooling-contexts-and-verification.md`
- `docs/dev/README.md`
- `docs/dev/workflow-rules.json`
- `tests/schemas/dev-workflow-rules.test.mjs`
- `docs/dev/reports/test-harness-ladder-prep-protocol-v0.md`

These are suggestions. Inspect first and keep edits smaller if the existing
shape has a better home.

## Verification

Run docs/schema/governance checks only; no live AOS runtime proof is expected.

Minimum:

```bash
git diff --check
node --test tests/schemas/dev-workflow-rules.test.mjs
./aos dev recommend --json --paths tests/README.md,docs/recipes/test-harness-ladder-and-prep.md,docs/dev/workflow-rules.json
```

If you touch other dev workflow schemas or manifests, run the adjacent schema
tests recommended by `./aos dev recommend`.

If you decide not to touch `docs/dev/workflow-rules.json`, explain why and run a
smaller `./aos dev recommend` command for the actual changed paths.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether the new recipe and harness ladder are foundational rather than
  Sigil-specific;
- what existing harness inventory was adopted into the catalog;
- residue/migration candidates found but deferred;
- any new required completion-report slots added;
- exact verification commands and pass/fail status;
- whether any local-only state exists;
- recommended next Foreman action for adopting/migrating/deleting harness
  artifacts after this governance slice.
