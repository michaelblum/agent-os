import state from '../../renderer/state.js';
import { createSkybox } from './skybox.js';

export function initScene() {
    state.scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;

    state.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    state.perspCamera.position.z = 7.5;

    state.orthoCamera = new THREE.OrthographicCamera(
        state.frustumSize * aspect / -2, state.frustumSize * aspect / 2,
        state.frustumSize / 2, state.frustumSize / -2, 0.1, 1000
    );
    state.orthoCamera.position.z = 5;

    state.camera = state.perspCamera;

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(state.renderer.domElement);

    createSkybox();

    // Poly group
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

    // Path points
    state.pathPoints = [
        new THREE.Vector3(-4, 2, -3.0),
        new THREE.Vector3(4, 3, 2.0),
        new THREE.Vector3(3, -3, 3.5),
        new THREE.Vector3(-3, -2, -1.5)
    ];
    state.smoothCurve = new THREE.CatmullRomCurve3(state.pathPoints, true);

    window.addEventListener('resize', onWindowResize);
}

export function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    state.perspCamera.aspect = aspect;
    state.perspCamera.updateProjectionMatrix();
    state.orthoCamera.left = -state.frustumSize * aspect / 2;
    state.orthoCamera.right = state.frustumSize * aspect / 2;
    state.orthoCamera.top = state.frustumSize / 2;
    state.orthoCamera.bottom = -state.frustumSize / 2;
    state.orthoCamera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
}
