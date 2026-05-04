# Studio UI Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the Avatar Studio from a celestial physics sandbox into a focused avatar character creator — removing irrelevant controls, surfacing missing sidebar controls, and adopting the FX tile grid pattern from Celestial v2.

**Architecture:** The studio is a standalone HTML page (`apps/sigil/studio/index.html`) with CSS files and JS modules. UI state lives in `renderer/state.js` (read-only to us). Event listeners in `studio/js/ui.js` bind sidebar controls to state. Many listeners reference DOM elements that don't exist yet — adding matching HTML elements activates them automatically. The FX tile grid is data-driven from `renderer/fx-registry.js`.

**Tech Stack:** Vanilla HTML/CSS/JS, Three.js r128 (CDN), ES modules

**Spec:** `docs/superpowers/specs/2026-04-07-studio-ui-reorganization.md`

**Verification:** Open `http://localhost:3333/studio/index.html` (python3 http.server on `apps/sigil/`) after each task. The studio must load without console errors and all existing controls must remain functional.

---

## File Map

| File | Role | Action |
|------|------|--------|
| `studio/index.html` | All sidebar HTML, context menus, panel structure | Major rewrite |
| `studio/js/ui.js` | Event listeners, getConfig/setConfig, FX grid logic | Moderate edits |
| `studio/css/controls.css` | Control styling + new FX tile grid styles | Add new styles |
| `studio/css/sidebar.css` | Nav rail, sidebar layout | Minor title text change |

---

### Task 1: Rename header + nav rail icons + panel IDs

**Files:**
- Modify: `apps/sigil/studio/index.html` (lines 88-89, 116)
- Modify: `apps/sigil/studio/css/sidebar.css` (title text reference if needed)

- [ ] **Step 1: Change sidebar title from CELESTIAL to SIGIL**

In `index.html` line 116, change:
```html
<div class="title-text">CELESTIAL</div>
```
to:
```html
<div class="title-text">SIGIL</div>
```

- [ ] **Step 2: Update nav icon titles and the 4th icon**

In `index.html`, update the nav-icon `title` attributes:
- Line 65: `title="Geometry"` → `title="Shape"`
- Line 75: `title="Colors & Appearance"` → `title="Colors"`
- Line 85: `title="Animation and Effects"` → `title="Effects"`
- Line 88-90: Replace the Environment grid icon with an identity-themed icon:

```html
<div class="nav-icon" data-target="panel-env" title="Avatar">
    <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
</div>
```

(Diamond/gem shape — three stacked chevrons suggesting layers/depth.)

- [ ] **Step 3: Update panel heading text**

- `panel-geom` h2 (line 124): `Geometry` → `Shape`
- `panel-colors` h2 (line 172): `Appearance` → `Colors`
- `panel-anim` h2 (line 245): `Cosmic Phenomena` → (removed — replaced by FX grid in Task 5)
- `panel-env` h2 (line 342): `Environment` → `Avatar`

- [ ] **Step 4: Verify in browser**

Open `http://localhost:3333/studio/index.html`. Confirm:
- Title reads "SIGIL" with same neon animation
- Nav icons show updated tooltips
- Panel headings match new names
- No console errors

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/index.html
git commit -m "feat(studio): rename CELESTIAL→SIGIL, update panel names and nav icons"
```

---

### Task 2: Remove irrelevant controls from HTML

**Files:**
- Modify: `apps/sigil/studio/index.html`

- [ ] **Step 1: Remove the `ctx-env` context menu**

Delete lines 45-56 (the entire `<div id="ctx-env" class="context-menu">` block).

- [ ] **Step 2: Remove grid controls from Environment panel**

In `panel-env`, delete the grid control group (the `<div class="control-group">` containing `gridToggle`, `gridSettings`, `gridColor1/2`, `gridDivsSlider`, `gridBendToggle`, `gridMassSlider`).

- [ ] **Step 3: Remove camera controls from Environment panel**

Delete the control group containing `orthoToggle`, `fovGroup`, `fovSlider`.

- [ ] **Step 4: Remove pathing controls from Animation panel**

In `panel-anim`, delete the entire control group containing `pathToggle`, `btn-pause`, and `pathSettings` (including all nested elements: `centeredViewToggle`, `pathTypeSelect`, `showPathToggle`, `trailToggle`, `trailSettings`, `speedSlider`).

Also delete the `<h2>Animation & Path</h2>` heading — it will be replaced by "Motion" in Task 5.

- [ ] **Step 5: Remove the old phenomena checkbox list**

Delete the control group containing the four checkboxes (`pulsarToggle`, `accretionToggle`, `gammaToggle`, `neutrinoToggle`). These will be replaced by the FX tile grid in Task 5.

Note: Do NOT delete the hidden checkbox elements themselves yet — the FX tile grid will need them. Instead, keep them but wrap them in a hidden container:

```html
<!-- Hidden toggles — FX tile grid drives these -->
<div id="fx-hidden-toggles" style="display:none;">
    <input type="checkbox" id="pulsarToggle">
    <input type="checkbox" id="accretionToggle">
    <input type="checkbox" id="gammaToggle">
    <input type="checkbox" id="neutrinoToggle">
    <input type="checkbox" id="lightningToggle">
    <input type="checkbox" id="magneticToggle">
    <input type="checkbox" id="auraToggle" checked>
