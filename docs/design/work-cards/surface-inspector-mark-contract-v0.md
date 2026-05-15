# Surface Inspector Mark Contract V0

## Tracker

- Epic: #223 AOS Surface System
- Source queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- Checkpoint PR: #307 Surface Stack V0 checkpoint
- Related docs:
  `docs/api/toolkit/components.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. The repo should be mostly clean except for local editor state such as
`.vscode/`; do not stage or mutate unrelated local files.

## Goal

Make the `canvas_object.marks` contract clear enough that mark producers and
reviewers can distinguish fixed minimap markers from DesktopWorld-sized spatial
regions.

The defect that exposed this: radial hit geometry was correct, but Surface
Inspector's mini-map visually flattened it because fixed-size minimap markers
and projected world-size hit areas were not clearly distinguished by contract.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/components/surface-inspector/marks/normalize.js`
- `packages/toolkit/components/surface-inspector/marks/render.js`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "canvas_object\\.marks|emit.*marks|minimapSizeMode|minimap_size_mode|sizeMode|size_mode" apps packages tests docs/api/toolkit
```

If runtime readiness is blocked, this slice can still proceed with deterministic
Node/docs verification. Report the readiness blocker instead of starting a
repair loop unless the tests you choose require live AOS.

## Existing Code To Inspect

- `packages/toolkit/components/surface-inspector/marks/normalize.js` - accepts
  `minimapSizeMode`, `minimap_size_mode`, `sizeMode`, and `size_mode`; defaults
  to `minimap`; currently only preserves `desktop_world`.
- `packages/toolkit/components/surface-inspector/marks/render.js` - applies
  `desktop_world` sizing by multiplying `w`/`h` by the minimap layout scale.
- `packages/toolkit/components/surface-inspector/index.js` - passes layout to
  `renderMinimapMark`.
- `packages/toolkit/components/spatial-telemetry/index.js` and
  `packages/toolkit/components/spatial-telemetry/model.js` - consume normalized
  marks for tabular telemetry, but do not render minimap-sized SVG marks.
- `apps/sigil/renderer/live-modules/main.js` - live mark producer for avatar and
  radial targets; radial marks already opt into `minimap_size_mode:
  "desktop_world"`.
- `tests/toolkit/surface-inspector-marks-normalize.test.mjs` and
  `tests/toolkit/surface-inspector-marks-render.test.mjs` - focused behavior
  tests for mark normalization/rendering.
- `tests/surface-inspector-primitive-marks.sh` and
  `tests/spatial-telemetry-smoke.sh` - live/shell mark consumers with fixed-size
  test marks.

## Required Behavior

### Contract Documentation

Update `docs/api/toolkit/components.md` so `canvas_object.marks` documents:

- `x`/`y` are DesktopWorld coordinates, not local canvas coordinates;
- default `w`/`h` are minimap-local logical pixels for stable fixed-size
  markers;
- `minimapSizeMode: "minimap"` means `w`/`h` stay fixed in mini-map pixels;
- `minimapSizeMode: "desktop_world"` means `w`/`h` represent DesktopWorld
  dimensions and are projected by the current mini-map scale;
- accepted wire aliases are `minimapSizeMode`, `minimap_size_mode`, `sizeMode`,
  and `size_mode`, but new producers should prefer one canonical spelling;
- producer guidance:
  - use fixed minimap mode for points, cursors, debug pings, or object centers;
  - use DesktopWorld mode for hit boxes, radial target extents, child surface
    bounds, or any mark meant to show geographic size.

### Producer Audit

Audit current mark producers and tests. Keep or add `desktop_world` sizing only
where marks represent spatial regions. Do not mechanically change fixed demo
or point marks.

Expected starting point:

- Sigil radial target marks should use DesktopWorld sizing.
- Sigil avatar center or debug point marks may stay fixed-size unless they
  intentionally represent the avatar's physical hit surface.
- Shell smoke demo marks may stay fixed-size and should act as examples of
  minimap-local markers.

### Tests

Add or adjust focused tests so failures are easy to diagnose:

- normalization preserves all accepted aliases and defaults to `minimap`;
- rendering scales only `desktop_world` marks and leaves fixed minimap marks
  stable;
- docs contract test covers the public wording for fixed versus
  DesktopWorld-projected sizes;
- if a producer changes, add or update a focused test proving its intended
  `minimapSizeMode`.

## Scope

This is a toolkit component/API/docs slice with a small producer audit. It may
touch Sigil only if the audit finds a live mark producer with the wrong
`minimapSizeMode`.

## Hard Boundaries

- Do not change the daemon, input routing, panel/windowing, or canvas lifecycle.
- Do not add a new mark schema file unless the existing API docs/tests are
  insufficient after inspection.
- Do not rewrite Surface Inspector layout or minimap projection.
- Do not change real-input scenarios except to update a narrow assertion if a
  producer contract changes.
- Do not reopen #305; this is a follow-up tooling slice under #223.

## Suggested Implementation Areas

Likely files:

- `docs/api/toolkit/components.md`
- `packages/toolkit/components/surface-inspector/marks/normalize.js`
- `packages/toolkit/components/surface-inspector/marks/render.js`
- `tests/toolkit/surface-inspector-marks-normalize.test.mjs`
- `tests/toolkit/surface-inspector-marks-render.test.mjs`
- `tests/toolkit/toolkit-api-docs-contract.test.mjs`
- `apps/sigil/renderer/live-modules/main.js` only if the producer audit finds a
  concrete mismatch.

## Verification

Minimum:

```bash
node --test tests/toolkit/surface-inspector-marks-normalize.test.mjs tests/toolkit/surface-inspector-marks-render.test.mjs tests/toolkit/toolkit-api-docs-contract.test.mjs
git diff --check
```

If Sigil mark production changes, also run:

```bash
node --test tests/renderer/radial-menu-target-surface.test.mjs tests/renderer/hit-target.test.mjs
```

Live AOS smoke is optional for this slice. If `./aos ready` is clean and GDI
wants a runtime proof, prefer a focused Surface Inspector mark smoke over
running radial real-input scenarios.

## Completion Report

Include:

- files changed;
- exact mark contract wording added;
- producer audit result and any producers changed;
- tests run and results;
- readiness result or blocker;
- remaining follow-up item recommendation from
  `surface-stack-retrospective-followups-v0.md`.
