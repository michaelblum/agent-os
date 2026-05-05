# Configurable Avatar Size — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make avatar size configurable via `base`/`min`/`max` properties in `avatar-config.json`, with all sizing derived from a single canonical unit (logical pixels/points), and close the loop through Swift, renderer, and Studio.

**Architecture:** Config stores three size values in logical pixels. Swift reads them at startup and uses them for hit-target, centering, and animation math. The renderer computes a `baseScale` from `base` and display geometry so the visual size tracks the configured size. Studio provides UI controls and persists changes via the daemon's content server `/_state/` endpoint. `z_depth` becomes a pure creative multiplier (default 1.0) on top of `baseScale`.

**Tech Stack:** Swift (avatar-sub), JavaScript/Three.js (renderer, Studio), AOS daemon content server

**Spec:** `docs/superpowers/specs/2026-04-11-avatar-configurable-size.md`

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/sigil/avatar-animate.swift` | Modify | Replace `let` size constants with `var avatarBase/Min/Max`, update all references |
| `apps/sigil/avatar-behaviors.swift` | Modify | Rename `fullSize` → `avatarBase`, `surgeSize` → `avatarMax`, `dockedSize` → `avatarMin` |
| `apps/sigil/avatar-sub.swift` | Modify | Load `base`/`min`/`max` from config at startup, rename references |
| `apps/sigil/renderer/state.js` | Modify | Add `avatarBase`, `baseScale` defaults; change `z_depth` default to 1.0 |
| `apps/sigil/renderer/live-modules/scene.js` | Modify | Export `computeBaseScale()`, recompute on resize |
| `apps/sigil/renderer/live-modules/main.js` | Modify | Handle `base` in `applyConfig()`, new scale formula in `animate()` |
| `apps/sigil/studio/js/main.js` | Modify | New scale formula in `animate()` |
| `apps/sigil/studio/js/scene.js` | Modify | Export `computeBaseScale()`, recompute on resize |
| `apps/sigil/studio/js/ui.js` | Modify | Add size controls to `getConfig()`/`applyConfig()`, persist via `/_state/` |
| `apps/sigil/studio/index.html` | Modify | Add Size section markup to Avatar panel |

---

### Task 1: Swift — Replace hard-coded size constants

**Files:**
- Modify: `apps/sigil/avatar-animate.swift:9-15`
- Modify: `apps/sigil/avatar-behaviors.swift` (all `fullSize`/`surgeSize`/`dockedSize` refs)
- Modify: `apps/sigil/avatar-sub.swift` (all `fullSize` refs)

- [ ] **Step 1: Replace constants in avatar-animate.swift**

Change lines 9-15 from:

```swift
// -- Shared mutable state (position/size of the avatar canvas) --
var curX: Double = 0, curY: Double = 0, curSize: Double = 300
var moveID: UInt64 = 0

// -- Size constants --
let fullSize: Double   = 300
let surgeSize: Double  = 400
let dockedSize: Double = 40
```

To:

```swift
// -- Shared mutable state (position/size of the avatar canvas) --
var curX: Double = 0, curY: Double = 0, curSize: Double = 300
var moveID: UInt64 = 0

// -- Avatar size (logical pixels / points) --
// Loaded from avatar-config.json at startup. Sigil maps these to behavioral
// semantics: avatarBase = roaming size, avatarMin = docked pip, avatarMax = surge.
var avatarBase: Double = 300
var avatarMax: Double  = 400
var avatarMin: Double  = 40
```

- [ ] **Step 2: Rename all references in avatar-behaviors.swift**

Apply these renames throughout the file:
- `fullSize` → `avatarBase` (lines 105, 106, 131, 217, 236, 237, 277, 333)
- `surgeSize` → `avatarMax` (line 254)
- `dockedSize` → `avatarMin` (lines 234, 235, 297, 331, 332)

- [ ] **Step 3: Rename all references in avatar-sub.swift**

Apply these renames:
- `fullSize` → `avatarBase` (lines 329, 330, 488, 1024)

- [ ] **Step 4: Build and verify compilation**

Run:
```bash
cd apps/sigil && bash build-avatar.sh
```
Expected: Compiles with no errors. All `fullSize`/`surgeSize`/`dockedSize` references resolved.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/avatar-animate.swift apps/sigil/avatar-behaviors.swift apps/sigil/avatar-sub.swift
git commit -m "refactor(sigil): rename size constants to avatarBase/Min/Max

Replace hard-coded let constants (fullSize/surgeSize/dockedSize) with
mutable vars (avatarBase/avatarMax/avatarMin) in preparation for
config-driven sizing. No behavioral change — same default values."
```