</div>
```

- [ ] **Step 6: Verify in browser**

Confirm:
- No grid, camera, or path controls visible
- Aura controls still work (reach/intensity/pulse sliders)
- Spin speed still works
- Supernova button still works
- Environment panel is mostly empty (just scale controls remain — moved in Task 3)
- No console errors

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/studio/index.html
git commit -m "feat(studio): remove grid, camera, path, and swarm controls from sidebar"
```

---

### Task 3: Move scale controls to Shape panel + add shape-conditional params + skin selector

**Files:**
- Modify: `apps/sigil/studio/index.html`

- [ ] **Step 1: Cut scale controls from Environment panel**

Remove these three control groups from `panel-env`:
- Scale Bounds (dual slider with `rangeMin`, `rangeMax`, `dualSliderFill`)
- Z-Depth Scale (`zDepthSlider`)
- Depth Stops (stepper with `btn-step-minus`, `step-buttons-container`, `btn-step-plus`)

- [ ] **Step 2: Add shape-conditional parameters to Shape panel**

After the checkboxes control group in `panel-geom`, add:

```html
<!-- Shape-Specific Parameters (conditional visibility) -->
<div id="tetartoidSettings" class="control-group" style="display:none;">
    <label>Tetartoid Parameters</label>
    <div class="control-row">
        <label style="font-size:0.6rem;">A</label>
        <div class="val-display"><span id="tetAVal">1.00</span></div>
    </div>
    <input type="range" id="tetASlider" min="0.01" max="2" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">B</label>
        <div class="val-display"><span id="tetBVal">1.50</span></div>
    </div>
    <input type="range" id="tetBSlider" min="0.01" max="2" step="0.01" value="1.5">
    <div class="control-row">
        <label style="font-size:0.6rem;">C</label>
        <div class="val-display"><span id="tetCVal">2.00</span></div>
    </div>
    <input type="range" id="tetCSlider" min="0.01" max="2" step="0.01" value="2.0">
</div>

<div id="torusSettings" class="control-group" style="display:none;">
    <label>Torus Parameters</label>
    <div class="control-row">
        <label style="font-size:0.6rem;">Radius</label>
        <div class="val-display"><span id="torusRadiusVal">1.00</span></div>
    </div>
    <input type="range" id="torusRadiusSlider" min="0.1" max="1.5" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Tube</label>
        <div class="val-display"><span id="torusTubeVal">0.30</span></div>
    </div>
    <input type="range" id="torusTubeSlider" min="0.05" max="0.8" step="0.01" value="0.3">
    <div class="control-row">
        <label style="font-size:0.6rem;">Arc</label>
        <div class="val-display"><span id="torusArcVal">1.00</span></div>
    </div>
    <input type="range" id="torusArcSlider" min="0.1" max="1" step="0.01" value="1.0">
</div>

<div id="cylinderSettings" class="control-group" style="display:none;">
    <label>Prism Parameters</label>
    <div class="control-row">
        <label style="font-size:0.6rem;">Top Radius</label>
        <div class="val-display"><span id="cylinderTopVal">1.00</span></div>
    </div>
    <input type="range" id="cylinderTopSlider" min="0" max="2" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Bottom Radius</label>
        <div class="val-display"><span id="cylinderBottomVal">1.00</span></div>
    </div>
    <input type="range" id="cylinderBottomSlider" min="0.1" max="2" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Height</label>
        <div class="val-display"><span id="cylinderHeightVal">1.00</span></div>
    </div>
    <input type="range" id="cylinderHeightSlider" min="0.2" max="4" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Sides</label>
        <div class="val-display"><span id="cylinderSidesVal">32</span></div>
    </div>
    <input type="range" id="cylinderSidesSlider" min="3" max="24" step="1" value="32">
</div>

<div id="boxSettings" class="control-group" style="display:none;">
    <label>Box Parameters</label>
    <div class="control-row">
        <label style="font-size:0.6rem;">Width</label>
        <div class="val-display"><span id="boxWidthVal">1.00</span></div>
    </div>
    <input type="range" id="boxWidthSlider" min="0.1" max="4" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Height</label>
        <div class="val-display"><span id="boxHeightVal">1.00</span></div>
    </div>
    <input type="range" id="boxHeightSlider" min="0.1" max="4" step="0.01" value="1.0">
    <div class="control-row">
        <label style="font-size:0.6rem;">Depth</label>
        <div class="val-display"><span id="boxDepthVal">1.00</span></div>
    </div>
    <input type="range" id="boxDepthSlider" min="0.1" max="4" step="0.01" value="1.0">
</div>
```

- [ ] **Step 3: Add skin selector to Shape panel**

After the shape-conditional params, add:

```html
<div class="control-group">
    <label>Procedural Skin</label>
    <select id="skinSelect">
        <option value="none">None (Default)</option>
        <option value="rocky">Rocky</option>
        <option value="gas-giant">Gas Giant</option>
        <option value="ice">Ice</option>
        <option value="volcanic">Volcanic</option>
        <option value="solar">Solar</option>
        <option value="portal">Portal</option>
        <option value="tech">Tech</option>
        <option value="circuit">Circuit</option>
        <option value="alien">Alien</option>
        <option value="ancient">Ancient</option>
    </select>
</div>
```

