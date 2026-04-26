import state from '../state.js';
import { updateGeometry, updateInnerEdgePulse } from '../geometry.js';
import { updateAllColors } from '../colors.js';
import { createAuraObjects, animateAura } from '../aura.js';
import { createPhenomena, animatePhenomena } from '../phenomena.js';
import { createParticleObjects, animateParticles, animateTrails } from '../particles.js';
import { createLightning, animateLightning } from '../lightning.js';
import { createMagneticField, animateMagneticField } from '../magnetic.js';
import { createOmega, animateOmega } from '../omega.js';
import { animateSkins } from '../skins.js';
import { applyAppearance, DEFAULT_APPEARANCE } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';
import { createRenderLoopScheduler } from './render-loop.js';
import { createHostRuntime } from './host-runtime.js';
import { createInteractionOverlay } from './interaction-overlay.js';
import { createHitTargetController } from './hit-target.js';
import { createVisibilityTransitionController } from './visibility-transition.js';
import { DesktopWorldSurface3D } from './desktop-world-surface-runtime.js';
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
    currentCursor: { x: 0, y: 0, valid: false },
    cursorTarget: { x: 0, y: 0, valid: false },
    globalBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visibleBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    displays: [],
    currentState: 'IDLE',
    state: 'IDLE',
    currentAgentId: 'default',
    avatarHitRadius: state.avatarHitRadius,
    dragThreshold: state.dragThreshold,
    dragCancelRadius: state.dragCancelRadius,
    gotoRingRadius: state.gotoRingRadius,
    menuRingRadius: state.menuRingRadius,
    travel: null,
    fastTravelEvents: [],
    mousedownPos: null,
    mousedownAvatarPos: null,
    avatarVisible: false,
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
    if (msg.type === 'input_event') return false;
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
    if (snapshot.avatarPos?.valid) liveJs.avatarPos = { ...snapshot.avatarPos };
    if (snapshot.renderAvatarPos?.valid) liveJs.surfaceRenderSnapshot = snapshot;
    if (snapshot.pointerPos) liveJs.pointerPos = { ...snapshot.pointerPos };
    if (typeof snapshot.avatarVisible === 'boolean') liveJs.avatarVisible = snapshot.avatarVisible;
    if (snapshot.currentState) {
        liveJs.currentState = snapshot.currentState;
        liveJs.state = snapshot.currentState;
    }
    if (Number.isFinite(snapshot.appScale)) state.appScale = snapshot.appScale;
    if (Number.isFinite(snapshot.globalTime)) state.globalTime = snapshot.globalTime;
}

function surfaceRenderSnapshot(renderAvatarPos) {
    return {
        avatarPos: liveJs.avatarPos,
        renderAvatarPos,
        pointerPos: liveJs.pointerPos,
        avatarVisible: liveJs.avatarVisible,
        currentState: liveJs.currentState,
        appScale: state.appScale,
        globalTime: state.globalTime,
    };
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

function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

function clearGestureState() {
    liveJs.mousedownPos = null;
    liveJs.mousedownAvatarPos = null;
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
});

