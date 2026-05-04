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
} from '../radial-item-editor/model.js';

const params = new URLSearchParams(window.location.search);
const canvasId = window.__aosSurfaceCanvasId || params.get('canvas-id') || 'sigil-radial-item-workbench';
const initialItemId = params.get('item') || 'wiki-graph';
const toolkitRoot = (params.get('toolkit-root') || 'toolkit').replace(/[^a-zA-Z0-9_-]/g, '');

function addStylesheet(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

addStylesheet(`/${toolkitRoot}/components/_base/theme.css`);
addStylesheet(`/${toolkitRoot}/panel/defaults.css`);
addStylesheet(`/${toolkitRoot}/components/object-transform-panel/styles.css`);

const { default: ObjectTransformPanel } = await import(`/${toolkitRoot}/components/object-transform-panel/index.js`);

const stage = document.getElementById('preview-stage');
const status = document.getElementById('status');
const dragHandle = document.getElementById('drag-handle');
const itemSelect = document.getElementById('item-select');
const spinToggle = document.getElementById('spin-toggle');
const axesToggle = document.getElementById('axes-toggle');
const lockInButton = document.getElementById('lock-in');
const resetOrbitButton = document.getElementById('reset-orbit');
const transformPanel = document.getElementById('transform-panel');
const controlsTitle = document.getElementById('controls-title');
const zoomReadout = document.getElementById('zoom-readout');

const editorState = createRadialItemEditorState({
    items: DEFAULT_SIGIL_RADIAL_ITEMS,
    itemId: initialItemId,
    canvasId,
});
let lastLockIn = null;
let transientStatusText = '';
let transientStatusUntil = 0;

const MIN_SCENE_ZOOM = 0.55;
const MAX_SCENE_ZOOM = 2.2;

function post(type, payload) {
    const body = payload === undefined ? { type } : { type, payload };
    window.webkit?.messageHandlers?.headsup?.postMessage(body);
}

function postRaw(message) {
    window.webkit?.messageHandlers?.headsup?.postMessage(message);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
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
stage.appendChild(renderer.domElement);

const orbit = new THREE.Group();
scene.add(orbit);

const viewScale = new THREE.Group();
orbit.add(viewScale);

function stageRect() {
    return stage.getBoundingClientRect();
}

const sceneScale = 1 / 280;
function projectPoint(point) {
    const rect = stageRect();
    if (!point) return null;
    return new THREE.Vector3(
        (point.x - (rect.width / 2)) * sceneScale,
        -((point.y - (rect.height / 2)) * sceneScale),
        0
    );
}

function projectRadius(_center, radius) {
    return radius * sceneScale;
}

const visuals = createSigilRadialGestureVisuals({
    scene,
    projectPoint,
    projectRadius,
    itemMotion: { modelHoverSpinSpeed: 0 },
});
viewScale.add(visuals.group);

function axisMaterial(color) {
    return new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
    });
}

function axisLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = '700 56px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 48, 50);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.16, 0.16, 0.16);
    return sprite;
}

function createAxisLine(from, to, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, axisMaterial(color));
    line.renderOrder = 20;
    return line;
}

function createAxesGuide() {
    const group = new THREE.Group();
    group.name = 'Workbench Axes Guide';
    group.add(createAxisLine(new THREE.Vector3(-1.25, 0, 0), new THREE.Vector3(1.25, 0, 0), 0xff6b6b));
    group.add(createAxisLine(new THREE.Vector3(0, -1.25, 0), new THREE.Vector3(0, 1.25, 0), 0x58d68d));
    group.add(createAxisLine(new THREE.Vector3(0, 0, -1.25), new THREE.Vector3(0, 0, 1.25), 0x5dade2));
    const x = axisLabel('X', '#ff6b6b');
    x.position.set(1.36, 0, 0);
    const y = axisLabel('Y', '#58d68d');
    y.position.set(0, 1.36, 0);
    const z = axisLabel('Z', '#5dade2');
    z.position.set(0, 0, 1.36);
    group.add(x, y, z);
    return group;
}

const axesGuide = createAxesGuide();
viewScale.add(axesGuide);

const orbitState = {
    x: 0,
    y: 0,
    zoom: 1,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
};

const windowDragState = {
    active: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
};

function syncOrbit() {
    orbit.rotation.x = orbitState.x;
    orbit.rotation.y = orbitState.y;
    viewScale.scale.setScalar(orbitState.zoom);
    axesGuide.visible = axesToggle.checked;
    zoomReadout.textContent = `${Math.round(orbitState.zoom * 100)}%`;
}

function resetOrbit() {
    orbitState.x = 0;
    orbitState.y = 0;
    orbitState.zoom = 1;
    syncOrbit();
}

