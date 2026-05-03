import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../renderer/radial-menu-defaults.js';
import { createSigilRadialGestureVisuals } from '../renderer/live-modules/radial-gesture-visuals.js';
import {
    applyEditorObjectPatch,
    buildEditorObjectRegistry,
    buildEditorRadialSnapshot,
    createRadialItemEditorState,
    editableRadialItems,
    exportSelectedRadialItemDefinition,
    selectRadialItem,
    selectedRadialItem,
    setSelectedItemHoverSpin,
} from './model.js';

const params = new URLSearchParams(window.location.search);
const canvasId = window.__aosSurfaceCanvasId || params.get('canvas-id') || 'sigil-radial-item-editor';
const controllerId = params.get('controller-id') || 'object-transform-panel';
const initialItemId = params.get('item') || 'wiki-graph';

const status = document.getElementById('status');
const toolbar = document.getElementById('toolbar');
const itemSelect = document.getElementById('item-select');
const spinToggle = document.getElementById('spin-toggle');
const lockInButton = document.getElementById('lock-in');
const resetOrbitButton = document.getElementById('reset-orbit');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3.4);
scene.add(new THREE.AmbientLight(0x99ccff, 0.72));

const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(1.4, 2.0, 2.2);
scene.add(key);

const rim = new THREE.PointLight(0x55ffff, 1.4, 8);
rim.position.set(-1.8, -0.4, 1.8);
scene.add(rim);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

function post(type, payload) {
    const body = payload === undefined ? { type } : { type, payload };
    window.webkit?.messageHandlers?.headsup?.postMessage(body);
}

function sendToController(message) {
    post('canvas.send', { target: controllerId, message });
}

function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

const sceneScale = 1 / 280;
function projectPoint(point) {
    if (!point) return null;
    return new THREE.Vector3(
        (point.x - (window.innerWidth / 2)) * sceneScale,
        -((point.y - (window.innerHeight / 2)) * sceneScale),
        0
    );
}

function projectRadius(_center, radius) {
    return radius * sceneScale;
}

const orbit = new THREE.Group();
scene.add(orbit);

const visuals = createSigilRadialGestureVisuals({
    scene,
    projectPoint,
    projectRadius,
    itemMotion: { modelHoverSpinSpeed: 0 },
});
orbit.add(visuals.group);

const editorState = createRadialItemEditorState({
    items: DEFAULT_SIGIL_RADIAL_ITEMS,
    itemId: initialItemId,
    canvasId,
});
let lastLockIn = null;
let transientStatusText = '';
let transientStatusUntil = 0;

const orbitState = {
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
};

function syncOrbit() {
    orbit.rotation.x = orbitState.x;
    orbit.rotation.y = orbitState.y;
}

function resetOrbit() {
    orbitState.x = 0;
    orbitState.y = 0;
    syncOrbit();
}

function syncControls() {
    itemSelect.replaceChildren(...editableRadialItems(editorState.items).map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === editorState.selectedItemId;
        return option;
    }));
    const item = selectedRadialItem(editorState);
    spinToggle.checked = Number(item?.geometry?.hoverSpinSpeed) > 0;
}

function registry() {
    return buildEditorObjectRegistry(editorState);
}

function emitRegistry() {
    const snapshot = registry();
    post('canvas_object.registry', snapshot);
    sendToController(snapshot);
    return snapshot;
}

function setTransientStatus(text, durationMs = 2400) {
    transientStatusText = text;
    transientStatusUntil = performance.now() + durationMs;
}

function lockIn() {
    lastLockIn = exportSelectedRadialItemDefinition(editorState);
    post(lastLockIn.type, lastLockIn);
    const item = selectedRadialItem(editorState);
    setTransientStatus(`${item?.label || item?.id || 'Radial item'} lock-in payload emitted`);
    return lastLockIn;
}

function handlePatch(payload) {
    const result = applyEditorObjectPatch(editorState, payload);
    post('canvas_object.transform.result', result);
    sendToController(result);
    emitRegistry();
    return result;
}

