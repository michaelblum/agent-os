# Work Card: Sigil Context Menu Data-Driven Controls V0

## Routing Status

Historical / do not route as-is.

This card points at stale prerequisite branches and an old staged migration that
has been partially superseded by the accepted visual-object architecture, the
avatar object-control adapter, and the `21dc331d` detached Sigil avatar controls
panel. Its "preserve current UI and behavior" framing is no longer strong enough
for the active workstream because it can preserve the private
`sigil.avatar_panel.*` protocol and duplicate target vocabulary.

Current sequence:

1. Accept
   `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`.
2. Refresh toolkit panel placement/final-frame reporting, then add Sigil-owned
   avatar avoidance only if the evidence requires it.
3. Refresh and accept
   `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
4. Route
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.
5. Only after that, refresh any remaining context-menu data-driven-control work
   against the strict resource contract.

When refreshed, the card should require owned callers to migrate to
`visual_object_descriptors`, `canvas_object.registry`,
`canvas_object.transform.patch`, and `canvas_object.effects.patch` in the same
slice, then remove private aliases. Do not keep compatibility buckets unless a
real external consumer or release boundary is named.

## Historical Tracker

- Historical branch, do not use:
  `gdi/sigil-avatar-object-graph-adapter-v0`
- Historical prerequisite adapter head:
  `1e4c44c9d34de3ae8d84481c0fe1a88a127c105f`
- This card follows the read-only avatar object graph adapter. Keep that
  adapter behavior intact while routing context menu controls through
  descriptors/actions.

## Historical Goal

Refactor Sigil context menu control definitions and update routing to consume
descriptors/actions while preserving the current UI and behavior.

This card follows the avatar object graph adapter. It should make the context
menu easier to align with `canvas_object` / object-graph patches, but it should
not redesign the product surface.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/sigil-avatar-object-graph-adapter-v0.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/tesseron.js`
- `apps/sigil/renderer/transition-registry.js`
- `tests/renderer/context-menu-hit-test.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
rg -n "bindControls|syncFromState|state\\.|onAppearanceChange|updateGeometry|tesseron|phenomena|createDesktopWorldRangeDrag|createStackMenu|data-action|context-menu" apps/sigil/context-menu apps/sigil/renderer tests/renderer
```

Run `./aos ready` only if pointer routing or live menu behavior is changed in a
way deterministic tests cannot cover.

## Scope

Introduce a descriptor layer for existing context menu controls. Each descriptor
should identify the DOM/control id, panel/card group, label, type, current state
path or getter, value coercion, target route, persistence behavior, renderer
sync hook, and app action id where applicable.

Route existing event handlers through the descriptors while keeping current DOM,
tabs/cards, stacked submenus, range dragging, accessibility attributes, and
visual styling intact.

## Hard Boundaries

- Do not redesign the context menu.
- Do not remove toolkit `createDesktopWorldInteractionRouter`,
  `createDesktopWorldRangeDrag`, or Zag menu behavior.
- Do not change avatar defaults or persisted appearance schema.
- Do not require the shared 3D editor to exist.
- Do not move Sigil action semantics into toolkit or daemon code.

## Acceptance Criteria

- Current shape, look, effects, world, utility, and avatar JSON controls are
  represented by descriptors or a clearly documented compatibility bucket.
- Object/effect fields route through one descriptor-driven update path that can
  later emit object-graph patches.
- Product actions such as Surface Inspector, Interaction Trace, Render
  Performance, Console Log, Copy, Save, and Import remain Sigil-owned actions.
- `onAppearanceChange` remains the durable persistence notification for
  persisted appearance changes.
- Existing deterministic context menu tests pass, and new focused tests cover
  descriptor routing for at least one shape control, one tesseron control, one
  effect control, one world/window control, and one app action.

## Suggested Implementation Areas

- Add a small descriptor module under `apps/sigil/context-menu/`.
- Keep descriptor values plain JSON/functions local to Sigil.
- Update `menu.js` incrementally: first generate routing from descriptors, then
  consolidate repeated direct state mutation where behavior is identical.
- Preserve public markup ids used by tests and real-input scenarios.

## Verification

Run:

```bash
git diff --check
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
```

If pointer routing, hit regions, or live menu interaction behavior changes,
also run the relevant Sigil real-input scenario named by `apps/sigil/AGENTS.md`.

## Completion Report

Report files changed, descriptor coverage, behavior-preservation evidence,
tests run with exact results, any controls intentionally left in compatibility
routing, local-only state, and the next owner/slice.
