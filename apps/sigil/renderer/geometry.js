import state from './state.js';
import { applyGradientVertexColors } from './colors.js';
import { applySkin, updateSkinColorRamp } from './skins.js';
import {
    createTesseronDepthGeometry,
    createTesseronLinkGeometry,
    isTesseronSupportedShape,
    normalizePolyhedronType,
    normalizeTesseronConfig,
    scaleGeometryPositions,
} from './tesseron.js';

export function createStellatedGeometry(baseGeometry, factor) {
    const nonIndexed = baseGeometry.index ? baseGeometry.toNonIndexed() : baseGeometry.clone();
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

function createBaseGeometry(type, size) {
    switch (normalizePolyhedronType(type)) {
        case 4: return new THREE.TetrahedronGeometry(size);
        case 8: return new THREE.OctahedronGeometry(size);
        case 12: return new THREE.DodecahedronGeometry(size);
        case 20: return new THREE.IcosahedronGeometry(size);
        case 90: return createTetartoid(size, state.tetartoidA, state.tetartoidB, state.tetartoidC);
        case 91: return new THREE.TorusKnotGeometry(size * 0.6, size * 0.25, 64, 8);
        case 92: return new THREE.TorusGeometry(size * state.torusRadius, size * state.torusTube, 32, 48, state.torusArc * Math.PI * 2);
        case 93: return new THREE.CylinderGeometry(size * state.cylinderTopRadius, size * state.cylinderBottomRadius, size * state.cylinderHeight, state.cylinderSides);
        case 100: return new THREE.SphereGeometry(size, 32, 32);
        default: return new THREE.BoxGeometry(size * state.boxWidth, size * state.boxHeight, size * state.boxDepth);
    }
}

/**
 * DRY: Shared builder for poly geometries (depth + core + wireframe).
 * Config: { group, depthKey, coreKey, wireKey, innerWireKey, innerHighlightWireKey, childDepthKey, childCoreKey,
 *           childWireKey, opacity, edgeOpacity, stellation, isInterior, isSpecular, isMask, colors, skin,
 *           tesseron, isOmega }
 */
function buildShapeHierarchy(type, config) {
    const {
        group,
        depthKey,
        coreKey,
        wireKey,
        innerWireKey,
        innerHighlightWireKey,
        childDepthKey,
        childCoreKey,
        childWireKey,
        isOmega,
    } = config;

    function disposeStateMesh(key) {
        if (!key || !state[key]) return;
        group.remove(state[key]);
        state[key].geometry?.dispose?.();
        const material = state[key].material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.());
        else material?.dispose?.();
        state[key] = null;
    }

    [
        coreKey,
        wireKey,
        innerWireKey,
        innerHighlightWireKey,
        depthKey,
        childDepthKey,
        childCoreKey,
        childWireKey,
    ].forEach(disposeStateMesh);

    const size = 1.0;
    const shapeType = normalizePolyhedronType(type);
    const baseGeometry = createBaseGeometry(shapeType, size);
    const tesseron = normalizeTesseronConfig(config.tesseron);
    const tesseronActive = tesseron.enabled && isTesseronSupportedShape(shapeType);
    const finalGeometry = createStellatedGeometry(baseGeometry, tesseronActive ? 0 : config.stellation);
    const childConfig = tesseron.matchMother ? config : {
        ...config,
        opacity: tesseron.child.opacity ?? config.opacity,
        edgeOpacity: tesseron.child.edgeOpacity ?? config.edgeOpacity,
        isMask: tesseron.child.maskEnabled ?? config.isMask,
        isInterior: tesseron.child.interiorEdges ?? config.isInterior,
        isSpecular: tesseron.child.specular ?? config.isSpecular,
    };

    function createDepthMesh(geometry) {
        return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            colorWrite: false,
            side: THREE.FrontSide,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        }));
    }

    function createCoreMesh(geometry, sourceConfig) {
        const isSolid = sourceConfig.opacity >= 0.99;
        return new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
            transparent: !isSolid,
            opacity: sourceConfig.opacity,
            shininess: sourceConfig.isSpecular ? 80 : 0,
            specular: sourceConfig.isSpecular ? new THREE.Color(0x333333) : new THREE.Color(0x000000),
            side: isSolid ? THREE.FrontSide : THREE.DoubleSide,
            depthWrite: isSolid,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        }));
    }

    function createWireMesh(geometry, sourceConfig, { color, opacityScale = 1, renderOrder = 4 } = {}) {
        const materialOptions = {
            linewidth: 2,
            depthTest: true,
            transparent: true,
            opacity: Math.min(1, sourceConfig.edgeOpacity * opacityScale),
        };
        if (color) materialOptions.color = color;
        const mesh = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial(materialOptions));
        mesh.renderOrder = renderOrder;
        return mesh;
    }

    function addDepth(key, geometry, sourceConfig, order) {
        state[key] = createDepthMesh(geometry);
        state[key].renderOrder = order;
        state[key].visible = !sourceConfig.isInterior;
        group.add(state[key]);
    }

    function addCore(key, geometry, sourceConfig, order) {
        state[key] = createCoreMesh(geometry, sourceConfig);
        state[key].renderOrder = order;
        state[key].visible = !sourceConfig.isMask;
        group.add(state[key]);
    }

    function addWire(key, geometry, sourceConfig, order) {
        state[key] = createWireMesh(geometry, sourceConfig, { renderOrder: order });
        group.add(state[key]);
    }

    // 1. Depth pre-pass
    addDepth(depthKey, finalGeometry, config, 2);

    // 2. Core face mesh
    addCore(coreKey, finalGeometry, config, 3);

    // 3. Wireframe edge mesh
    addWire(wireKey, finalGeometry, config, 4);

    if (tesseronActive) {
        const childGeometry = scaleGeometryPositions(finalGeometry, tesseron.proportion);
        const childDepthGeometry = createTesseronDepthGeometry(finalGeometry, tesseron.proportion);
        addDepth(childDepthKey, childDepthGeometry, childConfig, 3);
        addCore(childCoreKey, childGeometry, childConfig, 4);
        addWire(childWireKey, childGeometry, childConfig, 5);

        const linkGeometry = createTesseronLinkGeometry(finalGeometry, tesseron.proportion);
        const innerEdgeMat = new THREE.LineBasicMaterial({
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: config.edgeOpacity,
            color: new THREE.Color(config.edgeColors[0]).lerp(new THREE.Color(config.edgeColors[1]), 0.4)
        });
        state[innerWireKey] = new THREE.LineSegments(linkGeometry, innerEdgeMat);
        state[innerWireKey].renderOrder = 5;
        state[innerWireKey].visible = config.edgeOpacity > 0;
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
        state[innerHighlightWireKey] = new THREE.LineSegments(createTesseronLinkGeometry(finalGeometry, tesseron.proportion), highlightMat);
        state[innerHighlightWireKey].renderOrder = 7;
        state[innerHighlightWireKey].visible = false;
        group.add(state[innerHighlightWireKey]);
    } else {
        state[innerWireKey] = null;
        state[innerHighlightWireKey] = null;
    }

    // Apply vertex colors and skins
    applyGradientVertexColors(state[coreKey], config.faceColors);
    applyGradientVertexColors(state[wireKey], config.edgeColors);
    applyGradientVertexColors(state[childCoreKey], config.faceColors);
    applyGradientVertexColors(state[childWireKey], config.edgeColors);
    applyGradientVertexColors(state[innerWireKey], config.edgeColors);
    applyGradientVertexColors(state[innerHighlightWireKey], config.edgeColors);
    if (config.skin !== 'none') applySkin(config.skin, isOmega);
    baseGeometry.dispose?.();
}

