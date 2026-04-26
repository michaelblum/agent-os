import { createStackMenu } from '/toolkit/runtime/stack-menu.js';

const MENU_WIDTH = 292;
const MENU_HEIGHT = 448;
const MENU_OFFSET = 18;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function controlRow(label, id, min, max, step, value) {
    return `
        <label>${label}</label>
        <div class="ctx-range-row">
            <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
            <span class="ctx-value" data-value-for="${id}">${value}</span>
        </div>`;
}

function menuMarkup() {
    return `
    <div id="sigil-context-menu" class="ctx-anchor sigil-context-menu">
        <div id="sigil-menu-root" class="ctx-menu-card active">
            <div class="ctx-tabs">
                <button class="ctx-tab active" data-ctx-tab="sigil-menu-shape" title="Shape">
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12"></rect><rect x="9" y="9" width="12" height="12"></rect><line x1="3" y1="3" x2="9" y2="9"></line><line x1="15" y1="3" x2="21" y2="9"></line><line x1="3" y1="15" x2="9" y2="21"></line><line x1="15" y1="15" x2="21" y2="21"></line></svg>
                </button>
                <button class="ctx-tab" data-ctx-tab="sigil-menu-look" title="Look">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M12 2v10l8.5-5.5"></path><path d="M12 12l-8.5 5.5"></path><path d="M12 12l-8.5-5.5"></path><path d="M12 12v10"></path><path d="M12 12l8.5 5.5"></path></svg>
                </button>
                <button class="ctx-tab" data-ctx-tab="sigil-menu-effects" title="FX">
                    <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button class="ctx-tab" data-ctx-tab="sigil-menu-world" title="World">
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                </button>
            </div>

            <div id="sigil-menu-shape" class="ctx-panel active">
                <h3>Shape</h3>
                <label>Geometry</label>
                <select id="sigil-menu-shape-select">
                    <option value="4">Tetrahedron</option>
                    <option value="6">Hexahedron</option>
                    <option value="8">Octahedron</option>
                    <option value="12">Dodecahedron</option>
                    <option value="20">Icosahedron</option>
                    <option value="90">Tetartoid</option>
                    <option value="91">Torus Knot</option>
                    <option value="100">Sphere</option>
                </select>
                ${controlRow('Stellation', 'sigil-menu-stellation', -1, 2, 0.05, 0)}
                ${controlRow('Face Opacity', 'sigil-menu-opacity', 0, 1, 0.01, 0.8)}
                ${controlRow('Edge Opacity', 'sigil-menu-edge-opacity', 0, 1, 0.01, 0.6)}
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-xray"> X-Ray</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-specular"> Specular</label>
                </div>
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-omega">Omega Shape</button>
            </div>

            <div id="sigil-menu-look" class="ctx-panel">
                <h3>Appearance</h3>
                <label>Primary Color</label>
                <input type="color" id="sigil-menu-primary-color" value="#4488ff">
                <label>Edge Color</label>
                <input type="color" id="sigil-menu-edge-color" value="#ffffff">
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-core-colors">Core Colors</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-effect-colors">Effect Colors</button>
            </div>

            <div id="sigil-menu-effects" class="ctx-panel">
                <h3>Effects</h3>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-pulsar"> Pulsar</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-accretion"> Accretion</label>
                </div>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-gamma"> Gamma</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-neutrino"> Neutrino</label>
                </div>
                <div class="ctx-row">
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-lightning"> Lightning</label>
                    <label class="checkbox-label"><input type="checkbox" id="sigil-menu-magnetic"> Magnetic</label>
                </div>
                <div class="ctx-divider"></div>
                ${controlRow('Aura Reach', 'sigil-menu-aura-reach', 0, 3, 0.01, 1)}
                ${controlRow('Aura Intensity', 'sigil-menu-aura-intensity', 0, 3, 0.01, 1)}
                ${controlRow('Spin Speed', 'sigil-menu-spin', 0, 0.1, 0.001, 0.01)}
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-lightning-card">Lightning Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-magnetic-card">Magnetic Settings</button>
                <button class="ctx-trigger" data-ctx-open="sigil-menu-path-card">Path & Trail</button>
            </div>

            <div id="sigil-menu-world" class="ctx-panel">
                <h3>World</h3>
                <label>Grid Mode</label>
                <select id="sigil-menu-grid-mode">
                    <option value="off">Off</option>
                    <option value="flat">2D Flat</option>
                    <option value="3d">3D Volumetric</option>
                </select>
                ${controlRow('Menu Ring', 'sigil-menu-ring', 40, 260, 1, 120)}
                <div class="ctx-divider"></div>
                <button class="ctx-trigger" data-sigil-action="toggle-inspector">Canvas Inspector</button>
                <button class="ctx-trigger" data-sigil-action="toggle-log">Console Log</button>
                <div class="ctx-divider"></div>
                <div class="ctx-actions">
                    <button id="sigil-menu-randomize" title="Randomize">R</button>
                    <button id="sigil-menu-snapshot" title="Snapshot">S</button>
                </div>
            </div>
        </div>

        <div id="sigil-menu-omega" class="ctx-menu-card ctx-sub">
            <h3>Omega Shape</h3>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-enabled"> Enable Omega</label>
            <label>Shape</label>
            <select id="sigil-menu-omega-shape">
                <option value="4">Tetrahedron</option>
                <option value="6">Hexahedron</option>
                <option value="8">Octahedron</option>
                <option value="12">Dodecahedron</option>
                <option value="20">Icosahedron</option>
            </select>
            ${controlRow('Scale', 'sigil-menu-omega-scale', 0.1, 5, 0.05, 1)}
            ${controlRow('Stellation', 'sigil-menu-omega-stellation', -1, 2, 0.05, 0)}
            <div class="ctx-row">
                <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-counterspin"> Counter Spin</label>
                <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-lock"> Lock Pos</label>
            </div>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-omega-interdim"> Inter-dimensional</label>
        </div>

        <div id="sigil-menu-core-colors" class="ctx-menu-card ctx-sub">
            <h3>Core Colors</h3>
            <label>Faces</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-face1"><input type="color" id="sigil-menu-face2"></div>
            <label>Edges</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-edge1"><input type="color" id="sigil-menu-edge2"></div>
            <label>Aura</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-aura1"><input type="color" id="sigil-menu-aura2"></div>
        </div>

        <div id="sigil-menu-effect-colors" class="ctx-menu-card ctx-sub">
            <h3>Effect Colors</h3>
            <label>Lightning</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-lightning1"><input type="color" id="sigil-menu-lightning2"></div>
            <label>Magnetic</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-magnetic1"><input type="color" id="sigil-menu-magnetic2"></div>
            <label>Grid</label>
            <div class="ctx-color-row"><input type="color" id="sigil-menu-grid1"><input type="color" id="sigil-menu-grid2"></div>
        </div>

        <div id="sigil-menu-lightning-card" class="ctx-menu-card ctx-sub">
            <h3>Lightning</h3>
            ${controlRow('Length', 'sigil-menu-lightning-length', 10, 240, 1, 100)}
            ${controlRow('Frequency', 'sigil-menu-lightning-frequency', 0, 8, 0.1, 2)}
            ${controlRow('Branching', 'sigil-menu-lightning-branching', 0, 0.5, 0.01, 0.08)}
        </div>

        <div id="sigil-menu-magnetic-card" class="ctx-menu-card ctx-sub">
            <h3>Magnetic</h3>
            ${controlRow('Tentacles', 'sigil-menu-magnetic-count', 0, 40, 1, 10)}
            ${controlRow('Speed', 'sigil-menu-magnetic-speed', 0, 4, 0.05, 1)}
            ${controlRow('Wander', 'sigil-menu-magnetic-wander', 0, 8, 0.1, 3)}
        </div>

        <div id="sigil-menu-path-card" class="ctx-menu-card ctx-sub">
            <h3>Path & Trail</h3>
            <label class="checkbox-label"><input type="checkbox" id="sigil-menu-trail-enabled"> Trail</label>
            ${controlRow('Trail Length', 'sigil-menu-trail-length', 0, 120, 1, 20)}
            ${controlRow('Drag Cancel Radius', 'sigil-menu-cancel-radius', 10, 120, 1, 40)}
        </div>
    </div>`;
}

