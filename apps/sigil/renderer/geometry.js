import state from './state.js';
import { applyGradientVertexColors } from './colors.js';
import { applySkin, updateSkinColorRamp } from './skins.js';

export function createStellatedGeometry(baseGeometry, factor) {
    const nonIndexed = baseGeometry.toNonIndexed();
    if (Math.abs(factor) < 0.01) { nonIndexed.computeVertexNormals(); return nonIndexed; }
    const positionAttribute = nonIndexed.getAttribute('position');
    const count = positionAttribute.count;
    const newVertices = [];
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const centroid = new THREE.Vector3(), normal = new THREE.Vector3();
    const cb = new THREE.Vector3(), ab = new THREE.Vector3();

    for (let i = 0; i < count; i += 3) {
        vA.fromBufferAttribute(positionAttribute, i);
        vB.fromBufferAttribute(positionAttribute, i + 1);
        vC.fromBufferAttribute(positionAttribute, i + 2);
        centroid.copy(vA).add(vB).add(vC).divideScalar(3);
        cb.subVectors(vC, vB); ab.subVectors(vA, vB);
        normal.crossVectors(cb, ab).normalize();
        const peak = new THREE.Vector3().copy(centroid).add(normal.multiplyScalar(factor));

        newVertices.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, peak.x, peak.y, peak.z);
        newVertices.push(vB.x, vB.y, vB.z, vC.x, vC.y, vC.z, peak.x, peak.y, peak.z);
        newVertices.push(vC.x, vC.y, vC.z, vA.x, vA.y, vA.z, peak.x, peak.y, peak.z);
    }
    const stellatedGeometry = new THREE.BufferGeometry();
    stellatedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newVertices, 3));
    stellatedGeometry.computeVertexNormals();
    return stellatedGeometry;
}

