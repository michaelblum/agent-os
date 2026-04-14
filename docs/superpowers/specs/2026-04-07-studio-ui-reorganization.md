# Studio UI Reorganization

**Date:** 2026-04-07
**Session:** studio-ui
**Scope:** `apps/sigil/studio/` only — HTML, CSS (structural only), JS (UI wiring only)

## Summary

Reshape the Avatar Studio from a celestial physics sandbox into a focused avatar character creator. This is both a **cleanup** (remove irrelevant controls) and a **completion** (surface controls that exist in JS wiring but are missing from the sidebar HTML). Incorporates UI refinements from the Celestial v2 rebuild (`/Users/Michael/Documents/GitHub/celestial/`).

## Context

The studio was grafted from Celestial v1 — a standalone Three.js polyhedron visualizer. It has two problems:

1. **Irrelevant controls** — grids, swarm, black holes, camera orbit, pathing UI
2. **Missing controls** — lightning, magnetic, omega (secondary shape), procedural skins, turbulence, and shape-specific parameters all have JS event listeners wired in `ui.js` but **no sidebar HTML**. They're only accessible via right-click context menus.

Celestial v2 (`/Users/Michael/Documents/GitHub/celestial/`, branch `v2-rebuild`) refined the UI organization with:
- FX tile grid (data-driven from `fx-registry.js`, compact emoji tiles with gear icons for sub-settings)
- Shape-conditional controls (tetartoid/torus/cylinder/box params shown only when relevant)
- Modular control components (SliderControl, SelectControl, ToggleSwitch, ColorPickerControl)

We adopt the FX tile grid pattern and shape-conditional controls from v2.

### Confirmed with lead-dev session

All decisions validated via the aos-gateway coordination bus (message `01KNN23RCFJAPMWAKMNGVXTPS8`):

- Naming: CELESTIAL -> SIGIL, panels -> Shape/Colors/Effects/Avatar
- State-behavior alignment: Effects organized as repertoire, grouped by behavioral concern
- Ghost trails: omega/ghost trail controls KEPT, pathing.js preview controls REMOVED
- Scale controls in Shape panel: approved

## Design

### Header

- Sidebar title: `CELESTIAL` -> `SIGIL`

### Nav Rail

Four icons on the left rail, plus save/load/randomize at bottom (unchanged):

| Position | Panel | Icon | Notes |
|----------|-------|------|-------|
| 1 | Shape | Keep current (cube wireframe) | Was "Geometry" |
| 2 | Colors | Keep current (color wheel) | Was "Appearance" |
| 3 | Effects | Keep current (play triangle) | Was "Cosmic Phenomena" |
| 4 | Avatar | New icon (identity-themed — gem, shield, or silhouette) | Was "Environment" |

### Panel 1: Shape (was "Geometry")

All existing controls retained, plus scale controls from Environment, shape-conditional params, procedural skins, and secondary shape (omega).

**Primary Shape:**
- Base Shape selector (dropdown)
- Stellation (Pull/Push) slider
- Face Opacity slider
- Edge Opacity slider
- Hollow Core View checkbox
- Show Interior Edges checkbox
- Specular Highlights checkbox

**Shape-Specific Parameters** (shown conditionally based on selected shape — pattern from v2 `GeometryPanel.svelte`):
- Tetartoid: A, B, C sliders (shown when shape = tetartoid)
- Torus: Radius, Tube, Arc sliders (shown when shape = torus knot)
- Cylinder/Prism: Top Radius, Bottom Radius, Height, Sides (shown when shape = cylinder)
- Box: Width, Height, Depth (shown when shape = box)

JS wiring for these already exists in `ui.js` but no sidebar HTML. Context menu elements reference: `tetASlider`, `tetBSlider`, `tetCSlider`, `torusRadiusSlider`, `torusTubeSlider`, `torusArcSlider`, `cylinderTopSlider`, `cylinderBottomSlider`, `cylinderHeightSlider`, `cylinderSidesSlider`, `boxWidthSlider`, `boxHeightSlider`, `boxDepthSlider`.

**Procedural Skin** (missing from sidebar, wired as `skinSelect`):
- Skin selector dropdown (None, Rocky, Gas Giant, Ice, Volcanic, Solar, Portal, Tech, Circuit, Alien, Ancient)

**Scale** (moved from Environment):
- Z-Depth Scale slider
- Scale Bounds dual slider
- Depth Stops stepper