export function createSigilContextMenu({
    state,
    liveJs,
    projectPoint,
    updateGeometry,
    updateOmegaGeometry,
    updateAllColors,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
    updateMagneticTentacleCount,
    onUtilityAction,
    onBoundsChange,
} = {}) {
    const layer = document.createElement('div');
    layer.className = 'sigil-context-menu-layer';
    layer.innerHTML = menuMarkup();
    document.body.appendChild(layer);

    const anchor = layer.querySelector('#sigil-context-menu');
    let menuState = {
        open: false,
        bounds: null,
        activeRange: null,
        snapshot: null,
    };
    let stack = null;
    stack = createStackMenu(anchor, {
        rootId: 'sigil-menu-root',
        onChange: () => syncSnapshot(),
    });

    function syncSnapshot() {
        if (!stack) return;
        menuState.snapshot = stack.snapshot();
        if (liveJs) liveJs.contextMenu = snapshot();
    }

    function snapshot() {
        return {
            open: menuState.open,
            bounds: menuState.bounds ? { ...menuState.bounds } : null,
            stack: menuState.snapshot,
        };
    }

    function setValueLabel(id, value) {
        const label = layer.querySelector(`[data-value-for="${id}"]`);
        if (!label) return;
        const n = Number(value);
        label.textContent = Number.isFinite(n) && Math.abs(n) < 10
            ? n.toFixed(id.includes('spin') ? 3 : 2)
            : String(value);
    }

    function setControlValue(id, value, checked = null) {
        const el = layer.querySelector(`#${id}`);
        if (!el) return;
        if (checked !== null && 'checked' in el) el.checked = !!checked;
        else el.value = value;
        setValueLabel(id, el.value);
    }

    function setColorValue(id, value) {
        const el = layer.querySelector(`#${id}`);
        if (!el || typeof value !== 'string') return;
        el.value = value;
    }

    function syncFromState() {
        if (!state) return;
        setControlValue('sigil-menu-shape-select', state.currentGeometryType ?? state.currentType);
        setControlValue('sigil-menu-stellation', state.stellationFactor ?? 0);
        setControlValue('sigil-menu-opacity', state.currentOpacity ?? 0.8);
        setControlValue('sigil-menu-edge-opacity', state.currentEdgeOpacity ?? 0.6);
        setControlValue('sigil-menu-xray', null, state.isInteriorEdgesEnabled);
        setControlValue('sigil-menu-specular', null, state.isSpecularEnabled);
        setControlValue('sigil-menu-aura-reach', state.auraReach ?? 1);
        setControlValue('sigil-menu-aura-intensity', state.auraIntensity ?? 1);
        setControlValue('sigil-menu-spin', state.idleSpinSpeed ?? 0.01);
        setControlValue('sigil-menu-ring', state.menuRingRadius ?? 120);
        setControlValue('sigil-menu-pulsar', null, state.isPulsarEnabled);
        setControlValue('sigil-menu-accretion', null, state.isAccretionEnabled);
        setControlValue('sigil-menu-gamma', null, state.isGammaEnabled);
        setControlValue('sigil-menu-neutrino', null, state.isNeutrinosEnabled);
        setControlValue('sigil-menu-lightning', null, state.isLightningEnabled);
        setControlValue('sigil-menu-magnetic', null, state.isMagneticEnabled);
        setControlValue('sigil-menu-lightning-length', state.lightningBoltLength ?? 100);
        setControlValue('sigil-menu-lightning-frequency', state.lightningFrequency ?? 2);
        setControlValue('sigil-menu-lightning-branching', state.lightningBranching ?? 0.08);
        setControlValue('sigil-menu-magnetic-count', state.magneticTentacleCount ?? 10);
        setControlValue('sigil-menu-magnetic-speed', state.magneticTentacleSpeed ?? 1);
        setControlValue('sigil-menu-magnetic-wander', state.magneticWander ?? 3);
        setControlValue('sigil-menu-grid-mode', state.gridMode ?? 'off');
        setControlValue('sigil-menu-omega-enabled', null, state.isOmegaEnabled);
        setControlValue('sigil-menu-omega-shape', state.omegaGeometryType ?? state.omegaType ?? 4);
        setControlValue('sigil-menu-omega-scale', state.omegaScale ?? 1);
        setControlValue('sigil-menu-omega-stellation', state.omegaStellationFactor ?? 0);
        setControlValue('sigil-menu-omega-counterspin', null, state.omegaCounterSpin);
        setControlValue('sigil-menu-omega-lock', null, state.omegaLockPosition);
        setControlValue('sigil-menu-omega-interdim', null, state.omegaInterDimensional);
        setControlValue('sigil-menu-trail-enabled', null, state.isTrailEnabled);
        setControlValue('sigil-menu-trail-length', state.trailLength ?? 20);
        setControlValue('sigil-menu-cancel-radius', liveJs?.dragCancelRadius ?? state.dragCancelRadius ?? 40);
        setColorValue('sigil-menu-primary-color', state.colors?.face?.[0]);
        setColorValue('sigil-menu-edge-color', state.colors?.edge?.[0]);
        setColorValue('sigil-menu-face1', state.colors?.face?.[0]);
        setColorValue('sigil-menu-face2', state.colors?.face?.[1]);
        setColorValue('sigil-menu-edge1', state.colors?.edge?.[0]);
        setColorValue('sigil-menu-edge2', state.colors?.edge?.[1]);
        setColorValue('sigil-menu-aura1', state.colors?.aura?.[0]);
        setColorValue('sigil-menu-aura2', state.colors?.aura?.[1]);
        setColorValue('sigil-menu-lightning1', state.colors?.lightning?.[0]);
        setColorValue('sigil-menu-lightning2', state.colors?.lightning?.[1]);
        setColorValue('sigil-menu-magnetic1', state.colors?.magnetic?.[0]);
        setColorValue('sigil-menu-magnetic2', state.colors?.magnetic?.[1]);
        setColorValue('sigil-menu-grid1', state.colors?.grid?.[0]);
        setColorValue('sigil-menu-grid2', state.colors?.grid?.[1]);
    }

    function clampToVisible(point) {
        const display = (liveJs?.displays || []).find((entry) => {
            const rect = entry.visibleBounds || entry.visible_bounds || entry.bounds;
            return rect
                && point.x >= rect.x
                && point.y >= rect.y
                && point.x < rect.x + rect.w
                && point.y < rect.y + rect.h;
        });
        const visible = display?.visibleBounds || display?.visible_bounds || display?.bounds || liveJs?.visibleBounds;
        const fallback = { x: point.x + MENU_OFFSET, y: point.y + MENU_OFFSET };
        if (!visible || !Number.isFinite(visible.w) || !Number.isFinite(visible.h)) return fallback;
        if (fallback.x + MENU_WIDTH > visible.x + visible.w) {
            fallback.x = point.x - MENU_OFFSET - MENU_WIDTH;
        }
        if (fallback.y + MENU_HEIGHT > visible.y + visible.h) {
            fallback.y = point.y - MENU_OFFSET - MENU_HEIGHT;
        }
        return {
            x: clamp(fallback.x, visible.x, Math.max(visible.x, visible.x + visible.w - MENU_WIDTH)),
            y: clamp(fallback.y, visible.y, Math.max(visible.y, visible.y + visible.h - MENU_HEIGHT)),
        };
    }

    function syncPosition() {
        if (!menuState.open || !menuState.bounds || typeof projectPoint !== 'function') return;
        const local = projectPoint(menuState.bounds);
        if (!local) {
            anchor.style.display = 'none';
            return;
        }
        anchor.style.display = '';
        anchor.style.left = `${Math.round(local.x)}px`;
        anchor.style.top = `${Math.round(local.y)}px`;
    }

    function openAt(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        syncFromState();
        const origin = clampToVisible(point);
        menuState.open = true;
        menuState.bounds = { x: origin.x, y: origin.y, w: MENU_WIDTH, h: MENU_HEIGHT };
        if (state) state.isMenuOpen = true;
        syncPosition();
        stack.open({ x: parseFloat(anchor.style.left) || 0, y: parseFloat(anchor.style.top) || 0 });
        syncSnapshot();
        onBoundsChange?.(snapshot());
        return snapshot();
    }

    function close(reason = 'close') {
        if (!menuState.open) return;
        menuState.open = false;
        menuState.bounds = null;
        menuState.activeRange = null;
        if (state) state.isMenuOpen = false;
        stack.close(reason);
        syncSnapshot();
        onBoundsChange?.(snapshot());
    }

    function applySnapshot(next = {}) {
        const open = !!next.open;
        menuState.open = open;
        menuState.bounds = open && next.bounds ? { ...next.bounds } : null;
        menuState.activeRange = null;
        if (state) state.isMenuOpen = open;
        if (!open) {
            stack.close('snapshot');
            syncSnapshot();
            return;
        }
        syncPosition();
        anchor.classList.add('visible');
        stack.applySnapshot(next.stack || {});
        syncSnapshot();
    }

    function containsDesktopPoint(point) {
        const b = menuState.bounds;
        return !!(b && point
            && point.x >= b.x
            && point.y >= b.y
            && point.x < b.x + b.w
            && point.y < b.y + b.h);
    }

    function localClientPoint(point) {
        if (!point || typeof projectPoint !== 'function') return null;
        return projectPoint(point);
    }

    function elementAt(point) {
        const local = localClientPoint(point);
        if (!local) return null;
        return document.elementFromPoint(local.x, local.y);
    }

    function updateRange(input, point, commit = false) {
        const rect = input.getBoundingClientRect();
        const local = localClientPoint(point);
        if (!local || rect.width <= 0) return true;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const step = Number(input.step || 1);
        const ratio = clamp((local.x - rect.left) / rect.width, 0, 1);
        const raw = min + (max - min) * ratio;
        const next = Math.round(raw / step) * step;
        input.value = String(clamp(next, min, max));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function handlePointerEvent(kind, point) {
        if (!menuState.open) return false;
        if (!containsDesktopPoint(point)) {
            if (kind === 'left_mouse_down') close('outside-click');
            return false;
        }

        const active = menuState.activeRange;
        if (active && (kind === 'left_mouse_dragged' || kind === 'mouse_moved')) {
            return updateRange(active, point);
        }
        if (active && kind === 'left_mouse_up') {
            const input = active;
            menuState.activeRange = null;
            return updateRange(input, point, true);
        }

        if (kind !== 'left_mouse_down' && kind !== 'left_mouse_up') return true;

        const target = elementAt(point);
        if (!target || !anchor.contains(target)) return true;
        const input = target.closest?.('input, select, button, .ctx-menu-card.pushed');
        if (!input) return true;

        if (kind === 'left_mouse_down' && input.matches('input[type="range"]')) {
            menuState.activeRange = input;
            return updateRange(input, point);
        }

        if (kind === 'left_mouse_up') {
            if (input.matches('input[type="checkbox"]')) {
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            if (input.matches('button, .ctx-menu-card.pushed')) {
                input.click();
                syncSnapshot();
                return true;
            }
        }
        return true;
    }

    function bindControls() {
        const onRange = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => {
                const value = Number(el.value);
                setValueLabel(id, value);
                setter?.(value);
            });
        };
        const onCheckbox = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => setter?.(!!el.checked));
        };
        const onSelect = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => setter?.(Number(el.value)));
        };
        const onChoice = (id, setter) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('change', () => setter?.(el.value));
        };
        const onColor = (id, colorKey, index) => {
            const el = layer.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => {
                if (!state.colors[colorKey]) state.colors[colorKey] = ['#ffffff', '#ffffff'];
                state.colors[colorKey][index] = el.value;
                updateAllColors?.();
            });
        };
        const onAction = (action, handler) => {
            const el = layer.querySelector(`[data-sigil-action="${action}"]`);
            if (!el) return;
            el.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                handler?.();
            });
        };

        onRange('sigil-menu-stellation', (value) => {
            state.stellationFactor = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onSelect('sigil-menu-shape-select', (value) => {
            state.currentGeometryType = value;
            state.currentType = value;
            updateGeometry?.(value);
        });
        onRange('sigil-menu-opacity', (value) => {
            state.currentOpacity = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-edge-opacity', (value) => {
            state.currentEdgeOpacity = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onCheckbox('sigil-menu-xray', (value) => {
            state.isInteriorEdgesEnabled = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onCheckbox('sigil-menu-specular', (value) => {
            state.isSpecularEnabled = value;
            updateGeometry?.(state.currentGeometryType ?? state.currentType);
        });
        onRange('sigil-menu-aura-reach', (value) => { state.auraReach = value; });
        onRange('sigil-menu-aura-intensity', (value) => { state.auraIntensity = value; });
        onCheckbox('sigil-menu-pulsar', (value) => {
            state.isPulsarEnabled = value;
            if (value && state.pulsarRayCount <= 0) state.pulsarRayCount = 1;
            updatePulsars?.(state.pulsarRayCount);
        });
        onCheckbox('sigil-menu-accretion', (value) => {
            state.isAccretionEnabled = value;
            if (value && state.accretionDiskCount <= 0) state.accretionDiskCount = 1;
            updateAccretion?.(state.accretionDiskCount);
        });
        onCheckbox('sigil-menu-gamma', (value) => {
            state.isGammaEnabled = value;
            if (value && state.gammaRayCount <= 0) state.gammaRayCount = 3;
            updateGammaRays?.(state.gammaRayCount);
        });
        onCheckbox('sigil-menu-neutrino', (value) => {
            state.isNeutrinosEnabled = value;
            if (value && state.neutrinoJetCount <= 0) state.neutrinoJetCount = 1;
            updateNeutrinos?.(state.neutrinoJetCount);
        });
        onCheckbox('sigil-menu-lightning', (value) => { state.isLightningEnabled = value; });
        onCheckbox('sigil-menu-magnetic', (value) => { state.isMagneticEnabled = value; });
        onRange('sigil-menu-lightning-length', (value) => { state.lightningBoltLength = value; });
        onRange('sigil-menu-lightning-frequency', (value) => { state.lightningFrequency = value; });
        onRange('sigil-menu-lightning-branching', (value) => { state.lightningBranching = value; });
        onRange('sigil-menu-magnetic-count', (value) => {
            updateMagneticTentacleCount?.(value);
        });
        onRange('sigil-menu-magnetic-speed', (value) => { state.magneticTentacleSpeed = value; });
        onRange('sigil-menu-magnetic-wander', (value) => { state.magneticWander = value; });
        onChoice('sigil-menu-grid-mode', (value) => { state.gridMode = value; });
        onRange('sigil-menu-ring', (value) => {
            state.menuRingRadius = value;
            if (liveJs) liveJs.menuRingRadius = value;
        });
        onCheckbox('sigil-menu-omega-enabled', (value) => { state.isOmegaEnabled = value; });
        onSelect('sigil-menu-omega-shape', (value) => {
            state.omegaGeometryType = value;
            state.omegaType = value;
            updateOmegaGeometry?.(value);
        });
        onRange('sigil-menu-omega-stellation', (value) => {
            state.omegaStellationFactor = value;
            updateOmegaGeometry?.(state.omegaGeometryType ?? state.omegaType);
        });
        onRange('sigil-menu-omega-scale', (value) => { state.omegaScale = value; });
        onCheckbox('sigil-menu-omega-counterspin', (value) => { state.omegaCounterSpin = value; });
        onCheckbox('sigil-menu-omega-lock', (value) => { state.omegaLockPosition = value; });
        onCheckbox('sigil-menu-omega-interdim', (value) => { state.omegaInterDimensional = value; });
        onCheckbox('sigil-menu-trail-enabled', (value) => { state.isTrailEnabled = value; });
        onRange('sigil-menu-trail-length', (value) => { state.trailLength = value; });
        onRange('sigil-menu-cancel-radius', (value) => {
            state.dragCancelRadius = value;
            if (liveJs) liveJs.dragCancelRadius = value;
        });
        onColor('sigil-menu-primary-color', 'face', 0);
        onColor('sigil-menu-edge-color', 'edge', 0);
        onColor('sigil-menu-face1', 'face', 0);
        onColor('sigil-menu-face2', 'face', 1);
        onColor('sigil-menu-edge1', 'edge', 0);
        onColor('sigil-menu-edge2', 'edge', 1);
        onColor('sigil-menu-aura1', 'aura', 0);
        onColor('sigil-menu-aura2', 'aura', 1);
        onColor('sigil-menu-lightning1', 'lightning', 0);
        onColor('sigil-menu-lightning2', 'lightning', 1);
        onColor('sigil-menu-magnetic1', 'magnetic', 0);
        onColor('sigil-menu-magnetic2', 'magnetic', 1);
        onColor('sigil-menu-grid1', 'grid', 0);
        onColor('sigil-menu-grid2', 'grid', 1);
        onAction('toggle-inspector', () => onUtilityAction?.('canvas-inspector'));
        onAction('toggle-log', () => onUtilityAction?.('log-console'));
    }

    bindControls();
    syncFromState();
    syncSnapshot();

    return {
        openAt,
        close,
        isOpen() {
            return menuState.open;
        },
        bounds() {
            return menuState.bounds ? { ...menuState.bounds } : null;
        },
        updateSegmentPosition: syncPosition,
        containsDesktopPoint,
        handlePointerEvent,
        applySnapshot,
        snapshot,
    };
}
