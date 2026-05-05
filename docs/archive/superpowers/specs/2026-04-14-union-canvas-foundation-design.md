# Union Canvas Foundation — Design

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Close #50 (Union Canvas foundation) by landing #54 (`--track` flag), #49 (daemon-side topology retarget), and #48 (Sigil renderer inline/module reconciliation) in one spec/plan cycle.
**Out of scope:** #59 (displays rotate / "move the world" — cursor rewiring research), #60 (full anchor/tracking unification — future consolidation of `--anchor-window`, `--anchor-channel`, `--at` into `--track`).

> **Supersession note:** References to `aos runtime display-union` and
> `--at $(aos runtime display-union)` predate the DesktopWorld re-anchor.
> Current authority: `shared/schemas/spatial-topology.md` and
> `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md`.
> `aos runtime display-union` now prints the canonical DesktopWorld
> shape by default; the legacy native-compat shape is under `--native`.
> Prefer `--track union` for new work.

## Problem

A **union canvas** is an AOS canvas whose bounds span the bounding box of every attached display. Sigil's `avatar-main` uses one so the avatar can traverse displays under a single transparent overlay. The concept works today but three gaps between the invariants in `ARCHITECTURE.md §5` and the running code keep #50 open:

1. **No opt-in flag.** Callers size a union canvas via shell substitution: `--at $(aos runtime display-union)`. The daemon has no idea the canvas is "union-shaped" — it looks identical to any other fixed-rect canvas.
2. **Stale bounds on topology change.** When displays are added, removed, rearranged, or rotated, the daemon rebroadcasts `display_geometry` but never resizes the canvas. The Sigil renderer runs a clamp-on-change guard so the avatar doesn't wander off, but the transparent overlay itself remains the old shape.
3. **Sigil renderer duplication.** `apps/sigil/renderer/index.html` holds a 3235-line grafted-in classic `<script>` (the celestial legacy) plus a parallel ~6887-line ES module tree that can't render on its own. A hand-maintained `APPEARANCE_FIELDS` bridge copies state between them. New appearance fields silently fail to propagate when the list isn't updated.

## Design

### 1. `--track <target>` flag (closes #54)

`aos show create` and `aos show update` gain a `--track <value>` flag. Value syntax is `<type>[:<id>]`. v1 implements exactly one target: `union`. Future target types (`window:<wid>`, `channel:<cid>`, `display:<n>`, `static:x,y,w,h`) slot into the same flag shape without rethinking — this is the seed for #60's unification.

**CLI:**

```
# Create a union-tracked canvas (daemon resolves bounds)
aos show create --id avatar-main --track union --url aos://sigil/renderer/index.html

# Retarget an existing canvas to track union (e.g., converting a snapshot canvas)
aos show update --id avatar-main --track union
```

**Parsing rules:**

- `--track union` and `--at` in the same invocation → `INVALID_ARG` ("cannot combine --at with --track"). User should pick one.
- `--track union` with no `--at` → daemon resolves via `runtimeDisplayUnion()` (`src/commands/runtime.swift:61-71`, already exists).
- Unknown target type → `INVALID_ARG` with list of supported types.

