# Generated Artifact Lifecycle Policy V0

## Tracker

- Platform debt map: `docs/design/2026-05-17-platform-debt-map.md`
- HTML Workbench Expression epic: #300
- Neutral evidence workflow tracker: #293
- Related completed work:
  - #301 HTML Workbench Expression V0 for Markdown work-cards
  - #306 Project canonical repo docs into the runtime wiki
  - #359 through #362 user-signal durable records and guided sessions
- Design notes:
  - `docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`
  - `docs/design/evidence-workflow-block-abstraction-tracker.md`
  - `docs/design/user-signal-surface.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
wiki state, artifact paths, issue state, local runtime records, or prior
implementation state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Define the first repo-wide generated-artifact lifecycle policy so AOS can keep
rich projections and evidence useful without accumulating unclear state-root or
repo clutter.

The policy should explain how generated HTML workbench expressions, runtime wiki
projections, artifact bundle members, screenshots, evidence captures,
user-signal records, and test proof payloads are classified, cleaned up,
archived, and linked back to canonical source.

This is a policy and contract slice first. Do not delete or migrate existing
artifacts unless a tiny fixture-only correction is obviously safe and directly
proves the policy.

## Dependency

Run after `docs/design/work-cards/user-signal-service-consolidation-v0.md` has
reported completion or an exact blocker. Use its findings about gate records,
continuations, resume events, and guided-session records when classifying
runtime records versus generated projections.

## Read First

- `AGENTS.md`
- `docs/design/2026-05-17-platform-debt-map.md`
- `docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`
- `docs/design/evidence-workflow-block-abstraction-tracker.md`
- `docs/design/user-signal-surface.md`
- `docs/recipes/layered-subject-expressions.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `docs/api/aos.md`
- `docs/api/toolkit/workbench.md`
- `docs/wiki/repo-docs-projection-v0.json`
- `shared/schemas/aos-html-workbench-expression-v0.md`
- `shared/schemas/aos-html-workbench-expression-v0.schema.json`
- `packages/toolkit/workbench/html-workbench-expression.js`
- `src/commands/wiki-project-docs.swift`
- `packages/toolkit/workbench/artifact-bundle-subject.js`
- `packages/toolkit/workbench/work-record-capture.js`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos dev gh issue view 300 --json
./aos dev gh issue view 293 --json
./aos dev gh issue view 306 --json
```

If `./aos ready` is blocked, report the exact blocker. This slice should be
verifiable deterministically unless GDI chooses to add a small runtime wiki
smoke with isolated `AOS_STATE_ROOT`.

## Existing Code And Artifacts To Inspect

- `packages/toolkit/workbench/html-workbench-expression.js` - generated HTML
  expression metadata, source hashes, sidecars, and output paths.
- `packages/toolkit/components/html-workbench-expression/` - consumer surface
  expectations for generated HTML expressions.
- `scripts/aos-html-workbench-expression.mjs` - command/script behavior for
  producing generated expressions.
- `src/commands/wiki-project-docs.swift` and
  `docs/wiki/repo-docs-projection-v0.json` - generated runtime wiki projection
  behavior and manifest metadata.
- `packages/toolkit/workbench/artifact-bundle-subject.js` - artifact bundle
  subject classification and provenance expectations.
- `packages/toolkit/workbench/work-record-capture.js` and related work-record
  modules - evidence and capture payload shape.
- `packages/toolkit/workbench/employer-brand-*` - current pilot artifacts that
  should inform policy without forcing a neutral abstraction.
- `docs/design/fixtures/aos-artifacts/` - checked-in proof fixtures and
  evidence bundles.
- `tests/README.md` - generated test artifact and cleanup expectations.

## Required Behavior

### 1. Inventory Current Artifact Producers

Create a concise inventory of current generated-artifact producers and classify
each by lifecycle type. Include at least:

- HTML Workbench Expressions;
- Artifact Bundle Subjects;
- runtime wiki repo-doc projections;
- user-signal gate records, continuations, resume events, and guided-session
  records;
- work-record captures and evidence adapters;
- Employer Brand evidence fixtures and proof artifacts;
- live AOS screenshots or visual smoke payloads;
- test output artifacts under temp roots or repo fixtures.

### 2. Define Lifecycle Classes

Add or update a design note with a small vocabulary. Suggested classes:

- canonical source;
- generated projection;
- runtime record;
- evidence artifact;
- archived bundle member;
- disposable scratch;
- test fixture;
- stale generated output.

For each class, define:

- owner layer;
- source of truth;
- allowed storage locations;
- whether it belongs in Git, runtime state, temp dirs, or artifact bundles;
- cleanup or archive trigger;
- surviving structured result;
- privacy/redaction expectations;
- source hash or provenance requirement.

### 3. Define Producer Requirements

For new generated-artifact producers, define the minimum metadata before they
ship:

- producer id and schema/version when applicable;
- source expression and canonical source path or subject;
- generated output path or runtime state path;
- source hash/provenance;
- semantic targets or source map when the artifact is human-facing;
- cleanup/archive policy;
- privacy/redaction policy;
- durable sidecar/result that survives if the projection is deleted.

### 4. Reconcile Current Docs

Update the smallest durable docs needed so future agents stop treating generated
HTML, wiki projections, screenshots, and evidence payloads as ad hoc output.

Likely updates:

- `docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`
- a new focused lifecycle note under `docs/design/`
- `docs/recipes/layered-subject-expressions.md`
- `docs/api/toolkit/workbench.md` if the workbench expression contract needs a
  concise lifecycle pointer.

### 5. Optional Tiny Guardrail

If a low-risk deterministic guardrail is obvious, add it. Examples:

- a schema/docs test that confirms HTML Workbench Expression metadata includes
  source hash, output path, security policy, and cleanup/archive fields already
  present in the contract;
- a manifest validation assertion that repo-doc projections identify themselves
  as generated projections;
- a docs-contract test that checks the lifecycle note is referenced from the
  HTML workbench expression docs.

Skip code changes if they would turn the policy slice into a migration.

## Scope

Likely ownership:

- docs/design policy note;
- docs/api or recipe pointer updates;
- optional schema/docs tests if they directly enforce existing metadata;
- no runtime behavior changes unless a tiny existing metadata omission blocks
  the policy from being true.

## Hard Boundaries / Non-Goals

- Do not delete, move, or bulk-regenerate existing artifacts.
- Do not extract #293 neutral evidence schemas in this slice.
- Do not implement a workflow engine, report renderer, or export system.
- Do not make HTML canonical source.
- Do not move Git docs into the runtime wiki.
- Do not ingest private personal/operator material.
- Do not add broad cleanup commands.
- Do not require live visual verification.
- Do not broaden into Display-first Annotation Mode implementation.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- Add `docs/design/generated-artifact-lifecycle-policy.md`.
- Update `docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`
  to point at the policy as the answer to the lifecycle tension.
- Update `docs/recipes/layered-subject-expressions.md` with a short lifecycle
  checklist.
- Update `docs/api/toolkit/workbench.md` only if it needs a concise pointer for
  HTML Workbench Expression consumers.
- Add focused tests only when the policy can be enforced without broad runtime
  changes.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  docs/design/generated-artifact-lifecycle-policy.md \
  docs/design/html-workbench-expression-adoption-audit-2026-05-13.md \
  docs/recipes/layered-subject-expressions.md \
  docs/api/toolkit/workbench.md
```

Run deterministic checks selected by actual changes. Expected baseline
candidates:

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/schemas/aos-html-workbench-expression-v0.test.mjs
bash tests/wiki-project-docs.sh
bash tests/help-contract.sh
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
git diff --check
```

If the slice remains docs-only, run at least:

```bash
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
git diff --check
```

Report `./aos ready` state, but skip live AOS verification unless GDI adds a
specific runtime wiki or workbench smoke and readiness is green.

## Completion Report

Report:

- changed files;
- lifecycle classes defined;
- current artifact producers inventoried;
- any metadata or docs-contract guardrail added;
- exact tests run and results;
- live readiness state or blocker;
- one remaining follow-up, if any, such as a later cleanup command, lifecycle
  metadata schema patch, or #293 extraction gate update.
