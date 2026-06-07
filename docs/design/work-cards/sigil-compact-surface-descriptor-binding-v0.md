# Sigil Compact Surface Descriptor Binding

## Routing Status

Historical / do not route as-is.

The descriptor-binding direction in this card has already been absorbed into the
accepted visual-object architecture and compact surface implementation. The
active drift risk is different: after `21dc331d`, the detached Sigil avatar
controls panel still communicates with `avatar-main` through private
`sigil.avatar_panel.*` messages. The next panel work must migrate that panel to
the existing descriptor/resource contracts and remove the private route.

Before routing
`docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`,
accept `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`,
refresh toolkit panel placement/final-frame reporting, add Sigil-owned avatar
avoidance only if the evidence requires it, and refresh/accept live panel drag
correction. Do not use this historical card to keep a second compact-surface
mutation path or compatibility layer.

## Tracker

- Source prompt: user reported the compact surface was lost after the visual object descriptor refactor and asked for the clean reinstatement path.
- Related inventory: `BROKE.md` PR #392 deterministic breakage inventory is closed.
- Transfer kind: GDI round.
- Branch/base: start from current `origin/main`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Reinstate the Sigil avatar compact surface in the post-refactor shape by making the live right-click control surface use the descriptor binding contract that `apps/sigil/avatar-editor/compact-surface.js` already supports.

The intended direction is not to resurrect a parallel hand-written context menu. The compact surface should remain a projection of `apps/sigil/avatar-editor/model.js`, backed by `visual_object_descriptors`, object graph groups, toolkit tabs/forms/controls, and the shared visual object form binding path.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/descriptors.js`
- `packages/toolkit/workbench/visual-object-form-binding.js`
- `packages/toolkit/workbench/visual-object-contract.js`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`
- `tests/renderer/sigil-context-menu-input.test.mjs`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`

## Rediscover State

```bash
git status --short --branch
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/renderer/sigil-context-menu-input.test.mjs
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs
```

Foreman's checkout has unrelated `.codex/config.toml` dirt. Do not modify or revert it. If tests that enforce a clean worktree behave oddly, rerun from a clean temp worktree before classifying failures.

## Current Understanding

- `createSigilAvatarCompactControlSurface(...)` already has descriptor binding support through `visualObjectBinding` and `bindVisualObjectForm(...)`.
- `buildSigilAvatarEditorModel(...)` returns `visual_object_descriptors`; it does not export a standalone descriptor array.
- `buildSigilAvatarCompactSurfaceViewModel(...)` carries `visual_object_descriptors` into the compact surface view model.
- Live `apps/sigil/context-menu/menu.js` currently mounts the compact surface on right-click but routes field changes through `applyContextMenuDescriptorUpdate(...)` and local `routeChangedControls(...)`, not through `visualObjectBinding`.
- Current right-click routing is command-based:
  - closed menu + right-click: execute `sigil.context_menu.open`;
  - open menu + right-click: execute `sigil.context_menu.toggle`;
  - `openAt(...)` mounts the compact surface asynchronously in `#sigil-context-menu`;
  - mount failure logs `[sigil] avatar control surface mount failed:`.

## Required Behavior

- Avatar right-click still opens the compact tabbed avatar control surface.
- The live compact surface binds canonical avatar controls through `visualObjectBinding` using the model/view-model `visual_object_descriptors`.
- Route handlers and renderer-sync handlers preserve the existing Sigil behavior:
  - geometry controls still update the avatar geometry;
  - stellation/tesseron/omega controls still call the correct existing update paths;
  - appearance/color/effect controls still sync through the existing Sigil update functions;
  - projection-only tools remain explicit shortcuts and are not treated as canonical avatar edits.
- Avoid duplicate mutation paths. After the live surface uses descriptor binding for canonical controls, do not also route the same canonical change through `applyContextMenuDescriptorUpdate(...)`.
- Preserve current command-routed right-click behavior and duplicate-open echo suppression.
- Keep the compact surface as a post-refactor projection of the avatar editor model. Do not reintroduce legacy table/list menu markup as the primary control UI.

## Suggested Implementation Areas

Start in `apps/sigil/context-menu/menu.js`.

Likely shape:

- Build or reuse the compact surface model/view model from the current `state`.
- Pass `visualObjectBinding` into `createSigilAvatarCompactControlSurface(...)` with:
  - caller-owned `state`;
  - descriptors from the view model/model;
  - route handlers that delegate to the existing Sigil descriptor/update behavior without bypassing the binding contract;
  - renderer-sync handlers mapped to the existing functions passed into `createSigilContextMenu(...)`.
- Keep projection-only action/change handling in the existing projection handlers.
- Add deterministic coverage that proves the live context-menu mount path supplies `visualObjectBinding` and that a canonical compact control change mutates through the binding path exactly once.

If the cleanest implementation needs a small helper in `apps/sigil/avatar-editor/` to build live binding options, keep it app-owned and test it directly. Do not move Sigil-specific behavior into toolkit.

## Hard Boundaries

- Do not change daemon/native input primitives.
- Do not change generic toolkit control semantics unless a focused failing test proves a toolkit bug.
- Do not remove `context-menu/descriptors.js` in this slice; it is still the compatibility source for the avatar editor model and projection-only shortcuts.
- Do not add live-provider, AFK, Agent Terminal, or BROKE.md work to this branch.
- Do not require live AOS to complete deterministic implementation.

## Verification

Run focused renderer checks:

```bash
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/renderer/sigil-context-menu-input.test.mjs
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs
```

Then run the broader renderer sweep if the focused tests pass:

```bash
node --test tests/renderer/*.test.mjs
git diff --check
```

If live AOS is available and `./aos ready` passes, run a bounded manual smoke:

1. Launch Sigil or use the existing repo-mode surface if already running.
2. Right-click the avatar.
3. Confirm the compact tabbed surface appears.
4. Change one canonical descriptor-backed control and confirm no console error is produced.
5. Right-click again or click away and confirm the surface closes predictably.

If `./aos ready` reports TCC/input-tap blockers, use `.docks/gdi/scripts/human-needed-tcc-reset` and stop with `human_needed` instead of retrying live checks.

## Completion Report

Return:

- Files changed.
- Whether live compact surface canonical controls now use `visualObjectBinding`.
- How projection-only controls are handled.
- Exact deterministic test commands and pass/fail counts.
- Live smoke result or readiness blocker.
- Any local-only dirty state, especially `.codex/config.toml`.
- Any remaining follow-up recommendation.
