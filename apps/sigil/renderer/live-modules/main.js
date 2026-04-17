import state from '../state.js';
import { updateGeometry } from '../geometry.js';
import { updateAllColors } from '../colors.js';
import { createAuraObjects, animateAura } from '../aura.js';
import { createPhenomena, animatePhenomena } from '../phenomena.js';
import { createParticleObjects, animateParticles, animateTrails } from '../particles.js';
import { createLightning, animateLightning } from '../lightning.js';
import { createMagneticField, animateMagneticField } from '../magnetic.js';
import { createOmega, animateOmega } from '../omega.js';
import { animateSkins } from '../skins.js';
import { loadAgent } from '../agent-loader.js';
import { applyAppearance, DEFAULT_APPEARANCE } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';
import { createRenderLoopScheduler } from './render-loop.js';
import { createHostRuntime } from './host-runtime.js';
import { createInteractionOverlay } from './interaction-overlay.js';
import { createHitTargetController } from './hit-target.js';
import {
    clampPointToDisplays,
    computeDisplayNonant,
    computeDisplayUnion,
    computeWorkbenchFrame,
    normalizeDisplays,
} from './display-utils.js';
import { startFastTravel, tickFastTravel } from './fast-travel.js';

const host = createHostRuntime();
const overlay = createInteractionOverlay();
const hitTarget = createHitTargetController({
    runtime: host,
    url: 'aos://sigil/renderer/hit-area.html',
    size: state.avatarHitRadius * 2,
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
    currentAgentId: null,
    avatarHitRadius: state.avatarHitRadius,
    dragThreshold: state.dragThreshold,
    dragCancelRadius: state.dragCancelRadius,
    gotoRingRadius: state.gotoRingRadius,
    menuRingRadius: state.menuRingRadius,
    travel: null,
    mousedownPos: null,
    mousedownAvatarPos: null,
    pendingReload: false,
    workbenchVisible: false,
    preWorkbenchPos: null,
    _resolveFirstDisplayGeometry: null,
    _pendingLifecycleComplete: null,
    _entrance: null,
};

window.liveJs = liveJs;
window.state = state;
window.applyAppearance = applyAppearance;
window.__sigilBootTrace = [];
window.__sigilBootError = null;

let rendererSuspended = false;
const renderLoop = createRenderLoopScheduler(requestAnimationFrame);

function recordBoot(stage, extra = {}) {
    const entry = { ts: Date.now(), stage, ...extra };
    window.__sigilBootTrace.push(entry);
    if (window.__sigilBootTrace.length > 64) window.__sigilBootTrace.shift();
    if (extra.error) window.__sigilBootError = entry;
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
    if (next === 'IDLE' && !liveJs.travel) {
        flushReload();
        postLastPositionToDaemon();
    }
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
    if (!liveJs.avatarPos.valid) return false;
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

function flushReload() {
    if (!liveJs.pendingReload) return;
    if (liveJs.currentState !== 'IDLE') return;
    if (liveJs.travel) return;
    if (typeof window.__sigilFlushReload !== 'function') return;
    liveJs.pendingReload = false;
    window.__sigilFlushReload().catch((error) => {
        console.error('[sigil] flushReload failed:', error);
        liveJs.pendingReload = true;
    });
}

function cancelInteraction(reason) {
    if (liveJs.currentState === 'IDLE') return;
    clearGestureState();
    setInteractionState('IDLE', reason);
}

function showWorkbench() {
    if (!liveJs.avatarPos.valid) return;
    const frame = computeWorkbenchFrame(liveJs.displays, liveJs.avatarPos);
    if (!frame) return;

    liveJs.preWorkbenchPos = { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y };
    liveJs.workbenchVisible = true;

    void host.canvasCreate({
        id: 'sigil-workbench',
        url: 'aos://sigil/workbench/index.html',
        frame,
        interactive: true,
        focus: true,
    }).catch((error) => {
        console.error('[sigil] failed to create workbench:', error);
        const restorePos = liveJs.preWorkbenchPos;
        liveJs.workbenchVisible = false;
        liveJs.preWorkbenchPos = null;
        if (restorePos) queueFastTravel(restorePos.x, restorePos.y);
    });

    const home = computeDisplayNonant(liveJs.displays, liveJs.avatarPos, 'top-left');
    if (home) queueFastTravel(home.x, home.y);
}

function dismissWorkbench() {
    const restorePos = liveJs.preWorkbenchPos;
    liveJs.workbenchVisible = false;
    liveJs.preWorkbenchPos = null;
    void host.canvasRemove({ id: 'sigil-workbench' }).catch((error) => {
        console.warn('[sigil] failed to remove workbench:', error);
    });
    if (restorePos) queueFastTravel(restorePos.x, restorePos.y);
}

function toggleWorkbench() {
    if (liveJs.workbenchVisible) dismissWorkbench();
    else showWorkbench();
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
            if (liveJs.currentState === 'IDLE' && isOnAvatar(msg.x, msg.y)) {
                toggleWorkbench();
                return;
            }
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

    if (msg.type === 'lifecycle') {
        if (msg.action === 'enter') {
            const originX = msg.origin_x ?? liveJs.avatarPos.x;
            const originY = msg.origin_y ?? liveJs.avatarPos.y;
            state.appScale = 0;
            liveJs._entrance = {
                fromX: originX,
                fromY: originY,
                toX: liveJs.avatarPos.x,
                toY: liveJs.avatarPos.y,
                elapsed: 0,
                duration: 0.6,
                reverse: false,
            };
        } else if (msg.action === 'exit') {
            const originX = msg.origin_x ?? liveJs.avatarPos.x;
            const originY = msg.origin_y ?? liveJs.avatarPos.y;
            liveJs._entrance = {
                fromX: liveJs.avatarPos.x,
                fromY: liveJs.avatarPos.y,
                toX: originX,
                toY: originY,
                elapsed: 0,
                duration: 0.6,
                reverse: true,
            };
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

    if (msg.type === 'wiki_page_changed') {
        if (!liveJs.currentAgentId) return;
        if (msg.path !== `sigil/agents/${liveJs.currentAgentId}.md`) return;
        liveJs.pendingReload = true;
        flushReload();
        return;
    }

    if (msg.type === 'canvas_lifecycle') {
        if (msg.canvas_id === 'sigil-workbench' && msg.action === 'removed' && liveJs.workbenchVisible) {
            const restorePos = liveJs.preWorkbenchPos;
            liveJs.workbenchVisible = false;
            liveJs.preWorkbenchPos = null;
            if (restorePos) queueFastTravel(restorePos.x, restorePos.y);
        }
        return;
    }

    if (msg.type === 'behavior' && msg.slot === 'dismissed') {
        void hitTarget.remove();
        if (liveJs.workbenchVisible) {
            liveJs.workbenchVisible = false;
            liveJs.preWorkbenchPos = null;
            void host.canvasRemove({ id: 'sigil-workbench' }).catch(() => {});
        }
        return;
    }

    handleInputEvent(msg);
}

function awaitFirstDisplayGeometry() {
    if (liveJs.displays.length > 0) return Promise.resolve(liveJs.displays);
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

async function sigilReloadCurrentAgent() {
    if (!liveJs.currentAgentId) {
        throw new Error('sigilReloadCurrentAgent: currentAgentId not set');
    }
    const agentPath = `sigil/agents/${liveJs.currentAgentId}`;
    const agent = await loadAgent(agentPath);
    applyAppearance(agent.appearance);
    liveJs.avatarSize = agent.instance?.size ?? liveJs.avatarSize;
    console.log('[sigil] live-reloaded agent:', liveJs.currentAgentId);
}

window.__sigilFlushReload = sigilReloadCurrentAgent;

function setupHostSurface() {
    host.install();
    host.onMessage(handleHostMessage);
    overlay.mount();
    host.subscribe(['display_geometry', 'wiki_page_changed', 'input_event', 'canvas_lifecycle'], { snapshot: true });
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
            flushReload();
            postLastPositionToDaemon();
        });
    }

    if (liveJs.avatarPos.valid) {
        const projected = projectAvatarToScene(liveJs.avatarPos.x, liveJs.avatarPos.y);
        state.polyGroup.position.copy(projected);
        state.pointLight.position.copy(state.polyGroup.position);
    }

    if (liveJs._entrance) {
        const entrance = liveJs._entrance;
        entrance.elapsed += dt;
        let progress = entrance.elapsed / entrance.duration;
        if (progress > 1.0) progress = 1.0;
        const ease = progress * progress * (3 - (2 * progress));
        state.appScale = entrance.reverse ? (1 - ease) : ease;
        liveJs.avatarPos.x = entrance.fromX + ((entrance.toX - entrance.fromX) * ease);
        liveJs.avatarPos.y = entrance.fromY + ((entrance.toY - entrance.fromY) * ease);
        liveJs.avatarPos.valid = true;
        if (progress >= 1.0) {
            liveJs._entrance = null;
            if (!entrance.reverse) state.appScale = 1.0;
            host.post('lifecycle.complete', { action: entrance.reverse ? 'exit' : 'enter' });
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
            workbenchVisible: liveJs.workbenchVisible,
            hitTargetId: hitTarget.hit.id,
            hitTargetReady: hitTarget.hit.ready,
        };
    },
};

export async function boot() {
    recordBoot('boot:start');
    const params = new URLSearchParams(window.location.search);
    const agentPath = params.get('agent') ?? 'sigil/agents/default';
    const currentAgentId = agentPath.split('/').pop();

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    runBootStep('init', () => init());

    const agentPromise = loadAgent(agentPath).catch(async (error) => {
        console.error('[sigil] loadAgent threw:', error);
        const mod = await import('../agent-loader.js');
        return { ...mod.MINIMAL_DEFAULT };
    });
    const displaysPromise = awaitFirstDisplayGeometry();
    const [agent, displays] = await Promise.all([agentPromise, displaysPromise]);

    recordBoot('boot:agentAndDisplaysReady', { displays: displays.length });
    liveJs.currentAgentId = currentAgentId;
    applyAppearance(agent.appearance);
    liveJs.avatarSize = agent.instance?.size ?? liveJs.avatarSize;

    let position = await getLastPositionFromDaemon(currentAgentId);
    if (!position) position = resolveBirthplace(agent.instance.birthplace, displays);

    const originX = params.get('origin_x');
    const originY = params.get('origin_y');
    if (originX !== null && originY !== null) {
        const ox = parseFloat(originX);
        const oy = parseFloat(originY);
        liveJs.avatarPos = { x: ox, y: oy, valid: true };
        state.appScale = 0;
        liveJs._entrance = {
            fromX: ox,
            fromY: oy,
            toX: position.x,
            toY: position.y,
            elapsed: 0,
            duration: 0.6,
            reverse: false,
        };
    } else {
        liveJs.avatarPos = { x: position.x, y: position.y, valid: true };
    }
}