**Secondary Shape** (collapsible sub-section — omega controls surfaced from context-menu-only):
- Enable toggle (`omegaToggle`)
- Shape selector (`omegaShapeSelect`)
- Stellation slider (`omegaStellationSlider`)
- Scale slider (`omegaScaleSlider`)
- Face Opacity slider (`omegaOpacitySlider`)
- Edge Opacity slider (`omegaEdgeOpacitySlider`)
- Hollow Core checkbox (`omegaMaskToggle`)
- Interior Edges checkbox (`omegaInteriorEdgesToggle`)
- Specular checkbox (`omegaSpecularToggle`)
- Skin selector (`omegaSkinSelect`)
- Motion: Counter-Spin checkbox (`omegaCounterSpin`)
- Motion: Lock Position checkbox (`omegaLockPosition`)
- Ghost Trails: Inter-Dimensional toggle (`omegaInterDimensional`)
- Ghost Trails: Ghost Count slider (`omegaGhostCountSlider`)
- Ghost Trails: Duration slider (`omegaGhostDurSlider`)
- Ghost Trails: Mode selector (`omegaGhostMode`)

All JS event listeners for these exist in `ui.js` (lines 1063-1137). Adding HTML elements with matching IDs will activate them.

### Panel 2: Colors (was "Appearance")

Structure preserved with additions for newly surfaced controls.

- Preset selector (dropdown) — unchanged
- Master Gradient (color pair) — unchanged
- Component Gradients:
  - Faces (color pair)
  - Edges (color pair)
  - Aura (color pair)
- **Secondary Shape Colors** (shown when omega enabled):
  - Omega Faces (`omegaFaceColor1/2`)
  - Omega Edges (`omegaEdgeColor1/2`)
- **"Effect Colors"** (renamed from "Phenomena Gradients"):
  - Pulsar (color pair)
  - Gamma Rays (color pair)
  - Accretion (color pair)
  - Neutrino (color pair)
  - **Lightning** (`lightningColor1/2`) — NEW, was context-menu-only
  - **Magnetic** (`magneticColor1/2`) — NEW, was context-menu-only

### Panel 3: Effects (was "Cosmic Phenomena")

Reorganized by behavioral concern. **Checkbox list replaced with FX tile grid** for phenomena toggles (pattern from v2 `mockup-fx-tiles.html`, data-driven from `fx-registry.js`).

**Motion:**
- Base Spin Speed slider
- Quick Spin Burst button

**Aura:**
- Enable Aura Glow checkbox
- Reach slider
- Intensity slider
- Pulse Rate slider
- Spike Amplitude button + multiplier input

**Effects Grid** (replaces checkbox list — compact 3-column tile grid):

Each effect is a tile with emoji icon, label, click-to-toggle, and optional gear icon for sub-settings. Data-driven from `fx-registry.js`:

| Tile | Emoji | Has Settings |
|------|-------|-------------|
| Pulsar | `💠` | Yes — per-phenomenon turbulence (amount, speed, modulation) |
| Accretion | `🌀` | Yes — per-phenomenon turbulence |
| Gamma | `☢️` | Yes — per-phenomenon turbulence |
| Neutrino | `🔵` | Yes — per-phenomenon turbulence |
| Lightning | `⚡` | Yes — origin, solid block, bolt length, frequency, duration, branching, brightness |
| Magnetic | `🧲` | Yes — tentacle count, speed, wander |
| Aura | `🔮` | Yes — (links to aura controls above) |

Remove swarm and black hole tiles from the registry (those effects are being removed from the UI).

**Sub-settings** for each effect expand inline or as a collapsible section below the grid when the gear icon is clicked:

- **Lightning settings** (`lightningSettings`): Origin Center, Solid Block checkboxes; Bolt Length, Frequency, Duration, Branching, Brightness sliders
- **Magnetic settings** (`magneticSettings`): Tentacle Count, Speed, Wander sliders
- **Turbulence settings** (per phenomenon — p/a/g/n): Amount slider, Speed slider, Modulation selector. These exist in JS (`turbState`) but have no sidebar HTML.

**Particles:**
- Hold-to-Supernova charge button

### Panel 4: Avatar (was "Environment")

A placeholder panel showing current avatar context. No CRUD, roster management, or persistence.

**Current scope:**
- Summary card showing current avatar info (shape type, preset name or "Custom")
- Visual placeholder signaling this is the future home of the roster / character select