- [ ] **Step 4: Paste scale controls into Shape panel**

After the skin selector, add a Scale sub-heading and paste the three scale control groups (Scale Bounds, Z-Depth, Depth Stops) with their exact original HTML.

```html
<h2 style="font-size:0.9rem;">Scale</h2>

<div class="control-group">
    <div class="control-row">
        <label>Scale Bounds</label>
        <div class="val-display">[<span id="rangeMinVal">0.25</span> - <span id="rangeMaxVal">3.00</span>]</div>
    </div>
    <div class="dual-slider-container">
        <div class="dual-slider-track"></div>
        <div class="dual-slider-fill" id="dualSliderFill"></div>
        <input type="range" id="rangeMin" min="0.25" max="3" value="0.25" step="0.01">
        <input type="range" id="rangeMax" min="0.25" max="3" value="3.0" step="0.01">
    </div>
</div>

<div class="control-group">
    <div class="control-row">
        <label>Z-Depth Scale</label>
        <div class="val-display"><span id="zDepthVal">1.10</span></div>
    </div>
    <input type="range" id="zDepthSlider" min="0.25" max="3" step="0.01" value="1.1">
</div>

<div class="control-group">
    <div class="control-row">
        <label>Depth Stops</label>
        <div class="val-display"><span id="stepsVal">3</span> Steps</div>
    </div>
    <div class="stepper-ui">
        <button class="bookend" id="btn-step-minus">-</button>
        <div id="step-buttons-container"></div>
        <button class="bookend" id="btn-step-plus">+</button>
    </div>
</div>
```

- [ ] **Step 5: Add initial shape visibility call in ui.js**

In `apps/sigil/studio/js/ui.js`, inside the `setupUI()` function, after the `shapeSelect` change listener (around line 878), add:

```js
// Show shape-specific params for initial shape
showShapeSettings(state.currentGeometryType);
```

The `showShapeSettings` function already exists at line 865. It just needs to be called once on init.

- [ ] **Step 6: Verify in browser**

Confirm:
- Shape panel now has: shape selector, stellation, opacities, checkboxes, skin selector, Scale sub-section
- Selecting Tetartoid (value 90) shows tetartoid A/B/C sliders; other shapes hide them
- Scale controls work (z-depth slider, dual slider, depth stops)
- Environment panel is now empty
- No console errors

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/studio/index.html apps/sigil/studio/js/ui.js
git commit -m "feat(studio): add shape-conditional params, skin selector, move scale to Shape panel"
```

---

### Task 4: Add Secondary Shape (omega) controls to Shape panel

**Files:**
- Modify: `apps/sigil/studio/index.html`

- [ ] **Step 1: Add omega collapsible section to Shape panel**

After the Scale section in `panel-geom`, add:

```html
<h2 style="font-size:0.9rem;">Secondary Shape</h2>

<div class="control-group">
    <label class="checkbox-label"><input type="checkbox" id="omegaToggle"> Enable Secondary Shape</label>
    <div id="omegaSettings" style="display:none; flex-direction:column; gap:8px; margin-top:8px;">
        <label>Shape</label>
        <select id="omegaShapeSelect">
            <option value="4">Tetrahedron</option>
            <option value="6" selected>Hexahedron (Cube)</option>
            <option value="8">Octahedron</option>
            <option value="12">Dodecahedron</option>
            <option value="20">Icosahedron</option>
            <option value="90">Tetartoid</option>
            <option value="91">Torus Knot</option>
            <option value="100">Sphere</option>
        </select>

        <div class="control-row">
            <label>Stellation</label>
            <div class="val-display"><span id="omegaStellationVal">0.00</span></div>
        </div>
        <input type="range" id="omegaStellationSlider" min="-1" max="2" step="0.05" value="0">

        <div class="control-row">
            <label>Scale</label>
            <div class="val-display"><span id="omegaScaleVal">1.50</span></div>
        </div>
        <input type="range" id="omegaScaleSlider" min="0.1" max="5" step="0.01" value="1.5">

        <div class="control-row">
            <label>Face Opacity</label>
            <div class="val-display"><span id="omegaOpacityVal">0.15</span></div>
        </div>
        <input type="range" id="omegaOpacitySlider" min="0" max="1" step="0.01" value="0.15">

        <div class="control-row">
            <label>Edge Opacity</label>
            <div class="val-display"><span id="omegaEdgeOpacityVal">0.80</span></div>
        </div>
        <input type="range" id="omegaEdgeOpacitySlider" min="0" max="1" step="0.01" value="0.8">

        <label class="checkbox-label"><input type="checkbox" id="omegaMaskToggle" checked> Hollow Core</label>
        <label class="checkbox-label"><input type="checkbox" id="omegaInteriorEdgesToggle" checked> Interior Edges</label>
        <label class="checkbox-label"><input type="checkbox" id="omegaSpecularToggle"> Specular</label>

        <label>Skin</label>
        <select id="omegaSkinSelect">
            <option value="none">None (Default)</option>
            <option value="rocky">Rocky</option>
            <option value="gas-giant">Gas Giant</option>
            <option value="ice">Ice</option>
            <option value="volcanic">Volcanic</option>
            <option value="solar">Solar</option>
            <option value="portal">Portal</option>
            <option value="tech">Tech</option>
            <option value="circuit">Circuit</option>
            <option value="alien">Alien</option>
            <option value="ancient">Ancient</option>
        </select>

        <label style="margin-top:6px;">Motion</label>
        <label class="checkbox-label"><input type="checkbox" id="omegaCounterSpin"> Counter-Spin</label>
        <label class="checkbox-label"><input type="checkbox" id="omegaLockPosition"> Lock Position</label>

        <label style="margin-top:6px;">Ghost Trails</label>
        <label class="checkbox-label"><input type="checkbox" id="omegaInterDimensional"> Inter-Dimensional</label>
        <div id="omegaGhostSettings" style="display:none; flex-direction:column; gap:4px; padding-left:20px;">
            <div class="control-row">
                <label style="font-size:0.6rem;">Ghost Count</label>
                <div class="val-display"><span id="omegaGhostCountVal">10</span></div>
            </div>
            <input type="range" id="omegaGhostCountSlider" min="1" max="30" step="1" value="10">
            <div class="control-row">
                <label style="font-size:0.6rem;">Duration</label>
                <div class="val-display"><span id="omegaGhostDurVal">2.0</span></div>
            </div>
            <input type="range" id="omegaGhostDurSlider" min="0.5" max="10" step="0.1" value="2.0">
            <label style="font-size:0.6rem;">Mode</label>
            <select id="omegaGhostMode">
                <option value="fade">Fade</option>
                <option value="solid">Solid</option>
                <option value="wireframe">Wireframe</option>
            </select>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Verify in browser**

