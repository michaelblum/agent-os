import state from '../../js/state.js';

export function initScene() {
    state.scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;

    state.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    state.perspCamera.position.z = 7.5;
    state.camera = state.perspCamera;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setClearColor(0x000000, 0);
    document.body.appendChild(state.renderer.domElement);

    // No skybox — transparent background

    state.polyGroup = new THREE.Group();
    state.scene.add(state.polyGroup);

    // Lighting
    state.pointLight = new THREE.PointLight(0xffffff, 1.5, 10);
    state.polyGroup.add(state.pointLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 5, 5);
    state.scene.add(dirLight);
    state.scene.add(new THREE.AmbientLight(0x444444));

    // Initialize THREE.Vector3 state fields
    state.quickSpinAxis = new THREE.Vector3();
    state.dragMomentumAxis = new THREE.Vector3();
    state.targetPosition = new THREE.Vector3(0, 0, 0);
    state.moveRotationAxis = new THREE.Vector3(0, 1, 0);

    window.addEventListener('resize', onWindowResize);
    state.baseScale = computeBaseScale(state.avatarBase);
}

export function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    state.perspCamera.aspect = aspect;
    state.perspCamera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.baseScale = computeBaseScale(state.avatarBase);
}

// --- Base scale: maps avatarBase (logical pixels) to scene units ---
// Reference calibration: at base=300 on a 1080-logical-pixel display,
// z_depth=1.1 produced the correct visual. baseScale absorbs that so
// z_depth can default to 1.0 as a pure creative multiplier.
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;

export function computeBaseScale(base) {
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / window.innerHeight);
}

// --- Coordinate mapping: screen pixels → scene units ---
export function screenToScene(px, py) {
    const vFov = state.perspCamera.fov * Math.PI / 180;
    const dist = state.perspCamera.position.z;
    const visibleHeight = 2 * Math.tan(vFov / 2) * dist;
    const visibleWidth = visibleHeight * state.perspCamera.aspect;

    const sx = (px / window.innerWidth - 0.5) * visibleWidth;
    const sy = -(py / window.innerHeight - 0.5) * visibleHeight;
    return { x: sx, y: sy };
}