**Daemon state:** each canvas record gains one optional field, `track: TrackTarget?`, where `TrackTarget` is an enum with one case in v1: `.union`. Stored in-memory for the lifetime of the canvas; not persisted across daemon restarts (matches today's canvas lifetime).

**IPC:** `CanvasRequest` (`src/display/protocol.swift`) gains `track: String?`. `CanvasResponse` list entries gain `track: String?` so `aos show list` output reports tracking state per canvas.

**Schemas:** no changes to `shared/schemas/` in v1. A `canvas-track.schema.json` will be formalized when #60 lands multiple target types.

### 2. Topology-change retarget (closes #49)

The daemon already observes `NSApplication.didChangeScreenParametersNotification` and coalesces 100ms before rebroadcasting `display_geometry` (`src/daemon/unified.swift:230-236`). The new behavior plugs into the same coalesced handler:

1. Compute new union via `runtimeDisplayUnion()`.
2. Iterate every canvas where `track == .union` and apply the new bounds via the same internal "update bounds" code path `aos show update --at` uses. Failures on any one canvas are logged and skipped — never block the rest or the broadcast.
3. *Then* broadcast `display_geometry`. Order matters: renderers should receive the geometry event already sitting in the new bounds, so there's no visible "stale rectangle" window.

No new events on the perception bus. `display_geometry` is sufficient — that's what renderers already consume.

**Renderer clamp logic** in `apps/sigil/renderer/index.html:2917-2940` stays in place during this change. Once the daemon-side resize is verified across a few sessions, the renderer-side clamp becomes redundant and can be deleted as a follow-up commit — not in the critical path of this spec.

### 3. Sigil renderer reconciliation (closes #48)

Retire the inline 3235-line bundle in `apps/sigil/renderer/index.html` and finish the ES module migration. Direction was implicitly decided by the 2026-04-08 content server spec (the bundle exists only because `loadHTMLString` couldn't do ES modules; content server removed that constraint). The modules are already ~2× the code of the inline bundle and carry most new feature work; they just don't drive the scene yet.

**Strategy: strangler fig.** Each subsystem migrates in its own commit:

1. Pick one subsystem (e.g., `colors`).
2. Move the inline rendering logic for that subsystem into its module so the module actually drives the Three.js scene.
3. Remove that subsystem's fields from `APPEARANCE_FIELDS` (the manual sync list).
4. Delete the inline copy.
5. Commit. Verify visually. Move on.

Suggested order (simplest → most entangled; finalized in the implementation plan):
`colors` → `skins` → `geometry` → `particles` → `lightning` → `magnetic` → `aura` → `phenomena` → `omega`.

Final commit removes the three bridge functions in `index.html`: `syncModuleStateToWindow` (~lines 3319-3369), `rebuildInlineVisualsAfterAppearance` (~lines 3371-3441), and the `APPEARANCE_FIELDS` array. `index.html` becomes a thin bootstrap: import the module graph, mount, subscribe to headsup events, done.

**Verification per commit:** manual visual smoke (studio-driven appearance roundtrip — existing test at `apps/sigil/tests/appearance-roundtrip.html`) plus `apps/sigil/tests/birthplace-resolver-test.html` for boot integrity. A missed field means "appearance slider moves but visual doesn't change" — cheap to spot.

### Closing #50

When all three sub-issues ship:
- `ARCHITECTURE.md §5` gets an update: "Topology change (current)" becomes "On display-topology change, every canvas with `track == union` has its bounds updated by the daemon." The "target" and "current" language collapses.
- `aos show create --track union` is the documented pattern; `--at $(aos runtime display-union)` becomes deprecated shorthand (still works — produces a snapshot canvas).
- The `apps/sigil/CLAUDE.md` note "Most rendering logic currently lives inlined in a single large classic `<script>`..." is deleted. The inline/module split is gone.

## Testing

- **#54:** add a Swift unit test (or CLI integration test — agent-os's convention) that asserts `--track union --at ...` returns `INVALID_ARG`, `--track union` alone produces a canvas matching `runtimeDisplayUnion()`, and `aos show list` reports `track: "union"` for such canvases.
- **#49:** manual test — launch a `--track union` canvas, physically plug/unplug a monitor, confirm bounds update inside the 100ms coalesce window. Automated coverage is out of reach without a display-topology mock.
- **#48:** manual per-commit visual parity — each strangler-fig step preserves appearance. Automated coverage of Three.js rendering is out of scope.

## Decisions captured (from brainstorm)

- `--track` (A) over `--at union` (B) or magic detection (C): the explicit, extensible flag name wins for future `window:*`, `channel:*`, `display:*` consumers.
- Strangler-fig migration (2) over big-bang (1) or feature-flagged parallel (3): bisection-friendly, working avatar after every commit.
- Preserve path to #60's full tracking unification via the `--track <type>[:<id>]` shape; do not pull `--anchor-window` / `--anchor-channel` into this spec.
- Display rotation (#59) is decoupled: even after its cursor-rewiring research lands, it consumes the same topology-change broadcast this spec hooks — no new machinery.

## References

- `ARCHITECTURE.md §5` — current union-canvas invariants
- `src/daemon/unified.swift:230-236` — topology-change coalesced broadcast
- `src/commands/runtime.swift:61-71` — `runtimeDisplayUnion()` helper
- `src/display/client.swift:113-215` — `aos show create` arg parsing
- `src/display/protocol.swift` — `CanvasRequest` schema
- `apps/sigil/renderer/index.html:2917-2940` — renderer clamp logic (safety net, candidate for later cleanup)
- `apps/sigil/renderer/index.html:3319-3441` — bridge functions scheduled for removal
- Issues: #50 (umbrella), #54 (flag), #49 (retarget), #48 (reconcile), #59 (future rotate), #60 (future unification)