Confirm:
- "Secondary Shape" section appears at bottom of Shape panel
- Toggle enables/shows the settings
- All sliders, dropdowns, and checkboxes render correctly
- Toggling "Enable Secondary Shape" shows/hides the omega in the 3D preview
- Ghost trail controls appear when "Inter-Dimensional" is checked
- No console errors

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/studio/index.html
git commit -m "feat(studio): add secondary shape (omega) controls to Shape panel"
```

---

### Task 5: Restructure Effects panel with FX tile grid

**Files:**
- Modify: `apps/sigil/studio/index.html`
- Modify: `apps/sigil/studio/js/ui.js`
- Modify: `apps/sigil/studio/css/controls.css`

- [ ] **Step 1: Add FX tile grid CSS to controls.css**

Append to `apps/sigil/studio/css/controls.css`:

```css
/* FX Tile Grid */
.fx-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
}
.fx-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 10px 4px 8px;
    border-radius: 6px;
    border: 1px solid rgba(209, 135, 255, 0.15);
    background: rgba(30, 15, 50, 0.6);
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
}
.fx-tile:hover {
    border-color: rgba(209, 135, 255, 0.4);
    background: rgba(40, 20, 65, 0.8);
}
.fx-tile.active {
    border-color: rgba(188, 19, 254, 0.8);
    background: rgba(188, 19, 254, 0.15);
    box-shadow: 0 0 12px rgba(188, 19, 254, 0.3), inset 0 0 8px rgba(188, 19, 254, 0.1);
}
.fx-tile.active .fx-tile-emoji { filter: drop-shadow(0 0 6px rgba(188, 19, 254, 0.6)); }
.fx-tile.active .fx-tile-label { color: #fff; }
.fx-tile-emoji { font-size: 20px; line-height: 1; transition: filter 0.2s; }
.fx-tile-label { font-size: 0.6rem; color: rgba(209, 135, 255, 0.7); text-align: center; line-height: 1.1; transition: color 0.2s; }
.fx-tile-gear {
    position: absolute; top: 3px; right: 3px;
    width: 14px; height: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: rgba(209, 135, 255, 0.4);
    border-radius: 3px; transition: all 0.15s; z-index: 2;
}
.fx-tile-gear:hover { color: #fff; background: rgba(188, 19, 254, 0.4); }
.fx-tile.active .fx-tile-gear { color: rgba(209, 135, 255, 0.7); }

/* FX sub-settings (collapsible below grid) */
.fx-sub-settings {
    display: none;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid rgba(188, 19, 254, 0.3);
    border-radius: 6px;
    background: rgba(30, 15, 50, 0.4);
    margin-top: 6px;
}
.fx-sub-settings.open { display: flex; }
.fx-sub-settings .sub-heading {
    font-size: 0.7rem; color: #d187ff; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 2px; font-weight: bold;
}
```

- [ ] **Step 2: Rewrite panel-anim HTML structure**

Replace the entire `panel-anim` content with the new Effects layout:

```html
<div id="panel-anim" class="panel">
    <h2>Effects</h2>

    <!-- Hidden toggles — FX tile grid drives these -->
    <div id="fx-hidden-toggles" style="display:none;">
        <input type="checkbox" id="pulsarToggle">
        <input type="checkbox" id="accretionToggle">
        <input type="checkbox" id="gammaToggle">
        <input type="checkbox" id="neutrinoToggle">
        <input type="checkbox" id="lightningToggle">
        <input type="checkbox" id="magneticToggle">
    </div>

    <h2 style="font-size:0.9rem;">Motion</h2>
    <div class="control-group">
        <div class="control-row">
            <label>Base Spin Speed</label>
            <div class="val-display"><span id="idleSpinVal">0.010</span></div>
        </div>
        <input type="range" id="idleSpinSlider" min="0.00" max="0.1" step="0.001" value="0.01">
        <button class="btn-action" id="btn-quick-spin" style="margin-top: 5px;">Quick Spin Burst</button>
    </div>

    <h2 style="font-size:0.9rem;">Aura</h2>
    <div class="control-group">
        <label class="checkbox-label"><input type="checkbox" id="auraToggle" checked> Enable Aura Glow</label>
        <div id="auraIntensityWrapper">
            <div class="control-row" style="margin-top: 5px;">
                <label>Reach</label>
                <div class="val-display"><span id="auraReachVal">1.00</span></div>
            </div>
            <input type="range" id="auraReachSlider" min="0" max="3" step="0.01" value="1.0">
            <div class="control-row" style="margin-top: 5px;">
                <label>Intensity</label>
                <div class="val-display"><span id="auraIntensityVal">1.00</span></div>
            </div>
            <input type="range" id="auraIntensitySlider" min="0" max="3" step="0.01" value="1.0">
            <div class="control-row" style="margin-top: 5px;">
                <label>Pulse Rate</label>
                <div class="val-display"><span id="pulseRateVal">0.005</span></div>
            </div>
            <input type="range" id="pulseRateSlider" min="0.001" max="0.02" step="0.001" value="0.005">
            <div class="control-row" style="margin-top: 10px;">
                <button class="btn-action" id="btn-spike" style="flex-grow: 1;">Spike Amplitude</button>
                <input type="number" id="spikeMultiplier" value="1.5" min="1.1" max="50" step="0.1" class="edit-input" style="width: 50px; margin-left: 8px;" title="Spike Size Multiplier">
            </div>
        </div>
    </div>

    <h2 style="font-size:0.9rem;">Phenomena</h2>
    <div class="control-group">
        <div class="fx-grid" id="fxGrid"></div>
        <div id="fx-sub-container"></div>
    </div>

    <!-- Per-phenomenon inline settings (hidden, toggled by gear click) -->
    <div id="pulsarSettings" class="fx-sub-settings">
        <div class="sub-heading">Pulsar Settings</div>
        <div class="control-row"><label style="font-size:0.6rem;">Count</label><input type="number" id="pulsarCount" value="1" min="1" max="150" class="edit-input" style="width:50px;"></div>
        <div class="control-row"><label style="font-size:0.6rem;">Turbulence</label><div class="val-display"><span id="pTurbVal">0.00</span></div></div>
        <input type="range" id="pTurbSlider" min="0" max="1" step="0.01" value="0">
        <div class="control-row"><label style="font-size:0.6rem;">Turb Speed</label><div class="val-display"><span id="pTurbSpdVal">1.0</span></div></div>
        <input type="range" id="pTurbSpdSlider" min="0.1" max="10" step="0.1" value="1.0">
        <div class="control-row"><label style="font-size:0.6rem;">Phase Mode</label><select id="pTurbMod" style="width:auto;padding:2px 6px;font-size:0.65rem;"><option value="uniform">Uniform</option><option value="wave">Wave</option><option value="random">Random</option></select></div>
    </div>
    <div id="accretionSettings" class="fx-sub-settings">
        <div class="sub-heading">Accretion Settings</div>
        <div class="control-row"><label style="font-size:0.6rem;">Count</label><input type="number" id="accretionCount" value="1" min="1" max="150" class="edit-input" style="width:50px;"></div>
        <div class="control-row"><label style="font-size:0.6rem;">Turbulence</label><div class="val-display"><span id="aTurbVal">0.00</span></div></div>
        <input type="range" id="aTurbSlider" min="0" max="1" step="0.01" value="0">
        <div class="control-row"><label style="font-size:0.6rem;">Turb Speed</label><div class="val-display"><span id="aTurbSpdVal">1.0</span></div></div>
        <input type="range" id="aTurbSpdSlider" min="0.1" max="10" step="0.1" value="1.0">
        <div class="control-row"><label style="font-size:0.6rem;">Phase Mode</label><select id="aTurbMod" style="width:auto;padding:2px 6px;font-size:0.65rem;"><option value="uniform">Uniform</option><option value="wave">Wave</option><option value="random">Random</option></select></div>
    </div>
    <div id="gammaSettings" class="fx-sub-settings">
        <div class="sub-heading">Gamma Settings</div>
        <div class="control-row"><label style="font-size:0.6rem;">Count</label><input type="number" id="gammaCount" value="1" min="1" max="150" class="edit-input" style="width:50px;"></div>
        <div class="control-row"><label style="font-size:0.6rem;">Turbulence</label><div class="val-display"><span id="gTurbVal">0.00</span></div></div>
        <input type="range" id="gTurbSlider" min="0" max="1" step="0.01" value="0">
        <div class="control-row"><label style="font-size:0.6rem;">Turb Speed</label><div class="val-display"><span id="gTurbSpdVal">1.0</span></div></div>
        <input type="range" id="gTurbSpdSlider" min="0.1" max="10" step="0.1" value="1.0">
        <div class="control-row"><label style="font-size:0.6rem;">Phase Mode</label><select id="gTurbMod" style="width:auto;padding:2px 6px;font-size:0.65rem;"><option value="uniform">Uniform</option><option value="wave">Wave</option><option value="random">Random</option></select></div>
    </div>
    <div id="neutrinoSettings" class="fx-sub-settings">
        <div class="sub-heading">Neutrino Settings</div>
        <div class="control-row"><label style="font-size:0.6rem;">Count</label><input type="number" id="neutrinoCount" value="1" min="1" max="150" class="edit-input" style="width:50px;"></div>
        <div class="control-row"><label style="font-size:0.6rem;">Turbulence</label><div class="val-display"><span id="nTurbVal">0.00</span></div></div>
        <input type="range" id="nTurbSlider" min="0" max="1" step="0.01" value="0">
        <div class="control-row"><label style="font-size:0.6rem;">Turb Speed</label><div class="val-display"><span id="nTurbSpdVal">1.0</span></div></div>
        <input type="range" id="nTurbSpdSlider" min="0.1" max="10" step="0.1" value="1.0">
        <div class="control-row"><label style="font-size:0.6rem;">Phase Mode</label><select id="nTurbMod" style="width:auto;padding:2px 6px;font-size:0.65rem;"><option value="uniform">Uniform</option><option value="wave">Wave</option><option value="random">Random</option></select></div>
    </div>
    <div id="lightningSettings" class="fx-sub-settings">
        <div class="sub-heading">Lightning Settings</div>
        <label class="checkbox-label"><input type="checkbox" id="lightningOriginCenter" checked> Origin at Center</label>
        <label class="checkbox-label"><input type="checkbox" id="lightningSolidBlock"> Solid Block</label>
        <div class="control-row"><label style="font-size:0.6rem;">Bolt Length</label><div class="val-display"><span id="lightningLengthVal">100</span></div></div>
        <input type="range" id="lightningLengthSlider" min="10" max="300" step="1" value="100">
        <div class="control-row"><label style="font-size:0.6rem;">Frequency</label><div class="val-display"><span id="lightningFreqVal">2.0</span></div></div>
        <input type="range" id="lightningFreqSlider" min="0.1" max="10" step="0.1" value="2.0">
        <div class="control-row"><label style="font-size:0.6rem;">Duration</label><div class="val-display"><span id="lightningDurVal">0.8</span></div></div>
        <input type="range" id="lightningDurSlider" min="0.1" max="5" step="0.1" value="0.8">
        <div class="control-row"><label style="font-size:0.6rem;">Branching</label><div class="val-display"><span id="lightningBranchVal">0.08</span></div></div>
        <input type="range" id="lightningBranchSlider" min="0" max="0.5" step="0.01" value="0.08">
        <div class="control-row"><label style="font-size:0.6rem;">Brightness</label><div class="val-display"><span id="lightningBrightVal">1.0</span></div></div>
        <input type="range" id="lightningBrightSlider" min="0.1" max="5" step="0.1" value="1.0">
    </div>
    <div id="magneticSettings" class="fx-sub-settings">
        <div class="sub-heading">Magnetic Settings</div>
        <div class="control-row"><label style="font-size:0.6rem;">Tentacle Count</label><div class="val-display"><span id="magneticCountVal">10</span></div></div>
        <input type="range" id="magneticCountSlider" min="1" max="30" step="1" value="10">
        <div class="control-row"><label style="font-size:0.6rem;">Speed</label><div class="val-display"><span id="magneticSpeedVal">1.0</span></div></div>
        <input type="range" id="magneticSpeedSlider" min="0.1" max="5" step="0.1" value="1.0">
        <div class="control-row"><label style="font-size:0.6rem;">Wander</label><div class="val-display"><span id="magneticWanderVal">3.0</span></div></div>
        <input type="range" id="magneticWanderSlider" min="0" max="10" step="0.1" value="3.0">
    </div>

    <h2 style="font-size:0.9rem;">Particles</h2>
    <div class="control-group">
        <div id="btn-supercharge" class="btn-action" style="position: relative; overflow: hidden; user-select: none; height: 28px; display: flex; align-items: center; justify-content: center;">
            <div id="charge-fill" style="position: absolute; top:0; left:0; height:100%; width:0%; background: rgba(255,255,255,0.3); pointer-events:none; transition: width 0.1s linear;"></div>
            <span style="position:relative; z-index:2; pointer-events:none;">HOLD TO SUPER NOVA</span>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Add FX grid rendering logic to ui.js**

In `apps/sigil/studio/js/ui.js`, inside `setupUI()`, after the phenomenon config event listeners, add:

```js
// FX Tile Grid — data-driven from fx-registry
const fxGrid = document.getElementById('fxGrid');
if (fxGrid) {
    // Filter out swarm (removed from UI)
    const studioEffects = EFFECTS.filter(fx => fx.id !== 'swarm');
    let openSubId = null;

    studioEffects.forEach(fx => {
        const tile = document.createElement('div');
        tile.className = 'fx-tile';
        tile.dataset.effect = fx.id;

        const srcToggle = document.getElementById(fx.sidebarId);
        if (srcToggle && srcToggle.checked) tile.classList.add('active');

        tile.innerHTML = `<span class="fx-tile-emoji">${fx.emoji}</span>`
            + `<span class="fx-tile-label">${fx.label}</span>`
            + `<span class="fx-tile-gear" data-gear="${fx.id}" title="${fx.label} Settings">&#9881;</span>`;

        tile.addEventListener('click', (e) => {
            if (e.target.closest('.fx-tile-gear')) return;
            const toggle = document.getElementById(fx.sidebarId);
            if (toggle) {
                toggle.checked = !toggle.checked;
                toggle.dispatchEvent(new Event('change'));
            }
            tile.classList.toggle('active');
        });

        const gear = tile.querySelector('.fx-tile-gear');
        if (gear) {
            gear.addEventListener('click', (e) => {
                e.stopPropagation();
                const settingsId = fx.id + 'Settings';
                const panel = document.getElementById(settingsId);
                if (!panel) return;
                if (openSubId === settingsId) {
                    panel.classList.remove('open');
                    openSubId = null;
                } else {
                    if (openSubId) {
                        const prev = document.getElementById(openSubId);
                        if (prev) prev.classList.remove('open');
                    }
                    panel.classList.add('open');
                    openSubId = settingsId;
                }
            });
        }

        fxGrid.appendChild(tile);
    });
}
```

- [ ] **Step 4: Note — dead listener cleanup deferred to Task 8**

The old grid/swarm/camera/path event listeners in `ui.js` will now silently fail (getElementById returns null, addEventListener throws). This is harmless for now. Task 8 does a thorough cleanup pass. Don't duplicate that work here.

- [ ] **Step 5: Verify in browser**

Confirm:
- Effects panel shows: Motion (spin), Aura (reach/intensity/pulse), Phenomena (FX tile grid), Particles (supernova)
- FX tiles render as a 3x3-ish grid with emoji icons
- Clicking a tile toggles the effect in the 3D preview
- Clicking the gear icon opens sub-settings below the grid
- Lightning settings show bolt length, frequency, duration, branching, brightness sliders
- Magnetic settings show tentacle count, speed, wander sliders
- Phenomenon settings show count, turbulence, speed, phase mode
- No console errors

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/studio/index.html apps/sigil/studio/js/ui.js apps/sigil/studio/css/controls.css
git commit -m "feat(studio): add FX tile grid, lightning/magnetic/turbulence controls to Effects panel"
```

