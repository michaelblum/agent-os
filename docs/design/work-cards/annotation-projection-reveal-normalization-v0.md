# Annotation Projection + Reveal Normalization V0

## Tracker

- Follows merged neutral candidate helper work on `main`:
  `a48cd8c fix(toolkit): remove surface inspector candidate aliases`
- Prior contract foundation:
  `docs/design/work-cards/surface-annotation-projection-contract-v0.md`
- Prior reticle bridge:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- Foreman audit source: `.docks/foreman/tmp/opportunities.md` ranked this as
  the next annotation cleanup after neutral candidate helpers.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a shared-normalization cleanup, not a new annotation feature. The goal
is one canonical projection/reveal normalization contract for owned in-repo
callers. Do not leave aliases, compatibility wrappers, or old vocabulary behind
unless there is a concrete non-updatable consumer and an explicit removal gate.

## Goal

Unify equivalent annotation projection-status and reveal-result normalization
so Surface Inspector, annotation candidates, annotation sessions, and projection
adapters do not drift on status names, blocker fields, reveal capability, or
rect evidence.

After the slice, owned in-repo code should import the canonical normalizers
directly. If two normalizers remain, their names and tests must make the
semantic boundary explicit rather than preserving duplicated logic by accident.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/surface-annotation-projection-contract-v0.md`
- `docs/design/work-cards/neutral-annotation-candidate-helpers-v0.md` if it is
  present locally; otherwise inspect the merged implementation on `main`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/toolkit/annotation-projection.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files packages/toolkit/workbench/annotation-projection.js packages/toolkit/workbench/annotation-candidates.js packages/toolkit/workbench/annotation-session.js packages/toolkit/workbench/surface-inspector-annotations.js tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs
rg -n "normalize.*Projection|normalize.*Reveal|ProjectionStatus|ProjectionEvidence|AdapterResult|RevealResult|current_render_status|can_project_display_overlay|can_reveal|blocker_reason" packages/toolkit/workbench packages/toolkit/components tests/toolkit tests/renderer
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic tests only. This slice should not require
live input verification unless GDI changes runtime behavior beyond pure
normalization.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-projection.js` owns the projection
  request, projection adapter result, reveal result, capability summary, and
  semantic-target adapter contracts.
- `packages/toolkit/workbench/annotation-candidates.js` currently owns
  candidate normalization and a projection-status helper used while ranking and
  normalizing candidates.
- `packages/toolkit/workbench/annotation-session.js` has
  `normalizeAnnotationProjectionEvidence`, which partly overlaps with adapter
  and candidate projection evidence.
- `packages/toolkit/workbench/surface-inspector-annotations.js` imports
  projection status normalization and still has Surface Inspector-local reveal
  result normalization.
- `packages/toolkit/workbench/browser-dom-element-picker.js` produces
  projection adapter results and should keep its adapter-specific resolution
  behavior.
- `tests/toolkit/annotation-projection.test.mjs` and
  `tests/toolkit/surface-inspector-annotations.test.mjs` are the primary
  deterministic safety net.

## Required Behavior

### Canonical Projection Normalization

Choose one canonical home for shared projection status/evidence normalization.
Prefer `packages/toolkit/workbench/annotation-projection.js` if it can own the
concept cleanly. If a smaller neutral module is clearly better, use it, but
keep the source of truth singular.

Owned callers should import the canonical normalizer directly. Do not keep
compatibility aliases or old helper names just to reduce churn.

The canonical projection normalization must preserve current observable
behavior:

- `projectable`, `out_of_viewport`, and `resolved_offscreen` style inputs map
  to the same current statuses as today;
- `current_render_status`, `can_project_display_overlay`, `can_reveal`,
  `display_space_rect`, `visible_display_rect`, `local_space_rect`,
  `coordinate_space`, blocker evidence, provenance ids, z-order evidence, and
  scroll/clip chains remain available where they are available today;
- unsupported, stale, absent, blocked, and missing-source states keep explicit
  blocker reasons rather than fake rectangles;
- rect shape changes are intentional and tested. If one consumer still needs
  `{x, y, w, h}` while another needs `{x, y, width, height}`, make that
  conversion explicit rather than silently changing payloads.

### Canonical Reveal Result Normalization

Unify equivalent reveal-result normalization between
`annotation-projection.js` and `surface-inspector-annotations.js`.

