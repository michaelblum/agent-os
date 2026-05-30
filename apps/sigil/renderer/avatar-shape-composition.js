import {
    createTesseronDepthGeometry,
    createTesseronLinkGeometry,
    isTesseronSupportedShape,
    normalizePolyhedronType,
    normalizeTesseronConfig,
    scaleGeometryPositions,
} from './tesseron.js';

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function geometryAttribute(geometry, name) {
    return geometry?.getAttribute?.(name) || geometry?.attributes?.[name] || null;
}

function geometryPositionInfo(geometry) {
    const position = geometryAttribute(geometry, 'position');
    const array = position?.array || [];
    const itemSize = Number(position?.itemSize) || 3;
    const count = Number(position?.count) || Math.floor(array.length / itemSize);
    return { position, array, itemSize, count };
}

function setGeometryPositions(THREE, positions, userData = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.userData = { ...userData };
    geometry.computeVertexNormals?.();
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
    return geometry;
}

function geometryCenter(geometry = null) {
    const center = geometry?.userData?.volume_center_local || geometry?.userData?.center_local;
    if (center) {
        return {
            x: finite(center.x),
            y: finite(center.y),
            z: finite(center.z),
        };
    }
    return { x: 0, y: 0, z: 0 };
}

function cloneGeometryPositions(THREE, sourceGeometry, userData = {}) {
    const { array, itemSize, count } = geometryPositionInfo(sourceGeometry);
    const positions = [];
    for (let i = 0; i < count; i += 1) {
        const offset = i * itemSize;
        positions.push(
            finite(array[offset]),
            finite(array[offset + 1]),
            finite(array[offset + 2]),
        );
    }
    const geometry = setGeometryPositions(THREE, positions, {
        ...(sourceGeometry?.userData || {}),
        ...userData,
    });
    if (typeof geometry.setIndex === 'function' && sourceGeometry?.index) geometry.setIndex(sourceGeometry.index);
    return geometry;
}

function scaleGeometryPositionsAround(THREE, sourceGeometry, proportion, scaleOrigin = 'origin') {
    const { array, itemSize, count } = geometryPositionInfo(sourceGeometry);
    const center = scaleOrigin === 'origin' ? { x: 0, y: 0, z: 0 } : geometryCenter(sourceGeometry);
    const positions = [];
    for (let i = 0; i < count; i += 1) {
        const offset = i * itemSize;
        const x = finite(array[offset]);
        const y = finite(array[offset + 1]);
        const z = finite(array[offset + 2]);
        positions.push(
            center.x + ((x - center.x) * proportion),
            center.y + ((y - center.y) * proportion),
            center.z + ((z - center.z) * proportion),
        );
    }
    const geometry = setGeometryPositions(THREE, positions, {
        ...(sourceGeometry?.userData || {}),
        tesseron_child: true,
        tesseron_proportion: proportion,
        tesseron_scale_origin: scaleOrigin,
        center_local: center,
        volume_center_local: center,
    });
    if (typeof geometry.setIndex === 'function' && sourceGeometry?.index) geometry.setIndex(sourceGeometry.index);
    return geometry;
}

function geometryVertex(geometry, index) {
    const { array, itemSize } = geometryPositionInfo(geometry);
    const offset = index * itemSize;
    return {
        x: finite(array[offset]),
        y: finite(array[offset + 1]),
        z: finite(array[offset + 2]),
    };
}

function uniqueVertexIndices(geometry) {
    const explicit = [
        ...(geometry?.userData?.top_ring_indices || []),
        ...(geometry?.userData?.base_ring_indices || []),
    ];
    if (explicit.length) return explicit;
    const { array, itemSize, count } = geometryPositionInfo(geometry);
    const seen = new Map();
    const indices = [];
    for (let i = 0; i < count; i += 1) {
        const offset = i * itemSize;
        const key = [
            Math.round(finite(array[offset]) * 100000),
            Math.round(finite(array[offset + 1]) * 100000),
            Math.round(finite(array[offset + 2]) * 100000),
        ].join(',');
        if (seen.has(key)) continue;
        seen.set(key, i);
        indices.push(i);
    }
    return indices;
}

