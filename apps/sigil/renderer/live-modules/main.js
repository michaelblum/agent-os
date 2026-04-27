import state from '../state.js';
import { updateGeometry, updateOmegaGeometry, updateInnerEdgePulse } from '../geometry.js';
import { updateAllColors } from '../colors.js';
import { createAuraObjects, animateAura } from '../aura.js';
import {
    createPhenomena,
    animatePhenomena,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
} from '../phenomena.js';
import { createParticleObjects, animateParticles, animateTrails } from '../particles.js';
import { createLightning, animateLightning } from '../lightning.js';
import { createMagneticField, animateMagneticField, updateMagneticTentacleCount } from '../magnetic.js';
import { createOmega, animateOmega, resetOmegaInterdimensionalTrail } from '../omega.js';
import { animateSkins } from '../skins.js';
import { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';
import { createRenderLoopScheduler } from './render-loop.js';
import { createHostRuntime } from './host-runtime.js';
import { createInteractionOverlay } from './interaction-overlay.js';
import { createHitTargetController } from './hit-target.js';
import { createVisibilityTransitionController } from './visibility-transition.js';
import { DesktopWorldSurface3D } from './desktop-world-surface-runtime.js';
import { normalizeMessage } from './input-message.js';
import {
    clampPointToDisplays,
    computeDesktopWorldBounds,
    computeVisibleDesktopWorldBounds,
    desktopWorldToNativePoint,
    globalToUnionLocalPoint,
    nativeToDesktopWorldPoint,
    normalizeDisplays,
} from './display-utils.js';
import { createFastTravelController } from './fast-travel.js';
import { createSigilRadialGestureMenu } from './radial-gesture-menu.js';
import { createSigilRadialGestureVisuals } from './radial-gesture-visuals.js';
import { createSigilContextMenu } from '../../context-menu/menu.js';
import { loadAgent } from '../agent-loader.js';

const host = createHostRuntime();
const desktopWorldSurface = (
    typeof window !== 'undefined'
    && window.__aosSurfaceCanvasId
    && window.__aosSegmentDisplayId !== undefined
)
    ? new DesktopWorldSurface3D({ host, canvasId: window.__aosSurfaceCanvasId })
    : null;
const overlay = createInteractionOverlay();
const hitTarget = createHitTargetController({
    runtime: host,
    url: 'aos://sigil/renderer/hit-area.html',
    size: state.avatarHitRadius * 2,
    id: 'sigil-hit-avatar-main',
});

const liveJs = {
    avatarPos: { x: 0, y: 0, valid: false },
    avatarSize: 1.0,
    pointerPos: { x: 0, y: 0 },
    avatarHover: false,
    avatarHoverProgress: 0,
    currentCursor: { x: 0, y: 0, valid: false },
    cursorTarget: { x: 0, y: 0, valid: false },
    globalBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visibleBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    displays: [],
    currentState: 'IDLE',
    state: 'IDLE',
    currentAgentId: 'default',
    currentAgentDefinition: null,
    avatarHitRadius: state.avatarHitRadius,
    dragThreshold: state.dragThreshold,
    dragCancelRadius: state.dragCancelRadius,
    gotoRingRadius: state.gotoRingRadius,
    menuRingRadius: state.menuRingRadius,
    radialGestureMenu: null,
    travel: null,
    fastTravelEvents: [],
    mousedownPos: null,
    mousedownAvatarPos: null,
    avatarVisible: false,
    contextMenu: { open: false, bounds: null, stack: null },
    utilityCanvases: new Map(),
    defaultAvatarSave: { dirty: false, saving: false, lastSavedAt: null, lastError: null },
    appearanceVersion: 0,
    appliedAppearanceVersion: null,
    lastPublishedAppearanceVersion: null,
    surfaceRenderSnapshot: null,
    _resolveFirstDisplayGeometry: null,
    _pendingLifecycleComplete: null,
};

window.liveJs = liveJs;
window.state = state;
window.applyAppearance = applyAppearance;
window.__sigilBootTrace = [];
window.__sigilBootError = null;
window.__sigilBootFirstFrameAt = null;

let rendererSuspended = false;
const renderLoop = createRenderLoopScheduler(requestAnimationFrame);
let radialGestureVisuals = null;
const DEFAULT_AGENT_WIKI_PATH = 'sigil/agents/default';
const DEFAULT_AGENT_WIKI_URL = `/wiki/${DEFAULT_AGENT_WIKI_PATH}.md`;
const INPUT_POINTER_EVENT_TYPES = new Set([
    'left_mouse_down',
    'left_mouse_up',
    'left_mouse_dragged',
    'right_mouse_down',
    'right_mouse_up',
    'right_mouse_dragged',
    'other_mouse_down',
    'other_mouse_up',
    'other_mouse_dragged',
    'mouse_moved',
    'scroll_wheel',
]);

function boundsWithMinMax(rect) {
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number'
        || typeof rect.w !== 'number' || typeof rect.h !== 'number') return null;
    return {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        minX: rect.x, minY: rect.y,
        maxX: rect.x + rect.w, maxY: rect.y + rect.h,
    };
}

function recordBoot(stage, extra = {}) {
    const entry = { ts: Date.now(), stage, ...extra };
    window.__sigilBootTrace.push(entry);
    if (window.__sigilBootTrace.length > 64) window.__sigilBootTrace.shift();
    if (extra.error) window.__sigilBootError = entry;
    if (stage.startsWith('boot:')) {
        console.debug('[sigil][boot]', stage, entry);
    }
}

function bootElapsedMs() {
    const first = window.__sigilBootTrace[0];
    return first ? Date.now() - first.ts : 0;
}

function recordBootDuration(stage, startedAt, extra = {}) {
    recordBoot(stage, {
        ...extra,
        duration_ms: Math.round(performance.now() - startedAt),
        boot_elapsed_ms: bootElapsedMs(),
    });
}

function runBootStep(stage, fn) {
    recordBoot(stage);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.catch((error) => {
                recordBoot(stage, {
                    error: String(error),
                    stack: error && error.stack ? String(error.stack) : null,
                });
                throw error;
            });
        }
        return result;
    } catch (error) {
        recordBoot(stage, {
            error: String(error),
            stack: error && error.stack ? String(error.stack) : null,
        });
        throw error;
    }
}

function scheduleRenderFrame() {
    renderLoop.schedule(animate);
}

function isPrimarySurfaceSegment() {
    return !desktopWorldSurface || desktopWorldSurface.isPrimary;
}

function shouldProcessGlobalDaemonEvent(msg = {}) {
    if (isPrimarySurfaceSegment()) return true;
    if (msg.type === 'display_geometry') return false;
    if (msg.type === 'input_event' || msg.envelope_type === 'input_event') return false;
    if (msg.type === 'canvas_message' && msg.id === hitTarget.hit.id) return false;
    return true;
}

function topologyDisplay(segment) {
    const dw = segment?.dw_bounds || [0, 0, 0, 0];
    const native = segment?.native_bounds || dw;
    return {
        id: segment.display_id,
        display_id: segment.display_id,
        cgID: segment.display_id,
        is_main: segment.index === 0,
        width: dw[2],
        height: dw[3],
        bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        visible_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        desktop_world_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        visible_desktop_world_bounds: { x: dw[0], y: dw[1], w: dw[2], h: dw[3] },
        native_bounds: { x: native[0], y: native[1], w: native[2], h: native[3] },
        native_visible_bounds: { x: native[0], y: native[1], w: native[2], h: native[3] },
        scale_factor: 1,
    };
}

