import state from '../../renderer/state.js';
import { EFFECTS } from '../../renderer/fx-registry.js';

// Camera orbit state (used when 3D grid is active)
let cameraOrbitTheta = 0;       // horizontal angle
let cameraOrbitPhi = Math.PI / 4; // vertical angle (start at 45°)
let cameraOrbitRadius = 7.5;    // initial camera distance
let cameraOrbitInitialized = false;

// Camera transition state (smooth reorientation on mode switch)
let _camTransition = null;

export function resetCameraOrbit() {
    cameraOrbitInitialized = false;
}

/** Start a smooth camera transition to the head-on flat view */
export function transitionToFlatView() {
    if (!cameraOrbitInitialized) initCameraOrbit();
    let theta = cameraOrbitTheta % (2 * Math.PI);
    if (theta > Math.PI) theta -= 2 * Math.PI;
    if (theta < -Math.PI) theta += 2 * Math.PI;
    const targetRadius = Math.max(2, Math.min(50, cameraOrbitRadius));
    _camTransition = {
        startTheta: theta,
        startPhi: cameraOrbitPhi,
        startRadius: cameraOrbitRadius,
        targetTheta: 0,
        targetPhi: Math.PI / 2,
        targetRadius: targetRadius,
        progress: 0
    };
}

/** Advance the camera transition each frame */
export function updateCameraTransition(dt) {
    if (!_camTransition) return false;
    const speed = 3.0;
    _camTransition.progress = Math.min(1, _camTransition.progress + dt * speed);
    const t = 1 - Math.pow(1 - _camTransition.progress, 3);

    const theta = _camTransition.startTheta + (_camTransition.targetTheta - _camTransition.startTheta) * t;
    const phi = _camTransition.startPhi + (_camTransition.targetPhi - _camTransition.startPhi) * t;
    const radius = _camTransition.startRadius + (_camTransition.targetRadius - _camTransition.startRadius) * t;

    cameraOrbitTheta = theta;
    cameraOrbitPhi = phi;
    cameraOrbitRadius = radius;

    state.camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
    );
    state.camera.lookAt(0, 0, 0);

    if (_camTransition.progress >= 1) {
        state.perspCamera.position.set(0, 0, radius);
        state.perspCamera.lookAt(0, 0, 0);
        cameraOrbitTheta = 0;
        cameraOrbitPhi = Math.PI / 2;
        _camTransition = null;
        return false;
    }
    return true;
}

function initCameraOrbit() {
    const pos = state.camera.position;
    cameraOrbitRadius = pos.length();
    cameraOrbitTheta = Math.atan2(pos.x, pos.z);
    cameraOrbitPhi = Math.acos(Math.min(1, Math.max(-1, pos.y / cameraOrbitRadius)));
    cameraOrbitInitialized = true;
}

function handleMove(clientX, clientY) {
    const mouse = new THREE.Vector2(
        (clientX / window.innerWidth) * 2 - 1,
        -(clientY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, state.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const pos = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, pos)) {
        const travelVector = new THREE.Vector3().subVectors(pos, state.polyGroup.position);
        if (travelVector.length() > 0.1) {
            state.moveRotationAxis.crossVectors(travelVector, new THREE.Vector3(0, 0, 1)).normalize();
            state.moveRotationSpeed = Math.min(travelVector.length() * 0.15, 0.4);
        }
        state.targetPosition.copy(pos);
    }
}

// ── Card-based navigation (whole-card push/pop with compounding transforms) ──
// The root menu and all sub-menus are sibling cards inside .ctx-anchor.
// When a sub opens, the entire root card (tabs + title + controls) scales down
// and slides up; deeper nesting compounds: scale(0.9^depth), translateY(-10%*depth).

let _menuStack = [];   // stack of pushed card IDs (deepest first)

function _clearInlineStyles(card) {
    card.style.transform = '';
    card.style.opacity = '';
    card.style.zIndex = '';
    card.style.filter = '';
}

