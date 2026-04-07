// Particle Swarm + Black Hole Accretion Disk Module
// Standalone cosmic phenomenon — independent of the 3D grid
import state from '../../renderer/state.js';

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_SWARM = 5000;
const EMITTER_RELOCATE_INTERVAL = 15.0; // sim-seconds

// ── Scratch vectors (reused per-frame, never allocate in loops) ────────────
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _emitterPos = new THREE.Vector3(25, 0, 0);
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

// ── Module-level references ────────────────────────────────────────────────
let swarmPositions = null;
let swarmVelocities = null;
let swarmColors = null;
let swarmSizes = null;
let swarmGeo = null;

// Emitter state
let emitterTimer = 0;

// Cloud texture
let cloudTexture = null;

// ── Texture generation ─────────────────────────────────────────────────────
function makeCloudTexture() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function makeDiskTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(255,200,100,0.9)');
    gradient.addColorStop(0.4, 'rgba(255,120,30,0.6)');
    gradient.addColorStop(0.7, 'rgba(140,20,0,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

// ── HSL helper (avoids THREE.Color allocation in hot loop) ─────────────────
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
}

// ── Emitter ────────────────────────────────────────────────────────────────
function relocateEmitter() {
    // Random point on sphere at radius 20-30
    const radius = 20 + Math.random() * 10;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    _emitterPos.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
    );
    emitterTimer = 0;
}

function spawnParticle(i) {
    const i3 = i * 3;
    // Position: within radius 3.5 blob around emitter
    const r = Math.random() * 3.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    swarmPositions[i3]     = _emitterPos.x + r * Math.sin(phi) * Math.cos(theta);
    swarmPositions[i3 + 1] = _emitterPos.y + r * Math.sin(phi) * Math.sin(theta);
    swarmPositions[i3 + 2] = _emitterPos.z + r * Math.cos(phi);

    // Gentle drift toward mass center + tangential for spiral
    const massPos = state.polyGroup ? state.polyGroup.position : _v.set(0, 0, 0);
    _dir.set(
        massPos.x - swarmPositions[i3],
        massPos.y - swarmPositions[i3 + 1],
        massPos.z - swarmPositions[i3 + 2]
    ).normalize();

    // Tangential component
    _v.set(
        -_dir.y + (Math.random() - 0.5) * 0.3,
        _dir.x + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
    ).normalize().multiplyScalar(0.3);

    swarmVelocities[i3]     = _dir.x * 0.5 + _v.x;
    swarmVelocities[i3 + 1] = _dir.y * 0.5 + _v.y;
    swarmVelocities[i3 + 2] = _dir.z * 0.5 + _v.z;

    // Size: random 0.1 - 1.5
    swarmSizes[i] = 0.1 + Math.random() * 1.4;

    // Color: interpolate between swarm color1 and color2 with variance
    const t = Math.random();
    _c1.set(state.colors.swarm[0]);
    _c2.set(state.colors.swarm[1]);
    _c1.lerp(_c2, t);
    const hsl = {};
    _c1.getHSL(hsl);
    hsl.h += (Math.random() - 0.5) * 0.08;
    _c1.setHSL(hsl.h, hsl.s, hsl.l);
    const cr = _c1.r, cg = _c1.g, cb = _c1.b;
    swarmColors[i3]     = cr;
    swarmColors[i3 + 1] = cg;
    swarmColors[i3 + 2] = cb;
}