function syncTopologyDisplays(topology = []) {
    if (!Array.isArray(topology) || topology.length === 0) return;
    liveJs.displays = normalizeDisplays(topology.map(topologyDisplay));
    liveJs.globalBounds = computeDesktopWorldBounds(liveJs.displays);
    liveJs.visibleBounds = computeVisibleDesktopWorldBounds(liveJs.displays);
    if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
        const resolve = liveJs._resolveFirstDisplayGeometry;
        liveJs._resolveFirstDisplayGeometry = null;
        recordBoot('boot:firstDisplayGeometry', { displays: liveJs.displays.length, boot_elapsed_ms: bootElapsedMs() });
        resolve(liveJs.displays);
    }
}

function applySurfaceRenderSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (
        snapshot.appearance
        && Number.isFinite(snapshot.appearanceVersion)
        && snapshot.appearanceVersion !== liveJs.appliedAppearanceVersion
    ) {
        applyAppearance(snapshot.appearance);
        liveJs.appliedAppearanceVersion = snapshot.appearanceVersion;
    }
    if (snapshot.avatarPos?.valid) liveJs.avatarPos = { ...snapshot.avatarPos };
    if (snapshot.renderAvatarPos?.valid) liveJs.surfaceRenderSnapshot = snapshot;
    if (snapshot.pointerPos) liveJs.pointerPos = { ...snapshot.pointerPos };
    if (typeof snapshot.avatarHover === 'boolean') liveJs.avatarHover = snapshot.avatarHover;
    if (Number.isFinite(snapshot.avatarHoverProgress)) liveJs.avatarHoverProgress = snapshot.avatarHoverProgress;
    if ('mousedownPos' in snapshot) {
        liveJs.mousedownPos = snapshot.mousedownPos ? { ...snapshot.mousedownPos } : null;
    }
    if ('mousedownAvatarPos' in snapshot) {
        liveJs.mousedownAvatarPos = snapshot.mousedownAvatarPos ? { ...snapshot.mousedownAvatarPos } : null;
    }
    if ('radialGestureMenu' in snapshot) {
        liveJs.radialGestureMenu = snapshot.radialGestureMenu || null;
        radialGestureMenu.applySnapshot(liveJs.radialGestureMenu);
    }
    if (typeof snapshot.avatarVisible === 'boolean') liveJs.avatarVisible = snapshot.avatarVisible;
    if (snapshot.currentState) {
        liveJs.currentState = snapshot.currentState;
        liveJs.state = snapshot.currentState;
    }
    if (Number.isFinite(snapshot.appScale)) state.appScale = snapshot.appScale;
    if (Number.isFinite(snapshot.globalTime)) state.globalTime = snapshot.globalTime;
    if (snapshot.omega && typeof snapshot.omega === 'object') {
        if (typeof snapshot.omega.enabled === 'boolean') state.isOmegaEnabled = snapshot.omega.enabled;
        if (typeof snapshot.omega.interDimensional === 'boolean') state.omegaInterDimensional = snapshot.omega.interDimensional;
    }
    if (snapshot.contextMenu && typeof snapshot.contextMenu === 'object') {
        contextMenu.applySnapshot(snapshot.contextMenu);
    }
    fastTravel.applySnapshot(snapshot.fastTravel);
    syncOmegaTrailToTravelOrigin();
}

function surfaceRenderSnapshot(renderAvatarPos) {
    const snapshot = {
        avatarPos: liveJs.avatarPos,
        renderAvatarPos,
        pointerPos: liveJs.pointerPos,
        avatarHover: liveJs.avatarHover,
        avatarHoverProgress: liveJs.avatarHoverProgress,
        mousedownPos: liveJs.mousedownPos,
        mousedownAvatarPos: liveJs.mousedownAvatarPos,
        radialGestureMenu: liveJs.radialGestureMenu,
        avatarVisible: liveJs.avatarVisible,
        currentState: liveJs.currentState,
        appScale: state.appScale,
        globalTime: state.globalTime,
        appearanceVersion: liveJs.appearanceVersion,
        omega: {
            enabled: state.isOmegaEnabled,
            interDimensional: state.omegaInterDimensional,
        },
        contextMenu: contextMenu?.snapshot?.(),
        fastTravel: fastTravel.exportSnapshot(),
    };
    if (liveJs.lastPublishedAppearanceVersion !== liveJs.appearanceVersion) {
        snapshot.appearance = snapshotAppearance();
        liveJs.lastPublishedAppearanceVersion = liveJs.appearanceVersion;
    }
    return snapshot;
}

function desktopWorldToSegmentLocalPoint(point) {
    if (!point) return null;
    const dw = desktopWorldSurface?.segment?.dw_bounds;
    if (Array.isArray(dw) && dw.length >= 4) {
        return {
            x: point.x - dw[0],
            y: point.y - dw[1],
            valid: point.valid ?? true,
        };
    }
    const local = globalToUnionLocalPoint(point, liveJs.globalBounds);
    if (!local) return null;
    return {
        ...local,
        valid: point.valid ?? true,
    };
}

function stagePoint(point) {
    return desktopWorldToSegmentLocalPoint(point);
}

function projectRadialGestureSnapshot(radial) {
    if (!radial || typeof radial !== 'object') return null;
    return {
        ...radial,
        origin: stagePoint(radial.origin),
        pointer: stagePoint(radial.pointer),
        items: Array.isArray(radial.items)
            ? radial.items.map((item) => ({
                ...item,
                center: stagePoint(item.center),
            }))
            : [],
    };
}

function avatarDefinition() {
    return {
        kind: 'sigil.avatar.appearance',
        version: 1,
        exportedAt: new Date().toISOString(),
        appearance: snapshotAppearance(),
    };
}

function avatarDefinitionJson() {
    return JSON.stringify(avatarDefinition(), null, 2);
}

async function loadDefaultAvatarDefinition({ apply = true } = {}) {
    const agent = await loadAgent(DEFAULT_AGENT_WIKI_PATH);
    liveJs.currentAgentDefinition = agent;
    liveJs.currentAgentId = agent.id || 'default';
    if (apply && agent.appearance) applyAppearance(agent.appearance);
    recordBoot('boot:defaultAvatarLoaded', { agent_id: liveJs.currentAgentId });
    return agent;
}

function applyDefaultAvatarDefinition(agent = liveJs.currentAgentDefinition) {
    if (agent?.appearance) applyAppearance(agent.appearance);
}

function replaceDefaultAvatarAppearance(markdown, appearance) {
    const match = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
    const body = match ? JSON.parse(match[1]) : { version: 1, minds: {}, instance: {} };
    body.version = body.version ?? 1;
    body.appearance = appearance;
    const json = JSON.stringify(body, null, 2);
    if (!match) return `${markdown.trimEnd()}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
    return `${markdown.slice(0, match.index)}\`\`\`json\n${json}\n\`\`\`${markdown.slice(match.index + match[0].length)}`;
}