function _resetMenuStack() {
    const anchor = document.getElementById('ctx-unified');
    if (!anchor) return;
    // Hide all subs, clear pushed state
    anchor.querySelectorAll('.ctx-menu-card.pushed').forEach(c => {
        c.classList.remove('pushed');
        _clearInlineStyles(c);
        if (c.classList.contains('ctx-sub')) {
            c.classList.remove('active');
        }
    });
    anchor.querySelectorAll('.ctx-sub.active').forEach(c => {
        c.classList.remove('active');
        _clearInlineStyles(c);
    });
    // Restore root
    const root = document.getElementById('ctx-root');
    if (root) {
        root.classList.add('active');
        root.classList.remove('pushed');
        _clearInlineStyles(root);
    }
    _menuStack = [];
}

function _applyStackTransforms() {
    const n = _menuStack.length;
    // _menuStack[0] is deepest (first pushed), _menuStack[last] is most recent
    _menuStack.forEach((id, i) => {
        const card = document.getElementById(id);
        if (!card) return;
        const depth = n - i;   // most recent pushed = depth 1
        const s = Math.pow(0.9, depth);
        const ty = -20 * depth;
        card.style.transform = `scale(${s}) translateY(${ty}%)`;
        card.style.opacity = Math.max(0.2, 0.55 - (depth - 1) * 0.15);
        card.style.zIndex = 10 - depth;
        card.style.filter = `brightness(${Math.max(0.35, 0.7 - (depth - 1) * 0.15)})`;
    });
    // Active card on top
    const anchor = document.getElementById('ctx-unified');
    const active = anchor.querySelector('.ctx-menu-card.active:not(.pushed)');
    if (active) active.style.zIndex = 10 + n;
}

export function _openSub(subId) {
    const anchor = document.getElementById('ctx-unified');
    const sub = document.getElementById(subId);
    if (!anchor || !sub) return;

    // Push the current active card
    const current = anchor.querySelector('.ctx-menu-card.active:not(.pushed)');
    if (current) {
        current.classList.remove('active');
        current.classList.add('pushed');
        _menuStack.push(current.id);
    }

    sub.classList.add('active');
    _applyStackTransforms();
}

function _popTo(cardId) {
    const anchor = document.getElementById('ctx-unified');
    if (!anchor) return;

    // Hide the currently active card
    const active = anchor.querySelector('.ctx-menu-card.active:not(.pushed)');
    if (active && active.id !== cardId) {
        active.classList.remove('active');
        _clearInlineStyles(active);
    }

    // Pop stack until we reach cardId
    while (_menuStack.length > 0) {
        const topId = _menuStack[_menuStack.length - 1];
        if (topId === cardId) {
            _menuStack.pop();
            break;
        }
        const poppedId = _menuStack.pop();
        const popped = document.getElementById(poppedId);
        if (popped) {
            popped.classList.remove('pushed');
            _clearInlineStyles(popped);
            if (popped.classList.contains('ctx-sub')) {
                popped.classList.remove('active');
            }
        }
    }

    // Restore the target card
    const target = document.getElementById(cardId);
    if (target) {
        target.classList.remove('pushed');
        target.classList.add('active');
        _clearInlineStyles(target);
    }
    _applyStackTransforms();
}

