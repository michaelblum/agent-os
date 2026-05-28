# Surface Inspector Context Session Adapter V0

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
Surface Inspector runtime state, Sigil runtime state, or prior conversation
details. Read and rediscover before editing.

Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the follow-up slice after the context artifact/keyframe foundation. Keep
the slice focused on Surface Inspector as a compatibility adapter into the new
context session family.

## Branch / Base

- `branch_from`: `gdi/context-artifact-keyframe-foundation-v0`
- `required_start_ref`: local branch
  `gdi/context-artifact-keyframe-foundation-v0` at or after commit
  `345ad202 feat(toolkit): add context session foundation`, plus this work card
- Expected output branch: continue from the current local branch or create a
  focused successor branch if useful
- Do not push, open a PR, or mutate GitHub state unless explicitly asked

## Goal

Demote Surface Inspector pins/comments from "annotation truth" toward
compatibility/editor state by adding a clean adapter from current Surface
Inspector annotation state into `aos_context_session`.

This slice should not change Surface Inspector UI behavior, daemon bundle
behavior, Sigil reticle behavior, hotkeys, or Selection Mode. It should add the
adapter contract and tests that later runtime/export slices can call.

## Read First

Read at minimum:

- `AGENTS.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `docs/design/work-cards/context-artifact-keyframe-foundation-v0.md`
- `shared/schemas/aos-context-session-v0.md`
- `shared/schemas/aos-context-session-v0.schema.json`
- `packages/toolkit/workbench/context-session.js`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `docs/api/toolkit/workbench.md`
- `tests/toolkit/context-session.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/schemas/aos-context-session-v0.test.mjs`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git worktree list
./aos dev recommend --json
rg -n "surfaceInspectorAnnotationStateToSession|buildSurfaceInspectorAnnotationSnapshotArtifact|aos_context_session|createContextSession|normalizeContextArtifact|context keyframe|pinSurfaceInspectorFrame|addSurfaceInspectorComment" packages docs tests shared
```

If `./aos dev recommend --json` fails, record the failure and continue with
bounded toolkit/schema checks.

## Required Behavior

### Adapter Export

Add an adapter function in `packages/toolkit/workbench/surface-inspector-annotations.js`
that converts current Surface Inspector annotation state into the canonical
context session family.

Suggested export:

```js
surfaceInspectorAnnotationStateToContextSession(state, options?)
```

The exact name may differ if a clearer local convention emerges, but it must be
explicitly Surface Inspector scoped and must return an `aos_context_session`.

The adapter should:

- call or reuse `createSurfaceInspectorAnnotationState` for state
  normalization;
- call or reuse `surfaceInspectorAnnotationStateToSession` so
  `aos_annotation_session` remains the V0 core;
- use `packages/toolkit/workbench/context-session.js` helpers instead of
  duplicating context-session normalization logic;
- set `source_annotation_session` from the existing session boundary;
- produce context artifacts from active Surface Inspector pins/comments;
- preserve comment text as path-node comments and compatible anchor
  `comment_text`;
- preserve projection, stale, absent, unsupported, and blocker evidence;
- preserve acquisition provenance as `mode: "surface_inspector"` with enough
  source metadata to explain that the artifact came from the compatibility
  Surface Inspector state;
- preserve active scope path semantics where `annotation_scope_stack` or
  `active_frame_id` already identifies a current path.

### Artifact Mapping

Represent multiple Surface Inspector selections without inventing a new UI:

- Prefer one context artifact per active frame pin path, where each artifact
  path is the pin's parent chain from root to that pin.
- For the current active frame, mark that artifact as the active artifact and
  its deepest node as `active_target_node_id`.
- If a pin has comments, attach those comments to the path node for that pin.
- If a pin is not in the current active path but is still active/commented, do
  not drop it. Either emit a separate artifact for its parent chain or document
  a precise V0 limitation with a test that proves the chosen behavior.

Use existing pin relationships (`parent_pin_id`, `annotation_scope_stack`,
`active_frame_id`) and existing helpers such as `surfaceInspectorPinToAnnotationAnchor`
rather than adding a separate Surface Inspector model.

### Snapshot Compatibility

Do not change the public `surface_inspector_annotation_snapshot` schema or
bundle output shape in this slice.

If useful, add a helper that derives a context session from a built
`surface_inspector_annotation_snapshot`, but keep it additive and tested. Do not
embed new context-session fields into the existing snapshot artifact unless the
schema and docs are updated intentionally; that is likely a later export slice.

### Docs

Update the smallest relevant docs to explain that Surface Inspector now has a
compatibility adapter into `aos_context_session`. Likely place:

- `docs/api/toolkit/workbench.md`

Avoid broad docs churn.

## Hard Boundaries / Non-Goals

- No Surface Inspector UI redesign.
- No daemon or Swift changes.
- No `ctrl+opt+c` bundle output changes.
- No Sigil reticle runtime changes.
- No radial camera behavior changes.
- No Selection Mode.
- No recording schema work.
- No schema rename.
- No persistent annotation database.
- No broad compatibility cleanup.

## Suggested Implementation Areas

Likely files:

- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `docs/api/toolkit/workbench.md`

Only touch `packages/toolkit/workbench/context-session.js` or
`shared/schemas/aos-context-session-v0.schema.json` if the foundation contract
has an actual adapter-blocking gap. If that happens, keep the change narrow and
explain the gap in the completion report.

## Required Tests

Add focused tests proving:

- Surface Inspector state converts to an `aos_context_session`;
- the converted context session preserves `source_annotation_session`;
- one active pin path becomes a context artifact with expected path node,
  active target, acquisition mode, anchor, and comment;
- nested pins produce a root-to-leaf context path;
- multiple active/commented pins are not silently dropped;
- stale/absent projection and blocker evidence survive conversion;
- existing `surfaceInspectorAnnotationStateToSession` and
  `buildSurfaceInspectorAnnotationSnapshotArtifact` tests still pass.

If you choose a documented V0 limitation instead of emitting an artifact for
every active/commented pin, include a test that locks the limitation and a clear
doc note that names the later removal gate.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  packages/toolkit/workbench/surface-inspector-annotations.js \
  tests/toolkit/surface-inspector-annotations.test.mjs \
  docs/api/toolkit/workbench.md \
  packages/toolkit/workbench/context-session.js \
  tests/toolkit/context-session.test.mjs \
  shared/schemas/aos-context-session-v0.schema.json
```

Run deterministic checks based on actual changes. Expected candidates:

```bash
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --check packages/toolkit/workbench/context-session.js
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/context-session.test.mjs
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/schemas/aos-context-session-v0.test.mjs
git diff --check
```

Do not run live, visual, daemon, or browser tests for this slice.

## Completion Report

Report:

- files changed;
- adapter export name and behavior;
- how many artifacts are produced for representative Surface Inspector state;
- how active path, comments, and stale/blocker evidence are mapped;
- compatibility guarantees for `surface_inspector_annotation_snapshot`;
- tests/checks run with results;
- first recommended follow-up slice;
- current `git status --short --branch`;
- commit hash if committed.