function syncPreviewSize() {
    const rect = stageRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

window.addEventListener('resize', syncPreviewSize);
new ResizeObserver(syncPreviewSize).observe(stage);
syncPreviewSize();

function registry() {
    return buildEditorObjectRegistry(editorState);
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

function syncPanelRegistry() {
    const snapshot = registry();
    panelContent.onMessage(snapshot, panelHost);
    post('canvas_object.registry', snapshot);
    return snapshot;
}

function applyPatch(message) {
    const result = applyEditorObjectPatch(editorState, message);
    panelContent.onMessage(result, panelHost);
    post('canvas_object.transform.result', result);
    syncPanelRegistry();
    return result;
}

function handlePanelDelivery(delivery = {}) {
    if (delivery.type !== 'canvas.send') {
        post(delivery.type, delivery.payload);
        return null;
    }
    const message = delivery.payload?.message;
    if (message?.type === 'canvas_object.transform.patch') {
        return applyPatch(message);
    }
    return null;
}

const panelContent = ObjectTransformPanel({ emitMessage: handlePanelDelivery });
const panelHost = {
    contentEl: transformPanel,
    setTitle(text) {
        controlsTitle.textContent = text;
    },
};
const renderedPanel = panelContent.render(panelHost);
if (renderedPanel instanceof Node) transformPanel.appendChild(renderedPanel);
else if (typeof renderedPanel === 'string') transformPanel.innerHTML = renderedPanel;

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

function unwrapIncoming(message = {}) {
    return message.payload?.message || message.payload || message;
}

function handleMessage(message = {}) {
    const payload = unwrapIncoming(message);
    if (payload?.type !== 'canvas_object.transform.patch') return;
    applyPatch(payload);
}

window.headsup = window.headsup || {};
window.headsup.receive = function receive(b64) {
    try {
        handleMessage(JSON.parse(atob(b64)));
    } catch (error) {
        console.error('[sigil/radial-item-workbench] bridge receive failed', error);
    }
};

dragHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.('button, select, input, label')) return;
    windowDragState.active = true;
    windowDragState.pointerId = event.pointerId;
    windowDragState.offsetX = event.clientX;
    windowDragState.offsetY = event.clientY;
    dragHandle.dataset.dragging = 'true';
    postRaw({
        type: 'drag_start',
        offsetX: windowDragState.offsetX,
        offsetY: windowDragState.offsetY,
    });
    dragHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
});

dragHandle.addEventListener('pointermove', (event) => {
    if (!windowDragState.active || event.pointerId !== windowDragState.pointerId) return;
    postRaw({
        type: 'move_abs',
        screenX: event.screenX,
        screenY: event.screenY,
        offsetX: windowDragState.offsetX,
        offsetY: windowDragState.offsetY,
    });
    event.preventDefault();
});

function endWindowDrag(event) {
    if (event.pointerId !== windowDragState.pointerId) return;
    windowDragState.active = false;
    windowDragState.pointerId = null;
    delete dragHandle.dataset.dragging;
    dragHandle.releasePointerCapture?.(event.pointerId);
    postRaw({ type: 'drag_end' });
}

dragHandle.addEventListener('pointerup', endWindowDrag);
dragHandle.addEventListener('pointercancel', endWindowDrag);
dragHandle.addEventListener('lostpointercapture', (event) => {
    if (!windowDragState.active || event.pointerId !== windowDragState.pointerId) return;
    endWindowDrag(event);
});

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
renderer.domElement.addEventListener('wheel', (event) => {
    const next = orbitState.zoom * Math.exp(-event.deltaY * 0.0012);
    orbitState.zoom = Math.max(MIN_SCENE_ZOOM, Math.min(MAX_SCENE_ZOOM, next));
    syncOrbit();
    event.preventDefault();
}, { passive: false });

itemSelect.addEventListener('change', () => {
    selectRadialItem(editorState, itemSelect.value);
    syncControls();
    syncPanelRegistry();
});

spinToggle.addEventListener('change', () => {
    setSelectedItemHoverSpin(editorState, spinToggle.checked);
});

axesToggle.addEventListener('change', syncOrbit);
lockInButton.addEventListener('click', lockIn);
resetOrbitButton.addEventListener('click', resetOrbit);

syncControls();
syncOrbit();
syncPanelRegistry();
post('ready', {
    name: 'sigil-radial-item-workbench',
    accepts: ['canvas_object.transform.patch'],
    emits: ['canvas_object.registry', 'canvas_object.transform.result', 'sigil.radial_item_editor.lock_in'],
});

window.__sigilRadialItemWorkbench = {
    state: editorState,
    visuals,
    orbit,
    orbitState,
    registry,
    syncPanelRegistry,
    resetOrbit,
    selectItem(itemId) {
        const item = selectRadialItem(editorState, itemId);
        syncControls();
        syncPanelRegistry();
        return item;
    },
    applyPatch,
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
            selectedItemId: editorState.selectedItemId,
            registry: registry(),
            panel: window.__objectTransformPanelState || null,
            lastLockIn,
            orbit: { x: orbitState.x, y: orbitState.y, zoom: orbitState.zoom },
            axesVisible: axesGuide.visible,
            visuals: visuals.snapshot(),
        };
    },
};

const started = performance.now();
function frame(now) {
    const t = (now - started) / 1000;
    const rect = stageRect();
    const radial = buildEditorRadialSnapshot(editorState, {
        width: rect.width,
        height: rect.height,
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