let defaultAvatarDirty = false;
let defaultAvatarSaveInFlight = false;

function updateDefaultAvatarSaveState(next = {}) {
    liveJs.defaultAvatarSave = {
        ...liveJs.defaultAvatarSave,
        dirty: defaultAvatarDirty,
        saving: defaultAvatarSaveInFlight,
        ...next,
    };
}

async function saveDefaultAvatarDefinition(reason = 'menu-close') {
    if (defaultAvatarSaveInFlight) return false;
    defaultAvatarSaveInFlight = true;
    updateDefaultAvatarSaveState({ lastError: null });
    try {
        const response = await fetch(DEFAULT_AGENT_WIKI_URL);
        if (!response.ok) throw new Error(`GET ${DEFAULT_AGENT_WIKI_URL} failed: HTTP ${response.status}`);
        const markdown = await response.text();
        const appearance = snapshotAppearance();
        const next = replaceDefaultAvatarAppearance(markdown, appearance);
        const put = await fetch(DEFAULT_AGENT_WIKI_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: next,
        });
        if (!put.ok) throw new Error(`PUT ${DEFAULT_AGENT_WIKI_URL} failed: HTTP ${put.status}`);
        if (liveJs.currentAgentDefinition) {
            liveJs.currentAgentDefinition = { ...liveJs.currentAgentDefinition, appearance };
        }
        updateDefaultAvatarSaveState({
            lastSavedAt: new Date().toISOString(),
            lastSavedReason: reason,
            lastSavedFastTravel: appearance.transitions?.fastTravel ?? null,
        });
        recordBoot('save:defaultAvatar', { reason });
        return true;
    } finally {
        defaultAvatarSaveInFlight = false;
        updateDefaultAvatarSaveState();
    }
}

async function handleContextMenuClose({ reason = 'close' } = {}) {
    if (!defaultAvatarDirty) return;
    const shouldSave = window.confirm('Save changes?');
    if (!shouldSave) {
        defaultAvatarDirty = false;
        updateDefaultAvatarSaveState({ lastSkippedReason: reason });
        recordBoot('save:defaultAvatarSkipped', { reason });
        return;
    }
    try {
        await saveDefaultAvatarDefinition(reason);
        defaultAvatarDirty = false;
        updateDefaultAvatarSaveState();
    } catch (error) {
        updateDefaultAvatarSaveState({ lastError: error.message || String(error) });
        console.warn('[sigil] default avatar save failed:', error);
        window.alert?.(`Failed to save changes: ${error.message || String(error)}`);
    }
}

async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}

function saveTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function appearanceFromAvatarDefinitionText(text) {
    const parsed = JSON.parse(text);
    if (parsed?.kind === 'sigil.avatar.appearance' && parsed.appearance) return parsed.appearance;
    if (parsed?.appearance) return parsed.appearance;
    return parsed;
}

function importAvatarDefinitionText(text) {
    const appearance = appearanceFromAvatarDefinitionText(text);
    applyAppearance(appearance);
    markAppearanceChanged();
    return true;
}

let appliedAvatarWindowLevel = null;

function normalizeAvatarWindowLevel(level) {
    return level === 'screen_saver' ? 'screen_saver' : 'status_bar';
}

function applyAvatarWindowLevel(level = state.avatarWindowLevel) {
    const normalized = normalizeAvatarWindowLevel(level);
    state.avatarWindowLevel = normalized;
    if (!isPrimarySurfaceSegment()) return;
    if (appliedAvatarWindowLevel === normalized) return;
    appliedAvatarWindowLevel = normalized;
    host.canvasUpdate({ id: 'avatar-main', window_level: normalized });
}

async function handleAvatarMenuAction(action) {
    const json = avatarDefinitionJson();
    if (action === 'copy') {
        try {
            await writeClipboard(json);
        } catch (error) {
            console.warn('[sigil] clipboard write failed; showing avatar JSON fallback:', error);
            window.prompt('Copy Sigil avatar JSON', json);
        }
        return false;
    }
    if (action === 'save') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveTextFile(`sigil-avatar-${stamp}.json`, json);
        return false;
    }
    if (action === 'import') {
        const text = window.prompt('Paste Sigil avatar JSON');
        if (!text) return false;
        return importAvatarDefinitionText(text);
    }
    return false;
}

const contextMenu = createSigilContextMenu({
    state,
    liveJs,
    projectPoint: desktopWorldToSegmentLocalPoint,
    updateGeometry,
    updateOmegaGeometry,
    updateAllColors,
    updatePulsars,
    updateGammaRays,
    updateAccretion,
    updateNeutrinos,
    updateMagneticTentacleCount,
    onAppearanceChange: markAppearanceChanged,
    onUtilityAction: toggleUtilityCanvas,
    onAvatarAction: handleAvatarMenuAction,
    onAvatarWindowLevelChange: applyAvatarWindowLevel,
    onClose: handleContextMenuClose,
});

function markAppearanceChanged() {
    liveJs.appearanceVersion += 1;
    defaultAvatarDirty = true;
    updateDefaultAvatarSaveState({ lastError: null });
}

state._onAppearanceChanged = () => {
    applyAvatarWindowLevel();
};

function mainDisplayVisibleBounds() {
    const displays = liveJs.displays || [];
    const display = displays.find((entry) => entry.index === 0 || entry.is_main || entry.isMain)
        || displays[0];
    return display?.visibleBounds || display?.visible_bounds || display?.bounds || liveJs.visibleBounds;
}

function utilityFrame(kind) {
    const visible = mainDisplayVisibleBounds() || { x: 0, y: 0, w: 1512, h: 875 };
    if (kind === 'log-console') {
        const width = Math.min(520, Math.max(420, visible.w * 0.32));
        const height = Math.min(320, Math.max(260, visible.h * 0.32));
        return [
            Math.round(visible.x + 20),
            Math.round(visible.y + visible.h - height - 20),
            Math.round(width),
            Math.round(height),
        ];
    }

    const width = Math.min(360, Math.max(320, visible.w * 0.26));
    const height = Math.min(520, Math.max(420, visible.h * 0.55));
    return [
        Math.round(visible.x + visible.w - width - 20),
        Math.round(visible.y + 20),
        Math.round(width),
        Math.round(height),
    ];
}

function utilityConfig(kind) {
    if (kind === 'log-console') {
        return {
            id: '__log__',
            url: 'aos://toolkit/components/log-console/index.html',
            frame: utilityFrame(kind),
        };
    }
    return {
        id: 'canvas-inspector',
        url: 'aos://toolkit/components/canvas-inspector/index.html',
        frame: utilityFrame(kind),
    };
}

async function toggleUtilityCanvas(kind) {
    const config = utilityConfig(kind);
    const current = liveJs.utilityCanvases.get(config.id);
    try {
        if (current && current.suspended !== true) {
            await host.canvasSuspend(config.id);
            liveJs.utilityCanvases.set(config.id, { ...current, suspended: true });
            return;
        }
        if (current) {
            await host.canvasResume(config.id);
            liveJs.utilityCanvases.set(config.id, { ...current, suspended: false });
            return;
        }
        await host.canvasCreate({
            id: config.id,
            url: config.url,
            frame: config.frame,
            interactive: true,
            focus: true,
        });
        liveJs.utilityCanvases.set(config.id, {
            id: config.id,
            suspended: false,
            at: config.frame,
        });
    } catch (error) {
        if (!current) {
            try {
                await host.canvasResume(config.id);
                liveJs.utilityCanvases.set(config.id, {
                    id: config.id,
                    suspended: false,
                    at: config.frame,
                });
                return;
            } catch (_) {
                // Fall through to the original warning below.
            }
        }
        console.warn('[sigil] utility toggle failed:', kind, error);
    }
}

