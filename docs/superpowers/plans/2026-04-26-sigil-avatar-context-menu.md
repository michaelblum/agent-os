# Sigil Avatar Context Menu

## Goal

Replace the failed workbench/home-ui direction with an avatar context menu that
opens from the live Sigil avatar and stays in the same DesktopWorld rendering
surface as the avatar. The visual reference is Celestial `sandbox-v1`, commit
`688a166`, specifically the deck-of-cards context menu rooted at
`celestial-v1:index.html`.

## Principles

- Render the menu inside `avatar-main`, not in a separate menu canvas.
- Keep Sigil app styling inside `apps/sigil/`.
- Put generic stack-card navigation mechanics in toolkit so future canvases can
  reuse the behavior without copying Celestial-specific UI.
- Keep menu state and avatar appearance state in the same JS runtime so slider
  drags can update Three.js immediately.
- Use the existing Sigil hit canvas as an input shim while `avatar-main` remains
  click-through outside the active avatar/menu bounds.
- Make each checkpoint reversible and small enough to review independently.

## Phase 1: Foundation Checkpoint

1. Add `packages/toolkit/runtime/stack-menu.js` with generic card stack state:
   root card, active card, pushed cards, tab switching, push/pop, outside-close
   hooks, and class/style application.
2. Add `apps/sigil/context-menu/` with the Celestial-derived markup and
   Sigil-owned skin. The first version carries only representative controls:
   Shape, Appearance, Effects, World, and a few submenu cards.
3. Render this menu as an overlay from `avatar-main` and expose debug helpers to
   open/close it.
4. Extend the Sigil hit target so it can cover either the avatar dot or the menu
   bounds and forward pointer events in DesktopWorld coordinates.
5. Wire right-click on the avatar to open the menu and ordinary click outside to
   close it. Interactions inside the menu must not close it.

## Phase 2: Controls

1. Connect Shape controls to live geometry and stellation.
2. Connect Appearance controls to existing Sigil appearance state.
3. Connect Effects controls to the existing effect modules.
4. Add sections for canvas inspector, console log, and other AOS utilities after
   the base control loop is responsive.

## Validation

- Right-click avatar opens the menu near the avatar.
- Menu renders with the Celestial card-stack look.
- Opening a submenu pushes the previous card behind it.
- Click outside closes the menu.
- Slider drag events stay fluid because updates happen inside `avatar-main`.
- Existing avatar drag/fast-travel behavior still works when the menu is closed.