**Future direction (not built now):**
- Grid of avatar profiles (character select screen → drill into editor)
- Per-avatar voice assignment, toolkit/skills attachment
- See: `memory/scratchpad/sigil-app-vision.md`, `memory/scratchpad/sigil-state-behaviors.md`, `memory/scratchpad/sigil-composition-model.md`

### Removals

UI controls removed. Underlying JS modules, state fields, and renderer imports are NOT touched — `getConfig()` and `setConfig()` continue to serialize all fields for backwards compatibility.

**Grid system (all):**
- Show Background Grid checkbox + grid settings (colors, granularity, space-time grid, mass)
- Grid Mode selector, 3D grid controls (density, radius, gravity, time scale, snow globe, probe, relative motion, render mode)
- `ctx-env` context menu (grid + camera entries)

**Swarm / Black Hole:**
- Swarm toggle + settings (count, gravity, event horizon, time scale, colors)
- Black hole mode toggle
- Remove from `fx-registry.js` tile set (or just exclude swarm/blackhole from rendered tiles)

**Camera:**
- Orthographic toggle
- FOV slider

**Pathing.js UI:**
- Auto-Path toggle + pause button
- Path settings (centered view, path type, show path line, trail toggle + trail length, speed)

**Environment panel content:**
- Entire panel gutted and repurposed as Avatar panel

### Context Menus

- `ctx-object`: Keep — geometry, color, opacity, aura, spin are all relevant. Omega sub-menu syncs with new sidebar controls.
- `ctx-env`: Remove entirely — grid + camera controls are being removed.

## Files Modified

| File | Changes |
|------|---------|
| `studio/index.html` | Major: Remove grid/swarm/camera/path HTML. Rename panels + title. Move scale controls to Shape. Add shape-conditional params, skin selector, omega section, FX tile grid, lightning/magnetic/turbulence settings, Avatar panel placeholder. Remove ctx-env. |
| `studio/js/ui.js` | Remove event listeners for deleted controls (grid, swarm, camera, path). Add FX tile grid rendering logic (data-driven from fx-registry). Add shape-conditional visibility toggling. Preserve getConfig()/setConfig(). |
| `studio/js/main.js` | No changes expected — grid3d/swarm modules still imported and animated. |
| `studio/css/controls.css` | Add FX tile grid styles (from `mockup-fx-tiles.html`). Add collapsible section styles for secondary shape and effect sub-settings. |
| `studio/css/sidebar.css` | Minor adjustments if panel content height changes require scroll behavior tweaks. |

## Files NOT Modified

- `renderer/*` — shared rendering modules, state.js, fx-registry.js, all shaders
- `studio/js/grid3d.js` — still loaded, just not wired to UI
- `studio/js/swarm.js` — still loaded, just not wired to UI
- `studio/js/pathing.js` — still loaded, auto-path logic still runs if enabled via config
- `studio/js/interaction.js` — context menu sync code stays (references sidebar IDs that now exist)
- `studio/js/scene.js`, `studio/js/skybox.js` — untouched

## Implementation Notes

### FX Tile Grid

The `fx-registry.js` already defines the effect list with emoji, label, sidebarId, and subMenuId. The tile grid renders from this array. Each tile:
1. Reads the corresponding sidebar toggle state
2. Click toggles the effect (dispatches change event on the hidden sidebar checkbox)
3. Gear icon (where present) expands the effect's sub-settings panel

The mockup at `/Users/Michael/Documents/GitHub/celestial/mockup-fx-tiles.html` has the complete CSS and JS for this pattern. Adapt the styles to match the studio's existing control aesthetic.

### Shape-Conditional Controls

Follow the v2 `GeometryPanel.svelte` pattern: wrap shape-specific control groups in containers with `display: none` by default. When the shape selector changes, show/hide the relevant container. The JS wiring already exists — just needs HTML elements and visibility toggling in the shape change handler.

### Omega as Collapsible Section

Use the same show/hide pattern as existing conditional sections (e.g., `pathSettings`, `trailSettings`, `auraIntensityWrapper`). The omega toggle shows/hides `omegaSettings`. All JS event listeners already reference these element IDs.

## Constraints

1. Only modify files under `apps/sigil/studio/`
2. Studio must continue to work as a standalone HTML page in a browser
3. `getConfig()` and `setConfig()` must remain functional — they're the contract with the live renderer
4. Removed features are UI-only removals. State fields keep their defaults.
5. Preserve all existing typography, color scheme, and control styling
6. FX tile grid must remain data-driven from `fx-registry.js` — don't hardcode effect lists in HTML
