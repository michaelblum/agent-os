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
import {
    clampPointToDisplays,
    computeDisplayUnion,
    normalizeDisplays,
} from './display-utils.js';
import { startFastTravel, tickFastTravel } from './fast-travel.js';

const host = createHostRuntime();
const overlay = createInteractionOverlay();
const hitTarget = createHitTargetController({
    runtime: host,
    url: 'aos://sigil/renderer/hit-area.html',
    size: state.avatarHitRadius * 2,
    parentId: 'avatar-main',
});

const liveJs = {
    avatarPos: { x: 0, y: 0, valid: false },
    avatarSize: 1.0,
    pointerPos: { x: 0, y: 0 },
    currentCursor: { x: 0, y: 0, valid: false },
    cursorTarget: { x: 0, y: 0, valid: false },
    globalBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
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
    mousedownPos: null,
    mousedownAvatarPos: null,
    avatarVisible: false,
    _resolveFirstDisplayGeometry: null,
    _pendingLifecycleComplete: null,
    _visibility: null,
};

window.liveJs = liveJs;
window.state = state;
window.applyAppearance = applyAppearance;
window.__sigilBootTrace = [];
window.__sigilBootError = null;
window.__sigilBootFirstFrameAt = null;

let rendererSuspended = false;
const renderLoop = createRenderLoopScheduler(requestAnimationFrame);

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
        return fn();
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