function projectAvatarToScene(screenX, screenY, yOffset = 0) {
    const local = desktopWorldToSegmentLocalPoint({ x: screenX, y: screenY }) ?? { x: screenX, y: screenY };
    const vec = new THREE.Vector3();
    vec.set(
        (local.x / window.innerWidth) * 2 - 1,
        -(local.y / window.innerHeight) * 2 + 1,
        0.5
    );
    vec.unproject(state.perspCamera);
    vec.sub(state.perspCamera.position).normalize();
    const distance = -state.perspCamera.position.z / vec.z;
    const pos = new THREE.Vector3().copy(state.perspCamera.position).add(vec.multiplyScalar(distance));
    pos.y += yOffset / 10;
    return pos;
}

function initScene() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    state.scene = new THREE.Scene();
    state.perspCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    state.orthoCamera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 1000);
    state.camera = state.perspCamera;
    state.camera.position.z = 20;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(width, height);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setClearColor(0x000000, 0);
    document.body.appendChild(state.renderer.domElement);

    state.pointLight = new THREE.PointLight(0xffffff, 2, 50);
    state.scene.add(state.pointLight);
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    state.polyGroup = new THREE.Group();
    state.scene.add(state.polyGroup);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (state.camera === state.perspCamera) {
        state.camera.aspect = width / height;
    } else {
        state.camera.left = -width / 2;
        state.camera.right = width / 2;
        state.camera.top = height / 2;
        state.camera.bottom = -height / 2;
    }
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height);
}

function setInteractionState(next, reason) {
    if (liveJs.currentState === next) return;
    console.log('[sigil] state:', liveJs.currentState, '→', next, reason ? '(' + reason + ')' : '');
    liveJs.currentState = next;
    liveJs.state = next;
    if (next === 'IDLE' && !liveJs.travel) postLastPositionToDaemon();
}

function postLastPositionToDaemon() {
    if (!isPrimarySurfaceSegment()) return;
    const agentId = liveJs.currentAgentId;
    const position = liveJs.avatarPos;
    if (!agentId || !position?.valid) return;
    const nativePoint = desktopWorldToNativePoint(position, liveJs.displays) || position;
    host.positionSet(agentId, nativePoint);
}

window.postLastPositionToDaemon = postLastPositionToDaemon;
window.postToHost = host.post;

function isOnAvatar(x, y) {
    if (!liveJs.avatarPos.valid || state.appScale <= 0.05) return false;
    const dx = x - liveJs.avatarPos.x;
    const dy = y - liveJs.avatarPos.y;
    return ((dx * dx) + (dy * dy)) <= (liveJs.avatarHitRadius * liveJs.avatarHitRadius);
}

function setAvatarHover(over) {
    const next = !!over;
    if (liveJs.avatarHover === next) return;
    liveJs.avatarHover = next;
    scheduleRenderFrame();
}

function updateAvatarHoverFromPoint(x, y) {
    if (!liveJs.avatarVisible || contextMenu.isOpen()) {
        setAvatarHover(false);
        return;
    }
    if (!['IDLE', 'GOTO', 'PRESS'].includes(liveJs.currentState)) {
        setAvatarHover(false);
        return;
    }
    setAvatarHover(isOnAvatar(x, y));
}

function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

function clearGestureState() {
    liveJs.mousedownPos = null;
    liveJs.mousedownAvatarPos = null;
    liveJs.radialGestureMenu = null;
    setAvatarHover(false);
}

const visibilityTransition = createVisibilityTransitionController({
    host,
    state,
    liveJs,
    projectStagePoint: stagePoint,
    getExcludedCanvasIds() {
        return ['avatar-main', hitTarget.hit.id].filter(Boolean);
    },
});

const fastTravel = createFastTravelController({
    host,
    state,
    liveJs,
    projectStagePoint: stagePoint,
    getExcludedCanvasIds() {
        return ['avatar-main', hitTarget.hit.id].filter(Boolean);
    },
    canCaptureDisplayImages: isPrimarySurfaceSegment,
});
const radialGestureMenu = createSigilRadialGestureMenu({
    state,
    onCommitItem(item) {
        if (item?.action === 'contextMenu') {
            openContextMenuAt(liveJs.avatarPos.x, liveJs.avatarPos.y, { force: true });
            return;
        }
        if (item?.action === 'wikiGraph') {
            host.post('sigil.radial_menu.action', {
                action: 'wikiGraph',
                status: 'stub',
            });
            return;
        }
        host.post('sigil.radial_menu.action', {
            action: item?.action || item?.id || 'unknown',
        });
    },
});
let omegaTrailTravelKey = null;

function travelVectorKey(travel) {
    if (!travel) return null;
    const from = travel.from ?? { x: travel.fromX, y: travel.fromY };
    const to = travel.to ?? { x: travel.toX, y: travel.toY };
    if (!Number.isFinite(Number(from.x)) || !Number.isFinite(Number(from.y))) return null;
    if (!Number.isFinite(Number(to.x)) || !Number.isFinite(Number(to.y))) return null;
    return [
        travel.effect,
        Math.round(Number(from.x) || 0),
        Math.round(Number(from.y) || 0),
        Math.round(Number(to.x) || 0),
        Math.round(Number(to.y) || 0),
        Math.round(Number(travel.startMs) || 0),
    ].join(':');
}

function syncOmegaTrailToTravelOrigin() {
    const travel = liveJs.travel;
    const key = travelVectorKey(travel);
    if (!key) {
        omegaTrailTravelKey = null;
        return;
    }
    if (omegaTrailTravelKey === key) return;
    omegaTrailTravelKey = key;
    const origin = travel.from ?? { x: travel.fromX, y: travel.fromY, valid: true };
    if (!origin?.valid) return;
    resetOmegaInterdimensionalTrail(projectAvatarToScene(origin.x, origin.y));
}

function queueFastTravel(x, y) {
    fastTravel.start(x, y, { pointer: { x, y, valid: true } });
    syncOmegaTrailToTravelOrigin();
    if (desktopWorldSurface?.isPrimary) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(liveJs.avatarPos));
    }
}

function emitStatusItemState() {
    if (!isPrimarySurfaceSegment()) return;
    host.post('status_item.state', {
        visible: liveJs.avatarVisible,
    });
}

// canvas_object.marks — publish the avatar's current desktop position so the
// canvas-inspector can mark it on its minimap and indented tree list.
// Event-driven via setAvatarPosition + visibility changes; a ~5 s heartbeat
// keeps the mark alive inside the inspector's 10 s TTL while idle-visible.
const MARKS_CANVAS_ID = 'avatar-main';
const MARKS_OBJECT_ID = 'avatar';
const MARKS_HEARTBEAT_MS = 5000;
let _lastMarkEmitAt = 0;

