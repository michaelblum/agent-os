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
import { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';
import { cloneStageAvatar } from '../fixed-avatar.js';
import { createRenderLoopScheduler } from './render-loop.js';
import { createHostRuntime } from './host-runtime.js';
import {
    clampPointToDisplays,
    computeDisplayUnion,
    normalizeDisplays,
} from './display-utils.js';

const host = createHostRuntime();
const renderLoop = createRenderLoopScheduler(requestAnimationFrame);

const liveJs = {
    avatarId: 'default',
    avatarName: 'Default',
    avatarPos: { x: 0, y: 0, valid: false },
    avatarSize: 180,
    displays: [],
    globalBounds: { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visible: false,
    targetVisible: false,
    currentScale: 0,
    transition: null,
    lifecycle: 'hidden',
    _resolveFirstDisplayGeometry: null,
};

window.liveJs = liveJs;
window.state = state;
window.applyAppearance = applyAppearance;
window.snapshotAppearance = snapshotAppearance;
window.__sigilBootTrace = [];
window.__sigilBootError = null;
window.__sigilBootFirstFrameAt = null;

let rendererSuspended = false;

function recordBoot(stage, extra = {}) {
    const entry = { ts: Date.now(), stage, ...extra };
    window.__sigilBootTrace.push(entry);
    if (window.__sigilBootTrace.length > 64) window.__sigilBootTrace.shift();
    if (extra.error) window.__sigilBootError = entry;
    if (stage.startsWith('boot:')) console.debug('[sigil][boot]', stage, entry);
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

function projectAvatarToScene(screenX, screenY) {
    const vec = new THREE.Vector3();
    vec.set(
        (screenX / window.innerWidth) * 2 - 1,
        -(screenY / window.innerHeight) * 2 + 1,
        0.5
    );
    vec.unproject(state.perspCamera);
    vec.sub(state.perspCamera.position).normalize();
    const distance = -state.perspCamera.position.z / vec.z;
    return new THREE.Vector3().copy(state.perspCamera.position).add(vec.multiplyScalar(distance));
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

function normalizeMessage(msg) {
    const payload = (msg?.payload && typeof msg.payload === 'object' && msg.payload !== null) ? msg.payload : null;
    const merged = payload ? { ...payload, ...msg } : { ...msg };
    merged.type = msg?.type ?? payload?.type ?? merged.type;
    return merged;
}

function setLifecycle(next) {
    if (liveJs.lifecycle === next) return;
    liveJs.lifecycle = next;
    host.post('sigil.stage.lifecycle', {
        avatar_id: liveJs.avatarId,
        state: next,
        visible: liveJs.visible,
        target_visible: liveJs.targetVisible,
    });
}

function emitStatusItemState() {
    host.post('status_item.state', {
        visible: liveJs.visible,
        target_visible: liveJs.targetVisible,
        lifecycle: liveJs.lifecycle,
    });
}

function clampAvatarPosition(x, y) {
    if (liveJs.displays.length === 0) return { x, y };
    return clampPointToDisplays(liveJs.displays, x, y);
}

function setAvatarPosition(position, { persist = true } = {}) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    const next = clampAvatarPosition(position.x, position.y);
    liveJs.avatarPos = { x: next.x, y: next.y, valid: true };
    if (persist) host.positionSet(`sigil.stage.${liveJs.avatarId}`, next);
    scheduleRenderFrame();
    return true;
}

function emitStageState(reason = 'state') {
    emitStatusItemState();
    host.post('sigil.stage.state', {
        reason,
        avatar_id: liveJs.avatarId,
        visible: liveJs.visible,
        target_visible: liveJs.targetVisible,
        lifecycle: liveJs.lifecycle,
        scale: Number(state.appScale.toFixed(4)),
        position: liveJs.avatarPos.valid ? {
            x: Math.round(liveJs.avatarPos.x),
            y: Math.round(liveJs.avatarPos.y),
        } : null,
        appearance: snapshotAppearance(),
    });
}

function beginVisibilityTransition(visible, duration) {
    const targetScale = visible ? 1 : 0;
    liveJs.targetVisible = visible;
    if (Math.abs(state.appScale - targetScale) < 0.0001) {
        state.appScale = targetScale;
        liveJs.currentScale = targetScale;
        liveJs.visible = visible;
        setLifecycle(visible ? 'visible' : 'hidden');
        emitStageState(visible ? 'show' : 'hide');
        return;
    }

    liveJs.transition = {
        fromScale: state.appScale,
        toScale: targetScale,
        duration: Math.max(0.01, duration),
        elapsed: 0,
    };
    setLifecycle(visible ? 'appearing' : 'disappearing');
    scheduleRenderFrame();
}

function mergeDeep(base, patch) {
    if (patch === undefined) return base;
    if (Array.isArray(base) || Array.isArray(patch)) {
        return Array.isArray(patch) ? patch.slice() : base;
    }
    if (!base || typeof base !== 'object' || !patch || typeof patch !== 'object') {
        return patch;
    }
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        out[key] = mergeDeep(base[key], value);
    }
    return out;
}

function applyAppearancePatch(patch = {}) {
    const nextAppearance = mergeDeep(snapshotAppearance(), patch);
    applyAppearance(nextAppearance);
    emitStageState('appearance');
    scheduleRenderFrame();
}

function handleStageCommand(msg) {
    const action = msg.action ?? msg.command;
    if (!action) return false;

    switch (action) {
        case 'toggle':
            beginVisibilityTransition(!liveJs.targetVisible, liveJs.targetVisible ? 0.18 : 0.22);
            return true;
        case 'show':
            beginVisibilityTransition(true, Number(msg.duration ?? 0.22));
            return true;
        case 'hide':
            beginVisibilityTransition(false, Number(msg.duration ?? 0.18));
            return true;
        case 'setPosition':
        case 'position':
            if (setAvatarPosition(msg.position ?? { x: Number(msg.x), y: Number(msg.y) })) {
                emitStageState('position');
            }
            return true;
        case 'setAppearance':
        case 'appearance':
            applyAppearancePatch(msg.appearance ?? msg.patch ?? {});
            return true;
        case 'setGeometry':
        case 'geometry':
            applyAppearancePatch({
                shape: msg.shape,
                stellation: msg.stellation,
                size: msg.size,
                shapeParams: msg.shapeParams,
                zDepth: msg.zDepth,
            });
            return true;
        case 'setEffects':
        case 'effects':
            applyAppearancePatch({
                aura: msg.aura,
                phenomena: msg.phenomena,
                lightning: msg.lightning,
                magnetic: msg.magnetic,
                omega: msg.omega,
                trails: msg.trails,
            });
            return true;
        case 'snapshot':
        case 'state':
            emitStageState(action);
            return true;
        default:
            return false;
    }
}

function handleHostMessage(rawMsg) {
    const msg = normalizeMessage(rawMsg);

    if (msg.type === 'display_geometry') {
        liveJs.displays = normalizeDisplays(msg.displays || []);
        liveJs.globalBounds = computeDisplayUnion(liveJs.displays);
        if (typeof liveJs._resolveFirstDisplayGeometry === 'function') {
            const resolve = liveJs._resolveFirstDisplayGeometry;
            liveJs._resolveFirstDisplayGeometry = null;
            recordBoot('boot:firstDisplayGeometry', {
                displays: liveJs.displays.length,
                boot_elapsed_ms: bootElapsedMs(),
            });
            resolve(liveJs.displays);
        }
        if (liveJs.avatarPos.valid) {
            setAvatarPosition(liveJs.avatarPos, { persist: false });
        }
        return;
    }

    if (msg.type === 'lifecycle') {
        if (msg.action === 'suspend') {
            rendererSuspended = true;
            renderLoop.suspend();
            return;
        }
        if (msg.action === 'resume') {
            rendererSuspended = false;
            renderLoop.resume();
            scheduleRenderFrame();
            host.post('lifecycle.complete', { action: 'resume' });
            return;
        }
    }

    if (msg.type === 'live_appearance') {
        applyAppearancePatch(msg.appearance ?? {});
        return;
    }

    if (msg.type === 'status_item.toggle') {
        const targetState = msg.target_state;
        if (targetState === 'visible') {
            beginVisibilityTransition(true, 0.22);
        } else if (targetState === 'hidden') {
            beginVisibilityTransition(false, 0.18);
        } else {
            beginVisibilityTransition(!liveJs.targetVisible, liveJs.targetVisible ? 0.18 : 0.22);
        }
        return;
    }

    if (msg.type === 'sigil.stage' || msg.type === 'sigil.avatar') {
        if (handleStageCommand(msg)) return;
    }

    if (msg.type === 'behavior' && msg.slot === 'dismissed') {
        beginVisibilityTransition(false, 0.12);
    }
}

function awaitFirstDisplayGeometry() {
    if (liveJs.displays.length > 0) return Promise.resolve(liveJs.displays);
    recordBoot('boot:awaitFirstDisplayGeometry');
    return new Promise((resolve) => {
        liveJs._resolveFirstDisplayGeometry = resolve;
    });
}

async function getLastPositionFromDaemon(avatarId) {
    try {
        return await host.positionGet(`sigil.stage.${avatarId}`, { timeoutMs: 250 });
    } catch (error) {
        console.warn('[sigil-stage] lastPosition lookup failed; using birthplace:', error);
        return null;
    }
}

function setupHostSurface() {
    host.install();
    host.onMessage(handleHostMessage);
    host.subscribe(['display_geometry'], { snapshot: true });
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
    runBootStep('setupHostSurface', () => setupHostSurface());
    if (!rendererSuspended) scheduleRenderFrame();
}

function animate() {
    if (rendererSuspended) return;

    const dt = 0.016;
    state.globalTime += dt;

    if (liveJs.avatarPos.valid) {
        const projected = projectAvatarToScene(liveJs.avatarPos.x, liveJs.avatarPos.y);
        state.polyGroup.position.copy(projected);
        state.pointLight.position.copy(state.polyGroup.position);
    }

    if (liveJs.transition) {
        const transition = liveJs.transition;
        transition.elapsed += dt;
        let progress = transition.elapsed / transition.duration;
        if (progress > 1.0) progress = 1.0;
        const ease = progress * progress * (3 - (2 * progress));
        state.appScale = transition.fromScale + ((transition.toScale - transition.fromScale) * ease);
        liveJs.currentScale = state.appScale;
        if (progress >= 1.0) {
            liveJs.transition = null;
            state.appScale = transition.toScale;
            liveJs.currentScale = state.appScale;
            liveJs.visible = transition.toScale > 0.001;
            setLifecycle(liveJs.visible ? 'visible' : 'hidden');
            emitStageState(liveJs.visible ? 'show' : 'hide');
        }
    }

    if (!state.isPaused) {
        state.polyGroup.rotation.y += state.idleSpinSpeed ?? 0.01;
        state.polyGroup.rotation.x += (state.idleSpinSpeed ?? 0.01) * 0.4;
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

    if (window.__sigilBootFirstFrameAt === null) {
        window.__sigilBootFirstFrameAt = Date.now();
        recordBoot('boot:firstFrame', { boot_elapsed_ms: bootElapsedMs() });
    }

    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale);
    state.renderer.render(state.scene, state.camera);
    scheduleRenderFrame();
}

window.__sigilStage = {
    dispatch(msg) {
        handleHostMessage(msg);
        return {
            visible: liveJs.visible,
            targetVisible: liveJs.targetVisible,
            lifecycle: liveJs.lifecycle,
            position: liveJs.avatarPos,
        };
    },
    snapshot() {
        return {
            avatarId: liveJs.avatarId,
            avatarName: liveJs.avatarName,
            visible: liveJs.visible,
            targetVisible: liveJs.targetVisible,
            lifecycle: liveJs.lifecycle,
            position: liveJs.avatarPos,
            appearance: snapshotAppearance(),
        };
    },
};

export async function boot() {
    recordBoot('boot:start');
    const params = new URLSearchParams(window.location.search);
    const avatar = cloneStageAvatar();

    runBootStep('applyDefaultAppearance', () => applyAppearance(DEFAULT_APPEARANCE));
    runBootStep('init', () => init());

    const displaysStartedAt = performance.now();
    const displays = await awaitFirstDisplayGeometry().then((list) => {
        recordBootDuration('boot:awaitFirstDisplayGeometry', displaysStartedAt, { displays: list.length });
        return list;
    });

    liveJs.avatarId = avatar.id;
    liveJs.avatarName = avatar.name;
    applyAppearance(avatar.appearance);
    liveJs.avatarSize = avatar.instance?.size ?? liveJs.avatarSize;

    const initialVisible = params.get('visible') === '1'
        || params.get('visible') === 'true'
        || avatar.stage?.initiallyVisible === true;
    state.appScale = initialVisible ? 1 : 0;
    liveJs.currentScale = state.appScale;
    liveJs.visible = initialVisible;
    liveJs.targetVisible = initialVisible;
    setLifecycle(initialVisible ? 'visible' : 'hidden');

    let position = await getLastPositionFromDaemon(avatar.id);
    if (!position) position = resolveBirthplace(avatar.instance.birthplace, displays);
    if (params.has('x') && params.has('y')) {
        position = {
            x: Number(params.get('x')),
            y: Number(params.get('y')),
        };
    }
    setAvatarPosition(position, { persist: false });

    recordBoot('boot:avatarPositionReady', {
        x: Math.round(liveJs.avatarPos.x),
        y: Math.round(liveJs.avatarPos.y),
        boot_elapsed_ms: bootElapsedMs(),
    });
    emitStatusItemState();
    emitStageState('boot');
}