The canonical reveal result should support the existing fields used by Surface
Inspector and projection adapters:

- `status`;
- optional `pin_id` when the caller is a pinned Surface Inspector annotation;
- `adapter_id`;
- `subject_id`;
- `requested_at`;
- `completed_at`;
- `blocker_reason`;
- normalized `projection` when present.

If Surface Inspector needs a small wrapper to add `pin_id` before calling the
canonical normalizer, keep that wrapper narrow and named for the extra state it
adds. Do not keep a duplicate reveal normalizer with identical semantics.

### Session/Candidate Boundary

`annotation-session.js` and `annotation-candidates.js` may still adapt
projection evidence into their own subject/session shapes, but they should not
own separate status semantics when the shared projection contract already
covers them.

If GDI finds that session projection evidence is intentionally narrower than
adapter projection results, preserve the narrower shape but route common status,
rect, blocker, and timestamp normalization through the canonical helper.

### Evergreen Strict Contracts

Use the Foreman evergreen strict contract posture:

- update all owned in-repo callers in this slice when practical;
- do not leave transitional aliases for old names;
- if compatibility must remain, identify the exact live consumer and removal
  gate in the completion report;
- stale names should fail loudly in tests/search rather than silently survive.

## Scope

Likely ownership:

- toolkit workbench normalizers;
- Surface Inspector state normalization;
- annotation candidate/session imports where they overlap;
- focused toolkit/renderer tests.

Avoid daemon, Swift, schema, snapshot artifact, live reticle behavior, browser
DOM/CDP discovery, or Surface Inspector UX changes. This is not a projection
feature expansion.

## Hard Boundaries / Non-Goals

- Do not redesign annotation snapshot or bundle payload schemas.
- Do not rename `pin`, `canvas_inspector`, or snapshot vocabulary.
- Do not change browser DOM adapter behavior beyond import/name cleanup.
- Do not broaden reveal support or claim reveal capability that adapters cannot
  prove.
- Do not move toolkit policy into the daemon.
- Do not leave compatibility aliases for owned repo callers.
- Do not do broad style cleanup outside touched normalization paths.

## Suggested Implementation Areas

Start by comparing:

- `normalizeAnnotationProjectionAdapterResult` and `normalizeRevealResult` in
  `annotation-projection.js`;
- `normalizeAnnotationProjectionStatus` in `annotation-candidates.js`;
- `normalizeAnnotationProjectionEvidence` in `annotation-session.js`;
- the local reveal normalization in `surface-inspector-annotations.js`.

Then extract only the common status/rect/blocker/reveal pieces that are truly
equivalent. Keep adapter-result construction, candidate ranking, session subject
addressing, and Surface Inspector pin/comment state in their existing modules.

The right end state may be:

- one canonical projection evidence/status normalizer exported from
  `annotation-projection.js`;
- one canonical reveal result normalizer exported from
  `annotation-projection.js`;
- candidates, sessions, and Surface Inspector using those helpers directly;
- tests proving both canonical helpers and the existing higher-level callers.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json --files packages/toolkit/workbench/annotation-projection.js packages/toolkit/workbench/annotation-candidates.js packages/toolkit/workbench/annotation-session.js packages/toolkit/workbench/surface-inspector-annotations.js tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs
node --check packages/toolkit/workbench/annotation-projection.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --check packages/toolkit/workbench/annotation-session.js
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
git diff --check
```

Add or update tests for the canonical normalizers so projection/reveal status
semantics are covered outside a Surface Inspector-only test. If GDI changes
barrel exports in `packages/toolkit/workbench/index.js`, add a small import
probe or test assertion that the intended canonical exports are available.

No live smoke is required for pure normalization. If GDI changes runtime target
resolution, reveal dispatch behavior, or Surface Inspector interaction wiring,
run one bounded live smoke after `./aos ready` passes and report exact
steps/results.

## Completion Report

Report back to Foreman with:

- files changed;
- the canonical home and names for projection/reveal normalization;
- which old duplicate logic was removed;
- whether any compatibility surface remains, and if so the exact consumer and
  removal gate;
- exact tests run and pass/fail results;
- `./aos ready` result or blocker if live smoke was attempted or skipped;
- any behavior changes beyond normalization/import cleanup;
- remaining follow-up recommendation, if any.
