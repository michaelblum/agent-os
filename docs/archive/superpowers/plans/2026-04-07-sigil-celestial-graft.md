# Sigil Celestial Graft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small-window avatar renderer with full-screen transparent canvases running the celestial legacy engine, enabling ghost trails and effects across screen space.

**Architecture:** Copy celestial legacy JS/CSS/HTML into `apps/sigil/` as two variants — `studio/` (customization UI) and `live/` (transparent desktop renderer). Update Swift animation layer to send scene-position updates instead of window-position updates. Full-screen non-interactive canvases per display.

**Tech Stack:** Three.js r128, Swift (avatar-sub), WKWebView, macOS NSWindow (`ignoresMouseEvents`), aos daemon IPC

---

## File Structure

**New files (copied from celestial legacy `_legacy/`):**

```
apps/sigil/celestial/              # Shared JS modules (both modes import from here)
├── js/
│   ├── state.js                   # Centralized state object
│   ├── geometry.js                # Polyhedron generation + stellation
│   ├── colors.js                  # Color/gradient system + vertex coloring
│   ├── skins.js                   # Procedural shader skins
│   ├── aura.js                    # Aura glow + charge effects
│   ├── particles.js               # Explosion + supernova particles
│   ├── omega.js                   # Secondary polyhedron + ghost trails
│   ├── phenomena.js               # Pulsars, gamma rays, accretion, neutrinos
│   ├── lightning.js               # Fractal lightning arcs
│   ├── magnetic.js                # Magnetic field tentacles
│   ├── presets.js                 # Preset configurations
│   ├── fx-registry.js             # Effect preset registry
│   └── shaders/
│       ├── skin-shaders.js
│       ├── fresnel.js
│       └── noise.js
├── studio/
│   ├── index.html                 # Studio UI (celestial's index.html, adapted)
│   ├── css/
│   │   ├── base.css
│   │   ├── sidebar.css
│   │   ├── controls.css
│   │   └── context-menu.css
│   └── js/
│       ├── main.js                # Studio entry point (full celestial init + UI)
│       ├── scene.js               # Scene with skybox, camera controls
│       ├── ui.js                  # All UI wiring (1,353 lines)
│       ├── interaction.js         # Mouse/camera controls, context menus
│       ├── pathing.js             # Auto-path + follow-mouse (studio preview)
│       ├── grid3d.js              # 3D grid (studio only)
│       ├── swarm.js               # Particle swarm (studio only)
│       └── skybox.js              # Nebula background (studio only)
└── live/
    ├── index.html                 # Live renderer (minimal, transparent, no UI)
    └── js/
        ├── main.js                # Live entry point (IPC listener, no UI setup)
        ├── scene.js               # Scene: no skybox, transparent clear, fixed camera
        └── pathing.js             # Movement driven by Swift IPC messages
```

**Modified files:**

```
apps/sigil/avatar-animate.swift    # Replace sendAvatarUpdate with sendScenePosition
apps/sigil/avatar-behaviors.swift  # Update behaviors to use scene-position model
apps/sigil/avatar-ipc.swift        # Add scene-position + config message helpers
apps/sigil/avatar-sub.swift        # Full-screen canvas creation, display handoff
apps/sigil/build-avatar.sh         # No changes needed (Swift only)
apps/sigil/CLAUDE.md               # Update architecture table
```

**Replaced files:**

```
apps/sigil/avatar.html             # Replaced by live/index.html (kept for reference until stable)
```

---

### Task 1: Copy Shared Celestial Modules

Copy the core JS modules that both studio and live modes will import. These are copied verbatim — no modifications.

**Files:**
- Create: `apps/sigil/celestial/js/state.js` (from `_legacy/js/state.js`)
- Create: `apps/sigil/celestial/js/geometry.js` (from `_legacy/js/geometry.js`)
- Create: `apps/sigil/celestial/js/colors.js` (from `_legacy/js/colors.js`)
- Create: `apps/sigil/celestial/js/skins.js` (from `_legacy/js/skins.js`)
- Create: `apps/sigil/celestial/js/aura.js` (from `_legacy/js/aura.js`)
- Create: `apps/sigil/celestial/js/particles.js` (from `_legacy/js/particles.js`)
- Create: `apps/sigil/celestial/js/omega.js` (from `_legacy/js/omega.js`)
- Create: `apps/sigil/celestial/js/phenomena.js` (from `_legacy/js/phenomena.js`)
- Create: `apps/sigil/celestial/js/lightning.js` (from `_legacy/js/lightning.js`)
- Create: `apps/sigil/celestial/js/magnetic.js` (from `_legacy/js/magnetic.js`)
- Create: `apps/sigil/celestial/js/presets.js` (from `_legacy/js/presets.js`)
- Create: `apps/sigil/celestial/js/fx-registry.js` (from `_legacy/js/fx-registry.js`)
- Create: `apps/sigil/celestial/js/shaders/skin-shaders.js`
- Create: `apps/sigil/celestial/js/shaders/fresnel.js`
- Create: `apps/sigil/celestial/js/shaders/noise.js`
- Create: `apps/sigil/celestial/js/lib/stats.module.js` (from `_legacy/js/lib/stats.module.js`)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p apps/sigil/celestial/js/shaders apps/sigil/celestial/js/lib
mkdir -p apps/sigil/celestial/studio/css apps/sigil/celestial/studio/js
mkdir -p apps/sigil/celestial/live/js
```

- [ ] **Step 2: Copy shared modules**

```bash
LEGACY="/Users/Michael/Documents/GitHub/celestial/_legacy"
DEST="apps/sigil/celestial/js"