function emitAvatarMark() {
    if (!isPrimarySurfaceSegment()) return;
    if (!liveJs.avatarPos.valid) return;
    if (!liveJs.avatarVisible) {
        host.post('canvas_object.marks', {
            canvas_id: MARKS_CANVAS_ID,
            objects: [],
        });
        _lastMarkEmitAt = performance.now();
        return;
    }
    host.post('canvas_object.marks', {
        canvas_id: MARKS_CANVAS_ID,
        objects: [{
            id: MARKS_OBJECT_ID,
            x: Math.round(liveJs.avatarPos.x),
            y: Math.round(liveJs.avatarPos.y),
            name: 'Avatar',
        }],
    });
    _lastMarkEmitAt = performance.now();
}

function startMarkHeartbeat() {
    if (startMarkHeartbeat._started) return;
    startMarkHeartbeat._started = true;
    setInterval(() => {
        if (!isPrimarySurfaceSegment()) return;
        if (!liveJs.avatarVisible || !liveJs.avatarPos.valid) return;
        if (performance.now() - _lastMarkEmitAt < MARKS_HEARTBEAT_MS - 500) return;
        emitAvatarMark();
    }, MARKS_HEARTBEAT_MS);
}

function setAvatarVisibility(visible) {
    const next = !!visible;
    if (liveJs.avatarVisible === next && !visibilityTransition.active) return;
    liveJs.avatarVisible = next;
    if (!next) {
        contextMenu.close('avatar-hidden');
        radialGestureMenu.cancel('avatar-hidden');
        clearGestureState();
        liveJs.currentState = 'IDLE';
        liveJs.state = 'IDLE';
    }
    emitStatusItemState();
    emitAvatarMark();
}

function animateVisibility(visible, lifecycleAction = null, origin = null) {
    const targetVisible = !!visible;
    if (liveJs.avatarVisible === targetVisible && !visibilityTransition.active) return;
    if (targetVisible) setAvatarVisibility(true);
    visibilityTransition.begin({
        targetVisible,
        lifecycleAction,
        origin,
        avatarPos: liveJs.avatarPos.valid ? { ...liveJs.avatarPos } : null,
    });
}

function toggleAvatarVisibility(origin = null) {
    animateVisibility(!liveJs.avatarVisible, null, origin);
}

function setAvatarPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = liveJs.displays.length > 0
        ? clampPointToDisplays(liveJs.displays, x, y)
        : { x, y };
    liveJs.avatarPos = { x: next.x, y: next.y, valid: true };
    postLastPositionToDaemon();
    emitAvatarMark();
}

function syncHitTargetToAvatar() {
    if (!isPrimarySurfaceSegment() || !liveJs.avatarPos.valid) return;
    hitTarget.setSize(state.avatarHitRadius * 2);
    const nativeAvatarPos = desktopWorldToNativePoint(liveJs.avatarPos, liveJs.displays) || liveJs.avatarPos;
    nativeAvatarPos.valid = true;
    hitTarget.sync(nativeAvatarPos, liveJs.avatarVisible && ['IDLE', 'PRESS', 'RADIAL', 'FAST_TRAVEL'].includes(liveJs.currentState));
}

function cancelInteraction(reason) {
    if (liveJs.currentState === 'IDLE') return;
    radialGestureMenu.cancel(reason);
    clearGestureState();
    fastTravel.clearGesture(reason);
    setInteractionState('IDLE', reason);
}

let lastContextMenuOpenAt = 0;
let lastContextMenuOpenPoint = null;

function isDuplicateContextMenuOpenClick(x, y) {
    if (!lastContextMenuOpenPoint) return false;
    if (performance.now() - lastContextMenuOpenAt > 500) return false;
    return distance(x, y, lastContextMenuOpenPoint.x, lastContextMenuOpenPoint.y) <= 2;
}

function openContextMenuAt(x, y, options = {}) {
    if (!liveJs.avatarVisible) return false;
    if (!options.force && (liveJs.currentState !== 'IDLE' || !isOnAvatar(x, y))) return false;
    cancelInteraction('context-menu');
    contextMenu.openAt({ x, y, valid: true });
    lastContextMenuOpenAt = performance.now();
    lastContextMenuOpenPoint = { x, y };
    return true;
}

function applyRadialGestureMove(update, x, y) {
    liveJs.radialGestureMenu = update?.snapshot ?? radialGestureMenu.snapshot();
    if (update?.enteredFastTravel) {
        fastTravel.beginGesture({ ...liveJs.avatarPos });
        fastTravel.updateGesture({ x, y, valid: true });
        setInteractionState('FAST_TRAVEL', 'radial-handoff-fast-travel');
        return true;
    }
    if (update?.reenteredRadial) {
        fastTravel.clearGesture('radial-reentry');
        setInteractionState('RADIAL', 'radial-reentry');
        return true;
    }
    if (liveJs.currentState === 'FAST_TRAVEL') {
        fastTravel.updateGesture({ x, y, valid: true });
    }
    return false;
}

function handleLeftMouseDown(x, y) {
    switch (liveJs.currentState) {
        case 'IDLE':
            if (!isOnAvatar(x, y)) return;
            liveJs.mousedownPos = { x, y };
            liveJs.mousedownAvatarPos = { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y };
            setInteractionState('PRESS', 'mousedown-on-avatar');
            return;
        case 'GOTO':
            if (isOnAvatar(x, y)) {
                clearGestureState();
                setInteractionState('IDLE', 'goto-click-on-avatar');
                return;
            }
            liveJs.mousedownPos = { x, y };
            return;
        default:
            return;
    }
}

function handleLeftMouseUp(x, y) {
    switch (liveJs.currentState) {
        case 'PRESS':
            clearGestureState();
            fastTravel.clearGesture('press-click');
            setInteractionState('GOTO', 'press-click');
            return;
        case 'RADIAL': {
            const result = radialGestureMenu.release({ x, y, valid: true });
            clearGestureState();
            fastTravel.clearGesture(result?.committed?.type === 'item' ? 'radial-item' : 'radial-release');
            setInteractionState('IDLE', result?.committed?.type === 'item' ? 'radial-release-item' : 'radial-release-cancel');
            return;
        }
        case 'FAST_TRAVEL': {
            const result = radialGestureMenu.release({ x, y, valid: true });
            clearGestureState();
            if (result?.committed?.type === 'fastTravel') {
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'radial-release-fast-travel');
                return;
            }
            fastTravel.clearGesture('radial-fast-travel-cancel');
            setInteractionState('IDLE', 'radial-fast-travel-cancel');
            return;
        }
        case 'GOTO':
            clearGestureState();
            if (!isOnAvatar(x, y)) {
                queueFastTravel(x, y);
                setInteractionState('IDLE', 'goto-release-fast-travel');
            }
            return;
        default:
            return;
    }
}