function createTesseronLinkGeometryAround(THREE, sourceGeometry, proportion, scaleOrigin = 'origin') {
    const center = scaleOrigin === 'origin' ? { x: 0, y: 0, z: 0 } : geometryCenter(sourceGeometry);
    const positions = [];
    for (const index of uniqueVertexIndices(sourceGeometry)) {
        const vertex = geometryVertex(sourceGeometry, index);
        positions.push(
            vertex.x,
            vertex.y,
            vertex.z,
            center.x + ((vertex.x - center.x) * proportion),
            center.y + ((vertex.y - center.y) * proportion),
            center.z + ((vertex.z - center.z) * proportion),
        );
    }
    return setGeometryPositions(THREE, positions, {
        primitive: 'tesseron_links',
        tesseron_proportion: proportion,
        tesseron_scale_origin: scaleOrigin,
        center_local: center,
        volume_center_local: center,
        link_count: positions.length / 6,
    });
}

function createTesseronDepthGeometryAround(THREE, sourceGeometry, proportion, scaleOrigin = 'origin') {
    if (scaleOrigin === 'origin' && typeof sourceGeometry?.getAttribute === 'function') {
        return createTesseronDepthGeometry(sourceGeometry, proportion);
    }
    const geometry = scaleGeometryPositionsAround(THREE, sourceGeometry, proportion, scaleOrigin);
    geometry.userData = {
        ...(geometry.userData || {}),
        primitive: 'tesseron_depth',
        tesseron_proportion: proportion,
        tesseron_scale_origin: scaleOrigin,
    };
    return geometry;
}

function disposeMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach((entry) => disposeMaterial(entry));
        return;
    }
    material?.map?.dispose?.();
    material?.dispose?.();
}

function disposeMesh(mesh, group = null) {
    if (!mesh) return;
    if (typeof group?.remove === 'function') {
        group.remove(mesh);
    } else if (Array.isArray(group?.children)) {
        const index = group.children.indexOf(mesh);
        if (index >= 0) group.children.splice(index, 1);
    }
    mesh.geometry?.dispose?.();
    disposeMaterial(mesh.material);
}

function defaultMaterial(THREE, kind, options = {}) {
    const Material = kind === 'line'
        ? THREE.LineBasicMaterial
        : (kind === 'depth' ? THREE.MeshBasicMaterial || THREE.MeshPhongMaterial : THREE.MeshPhongMaterial || THREE.MeshBasicMaterial);
    return new Material(options);
}

export function createStellatedGeometry(THREE, baseGeometry, factor) {
    const nonIndexed = baseGeometry.index && typeof baseGeometry.toNonIndexed === 'function'
        ? baseGeometry.toNonIndexed()
        : (typeof baseGeometry.clone === 'function' ? baseGeometry.clone() : cloneGeometryPositions(THREE, baseGeometry));
    if (Math.abs(factor) < 0.01) {
        nonIndexed.computeVertexNormals?.();
        return nonIndexed;
    }
    const positionAttribute = geometryAttribute(nonIndexed, 'position');
    const count = Number(positionAttribute?.count) || 0;
    const newVertices = [];
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();

    for (let i = 0; i < count; i += 3) {
        vA.fromBufferAttribute(positionAttribute, i);
        vB.fromBufferAttribute(positionAttribute, i + 1);
        vC.fromBufferAttribute(positionAttribute, i + 2);
        centroid.copy(vA).add(vB).add(vC).divideScalar(3);
        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        normal.crossVectors(cb, ab).normalize();
        const peak = new THREE.Vector3().copy(centroid).add(normal.multiplyScalar(factor));

        newVertices.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, peak.x, peak.y, peak.z);
        newVertices.push(vB.x, vB.y, vB.z, vC.x, vC.y, vC.z, peak.x, peak.y, peak.z);
        newVertices.push(vC.x, vC.y, vC.z, vA.x, vA.y, vA.z, peak.x, peak.y, peak.z);
    }
    return setGeometryPositions(THREE, newVertices, { ...(baseGeometry?.userData || {}) });
}