export function createTetartoid(size, a, b, c) {
    // Clamp to valid range and ensure a <= b <= c
    const params = [Math.abs(a), Math.abs(b), Math.abs(c)].sort((x, y) => x - y);
    const pa = params[0], pb = params[1], pc = params[2];

    const n  = pa * pa * pc - pb * pc * pc;
    const d1 = pa * pa - pa * pb + pb * pb + pa * pc - 2 * pb * pc;
    const d2 = pa * pa + pa * pb + pb * pb - pa * pc - 2 * pb * pc;

    // Degenerate check — fall back to regular dodecahedron
    if (Math.abs(n * d1 * d2) < 1e-10) {
        return new THREE.DodecahedronGeometry(size, 0);
    }

    const r2 = n / d1;
    const r3 = n / d2;

    // Seed pentagon vertices
    const seed = [
        [pa, pb, pc],
        [-pa, -pb, pc],
        [-r2, -r2, r2],
        [-pc, -pa, pb],
        [-r3, r3, r3],
    ];

    // 12 chiral tetrahedral symmetry rotations as coordinate transforms
    const rotations = [
        ([x, y, z]) => [ x,  y,  z],
        ([x, y, z]) => [-x, -y,  z],
        ([x, y, z]) => [-x,  y, -z],
        ([x, y, z]) => [ x, -y, -z],
        ([x, y, z]) => [ z,  x,  y],
        ([x, y, z]) => [-z, -x,  y],
        ([x, y, z]) => [-z,  x, -y],
        ([x, y, z]) => [ z, -x, -y],
        ([x, y, z]) => [ y,  z,  x],
        ([x, y, z]) => [-y,  z, -x],
        ([x, y, z]) => [ y, -z, -x],
        ([x, y, z]) => [-y, -z,  x],
    ];

    // Generate all 12 pentagons (60 vertices before dedup)
    const faces = [];
    for (const rot of rotations) {
        faces.push(seed.map(v => rot(v)));
    }

    // Deduplicate vertices (20 unique from 60)
    const EPS = 1e-8;
    const uniqueVerts = [];
    const vertIndex = new Map();

    function getVertIndex(v) {
        // Round for hashing
        const key = v.map(c => Math.round(c / EPS) * EPS).join(',');
        if (vertIndex.has(key)) return vertIndex.get(key);
        const idx = uniqueVerts.length;
        uniqueVerts.push(v);
        vertIndex.set(key, idx);
        return idx;
    }

    const faceIndices = [];
    for (const face of faces) {
        faceIndices.push(face.map(v => getVertIndex(v)));
    }

    // Triangulate each pentagon (fan from vertex 0): 5-gon → 3 triangles
    const positions = [];
    for (const fi of faceIndices) {
        for (let t = 1; t < 4; t++) {
            const v0 = uniqueVerts[fi[0]];
            const v1 = uniqueVerts[fi[t]];
            const v2 = uniqueVerts[fi[t + 1]];
            positions.push(v0[0], v0[1], v0[2]);
            positions.push(v1[0], v1[1], v1[2]);
            positions.push(v2[0], v2[1], v2[2]);
        }
    }

    // Scale to requested size (normalize to unit sphere first)
    let maxR = 0;
    for (const v of uniqueVerts) {
        const r = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (r > maxR) maxR = r;
    }
    const scale = maxR > 0 ? size / maxR : size;
    for (let i = 0; i < positions.length; i++) {
        positions[i] *= scale;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
}

export function createTesseractGeometry(size) {
    const s = size;
    const si = size * 0.5;
    const vertices = [
        new THREE.Vector3(-s, -s, -s), new THREE.Vector3(s, -s, -s),
        new THREE.Vector3(s, s, -s), new THREE.Vector3(-s, s, -s),
        new THREE.Vector3(-s, -s, s), new THREE.Vector3(s, -s, s),
        new THREE.Vector3(s, s, s), new THREE.Vector3(-s, s, s),
        new THREE.Vector3(-si, -si, -si), new THREE.Vector3(si, -si, -si),
        new THREE.Vector3(si, si, -si), new THREE.Vector3(-si, si, -si),
        new THREE.Vector3(-si, -si, si), new THREE.Vector3(si, -si, si),
        new THREE.Vector3(si, si, si), new THREE.Vector3(-si, si, si)
    ];
    const positions = [];
    const indices = [];
    const cubeFaces = [
        [0, 3, 2, 1], [4, 5, 6, 7],
        [0, 4, 7, 3], [1, 2, 6, 5],
        [0, 1, 5, 4], [3, 7, 6, 2]
    ];
    const edgePairs = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const centroid = new THREE.Vector3();

    function pushQuad(a, b, c, d, desiredSign = 1) {
        const vA = vertices[a];
        const vB = vertices[b];
        const vC = vertices[c];
        const vD = vertices[d];

        ab.subVectors(vB, vA);
        ac.subVectors(vC, vA);
        normal.crossVectors(ab, ac);
        centroid.copy(vA).add(vB).add(vC).add(vD).multiplyScalar(0.25);

        if ((normal.dot(centroid) * desiredSign) < 0) {
            indices.push(a, d, c, a, c, b);
            return;
        }
        indices.push(a, b, c, a, c, d);
    }

    for (const vertex of vertices) {
        positions.push(vertex.x, vertex.y, vertex.z);
    }

    for (const face of cubeFaces) {
        pushQuad(face[0], face[1], face[2], face[3], 1);
    }

    for (const face of cubeFaces) {
        pushQuad(face[0] + 8, face[1] + 8, face[2] + 8, face[3] + 8, -1);
    }

    for (const [a, b] of edgePairs) {
        pushQuad(a, b, b + 8, a + 8, 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

function createTesseractInnerEdgeGeometry(size) {
    const si = size * 0.5;
    const vertices = [
        new THREE.Vector3(-si, -si, -si), new THREE.Vector3(si, -si, -si),
        new THREE.Vector3(si, si, -si), new THREE.Vector3(-si, si, -si),
        new THREE.Vector3(-si, -si, si), new THREE.Vector3(si, -si, si),
        new THREE.Vector3(si, si, si), new THREE.Vector3(-si, si, si),
    ];
    const edgePairs = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const positions = [];
    for (const [a, b] of edgePairs) {
        const vA = vertices[a];
        const vB = vertices[b];
        positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
}

/**
 * DRY: Shared builder for poly geometries (depth + core + wireframe).
 * Config: { group, depthKey, coreKey, wireKey, innerWireKey, innerHighlightWireKey, opacity, edgeOpacity,
 *           stellation, isInterior, isSpecular, isMask, colors, skin, isOmega }
 */
function buildShapeHierarchy(type, config) {
    const { group, depthKey, coreKey, wireKey, innerWireKey, innerHighlightWireKey, isOmega } = config;

    // Dispose old
    if (state[coreKey]) {
        group.remove(state[coreKey]);
        state[coreKey].geometry.dispose();
        state[coreKey].material.dispose();
    }
    if (state[wireKey]) {
        group.remove(state[wireKey]);
        state[wireKey].geometry.dispose();
        state[wireKey].material.dispose();
    }
    if (state[innerWireKey]) {
        group.remove(state[innerWireKey]);
        state[innerWireKey].geometry.dispose();
        state[innerWireKey].material.dispose();
    }
    if (state[innerHighlightWireKey]) {
        group.remove(state[innerHighlightWireKey]);
        state[innerHighlightWireKey].geometry.dispose();
        state[innerHighlightWireKey].material.dispose();
    }
    if (state[depthKey]) {
        group.remove(state[depthKey]);
        state[depthKey].geometry.dispose();
        state[depthKey].material.dispose();
    }

    let baseGeometry;
    const size = 1.0;
    switch (type) {
        case 4: baseGeometry = new THREE.TetrahedronGeometry(size); break;
        case 8: baseGeometry = new THREE.OctahedronGeometry(size); break;
        case 12: baseGeometry = new THREE.DodecahedronGeometry(size); break;
        case 20: baseGeometry = new THREE.IcosahedronGeometry(size); break;
        case 90: baseGeometry = createTetartoid(size, state.tetartoidA, state.tetartoidB, state.tetartoidC); break;
        case 91: baseGeometry = new THREE.TorusKnotGeometry(size * 0.6, size * 0.25, 64, 8); break;
        case 92: baseGeometry = new THREE.TorusGeometry(size * state.torusRadius, size * state.torusTube, 32, 48, state.torusArc * Math.PI * 2); break;
        case 93: baseGeometry = new THREE.CylinderGeometry(size * state.cylinderTopRadius, size * state.cylinderBottomRadius, size * state.cylinderHeight, state.cylinderSides); break;
        case 94: baseGeometry = createTesseractGeometry(size); break;
        case 100: baseGeometry = new THREE.SphereGeometry(size, 32, 32); break;
        default: baseGeometry = new THREE.BoxGeometry(size * state.boxWidth, size * state.boxHeight, size * state.boxDepth); break;
    }

    const finalGeometry = createStellatedGeometry(baseGeometry, config.stellation);

    // 1. Depth pre-pass
    const depthMat = new THREE.MeshBasicMaterial({
        colorWrite: false, side: THREE.FrontSide, depthWrite: true,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    state[depthKey] = new THREE.Mesh(finalGeometry, depthMat);
    state[depthKey].renderOrder = 2;
    state[depthKey].visible = !config.isInterior;
    group.add(state[depthKey]);

    // 2. Core face mesh
    const isSolid = config.opacity >= 0.99;
    const coreMat = new THREE.MeshPhongMaterial({
        transparent: !isSolid, opacity: config.opacity,
        shininess: config.isSpecular ? 80 : 0,
        specular: config.isSpecular ? new THREE.Color(0x333333) : new THREE.Color(0x000000),
        side: isSolid ? THREE.FrontSide : THREE.DoubleSide,
        depthWrite: isSolid,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    state[coreKey] = new THREE.Mesh(finalGeometry, coreMat);
    state[coreKey].renderOrder = 3;
    state[coreKey].visible = !config.isMask;
    group.add(state[coreKey]);

    // 3. Wireframe edge mesh
    const edgeGeo = new THREE.EdgesGeometry(finalGeometry);
    const edgeMat = new THREE.LineBasicMaterial({
        linewidth: 2, depthTest: true, transparent: true, opacity: config.edgeOpacity
    });
    state[wireKey] = new THREE.LineSegments(edgeGeo, edgeMat);
    state[wireKey].renderOrder = 4;
    group.add(state[wireKey]);

    if (type === 94) {
        const innerEdgeMat = new THREE.LineBasicMaterial({
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: Math.min(1, config.edgeOpacity * 0.35),
            color: new THREE.Color(config.edgeColors[0]).lerp(new THREE.Color(config.edgeColors[1]), 0.4)
        });
        state[innerWireKey] = new THREE.LineSegments(createTesseractInnerEdgeGeometry(size), innerEdgeMat);
        state[innerWireKey].renderOrder = 5;
        state[innerWireKey].scale.setScalar(state.innerEdgeInsetScale);
        state[innerWireKey].visible = config.isInterior && config.edgeOpacity > 0;
        group.add(state[innerWireKey]);

        const highlightMat = new THREE.LineBasicMaterial({
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            blending: THREE.AdditiveBlending,
            opacity: 0,
            color: 0xffffff
        });
        state[innerHighlightWireKey] = new THREE.LineSegments(createTesseractInnerEdgeGeometry(size), highlightMat);
        state[innerHighlightWireKey].renderOrder = 6;
        state[innerHighlightWireKey].scale.setScalar(state.innerEdgeHighlightInsetScale);
        state[innerHighlightWireKey].visible = false;
        group.add(state[innerHighlightWireKey]);
    } else {
        state[innerWireKey] = null;
        state[innerHighlightWireKey] = null;
    }

    // Apply vertex colors and skins
    applyGradientVertexColors(state[coreKey], config.faceColors);
    applyGradientVertexColors(state[wireKey], config.edgeColors);
    if (config.skin !== 'none') applySkin(config.skin, isOmega);
}

export function updateInnerEdgePulse(isOmega = false) {
    const wireKey = isOmega ? 'omegaInnerWireframeMesh' : 'innerWireframeMesh';
    const highlightKey = isOmega ? 'omegaInnerHighlightWireframeMesh' : 'innerHighlightWireframeMesh';
    const opacityKey = isOmega ? 'omegaEdgeOpacity' : 'currentEdgeOpacity';
    const enabledKey = isOmega ? 'omegaIsInteriorEdgesEnabled' : 'isInteriorEdgesEnabled';
    const colors = isOmega ? state.colors.omegaEdge : state.colors.edge;
    const mesh = state[wireKey];
    const highlightMesh = state[highlightKey];
    if (!mesh?.material) return;

    const gammaConfig = state.turbState?.g ?? { val: 0, spd: 1.0 };
    const gammaEnabled = !!(state.isGammaEnabled && state.gammaRayCount > 0);
    const gammaPulse = gammaEnabled
        ? Math.max(0, Math.sin(state.globalTime * Math.max(0.001, gammaConfig.spd * state.innerEdgePulseRate)))
        : 0;
    const gammaTurbulence = Math.max(0, gammaConfig.val ?? 0);
    const gammaSpeed = Math.max(0.001, gammaConfig.spd ?? 1.0);
    const peakPulse = gammaPulse > state.innerEdgePeakThreshold
        ? (gammaPulse - state.innerEdgePeakThreshold) / Math.max(0.001, 1 - state.innerEdgePeakThreshold)
        : 0;
    const activity = Math.min(1.6, 0.55 + (gammaTurbulence * 2.6));
    const flickerRate = state.innerEdgeFlickerRate * (0.8 + (gammaSpeed * 0.6));
    const flickerNoise = peakPulse > 0
        ? (0.5 + (0.5 * Math.sin((state.globalTime * flickerRate) + 1.7)))
            * (0.5 + (0.5 * Math.sin((state.globalTime * (flickerRate * 1.73)) + 0.31)))
        : 0;
    const flickerBoost = peakPulse > 0
        ? ((1 - state.innerEdgeFlickerAmount) + (flickerNoise * state.innerEdgeFlickerAmount))
        : 0;
    const geometryActive = isOmega ? state.omegaGeometryType === 94 : state.currentGeometryType === 94;
    const visible = state[enabledKey] && state[opacityKey] > 0.001 && geometryActive;
    const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), 0.35);
    mesh.material.color.copy(baseColor);
    mesh.material.opacity = visible
        ? Math.min(1, state[opacityKey] * (0.26 + (gammaPulse * 0.1) + (gammaTurbulence * 0.08)))
        : 0;
    mesh.visible = visible;
    mesh.scale.setScalar(state.innerEdgeInsetScale);

    if (!highlightMesh?.material) return;
    const highlightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5);
    highlightMesh.material.color.copy(highlightColor);
    highlightMesh.material.opacity = visible
        ? Math.min(1, state[opacityKey] * peakPulse * activity * flickerBoost * (state.innerEdgePulseAmount * 0.65))
        : 0;
    highlightMesh.visible = visible && peakPulse > 0.001;
    highlightMesh.scale.setScalar(state.innerEdgeHighlightInsetScale);
}

export function updateGeometry(type) {
    buildShapeHierarchy(type, {
        group: state.polyGroup,
        depthKey: 'depthMesh',
        coreKey: 'coreMesh',
        wireKey: 'wireframeMesh',
        innerWireKey: 'innerWireframeMesh',
        innerHighlightWireKey: 'innerHighlightWireframeMesh',
        opacity: state.currentOpacity,
        edgeOpacity: state.currentEdgeOpacity,
        stellation: state.stellationFactor,
        isInterior: state.isInteriorEdgesEnabled,
        isSpecular: state.isSpecularEnabled,
        isMask: state.isMaskEnabled,
        faceColors: state.colors.face,
        edgeColors: state.colors.edge,
        skin: state.currentSkin,
        isOmega: false
    });
}

export function updateOmegaGeometry(type) {
    buildShapeHierarchy(type, {
        group: state.omegaGroup,
        depthKey: 'omegaDepthMesh',
        coreKey: 'omegaCoreMesh',
        wireKey: 'omegaWireframeMesh',
        innerWireKey: 'omegaInnerWireframeMesh',
        innerHighlightWireKey: 'omegaInnerHighlightWireframeMesh',
        opacity: state.omegaOpacity,
        edgeOpacity: state.omegaEdgeOpacity,
        stellation: state.omegaStellationFactor,
        isInterior: state.omegaIsInteriorEdgesEnabled,
        isSpecular: state.omegaIsSpecularEnabled,
        isMask: state.omegaIsMaskEnabled,
        faceColors: state.colors.omegaFace,
        edgeColors: state.colors.omegaEdge,
        skin: state.omegaSkin,
        isOmega: true
    });
}
