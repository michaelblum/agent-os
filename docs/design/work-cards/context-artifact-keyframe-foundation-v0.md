# Context Artifact + Keyframe Foundation V0

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
runtime state, Surface Inspector state, Sigil state, prior side conversation, or
schema conventions beyond what is rediscovered locally.

Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the first implementation slice after the convergence map. Keep it
focused on a canonical context artifact/keyframe foundation. Do not implement
Selection Mode, do not refactor Sigil runtime behavior, do not change daemon
hotkeys, and do not redesign Surface Inspector UI.

## Branch / Base

- `branch_from`: current local `main` at or after
  `a5d21ce1 docs(annotation): map context session keyframe convergence`
- `required_start_ref`: local `main` including this work card
- Expected output branch: optional; use a focused implementation branch only if
  useful
- Do not push, open a PR, or mutate GitHub state unless explicitly asked

## Goal

Implement the smallest canonical context artifact/keyframe foundation that
future Reticle, Selection Mode, Surface Inspector, radial camera, `ctrl+opt+c`,
and recording work can target.

Keep `aos_annotation_session` as the V0 in-memory core. Add a wrapper model and
schema layer around it for:

- `aos_context_session`;
- `aos_context_artifact`;
- context path nodes;
- active target selection;
- acquisition evidence;
- comments attached to path nodes or anchors;
- projection/blocker state;
- `aos_context_keyframe`.

This slice should create stable contracts and tests only. Runtime writers and
exporters can be updated in later slices.

## Read First

Read at minimum:

- `AGENTS.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-show-me-record-contract-v0.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/CONTRACT-GOVERNANCE.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`
- `shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/valid/annotated.json`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/annotation-session.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/annotation-overlay-renderer.test.mjs`
- `tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs`

Use the convergence map as direction, but verify details from code and tests.

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git worktree list
./aos dev recommend --json
rg -n "aos_annotation_session|surface_inspector_annotation_snapshot|context artifact|aos_context|keyframe|recording|annotation-session|surface-inspector-annotations" docs shared packages tests apps src
```

This slice should be deterministic. If `./aos dev recommend --json` fails,
record the failure and continue with bounded schema/toolkit checks.

## Required Deliverables

### 1. Canonical Contract Docs

Add durable docs for the V0 foundation. Suggested paths:

- `shared/schemas/aos-context-session-v0.md`
- a concise update or pointer in `docs/api/toolkit/workbench.md`

The docs must define:

- the relationship between `aos_annotation_session` and
  `aos_context_session`;
- why `aos_annotation_session` remains the V0 core;
- what a context artifact is;
- how a path node maps to a normalized annotation subject/address;
- how active target can differ from clicked/hovered leaf;
- how comments attach to path nodes or anchors;
- how projection/blocker evidence is preserved;
- what a context keyframe captures;
- how future recordings should reference keyframes without creating a second
  annotation model.

### 2. Schema Foundation

Add schema coverage for the foundation. Suggested paths:

- `shared/schemas/aos-context-session-v0.schema.json`
- optional `shared/schemas/aos-context-keyframe-v0.schema.json` only if keeping
  it separate is clearer than nesting keyframes in the session schema
- fixtures under `shared/schemas/fixtures/aos-context-session-v0/`
- schema tests under `tests/schemas/aos-context-session-v0.test.mjs`

The schema must be strict enough to protect the contract but not so specific
that it forces future Selection Mode or recording UI decisions.

Minimum required schema concepts:

- top-level schema/version/id/timestamps;
- `entry_source`;
- `source_annotation_session` or embedded compatible
  `aos_annotation_session` summary;
- `artifacts[]`;
- each artifact has `id`, `path[]`, `active_target_node_id`, `acquisition`,
  `anchors[]`, and optional metadata;
- each path node has `id`, `address`, subject identity, label/kind/role,
  projection/status evidence, blocker evidence, and `comments[]`;
- acquisition supports `mode`, pointer, leaf node id, selected node id,
  candidate report, and source metadata;
- `keyframes[]` with id, captured_at, trigger, artifact refs or embedded
  artifacts/session summary, and asset refs;