function handleMouseMove(x, y) {
    if (liveJs.currentState === 'RADIAL' || liveJs.currentState === 'FAST_TRAVEL') {
        const update = radialGestureMenu.move({ x, y, valid: true });
        applyRadialGestureMove(update, x, y);
        return;
    }
    if (liveJs.currentState !== 'PRESS' || !liveJs.mousedownPos) return;
    if (distance(x, y, liveJs.mousedownPos.x, liveJs.mousedownPos.y) < liveJs.dragThreshold) return;
    liveJs.radialGestureMenu = radialGestureMenu.start(
        { ...liveJs.avatarPos, valid: true },
        { x, y, valid: true }
    );
    if (applyRadialGestureMove(radialGestureMenu.move({ x, y, valid: true }), x, y)) return;
    setInteractionState('RADIAL', 'press-threshold-radial');
}

function handleInputEvent(msg) {
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
        liveJs.pointerPos = { x: msg.x, y: msg.y };
        liveJs.cursorTarget = { x: msg.x, y: msg.y, valid: true };
        if (!liveJs.currentCursor.valid) {
            liveJs.currentCursor = { x: msg.x, y: msg.y, valid: true };
        }
        if (msg.type === 'mouse_moved') updateAvatarHoverFromPoint(msg.x, msg.y);
    }

    if (
        contextMenu.isOpen()
        && ['left_mouse_down', 'left_mouse_dragged', 'left_mouse_up', 'mouse_moved', 'scroll_wheel'].includes(msg.type)
        && typeof msg.x === 'number'
        && typeof msg.y === 'number'
    ) {
        const point = { x: msg.x, y: msg.y, valid: true };
        const inMenu = contextMenu.containsDesktopPoint(point);
        if ((inMenu || msg.type !== 'left_mouse_down') && contextMenu.handlePointerEvent(msg.type, point, { raw: msg })) {
            return;
        }
        if (msg.type === 'left_mouse_down') {
            contextMenu.close('outside-click');
        }
    }

    switch (msg.type) {
        case 'left_mouse_down':
            handleLeftMouseDown(msg.x, msg.y);
            return;
        case 'left_mouse_up':
            handleLeftMouseUp(msg.x, msg.y);
            return;
        case 'left_mouse_dragged':
        case 'mouse_moved':
            handleMouseMove(msg.x, msg.y);
            return;
        case 'right_mouse_down':
            if (contextMenu.isOpen()) {
                if (
                    typeof msg.x === 'number'
                    && typeof msg.y === 'number'
                    && isDuplicateContextMenuOpenClick(msg.x, msg.y)
                ) {
                    return;
                }
                contextMenu.close('right-click-toggle');
                cancelInteraction('right-click-toggle');
                return;
            }
            if (typeof msg.x === 'number' && typeof msg.y === 'number' && openContextMenuAt(msg.x, msg.y)) return;
            contextMenu.close('right-click-away');
            cancelInteraction('right-click');
            return;
        case 'key_down':
            if (msg.key_code === 53) {
                contextMenu.close('escape');
                cancelInteraction('escape');
            }
            return;
        default:
            return;
    }
}

function pointFromHitPayload(payload = {}) {
    const localX = Number(payload.offsetX);
    const localY = Number(payload.offsetY);
    const frame = hitTarget.hit.frame;
    if (Number.isFinite(localX) && Number.isFinite(localY) && Array.isArray(frame) && frame.length >= 4) {
        const nativePoint = {
            x: Number(frame[0]) + localX,
            y: Number(frame[1]) + localY,
        };
        return nativeToDesktopWorldPoint(nativePoint, liveJs.displays) ?? nativePoint;
    }

    const screenX = Number(payload.x ?? payload.screenX);
    const screenY = Number(payload.y ?? payload.screenY);
    if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
        return nativeToDesktopWorldPoint({ x: screenX, y: screenY }, liveJs.displays) ?? { x: screenX, y: screenY };
    }
    return null;
}

function nativeFrameFromDesktopRect(rect) {
    if (!rect) return null;
    const native = desktopWorldToNativePoint({ x: rect.x, y: rect.y }, liveJs.displays);
    if (!native) return null;
    return [native.x, native.y, rect.w, rect.h];
}

function handleHitCanvasEvent(payload = {}) {
    if (payload.source !== 'sigil-hit') return;
    const isLeftHitEvent = payload.kind === 'left_mouse_down'
        || payload.kind === 'left_mouse_dragged'
        || payload.kind === 'left_mouse_up';
    if (payload.kind === 'left_mouse_down' || payload.kind === 'left_mouse_dragged' || payload.kind === 'left_mouse_up') {
        if (!contextMenu.isOpen()) return;
    }
    const point = pointFromHitPayload(payload);
    if (!point) return;
    if (isLeftHitEvent && !contextMenu.containsDesktopPoint(point)) return;
    handleInputEvent({
        type: payload.kind,
        x: point.x,
        y: point.y,
        dx: payload.dx,
        dy: payload.dy,
        fromHitTarget: true,
    });
}

function originFromMessage(msg = {}) {
    const x = Number(msg.origin_x ?? msg.originX);
    const y = Number(msg.origin_y ?? msg.originY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return nativeToDesktopWorldPoint({ x, y }, liveJs.displays) ?? { x, y, valid: true };
}

function handleHostMessage(rawMsg) {
    const msg = normalizeMessage(rawMsg);
    if (!shouldProcessGlobalDaemonEvent(msg)) return;

    if (msg.type === 'canvas_lifecycle') {
        const canvasId = msg.canvas_id || msg.canvas?.id;
        if (canvasId === '__log__' || canvasId === 'canvas-inspector') {
            if (msg.action === 'removed') {
                liveJs.utilityCanvases.delete(canvasId);
            } else {
                liveJs.utilityCanvases.set(canvasId, {
                    ...(msg.canvas || {}),
                    id: canvasId,
                    suspended: msg.suspended ?? msg.canvas?.suspended ?? false,
                    at: msg.at ?? msg.canvas?.at ?? null,
                });
            }
        }
        return;
    }

    if (msg.type === 'live_appearance') {
        if (msg.appearance) applyAppearance(msg.appearance);
        markAppearanceChanged();
        return;
    }

    if (msg.type === 'status_item.toggle') {
        const origin = originFromMessage(msg);
        if (msg.target_state === 'visible') animateVisibility(true, 'enter', origin);
        else if (msg.target_state === 'hidden') animateVisibility(false, 'exit', origin);
        else toggleAvatarVisibility(origin);
        return;
    }

    if (msg.type === 'status_item.show') {
        animateVisibility(true, null, originFromMessage(msg));
        return;
    }

    if (msg.type === 'status_item.hide') {
        animateVisibility(false, null, originFromMessage(msg));
        return;
    }

    if (msg.type === 'sigil.set_position') {
        setAvatarPosition(Number(msg.x), Number(msg.y));
        return;
    }

    if (msg.type === 'sigil.set_effects') {
        if (typeof msg.paused === 'boolean') state.isPaused = msg.paused;
        return;
    }

    if (msg.type === 'sigil.set_geometry') {
        if (Number.isFinite(Number(msg.geometry))) {
            updateGeometry(Number(msg.geometry));
            markAppearanceChanged();
        }
        return;
    }

    if (msg.type === 'lifecycle') {
        const origin = originFromMessage(msg);
        if (msg.action === 'enter') {
            animateVisibility(true, 'enter', origin);
        } else if (msg.action === 'exit') {
            animateVisibility(false, 'exit', origin);
        } else if (msg.action === 'suspend') {
            rendererSuspended = true;
            renderLoop.suspend();
        } else if (msg.action === 'resume') {
            rendererSuspended = false;
            renderLoop.resume();
            liveJs._pendingLifecycleComplete = 'resume';
            scheduleRenderFrame();
        }
        return;
    }

    if (msg.type === 'display_geometry') {
        liveJs.displays = normalizeDisplays(msg.displays || []);
        liveJs.globalBounds = boundsWithMinMax(msg.desktop_world_bounds)
            ?? computeDesktopWorldBounds(liveJs.displays);
        liveJs.visibleBounds = boundsWithMinMax(msg.visible_desktop_world_bounds)
            ?? computeVisibleDesktopWorldBounds(liveJs.displays);
        if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
            const resolve = liveJs._resolveFirstDisplayGeometry;
            liveJs._resolveFirstDisplayGeometry = null;
            recordBoot('boot:firstDisplayGeometry', { displays: liveJs.displays.length, boot_elapsed_ms: bootElapsedMs() });
            resolve(liveJs.displays);
        }
        return;
    }

    if (msg.type === 'canvas_message' && msg.id === hitTarget.hit.id) {
        handleHitCanvasEvent(msg.payload || {});
        return;
    }

    if (INPUT_POINTER_EVENT_TYPES.has(msg.type) && typeof msg.x === 'number' && typeof msg.y === 'number') {
        const worldPoint = nativeToDesktopWorldPoint({ x: msg.x, y: msg.y }, liveJs.displays) ?? { x: msg.x, y: msg.y };
        handleInputEvent({ ...msg, x: worldPoint.x, y: worldPoint.y });
        return;
    }

    handleInputEvent(msg);
}