---

### Task 2: Swift — Load size from config at startup

**Files:**
- Modify: `apps/sigil/avatar-sub.swift` (startup section near line 1010)

- [ ] **Step 1: Add config loading after loadAvatarConfig()**

Find the existing config-loading block in `avatar-sub.swift` (around line 1009-1014):

```swift
    // Send config to all canvases
    if let config = loadAvatarConfig() {
        for display in displays {
            sendToCanvas(display.id, ["type": "config", "data": config])
        }
    }
```

Replace with:

```swift
    // Load and apply avatar config
    if let config = loadAvatarConfig() {
        // Apply size properties (logical pixels / points)
        if let base = config["base"] as? Double {
            avatarBase = max(20, min(800, base))
        }
        if let minSize = config["min"] as? Double {
            avatarMin = max(20, min(avatarBase - 1, minSize))
        }
        if let maxSize = config["max"] as? Double {
            avatarMax = max(avatarBase + 1, min(800, maxSize))
        }

        // Send config to all canvases (renderer handles appearance + size)
        for display in displays {
            sendToCanvas(display.id, ["type": "config", "data": config])
        }
    }
```

- [ ] **Step 2: Update initial curSize assignment**

Find (around line 1024):

```swift
    curX = cx; curY = cy; curSize = avatarBase
```

This should already say `avatarBase` after Task 1. Verify it does.

- [ ] **Step 3: Build and verify**

Run:
```bash
cd apps/sigil && bash build-avatar.sh
```
Expected: Compiles cleanly.

- [ ] **Step 4: Manual test — verify default behavior unchanged**

Run:
```bash
./aos serve &
sleep 2
apps/sigil/build/avatar-sub
```

Expected: Avatar appears at normal size (300pt). Verify it follows cursor, docks, undocks as before.

- [ ] **Step 5: Manual test — verify config override**

Create a test config:
```bash
cat > ~/.config/aos/repo/avatar-config.json << 'EOF'
{
  "base": 200,
  "min": 30,
  "max": 300
}
EOF
```

Restart avatar-sub. Expected: Avatar appears visibly smaller. Remove the test config after verification.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/avatar-sub.swift
git commit -m "feat(sigil): load avatar size from config at startup (#19)

Reads base/min/max from avatar-config.json and assigns to
avatarBase/avatarMin/avatarMax with clamping. Falls back to
defaults (300/40/400) when config is absent."
```

---

### Task 3: Renderer — Add baseScale to state and scene

**Files:**
- Modify: `apps/sigil/renderer/state.js:249-257`
- Modify: `apps/sigil/renderer/live-modules/scene.js:40-57`

- [ ] **Step 1: Update state.js defaults**

In `apps/sigil/renderer/state.js`, find the Scale / Depth section (line 249):

```js
    // Scale / Depth
    depth_range: { min: 0.25, max: 3.0 },
    z_depth: 1.1,
    scale_anim_active: false,
    target_z_depth: 1.1,
    scale_anim_start_val: 1.1,
    scale_anim_start_time: 0,
```

Replace with:

```js
    // Scale / Depth
    // All sizes in logical pixels (points). baseScale is derived from avatarBase
    // and display geometry — it maps logical pixels to scene units.
    // z_depth is a creative multiplier: 1.0 = render at exactly avatarBase size.
    avatarBase: 300,
    avatarMin: 40,
    avatarMax: 400,
    baseScale: 1.0,
    depth_range: { min: 0.25, max: 3.0 },
    z_depth: 1.0,
    scale_anim_active: false,
    target_z_depth: 1.0,
    scale_anim_start_val: 1.0,
    scale_anim_start_time: 0,
```

- [ ] **Step 2: Add computeBaseScale to live-modules/scene.js**

In `apps/sigil/renderer/live-modules/scene.js`, after the `screenToScene` function (after line 57), add:

```js
// --- Base scale: maps avatarBase (logical pixels) to scene units ---
// Reference calibration: at base=300 on a 1080-logical-pixel display,
// z_depth=1.1 produced the correct visual. baseScale absorbs that so
// z_depth can default to 1.0 as a pure creative multiplier.
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;

