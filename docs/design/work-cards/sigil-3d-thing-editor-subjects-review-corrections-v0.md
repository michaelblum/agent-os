# Work Card: Sigil 3D Thing Editor Subjects Review Corrections V0

## Tracker

- Continue from branch: `implementer/sigil-avatar-object-graph-adapter-v0`
- Review target head:
  `cc63cf794c70c2ea8c51c4ff9fdaa486157074c2`
- Parent card:
  `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`
- Review outcome: not accepted yet. The subject loader shape is broadly on
  target and deterministic tests pass, but avatar subject owner-managed patch
  results currently violate the canonical `canvas_object` result schema.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Continue from the existing branch and preserve the accepted adapter and
context-menu descriptor work already under it.

## Goal

Repair the avatar subject patch result contract so every result returned by the
3D thing editor subject loader is valid for the message type it claims to emit.

The avatar subject may continue to reject owner-managed transform/effects
patches in this slice. The fix is to make that rejection use canonical
`canvas_object.transform.result` and `canvas_object.effects.result` fields, not
a private error shape.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`
- `apps/sigil/radial-item-editor/model.js`
- `tests/renderer/radial-item-editor.test.mjs`
- `tests/schemas/canvas-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
rg -n "subjectResult|canvas_object.transform.result|canvas_object.effects.result|reason|error|visibility.patch|object-controls" apps/sigil/radial-item-editor tests/renderer shared/schemas
```

## Review Finding

### Avatar Owner-Managed Patch Results Are Not Valid `canvas_object` Results

At reviewed head, `apps/sigil/radial-item-editor/model.js` returns avatar
owner-managed rejections through `subjectResult()`:

```js
return {
    type,
    schema_version: RADIAL_ITEM_EDITOR_LOCK_IN_SCHEMA_VERSION,
    request_id: text(requestId, 'editor-subject-request'),
    target: cloneConfig(target),
    status,
    error: { code, message },
};
```

For `type: "canvas_object.transform.result"` and
`type: "canvas_object.effects.result"`, this violates
`shared/schemas/canvas-object-control.schema.json`: rejected/stale results must
include a schema `reason` such as `unsupported_capability` or `owner_rejected`,
may include `message`, and may not include an extra `error` object.

Foreman reproduced the failure with the current helper output; the schema
validator reports the result is not valid under any canvas-object-control
schema branch.

Required correction:

- Change avatar owner-managed transform/effects rejection helpers to return
  canonical canvas-object result fields:
  - `type`
  - `schema_version`
  - `request_id`
  - `target`
  - `status: "rejected"`
  - `reason`, preferably `unsupported_capability` unless code inspection shows
    `owner_rejected` is more accurate
  - `message`
- Do not add private fields to canonical result messages unless the shared
  schema is intentionally updated in the same slice. A schema update should not
  be necessary for this correction.
- Add or adjust focused tests so avatar subject transform and effects rejection
  results validate against `shared/schemas/canvas-object-control.schema.json`,
  not only local shape assertions.
- Check whether the avatar workbench subject advertises
  `canvas_object.visibility.patch` in any facet despite the avatar descriptor
  not supporting it. If it does, either remove the unsupported contract from
  avatar facets or document and test why it remains safe. Prefer not
  advertising unsupported contracts.

## Hard Boundaries / Non-Goals

- Do not implement live avatar transform/effects mutation in this correction.
- Do not change context menu behavior.
- Do not remodel the radial item editor UI or panel/window chrome.
- Do not move renderer ownership into toolkit or daemon code.
- Do not introduce new dependencies.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/radial-item-editor/model.js
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/avatar-object-control.test.mjs
node --test tests/schemas/canvas-object-control.test.mjs
```

Live launch is not required unless this correction changes editor launch,
canvas subscription, panel behavior, or context menu behavior.

## Completion Report

Include:

- files changed;
- exact result shape chosen for avatar owner-managed transform/effects
  rejections;
- whether avatar subject facets still advertise `visibility.patch`;
- tests/checks run with exact results;
- local-only state;
- remaining follow-up recommendation.