function awaitFirstDisplayGeometry() {
    if (liveJs.displays.length > 0) return Promise.resolve(liveJs.displays);
    recordBoot('boot:awaitFirstDisplayGeometry');
    return new Promise((resolve) => {
        liveJs._resolveFirstDisplayGeometry = resolve;
    });
}

async function getLastPositionFromDaemon(agentId) {
    try {
        return await host.positionGet(agentId, { timeoutMs: 250 });
    } catch (error) {
        console.warn('[sigil] lastPosition lookup failed; falling back to birthplace:', error);
        return null;
    }
}

let primarySurfaceServicesStarted = false;

function startPrimarySurfaceServices() {
    if (primarySurfaceServicesStarted) return;
    primarySurfaceServicesStarted = true;
    host.subscribe(['display_geometry', 'input_event', 'canvas_message', 'canvas_lifecycle'], { snapshot: true });
    startMarkHeartbeat();
    void hitTarget.ensureCreated().catch((error) => {
        console.error('[sigil] avatar hit target create failed:', error);
    });
}

async function setupHostSurface() {
    host.install();
    host.onMessage(handleHostMessage);
    overlay.mount();
    visibilityTransition.mount();
    fastTravel.mount();

    if (!desktopWorldSurface) {
        startPrimarySurfaceServices();
        return;
    }

    await desktopWorldSurface.start({
        onInit({ topology }) {
            syncTopologyDisplays(topology);
            desktopWorldSurface.runOnPrimary(() => startPrimarySurfaceServices());
        },
        onTopologyChange({ topology }) {
            syncTopologyDisplays(topology);
            onWindowResize();
            desktopWorldSurface.refreshCamera(state.camera);
        },
        becamePrimary() {
            startPrimarySurfaceServices();
        },
        onState(snapshot) {
            applySurfaceRenderSnapshot(snapshot);
        },
    });
    desktopWorldSurface.mountScene({
        scene: state.scene,
        camera: state.camera,
        renderer: state.renderer,
    });
}

async function init() {
    runBootStep('initScene', () => initScene());
    runBootStep('createRadialGestureVisuals', () => {
        radialGestureVisuals = createSigilRadialGestureVisuals({
            scene: state.scene,
            projectPoint: (point) => point?.valid === false ? null : projectAvatarToScene(point.x, point.y),
            projectRadius(point, radius) {
                if (!point || point.valid === false) return null;
                const center = projectAvatarToScene(point.x, point.y);
                const edge = projectAvatarToScene(point.x + radius, point.y);
                return center.distanceTo(edge);
            },
        });
    });
    runBootStep('createAuraObjects', () => createAuraObjects());
    runBootStep('createParticleObjects', () => createParticleObjects());
    runBootStep('createPhenomena', () => createPhenomena());
    runBootStep('createLightning', () => createLightning());
    runBootStep('createMagneticField', () => createMagneticField());
    runBootStep('createOmega', () => createOmega());
    runBootStep('updateGeometry', () => updateGeometry(state.currentGeometryType ?? state.currentType));
    runBootStep('updateAllColors', () => updateAllColors());
    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);
    await runBootStep('setupHostSurface', () => setupHostSurface());
    if (!rendererSuspended) scheduleRenderFrame();
}

function clearHiddenFrame(renderAvatarPos) {
    state.appScale = 0;
    state.polyGroup.scale.setScalar(0);
    if (state.omegaGroup) state.omegaGroup.visible = false;
    if (isPrimarySurfaceSegment()) {
        hitTarget.sync({ x: -10000, y: -10000, valid: true }, false);
    }
    overlay.draw({ state: 'IDLE', avatarPos: null, dragOrigin: null });
    radialGestureVisuals?.reset?.();
    visibilityTransition.draw({ avatarStagePos: null });
    fastTravel.draw();
    state.renderer.clear(true, true, true);

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    if (desktopWorldSurface?.isPrimary) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(renderAvatarPos));
    }
    if (isPrimarySurfaceSegment() && liveJs._pendingLifecycleComplete) {
        host.post('lifecycle.complete', { action: liveJs._pendingLifecycleComplete });
        liveJs._pendingLifecycleComplete = null;
    }
    scheduleRenderFrame();
}