export function computeBaseScale(base) {
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / window.innerHeight);
}
```

- [ ] **Step 3: Recompute baseScale on resize**

In the same file, update the `onWindowResize` function (line 40):

```js
export function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    state.perspCamera.aspect = aspect;
    state.perspCamera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.baseScale = computeBaseScale(state.avatarBase);
}
```

- [ ] **Step 4: Compute initial baseScale after scene init**

In the `initScene` function, after the resize listener (line 37), add:

```js
    state.baseScale = computeBaseScale(state.avatarBase);
```

So the end of `initScene` becomes:

```js
    window.addEventListener('resize', onWindowResize);
    state.baseScale = computeBaseScale(state.avatarBase);
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/state.js apps/sigil/renderer/live-modules/scene.js
git commit -m "feat(renderer): add baseScale derived from avatarBase (#19)

Introduces computeBaseScale() that maps logical pixel size to scene
units using a reference calibration (base=300 at 1080p = scale 1.1).
Recomputes on resize for cross-display correctness. z_depth default
changes from 1.1 to 1.0 (now a pure creative multiplier)."
```

---

### Task 4: Renderer — Wire baseScale into the scale formula and applyConfig

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js:75-81` (animate) and `148-160` (applyConfig)

- [ ] **Step 1: Update scale formula in animate()**

In `apps/sigil/renderer/live-modules/main.js`, find line 78:

```js
    state.polyGroup.scale.setScalar(state.z_depth * state.novaScale);
```

Replace with:

```js
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.novaScale);
```

- [ ] **Step 2: Handle base/min/max in applyConfig()**

In the `applyConfig` function (line 148), add handling for size properties. After the existing `if (config == null) return;` line, add:

```js
    // Avatar size (logical pixels)
    if (config.base != null) {
        state.avatarBase = config.base;
        state.baseScale = computeBaseScale(config.base);
    }
```

Add the import at the top of the file. Find line 8:

```js
import { animatePathing, setScenePosition } from './pathing.js';
```

Change to:

```js
import { animatePathing, setScenePosition } from './pathing.js';
import { computeBaseScale } from './scene.js';
```

Wait — `computeBaseScale` is already exported from `scene.js` in Task 3. But the existing imports from `scene.js` are on line 1:

```js
import state from '../../js/state.js';
import { initScene, screenToScene } from './scene.js';
```

Update that import to:

```js
import state from '../../js/state.js';
import { initScene, screenToScene, computeBaseScale } from './scene.js';
```

- [ ] **Step 3: Verify the live renderer loads in browser**

Open the live renderer directly (via content server URL or file). Expected: Avatar renders at default size. Verify with the inspector that `state.baseScale` is approximately 1.1 and `state.z_depth` is 1.0.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js
git commit -m "feat(renderer): wire baseScale into scale formula and config (#19)

Scale is now baseScale * z_depth * novaScale. applyConfig() handles
the 'base' property by recomputing baseScale. Existing visual is
identical: baseScale≈1.1 * z_depth=1.0 = 1.1 (was z_depth=1.1)."
```

---

### Task 5: Studio renderer — Same scale model changes

**Files:**
- Modify: `apps/sigil/studio/js/scene.js` (add computeBaseScale, resize handler)
- Modify: `apps/sigil/studio/js/main.js:120-121` (animate scale formula)

- [ ] **Step 1: Add computeBaseScale to studio/js/scene.js**

In `apps/sigil/studio/js/scene.js`, after the existing scene setup, add the same `computeBaseScale` function and resize handler updates.

Find the resize handler in the file (search for `resize`):

```bash
grep -n resize apps/sigil/studio/js/scene.js
```

Read the resize handler and add `computeBaseScale` export + recompute in the resize handler, following the same pattern as Task 3 Step 2-4 but adapted for the Studio scene (which has both perspective and orthographic cameras).

After all existing exports at the bottom of scene.js, add:

```js
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;

export function computeBaseScale(base) {
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / window.innerHeight);
}
```

In the Studio resize handler, add:

```js
    state.baseScale = computeBaseScale(state.avatarBase);
```

In `initScene`, after the resize listener, add:

```js
    state.baseScale = computeBaseScale(state.avatarBase);
