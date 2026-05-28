# Sigil UX Tree Trigger Anchor Relations V0

## Recipient

GDI.

## Transfer Kind

Implementation round.

## Single Goal

Add generic UX tree relationship modeling for trigger, open, anchor, and target
surface relationships, then project Sigil avatar/context-menu/radial-menu
relationships through that model without changing runtime behavior.

This intentionally comes before more radial item release cutover work. The goal
is to avoid baking in bespoke assumptions like "the avatar hit canvas owns the
radial menu canvas." Avatar should be one instance of a generic UX relationship
pattern.

## Branch / Base

- `branch_from`: `gdi/sigil-ux-tree-context-menu-bindings-cutover-v0`
- `required_start_ref`: `origin/gdi/sigil-ux-tree-context-menu-bindings-cutover-v0`
- `implementation_base_sha`: `780d46aadeb167098953c00ff9a6c1218895318f`
- Expected output branch: `gdi/sigil-ux-tree-trigger-anchor-relations-v0`
- This is stacked on PR #386, which is stacked on #385, #384, #383, and #382.
- Commit the completed slice. Push the output branch for review if branch-push
  credentials are available. Do not open a PR unless explicitly reassigned.

## Direction Change

Before this decision, the next likely implementation slice was radial item
release cutover. That would continue moving behavior into the command adapter,
but it would still leave the structural relationship between avatar, context
menu, radial menu, and their hit surfaces mostly implicit.

The adjusted direction is:

1. Make trigger/anchor/target-surface relationships explicit and generic.
2. Keep the current Sigil runtime as an adapter/projection of those
   relationships.
3. Resume radial item release and broader avatar/radial cutovers after the
   model no longer implies avatar-specific surface coupling.

## Product Direction

The UX tree should represent:

```text
any UX node
  can have hit/source representation
  can bind gestures/keys to commands
  can trigger/open another UX node
  can anchor another UX node
  can expose target surfaces for hit testing/accessibility
```

For Sigil, avatar is only the first implementation:

```text
sigil.avatar.body
  triggers/opens sigil.avatar.context_menu
  triggers sigil.avatar.radial_menu

sigil.avatar
  anchors sigil.avatar.radial_menu

sigil.avatar.body
  anchors sigil.avatar.context_menu

sigil.avatar.radial_menu
  exposes radial item target surface

sigil.avatar.context_menu
  exposes context menu input/target region
```

Do not model this as "canvas A owns canvas B." Canvases and input regions are
hit-source or target-surface implementations, not the conceptual owner.

## Read First

- `shared/schemas/aos-ux-tree-v0.schema.json`
- `shared/schemas/aos-ux-tree-v0.md`
- `shared/schemas/fixtures/aos-ux-tree-v0/valid/sigil-avatar.json`
- `packages/toolkit/runtime/ux-tree.js`
- `packages/toolkit/workbench/ux-tree-subject.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/context-menu-input.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `tests/schemas/aos-ux-tree-v0.test.mjs`
- `tests/toolkit/runtime-ux-tree.test.mjs`
- `tests/toolkit/ux-tree-subject.test.mjs`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-context-menu-input.test.mjs`

## Required Work

### 1. Extend the UX tree contract

Add a generic relationship model to `aos_ux_tree`.

Prefer a top-level keyed array:

```json
{
  "relations": [
    {
      "id": "sigil.avatar.body.opens_context_menu",
      "relation_type": "opens",
      "from_node_id": "sigil.avatar.body",
      "to_node_id": "sigil.avatar.context_menu",
      "source_metadata": {},
      "metadata": {}
    }
  ]
}
```

Expected relation types for this slice:

- `triggers`
- `opens`
- `anchors`
- `targets`
- `owns`

If a more precise vocabulary emerges while reading the code, use it, but keep
it generic and document it. Do not create avatar-specific relation fields.

Support target-surface metadata as plain JSON under the relation metadata, for
example:

```json
{
  "relation_type": "targets",
  "from_node_id": "sigil.avatar.radial_menu",
  "to_node_id": "sigil.avatar.radial_menu.item.*",
  "metadata": {
    "target_surface": {
      "kind": "radial_menu_targets",
      "lifecycle": "active_radial_phase",
      "hit_source_ref": "radialTargetSurface"
    }
  }
}
```

Schema/runtime requirements:

- `relations` must be allowed by the JSON schema.
- Runtime normalization must preserve relations.
- `relations` must merge by stable `id`, like nodes/commands/bindings.
- Runtime validation must report unknown `from_node_id` or `to_node_id` when
  they refer to concrete node IDs.
- Wildcard or collection refs such as `sigil.avatar.radial_menu.item.*` are
  acceptable in V0 only if documented and validated as relation targets rather
  than node IDs.