---

### Task 6: Update Colors panel with new color pickers

**Files:**
- Modify: `apps/sigil/studio/index.html`

- [ ] **Step 1: Add omega color pickers to Colors panel**

After the Aura color row in the Component Gradients section, add:

```html
<div id="omegaColorGroup" style="display:none;">
    <div class="control-row" style="margin-top: 5px;">
        <label style="font-size:0.6rem;">Secondary Faces</label>
        <div class="color-picker-group">
            <input type="color" id="omegaFaceColor1" value="#4a2b6e"><input type="color" id="omegaFaceColor2" value="#1a0b2e">
        </div>
    </div>
    <div class="control-row" style="margin-top: 5px;">
        <label style="font-size:0.6rem;">Secondary Edges</label>
        <div class="color-picker-group">
            <input type="color" id="omegaEdgeColor1" value="#bc13fe"><input type="color" id="omegaEdgeColor2" value="#4a2b6e">
        </div>
    </div>
</div>
```

- [ ] **Step 2: Rename "Phenomena Gradients" and add lightning/magnetic colors**

Change the label `Phenomena Gradients` to `Effect Colors`.

After the Neutrinos color row, add:

```html
<div class="control-row" style="margin-top: 5px;">
    <label style="font-size:0.6rem;">Lightning</label>
    <div class="color-picker-group">
        <input type="color" id="lightningColor1" value="#ffffff"><input type="color" id="lightningColor2" value="#bc13fe">
    </div>
</div>
<div class="control-row" style="margin-top: 5px;">
    <label style="font-size:0.6rem;">Magnetic</label>
    <div class="color-picker-group">
        <input type="color" id="magneticColor1" value="#bc13fe"><input type="color" id="magneticColor2" value="#4a2b6e">
    </div>
</div>
```

