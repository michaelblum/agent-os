import state from './state.js';

const SEGMENTS = 25;

// Reusable scratch vectors (avoid per-frame allocations).
// Lazy-init so the module is import-safe when THREE isn't loaded
// (e.g. Studio imports this file transitively via colors.js but never
// instantiates tentacles — it has no 3D scene).
let _dir, _target;
function _ensureScratch() {
    if (!_dir) { _dir = new THREE.Vector3(); _target = new THREE.Vector3(); }
}

// --- Tentacle (lerp-chain magnetic field line) ---
class Tentacle {
    constructor(basePos, length) {
        this.basePos = basePos.clone();
        this.length = length;
        this.points = [];
        for (let i = 0; i < SEGMENTS; i++) {
            this.points.push(new THREE.Vector3().copy(basePos));
        }

        this.material = new THREE.LineBasicMaterial({
            color: new THREE.Color(state.colors.magnetic[0]),
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        this.mesh = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(this.points),
            this.material
        );
        this.phase = Math.random() * Math.PI * 2;
        this.localSpeed = 0.4 + Math.random() * 0.6;
    }

    update(time) {
        _ensureScratch();
        const totalSpeed = this.localSpeed * state.magneticTentacleSpeed;
        const head = this.points[0];
        const wander = state.magneticWander;

        head.x = this.basePos.x + Math.sin(time * totalSpeed + this.phase) * wander;
        head.y = this.basePos.y + Math.cos(time * totalSpeed * 0.8 + this.phase) * wander;
        head.z = this.basePos.z + Math.sin(time * totalSpeed * 1.2 + this.phase) * wander;

        const segLen = this.length / SEGMENTS;
        for (let i = 1; i < SEGMENTS; i++) {
            const prev = this.points[i - 1];
            const curr = this.points[i];
            _dir.subVectors(curr, prev).normalize();
            _target.copy(prev).addScaledVector(_dir, segLen);
            curr.lerp(_target, 0.15);
        }

        const posAttr = this.mesh.geometry.attributes.position;
        for (let i = 0; i < SEGMENTS; i++) {
            posAttr.setXYZ(i, this.points[i].x, this.points[i].y, this.points[i].z);
        }
        posAttr.needsUpdate = true;
        this.material.opacity = (0.4 + Math.sin(time * 2 + this.phase) * 0.2);
    }
}

// --- Public API ---

export function createMagneticField() {
    // Tentacle group (child of polyGroup, scales automatically)
    state.magneticTentacleGroup = new THREE.Group();
    state.magneticTentacleGroup.visible = false;
    state.polyGroup.add(state.magneticTentacleGroup);

    // Create tentacles with Fibonacci spiral distribution on unit sphere
    const count = state.magneticTentacleCount;
    const phi = Math.PI * (3.0 - Math.sqrt(5.0));
    for (let i = 0; i < count; i++) {
        const y = 1.0 - (i / (count - 1)) * 2.0;
        const radius = Math.sqrt(1 - y * y);
        const theta = phi * i;
        const base = new THREE.Vector3(
            radius * Math.cos(theta),
            y,
            radius * Math.sin(theta)
        );

        const t = new Tentacle(base, 2.5);
        state.magneticTentacles.push(t);
        state.magneticTentacleGroup.add(t.mesh);
    }
}

export function animateMagneticField(dt) {
    if (!state.isMagneticEnabled || state.isDestroyed) {
        if (state.magneticTentacleGroup) state.magneticTentacleGroup.visible = false;
        return;
    }

    // Show tentacle group and animate
    state.magneticTentacleGroup.visible = true;
    state.magneticTentacles.forEach(t => t.update(state.globalTime));
}

export function updateMagneticColors() {
    const c1 = new THREE.Color(state.colors.magnetic[0]);
    state.magneticTentacles.forEach(t => t.material.color.copy(c1));
}