- no embedded image/base64/data URL payloads in keyframes or assets.

Minimum fixtures:

- valid fixture where active target is the clicked leaf;
- valid fixture where active target is an ancestor and clicked leaf is preserved
  in acquisition evidence;
- valid fixture with two artifacts on different surfaces and one keyframe that
  references both;
- invalid fixture missing ordered path or active target;
- invalid fixture with an embedded image/base64/data URL asset.

### 3. Toolkit Helper Foundation

If bounded, add a small toolkit helper module for normalization/building. A
reasonable path is:

- `packages/toolkit/workbench/context-session.js`

Do this only if it reduces fixture/test duplication and gives later slices a
real target. Keep it adapter-neutral and import/reuse existing annotation
session helpers where appropriate.

Potential helper exports:

- `createContextSession`;
- `normalizeContextArtifact`;
- `normalizeContextPathNode`;
- `createContextArtifactFromAnnotationSession`;
- `createContextKeyframe`;
- `contextSessionSnapshot`;

Do not rename or replace `annotation-session.js`. Do not move Surface
Inspector-specific helpers into the neutral module.

### 4. Tests

Add focused deterministic tests. Suggested paths:

- `tests/toolkit/context-session.test.mjs` if a helper module is added
- `tests/schemas/aos-context-session-v0.test.mjs`

Tests should prove:

- a context session can wrap an `aos_annotation_session`;
- a context artifact can preserve a root-to-leaf path;
- active target can equal the leaf or be an ancestor;
- acquisition evidence preserves clicked/hovered leaf, selected target,
  pointer, and candidate report;
- comments can attach to path nodes without losing compatibility with anchor
  `comment_text`;
- keyframes can reference multiple artifacts;
- schema rejects missing required path/active target data;
- schema rejects embedded image/base64/data URL assets.

Run existing annotation session tests to guard compatibility.

## Scope

Allowed:

- docs;
- shared schemas;
- schema fixtures/tests;
- small adapter-neutral toolkit helper;
- API documentation pointer updates;
- small test-only fixtures.

Out of scope:

- Sigil runtime behavior;
- Surface Inspector UI behavior;
- daemon or Swift bundle code;
- hotkey behavior;
- radial camera export behavior;
- Selection Mode;
- recording UI;
- persistent annotation database;
- GitHub state.

## Implementation Notes

Prefer additive contracts over renaming existing surfaces.

Use compatibility language explicitly:

- `aos_annotation_session` remains the canonical V0 live session core.
- `aos_context_session` is the higher-level wrapper for one or more artifacts
  and keyframes.
- `surface_inspector_annotation_snapshot` remains the Surface Inspector bundle
  compatibility artifact.

Avoid broad churn in docs. Add concise pointers instead of rewriting unrelated
sections.

Keep schemas JSON-compatible and deterministic. Use existing schema test style:
`python3` with `jsonschema.Draft202012Validator` is acceptable because the
current snapshot schema tests use it.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  shared/schemas/aos-context-session-v0.md \
  shared/schemas/aos-context-session-v0.schema.json \
  tests/schemas/aos-context-session-v0.test.mjs \
  packages/toolkit/workbench/context-session.js \
  tests/toolkit/context-session.test.mjs \
  docs/api/toolkit/workbench.md
```

Run deterministic checks based on actual changes. Expected candidates:

```bash
node --check packages/toolkit/workbench/context-session.js
node --test tests/toolkit/context-session.test.mjs
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/schemas/aos-context-session-v0.test.mjs
node --test tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
git diff --check
```

If no toolkit helper is added, skip the helper-specific checks and explain why.

Do not run live, visual, daemon, or browser tests for this slice.

## Completion Report

Report:

- files changed;
- whether a toolkit helper module was added or intentionally deferred;
- schema/docs/fixture paths;
- exact shape of the canonical wrapper chosen;
- compatibility guarantees for `aos_annotation_session` and
  `surface_inspector_annotation_snapshot`;
- tests/checks run with results;
- first recommended follow-up slice;
- current `git status --short --branch`;
- commit hash if committed.