- [ ] **Step 3: Wire omega color visibility to omega toggle in ui.js**

In the omega toggle event listener in `ui.js` (line ~1064), add:

```js
const omegaColors = document.getElementById('omegaColorGroup');
if (omegaColors) omegaColors.style.display = e.target.checked ? '' : 'none';
```

- [ ] **Step 4: Verify in browser**

Confirm:
- Colors panel shows Component Gradients (Faces, Edges, Aura) — no change
- Enabling Secondary Shape in Shape panel reveals "Secondary Faces" and "Secondary Edges" color pickers
- "Effect Colors" section shows Pulsar, Gamma, Accretion, Neutrino + Lightning + Magnetic color pickers
- Changing lightning/magnetic colors affects the 3D preview
- No console errors

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/index.html apps/sigil/studio/js/ui.js
git commit -m "feat(studio): add omega/lightning/magnetic color pickers to Colors panel"
```

---

### Task 7: Replace Environment panel with Avatar placeholder

**Files:**
- Modify: `apps/sigil/studio/index.html`
- Modify: `apps/sigil/studio/js/ui.js`

- [ ] **Step 1: Replace panel-env content**

Replace the entire `panel-env` div content with:

```html
<div id="panel-env" class="panel">
    <h2>Avatar</h2>
    <div class="control-group" style="text-align:center; padding: 20px 10px;">
        <div style="font-size: 2rem; margin-bottom: 10px; opacity: 0.6;">&#9670;</div>
        <div style="font-size: 0.8rem; color: #d187ff; margin-bottom: 6px;" id="avatar-shape-label">Hexahedron (Cube)</div>
        <div style="font-size: 0.65rem; color: #aaa;" id="avatar-preset-label">Default Theme</div>
    </div>
    <div class="control-group" style="text-align:center; padding: 15px 10px;">
        <div style="font-size: 0.6rem; color: rgba(209,135,255,0.5); font-style: italic;">
            Avatar roster coming soon.<br>
            Design your avatar using Shape, Colors, and Effects.
        </div>
    </div>