// ── Swarm construction ─────────────────────────────────────────────────────
function buildSwarmMesh() {
    swarmPositions = new Float32Array(MAX_SWARM * 3);
    swarmVelocities = new Float32Array(MAX_SWARM * 3);
    swarmColors = new Float32Array(MAX_SWARM * 3);
    swarmSizes = new Float32Array(MAX_SWARM);

    if (!cloudTexture) cloudTexture = makeCloudTexture();

    // Initialize particles
    relocateEmitter();
    for (let i = 0; i < MAX_SWARM; i++) {
        spawnParticle(i);
    }

    swarmGeo = new THREE.BufferGeometry();

    const posAttr = new THREE.BufferAttribute(swarmPositions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(swarmColors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(swarmSizes, 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);

    swarmGeo.setAttribute('position', posAttr);
    swarmGeo.setAttribute('customColor', colAttr);
    swarmGeo.setAttribute('size', sizeAttr);

    const swarmMat = new THREE.ShaderMaterial({
        uniforms: {
            pointTexture: { value: cloudTexture }
        },
        vertexShader: `
            attribute float size;
            attribute vec3 customColor;
            varying vec3 vColor;
            void main() {
                vColor = customColor;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform sampler2D pointTexture;
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
            }
        `,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true
    });

    state.swarmMesh = new THREE.Points(swarmGeo, swarmMat);
    state.swarmMesh.frustumCulled = false;
    swarmGeo.setDrawRange(0, state.swarmCount);
}

function buildAccretionDisk() {
    const diskGeo = new THREE.PlaneGeometry(12, 12);
    const diskTex = makeDiskTexture();
    const diskMat = new THREE.MeshBasicMaterial({
        map: diskTex,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.blackHoleDiskMesh = new THREE.Mesh(diskGeo, diskMat);
    state.blackHoleDiskMesh.rotation.x = Math.PI * 0.44; // ~80 degrees tilt
    state.blackHoleDiskMesh.frustumCulled = false;
}

function buildHalo() {
    const haloGeo = new THREE.SphereGeometry(1.05, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
        color: 0x00cccc,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.blackHoleHaloMesh = new THREE.Mesh(haloGeo, haloMat);
    state.blackHoleHaloMesh.frustumCulled = false;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function createSwarm() {
    // 1. Build particle swarm mesh
    buildSwarmMesh();

    // 2. Build accretion disk
    buildAccretionDisk();

    // 3. Build halo sphere
    buildHalo();

    // 4. Add to scene
    state.scene.add(state.swarmMesh);
    state.scene.add(state.blackHoleDiskMesh);
    state.scene.add(state.blackHoleHaloMesh);

    // 5. All invisible initially
    state.swarmMesh.visible = false;
    state.blackHoleDiskMesh.visible = false;
    state.blackHoleHaloMesh.visible = false;
}

export function animateSwarm(dt) {
    // ── Visibility gate ────────────────────────────────────────────────
    if (!state.isSwarmEnabled) {
        if (state.swarmMesh) state.swarmMesh.visible = false;
        if (state.blackHoleDiskMesh) state.blackHoleDiskMesh.visible = false;
        if (state.blackHoleHaloMesh) state.blackHoleHaloMesh.visible = false;
        return;
    }

    const gravity = state.swarmGravity;
    const eventHorizon = state.swarmEventHorizon;
    const isBlackHole = state.isBlackHoleMode;
    const timeScale = state.swarmTimeScale;

    // Mass center
    const massPos = state.polyGroup.position;

    // ── Toggle mesh visibility ─────────────────────────────────────────
    if (state.swarmMesh) state.swarmMesh.visible = true;
    if (state.blackHoleDiskMesh) state.blackHoleDiskMesh.visible = isBlackHole;
    if (state.blackHoleHaloMesh) state.blackHoleHaloMesh.visible = !isBlackHole;

    // ── Swarm physics ──────────────────────────────────────────────────
    if (swarmPositions) {
        const scaledDt = dt * timeScale;

        // Emitter relocation
        emitterTimer += scaledDt;
        if (emitterTimer >= EMITTER_RELOCATE_INTERVAL) {
            relocateEmitter();
        }

        // Update draw range for active count
        swarmGeo.setDrawRange(0, state.swarmCount);

        const count = Math.min(state.swarmCount, MAX_SWARM);
        const ehThreshold = eventHorizon * 0.8;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            const px = swarmPositions[i3];
            const py = swarmPositions[i3 + 1];
            const pz = swarmPositions[i3 + 2];

            // Direction to mass center
            const dx = massPos.x - px;
            const dy = massPos.y - py;
            const dz = massPos.z - pz;
            const distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq);

            // Gravity acceleration — cubic falloff for black hole, square for normal
            let pull;
            if (isBlackHole) {
                pull = (gravity * 0.5) / (Math.pow(dist, 1.5) + 1);
            } else {
                pull = (gravity * 0.5) / (distSq + 1);
            }

            if (dist > 0.001) {
                const invDist = 1 / dist;
                const ax = dx * invDist * pull;
                const ay = dy * invDist * pull;
                const az = dz * invDist * pull;
                swarmVelocities[i3]     += ax * scaledDt;
                swarmVelocities[i3 + 1] += ay * scaledDt;
                swarmVelocities[i3 + 2] += az * scaledDt;
            }

            // Update position
            swarmPositions[i3]     += swarmVelocities[i3]     * scaledDt;
            swarmPositions[i3 + 1] += swarmVelocities[i3 + 1] * scaledDt;
            swarmPositions[i3 + 2] += swarmVelocities[i3 + 2] * scaledDt;

            // Check absorption
            if (dist < ehThreshold) {
                state.swarmAbsorbed++;
                spawnParticle(i);
            }
        }

        swarmGeo.attributes.position.needsUpdate = true;
        swarmGeo.attributes.customColor.needsUpdate = true;
        swarmGeo.attributes.size.needsUpdate = true;
    }

    // ── Update absorbed counter UI ─────────────────────────────────────
    const absorbedEl = document.getElementById('swarmAbsorbedCount');
    if (absorbedEl) absorbedEl.textContent = state.swarmAbsorbed;

    // ── Halo: scales with event horizon, positioned at mass ────────────
    if (state.blackHoleHaloMesh) {
        state.blackHoleHaloMesh.position.copy(massPos);
        state.blackHoleHaloMesh.scale.setScalar(eventHorizon);
    }

    // ── Accretion disk: spins, positioned at mass ──────────────────────
    if (state.blackHoleDiskMesh) {
        state.blackHoleDiskMesh.position.copy(massPos);
        state.blackHoleDiskMesh.rotation.z += dt * timeScale * 0.3;
        const diskScale = eventHorizon * 1.5;
        state.blackHoleDiskMesh.scale.setScalar(diskScale);
    }
}

export function updateSwarmColors() {
    if (!swarmGeo || !swarmColors) return;
    const count = state.swarmCount;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const t = Math.random();
        _c1.set(state.colors.swarm[0]);
        _c2.set(state.colors.swarm[1]);
        _c1.lerp(_c2, t);
        const hsl = {};
        _c1.getHSL(hsl);
        hsl.h += (Math.random() - 0.5) * 0.08;
        _c1.setHSL(hsl.h, hsl.s, hsl.l);
        swarmColors[i3]     = _c1.r;
        swarmColors[i3 + 1] = _c1.g;
        swarmColors[i3 + 2] = _c1.b;
    }
    swarmGeo.attributes.customColor.needsUpdate = true;
}