// ── Sync sidebar → context menu ──────────────────────────────────────────────
function _syncContextMenu() {
    const s = (ctxId, srcId) => {
        const ctx = document.getElementById(ctxId);
        const src = document.getElementById(srcId);
        if (!ctx || !src) return;
        if (ctx.type === 'checkbox') ctx.checked = src.checked;
        else ctx.value = src.value;
    };

    // Shape tab
    s('ctx-shape', 'shapeSelect');
    s('ctx-color', 'masterColor1');
    s('ctx-opacity', 'opacitySlider');
    s('ctx-edge-opacity', 'edgeOpacitySlider');
    s('ctx-stellation', 'stellationSlider');
    s('ctx-tet-a', 'tetASlider');
    s('ctx-tet-b', 'tetBSlider');
    s('ctx-tet-c', 'tetCSlider');
    const ctxTetSettings = document.getElementById('ctx-tetartoid-settings');
    if (ctxTetSettings) {
        const isTet = parseInt(document.getElementById('shapeSelect')?.value) === 90;
        ctxTetSettings.style.display = isTet ? '' : 'none';
    }
    s('ctx-mask', 'maskToggle');
    s('ctx-interior', 'interiorEdgesToggle');
    s('ctx-specular', 'specularToggle');
    s('ctx-omega-toggle', 'omegaToggle');
    s('ctx-omega-shape', 'omegaShapeSelect');
    s('ctx-omega-scale', 'omegaScaleSlider');
    s('ctx-omega-stellation', 'omegaStellationSlider');
    s('ctx-omega-opacity', 'omegaOpacitySlider');
    s('ctx-omega-edge-opacity', 'omegaEdgeOpacitySlider');
    s('ctx-omega-mask', 'omegaMaskToggle');
    s('ctx-omega-interior', 'omegaInteriorEdgesToggle');
    s('ctx-omega-specular', 'omegaSpecularToggle');
    s('ctx-omega-counterspin', 'omegaCounterSpin');
    s('ctx-omega-lock', 'omegaLockPosition');
    s('ctx-omega-interdim', 'omegaInterDimensional');
    s('ctx-omega-tet-a', 'tetASlider');
    s('ctx-omega-tet-b', 'tetBSlider');
    s('ctx-omega-tet-c', 'tetCSlider');
    const ctxOmegaTetSettings = document.getElementById('ctx-omega-tetartoid-settings');
    if (ctxOmegaTetSettings) {
        const isTet = parseInt(document.getElementById('omegaShapeSelect')?.value) === 90;
        ctxOmegaTetSettings.style.display = isTet ? '' : 'none';
    }

    // Look tab
    s('ctx-master1', 'masterColor1');
    s('ctx-master2', 'masterColor2');
    s('ctx-preset', 'presetSelect');
    s('ctx-face1', 'faceColor1');
    s('ctx-face2', 'faceColor2');
    s('ctx-edge1', 'edgeColor1');
    s('ctx-edge2', 'edgeColor2');
    s('ctx-aura1', 'auraColor1');
    s('ctx-aura2', 'auraColor2');
    s('ctx-omega-face1', 'omegaFaceColor1');
    s('ctx-omega-face2', 'omegaFaceColor2');
    s('ctx-omega-edge1', 'omegaEdgeColor1');
    s('ctx-omega-edge2', 'omegaEdgeColor2');
    s('ctx-pulsar-c1', 'pulsarColor1');
    s('ctx-pulsar-c2', 'pulsarColor2');
    s('ctx-accretion-c1', 'accretionColor1');
    s('ctx-accretion-c2', 'accretionColor2');
    s('ctx-gamma-c1', 'gammaColor1');
    s('ctx-gamma-c2', 'gammaColor2');
    s('ctx-neutrino-c1', 'neutrinoColor1');
    s('ctx-neutrino-c2', 'neutrinoColor2');
    s('ctx-lightning-c1', 'lightningColor1');
    s('ctx-lightning-c2', 'lightningColor2');
    s('ctx-magnetic-c1', 'magneticColor1');
    s('ctx-magnetic-c2', 'magneticColor2');
    s('ctx-swarm-fc1', 'swarmColor1');
    s('ctx-swarm-fc2', 'swarmColor2');
    s('ctx-grid-c1', 'gridColor1');
    s('ctx-grid-c2', 'gridColor2');

    // FX tab — sync tile active states
    EFFECTS.forEach(fx => {
        const tile = document.querySelector(`[data-effect="${fx.id}"]`);
        const src = document.getElementById(fx.sidebarId);
        if (tile && src) tile.classList.toggle('active', src.checked);
    });
    s('ctx-reach', 'auraReachSlider');
    s('ctx-intensity', 'auraIntensitySlider');
    s('ctx-spin', 'idleSpinSlider');
    s('ctx-swarm-count', 'swarmCountSlider');
    s('ctx-swarm-gravity', 'swarmGravitySlider');
    s('ctx-swarm-horizon', 'swarmHorizonSlider');
    s('ctx-swarm-time', 'swarmTimeSlider');
    s('ctx-swarm-c1', 'swarmColor1');
    s('ctx-swarm-c2', 'swarmColor2');
    s('ctx-lightning-center', 'lightningOriginCenter');
    s('ctx-lightning-solid', 'lightningSolidBlock');
    s('ctx-lightning-length', 'lightningLengthSlider');
    s('ctx-lightning-freq', 'lightningFreqSlider');
    s('ctx-lightning-dur', 'lightningDurSlider');
    s('ctx-lightning-branch', 'lightningBranchSlider');
    s('ctx-lightning-bright', 'lightningBrightSlider');
    s('ctx-magnetic-count', 'magneticCountSlider');
    s('ctx-magnetic-speed', 'magneticSpeedSlider');
    s('ctx-magnetic-wander', 'magneticWanderSlider');
    s('ctx-pulse-rate', 'pulseRateSlider');
    s('ctx-spike-mult', 'spikeMultiplier');
    s('ctx-path-toggle', 'pathToggle');
    s('ctx-path-centered', 'centeredViewToggle');
    s('ctx-path-type', 'pathTypeSelect');
    s('ctx-path-speed', 'speedSlider');
    s('ctx-show-path', 'showPathToggle');
    s('ctx-trail-toggle', 'trailToggle');
    s('ctx-trail-length', 'trailLengthSlider');
    // Pulsar sub-menu sync
    s('ctx-pulsar-count', 'pulsarCount');
    s('ctx-pulsar-turb', 'pTurbSlider');
    s('ctx-pulsar-turb-spd', 'pTurbSpdSlider');
    s('ctx-pulsar-phase', 'pTurbMod');

    // Accretion sub-menu sync
    s('ctx-accretion-count', 'accretionCount');
    s('ctx-accretion-turb', 'aTurbSlider');
    s('ctx-accretion-turb-spd', 'aTurbSpdSlider');
    s('ctx-accretion-phase', 'aTurbMod');

    // Gamma sub-menu sync
    s('ctx-gamma-count', 'gammaCount');
    s('ctx-gamma-turb', 'gTurbSlider');
    s('ctx-gamma-turb-spd', 'gTurbSpdSlider');
    s('ctx-gamma-phase', 'gTurbMod');

    // Neutrino sub-menu sync
    s('ctx-neutrino-count', 'neutrinoCount');
    s('ctx-neutrino-turb', 'nTurbSlider');
    s('ctx-neutrino-turb-spd', 'nTurbSpdSlider');
    s('ctx-neutrino-phase', 'nTurbMod');

    // World tab
    s('ctx-grid-mode', 'gridModeSelect');
    s('ctx-grid3d-mode', 'grid3dRenderMode');
    s('ctx-grid3d-density', 'grid3dDensitySlider');
    s('ctx-grid3d-radius', 'grid3dRadiusSlider');
    s('ctx-grid3d-gravity', 'grid3dGravitySlider');
    s('ctx-grid3d-time', 'grid3dTimeSlider');
    s('ctx-grid3d-snowglobe', 'grid3dSnowGlobeToggle');
    s('ctx-grid3d-probe', 'grid3dProbeToggle');
    s('ctx-grid3d-relative', 'grid3dRelativeToggle');
    s('ctx-ortho', 'orthoToggle');
    s('ctx-fov', 'fovSlider');
    s('ctx-zdepth', 'zDepthSlider');
}