function unwrapIncoming(message = {}) {
    return message.payload?.message || message.payload || message;
}

function handleMessage(message = {}) {
    const payload = unwrapIncoming(message);
    if (payload?.type !== 'canvas_object.transform.patch') return;
    handlePatch(payload);
}

window.headsup = window.headsup || {};
window.headsup.receive = function receive(b64) {
    try {
        handleMessage(JSON.parse(atob(b64)));
    } catch (error) {
        console.error('[sigil/radial-item-editor] bridge receive failed', error);
    }
};

renderer.domElement.addEventListener('pointerdown', (event) => {
    orbitState.dragging = true;
    orbitState.pointerId = event.pointerId;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;
    renderer.domElement.classList.add('dragging');
    renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
});

renderer.domElement.addEventListener('pointermove', (event) => {
    if (!orbitState.dragging || event.pointerId !== orbitState.pointerId) return;
    const dx = event.clientX - orbitState.lastX;
    const dy = event.clientY - orbitState.lastY;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;
    orbitState.y += dx * 0.01;
    orbitState.x = Math.max(-1.25, Math.min(1.25, orbitState.x + (dy * 0.01)));
    syncOrbit();
    event.preventDefault();
});

function endOrbitDrag(event) {
    if (event.pointerId !== orbitState.pointerId) return;
    orbitState.dragging = false;
    orbitState.pointerId = null;
    renderer.domElement.classList.remove('dragging');
    renderer.domElement.releasePointerCapture?.(event.pointerId);
}

renderer.domElement.addEventListener('pointerup', endOrbitDrag);
renderer.domElement.addEventListener('pointercancel', endOrbitDrag);
renderer.domElement.addEventListener('dblclick', resetOrbit);
toolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
lockInButton.addEventListener('click', lockIn);
resetOrbitButton.addEventListener('click', resetOrbit);

itemSelect.addEventListener('change', () => {
    selectRadialItem(editorState, itemSelect.value);
    syncControls();
    emitRegistry();
});

spinToggle.addEventListener('change', () => {
    setSelectedItemHoverSpin(editorState, spinToggle.checked);
});

syncControls();
post('ready', {
    name: 'sigil-radial-item-editor',
    accepts: ['canvas_object.transform.patch'],
    emits: ['canvas_object.registry', 'canvas_object.transform.result', 'sigil.radial_item_editor.lock_in'],
});
emitRegistry();

window.__sigilRadialItemEditor = {
    state: editorState,
    visuals,
    orbit,
    orbitState,
    registry,
    emitRegistry,
    resetOrbit,
    selectItem(itemId) {
        const item = selectRadialItem(editorState, itemId);
        syncControls();
        emitRegistry();
        return item;
    },
    applyPatch(message) {
        return handlePatch(message);
    },
    exportItemDefinition(options) {
        return exportSelectedRadialItemDefinition(editorState, options);
    },
    lockIn,
    get lastLockIn() {
        return lastLockIn;
    },
    snapshot() {
        return {
            canvasId,
            controllerId,
            selectedItemId: editorState.selectedItemId,
            registry: registry(),
            lastLockIn,
            orbit: { x: orbitState.x, y: orbitState.y },
            visuals: visuals.snapshot(),
        };
    },
};

const started = performance.now();
function frame(now) {
    const t = (now - started) / 1000;
    const radial = buildEditorRadialSnapshot(editorState, {
        width: window.innerWidth,
        height: window.innerHeight,
    });
    visuals.update(radial, { time: t });
    const snapshot = visuals.snapshot();
    const item = selectedRadialItem(editorState);
    const geometry = item ? snapshot.geometry?.[item.id] : null;
    status.textContent = now < transientStatusUntil
        ? transientStatusText
        : geometry?.status === 'ready'
        ? `${item.label || item.id} editor`
        : `Loading ${geometry?.status || item?.label || 'radial item'}...`;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