</div>
```

- [ ] **Step 2: Add dynamic label updates in ui.js**

In `setupUI()`, after the shape change listener, add code to update the avatar card:

```js
// Update avatar card labels
function updateAvatarCard() {
    const shapeSelect = document.getElementById('shapeSelect');
    const presetSelect = document.getElementById('presetSelect');
    const shapeLabel = document.getElementById('avatar-shape-label');
    const presetLabel = document.getElementById('avatar-preset-label');
    if (shapeLabel && shapeSelect) shapeLabel.textContent = shapeSelect.options[shapeSelect.selectedIndex].text;
    if (presetLabel && presetSelect) presetLabel.textContent = presetSelect.options[presetSelect.selectedIndex].text;
}

document.getElementById('shapeSelect').addEventListener('change', updateAvatarCard);
document.getElementById('presetSelect').addEventListener('change', updateAvatarCard);
```

- [ ] **Step 3: Verify in browser**

Confirm:
- Avatar panel shows a gem icon, shape name, and preset name
- Changing shape in Shape panel updates the label
- Changing preset in Colors panel updates the label
- "Avatar roster coming soon" placeholder text visible
- No console errors

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/index.html apps/sigil/studio/js/ui.js
git commit -m "feat(studio): replace Environment panel with Avatar placeholder card"
```