cp "$LEGACY/js/state.js" "$DEST/"
cp "$LEGACY/js/geometry.js" "$DEST/"
cp "$LEGACY/js/colors.js" "$DEST/"
cp "$LEGACY/js/skins.js" "$DEST/"
cp "$LEGACY/js/aura.js" "$DEST/"
cp "$LEGACY/js/particles.js" "$DEST/"
cp "$LEGACY/js/omega.js" "$DEST/"
cp "$LEGACY/js/phenomena.js" "$DEST/"
cp "$LEGACY/js/lightning.js" "$DEST/"
cp "$LEGACY/js/magnetic.js" "$DEST/"
cp "$LEGACY/js/presets.js" "$DEST/"
cp "$LEGACY/js/fx-registry.js" "$DEST/"
cp "$LEGACY/js/shaders/skin-shaders.js" "$DEST/shaders/"
cp "$LEGACY/js/shaders/fresnel.js" "$DEST/shaders/"
cp "$LEGACY/js/shaders/noise.js" "$DEST/shaders/"
cp "$LEGACY/js/lib/stats.module.js" "$DEST/lib/"
```

- [ ] **Step 3: Fix import paths in shared modules**

All shared modules import `state` as `import state from './state.js'`. Since they now live in `celestial/js/`, these relative imports are already correct — shared modules importing from each other will resolve within the same directory.

Verify no broken imports:

```bash
grep -n "from './" apps/sigil/celestial/js/*.js | grep -v "state.js\|geometry.js\|colors.js\|pathing.js\|fx-registry.js"
```

Check for any imports that reference files NOT in the shared directory (e.g., `pathing.js`, `interaction.js`, `ui.js`, `scene.js`, `grid3d.js`, `swarm.js`, `skybox.js`). These are mode-specific and will be in `studio/js/` or `live/js/`.

Fix any shared modules that import mode-specific files. Specifically:
- `omega.js` imports `{ updateOmegaGeometry } from './geometry.js'` — OK, geometry is shared
- `colors.js` may import from `skins.js` — check and fix if needed
- `presets.js` may call UI functions — the `applyPreset()` function uses `setUI()` which is defined in `ui.js`. This needs to be decoupled:
  - Extract preset data (the config objects) from `applyPreset()` into pure data
  - The UI-setting logic stays in studio's `ui.js`
  - Live mode applies presets directly to state without UI

**Note:** If `presets.js` is tightly coupled to `ui.js`, defer decoupling — keep `presets.js` in studio only and have live mode use `setConfig()` directly.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/celestial/js/
git commit -m "feat(sigil): copy shared celestial modules into sigil"
```

---

### Task 2: Create Studio Mode

Copy celestial's full UI experience into `studio/`. Studio is celestial as-is with cosmetic renaming.

**Files:**
- Create: `apps/sigil/celestial/studio/index.html` (from `_legacy/index.html`, adapted)
- Create: `apps/sigil/celestial/studio/css/base.css` (from `_legacy/css/base.css`)
- Create: `apps/sigil/celestial/studio/css/sidebar.css` (from `_legacy/css/sidebar.css`)
- Create: `apps/sigil/celestial/studio/css/controls.css` (from `_legacy/css/controls.css`)
- Create: `apps/sigil/celestial/studio/css/context-menu.css` (from `_legacy/css/context-menu.css`)
- Create: `apps/sigil/celestial/studio/js/main.js` (from `_legacy/js/main.js`, adapted)
- Create: `apps/sigil/celestial/studio/js/scene.js` (from `_legacy/js/scene.js`)
- Create: `apps/sigil/celestial/studio/js/ui.js` (from `_legacy/js/ui.js`, adapted)
- Create: `apps/sigil/celestial/studio/js/interaction.js` (from `_legacy/js/interaction.js`)
- Create: `apps/sigil/celestial/studio/js/pathing.js` (from `_legacy/js/pathing.js`)
- Create: `apps/sigil/celestial/studio/js/grid3d.js` (from `_legacy/js/grid3d.js`)
- Create: `apps/sigil/celestial/studio/js/swarm.js` (from `_legacy/js/swarm.js`)
- Create: `apps/sigil/celestial/studio/js/skybox.js` (from `_legacy/js/skybox.js`)

- [ ] **Step 1: Copy studio-specific files**

```bash
LEGACY="/Users/Michael/Documents/GitHub/celestial/_legacy"

# CSS
cp "$LEGACY/css/base.css" apps/sigil/celestial/studio/css/
cp "$LEGACY/css/sidebar.css" apps/sigil/celestial/studio/css/
cp "$LEGACY/css/controls.css" apps/sigil/celestial/studio/css/
cp "$LEGACY/css/context-menu.css" apps/sigil/celestial/studio/css/

# Studio-only JS
cp "$LEGACY/js/main.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/scene.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/ui.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/interaction.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/pathing.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/grid3d.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/swarm.js" apps/sigil/celestial/studio/js/
cp "$LEGACY/js/skybox.js" apps/sigil/celestial/studio/js/

# HTML
cp "$LEGACY/index.html" apps/sigil/celestial/studio/index.html
```

- [ ] **Step 2: Fix import paths in studio modules**

Studio JS files need to import shared modules from `../js/` instead of `./`. Update all studio JS files:

In each file under `apps/sigil/celestial/studio/js/`, replace imports that reference shared modules:

```javascript
// Before (celestial original):
import state from './state.js';
import { updateGeometry } from './geometry.js';
import { createAuraObjects, animateAura } from './aura.js';

// After (studio importing from shared):
import state from '../../js/state.js';
import { updateGeometry } from '../../js/geometry.js';
import { createAuraObjects, animateAura } from '../../js/aura.js';
```

Files that need import path fixes and which shared modules they reference:

- `studio/js/main.js`: state, geometry, colors, aura, phenomena, particles, interaction, pathing, ui, lightning, magnetic, omega, grid3d, swarm, skybox, skins, stats — shared imports get `../../js/` prefix, local studio imports stay `./`
- `studio/js/scene.js`: state, skybox — state gets `../../js/`, skybox stays `./`
- `studio/js/ui.js`: state, geometry, colors, pathing, presets, phenomena, swarm, skins, omega, grid3d, interaction, fx-registry — shared get `../../js/`, studio-local stay `./`
- `studio/js/interaction.js`: state, fx-registry — both `../../js/`
- `studio/js/pathing.js`: state — `../../js/`
- `studio/js/grid3d.js`: state — `../../js/`
- `studio/js/swarm.js`: state — `../../js/`
- `studio/js/skybox.js`: state — `../../js/`

- [ ] **Step 3: Fix HTML script paths and rename**

In `studio/index.html`:
- Change `<title>` from "Celestial" to "Avatar Studio"
- Update Three.js CDN path (keep as-is — it loads from CDN)
- Update CSS paths from `css/` to `css/` (already relative, should work)
- Update the module script tag: `<script type="module" src="js/main.js"></script>` (already correct)

- [ ] **Step 4: Add "Save to AOS" button to studio UI**

In `studio/js/ui.js`, find the existing save button handler (the one that downloads a JSON file) and add an alternative that writes to the IPC channel. For now, keep the download behavior and add a second button:

```javascript
// Add after the existing save handler in setupUI():
const saveAosBtn = document.getElementById('btn-save-aos');
if (saveAosBtn) {
    saveAosBtn.addEventListener('click', () => {
        const config = getConfig();
        const json = JSON.stringify(config, null, 2);
        // Post to parent window or IPC channel
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
            window.webkit.messageHandlers.headsup.postMessage({
                type: 'save_config',
                config: config
            });
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(json);
            console.log('Config copied to clipboard (no IPC available)');
        }
    });
}
```

Add the button in `studio/index.html` next to the existing save/load buttons:

```html
<button id="btn-save-aos" class="icon-btn" title="Save to Avatar">&#x1F4BE; Apply to Avatar</button>
```

- [ ] **Step 5: Verify studio loads in browser**

```bash
open apps/sigil/celestial/studio/index.html
```

Expected: The full celestial UI loads with the 3D object, controls, presets, and all effects working. This verifies all import paths are correct.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/celestial/studio/
git commit -m "feat(sigil): create avatar studio from celestial legacy UI"
```

---

### Task 3: Create Live Mode Renderer

Build the minimal transparent renderer for the desktop avatar. This is a stripped-down celestial with no UI, no skybox, no grid, transparent background, and an IPC listener for position/config messages.

**Files:**
- Create: `apps/sigil/celestial/live/index.html`
- Create: `apps/sigil/celestial/live/js/main.js`
- Create: `apps/sigil/celestial/live/js/scene.js`
- Create: `apps/sigil/celestial/live/js/pathing.js`

- [ ] **Step 1: Create `live/js/scene.js`**

Stripped-down scene: no skybox, transparent renderer, fixed camera.

```javascript
import state from '../../js/state.js';

export function initScene() {
    state.scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;

    state.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    state.perspCamera.position.z = 7.5;
    state.camera = state.perspCamera;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setClearColor(0x000000, 0);
    document.body.appendChild(state.renderer.domElement);

    // No skybox — transparent background

    state.polyGroup = new THREE.Group();
    state.scene.add(state.polyGroup);

    // Lighting
    state.pointLight = new THREE.PointLight(0xffffff, 1.5, 10);
    state.polyGroup.add(state.pointLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 5, 5);
    state.scene.add(dirLight);
    state.scene.add(new THREE.AmbientLight(0x444444));

    // Initialize THREE.Vector3 state fields
    state.quickSpinAxis = new THREE.Vector3();
    state.dragMomentumAxis = new THREE.Vector3();
    state.targetPosition = new THREE.Vector3(0, 0, 0);
    state.moveRotationAxis = new THREE.Vector3(0, 1, 0);

    window.addEventListener('resize', onWindowResize);
}

export function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    state.perspCamera.aspect = aspect;
    state.perspCamera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Coordinate mapping: screen pixels → scene units ---
// Returns the visible width/height of the scene at z=0 given the camera setup.
export function screenToScene(px, py) {
    const vFov = state.perspCamera.fov * Math.PI / 180;
    const dist = state.perspCamera.position.z; // camera distance from origin
    const visibleHeight = 2 * Math.tan(vFov / 2) * dist;
    const visibleWidth = visibleHeight * state.perspCamera.aspect;

    const sx = (px / window.innerWidth - 0.5) * visibleWidth;
    const sy = -(py / window.innerHeight - 0.5) * visibleHeight;
    return { x: sx, y: sy };
}
```

- [ ] **Step 2: Create `live/js/pathing.js`**

Movement driven by IPC messages instead of auto-path or mouse. Handles spin rotation (idle animation) but position is set externally.

```javascript
import state from '../../js/state.js';

const _spinAxis = new THREE.Vector3(0.5, 1.0, 0).normalize();

// Live mode: position is set externally via setScenePosition().
// This function only handles idle rotation.
export function animatePathing(dt) {
    if (state.isPaused) return;

    // Idle spin
    if (!state.isDestroyed) {
        let activeRotationSpeed = state.idleSpinSpeed;

        if (state.quickSpinActive) {
            let timeRemaining = state.quickSpinEndTime - performance.now();
            if (timeRemaining > 0) {
                let t = timeRemaining / 2000;
                activeRotationSpeed += state.quickSpinSpeed * t * t;
                state.polyGroup.rotateOnWorldAxis(state.quickSpinAxis, state.quickSpinSpeed * t * t);
            } else {
                state.quickSpinActive = false;
            }
        }

        state.polyGroup.rotateOnWorldAxis(_spinAxis, activeRotationSpeed);
    }

    state.polyGroup.quaternion.normalize();
}

// Called by IPC handler — sets polyGroup position in scene space
export function setScenePosition(sx, sy) {
    state.polyGroup.position.x = sx;
    state.polyGroup.position.y = sy;
}
```

- [ ] **Step 3: Create `live/js/main.js`**

Entry point for live mode. Initializes scene, creates objects, listens for IPC messages.

```javascript
import state from '../../js/state.js';
import { initScene, screenToScene } from './scene.js';
import { updateGeometry } from '../../js/geometry.js';
import { updateAllColors } from '../../js/colors.js';
import { createAuraObjects, animateAura } from '../../js/aura.js';
import { createPhenomena, animatePhenomena } from '../../js/phenomena.js';
import { createParticleObjects, animateParticles, animateTrails } from '../../js/particles.js';
import { animatePathing, setScenePosition } from './pathing.js';
import { createLightning, animateLightning } from '../../js/lightning.js';
import { createMagneticField, animateMagneticField } from '../../js/magnetic.js';
import { createOmega, animateOmega } from '../../js/omega.js';
import { animateSkins } from '../../js/skins.js';

function init() {
    initScene();
    createAuraObjects();
    createParticleObjects();
    createPhenomena();
    createLightning();
    createMagneticField();
    createOmega();

    updateGeometry(state.currentGeometryType);
    updateAllColors();

    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);

    // Set up IPC listener
    setupIPC();

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    const dt = 0.016;

    state.globalTime += dt;

    // Nova scale
    if (state.isDestroyed) {
        state.novaScale = 0.0;
    } else if (state.isRespawning) {
        state.respawnTimer += dt;
        let progress = Math.min(state.respawnTimer / 2.0, 1.0);
        let c4 = (2.0 * Math.PI) / 3;
        state.novaScale = progress === 0 ? 0 : progress === 1 ? 1 :
            Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;
        if (progress >= 1.0) state.isRespawning = false;
    } else {
        state.novaScale = 1.0;
    }

    animatePathing(dt);
    animateParticles(dt);
    animatePhenomena(dt);
    animateAura(dt);
    animateLightning(dt);
    animateMagneticField(dt);
    animateOmega(dt);
    animateSkins(dt);
    animateTrails(dt);

    state.polyGroup.scale.setScalar(state.z_depth * state.novaScale);

    state.renderer.render(state.scene, state.camera);
}

// --- IPC: receive messages from Swift via headsup.receive() ---
function setupIPC() {
    window.headsup = window.headsup || {};
    window.headsup.receive = function(b64) {
        try {
            const msg = JSON.parse(atob(b64));
            handleMessage(msg);
        } catch (e) {
            console.error('IPC parse error:', e);
        }
    };

    // Also support postMessage from WKWebView
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
        // Outbound: JS → Swift
        window.headsup.emit = function(type, payload) {
            window.webkit.messageHandlers.headsup.postMessage({ type, payload });
        };
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'scene_position': {
            const s = screenToScene(msg.position[0], msg.position[1]);
            setScenePosition(s.x, s.y);
            break;
        }

        case 'transit_start': {
            // Store canvas size for coordinate mapping (resize may have changed it)
            if (msg.canvasSize) {
                // Canvas size is used by screenToScene via window.innerWidth/Height
                // which auto-updates on resize. Nothing to store.
            }
            // Set initial position
            if (msg.position) {
                const s = screenToScene(msg.position[0], msg.position[1]);
                setScenePosition(s.x, s.y);
            }
            // Enable ghost trails for transit
            state.omegaInterDimensional = true;
            break;
        }

        case 'transit_end': {
            // Ghosts continue fading naturally
            // Report when all effects have settled
            _waitForEffectsSettled();
            break;
        }

        case 'config': {
            applyConfig(msg.data);
            break;
        }

        case 'show': {
            document.body.style.visibility = 'visible';
            break;
        }

        case 'hide': {
            document.body.style.visibility = 'hidden';
            break;
        }

        case 'behavior': {
            // Forward to behavior/preset system (e.g., fast_travel preset)
            if (msg.slot) {
                applyBehaviorPreset(msg.slot, msg.data || {});
            }
            break;
        }
    }
}

function applyConfig(config) {
    // Map config keys to state — mirrors setConfig() from celestial's ui.js
    if (config.shape !== undefined) { state.currentGeometryType = config.shape; updateGeometry(config.shape); }
    if (config.colors !== undefined) { state.colors = config.colors; updateAllColors(); }
    if (config.stellation !== undefined) { state.stellationFactor = config.stellation; updateGeometry(state.currentGeometryType); }
    if (config.opacity !== undefined) { state.currentOpacity = config.opacity; }
    if (config.edgeOpacity !== undefined) { state.currentEdgeOpacity = config.edgeOpacity; }
    if (config.mask !== undefined) { state.isMaskEnabled = config.mask; }
    if (config.interiorEdges !== undefined) { state.isInteriorEdgesEnabled = config.interiorEdges; }
    if (config.specular !== undefined) { state.isSpecularEnabled = config.specular; }
    if (config.skin !== undefined) { state.currentSkin = config.skin; }
    if (config.idleSpin !== undefined) { state.idleSpinSpeed = config.idleSpin; }
    if (config.aura !== undefined) { state.isAuraEnabled = config.aura; }
    if (config.auraReach !== undefined) { state.auraReach = config.auraReach; }
    if (config.auraIntensity !== undefined) { state.auraIntensity = config.auraIntensity; }
    if (config.pulseRate !== undefined) { state.auraPulseRate = config.pulseRate; }
    if (config.zDepth !== undefined) { state.z_depth = config.zDepth; }
    // Omega (ghost trail source)
    if (config.omega !== undefined) { state.isOmegaEnabled = config.omega; }
    if (config.omegaGhostCount !== undefined) { state.omegaGhostCount = config.omegaGhostCount; }
    if (config.omegaGhostMode !== undefined) { state.omegaGhostMode = config.omegaGhostMode; }
    if (config.omegaGhostDuration !== undefined) { state.omegaGhostDuration = config.omegaGhostDuration; }
    if (config.omegaInterDimensional !== undefined) { state.omegaInterDimensional = config.omegaInterDimensional; }
    if (config.omegaScale !== undefined) { state.omegaScale = config.omegaScale; }
    // Effects
    if (config.pulsar !== undefined) { state.isPulsarEnabled = config.pulsar; }
    if (config.accretion !== undefined) { state.isAccretionEnabled = config.accretion; }
    if (config.gamma !== undefined) { state.isGammaEnabled = config.gamma; }
    if (config.neutrinos !== undefined) { state.isNeutrinosEnabled = config.neutrinos; }
    if (config.lightning !== undefined) { state.isLightningEnabled = config.lightning; }
    if (config.magnetic !== undefined) { state.isMagneticEnabled = config.magnetic; }

    // Rebuild visuals
    updateGeometry(state.currentGeometryType);
    updateAllColors();
}

function applyBehaviorPreset(slot, data) {
    // Behavior presets control visual state during specific actions
    switch (slot) {
        case 'fast_travel':
            state.omegaInterDimensional = true;
            state.omegaGhostCount = 12;
            state.omegaGhostMode = 'edgeScatter';
            state.omegaGhostDuration = 1.5;
            state.idleSpinSpeed = 0.08;
            state.auraIntensity = 1.5;
            break;
        case 'standby':
        case 'idle':
            // Restore to config defaults (would need stored config reference)
            state.omegaInterDimensional = false;
            state.idleSpinSpeed = 0.01;
            state.auraIntensity = 1.0;
            break;
    }
}

function _waitForEffectsSettled() {
    // Poll until all ghosts are gone
    const check = setInterval(() => {
        if (state.omegaGhosts.length === 0) {
            clearInterval(check);
            if (window.headsup.emit) {
                window.headsup.emit('effects_settled', {});
            }
        }
    }, 100);
}

window.onload = init;
```

- [ ] **Step 4: Create `live/index.html`**

Minimal HTML — transparent, no UI.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
    }
    canvas { display: block; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Test live renderer in browser**

```bash
open apps/sigil/celestial/live/index.html
```

Expected: A spinning polyhedron with aura on a transparent background. No UI controls. The browser will show a white/checkered background behind the object. No errors in the console.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/celestial/live/
git commit -m "feat(sigil): create live mode renderer for full-screen avatar"
```

---

### Task 4: Update Swift — Full-Screen Canvas Creation

Replace the small-window avatar canvas with full-screen canvases. Update `avatar-sub.swift` to create one canvas per display at startup.

**Files:**
- Modify: `apps/sigil/avatar-sub.swift`
- Modify: `apps/sigil/avatar-ipc.swift`

- [ ] **Step 1: Add display geometry helpers to `avatar-spatial.swift`**

```swift
// -- All display frames in CG coordinates (top-left origin, Y-down) --
func getAllDisplaysCG() -> [(id: Int, x: Double, y: Double, w: Double, h: Double)] {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return NSScreen.screens.enumerated().map { (i, screen) in
        let f = screen.frame
        return (
            id: i,
            x: f.origin.x,
            y: primaryHeight - f.origin.y - f.height,
            w: f.width,
            h: f.height
        )
    }
}

// -- Which display contains a CG point? Returns display index or 0 (primary) --
func displayIndexForPoint(_ x: Double, _ y: Double) -> Int {
    let displays = getAllDisplaysCG()
    for d in displays {
        if x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h {
            return d.id
        }
    }
    return 0
}
```

- [ ] **Step 2: Add canvas ID helpers to `avatar-ipc.swift`**

```swift
// -- Canvas IDs for multi-display --
func avatarCanvasID(_ displayIndex: Int) -> String {
    displayIndex == 0 ? avatarID : "avatar-display-\(displayIndex)"
}

var activeDisplayIndex: Int = 0

// -- Send scene position to the active display's canvas --
func sendScenePosition(_ session: DaemonSession, x: Double, y: Double) {
    let msg: [String: Any] = ["type": "scene_position", "position": [x, y]]
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    session.sendOnly(["action": "eval", "id": avatarCanvasID(activeDisplayIndex), "js": "headsup.receive('\(b64)')"])
}

// -- Send a message to a specific display's canvas --
func sendToCanvas(_ displayIndex: Int, _ msg: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    daemonOneShot(["action": "eval", "id": avatarCanvasID(displayIndex), "js": "headsup.receive('\(b64)')"])
}

// -- Load avatar config from disk --
func loadAvatarConfig() -> [String: Any]? {
    let path = "\(aosStateDir())/avatar-config.json"
    guard let data = FileManager.default.contents(atPath: path),
          let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return config
}

// -- Save avatar config to disk --
func saveAvatarConfig(_ config: [String: Any]) {
    let path = "\(aosStateDir())/avatar-config.json"
    guard let data = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted) else { return }
    FileManager.default.createFile(atPath: path, contents: data)
}
```

- [ ] **Step 3: Update avatar creation in `avatar-sub.swift`**

Find the section where the avatar canvas is created (look for `sendOneShot` with `"action":"create"` and `avatarID`). Replace the single small canvas creation with full-screen canvas creation for all displays.

Replace the existing avatar canvas creation code with:

```swift
func createAvatarCanvases() {
    let displays = getAllDisplaysCG()
    let liveURL = sigilFileURL("apps/sigil/celestial/live/index.html")

    for display in displays {
        let canvasID = avatarCanvasID(display.id)
        let payload: [String: Any] = [
            "action": "create",
            "id": canvasID,
            "at": [display.x, display.y, display.w, display.h],
            "url": liveURL,
            "interactive": false
        ]
        _ = daemonOneShot(payload)
    }

    // Wait for WKWebViews to initialize
    Thread.sleep(forTimeInterval: 0.5)

    // Send config to all canvases
    if let config = loadAvatarConfig() {
        for display in displays {
            sendToCanvas(display.id, ["type": "config", "data": config])
        }
    }

    // Hide all except primary
    for display in displays where display.id != 0 {
        sendToCanvas(display.id, ["type": "hide"])
    }
    activeDisplayIndex = 0

    // Set initial position to cursor location
    let (cx, cy) = getCursorCG()
    curX = cx; curY = cy
    let session = DaemonSession()
    if session.connect() {
        sendScenePosition(session, x: curX, y: curY)
        session.disconnect()
    }
}
```

- [ ] **Step 4: Update the startup sequence**

In the main startup flow of `avatar-sub.swift`, replace the old canvas creation call with `createAvatarCanvases()`. Remove the old `sendOneShot` that created the small avatar canvas.

- [ ] **Step 5: Build and test**

```bash
cd apps/sigil && bash build-avatar.sh
```

Expected: Compiles without errors. Don't run yet — animation layer still sends window-position updates.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/avatar-sub.swift apps/sigil/avatar-ipc.swift apps/sigil/avatar-spatial.swift
git commit -m "feat(sigil): full-screen canvas creation per display"
```

---

### Task 5: Update Swift — Scene-Position Animation

Replace `sendAvatarUpdate()` (window-position) with `sendScenePosition()` (scene-position IPC). Update `moveTo()` and all animation primitives.

**Files:**
- Modify: `apps/sigil/avatar-animate.swift`
- Modify: `apps/sigil/avatar-behaviors.swift`

- [ ] **Step 1: Replace `sendAvatarUpdate()` in `avatar-animate.swift`**

The canvases are now full-screen and static. Animation sends scene-position messages instead of canvas-position updates. Replace `sendAvatarUpdate`:

```swift
/// Send scene-position update to the active display's live renderer.
/// Uses sendOnly for zero-latency writes in 60fps animation loops.
func sendAvatarUpdate(_ session: DaemonSession) {
    sendScenePosition(session, x: curX, y: curY)
}
```

This is a drop-in replacement — all existing `sendAvatarUpdate(session)` calls in `moveTo()`, `scaleTo()`, `moveAndScale()`, `orbit()`, `holdPosition()` continue to work, but now send scene-position messages instead of window-position updates.

- [ ] **Step 2: Remove size animation from `sendAvatarUpdate`**

Since the canvas is always full-screen, `curSize` is no longer used for canvas sizing. The avatar's visual size is controlled by `z_depth` in the Three.js scene. Remove `curSize` from the animation update path.

Keep `curSize` as a variable for now (behaviors reference it for hit testing), but it no longer affects the canvas.

- [ ] **Step 3: Add display handoff to `moveTo()`**

When the avatar moves across display boundaries, switch the active canvas:

```swift
func checkDisplayHandoff() {
    let newDisplay = displayIndexForPoint(curX, curY)
    if newDisplay != activeDisplayIndex {
        // Send transit_end to old canvas (ghosts fade independently)
        sendToCanvas(activeDisplayIndex, ["type": "transit_end"])
        // Hide old, show new
        sendToCanvas(activeDisplayIndex, ["type": "hide"])
        sendToCanvas(newDisplay, ["type": "show"])
        // Send transit_start to new canvas
        sendToCanvas(newDisplay, ["type": "transit_start", "position": [curX, curY]])
        activeDisplayIndex = newDisplay
    }
}
```

Add `checkDisplayHandoff()` call inside `moveTo()`'s animation body, after updating `curX`/`curY`:

```swift
func moveTo(x: Double, y: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.drainResponses(); session.disconnect() }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        checkDisplayHandoff()
        sendAvatarUpdate(session)
        return true
    }
}
```

Apply the same `checkDisplayHandoff()` call to `holdPosition()`, `moveAndScale()`, and `orbit()`.

- [ ] **Step 4: Update `behaviorFastTravel()` to send transit signals**

```swift
func behaviorFastTravel(toX: Double, toY: Double, mid: UInt64) {
    // Signal transit start to JS (enables ghost trails)
    sendToCanvas(activeDisplayIndex, [
        "type": "transit_start",
        "position": [curX, curY]
    ])

    sendBehavior("fast_travel", data: [
        "from": [curX, curY], "to": [toX, toY]
    ])

    let dist = sqrt(pow(toX - curX, 2) + pow(toY - curY, 2))
    let duration = max(0.12, min(0.3, dist / 5000))

    moveTo(x: toX, y: toY, duration: duration, easing: easeOutQuart, mid: mid)

    // Signal transit end — ghosts fade, JS reports effects_settled
    sendToCanvas(activeDisplayIndex, ["type": "transit_end"])

    sendBehavior("standby", data: ["near": [toX, toY]])
}
```

- [ ] **Step 5: Build**

```bash
cd apps/sigil && bash build-avatar.sh
```

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/avatar-animate.swift apps/sigil/avatar-behaviors.swift
git commit -m "feat(sigil): scene-position animation with display handoff"
```

---

### Task 6: Integration Test — Ghost Trails on Full-Screen Canvas

End-to-end test: start the daemon, start avatar-sub, trigger fast-travel, observe ghost trails rendering across screen space.

**Files:** None (testing only)

- [ ] **Step 1: Start the daemon**

```bash
./aos serve &
```

- [ ] **Step 2: Start avatar-sub**

```bash
apps/sigil/build/avatar-sub
```

Expected: Full-screen transparent canvas appears on each display. Avatar (default polyhedron) visible at cursor position.

- [ ] **Step 3: Trigger fast-travel**

Use the existing agent_helpers channel to send a fast-travel event:

```bash
./aos pub actions '{"type":"before","action":"fast_travel","to":[960,600]}'
```

Expected: Avatar moves to (960, 600) with ghost trails visible along the travel path. Ghosts should spawn at positions the avatar passed through and fade out over ~1.5 seconds with edgeScatter effect.

- [ ] **Step 4: Test multi-display (if available)**

Send fast-travel to a position on a secondary display:

```bash
./aos pub actions '{"type":"before","action":"fast_travel","to":[2500,600]}'
```

Expected: Avatar travels to the second display. Ghost trails fade on the origin display. Avatar appears on the destination display.

- [ ] **Step 5: Test cursor passthrough**

While the avatar is visible, hover over text fields and links in apps underneath. Verify cursor changes to ibeam/pointer as expected.

- [ ] **Step 6: Document results and commit any fixes**

```bash
git add -A
git commit -m "fix(sigil): integration test fixes for full-screen avatar"
```

---

### Task 7: Update Documentation

**Files:**
- Modify: `apps/sigil/CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md architecture table**

Replace the avatar.html entry and add new entries:

```markdown
| File | Role |
|------|------|
| `avatar-sub.swift` | Entry point, state machine, runtime input bridge, event dispatch, reconnection |
| `avatar-behaviors.swift` | Choreographer — maps channel events to animation sequences |
| `avatar-animate.swift` | Animation primitives (moveTo, scaleTo, orbit, holdPosition) — sends scene-position updates |
| `avatar-spatial.swift` | Spatial helpers (display geometry, element resolution, display handoff) |
| `avatar-easing.swift` | Easing functions |
| `avatar-ipc.swift` | Socket/IPC helpers for daemon communication + scene-position messaging |
| `celestial/js/` | Shared Three.js modules (geometry, colors, aura, effects, ghost trails) |
| `celestial/live/` | Live avatar renderer — full-screen transparent canvas, IPC-driven |
| `celestial/studio/` | Avatar Studio — customization UI (celestial legacy with Sigil integration) |
| `avatar.html` | **Deprecated** — replaced by `celestial/live/index.html` |
| `radial-menu-config.json` | Menu items (geometry, name, color, action) — deferred, to be reimplemented |
```

- [ ] **Step 2: Add canvas model section**

```markdown
## Canvas Model

The avatar runs on full-screen transparent canvases (`ignoresMouseEvents = true`), one per display. The avatar moves in Three.js scene space — the window never moves. This enables ghost trails, explosions, and effects that span the full screen.

- **Live mode**: `celestial/live/index.html` — stripped renderer, IPC-driven position
- **Studio mode**: `celestial/studio/index.html` — full customization UI
- **Config**: `~/.config/aos/{mode}/avatar-config.json` — saved from Studio, loaded by Live

Multi-display: canvases on all displays at launch. Avatar hands off between displays when crossing boundaries.
```

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/CLAUDE.md
git commit -m "docs(sigil): update architecture for celestial graft"
```

---

## Summary

| Task | What it does | Key files |
|------|-------------|-----------|
| 1 | Copy shared celestial JS modules | `celestial/js/*` |
| 2 | Create studio mode (full celestial UI) | `celestial/studio/*` |
| 3 | Create live mode (transparent renderer + IPC) | `celestial/live/*` |
| 4 | Full-screen canvas creation per display | `avatar-sub.swift`, `avatar-ipc.swift`, `avatar-spatial.swift` |
| 5 | Scene-position animation + display handoff | `avatar-animate.swift`, `avatar-behaviors.swift` |
| 6 | Integration test | Manual testing |
| 7 | Documentation update | `CLAUDE.md` |