function projectAvatarToScene(screenX, screenY, yOffset = 0) {
    const vec = new THREE.Vector3();
    vec.set(
        (screenX / window.innerWidth) * 2 - 1,
        -(screenY / window.innerHeight) * 2 + 1,
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
    const agentId = liveJs.currentAgentId;
    const position = liveJs.avatarPos;
    if (!agentId || !position?.valid) return;
    host.positionSet(agentId, position);
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

function queueFastTravel(x, y) {
    startFastTravel(liveJs, liveJs.displays, x, y);
}

function emitStatusItemState() {
    host.post('status_item.state', {
        visible: liveJs.avatarVisible,
    });
}

function setAvatarVisibility(visible) {
    const next = !!visible;
    if (liveJs.avatarVisible === next && !liveJs._visibility) return;
    liveJs.avatarVisible = next;
    if (!next) {
        clearGestureState();
        liveJs.currentState = 'IDLE';
        liveJs.state = 'IDLE';
    }
    emitStatusItemState();
}

function animateVisibility(visible, lifecycleAction = null) {
    const targetVisible = !!visible;
    const startScale = Number.isFinite(state.appScale) ? state.appScale : (targetVisible ? 0 : 1);
    liveJs._visibility = {
        fromScale: startScale,
        toScale: targetVisible ? 1 : 0,
        elapsed: 0,
        duration: 0.18,
        targetVisible,
        lifecycleAction,
    };
    if (targetVisible) setAvatarVisibility(true);
}

function toggleAvatarVisibility() {
    animateVisibility(!liveJs.avatarVisible);
}

function setAvatarPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = liveJs.displays.length > 0
        ? clampPointToDisplays(liveJs.displays, x, y)
        : { x, y };
    liveJs.avatarPos = { x: next.x, y: next.y, valid: true };
    postLastPositionToDaemon();
}

function cancelInteraction(reason) {
    if (liveJs.currentState === 'IDLE') return;
    clearGestureState();
    setInteractionState('IDLE', reason);
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
            setInteractionState('GOTO', 'press-click');
            return;
        case 'DRAG': {
            const origin = liveJs.mousedownAvatarPos;
            const distFromOrigin = origin ? distance(x, y, origin.x, origin.y) : Infinity;
            clearGestureState();
            if (distFromOrigin <= liveJs.dragCancelRadius) {
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

function normalizeMessage(msg) {
    const payload = (msg?.payload && typeof msg.payload === 'object' && msg.payload !== null) ? msg.payload : null;
    const merged = payload ? { ...payload, ...msg } : { ...msg };
    merged.type = msg?.type ?? payload?.type ?? merged.type;
    return merged;
}

function handleHostMessage(rawMsg) {
    const msg = normalizeMessage(rawMsg);

    if (msg.type === 'live_appearance') {
        if (msg.appearance) applyAppearance(msg.appearance);
        return;
    }

    if (msg.type === 'status_item.toggle') {
        if (msg.target_state === 'visible') animateVisibility(true, 'enter');
        else if (msg.target_state === 'hidden') animateVisibility(false, 'exit');
        else toggleAvatarVisibility();
        return;
    }

    if (msg.type === 'status_item.show') {
        animateVisibility(true);
        return;
    }

    if (msg.type === 'status_item.hide') {
        animateVisibility(false);
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
        if (msg.action === 'enter') {
            animateVisibility(true, 'enter');
        } else if (msg.action === 'exit') {
            animateVisibility(false, 'exit');
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
        liveJs.globalBounds = computeDisplayUnion(liveJs.displays);
        if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
            const resolve = liveJs._resolveFirstDisplayGeometry;
            liveJs._resolveFirstDisplayGeometry = null;
            recordBoot('boot:firstDisplayGeometry', { displays: liveJs.displays.length, boot_elapsed_ms: bootElapsedMs() });
            resolve(liveJs.displays);
        }
        if (liveJs.avatarPos.valid && liveJs.globalBounds.w > 0 && liveJs.globalBounds.h > 0) {
            const outside =
                liveJs.avatarPos.x < liveJs.globalBounds.minX ||
                liveJs.avatarPos.x > liveJs.globalBounds.maxX ||
                liveJs.avatarPos.y < liveJs.globalBounds.minY ||
                liveJs.avatarPos.y > liveJs.globalBounds.maxY;
            if (outside) {
                const clamped = clampPointToDisplays(liveJs.displays, liveJs.avatarPos.x, liveJs.avatarPos.y);
                liveJs.avatarPos = { x: clamped.x, y: clamped.y, valid: true };
            }
        }
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

function setupHostSurface() {
    host.install();
    host.onMessage(handleHostMessage);
    overlay.mount();
    host.subscribe(['display_geometry', 'input_event'], { snapshot: true });
    void hitTarget.ensureCreated().catch((error) => {
        console.error('[sigil] avatar hit target create failed:', error);
    });
}

function init() {
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
    runBootStep('setupHostSurface', () => setupHostSurface());
    if (!rendererSuspended) scheduleRenderFrame();
}

function animate() {
    if (rendererSuspended) return;

    const dt = 0.016;
    state.globalTime += dt;

    if (liveJs.travel) {
        tickFastTravel(liveJs, () => {
            postLastPositionToDaemon();
        });
    }

    if (liveJs.avatarPos.valid) {
        const projected = projectAvatarToScene(liveJs.avatarPos.x, liveJs.avatarPos.y);
        state.polyGroup.position.copy(projected);
        state.pointLight.position.copy(state.polyGroup.position);
    }

    if (liveJs._visibility) {
        const transition = liveJs._visibility;
        transition.elapsed += dt;
        let progress = transition.elapsed / transition.duration;
        if (progress > 1.0) progress = 1.0;
        const ease = progress * progress * (3 - (2 * progress));
        state.appScale = transition.fromScale + ((transition.toScale - transition.fromScale) * ease);
        if (progress >= 1.0) {
            liveJs._visibility = null;
            state.appScale = transition.toScale;
            setAvatarVisibility(transition.targetVisible);
            if (transition.lifecycleAction) {
                host.post('lifecycle.complete', { action: transition.lifecycleAction });
            }
        }
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

    if (liveJs.avatarPos.valid) {
        hitTarget.setSize(state.avatarHitRadius * 2)
        hitTarget.sync(liveJs.avatarPos, liveJs.currentState === 'PRESS' || liveJs.currentState === 'DRAG');
    }
    overlay.draw({
        state: liveJs.currentState,
        avatarPos: liveJs.avatarPos,
        dragOrigin: liveJs.mousedownAvatarPos,
        gotoRingRadius: liveJs.gotoRingRadius,
        menuRingRadius: liveJs.menuRingRadius,
        dragCancelRadius: liveJs.dragCancelRadius,
    });

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale);
    state.renderer.render(state.scene, state.camera);

    if (liveJs._pendingLifecycleComplete) {
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
            avatarVisible: liveJs.avatarVisible,
            hitTargetId: hitTarget.hit.id,
            hitTargetReady: hitTarget.hit.ready,
        };
    },
};

export async function boot() {
    recordBoot('boot:start');

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    runBootStep('init', () => init());

    const displaysStartedAt = performance.now();
    const displaysPromise = awaitFirstDisplayGeometry().then((displays) => {
        recordBootDuration('boot:awaitFirstDisplayGeometry', displaysStartedAt, { displays: displays.length });
        return displays;
    });
    const displays = await displaysPromise;

    recordBoot('boot:displayReady', { displays: displays.length });

    let position = await getLastPositionFromDaemon(liveJs.currentAgentId);
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
