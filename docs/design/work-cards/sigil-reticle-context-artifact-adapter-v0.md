# Sigil Reticle Context Artifact Adapter V0

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
Sigil runtime state, Surface Inspector runtime state, or prior conversation
details. Read and rediscover before editing.

Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the follow-up slice after the context session foundation and Surface
Inspector adapter. Keep the slice focused on making Sigil reticle commits expose
canonical context-session data alongside the existing reticle
`aos_annotation_session`.

## Branch / Base

- `branch_from`: `gdi/surface-inspector-context-session-adapter-v0`
- `required_start_ref`: local branch
  `gdi/surface-inspector-context-session-adapter-v0` at or after commit
  `a5c9c5ae feat(toolkit): add surface inspector context adapter`, plus this
  work card
- Expected output branch: continue from the current local branch or create a
  focused successor branch if useful
- Do not push, open a PR, or mutate GitHub state unless explicitly asked

## Goal

Make Sigil reticle commits create and retain canonical `aos_context_session`
data using the shared toolkit context-session helpers.

The existing reticle `aos_annotation_session` remains the V0 live in-memory
core. This slice adds the context artifact wrapper around it so later radial
camera and `ctrl+opt+c` export slices can include canonical keyframe/session
data without reading Surface Inspector compatibility state as truth.

## Read First

Read at minimum:

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `docs/design/work-cards/context-artifact-keyframe-foundation-v0.md`
- `docs/design/work-cards/surface-inspector-context-session-adapter-v0.md`
- `shared/schemas/aos-context-session-v0.md`
- `packages/toolkit/workbench/context-session.js`
- `packages/toolkit/workbench/annotation-session.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/toolkit/context-session.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git worktree list
./aos dev recommend --json
rg -n "createContextArtifactFromAnnotationSession|createContextSession|aos_context_session|createSigilAnnotationReticleController|commitRelease|requestSnapshotEvent|annotationReticle|canvas_inspector.capture_bundle|annotation-camera" packages apps/sigil tests docs
```

If `./aos dev recommend --json` fails, record the failure and continue with
bounded renderer/toolkit checks.

## Required Behavior

### Reticle Context Session

Add a Sigil-reticle-scoped adapter path that derives canonical context data from
the reticle's current `aos_annotation_session`.

Suggested shape:

```js
createSigilAnnotationReticleContextSession(snapshotOrSession, options?)
```

The exact helper name may differ if a clearer local convention emerges, but the
contract should be explicit that this is Sigil reticle scoped and returns an
`aos_context_session`.

The adapter should:

- use `packages/toolkit/workbench/context-session.js` helpers, especially
  `createContextArtifactFromAnnotationSession` and `createContextSession`, rather
  than duplicating normalization logic;
- keep `source_annotation_session` populated from the existing reticle session;
- create at least one `aos_context_artifact` for the committed reticle path when
  live committed anchors exist;
- preserve nested committed scope path order from root to current active scope;
- preserve the active target as the deepest committed reticle path node for V0;
- preserve reticle acquisition provenance as `mode: "sigil_radial"` and include
  release pointer, candidate decision report, fallback/blocker reason, root
  evidence, placement, and source metadata where available;
- preserve commentless frames as anchors and preserve any compatible
  `comment_text` already present on anchors;
- keep stale, absent, blocked, or display-fallback projection evidence explicit
  through the context artifact path/anchors.

### Controller State

When the reticle commits, update controller state so `snapshot()` and
`requestSnapshotEvent()` can expose the current canonical context session in
addition to the existing annotation session.

Expected V0 fields are intentionally additive. Reasonable names include:

- `context_session` on the reticle snapshot;
- `context_session` on the last committed event;
- `context_session` on the snapshot request event.

If no committed live anchors exist, the context session may be absent/null or may
be an empty context session, but the behavior must be explicit and tested.

### Main Renderer Exposure

Keep `liveJs.annotationReticle` and `window.__sigilDebug.snapshot().annotationReticle`
as the debug/export-facing place to inspect reticle state. If a separate
`liveJs.annotationReticleContextSession` makes the code cleaner, keep it
additive and ensure the debug snapshot exposes it clearly.

Do not change radial camera bundle transport in this slice. It is enough for
`requestAnnotationSnapshot()` to record or carry the context session inside the
reticle snapshot/request event; the actual `canvas_inspector.capture_bundle`
payload and daemon bundle output are a later slice.

## Hard Boundaries / Non-Goals

- No Surface Inspector UI changes.
- No daemon or Swift changes.
- No `ctrl+opt+c` behavior changes.
- No radial camera bundle output changes.
- No Selection Mode.
- No recording schema work.
- No new persistent annotation database.
- No broad Sigil radial menu redesign.
- No live/visual test requirement unless the implementation changes runtime
  behavior beyond debug/session payloads.

## Suggested Implementation Areas

Likely files:

- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`

Only touch toolkit context-session helpers or schemas if the foundation contract
has an actual reticle-blocking gap. If that happens, keep the change narrow and
explain the gap in the completion report.

## Required Tests

Add or update focused tests proving:

- a reticle commit produces an `aos_context_session`;
- the context session preserves `source_annotation_session`;
- the context artifact path mirrors the committed root-to-leaf reticle scope
  stack;
- the active target is the deepest committed node for V0;
- release pointer, decision report, fallback/blocker reason, root evidence, and
  placement are preserved as acquisition provenance;
- display fallback remains explicit rather than looking like a native/DOM target;
- nested reticle commits produce a nested artifact path;
- `requestSnapshotEvent()` exposes the same current context session without
  changing radial camera bundle transport behavior.

Keep existing reticle, radial menu, and context-session tests passing.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  apps/sigil/renderer/live-modules/annotation-reticle.js \
  apps/sigil/renderer/live-modules/main.js \
  tests/renderer/annotation-reticle.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  packages/toolkit/workbench/context-session.js \
  tests/toolkit/context-session.test.mjs
```

Run deterministic checks based on actual changes. Expected candidates:

```bash
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --check packages/toolkit/workbench/context-session.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/toolkit/context-session.test.mjs
node --test tests/schemas/aos-context-session-v0.test.mjs
git diff --check
```

Do not run live, visual, daemon, or real-input tests for this slice unless the
router or an actual code change makes them necessary.

## Completion Report

Report:

- files changed;
- adapter/helper export name and behavior;
- where the reticle snapshot/request exposes the context session;
- how the committed path, active target, comments, decision report, pointer,
  fallback/blocker evidence, and placement are mapped;
- confirmation that radial camera bundle transport/output is unchanged;
- tests/checks run with results;
- first recommended follow-up slice;
- current `git status --short --branch`;
- commit hash if committed.