---

### Task 8: Clean up removed event listeners in ui.js

**Files:**
- Modify: `apps/sigil/studio/js/ui.js`

- [ ] **Step 1: Remove dead event listener code**

In `setupUI()`, remove the following blocks that reference deleted HTML elements:
- Grid mode select + grid3d listeners (`gridModeSelect`, `grid3dRenderMode`, `grid3dDensitySlider`, `grid3dRadiusSlider`, `grid3dGravitySlider`, `grid3dTimeSlider`, `grid3dSnowGlobeToggle`, `grid3dProbeToggle`, `grid3dRelativeToggle`)
- Swarm listeners (`swarmToggle`, `swarmCountSlider`, `swarmGravitySlider`, `swarmHorizonSlider`, `swarmTimeSlider`, `swarmColor1`, `swarmColor2`, `blackHoleModeToggle`)
- Camera listeners (`orthoToggle`, `fovSlider`)
- Path listeners (`pathToggle`, `centeredViewToggle`, `btn-pause`, `pathTypeSelect`, `speedSlider`, `showPathToggle`, `trailToggle`, `trailLengthSlider`)

Also remove from `setupEditableLabels()`:
- `gridDivsVal`, `gridMassVal` editables (if present)
- `fovVal` editable
- `speedVal`, `trailLengthVal` editables

Keep `getConfig()` and `applyConfig()` intact — they must still serialize/deserialize all fields.

- [ ] **Step 2: Verify no console errors**

Open the studio. Open browser console. Check for:
- No "Cannot read properties of null" errors
- All panel switching works
- All remaining controls function

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/studio/js/ui.js
git commit -m "refactor(studio): remove dead event listeners for grid, swarm, camera, path"
```

---

### Task 9: Final verification pass

**Files:** None modified — verification only.

- [ ] **Step 1: Verify all panels**

Walk through each panel:
- **Shape**: shape selector, stellation, face/edge opacity, checkboxes, tetartoid params (select tetartoid), torus params (select torus), skin selector, scale controls, secondary shape (enable and tweak)
- **Colors**: preset selector, master gradient, component gradients (faces/edges/aura), secondary shape colors (enable omega first), effect colors (all 6 rows including lightning/magnetic)
- **Effects**: spin speed, quick spin burst, aura controls, FX tile grid (click tiles, click gears), sub-settings for each effect, supernova
- **Avatar**: shape label updates, preset label updates, placeholder text

- [ ] **Step 2: Verify save/load round-trip**

1. Configure a complex avatar (enable omega, enable some effects, change colors)
2. Click Save — download the JSON
3. Click Randomize — confirm it changes
4. Click Load — load the saved JSON
5. Confirm all settings restore correctly

- [ ] **Step 3: Verify context menus still work**

Right-click on the polyhedron — `ctx-object` menu should appear with working controls. Verify the proxy sync between context menu and sidebar still functions.

- [ ] **Step 4: Commit any fixes**

If any issues were found and fixed:
```bash
git add -A apps/sigil/studio/
git commit -m "fix(studio): post-reorganization polish and fixes"
```