// ── Helper: update sidebar slider display value ──────────────────────────────
function _syncSliderUI(sliderId, valId, isFloat) {
    const el = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (el && valEl) valEl.innerText = isFloat ? parseFloat(el.value).toFixed(2) : el.value;
}

// ═══════════════════════════════════════════════════════════════════════════════
export function setupInteraction() {
    // Prevent default context menu
    window.addEventListener('contextmenu', e => e.preventDefault());

    // ── Tab switching (scoped to #ctx-root, resets stack on tab change) ──
    const root = document.getElementById('ctx-root');
    if (root) {
        root.querySelectorAll('.ctx-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Reset menu stack first (close any open subs)
                _resetMenuStack();
                root.querySelectorAll('.ctx-tab').forEach(t => t.classList.remove('active'));
                root.querySelectorAll('.ctx-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = document.getElementById(tab.getAttribute('data-ctx-tab'));
                if (panel) panel.classList.add('active');
            });
        });
    }

    // ── Sub-menu triggers (card push) ────────────────────────────────────
    document.querySelectorAll('.ctx-trigger[data-ctx-open]').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const subId = trigger.getAttribute('data-ctx-open');
            _openSub(subId);
        });
    });

    // ── Pushed card click (pop back) ─────────────────────────────────────
    document.querySelectorAll('.ctx-menu-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (card.classList.contains('pushed')) {
                e.stopPropagation();
                _popTo(card.id);
            }
        });
    });

    // ── Context-menu action buttons ──────────────────────────────────────
    const _click = (id, sidebarId) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            const btn = document.getElementById(sidebarId);
            if (btn) btn.click();
        });
    };
    _click('ctx-btn-randomize', 'btn-randomize');
    _click('ctx-btn-snapshot', 'btn-snapshot');
    _click('ctx-btn-share', 'btn-share');
    _click('ctx-btn-save', 'btn-save');
    _click('ctx-btn-load', 'btn-load');
    _click('ctx-btn-spike', 'btn-spike');
    _click('ctx-btn-supercharge', 'btn-supercharge');
    _click('ctx-btn-quickspin', 'btn-quick-spin');

    // ── Close context menu on click outside or Escape ────────────────────
    window.addEventListener('mousedown', (e) => {
        const anchor = document.getElementById('ctx-unified');
        if (anchor && anchor.classList.contains('visible') && !anchor.contains(e.target) && e.button !== 2) {
            anchor.classList.remove('visible');
            state.isMenuOpen = false;
        }
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const anchor = document.getElementById('ctx-unified');
            if (anchor) {
                // If a sub-menu is open, pop back instead of closing
                if (_menuStack.length > 0) {
                    const parentId = _menuStack[_menuStack.length - 1];
                    _popTo(parentId);
                    return;
                }
                anchor.classList.remove('visible');
            }
            state.isMenuOpen = false;
        }
    });

    // ── Draggable context menu via tab bar ──
    (function() {
        const tabs = document.querySelector('#ctx-root .ctx-tabs');
        const anchor = document.getElementById('ctx-unified');
        if (!tabs || !anchor) return;

        let isDragging = false;
        let startX, startY, origLeft, origTop;

        tabs.addEventListener('mousedown', (e) => {
            // Only drag on the tab bar background, not on tab buttons themselves
            if (e.target.closest('.ctx-tab')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            origLeft = parseInt(anchor.style.left) || 0;
            origTop = parseInt(anchor.style.top) || 0;
            tabs.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            anchor.style.left = (origLeft + dx) + 'px';
            anchor.style.top = (origTop + dy) + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            tabs.style.cursor = '';
        });
    })();

    // ── Mouse Wheel — modifier-key functions ─────────────────────────────
    // Plain scroll   = Zoom (camera z / orbit radius)
    // SHIFT          = Z-Depth Scale (resize object)
    // CTRL           = FOV (perspective distortion)
    // SHIFT+CTRL     = Spin Speed
    window.addEventListener('wheel', (e) => {
        if (e.target.closest('#sidebar') || e.target.closest('.ctx-anchor')) return;
        e.preventDefault();
        const delta = e.deltaY;

        // ── SHIFT + CTRL: Spin Speed ──
        if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
            state.idleSpinSpeed = Math.max(0, Math.min(0.1, state.idleSpinSpeed - delta * 0.00005));
            const sl = document.getElementById('idleSpinSlider');
            const val = document.getElementById('idleSpinVal');
            if (sl) sl.value = state.idleSpinSpeed;
            if (val) val.innerText = state.idleSpinSpeed.toFixed(3);
            return;
        }

        // ── CTRL: FOV ──
        if (e.ctrlKey || e.metaKey) {
            if (state.camera.isPerspectiveCamera) {
                state.perspCamera.fov = Math.max(10, Math.min(120, state.perspCamera.fov + delta * 0.05));
                state.perspCamera.updateProjectionMatrix();
                const sl = document.getElementById('fovSlider');
                const val = document.getElementById('fovVal');
                if (sl) sl.value = state.perspCamera.fov;
                if (val) val.innerText = Math.round(state.perspCamera.fov);
            }
            return;
        }

        // ── SHIFT: Z-Depth ──
        if (e.shiftKey) {
            state.z_depth = Math.max(0.25, Math.min(3.0, state.z_depth - delta * 0.002));
            const sl = document.getElementById('zDepthSlider');
            const val = document.getElementById('zDepthVal');
            if (sl) sl.value = state.z_depth;
            if (val) val.innerText = state.z_depth.toFixed(2);
            return;
        }

        // ── Plain scroll: Zoom ──
        if (state.gridMode === '3d') {
            if (!cameraOrbitInitialized) initCameraOrbit();
            cameraOrbitRadius = Math.max(3, Math.min(80, cameraOrbitRadius + delta * 0.02));
            state.camera.position.set(
                cameraOrbitRadius * Math.sin(cameraOrbitPhi) * Math.sin(cameraOrbitTheta),
                cameraOrbitRadius * Math.cos(cameraOrbitPhi),
                cameraOrbitRadius * Math.sin(cameraOrbitPhi) * Math.cos(cameraOrbitTheta)
            );
            state.camera.lookAt(0, 0, 0);
        } else if (state.camera.isPerspectiveCamera) {
            state.perspCamera.position.z = Math.max(2, Math.min(50, state.perspCamera.position.z + delta * 0.01));
        } else {
            state.orthoCamera.zoom = Math.max(0.1, Math.min(10, state.orthoCamera.zoom - delta * 0.005));
            state.orthoCamera.updateProjectionMatrix();
        }
    }, { passive: false });

    // ── Mouse Down ───────────────────────────────────────────────────────
    window.addEventListener('mousedown', (e) => {
        const isUI = e.target.closest('#sidebar') || e.target.closest('.ctx-anchor');
        if (isUI) return;

        const anchor = document.getElementById('ctx-unified');
        if (anchor) anchor.classList.remove('visible');
        state.isMenuOpen = false;

        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, state.camera);

        let intersects = false;
        if (!state.isDestroyed) {
            if (state.coreMesh && state.coreMesh.visible && raycaster.intersectObject(state.coreMesh).length > 0) intersects = true;
            else if (state.depthMesh && state.depthMesh.visible && raycaster.intersectObject(state.depthMesh).length > 0) intersects = true;
            else {
                raycaster.params.Line.threshold = 0.2;
                if (state.wireframeMesh && raycaster.intersectObject(state.wireframeMesh).length > 0) intersects = true;
            }
        }

        if (e.button === 2) {
            state.isMenuOpen = true;
            const ctxAnchor = document.getElementById('ctx-unified');
            if (!ctxAnchor) return;

            ctxAnchor.classList.remove('visible');

            // Reset menu stack (close any open subs, restore root)
            _resetMenuStack();

            // Select the correct tab based on click target
            const ctxRoot = document.getElementById('ctx-root');
            const targetTab = intersects ? 'ctx-geom' : 'ctx-environ';
            if (ctxRoot) {
                ctxRoot.querySelectorAll('.ctx-tab').forEach(t => t.classList.remove('active'));
                ctxRoot.querySelectorAll('.ctx-panel').forEach(p => p.classList.remove('active'));
                const tab = ctxRoot.querySelector(`[data-ctx-tab="${targetTab}"]`);
                const panel = document.getElementById(targetTab);
                if (tab) tab.classList.add('active');
                if (panel) panel.classList.add('active');
            }

            // Sync ALL context menu values from sidebar
            _syncContextMenu();

            // Position the anchor at click coords
            ctxAnchor.style.left = e.clientX + 'px';
            ctxAnchor.style.top = e.clientY + 'px';
            ctxAnchor.classList.add('visible');

            setTimeout(() => {
                const rect = ctxAnchor.getBoundingClientRect();
                if (rect.right > window.innerWidth) ctxAnchor.style.left = (window.innerWidth - rect.width - 10) + 'px';
                if (rect.bottom > window.innerHeight) ctxAnchor.style.top = (window.innerHeight - rect.height - 10) + 'px';
            }, 0);

        } else if (e.button === 0) {
            if (state.gridMode === '3d') {
                state.isDraggingObject = true;
                state.previousMouse.x = e.clientX;
                state.previousMouse.y = e.clientY;
            } else if (e.shiftKey) {
                if (intersects) {
                    state.isPanningObject = true;
                } else {
                    state.isPanningCamera = true;
                }
                state.previousMouse.x = e.clientX;
                state.previousMouse.y = e.clientY;
            } else {
                if (intersects) {
                    state.isDraggingObject = true;
                    state.previousMouse.x = e.clientX;
                    state.previousMouse.y = e.clientY;
                    state.lastMoveTime = performance.now();
                    state.dragVelocity = { x: 0, y: 0 };
                    state.dragMomentumSpeed = 0;
                } else if (!state.isPathEnabled && !state.isDestroyed) {
                    handleMove(e.clientX, e.clientY);
                }
            }
        }
    });

    // ── Mouse Move ───────────────────────────────────────────────────────
    window.addEventListener('mousemove', (e) => {
        let dx = e.clientX - state.previousMouse.x;
        let dy = e.clientY - state.previousMouse.y;

        if (state.isPanningCamera) {
            let panSpeed = state.camera.isPerspectiveCamera
                ? (state.camera.position.z * 0.0015)
                : (1.0 / (state.orthoCamera.zoom * 20.0));
            state.camera.position.x -= dx * panSpeed;
            state.camera.position.y += dy * panSpeed;
            if (!state.isCenteredView) {
                state.targetPosition.x -= dx * panSpeed;
                state.targetPosition.y += dy * panSpeed;
            }
            state.previousMouse.x = e.clientX;
            state.previousMouse.y = e.clientY;
        } else if (state.isPanningObject && !state.isDestroyed) {
            let panSpeed = state.camera.isPerspectiveCamera
                ? (state.camera.position.z * 0.0015)
                : (1.0 / (state.orthoCamera.zoom * 20.0));
            state.polyGroup.position.x += dx * panSpeed;
            state.polyGroup.position.y -= dy * panSpeed;
            state.targetPosition.copy(state.polyGroup.position);
            state.previousMouse.x = e.clientX;
            state.previousMouse.y = e.clientY;
        } else if (state.isDraggingObject && state.gridMode === '3d') {
            if (!cameraOrbitInitialized) initCameraOrbit();
            cameraOrbitTheta -= dx * 0.005;
            cameraOrbitPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraOrbitPhi + dy * 0.005));

            state.camera.position.set(
                cameraOrbitRadius * Math.sin(cameraOrbitPhi) * Math.sin(cameraOrbitTheta),
                cameraOrbitRadius * Math.cos(cameraOrbitPhi),
                cameraOrbitRadius * Math.sin(cameraOrbitPhi) * Math.cos(cameraOrbitTheta)
            );
            state.camera.lookAt(0, 0, 0);

            state.previousMouse.x = e.clientX;
            state.previousMouse.y = e.clientY;
        } else if (state.isDraggingObject && !state.isDestroyed) {
            let currentTime = performance.now();
            let dt = currentTime - state.lastMoveTime;

            if (dt > 0) {
                state.dragVelocity.x = (state.dragVelocity.x * 0.5) + ((dx / dt) * 0.5);
                state.dragVelocity.y = (state.dragVelocity.y * 0.5) + ((dy / dt) * 0.5);
            }

            let deltaRotationQuaternion = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(dy * 0.005, dx * 0.005, 0, 'XYZ')
            );
            state.polyGroup.quaternion.multiplyQuaternions(deltaRotationQuaternion, state.polyGroup.quaternion);

            state.previousMouse.x = e.clientX;
            state.previousMouse.y = e.clientY;
            state.lastMoveTime = currentTime;
        }
    });

    // ── Mouse Up ─────────────────────────────────────────────────────────
    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            state.isPanningCamera = false;
            state.isPanningObject = false;
            if (state.isDraggingObject) {
                state.isDraggingObject = false;
                if (state.gridMode !== '3d') {
                    let speed = Math.sqrt(state.dragVelocity.x ** 2 + state.dragVelocity.y ** 2);
                    if (speed > 0.05) {
                        state.dragMomentumAxis.set(state.dragVelocity.y, state.dragVelocity.x, 0).normalize();
                        state.dragMomentumSpeed = Math.min(speed * 0.05, 0.5);
                    }
                }
            }
        }
    });
}