```

- [ ] **Step 2: Update scale formula in studio/js/main.js**

Find line 121:

```js
    state.polyGroup.scale.setScalar(state.z_depth * state.novaScale);
```

Replace with:

```js
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.novaScale);
```

Also update the z_depth interpolation block (line 114-117). The interpolation targets `state.z_depth` and `state.target_z_depth` — these remain as-is since z_depth is still the creative multiplier. The display values should reflect that:

Find line 115-116:

```js
        document.getElementById('zDepthSlider').value = state.z_depth;
        document.getElementById('zDepthVal').innerText = state.z_depth.toFixed(2);
```

These stay as-is — the slider still controls `z_depth` directly.

- [ ] **Step 3: Verify Studio loads correctly**

Open Studio in browser. Expected: Avatar renders at default size. Scale slider at 1.0.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/js/scene.js apps/sigil/studio/js/main.js
git commit -m "feat(studio): align scale model with renderer (baseScale * z_depth) (#19)

Studio now uses the same baseScale computation as the live renderer.
z_depth slider default is 1.0, acts as a creative multiplier."
```

---

### Task 6: Studio UI — Add size controls and persistence

**Files:**
- Modify: `apps/sigil/studio/index.html:636-671` (Avatar panel)
- Modify: `apps/sigil/studio/js/ui.js` (getConfig, applyConfig, persistence)

- [ ] **Step 1: Add Size section markup to Avatar panel**

In `apps/sigil/studio/index.html`, find the Avatar panel (line 635). After the avatar card div (after line 641, before the "Saved Avatars" heading), add:

```html
                <h2 style="font-size:0.9rem;">Size</h2>
                <div class="control-group">
                    <div class="control-row">
                        <label>Base Size</label>
                        <div class="val-display"><span id="baseSizeVal">300</span>pt</div>
                    </div>
                    <input type="range" id="baseSizeSlider" min="100" max="600" step="10" value="300">
                </div>
                <div class="control-group" style="display:flex; gap:8px;">
                    <div style="flex:1;">
                        <div class="control-row">
                            <label>Min</label>
                            <div class="val-display"><span id="minSizeVal">40</span></div>
                        </div>
                        <input type="range" id="minSizeSlider" min="20" max="200" step="5" value="40">
                    </div>
                    <div style="flex:1;">
                        <div class="control-row">
                            <label>Max</label>
                            <div class="val-display"><span id="maxSizeVal">400</span></div>
                        </div>
                        <input type="range" id="maxSizeSlider" min="200" max="800" step="10" value="400">
                    </div>
                </div>
```

- [ ] **Step 2: Add base/min/max to getConfig()**

In `apps/sigil/studio/js/ui.js`, find `getConfig()` (line 116). At the top of the returned object, add:

```js
        base: state.avatarBase,
        min: state.avatarMin || 40,
        max: state.avatarMax || 400,
```

- [ ] **Step 3: Add base/min/max to applyConfig()**

In `apps/sigil/studio/js/ui.js`, find `applyConfig(c)` (line 217). Add size handling. After the `if (!c) return;` line and before the existing shape handling, add:

```js
    // Size
    if (c.base != null) {
        state.avatarBase = c.base;
        state.baseScale = computeBaseScale(c.base);
        const baseEl = document.getElementById('baseSizeSlider');
        if (baseEl) { baseEl.value = c.base; }
        const baseValEl = document.getElementById('baseSizeVal');
        if (baseValEl) { baseValEl.innerText = Math.round(c.base); }
    }
    if (c.min != null) {
        state.avatarMin = c.min;
        const minEl = document.getElementById('minSizeSlider');
        if (minEl) { minEl.value = c.min; }
        const minValEl = document.getElementById('minSizeVal');
        if (minValEl) { minValEl.innerText = Math.round(c.min); }
    }
    if (c.max != null) {
        state.avatarMax = c.max;
        const maxEl = document.getElementById('maxSizeSlider');
        if (maxEl) { maxEl.value = c.max; }
        const maxValEl = document.getElementById('maxSizeVal');
        if (maxValEl) { maxValEl.innerText = Math.round(c.max); }
    }
```

Add the `computeBaseScale` import at the top of `ui.js`. Find the existing imports (line 1-6) and add:

```js
import { computeBaseScale } from './scene.js';
```

- [ ] **Step 4: Wire slider change handlers and persistence**

In `setupUI()` in `ui.js`, add event handlers for the three new sliders. Find a suitable location (after the existing Settings section wiring, around line 675). Add:

```js
    // --- Size sliders ---
    const CONFIG_URL = '/_state/avatar-config.json';

    function persistConfig() {
        const config = getConfig();
        fetch(CONFIG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config, null, 2)
        }).catch(err => console.warn('Config persist failed:', err));
    }

    const baseSizeSlider = document.getElementById('baseSizeSlider');
    const baseSizeVal = document.getElementById('baseSizeVal');
    if (baseSizeSlider) {
        baseSizeSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            state.avatarBase = v;
            state.baseScale = computeBaseScale(v);
            if (baseSizeVal) baseSizeVal.innerText = Math.round(v);
        });
        baseSizeSlider.addEventListener('change', persistConfig);
    }

    const minSizeSlider = document.getElementById('minSizeSlider');
    const minSizeVal = document.getElementById('minSizeVal');
    if (minSizeSlider) {
        minSizeSlider.addEventListener('input', (e) => {
            state.avatarMin = parseFloat(e.target.value);
            if (minSizeVal) minSizeVal.innerText = Math.round(state.avatarMin);
        });
        minSizeSlider.addEventListener('change', persistConfig);
    }

    const maxSizeSlider = document.getElementById('maxSizeSlider');
    const maxSizeVal = document.getElementById('maxSizeVal');
    if (maxSizeSlider) {
        maxSizeSlider.addEventListener('input', (e) => {
            state.avatarMax = parseFloat(e.target.value);
            if (maxSizeVal) maxSizeVal.innerText = Math.round(state.avatarMax);
        });
        maxSizeSlider.addEventListener('change', persistConfig);
    }
```

- [ ] **Step 5: Load persisted config on Studio startup**

In `setupUI()`, after the size slider wiring, add initial config load:

```js
    // Load persisted avatar config on startup
    fetch(CONFIG_URL).then(r => {
        if (!r.ok) return null;
        return r.json();
    }).then(config => {
        if (config) applyConfig(config);
    }).catch(() => {});
```

- [ ] **Step 6: Verify end-to-end in Studio**

1. Open Studio
2. Adjust Base Size slider — avatar should visually resize in real time
3. Check that `~/.config/aos/repo/avatar-config.json` was written with `base`/`min`/`max` values
4. Reload Studio — size values should be restored from persisted config

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/studio/index.html apps/sigil/studio/js/ui.js
git commit -m "feat(studio): add avatar size controls with persistence (#19)

Adds Base Size, Min, and Max sliders to the Avatar panel. Changes
persist to avatar-config.json via the content server /_state/ endpoint.
Config is loaded on Studio startup. getConfig()/applyConfig() include
the three size properties."
```

---

### Task 7: Integration test — full loop

**Files:** None (manual verification)

- [ ] **Step 1: Clean state and rebuild**

```bash
rm -f ~/.config/aos/repo/avatar-config.json
cd apps/sigil && bash build-avatar.sh
```

- [ ] **Step 2: Start daemon and avatar**

```bash
./aos serve &
sleep 2
apps/sigil/build/avatar-sub &
```

Expected: Avatar appears at default size (300pt). Behavior unchanged.

- [ ] **Step 3: Open Studio and change size**

Open Studio. Set Base Size to 200. Verify:
- Studio avatar visually shrinks
- `~/.config/aos/repo/avatar-config.json` contains `"base": 200`

- [ ] **Step 4: Restart avatar-sub**

Kill and restart `avatar-sub`. Expected: Avatar now appears at the new 200pt size. Hit-target, docking, and surge all proportionally smaller.

- [ ] **Step 5: Test boundary values**

In Studio, set Base to 100 (small), then 500 (large). Verify avatar scales correctly in both Studio and live renderer. Set Min to 20 and Max to 800 — verify dock/surge behavior at extremes.

- [ ] **Step 6: Test display change**

If multiple displays available: drag the avatar between displays. Verify `baseScale` recomputes and the visual size remains consistent in logical pixels.

- [ ] **Step 7: Clean up test config**

```bash
rm -f ~/.config/aos/repo/avatar-config.json
```
