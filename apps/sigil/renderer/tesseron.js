export const TESSERON_MIN_PROPORTION = 0.12;
export const TESSERON_MAX_PROPORTION = 0.9;
export const TESSERON_DEFAULT_PROPORTION = 0.5;

const SUPPORTED_SHAPES = new Set([4, 6, 8, 12, 20, 90, 93]);

export function normalizePolyhedronType(type) {
    const n = Number(type);
    return n === 94 ? 6 : n;
}

export function isTesseronSupportedShape(type) {
    return SUPPORTED_SHAPES.has(normalizePolyhedronType(type));
}

export function clampTesseronProportion(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return TESSERON_DEFAULT_PROPORTION;
    return Math.min(TESSERON_MAX_PROPORTION, Math.max(TESSERON_MIN_PROPORTION, n));
}

export function normalizeTesseronConfig(input = {}, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const childSource = source.child && typeof source.child === 'object'
        ? source.child
        : (base.child && typeof base.child === 'object' ? base.child : {});

    return {
        enabled: source.enabled ?? base.enabled ?? false,
        proportion: clampTesseronProportion(source.proportion ?? base.proportion ?? TESSERON_DEFAULT_PROPORTION),
        matchMother: source.matchMother ?? base.matchMother ?? true,
        editTarget: source.editTarget === 'child' ? 'child' : 'mother',
        child: {
            opacity: childSource.opacity,
            edgeOpacity: childSource.edgeOpacity,
            maskEnabled: childSource.maskEnabled,
            interiorEdges: childSource.interiorEdges,
            specular: childSource.specular,
        },
    };
}

export function scaleGeometryPositions(geometry, scalar) {
    const scaled = geometry.clone();
    const position = scaled.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
        position.setXYZ(
            i,
            position.getX(i) * scalar,
            position.getY(i) * scalar,
            position.getZ(i) * scalar
        );
    }
    position.needsUpdate = true;
    scaled.computeVertexNormals?.();
    scaled.computeBoundingBox?.();
    scaled.computeBoundingSphere?.();
    return scaled;
}

export function uniqueGeometryVertices(geometry) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute('position');
    const vertices = [];
    const seen = new Map();
    const precision = 100000;

    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const key = [
            Math.round(x * precision),
            Math.round(y * precision),
            Math.round(z * precision),
        ].join(',');
        if (seen.has(key)) continue;
        seen.set(key, vertices.length);
        vertices.push({ x, y, z });
    }

    if (source !== geometry) source.dispose?.();
    return vertices;
}

export function createTesseronLinkGeometry(motherGeometry, proportion) {
    const childScale = clampTesseronProportion(proportion);
    const vertices = uniqueGeometryVertices(motherGeometry);
    const positions = [];

    for (const vertex of vertices) {
        positions.push(vertex.x, vertex.y, vertex.z);
        positions.push(vertex.x * childScale, vertex.y * childScale, vertex.z * childScale);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
}

export function createTesseronBridgeGeometry(motherGeometry, proportion) {
    const childScale = clampTesseronProportion(proportion);
    const edgeGeometry = new THREE.EdgesGeometry(motherGeometry);
    const edgePosition = edgeGeometry.getAttribute('position');
    const positions = [];

    for (let i = 0; i < edgePosition.count; i += 2) {
        const ax = edgePosition.getX(i);
        const ay = edgePosition.getY(i);
        const az = edgePosition.getZ(i);
        const bx = edgePosition.getX(i + 1);
        const by = edgePosition.getY(i + 1);
        const bz = edgePosition.getZ(i + 1);
        const acx = ax * childScale;
        const acy = ay * childScale;
        const acz = az * childScale;
        const bcx = bx * childScale;
        const bcy = by * childScale;
        const bcz = bz * childScale;

        positions.push(
            ax, ay, az,
            bx, by, bz,
            bcx, bcy, bcz,
            ax, ay, az,
            bcx, bcy, bcz,
            acx, acy, acz
        );
    }

    edgeGeometry.dispose?.();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals?.();
    return geometry;
}

export function createTesseronDepthGeometry(motherGeometry, proportion) {
    const childGeometry = scaleGeometryPositions(motherGeometry, proportion);
    const bridgeGeometry = createTesseronBridgeGeometry(motherGeometry, proportion);
    const childPosition = childGeometry.getAttribute('position');
    const bridgePosition = bridgeGeometry.getAttribute('position');
    const positions = new Float32Array((childPosition.count + bridgePosition.count) * 3);

    positions.set(childPosition.array, 0);
    positions.set(bridgePosition.array, childPosition.array.length);

    childGeometry.dispose?.();
    bridgeGeometry.dispose?.();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals?.();
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
    return geometry;
}