function queueFastTravel(x, y) {
    fastTravel.start(x, y, { pointer: { x, y, valid: true } });
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

function cancelInteraction(reason) {
    if (liveJs.currentState === 'IDLE') return;
    clearGestureState();
    fastTravel.clearGesture(reason);
    setInteractionState('IDLE', reason);
}

function handleLeftMouseDown(x, y) {
    switch (liveJs.currentState) {
        case 'IDLE':
            if (!isOnAvatar(x, y)) return;
            liveJs.mousedownPos = { x, y };
            liveJs.mousedownAvatarPos = { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y };
            fastTravel.beginGesture({ ...liveJs.avatarPos });
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
        case 'DRAG': {
            const origin = liveJs.mousedownAvatarPos;
            const distFromOrigin = origin ? distance(x, y, origin.x, origin.y) : Infinity;
            clearGestureState();
            if (distFromOrigin <= liveJs.dragCancelRadius) {
                fastTravel.clearGesture('drag-cancel');
                setInteractionState('IDLE', 'drag-cancel');
                return;
            }
            queueFastTravel(x, y);
            setInteractionState('IDLE', 'drag-release-fast-travel');
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
    if ((liveJs.currentState === 'PRESS' || liveJs.currentState === 'DRAG') && liveJs.mousedownPos) {
        fastTravel.updateGesture({ x, y, valid: true });
    }
    if (liveJs.currentState !== 'PRESS' || !liveJs.mousedownPos) return;
    if (distance(x, y, liveJs.mousedownPos.x, liveJs.mousedownPos.y) < liveJs.dragThreshold) return;
    setInteractionState('DRAG', 'press-threshold');
}

function handleInputEvent(msg) {
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
        liveJs.pointerPos = { x: msg.x, y: msg.y };
        liveJs.cursorTarget = { x: msg.x, y: msg.y, valid: true };
        if (!liveJs.currentCursor.valid) {
            liveJs.currentCursor = { x: msg.x, y: msg.y, valid: true };
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
            cancelInteraction('right-click');
            return;
        case 'key_down':
            if (msg.key_code === 53) cancelInteraction('escape');
            return;
        default:
            return;
    }
}

function pointFromHitPayload(payload = {}) {
    const localX = Number(payload.offsetX);
    const localY = Number(payload.offsetY);
    const size = hitTarget.hit.size;
    if (Number.isFinite(localX) && Number.isFinite(localY) && liveJs.avatarPos.valid) {
        return {
            x: (liveJs.avatarPos.x - (size / 2)) + localX,
            y: (liveJs.avatarPos.y - (size / 2)) + localY,
        };
    }

    const screenX = Number(payload.x ?? payload.screenX);
    const screenY = Number(payload.y ?? payload.screenY);
    if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
        return nativeToDesktopWorldPoint({ x: screenX, y: screenY }, liveJs.displays) ?? { x: screenX, y: screenY };
    }
    return null;
}

function handleHitCanvasEvent(payload = {}) {
    if (payload.source !== 'sigil-hit') return;
    const point = pointFromHitPayload(payload);
    if (!point) return;
    handleInputEvent({ type: payload.kind, x: point.x, y: point.y });
}

function normalizeMessage(msg) {
    const payload = (msg?.payload && typeof msg.payload === 'object' && msg.payload !== null) ? msg.payload : null;
    const merged = payload ? { ...payload, ...msg } : { ...msg };
    merged.type = msg?.type ?? payload?.type ?? merged.type;
    return merged;
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

    if (msg.type === 'live_appearance') {
        if (msg.appearance) applyAppearance(msg.appearance);
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

    if (msg.type === 'input_event' && typeof msg.x === 'number' && typeof msg.y === 'number') {
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
    host.subscribe(['display_geometry', 'input_event', 'canvas_message'], { snapshot: true });
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

    if (primarySegment) {
        const fastTravelState = liveJs.travel
            ? fastTravel.tick(dt, () => {
                postLastPositionToDaemon();
            })
            : null;

        renderAvatarPos = liveJs.avatarPos;
        if (fastTravelState?.appScale != null) {
            state.appScale = fastTravelState.appScale;
        }
        if (fastTravelState?.avatarPos?.valid) {
            renderAvatarPos = fastTravelState.avatarPos;
        }
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

    if (primarySegment && liveJs.avatarPos.valid) {
        hitTarget.setSize(state.avatarHitRadius * 2)
        const nativeAvatarPos = desktopWorldToNativePoint(liveJs.avatarPos, liveJs.displays) || liveJs.avatarPos;
        nativeAvatarPos.valid = true;
        hitTarget.sync(nativeAvatarPos, liveJs.avatarVisible && ['IDLE', 'PRESS', 'DRAG'].includes(liveJs.currentState));
    }
    const avatarStagePos = stagePoint(renderAvatarPos);
    const dragOriginStage = stagePoint(liveJs.mousedownAvatarPos);
    overlay.draw({
        state: liveJs.currentState,
        avatarPos: avatarStagePos,
        dragOrigin: dragOriginStage,
        gotoRingRadius: liveJs.gotoRingRadius,
        menuRingRadius: liveJs.menuRingRadius,
        dragCancelRadius: liveJs.dragCancelRadius,
    });
    visibilityTransition.draw({ avatarStagePos });
    fastTravel.draw();

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale);
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
    snapshot() {
        return {
            state: liveJs.currentState,
            avatarPos: liveJs.avatarPos,
            travel: liveJs.travel,
            fastTravelEffect: state.transitionFastTravelEffect,
            fastTravelEvents: liveJs.fastTravelEvents,
            avatarVisible: liveJs.avatarVisible,
            hitTargetId: hitTarget.hit.id,
            hitTargetReady: hitTarget.hit.ready,
            transition: visibilityTransition.active?.effect ?? null,
            surface: desktopWorldSurface ? {
                segment: desktopWorldSurface.segment,
                isPrimary: desktopWorldSurface.isPrimary,
                latency: desktopWorldSurface.stateLatencySnapshot(),
            } : null,
        };
    },
};

export async function boot() {
    recordBoot('boot:start');

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    await runBootStep('init', () => init());

    const displaysStartedAt = performance.now();
    const displaysPromise = awaitFirstDisplayGeometry().then((displays) => {
        recordBootDuration('boot:awaitFirstDisplayGeometry', displaysStartedAt, { displays: displays.length });
        return displays;
    });
    const displays = await displaysPromise;

    recordBoot('boot:displayReady', { displays: displays.length });

    let position = await getLastPositionFromDaemon(liveJs.currentAgentId);
    if (position) {
        position = nativeToDesktopWorldPoint(position, displays) ?? position;
    }
    if (!position) {
        position = resolveBirthplace({
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