function animate() {
    if (rendererSuspended) return;

    const dt = 0.016;
    const primarySegment = isPrimarySurfaceSegment();
    if (primarySegment || !Number.isFinite(liveJs.surfaceRenderSnapshot?.globalTime)) {
        state.globalTime += dt;
    } else {
        state.globalTime = liveJs.surfaceRenderSnapshot.globalTime;
    }

    let renderAvatarPos = liveJs.surfaceRenderSnapshot?.renderAvatarPos?.valid
        ? liveJs.surfaceRenderSnapshot.renderAvatarPos
        : liveJs.avatarPos;

    const fastTravelState = liveJs.travel
        ? (
            primarySegment
                ? fastTravel.tick(dt, () => {
                    postLastPositionToDaemon();
                    syncHitTargetToAvatar();
                })
                : fastTravel.preview()
        )
        : null;

    if (primarySegment) {
        renderAvatarPos = liveJs.avatarPos;
        const transitionState = visibilityTransition.active
            ? visibilityTransition.tick(dt, { avatarPos: liveJs.avatarPos.valid ? { ...liveJs.avatarPos } : null })
            : null;
        if (transitionState?.appScale != null) {
            state.appScale = transitionState.appScale;
        }
        if (transitionState?.avatarPos?.valid) {
            renderAvatarPos = transitionState.avatarPos;
        }
        if (transitionState && !transitionState.active) {
            state.appScale = transitionState.appScale;
            setAvatarVisibility(transitionState.targetVisible);
            if (transitionState.lifecycleAction) {
                host.post('lifecycle.complete', { action: transitionState.lifecycleAction });
            }
        }
    }
    if (fastTravelState?.appScale != null) {
        state.appScale = fastTravelState.appScale;
    }
    if (fastTravelState?.avatarPos?.valid) {
        renderAvatarPos = fastTravelState.avatarPos;
    }

    const visualActive = liveJs.avatarVisible
        || !!visibilityTransition.active
        || !!liveJs.travel
        || state.appScale > 0.001;
    if (!visualActive) {
        clearHiddenFrame(renderAvatarPos);
        return;
    }

    if (renderAvatarPos.valid) {
        const avatarStagePos = stagePoint(renderAvatarPos);
        const projected = projectAvatarToScene(renderAvatarPos.x, renderAvatarPos.y);
        state.polyGroup.position.copy(projected);
        state.pointLight.position.copy(state.polyGroup.position);
        window.__sigilRenderDebug = {
            desktopWorld: {
                x: Math.round(renderAvatarPos.x),
                y: Math.round(renderAvatarPos.y),
            },
            stage_local: avatarStagePos ? {
                x: Math.round(avatarStagePos.x),
                y: Math.round(avatarStagePos.y),
            } : null,
            globalBounds: liveJs.globalBounds,
        };
    }

    if (!state.isPaused) {
        state.polyGroup.rotation.y += 0.005;
        state.polyGroup.rotation.x += 0.002;
    }

    const hoverTarget = liveJs.avatarHover && liveJs.avatarVisible && liveJs.currentState === 'IDLE' ? 1 : 0;
    liveJs.avatarHoverProgress += (hoverTarget - liveJs.avatarHoverProgress) * Math.min(1, dt * 14);

    animateParticles(dt);
    animatePhenomena(dt);
    animateAura(dt);
    animateLightning(dt);
    animateMagneticField(dt);
    animateOmega(dt);
    animateSkins(dt);
    animateTrails(dt);
    updateInnerEdgePulse(false);
    updateInnerEdgePulse(true);

    contextMenu.updateSegmentPosition();

    if (primarySegment && contextMenu.isOpen()) {
        const frame = nativeFrameFromDesktopRect(contextMenu.interactiveBounds());
        if (frame) hitTarget.syncFrame(frame, true);
    } else if (primarySegment && liveJs.avatarPos.valid) {
        syncHitTargetToAvatar();
    }
    const avatarStagePos = stagePoint(renderAvatarPos);
    const dragOriginStage = stagePoint(liveJs.mousedownAvatarPos);
    overlay.draw({
        state: liveJs.currentState,
        avatarPos: avatarStagePos,
        dragOrigin: dragOriginStage,
        avatarHover: liveJs.avatarHover,
        avatarHoverProgress: liveJs.avatarHoverProgress,
        radialGesture: projectRadialGestureSnapshot(liveJs.radialGestureMenu),
        fastTravelEffect: state.transitionFastTravelEffect,
        time: state.globalTime,
        gotoRingRadius: liveJs.gotoRingRadius,
        avatarHitRadius: liveJs.avatarHitRadius,
        menuRingRadius: liveJs.menuRingRadius,
        dragCancelRadius: liveJs.dragCancelRadius,
    });
    radialGestureVisuals?.update(liveJs.radialGestureMenu, { time: state.globalTime });
    visibilityTransition.draw({ avatarStagePos });
    fastTravel.draw();

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale * (1 + liveJs.avatarHoverProgress * 0.055));
    if (desktopWorldSurface?.isPrimary) {
        desktopWorldSurface.publishState(surfaceRenderSnapshot(renderAvatarPos));
    }
    state.renderer.render(state.scene, state.camera);

    if (primarySegment && liveJs._pendingLifecycleComplete) {
        host.post('lifecycle.complete', { action: liveJs._pendingLifecycleComplete });
        liveJs._pendingLifecycleComplete = null;
    }

    scheduleRenderFrame();
}

window.__sigilDebug = {
    dispatch(msg) {
        handleHostMessage(msg);
        return liveJs.currentState;
    },
    dispatchDesktop(msg) {
        handleInputEvent(msg);
        return liveJs.currentState;
    },
    snapshot() {
        return {
            state: liveJs.currentState,
            avatarPos: liveJs.avatarPos,
            travel: liveJs.travel,
            fastTravel: fastTravel.exportSnapshot(),
            radialGestureMenu: liveJs.radialGestureMenu,
            radialGestureVisuals: radialGestureVisuals?.snapshot?.() ?? null,
            avatarHover: liveJs.avatarHover,
            avatarHoverProgress: liveJs.avatarHoverProgress,
            contextMenu: contextMenu?.snapshot?.(),
            fastTravelEffect: state.transitionFastTravelEffect,
            fastTravelEvents: liveJs.fastTravelEvents,
            avatarVisible: liveJs.avatarVisible,
            hitTargetId: hitTarget.hit.id,
            hitTargetReady: hitTarget.hit.ready,
            hitTargetFrame: hitTarget.hit.frame,
            hitTargetInteractive: hitTarget.hit.interactive,
            transition: visibilityTransition.active?.effect ?? null,
            surface: desktopWorldSurface ? {
                segment: desktopWorldSurface.segment,
                isPrimary: desktopWorldSurface.isPrimary,
                latency: desktopWorldSurface.stateLatencySnapshot(),
            } : null,
        };
    },
    avatarDefinition,
    importAvatarDefinitionText,
    fastTravelPreview() {
        return fastTravel.preview();
    },
};

export async function boot() {
    recordBoot('boot:start');

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    const defaultAvatarPromise = runBootStep('loadDefaultAvatarDefinition', () => loadDefaultAvatarDefinition({ apply: false }));
    await runBootStep('init', () => init());

    const displaysStartedAt = performance.now();
    const displaysPromise = awaitFirstDisplayGeometry().then((displays) => {
        recordBootDuration('boot:awaitFirstDisplayGeometry', displaysStartedAt, { displays: displays.length });
        return displays;
    });
    const [displays, defaultAvatar] = await Promise.all([displaysPromise, defaultAvatarPromise]);
    runBootStep('applyDefaultAvatarDefinition', () => applyDefaultAvatarDefinition(defaultAvatar));

    recordBoot('boot:displayReady', { displays: displays.length });

    let position = await getLastPositionFromDaemon(liveJs.currentAgentId);
    if (position) {
        position = nativeToDesktopWorldPoint(position, displays) ?? position;
    }
    if (!position) {
        position = resolveBirthplace(liveJs.currentAgentDefinition?.instance?.birthplace ?? {
            anchor: 'nonant',
            nonant: 'bottom-right',
            display: 'main',
        }, displays);
    }
    liveJs.avatarPos = { x: position.x, y: position.y, valid: true };
    state.appScale = 0;
    setAvatarVisibility(false);

    recordBoot('boot:avatarPositionReady', {
        x: Math.round(liveJs.avatarPos.x),
        y: Math.round(liveJs.avatarPos.y),
        boot_elapsed_ms: bootElapsedMs(),
    });
    emitStatusItemState();
}
