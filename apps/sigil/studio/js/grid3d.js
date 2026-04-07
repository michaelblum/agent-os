// 3D Volumetric Spacetime Grid Module
// CPU-warped voxel grid (3D), multi-segment flat grid (2D), probe, and snow globe
import state from '../../renderer/state.js';

// ── Constants ──────────────────────────────────────────────────────────────
const UNIVERSE_SIZE = 24.0;

// ── Scratch vectors (reused per-frame, never allocate in loops) ────────────
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toMass = new THREE.Vector3();

// ── 3D grid module-level refs ──────────────────────────────────────────────
let basePositions = null;   // Float32Array — immutable grid template
let positions = null;       // Float32Array — warped each frame
let colors = null;          // Float32Array — recolored each frame
let gridGeo = null;
let pointGeo = null;
let vertexCount = 0;

// Grid offset for relative-motion mode
const gridOffset = new THREE.Vector3();

// ── Flat grid (2D mode) ────────────────────────────────────────────────────
const FLAT_SCALE = 4.0;
const FLAT_Z = -8.0;
const FLAT_SEGS = 64;  // segments per line — enough for smooth warp curves

let flatBasePos = null;
let flatPos = null;
let flatCol = null;
let flatGeo = null;
let flatMesh = null;
let flatVertCount = 0;
let _flatLastDensity = -1;
let _flatC1 = null;
let _flatC2 = null;

// ── Probe ──────────────────────────────────────────────────────────────────
let probeBasePositions = null;
let probeVelocity = new THREE.Vector3();

// Cloud texture (for grid points)
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

// ── 3D Grid construction (CPU-warped point lattice) ────────────────────────
function buildGrid3dInternal(density) {
    const spacing = UNIVERSE_SIZE / density;
    const halfSize = UNIVERSE_SIZE / 2;
    vertexCount = density * density * density;

    basePositions = new Float32Array(vertexCount * 3);
    positions = new Float32Array(vertexCount * 3);
    colors = new Float32Array(vertexCount * 3);

    let idx = 0;
    for (let ix = 0; ix < density; ix++) {
        for (let iy = 0; iy < density; iy++) {
            for (let iz = 0; iz < density; iz++) {
                basePositions[idx]     = -halfSize + ix * spacing + spacing * 0.5;
                basePositions[idx + 1] = -halfSize + iy * spacing + spacing * 0.5;
                basePositions[idx + 2] = -halfSize + iz * spacing + spacing * 0.5;
                idx += 3;
            }
        }
    }
    positions.set(basePositions);
    for (let i = 0; i < vertexCount * 3; i += 3) {
        colors[i] = 0.15;
        colors[i + 1] = 0.2;
        colors[i + 2] = 0.6;
    }

    // Index buffer: connect adjacent vertices along X, Y, Z axes
    const indices = [];
    for (let ix = 0; ix < density; ix++) {
        for (let iy = 0; iy < density; iy++) {
            for (let iz = 0; iz < density; iz++) {
                const current = ix * density * density + iy * density + iz;
                if (ix < density - 1) indices.push(current, (ix + 1) * density * density + iy * density + iz);
                if (iy < density - 1) indices.push(current, ix * density * density + (iy + 1) * density + iz);
                if (iz < density - 1) indices.push(current, ix * density * density + iy * density + (iz + 1));
            }
        }
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);

    gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', posAttr);
    gridGeo.setAttribute('color', colAttr);
    gridGeo.setIndex(new THREE.BufferAttribute(
        vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1
    ));

    const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.grid3dMesh = new THREE.LineSegments(gridGeo, lineMat);
    state.grid3dMesh.frustumCulled = false;

    // Points geometry (shares same data)
    pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', posAttr);
    pointGeo.setAttribute('color', colAttr);

    if (!cloudTexture) cloudTexture = makeCloudTexture();

    const pointMat = new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        alphaTest: 0.05,
        map: cloudTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.grid3dPointCloud = new THREE.Points(pointGeo, pointMat);
    state.grid3dPointCloud.frustumCulled = false;
}