export function createTetartoid(THREE, size, a, b, c) {
    const params = [Math.abs(a), Math.abs(b), Math.abs(c)].sort((x, y) => x - y);
    const pa = params[0], pb = params[1], pc = params[2];
    const n = pa * pa * pc - pb * pc * pc;
    const d1 = pa * pa - pa * pb + pb * pb + pa * pc - 2 * pb * pc;
    const d2 = pa * pa + pa * pb + pb * pb - pa * pc - 2 * pb * pc;
    if (Math.abs(n * d1 * d2) < 1e-10) return new THREE.DodecahedronGeometry(size, 0);
    const r2 = n / d1;
    const r3 = n / d2;
    const seed = [
        [pa, pb, pc],
        [-pa, -pb, pc],
        [-r2, -r2, r2],
        [-pc, -pa, pb],
        [-r3, r3, r3],
    ];
    const rotations = [
        ([x, y, z]) => [x, y, z],
        ([x, y, z]) => [-x, -y, z],
        ([x, y, z]) => [-x, y, -z],
        ([x, y, z]) => [x, -y, -z],
        ([x, y, z]) => [z, x, y],
        ([x, y, z]) => [-z, -x, y],
        ([x, y, z]) => [-z, x, -y],
        ([x, y, z]) => [z, -x, -y],
        ([x, y, z]) => [y, z, x],
        ([x, y, z]) => [-y, z, -x],
        ([x, y, z]) => [y, -z, -x],
        ([x, y, z]) => [-y, -z, x],
    ];
    const uniqueVerts = [];
    const vertIndex = new Map();
    const faceIndices = [];
    const EPS = 1e-8;
    function getVertIndex(v) {
        const key = v.map((entry) => Math.round(entry / EPS) * EPS).join(',');
        if (vertIndex.has(key)) return vertIndex.get(key);
        const idx = uniqueVerts.length;
        uniqueVerts.push(v);
        vertIndex.set(key, idx);
        return idx;
    }
    for (const rot of rotations) {
        faceIndices.push(seed.map((v) => getVertIndex(rot(v))));
    }
    const positions = [];
    for (const face of faceIndices) {
        for (let t = 1; t < 4; t += 1) {
            const v0 = uniqueVerts[face[0]];
            const v1 = uniqueVerts[face[t]];
            const v2 = uniqueVerts[face[t + 1]];
            positions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        }
    }
    let maxR = 0;
    for (const v of uniqueVerts) maxR = Math.max(maxR, Math.hypot(v[0], v[1], v[2]));
    const scale = maxR > 0 ? size / maxR : size;
    for (let i = 0; i < positions.length; i += 1) positions[i] *= scale;
    return setGeometryPositions(THREE, positions);
}

export function createAvatarBaseGeometry(THREE, type, size, source = {}) {
    switch (normalizePolyhedronType(type)) {
        case 4: return new THREE.TetrahedronGeometry(size);
        case 8: return new THREE.OctahedronGeometry(size);
        case 12: return new THREE.DodecahedronGeometry(size);
        case 20: return new THREE.IcosahedronGeometry(size);
        case 90: return createTetartoid(THREE, size, source.tetartoidA, source.tetartoidB, source.tetartoidC);
        case 91: return new THREE.TorusKnotGeometry(size * 0.6, size * 0.25, 64, 8);
        case 92: return new THREE.TorusGeometry(size * source.torusRadius, size * source.torusTube, 32, 48, source.torusArc * Math.PI * 2);
        case 93: return new THREE.CylinderGeometry(size * source.cylinderTopRadius, size * source.cylinderBottomRadius, size * source.cylinderHeight, source.cylinderSides);
        case 100: return new THREE.SphereGeometry(size, 32, 32);
        default: return new THREE.BoxGeometry(size * source.boxWidth, size * source.boxHeight, size * source.boxDepth);
    }
}

export function disposeAvatarShapeComposition(record, group = null) {
    if (!record) return;
    [
        'coreMesh',
        'wireframeMesh',
        'innerWireframeMesh',
        'innerHighlightWireframeMesh',
        'depthMesh',
        'tesseronChildDepthMesh',
        'tesseronChildCoreMesh',
        'tesseronChildWireframeMesh',
    ].forEach((key) => disposeMesh(record[key], group));
    record.baseGeometry?.dispose?.();
}

