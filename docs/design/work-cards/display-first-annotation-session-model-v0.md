# Display-First Annotation Session Model V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

The worktree may contain unrelated dirty Surface Inspector snapshot artifact
work from #298. Do not overwrite, revert, or reformat those files unless this
card explicitly touches the same path and you first confirm the overlap is
necessary.

## Goal

Add the shared in-memory Annotation Mode session model that future display
overlays, Surface Inspector support views, and Sigil reticle entry can all use.

This slice should not build the full display overlay renderer or Sigil reticle.
It should establish the adapter-neutral state machine and focused tests that
make those slices straightforward.

## Read First

- `AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-layer-foundation-v0.md`
  for historical context only; its Surface Inspector-first route is superseded.
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/annotation-projection.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
gh issue view 296 --json number,title,state,url,body,labels,comments
./aos dev recommend --json
```

This is a toolkit data-model slice. Do not run `./aos ready` or repair loops
unless you later add live runtime behavior. If dirty #298 snapshot artifact
files are present, leave them alone.

## Required Model

Create or extend a toolkit workbench helper for display-first annotation
sessions. Suggested path:

```text
packages/toolkit/workbench/annotation-session.js
```

The exact path may differ if the existing annotation helper is the better home,
but keep the model neutral and reusable. Do not make Surface Inspector the owner
of the state shape.

Minimum session fields:

- `schema`, for example `aos_annotation_session`;
- `version`, initially `0.1.0`;
- `active`;
- `entry_source`, such as `hotkey`, `status_menu`, `surface_inspector`, or
  `sigil_radial`;
- `root`, a normalized subject/address record or `null`;
- `committed_scope_stack`;
- `preview_scope_stack`;
- `hover_candidate`;
- `anchors`;
- `snapshot_count`;
- `updated_at`.

Minimum subject/address fields:

- stable `address`;
- adapter id;
- root id/kind/label;
- subject id/path/kind;
- role/label/value/text excerpt when available;
- source metadata and fallback evidence;
- current projection/status when supplied.

Minimum anchor fields:

- stable id;
- address;
- scope path;
- optional `comment_text`, defaulting to an empty string;
- projection/status;
- actor;
- created/updated timestamps;
- live status such as `live`, `stale`, `absent`, or `blocked`.

## Required Behavior

- A frame is represented as an anchor with empty `comment_text`.
- Adding comment text updates an existing anchor or creates an anchor with text;
  comment text is optional, not required.
- Committed and preview stacks are separate.
- Hover candidate can update preview state without creating a durable anchor.
- Committing preview creates or updates anchors for the selected chain.
- Clearing or exiting mode resets live session state but does not imply a
  snapshot.
- Subject address is authoritative; projection is copied as current evidence
  only.
- Missing or absent subjects become `absent` or `stale` rather than retaining
  stale display overlays as truth.

## Opacity Helper

Add and test a pure helper for frame opacity:

```js
opacityForDepth(index, count, floor = 0.75)
```

Expected examples:

```text
[root]                    => [1]
[root, child]             => [0.75, 1]
[root, child, grandchild] => [0.75, 0.875, 1]
[root, a, b, current]     => [0.75, 0.833..., 0.916..., 1]
```

Do not reuse the old Surface Inspector-first `1 -> 0.25` opacity ladder.

## Relationship To Current Surface Inspector State

Surface Inspector may continue using existing internal `pin` naming until a
later demotion/refactor slice. For this card, add conversion or compatibility
helpers only if they are useful and small:

- Surface Inspector pin/frame records can become session anchors;
- comments can become anchor `comment_text` or comment attachments in a later
  slice;
- transient hover candidates must remain preview-only.

Do not rework Surface Inspector UI, action-control canvases, hit-layer canvases,
minimap rendering, or bundle snapshots in this card.

## Hard Boundaries / Non-Goals

- No display overlay renderer yet.
- No Sigil reticle implementation yet.
- No browser DOM/CDP.
- No broad AX harvesting.
- No long-lived persistent database.
- No report/export renderer.
- No Employer Brand workflow changes.
- No snapshot artifact changes unless a tiny compatibility helper is required
  and it does not touch the dirty #298 implementation.

## Verification

Run:

```bash
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
git diff --check
```

If you do not add `tests/toolkit/annotation-session.test.mjs`, explain why and
name the focused test file that covers the model instead.

## Completion Report

Report:

- changed files;
- final model path and exported helpers;
- how frames/commentless anchors are represented;
- how preview vs committed scope is represented;
- opacity helper behavior;
- deterministic tests and results;
- any untouched dirty files from #298;
- recommended next card, likely display overlay renderer V0.
