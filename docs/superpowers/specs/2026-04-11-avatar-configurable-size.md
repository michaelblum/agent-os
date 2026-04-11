# Spec: Configurable Avatar Size

**Issue:** #19 — Avatar size should be configurable, not hard-coded  
**Date:** 2026-04-11  
**Status:** Approved

## Problem

Avatar sizes are hard-coded as Swift constants (`fullSize=300`, `surgeSize=400`, `dockedSize=40` in `avatar-animate.swift:13-15`). These values are referenced ~20 times across `avatar-behaviors.swift` and `avatar-sub.swift`. There is no way to change avatar size without editing source code.

## Design

### Canonical unit: logical pixels (points)

All size values throughout the system use a single canonical unit: **logical pixels**. This corresponds to AppKit points on the Swift side and CSS pixels on the web/renderer side. Both represent the same logical sizing model — device-independent units that the platform maps to physical pixels at the display boundary.

No component in Sigil performs DPI conversion. Physical pixel mapping happens at exactly two platform boundaries:

| Boundary | Mechanism |
|----------|-----------|
| AppKit compositing | Automatic via `backingScaleFactor` |
| Three.js backing store | `renderer.setPixelRatio(window.devicePixelRatio)` |

### Config schema

`~/.config/aos/{mode}/avatar-config.json` gains three top-level properties:

```json
{
  "base": 300,
  "min": 40,
  "max": 400
}
```

- `base` — canonical avatar size in logical pixels. Default: 300.
- `min` — smallest allowed size. Default: 40.
- `max` — largest allowed size. Default: 400.

**Constraints:** `min >= 20`, `max <= 800`, `min < base < max`. Swift clamps on load. Studio enforces in the UI.

These are generic avatar sizing properties. Sigil maps them to its own behavioral semantics internally (base→normal roaming size, min→docked pip size, max→surge/emphasis size).

### Swift changes

**avatar-animate.swift:**

Replace the three `let` constants with mutable vars:

```swift
var avatarBase: Double = 300
var avatarMin: Double  = 40
var avatarMax: Double  = 400
```

Rename all references: `fullSize` → `avatarBase`, `dockedSize` → `avatarMin`, `surgeSize` → `avatarMax`.

**avatar-sub.swift:**

On startup, after `loadAvatarConfig()`, extract and assign `base`/`min`/`max` from the config dictionary (with fallback to defaults). The existing `curSize = fullSize` becomes `curSize = avatarBase`.

### Renderer changes

**Scale model (breaking change):**

```
polyGroup.scale = baseScale × z_depth × novaScale
```

| Factor | Source | Default | Purpose |
|--------|--------|---------|---------|
| `baseScale` | Derived from `base` + display geometry | ~1.11 (for base=300 at 1080p) | Maps logical pixels to scene units |
| `z_depth` | Studio creative multiplier | **1.0** (was 1.1) | Artistic scaling — 1.0 = "render at exactly base size" |
| `novaScale` | Transient animation state | 1.0 | Charge/nova/respawn effects |

**baseScale computation:**

```js
baseScale = base / (innerHeight / frustumSize) / 2
```

Where `innerHeight` is the canvas's CSS pixel height and `frustumSize` is the orthographic camera's vertical extent (currently 8). The `/2` accounts for the mesh spanning ~2 scene units at unit scale.

For base=300 on a 1080-logical-pixel display: `300 / (1080/8) / 2 ≈ 1.11`.

**Recomputation:** `baseScale` must be recomputed on `resize` events, since `innerHeight` changes when moving between displays with different logical resolutions.

**renderer/state.js:** Add `avatarBase: 300` and `baseScale: 1.11` to defaults. Change `z_depth` default from `1.1` to `1.0`.

**renderer/live-modules/main.js:** `applyConfig()` handles `base` property — stores it and recomputes `baseScale`. The scale application line in `animate()` becomes `baseScale * z_depth * novaScale`.

**studio/js/main.js:** Same scale model change — `baseScale * z_depth * novaScale` in the animate loop. Studio computes its own `baseScale` from its canvas dimensions.

**DPI:** Add `renderer.setPixelRatio(window.devicePixelRatio)` in scene init (both live and studio). This is the sole DPI-aware line in the renderer.

### Studio UI changes

Add a "Size" section to the Studio sidebar with:

- **Base size** slider — range bounded by current min/max values
- **Min size** numeric input — lower bound of the allowed range
- **Max size** numeric input — upper bound of the allowed range

On change:
1. Update local state and recompute `baseScale`
2. Persist to `/_state/avatar-config.json` via content server POST (same pattern as roster)
3. Send live config update to renderer canvases via `headsup.postMessage`

`getConfig()` includes `base`, `min`, `max`. `applyConfig()` reads them and recomputes `baseScale`.

### Files changed

| File | Change |
|------|--------|
| `apps/sigil/avatar-animate.swift` | Replace `let` constants with `var avatarBase/Min/Max`, rename all references |
| `apps/sigil/avatar-behaviors.swift` | `fullSize` → `avatarBase`, `surgeSize` → `avatarMax`, `dockedSize` → `avatarMin` |
| `apps/sigil/avatar-sub.swift` | Load `base`/`min`/`max` from config at startup, rename references |
| `apps/sigil/renderer/state.js` | Add `avatarBase`, `baseScale` defaults; `z_depth` default → 1.0 |
| `apps/sigil/renderer/live-modules/main.js` | Handle `base` in `applyConfig()`, new scale formula, `setPixelRatio`, resize handler |
| `apps/sigil/studio/js/main.js` | Same scale formula change, `setPixelRatio` |
| `apps/sigil/studio/js/ui.js` | Size section UI, `getConfig`/`applyConfig` additions, persist via content server |
| `apps/sigil/studio/index.html` | Size section markup in sidebar |

### Not covered (separate issues)

- **Live Swift reload:** Swift picks up size changes on next restart. A config-reload subscription channel for live propagation is a separate issue.
- **Studio-enforced global range:** The allowed range for all avatars (vs per-avatar min/max) is a separate Studio concern.
- **Global DPI infrastructure:** The point-based model + `setPixelRatio` is sufficient. A broader DPI scaling system is not needed for this change.