export function createAvatarShapeComposition(THREE, type, config = {}) {
    const group = config.group;
    const stateTarget = config.stateTarget || null;
    const keys = config.keys || {};
    const size = finite(config.size, 1);
    const shapeType = normalizePolyhedronType(type);
    const tesseron = normalizeTesseronConfig(config.tesseron);
    const tesseronActive = tesseron.enabled && isTesseronSupportedShape(shapeType);
    const scaleOrigin = config.tesseronScaleOrigin || 'origin';

    const existingKeys = [
        keys.coreKey,
        keys.wireKey,
        keys.innerWireKey,
        keys.innerHighlightWireKey,
        keys.depthKey,
        keys.childDepthKey,
        keys.childCoreKey,
        keys.childWireKey,
    ];
    if (stateTarget) {
        for (const key of existingKeys) {
            if (!key || !stateTarget[key]) continue;
            disposeMesh(stateTarget[key], group);
            stateTarget[key] = null;
        }
    }

    const baseGeometry = config.baseGeometryFactory
        ? config.baseGeometryFactory(shapeType, size)
        : createAvatarBaseGeometry(THREE, shapeType, size, config.stateSource || {});
    const finalGeometry = createStellatedGeometry(THREE, baseGeometry, tesseronActive ? 0 : finite(config.stellation, 0));
    finalGeometry.userData = {
        ...(baseGeometry?.userData || {}),
        ...(finalGeometry.userData || {}),
    };
    const childConfig = tesseron.matchMother ? config : {
        ...config,
        opacity: tesseron.child.opacity ?? config.opacity,
        edgeOpacity: tesseron.child.edgeOpacity ?? config.edgeOpacity,
        isMask: tesseron.child.maskEnabled ?? config.isMask,
        isInterior: tesseron.child.interiorEdges ?? config.isInterior,
        isSpecular: tesseron.child.specular ?? config.isSpecular,
    };
    const isSolid = finite(config.opacity, 1) >= 0.99;
    const createDepthMesh = (geometry, sourceConfig = config) => new THREE.Mesh(geometry, defaultMaterial(THREE, 'depth', {
        colorWrite: false,
        side: THREE.FrontSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    }));
    const createCoreMesh = (geometry, sourceConfig = config) => new THREE.Mesh(geometry, defaultMaterial(THREE, 'core', {
        transparent: finite(sourceConfig.opacity, 1) < 0.99,
        opacity: finite(sourceConfig.opacity, 1),
        shininess: sourceConfig.isSpecular ? 80 : 0,
        specular: sourceConfig.isSpecular && THREE.Color ? new THREE.Color(0x333333) : 0x000000,
        side: finite(sourceConfig.opacity, 1) >= 0.99 ? THREE.FrontSide : THREE.DoubleSide,
        depthWrite: finite(sourceConfig.opacity, 1) >= 0.99,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    }));
    const createWireMesh = (geometry, sourceConfig = config, { color, opacityScale = 1, renderOrder = 4 } = {}) => {
        const materialOptions = {
            linewidth: 2,
            depthTest: true,
            transparent: true,
            opacity: Math.min(1, finite(sourceConfig.edgeOpacity, 1) * opacityScale),
        };
        if (color) materialOptions.color = color;
        const edgeGeometry = typeof THREE.EdgesGeometry === 'function' ? new THREE.EdgesGeometry(geometry) : geometry;
        const mesh = new THREE.LineSegments(edgeGeometry, defaultMaterial(THREE, 'line', materialOptions));
        mesh.renderOrder = renderOrder;
        return mesh;
    };
    const record = {
        baseGeometry,
        finalGeometry,
        depthMesh: null,
        coreMesh: null,
        wireframeMesh: null,
        innerWireframeMesh: null,
        innerHighlightWireframeMesh: null,
        tesseronChildDepthMesh: null,
        tesseronChildCoreMesh: null,
        tesseronChildWireframeMesh: null,
        tesseronChildGeometry: null,
        tesseronLinkGeometry: null,
    };
    function assign(key, mesh) {
        if (stateTarget && key) stateTarget[key] = mesh;
        return mesh;
    }
    function add(mesh, renderOrder, visible = true) {
        if (!mesh) return mesh;
        mesh.renderOrder = renderOrder;
        mesh.visible = visible;
        group?.add?.(mesh);
        return mesh;
    }

    record.depthMesh = add(assign(keys.depthKey, createDepthMesh(finalGeometry, config)), 2, !config.isInterior);
    record.coreMesh = add(assign(keys.coreKey, createCoreMesh(finalGeometry, config)), 3, !config.isMask);
    record.wireframeMesh = add(assign(keys.wireKey, createWireMesh(finalGeometry, config, { renderOrder: 4 })), 4, true);

    if (tesseronActive) {
        const useNativeTesseron = scaleOrigin === 'origin' && typeof finalGeometry.getAttribute === 'function';
        record.tesseronChildGeometry = useNativeTesseron
            ? scaleGeometryPositions(finalGeometry, tesseron.proportion)
            : scaleGeometryPositionsAround(THREE, finalGeometry, tesseron.proportion, scaleOrigin);
        const childDepthGeometry = useNativeTesseron
            ? createTesseronDepthGeometry(finalGeometry, tesseron.proportion)
            : createTesseronDepthGeometryAround(THREE, finalGeometry, tesseron.proportion, scaleOrigin);
        record.tesseronLinkGeometry = useNativeTesseron
            ? createTesseronLinkGeometry(finalGeometry, tesseron.proportion)
            : createTesseronLinkGeometryAround(THREE, finalGeometry, tesseron.proportion, scaleOrigin);
        record.tesseronChildDepthMesh = add(assign(keys.childDepthKey, createDepthMesh(childDepthGeometry, childConfig)), 3, !childConfig.isInterior);
        record.tesseronChildCoreMesh = add(assign(keys.childCoreKey, createCoreMesh(record.tesseronChildGeometry, childConfig)), 4, !childConfig.isMask);
        record.tesseronChildWireframeMesh = add(assign(keys.childWireKey, createWireMesh(record.tesseronChildGeometry, childConfig, { renderOrder: 5 })), 5, true);
        const innerEdgeMat = defaultMaterial(THREE, 'line', {
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: finite(config.edgeOpacity, 1),
            color: THREE.Color ? new THREE.Color(config.edgeColors?.[0] || 0xffffff) : config.edgeColors?.[0],
        });
        record.innerWireframeMesh = new THREE.LineSegments(record.tesseronLinkGeometry, innerEdgeMat);
        add(assign(keys.innerWireKey, record.innerWireframeMesh), 5, finite(config.edgeOpacity, 1) > 0);
        const highlightMat = defaultMaterial(THREE, 'line', {
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            blending: THREE.AdditiveBlending,
            opacity: 0,
            color: 0xffffff,
        });
        record.innerHighlightWireframeMesh = new THREE.LineSegments(
            createTesseronLinkGeometryAround(THREE, finalGeometry, tesseron.proportion, scaleOrigin),
            highlightMat,
        );
        add(assign(keys.innerHighlightWireKey, record.innerHighlightWireframeMesh), 7, false);
    } else if (stateTarget) {
        if (keys.innerWireKey) stateTarget[keys.innerWireKey] = null;
        if (keys.innerHighlightWireKey) stateTarget[keys.innerHighlightWireKey] = null;
    }

    config.applyGradientVertexColors?.(record.coreMesh, config.faceColors);
    config.applyGradientVertexColors?.(record.wireframeMesh, config.edgeColors);
    config.applyGradientVertexColors?.(record.tesseronChildCoreMesh, config.faceColors);
    config.applyGradientVertexColors?.(record.tesseronChildWireframeMesh, config.edgeColors);
    config.applyGradientVertexColors?.(record.innerWireframeMesh, config.edgeColors);
    config.applyGradientVertexColors?.(record.innerHighlightWireframeMesh, config.edgeColors);
    if (config.skin && config.skin !== 'none') config.applySkin?.(config.skin, config.isOmega);
    if (!config.retainBaseGeometry) baseGeometry.dispose?.();
    record.faceSolid = isSolid;
    return record;
}
