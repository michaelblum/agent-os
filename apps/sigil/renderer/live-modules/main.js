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
import { applyAppearance } from '../appearance.js';
import { resolveBirthplace } from '../birthplace-resolver.js';

// Global namespace for IPC bridge
const liveJs = {
    avatarPos: { x: 0, y: 0, valid: false },
    avatarSize: 1.0,
    targetPos: null,
    pointerPos: { x: 0, y: 0 },
    globalBounds: { x: 0, y: 0, w: 0, h: 0 },
    displays: [],
    currentState: 'IDLE',
    currentAgentId: null,
    _resolveFirstDisplayGeometry: null
};
window.liveJs = liveJs;
window.state = state;

// Re-export applyAppearance for live-reload
window.applyAppearance = applyAppearance;

// --- WebGL Initialization ---
function initScene() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    state.scene = new THREE.Scene();
    state.perspCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    state.orthoCamera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
    state.camera = state.perspCamera;
    state.camera.position.z = 20;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(w, h);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(state.renderer.domElement);

    state.pointLight = new THREE.PointLight(0xffffff, 2, 50);
    state.scene.add(state.pointLight);
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    state.polyGroup = new THREE.Group();
    state.scene.add(state.polyGroup);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (state.camera === state.perspCamera) {
        state.camera.aspect = w / h;
    } else {
        state.camera.left = -w / 2;
        state.camera.right = w / 2;
        state.camera.top = h / 2;
        state.camera.bottom = -h / 2;
    }
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
}

function init() {
    initScene();
    createAuraObjects();
    createParticleObjects();
    createPhenomena();
    createLightning();
    createMagneticField();
    createOmega();

    updateGeometry(state.currentType);
    updateAllColors();

    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);

    setupLiveJs();
    requestAnimationFrame(animate);
}

// --- Main Render Loop ---
function animate() {
    requestAnimationFrame(animate);
    const dt = 0.016;

    // Advance global turbulence clock
    state.globalTime += dt;

    // --- State Machine ---
    if (liveJs.currentState === 'IDLE' && liveJs.avatarPos.valid) {
        // Simple ambient hover in IDLE
        const t = performance.now() * 0.001;
        const hoverY = Math.sin(t * 1.5) * 10;
        
        // Use perspective camera to project logical position to 3D scene
        const vec = new THREE.Vector3();
        vec.set(
            (liveJs.avatarPos.x / window.innerWidth) * 2 - 1,
            -(liveJs.avatarPos.y / window.innerHeight) * 2 + 1,
            0.5
        );
        vec.unproject(state.perspCamera);
        vec.sub(state.perspCamera.position).normalize();
        const distance = -state.perspCamera.position.z / vec.z;
        const pos = new THREE.Vector3().copy(state.perspCamera.position).add(vec.multiplyScalar(distance));
        
        state.polyGroup.position.set(pos.x, pos.y + (hoverY / 10), pos.z);
        state.pointLight.position.copy(state.polyGroup.position);
    } else if (liveJs.currentState === 'GOTO') {
         // Fast travel animation (simplified for now)
         if (liveJs.targetPos) {
             const dx = liveJs.targetPos.x - liveJs.avatarPos.x;
             const dy = liveJs.targetPos.y - liveJs.avatarPos.y;
             liveJs.avatarPos.x += dx * 0.1;
             liveJs.avatarPos.y += dy * 0.1;
             
             // Snap and transition back to IDLE when close
             if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                 liveJs.avatarPos.x = liveJs.targetPos.x;
                 liveJs.avatarPos.y = liveJs.targetPos.y;
                 liveJs.targetPos = null;
                 liveJs.currentState = 'IDLE';
             }
         }
    }

    // --- Entrance / Exit Animation ---
    if (liveJs._entrance) {
        const e = liveJs._entrance;
        e.elapsed += dt;
        let t = e.elapsed / e.duration;
        if (t > 1.0) t = 1.0;

        // Smoothstep ease
        const ease = t * t * (3 - 2 * t);
        
        // Scale animation (using the renamed appScale)
        state.appScale = e.reverse ? (1 - ease) : ease;
        
        // Position interpolation
        liveJs.avatarPos.x = e.fromX + (e.toX - e.fromX) * ease;
        liveJs.avatarPos.y = e.fromY + (e.toY - e.fromY) * ease;

        if (t >= 1.0) {
            liveJs._entrance = null;
            // Bug Fix: Persist appScale=0 if it was an exit animation
            if (!e.reverse) state.appScale = 1.0;
        }
    }

    // --- Spin ---
    const isPaused = state.isPaused; 
    if (!isPaused) {
        state.polyGroup.rotation.y += 0.005;
        state.polyGroup.rotation.x += 0.002;
    }

    // --- Module Animations ---
    animateParticles(dt);
    animatePhenomena(dt);
    animateAura(dt);
    animateLightning(dt);
    animateMagneticField(dt);
    animateOmega(dt);
    animateSkins(dt);
    animateTrails(dt);

    // Apply unified scale
    state.polyGroup.scale.setScalar(state.baseScale * state.z_depth * state.appScale);

    state.renderer.render(state.scene, state.camera);
}