export function updateInnerEdgePulse(isOmega = false) {
    const wireKey = isOmega ? 'omegaInnerWireframeMesh' : 'innerWireframeMesh';
    const highlightKey = isOmega ? 'omegaInnerHighlightWireframeMesh' : 'innerHighlightWireframeMesh';
    const opacityKey = isOmega ? 'omegaEdgeOpacity' : 'currentEdgeOpacity';
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
    const tesseron = isOmega ? state.omegaTesseron : state.tesseron;
    const geometryType = isOmega ? state.omegaGeometryType : state.currentGeometryType;
    const geometryActive = !!tesseron?.enabled && isTesseronSupportedShape(geometryType);
    const visible = state[opacityKey] > 0.001 && geometryActive;
    const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), 0.35);
    mesh.material.color.setHex(0xffffff);
    mesh.material.opacity = visible ? Math.min(1, state[opacityKey]) : 0;
    mesh.visible = visible;
    mesh.scale.setScalar(1);

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
        childDepthKey: 'tesseronChildDepthMesh',
        childCoreKey: 'tesseronChildCoreMesh',
        childWireKey: 'tesseronChildWireframeMesh',
        opacity: state.currentOpacity,
        edgeOpacity: state.currentEdgeOpacity,
        stellation: state.stellationFactor,
        isInterior: state.isInteriorEdgesEnabled,
        isSpecular: state.isSpecularEnabled,
        isMask: state.isMaskEnabled,
        faceColors: state.colors.face,
        edgeColors: state.colors.edge,
        skin: state.currentSkin,
        tesseron: state.tesseron,
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
        childDepthKey: 'omegaTesseronChildDepthMesh',
        childCoreKey: 'omegaTesseronChildCoreMesh',
        childWireKey: 'omegaTesseronChildWireframeMesh',
        opacity: state.omegaOpacity,
        edgeOpacity: state.omegaEdgeOpacity,
        stellation: state.omegaStellationFactor,
        isInterior: state.omegaIsInteriorEdgesEnabled,
        isSpecular: state.omegaIsSpecularEnabled,
        isMask: state.omegaIsMaskEnabled,
        faceColors: state.colors.omegaFace,
        edgeColors: state.colors.omegaEdge,
        skin: state.omegaSkin,
        tesseron: state.omegaTesseron,
        isOmega: true
    });
}