// ── Flat grid construction (multi-segment lines for smooth curves) ─────────
function buildFlatGrid(density) {
    const halfSize = UNIVERSE_SIZE * FLAT_SCALE / 2;
    const step = UNIVERSE_SIZE * FLAT_SCALE / density;

    const lineCount = (density + 1) * 2;
    flatVertCount = lineCount * (FLAT_SEGS + 1);

    flatBasePos = new Float32Array(flatVertCount * 3);
    flatPos = new Float32Array(flatVertCount * 3);
    flatCol = new Float32Array(flatVertCount * 3);

    const indices = [];
    let v = 0;

    // Horizontal lines (fixed y, varying x)
    for (let i = 0; i <= density; i++) {
        const y = -halfSize + i * step;
        for (let s = 0; s <= FLAT_SEGS; s++) {
            const x = -halfSize + (s / FLAT_SEGS) * (UNIVERSE_SIZE * FLAT_SCALE);
            flatBasePos[v * 3]     = x;
            flatBasePos[v * 3 + 1] = y;
            flatBasePos[v * 3 + 2] = FLAT_Z;
            if (s > 0) indices.push(v - 1, v);
            v++;
        }
    }

    // Vertical lines (fixed x, varying y)
    for (let i = 0; i <= density; i++) {
        const x = -halfSize + i * step;
        for (let s = 0; s <= FLAT_SEGS; s++) {
            const y = -halfSize + (s / FLAT_SEGS) * (UNIVERSE_SIZE * FLAT_SCALE);
            flatBasePos[v * 3]     = x;
            flatBasePos[v * 3 + 1] = y;
            flatBasePos[v * 3 + 2] = FLAT_Z;
            if (s > 0) indices.push(v - 1, v);
            v++;
        }
    }

    flatPos.set(flatBasePos);

    const posAttr = new THREE.BufferAttribute(flatPos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(flatCol, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);

    flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', posAttr);
    flatGeo.setAttribute('color', colAttr);
    flatGeo.setIndex(new THREE.BufferAttribute(
        flatVertCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1
    ));

    const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    flatMesh = new THREE.LineSegments(flatGeo, mat);
    flatMesh.frustumCulled = false;
    _flatLastDensity = density;
}

// ── Probe construction ─────────────────────────────────────────────────────
function buildProbe() {
    const geo = new THREE.SphereGeometry(2, 24, 24);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x00ff66,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.grid3dProbeMesh = new THREE.Mesh(geo, mat);
    state.grid3dProbeMesh.frustumCulled = false;

    const posArr = geo.attributes.position.array;
    probeBasePositions = new Float32Array(posArr.length);
    probeBasePositions.set(posArr);

    state.grid3dProbeMesh.position.set(25, 0, 0);
    probeVelocity.set(-0.3, 0.1, 0.05);
}

// ── Accessory construction ─────────────────────────────────────────────────
function buildAccessories() {
    const globeGeo = new THREE.SphereGeometry(1, 64, 64);
    const globeMat = new THREE.MeshBasicMaterial({
        color: 0x4488ff,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide,
        depthWrite: false
    });
    state.grid3dGlobeMesh = new THREE.Mesh(globeGeo, globeMat);
    state.grid3dGlobeMesh.frustumCulled = false;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function createGrid3d() {
    buildGrid3dInternal(state.grid3dDensity);
    buildProbe();
    buildAccessories();

    state.scene.add(state.grid3dMesh);
    state.scene.add(state.grid3dPointCloud);
    state.scene.add(state.grid3dProbeMesh);
    state.scene.add(state.grid3dGlobeMesh);

    state.grid3dMesh.visible = false;
    state.grid3dPointCloud.visible = false;
    state.grid3dProbeMesh.visible = false;
    state.grid3dGlobeMesh.visible = false;

    buildFlatGrid(state.grid3dDensity);
    state.scene.add(flatMesh);
    flatMesh.visible = false;
}

export function rebuildGrid3d() {
    if (state.grid3dMesh) {
        state.scene.remove(state.grid3dMesh);
        state.grid3dMesh.geometry.dispose();
        state.grid3dMesh.material.dispose();
        state.grid3dMesh = null;
    }
    if (state.grid3dPointCloud) {
        state.scene.remove(state.grid3dPointCloud);
        state.grid3dPointCloud.geometry.dispose();
        state.grid3dPointCloud.material.dispose();
        state.grid3dPointCloud = null;
    }

    buildGrid3dInternal(state.grid3dDensity);

    state.scene.add(state.grid3dMesh);
    state.scene.add(state.grid3dPointCloud);

    const isWireframe = state.grid3dRenderMode === 'wireframe';
    state.grid3dMesh.visible = state.gridMode !== 'off' && isWireframe;
    state.grid3dPointCloud.visible = state.gridMode !== 'off' && !isWireframe;
}

export function animateGrid3d(dt) {
    // ── Visibility gate ────────────────────────────────────────────────
    if (state.gridMode === 'off') {
        const meshes = [state.grid3dMesh, state.grid3dPointCloud, state.grid3dProbeMesh, state.grid3dGlobeMesh];
        for (let i = 0; i < meshes.length; i++) { if (meshes[i]) meshes[i].visible = false; }
        if (flatMesh) flatMesh.visible = false;
        return;
    }

    // ── Flat mode ──────────────────────────────────────────────────────
    if (state.gridMode === 'flat') {
        if (state.grid3dMesh) state.grid3dMesh.visible = false;
        if (state.grid3dPointCloud) state.grid3dPointCloud.visible = false;
        if (state.grid3dProbeMesh) state.grid3dProbeMesh.visible = false;
        if (state.grid3dGlobeMesh) state.grid3dGlobeMesh.visible = false;

        // Rebuild if density changed
        if (state.grid3dDensity !== _flatLastDensity) {
            if (flatMesh) {
                state.scene.remove(flatMesh);
                flatGeo.dispose();
                flatMesh.material.dispose();
                flatMesh = null;
            }
            buildFlatGrid(state.grid3dDensity);
            state.scene.add(flatMesh);
        }

        if (!flatMesh) return;
        flatMesh.visible = true;

        const massPos = (state.grid3dRelativeMotion && state._grid3dLogicalPos)
            ? state._grid3dLogicalPos
            : state.polyGroup.position;

        // Gaussian warp — localized bowl ("bowling ball on a trampoline")
        const gridMass = Math.min(state.swarmGravity * 0.05, 3.0);
        const warpDepth = gridMass * 10.0;
        const influenceRadius = Math.max(gridMass * 2.5, 1.0);
        const invInfluenceSq = 1.0 / (influenceRadius * influenceRadius);

        _flatC1 = _flatC1 || new THREE.Color();
        _flatC2 = _flatC2 || new THREE.Color();
        _flatC1.set(state.colors.grid[0]);
        _flatC2.set(state.colors.grid[1]);

        const ox = state.grid3dRelativeMotion ? -massPos.x : 0;
        const oy = state.grid3dRelativeMotion ? -massPos.y : 0;

        for (let i = 0; i < flatVertCount; i++) {
            const i3 = i * 3;
            const bx = flatBasePos[i3]     + ox;
            const by = flatBasePos[i3 + 1] + oy;
            const dx = bx - massPos.x;
            const dy = by - massPos.y;
            const distSq = dx * dx + dy * dy;
            const zOffset = -warpDepth * Math.exp(-distSq * invInfluenceSq);

            flatPos[i3]     = bx;
            flatPos[i3 + 1] = by;
            flatPos[i3 + 2] = FLAT_Z + zOffset;

            // Color: distance from origin for stable gradient
            const originDist = Math.sqrt(bx * bx + by * by);
            const t = Math.min(originDist / 50.0, 1.0);
            const cr = _flatC1.r + (_flatC2.r - _flatC1.r) * t;
            const cg = _flatC1.g + (_flatC2.g - _flatC1.g) * t;
            const cb = _flatC1.b + (_flatC2.b - _flatC1.b) * t;
            const warpBright = Math.min(1.0, Math.abs(zOffset) / Math.max(warpDepth, 0.01));
            flatCol[i3]     = Math.min(1, cr + warpBright * 0.35);
            flatCol[i3 + 1] = Math.min(1, cg + warpBright * 0.12);
            flatCol[i3 + 2] = Math.min(1, cb + warpBright * 0.45);
        }

        flatGeo.attributes.position.needsUpdate = true;
        flatGeo.attributes.color.needsUpdate = true;
        return;
    }

    // ── 3D mode ────────────────────────────────────────────────────────
    if (flatMesh) flatMesh.visible = false;

    const mass = state.swarmGravity;
    const eventHorizon = state.z_depth * state.novaScale;
    const renderRadius = state.grid3dRenderRadius;
    const isBlackHole = state.isBlackHoleMode;
    const isSnowGlobe = state.grid3dSnowGlobe;
    const isWireframe = state.grid3dRenderMode === 'wireframe';
    const timeScale = state.grid3dTimeScale;

    const massPos = (state.grid3dRelativeMotion && state._grid3dLogicalPos)
        ? state._grid3dLogicalPos
        : state.polyGroup.position;

    // ── Toggle mesh visibility ─────────────────────────────────────────
    if (state.grid3dMesh) state.grid3dMesh.visible = isWireframe;
    if (state.grid3dPointCloud) state.grid3dPointCloud.visible = !isWireframe;
    if (state.grid3dProbeMesh) state.grid3dProbeMesh.visible = state.grid3dShowProbe;
    if (state.grid3dGlobeMesh) state.grid3dGlobeMesh.visible = isSnowGlobe;

    // ── Relative motion offset ─────────────────────────────────────────
    if (state.grid3dRelativeMotion) {
        gridOffset.set(-massPos.x, -massPos.y, -massPos.z);
    } else {
        gridOffset.set(0, 0, 0);
    }

    // ── CPU warp grid vertices ─────────────────────────────────────────
    if (basePositions && positions && colors) {
        for (let i = 0; i < vertexCount; i++) {
            const i3 = i * 3;
            const bx = basePositions[i3]     + gridOffset.x;
            const by = basePositions[i3 + 1] + gridOffset.y;
            const bz = basePositions[i3 + 2] + gridOffset.z;

            let dx, dy, dz, dist, distSq, pull;

            if (state.grid3dRelativeMotion) {
                dx = -bx; dy = -by; dz = -bz;
            } else {
                dx = massPos.x - bx;
                dy = massPos.y - by;
                dz = massPos.z - bz;
            }

            distSq = dx * dx + dy * dy + dz * dz;
            dist = Math.sqrt(distSq);

            if (isBlackHole) {
                pull = (mass / 2) / (Math.pow(dist, 1.5) + 1);
            } else {
                pull = (mass / 10) / (distSq + 1);
            }
            if (pull > dist - eventHorizon) {
                pull = Math.max(0, dist - eventHorizon);
            }

            let nx, ny, nz;
            if (dist > 0.001) {
                const invDist = 1 / dist;
                nx = bx + dx * invDist * pull;
                ny = by + dy * invDist * pull;
                nz = bz + dz * invDist * pull;
            } else {
                nx = bx; ny = by; nz = bz;
            }

            positions[i3]     = nx;
            positions[i3 + 1] = ny;
            positions[i3 + 2] = nz;

            // Color: HSL based on warp intensity
            const intensity = Math.min(pull / (dist + 0.5), 1.0);
            let hue, sat, light;
            if (isBlackHole) {
                hue = 0.15 - intensity * 0.15;
                sat = 1.0;
                light = 0.1 + intensity * 0.6;
                if (dist < eventHorizon * 2) {
                    light = Math.min(1.0, light + 0.3 * (1 - dist / (eventHorizon * 2)));
                }
            } else {
                hue = 0.6 - intensity * 0.6;
                sat = 1.0;
                light = 0.08 + intensity * 0.45;
            }

            let alpha = 1.0;
            if (isSnowGlobe) {
                if (dist > renderRadius) alpha = 0.0;
            } else if (dist > renderRadius * 0.7) {
                alpha = Math.max(0, 1.0 - (dist - renderRadius * 0.7) / (renderRadius * 0.3));
            }

            const [cr, cg, cb] = hslToRgb(hue, sat, light);
            colors[i3]     = cr * alpha;
            colors[i3 + 1] = cg * alpha;
            colors[i3 + 2] = cb * alpha;
        }

        gridGeo.attributes.position.needsUpdate = true;
        gridGeo.attributes.color.needsUpdate = true;
    }

    // ── Probe physics ──────────────────────────────────────────────────
    if (state.grid3dShowProbe && state.grid3dProbeMesh) {
        const probePos = state.grid3dProbeMesh.position;

        _toMass.set(massPos.x - probePos.x, massPos.y - probePos.y, massPos.z - probePos.z);
        const probeDist = _toMass.length();

        if (probeDist > 0.001) {
            const probePull = (mass * 0.3) / (probeDist * probeDist + 1);
            _toMass.normalize().multiplyScalar(probePull * dt * timeScale);
            probeVelocity.add(_toMass);
        }

        probePos.add(_v.copy(probeVelocity).multiplyScalar(dt * timeScale));

        const distToMass = probePos.distanceTo(massPos);
        if (distToMass < eventHorizon * 0.8) {
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.5) * Math.PI;
            probePos.set(
                massPos.x + 25 * Math.cos(elevation) * Math.cos(angle),
                massPos.y + 25 * Math.sin(elevation),
                massPos.z + 25 * Math.cos(elevation) * Math.sin(angle)
            );
            _dir.set(massPos.x - probePos.x, massPos.y - probePos.y, massPos.z - probePos.z).normalize().multiplyScalar(0.5);
            probeVelocity.copy(_dir);
        }

        const geo = state.grid3dProbeMesh.geometry;
        const posArr = geo.attributes.position.array;
        const count = posArr.length / 3;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const wx = probeBasePositions[i3]     + probePos.x;
            const wy = probeBasePositions[i3 + 1] + probePos.y;
            const wz = probeBasePositions[i3 + 2] + probePos.z;

            const pdx = massPos.x - wx;
            const pdy = massPos.y - wy;
            const pdz = massPos.z - wz;
            const pDistSq = pdx * pdx + pdy * pdy + pdz * pdz;
            const pDist = Math.sqrt(pDistSq);

            let pPull;
            if (isBlackHole) {
                pPull = (mass / 2) / (Math.pow(pDist, 1.5) + 1);
            } else {
                pPull = (mass / 10) / (pDistSq + 1);
            }
            if (pPull > pDist - eventHorizon) pPull = Math.max(0, pDist - eventHorizon);

            if (pDist > 0.001) {
                const inv = 1 / pDist;
                posArr[i3]     = probeBasePositions[i3]     + pdx * inv * pPull;
                posArr[i3 + 1] = probeBasePositions[i3 + 1] + pdy * inv * pPull;
                posArr[i3 + 2] = probeBasePositions[i3 + 2] + pdz * inv * pPull;
            } else {
                posArr[i3]     = probeBasePositions[i3];
                posArr[i3 + 1] = probeBasePositions[i3 + 1];
                posArr[i3 + 2] = probeBasePositions[i3 + 2];
            }
        }
        geo.attributes.position.needsUpdate = true;
    }

    // ── Accessories ────────────────────────────────────────────────────
    if (state.grid3dGlobeMesh) {
        if (state.grid3dRelativeMotion) {
            state.grid3dGlobeMesh.position.set(0, 0, 0);
        } else {
            state.grid3dGlobeMesh.position.copy(massPos);
        }
        state.grid3dGlobeMesh.scale.setScalar(renderRadius);
    }
}