// --- IPC / LiveJs ---
function postToHost(action, payload) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
        window.webkit.messageHandlers.headsup.postMessage(
            { type: action, payload: payload || {} }
        );
    }
}
window.postToHost = postToHost;

function setupLiveJs() {
    window.headsup = {
        receive: (b64) => {
            try {
                const str = atob(b64);
                const msg = JSON.parse(str);
                handleLiveJsMessage(msg);
            } catch (e) {
                console.error('[sigil] handleLiveJsMessage error:', e);
            }
        }
    };
    postToHost('subscribe', { event: 'display_geometry' });
    postToHost('subscribe', { event: 'wiki_page_changed' });
    postToHost('subscribe', { event: 'input_event' });
}

function handleLiveJsMessage(msg) {
    // 1. In-memory Appearance Preview (Studio bypass)
    if (msg.type === 'live_appearance') {
        applyAppearance(msg.appearance);
        return;
    }
    
    // 2. Lifecycle (Enter / Exit)
    if (msg.type === 'lifecycle') {
        if (msg.action === 'enter') {
            const ox = msg.origin_x || liveJs.avatarPos.x;
            const oy = msg.origin_y || liveJs.avatarPos.y;
            state.appScale = 0;
            liveJs._entrance = {
                fromX: ox, fromY: oy,
                toX: liveJs.avatarPos.x, toY: liveJs.avatarPos.y,
                elapsed: 0, duration: 0.6, reverse: false
            };
        } else if (msg.action === 'exit') {
            const ox = msg.origin_x || liveJs.avatarPos.x;
            const oy = msg.origin_y || liveJs.avatarPos.y;
            liveJs._entrance = {
                fromX: liveJs.avatarPos.x, fromY: liveJs.avatarPos.y,
                toX: ox, toY: oy,
                elapsed: 0, duration: 0.6, reverse: true
            };
        }
        return;
    }

    // 3. System Events
    if (msg.type === 'display_geometry') {
        liveJs.displays = msg.payload.displays || [];
        if (liveJs._resolveFirstDisplayGeometry) {
            liveJs._resolveFirstDisplayGeometry(liveJs.displays);
            liveJs._resolveFirstDisplayGeometry = null;
        }
    } else if (msg.type === 'wiki_page_changed') {
        if (liveJs.currentAgentId && msg.payload.path === `sigil/agents/${liveJs.currentAgentId}.md`) {
             // Debounce via IDLE state check (simplified)
             if (liveJs.currentState === 'IDLE') {
                 window.__sigilFlushReload();
             }
        }
    }
}

// --- Boot Sequence ---
function awaitFirstDisplayGeometry() {
    if (liveJs.displays && liveJs.displays.length > 0) {
        return Promise.resolve(liveJs.displays);
    }
    return new Promise((resolve) => {
        liveJs._resolveFirstDisplayGeometry = resolve;
    });
}

async function getLastPositionFromDaemon(agentId) {
    const requestId = 'lp-get-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        // Simple one-shot handler attachment
        const prevReceive = window.headsup.receive;
        window.headsup.receive = (b64) => {
             prevReceive(b64);
             try {
                 const msg = JSON.parse(atob(b64));
                 if (msg.type === 'canvas.response' && msg.request_id === requestId) {
                     if (msg.status === 'ok' && msg.position) {
                         done({ x: msg.position.x, y: msg.position.y });
                     } else {
                         done(null);
                     }
                 }
             } catch(e) {}
        };
        const timer = setTimeout(() => done(null), 250);
        postToHost('position.get', { key: agentId, request_id: requestId });
    });
}

export async function boot() {
    const params = new URLSearchParams(window.location.search);
    const agentPath = params.get('agent') ?? 'sigil/agents/default';
    const currentAgentId = agentPath.split('/').pop();

    // 1. Init Scene + Subscription
    init();

    // 2. Fetch Agent + Displays in Parallel
    const agentPromise = loadAgent(agentPath).catch((e) => {
        console.error('[sigil] loadAgent threw:', e);
        return import('../agent-loader.js').then(mod => ({ ...mod.MINIMAL_DEFAULT }));
    });
    const displaysPromise = awaitFirstDisplayGeometry();

    const [agent, displays] = await Promise.all([agentPromise, displaysPromise]);
    liveJs.currentAgentId = currentAgentId;

    // 3. Apply Appearance
    applyAppearance(agent.appearance);

    // 4. Resolve Position
    let pos = await getLastPositionFromDaemon(currentAgentId);
    if (!pos) {
        pos = resolveBirthplace(agent.instance.birthplace, displays);
    }
    
    // Entrance Animation setup
    const originX = params.get('origin_x');
    const originY = params.get('origin_y');
    if (originX !== null && originY !== null) {
        const ox = parseFloat(originX), oy = parseFloat(originY);
        liveJs.avatarPos = { x: ox, y: oy, valid: true };
        state.appScale = 0;
        liveJs._entrance = {
            fromX: ox, fromY: oy,
            toX: pos.x, toY: pos.y,
            elapsed: 0, duration: 0.6, reverse: false
        };
    } else {
        liveJs.avatarPos = { x: pos.x, y: pos.y, valid: true };
    }
}