- Relation metadata must remain plain JSON; no executable values.

### 2. Project Sigil's current relationships

Update `apps/sigil/renderer/live-modules/ux-tree.js` so
`createSigilUxTree()` includes generic relations for at least:

- `sigil.avatar.body` opens `sigil.avatar.context_menu`;
- `sigil.avatar.body` triggers `sigil.avatar.radial_menu`;
- `sigil.avatar.body` triggers `sigil.avatar.selection_mode` if you judge
  double-click entry should be represented in the same relation family;
- `sigil.avatar` anchors `sigil.avatar.radial_menu`;
- `sigil.avatar.body` anchors `sigil.avatar.context_menu`;
- `sigil.avatar.radial_menu` targets its item nodes through the radial target
  surface implementation;
- `sigil.avatar.context_menu` targets/captures through the context menu input
  region implementation;
- `sigil.avatar.selection_mode` targets/captures through the active
  Selection Mode input region implementation.

Keep node `parent_id` and `children` as structural hierarchy. Relations should
capture behavior/topology that is not pure containment.

### 3. Add runtime helpers

Add small helpers in `packages/toolkit/runtime/ux-tree.js`, such as:

- `normalizeUxTreeRelation(relation, options)`
- `uxTreeRelationsForNode(tree, nodeId, options)`
- `uxTreeRelationsByType(tree, relationType)`

Use the existing helper style and keep dependencies low.

### 4. Update docs, fixture, and workbench subject

Update:

- schema docs;
- valid Sigil fixture;
- any workbench subject/read-only projection so relations are discoverable by
  tools/editors.

The workbench view does not need a rich UI. It only needs to expose relations
as part of the inspectable UX tree subject.

## Hard Boundaries

- Do not change live runtime behavior in this slice.
- Do not cut over radial item release, radial start, avatar double-click, or
  reticle/camera commands.
- Do not create avatar-specific schema fields.
- Do not model canvas IDs as conceptual ownership. Canvas/input-region IDs
  belong in hit-source or target-surface implementation metadata.
- Do not add persistence, editor UI, or user settings writes.
- Do not change context menu or radial menu visuals.

## Acceptance Criteria

- `aos_ux_tree` supports generic relations.
- Runtime normalization, merge, and validation handle relations.
- Sigil UX tree exposes trigger/open/anchor/target relations for avatar,
  context menu, radial menu, and Selection Mode.
- The relation model clearly separates conceptual nodes from implementation
  surfaces/canvases.
- Existing command binding cutovers continue to pass.
- No live behavior changes are introduced.

## Suggested Tests

Add or update tests for:

- valid fixture with relations passes schema validation;
- runtime preserves and normalizes relations;
- relations merge by stable `id`;
- unknown concrete relation node refs produce validation errors;
- wildcard relation targets are allowed only for documented collection targets;
- Sigil UX tree contains expected relations:
  - avatar body opens context menu;
  - avatar body triggers radial menu;
  - avatar anchors radial menu;
  - radial menu targets radial item collection via target-surface metadata;
  - context menu target/capture relation references the context menu input
    region implementation.

## Verification

Run at least:

```bash
./aos dev recommend --json --files \
  shared/schemas/aos-ux-tree-v0.schema.json \
  shared/schemas/aos-ux-tree-v0.md \
  packages/toolkit/runtime/ux-tree.js \
  packages/toolkit/workbench/ux-tree-subject.js \
  apps/sigil/renderer/live-modules/ux-tree.js \
  tests/schemas/aos-ux-tree-v0.test.mjs \
  tests/toolkit/runtime-ux-tree.test.mjs \
  tests/toolkit/ux-tree-subject.test.mjs \
  tests/renderer/sigil-ux-tree.test.mjs

node --check packages/toolkit/runtime/ux-tree.js
node --check packages/toolkit/workbench/ux-tree-subject.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --test tests/schemas/aos-ux-tree-v0.test.mjs
node --test tests/toolkit/runtime-ux-tree.test.mjs \
  tests/toolkit/ux-tree-subject.test.mjs
node --test tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-context-menu-input.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs
git diff --check
```

Run `./aos ready` if it is cheap. If it reports a repo-mode TCC/input-tap
blocker, stop and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then rerun:

```bash
./aos ready --post-permission
```

after the human returns with `finished`.

## Completion Report

Include:

- branch name;
- head SHA and base SHA;
- changed files;
- summary of relation vocabulary added;
- confirmation that live behavior did not change;
- tests and checks run;
- next recommended binding family after relations are accepted;
- `git status --short --branch`;
- `git show --stat HEAD`.
