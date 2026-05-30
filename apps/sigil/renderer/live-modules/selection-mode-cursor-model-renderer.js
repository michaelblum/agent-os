import {
    createAvatarShapeComposition,
    disposeAvatarShapeComposition,
} from '../avatar-shape-composition.js';

const CURSOR_MODEL_ROOT_ID = 'selection-mode.cursor.model-root';
const CURSOR_MODEL_OBJECT_ID = 'selection-mode.cursor.sigil-model';
const CURSOR_TRAIL_OBJECT_ID = 'selection-mode.cursor.trail-model';
const AVATAR_ROOT_OBJECT_ID = 'avatar.main';
const CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE = 'current_avatar_effect_descriptors';
const MAX_POINTER_TRAIL_INSTANCES = 8;
const DEFAULT_POINTER_PRISM_GEOMETRY = Object.freeze({
    primitive: 'prism',
    top_radius: 0,
    bottom_radius: 0.8,
    height: 2,
    sides: 3,
    faces_visible: true,
    face_opacity: 0.8,
    edge_opacity: 0.6,
    tesseron_enabled: false,
    tesseron_proportion: 0.5,
    tesseron_match_mother: true,
    orientation_degrees: Object.freeze({ x: 0, y: 0, z: 45 }),
    spin_axis: 'local_y',
});
const POINTER_RENDER_ORDER = 10000;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function integer(value, fallback = 0) {
    return Math.round(finite(value, fallback));
}

function degreesToRadians(value) {
    return finite(value, 0) * Math.PI / 180;
}

function ensureThree(THREEImpl) {
    const THREE = THREEImpl || globalThis.THREE;
    if (!THREE) throw new Error('Selection Mode cursor model renderer requires THREE');
    return THREE;
}

function makeVector3(THREE, x = 0, y = 0, z = 0) {
    if (typeof THREE.Vector3 === 'function') return new THREE.Vector3(x, y, z);
    return {
        x,
        y,
        z,
        set(nx, ny, nz) {
            this.x = nx;
            this.y = ny;
            this.z = nz;
            return this;
        },
        copy(other) {
            this.x = finite(other?.x);
            this.y = finite(other?.y);
            this.z = finite(other?.z);
            return this;
        },
        distanceTo(other) {
            return Math.hypot(this.x - finite(other?.x), this.y - finite(other?.y), this.z - finite(other?.z));
        },
    };
}

function setVector(target, source) {
    if (!target || !source) return;
    if (typeof target.copy === 'function') {
        target.copy(source);
        return;
    }
    target.x = finite(source.x);
    target.y = finite(source.y);
    target.z = finite(source.z);
}

function setScale(target, value) {
    if (!target) return;
    if (typeof target.setScalar === 'function') {
        target.setScalar(value);
        return;
    }
    if (typeof target.set === 'function') {
        target.set(value, value, value);
        return;
    }
    target.x = value;
    target.y = value;
    target.z = value;
}

function setRotationDegrees(target, value = {}) {
    if (!target) return;
    target.x = degreesToRadians(value.x);
    target.y = degreesToRadians(value.y);
    target.z = degreesToRadians(value.z);
}

function resetRotation(target) {
    if (!target) return;
    target.x = 0;
    target.y = 0;
    target.z = 0;
}

function setObjectPosition(target, source = {}) {
    if (!target?.position) return;
    setVector(target.position, source);
}

function pointerVolumeCenter(config = {}) {
    return {
        x: 0,
        y: -finite(config.height, DEFAULT_POINTER_PRISM_GEOMETRY.height) / 2,
        z: 0,
    };
}

function geometryVolumeCenter(geometry, descriptor = null) {
    const center = geometry?.userData?.volume_center_local || geometry?.userData?.center_local;
    if (center) {
        return {
            x: finite(center.x),
            y: finite(center.y),
            z: finite(center.z),
        };
    }
    return pointerVolumeCenter(normalizePointerGeometry(descriptor || geometry?.userData || {}));
}

function scalePointFromCenter(vertex, center, proportion) {
    return {
        x: center.x + ((vertex.x - center.x) * proportion),
        y: center.y + ((vertex.y - center.y) * proportion),
        z: center.z + ((vertex.z - center.z) * proportion),
    };
}

function spinAxisKey(axis = '') {
    const normalized = String(axis || '').toLowerCase();
    if (normalized.endsWith('_x') || normalized === 'x' || normalized === 'local_x') return 'x';
    if (normalized.endsWith('_z') || normalized === 'z' || normalized === 'local_z') return 'z';
    return 'y';
}

function rotateLocalVector(local = {}, rotationDegrees = {}) {
    let x = finite(local.x);
    let y = finite(local.y);
    let z = finite(local.z);
    const rx = degreesToRadians(rotationDegrees.x);
    const ry = degreesToRadians(rotationDegrees.y);
    const rz = degreesToRadians(rotationDegrees.z);
    let c = Math.cos(rx);
    let s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry);
    s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz);
    s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    return { x, y, z };
}

function scaledRotatedLocalVector(local = {}, rotationDegrees = {}, scale = 1) {
    const rotated = rotateLocalVector(local, rotationDegrees);
    const scalar = Math.max(0.0001, finite(scale, 1));
    return {
        x: rotated.x * scalar,
        y: rotated.y * scalar,
        z: rotated.z * scalar,
    };
}

function pointerHotspotLocalFromCenter(geometryDescriptor = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const center = pointerVolumeCenter(normalizePointerGeometry(geometryDescriptor));
    return {
        x: -center.x,
        y: -center.y,
        z: -center.z,
    };
}

function translatedScenePointForCenteredComposition(THREE, scenePoint, {
    geometry = DEFAULT_POINTER_PRISM_GEOMETRY,
    scale = 1,
    localOffset = null,
} = {}) {
    const resolvedGeometry = normalizePointerGeometry(geometry);
    const hotspot = scaledRotatedLocalVector(
        pointerHotspotLocalFromCenter(resolvedGeometry),
        resolvedGeometry.orientation_degrees,
        scale,
    );
    const extra = scaledRotatedLocalVector(
        localOffset || { x: 0, y: 0, z: 0 },
        resolvedGeometry.orientation_degrees,
        scale,
    );
    return makeVector3(
        THREE,
        finite(scenePoint.x) - hotspot.x + extra.x,
        finite(scenePoint.y) - hotspot.y + extra.y,
        finite(scenePoint.z) - hotspot.z + extra.z,
    );
}

function vectorTriplet(value = {}, fallback = { x: 0, y: 0, z: 45 }) {
    return {
        x: finite(value?.x, fallback.x),
        y: finite(value?.y, fallback.y),
        z: finite(value?.z, fallback.z),
    };
}

function normalizePointerGeometry(descriptor = {}) {
    const tesseron = descriptor.tesseron || {};
    return {
        primitive: 'prism',
        geometry_type: 93,
        top_radius: clamp(finite(descriptor.top_radius ?? descriptor.topRadius, DEFAULT_POINTER_PRISM_GEOMETRY.top_radius), 0, 8),
        bottom_radius: clamp(finite(descriptor.bottom_radius ?? descriptor.bottomRadius, DEFAULT_POINTER_PRISM_GEOMETRY.bottom_radius), 0.01, 8),
        height: clamp(finite(descriptor.height, DEFAULT_POINTER_PRISM_GEOMETRY.height), 0.05, 16),
        sides: clamp(integer(descriptor.sides, DEFAULT_POINTER_PRISM_GEOMETRY.sides), 3, 96),
        faces_visible: descriptor.faces_visible ?? descriptor.facesVisible ?? DEFAULT_POINTER_PRISM_GEOMETRY.faces_visible,
        face_opacity: clamp(finite(descriptor.face_opacity ?? descriptor.faceOpacity, DEFAULT_POINTER_PRISM_GEOMETRY.face_opacity), 0, 1),
        edge_opacity: clamp(finite(descriptor.edge_opacity ?? descriptor.edgeOpacity, DEFAULT_POINTER_PRISM_GEOMETRY.edge_opacity), 0, 1),
        tesseron_enabled: descriptor.tesseron_enabled ?? descriptor.tesseronEnabled ?? tesseron.enabled ?? DEFAULT_POINTER_PRISM_GEOMETRY.tesseron_enabled,
        tesseron_proportion: clamp(
            finite(descriptor.tesseron_proportion ?? descriptor.tesseronProportion ?? tesseron.proportion, DEFAULT_POINTER_PRISM_GEOMETRY.tesseron_proportion),
            0.12,
            0.9,
        ),
        tesseron_match_mother: descriptor.tesseron_match_mother ?? descriptor.tesseronMatchMother ?? tesseron.matchMother ?? DEFAULT_POINTER_PRISM_GEOMETRY.tesseron_match_mother,
        orientation_degrees: vectorTriplet(
            descriptor.orientation_degrees ?? descriptor.orientationDegrees,
            DEFAULT_POINTER_PRISM_GEOMETRY.orientation_degrees,
        ),
        spin_axis: String(descriptor.spin_axis || descriptor.spinAxis || DEFAULT_POINTER_PRISM_GEOMETRY.spin_axis),
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
    };
}

function pointerGeometryIdentity(descriptor = {}) {
    const geometry = normalizePointerGeometry(descriptor);
    return [
        geometry.primitive,
        geometry.geometry_type,
        geometry.top_radius,
        geometry.bottom_radius,
        geometry.height,
        geometry.sides,
        geometry.faces_visible,
        geometry.face_opacity,
        geometry.edge_opacity,
        geometry.tesseron_enabled,
        geometry.tesseron_proportion,
        geometry.tesseron_match_mother,
        geometry.orientation_degrees.x,
        geometry.orientation_degrees.y,
        geometry.orientation_degrees.z,
        geometry.spin_axis,
    ];
}

function createAvatarDerivedPointerGeometry(THREE, descriptor = {}) {
    const config = normalizePointerGeometry(descriptor);
    const geometry = new THREE.BufferGeometry();
    const center = pointerVolumeCenter(config);
    const vertices = [];
    const indices = [];
    const sides = config.sides;
    const topRadius = config.top_radius;
    const bottomRadius = config.bottom_radius;
    const height = config.height;
    const pointed = topRadius <= 0.0001;
    const apexIndex = pointed ? 0 : null;
    const topStart = pointed ? null : 0;
    const bottomStart = pointed ? 1 : sides;
    if (pointed) {
        vertices.push(0, 0, 0);
    } else {
        for (let i = 0; i < sides; i += 1) {
            const angle = (i / sides) * Math.PI * 2;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            vertices.push(c * topRadius, 0, s * topRadius);
        }
    }
    for (let i = 0; i < sides; i += 1) {
        const angle = (i / sides) * Math.PI * 2;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        vertices.push(c * bottomRadius, -height, s * bottomRadius);
    }
    for (let i = 0; i < sides; i += 1) {
        const next = (i + 1) % sides;
        const b0 = bottomStart + i;
        const b1 = bottomStart + next;
        if (pointed) {
            indices.push(apexIndex, b0, b1);
        } else {
            const t0 = topStart + i;
            const t1 = topStart + next;
            indices.push(t0, b0, b1, t0, b1, t1);
        }
    }
    const bottomCenter = vertices.length / 3;
    vertices.push(0, -height, 0);
    for (let i = 0; i < sides; i += 1) {
        const next = (i + 1) % sides;
        indices.push(bottomCenter, bottomStart + next, bottomStart + i);
    }
    if (!pointed) {
        const topCenter = vertices.length / 3;
        vertices.push(0, 0, 0);
        for (let i = 0; i < sides; i += 1) {
            const next = (i + 1) % sides;
            indices.push(topCenter, topStart + i, topStart + next);
        }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (typeof geometry.setIndex === 'function') geometry.setIndex(indices);
    if (typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
    geometry.userData = {
        primitive: 'prism',
        geometry_type: 93,
        geometry_family: 'selection_mode_avatar_prism_pointer',
        hotspot_local: { x: 0, y: 0, z: 0 },
        depth_semantics: 'screen_plane_pointer',
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
        base_cross_section: config.sides === 3 ? 'triangular' : 'regular_polygon',
        center_local: center,
        volume_center_local: center,
        top_radius: topRadius,
        bottom_radius: bottomRadius,
        height,
        sides,
        faces_visible: config.faces_visible,
        face_opacity: config.face_opacity,
        edge_opacity: config.edge_opacity,
        tesseron_enabled: config.tesseron_enabled,
        tesseron_proportion: config.tesseron_proportion,
        tesseron_match_mother: config.tesseron_match_mother,
        top_ring_indices: pointed ? [apexIndex] : Array.from({ length: sides }, (_, index) => topStart + index),
        base_ring_indices: Array.from({ length: sides }, (_, index) => bottomStart + index),
        spin_axis: config.spin_axis,
        orientation_degrees: config.orientation_degrees,
    };
    return geometry;
}

function geometryVertex(geometry, index) {
    const attr = geometry?.attributes?.position;
    const values = attr?.array || [];
    const itemSize = Number(attr?.itemSize) || 3;
    const offset = index * itemSize;
    return {
        x: finite(values[offset]),
        y: finite(values[offset + 1]),
        z: finite(values[offset + 2]),
    };
}

function createScaledPointerGeometry(THREE, sourceGeometry, proportion) {
    const geometry = new THREE.BufferGeometry();
    const attr = sourceGeometry?.attributes?.position;
    const values = attr?.array || [];
    const itemSize = Number(attr?.itemSize) || 3;
    const center = geometryVolumeCenter(sourceGeometry);
    const scaled = [];
    for (let i = 0; i < values.length; i += itemSize) {
        const vertex = {
            x: finite(values[i]),
            y: finite(values[i + 1]),
            z: finite(values[i + 2]),
        };
        const next = scalePointFromCenter(vertex, center, proportion);
        scaled.push(
            next.x,
            next.y,
            next.z,
        );
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(scaled, 3));
    if (typeof geometry.setIndex === 'function' && sourceGeometry?.index) geometry.setIndex(sourceGeometry.index);
    if (typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
    geometry.userData = {
        ...(sourceGeometry?.userData || {}),
        tesseron_child: true,
        tesseron_proportion: proportion,
        tesseron_scale_origin: 'pointer_volume_center',
        center_local: center,
        volume_center_local: center,
    };
    return geometry;
}

function createPointerTesseronLinkGeometry(THREE, sourceGeometry, proportion) {
    const geometry = new THREE.BufferGeometry();
    const indices = [
        ...(sourceGeometry?.userData?.top_ring_indices || []),
        ...(sourceGeometry?.userData?.base_ring_indices || []),
    ];
    const center = geometryVolumeCenter(sourceGeometry);
    const positions = [];
    for (const index of indices) {
        const vertex = geometryVertex(sourceGeometry, index);
        const childVertex = scalePointFromCenter(vertex, center, proportion);
        positions.push(
            vertex.x, vertex.y, vertex.z,
            childVertex.x, childVertex.y, childVertex.z,
        );
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.userData = {
        primitive: 'tesseron_links',
        tesseron_proportion: proportion,
        tesseron_scale_origin: 'pointer_volume_center',
        center_local: center,
        volume_center_local: center,
        link_count: indices.length,
    };
    return geometry;
}

function cloneMaterial(material) {
    if (!material) return null;
    if (typeof material.clone === 'function') return material.clone();
    return { ...material };
}

function hexToRgb(value = '') {
    let hex = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((entry) => `${entry}${entry}`).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
    };
}

function colorPair(colors = [], fallback = ['#bc13fe', '#4a2b6e']) {
    const first = String(colors?.[0] || fallback[0] || '#bc13fe');
    const second = String(colors?.[1] || colors?.[0] || fallback[1] || first);
    return [first, second];
}

function avatarColorPair(source = {}, key = 'face', fallback = ['#bc13fe', '#4a2b6e']) {
    return colorPair(source.colorRamp?.[key] || source.colors?.[key] || [], fallback);
}

function setMaterialColor(target, value) {
    if (!target || !value) return;
    if (target.color?.set) {
        target.color.set(value);
    } else if (target.color?.copy && globalThis.THREE?.Color) {
        target.color.copy(new globalThis.THREE.Color(value));
    } else {
        target.color = value;
    }
}

function setMaterialEmissive(target, value) {
    if (!target || !value) return;
    if (target.emissive?.set) {
        target.emissive.set(value);
    } else if ('emissive' in target) {
        target.emissive = value;
    }
}

function stabilizePointerFaceMaterial(material) {
    if (!material) return;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.toneMapped = false;
    if ('emissiveIntensity' in material) material.emissiveIntensity = Math.max(1, finite(material.emissiveIntensity, 1));
}

function stabilizePointerLineMaterial(material) {
    if (!material) return;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.toneMapped = false;
    material.vertexColors = false;
}

function stabilizePointerEffectMaterial(material) {
    if (!material) return;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.toneMapped = false;
    material.vertexColors = false;
}

function materialEntries(material) {
    if (!material) return [];
    return Array.isArray(material) ? material.filter(Boolean) : [material];
}

function visitObjectTree(object, visitor = () => {}) {
    if (!object) return;
    visitor(object);
    const children = Array.isArray(object.children) ? object.children : [];
    for (const child of children) visitObjectTree(child, visitor);
}

function applyPointerRenderPolicy(instance) {
    const root = instance?.group || instance;
    const order = POINTER_RENDER_ORDER + (instance?.trail ? -1 : 0);
    visitObjectTree(root, (object) => {
        object.renderOrder = order;
        object.frustumCulled = false;
        for (const material of materialEntries(object.material)) {
            material.transparent = true;
            material.depthWrite = false;
            material.depthTest = false;
            material.toneMapped = false;
            material.needsUpdate = true;
        }
    });
    if (root?.userData) {
        root.userData.render_policy = {
            source: 'selection_mode_pointer_overlay_material_policy',
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            renderOrder: order,
            applies_to: 'composition_tree',
        };
    }
}

function applyGeometryGradient(THREE, geometry, colors = []) {
    const attr = geometry?.attributes?.position;
    const values = attr?.array;
    const itemSize = Number(attr?.itemSize) || 3;
    if (!geometry?.setAttribute || !values || itemSize < 3 || typeof THREE?.Float32BufferAttribute !== 'function') return false;
    const [first, second] = colorPair(colors);
    const rgbA = hexToRgb(first);
    const rgbB = hexToRgb(second) || rgbA;
    if (!rgbA || !rgbB) return false;
    const count = Math.floor(values.length / itemSize);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i += 1) {
        const y = Number(values[(i * itemSize) + 1]);
        if (!Number.isFinite(y)) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const span = Math.max(0.0001, maxY - minY);
    const result = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        const y = Number(values[(i * itemSize) + 1]);
        const t = clamp((y - minY) / span, 0, 1);
        result[(i * 3)] = rgbA.r + ((rgbB.r - rgbA.r) * t);
        result[(i * 3) + 1] = rgbA.g + ((rgbB.g - rgbA.g) * t);
        result[(i * 3) + 2] = rgbA.b + ((rgbB.b - rgbA.b) * t);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(result, 3));
    geometry.userData = {
        ...geometry.userData,
        vertex_color_source: 'current_avatar_color_ramp',
        vertex_color_pair: [first, second],
    };
    return true;
}

function applyAvatarMaterialVisuals(instance, avatarSource = {}) {
    const nextIdentity = pointerVisualIdentity(avatarSource);
    const visualIdentityUnchanged = sameIdentity(instance.group?.userData?.visual_identity, nextIdentity);
    const face = avatarColorPair(avatarSource, 'face');
    const edge = avatarColorPair(avatarSource, 'edge', face);
    const aura = avatarColorPair(avatarSource, 'aura', edge);
    if (!visualIdentityUnchanged) {
        applyGeometryGradient(instance.THREE || globalThis.THREE || {}, instance.geometry, face);
        instance.group.userData.visual_identity = nextIdentity;
    }
    if (instance.core?.material) {
        instance.core.material.vertexColors = true;
        stabilizePointerFaceMaterial(instance.core.material);
        setMaterialColor(instance.core.material, face[0]);
        setMaterialEmissive(instance.core.material, aura[0]);
    }
    if (instance.tesseron?.childCore?.material) {
        instance.tesseron.childCore.material.vertexColors = true;
        stabilizePointerFaceMaterial(instance.tesseron.childCore.material);
        setMaterialColor(instance.tesseron.childCore.material, face[0]);
        setMaterialEmissive(instance.tesseron.childCore.material, aura[0]);
    }
    if (instance.edges?.material) {
        stabilizePointerLineMaterial(instance.edges.material);
        setMaterialColor(instance.edges.material, edge[0]);
    }
    if (instance.tesseron?.childEdges?.material) {
        stabilizePointerLineMaterial(instance.tesseron.childEdges.material);
        setMaterialColor(instance.tesseron.childEdges.material, edge[0]);
    }
    if (instance.tesseron?.links?.material) {
        stabilizePointerLineMaterial(instance.tesseron.links.material);
        setMaterialColor(instance.tesseron.links.material, edge[0]);
    }
    instance.group.userData.resolved_visual = {
        source: 'current_avatar_color_ramp',
        primary: face[0],
        edge: edge[0],
        aura: aura[0],
        all_black_guard: !/^#?0{6}$/i.test(String(face[0] || '')),
    };
}

function copyMaterial(source, target) {
    if (!source || !target) return;
    if (typeof target.copy === 'function') {
        target.copy(source);
    } else {
        Object.assign(target, source);
    }
    target.transparent = true;
    target.depthTest = source.depthTest !== false;
}

function makeFallbackMaterial(THREE, kind, trail = false) {
    if (kind === 'edge') {
        return new THREE.LineBasicMaterial({
            color: '#c8ffff',
            transparent: true,
            opacity: trail ? 0.34 : 0.96,
            depthTest: true,
        });
    }
    return new THREE.MeshPhongMaterial({
        color: '#071318',
        emissive: '#28f6ff',
        specular: '#c8ffff',
        shininess: 80,
        transparent: true,
        opacity: trail ? 0.22 : 0.82,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: !trail,
    });
}

function sourceMaterialIdentity(source = {}) {
    return [
        source.identity || source.version,
        source.primaryMaterialTemplate || source.primaryMaterial,
        source.edgeMaterialTemplate || source.edgeMaterial,
        source.skin,
        source.geometryType,
    ];
}

function sameIdentity(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function pointerEffectIdentity(source = {}) {
    const aura = source.auraDescriptor || {};
    return [
        source.effectsSource || source.effects_source || CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        source.identity || source.version,
        aura.enabled,
        aura.reach,
        aura.intensity,
        aura.pulseRate,
        aura.wobble?.count,
        avatarColorPair(source, 'aura').join(':'),
    ];
}

function pointerVisualIdentity(source = {}) {
    return [
        source.identity || source.version,
        avatarColorPair(source, 'face').join(':'),
        avatarColorPair(source, 'edge').join(':'),
        avatarColorPair(source, 'aura').join(':'),
    ];
}

function createPointerEffectTexture(THREE, core = false) {
    if (typeof document === 'undefined' || typeof THREE?.CanvasTexture !== 'function') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (core) {
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.32, 'rgba(255,255,255,0.58)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
        gradient.addColorStop(0, 'rgba(255,255,255,0.72)');
        gradient.addColorStop(0.48, 'rgba(255,255,255,0.18)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.userData = {
        kind: 'selection_mode_pointer_radial_alpha_texture',
        core,
    };
    return texture;
}

function createEffectSprite(THREE, name, options = {}) {
    const Material = THREE.SpriteMaterial || THREE.MeshBasicMaterial || THREE.MeshPhongMaterial || THREE.LineBasicMaterial;
    const material = Material ? new Material(options) : { ...options };
    stabilizePointerEffectMaterial(material);
    material.userData = {
        ...(material.userData || {}),
        pointer_effect_base_opacity: finite(options.opacity, 0),
    };
    const object = typeof THREE.Sprite === 'function' ? new THREE.Sprite(material) : new THREE.Group();
    object.name = name;
    object.material = object.material || material;
    object.userData = {
        kind: 'selection_mode_pointer_effect',
        effect_family: name.endsWith('.glow') ? 'aura_glow' : 'aura_core',
    };
    return object;
}

function createPointerCoreGeometry(THREE) {
    if (typeof THREE.OctahedronGeometry === 'function') return new THREE.OctahedronGeometry(0.16, 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.22, 0, 0.18, 0, 0, 0, 0, 0.18,
        0, 0.22, 0, 0, 0, 0.18, -0.18, 0, 0,
        0, 0.22, 0, -0.18, 0, 0, 0, 0, -0.18,
        0, 0.22, 0, 0, 0, -0.18, 0.18, 0, 0,
        0, -0.22, 0, 0, 0, 0.18, 0.18, 0, 0,
        0, -0.22, 0, -0.18, 0, 0, 0, 0, 0.18,
        0, -0.22, 0, 0, 0, -0.18, -0.18, 0, 0,
        0, -0.22, 0, 0.18, 0, 0, 0, 0, -0.18,
    ], 3));
    geometry.computeVertexNormals?.();
    geometry.userData = { primitive: 'pointer_rotating_core_octahedron' };
    return geometry;
}

function createEffectMesh(THREE, name, options = {}) {
    const material = new (THREE.MeshPhongMaterial || THREE.MeshBasicMaterial || THREE.LineBasicMaterial)({
        color: options.color || '#bc13fe',
        emissive: options.emissive || options.color || '#bc13fe',
        transparent: true,
        opacity: options.opacity ?? 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });
    stabilizePointerEffectMaterial(material);
    material.userData = {
        ...(material.userData || {}),
        pointer_effect_base_opacity: finite(options.opacity, 0.72),
    };
    const mesh = new THREE.Mesh(createPointerCoreGeometry(THREE), material);
    mesh.name = name;
    mesh.userData = {
        kind: 'selection_mode_pointer_effect',
        effect_family: 'aura_rotating_core',
        avatar_effect_hook: 'auraDescriptor',
    };
    return mesh;
}

function createEffectLineSegments(THREE, name, options = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const material = new THREE.LineBasicMaterial({
        color: options.color || '#bc13fe',
        transparent: true,
        opacity: options.opacity ?? 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });
    stabilizePointerEffectMaterial(material);
    material.userData = {
        ...(material.userData || {}),
        pointer_effect_base_opacity: finite(options.opacity, 0.55),
    };
    const line = new THREE.LineSegments(geometry, material);
    line.name = name;
    line.userData = {
        kind: 'selection_mode_pointer_effect',
        effect_family: options.family || 'avatar_descriptor_line_effect',
        avatar_effect_hook: options.hook || '',
    };
    return line;
}

function setLinePositions(THREE, line, positions = []) {
    if (!line?.geometry?.setAttribute) return;
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    line.geometry.attributes.position.needsUpdate = true;
}

function setPointerEffectBaseOpacity(sprite, opacity) {
    const material = sprite?.material;
    if (!material) return;
    const baseOpacity = clamp(opacity, 0, 1);
    material.userData = {
        ...(material.userData || {}),
        pointer_effect_base_opacity: baseOpacity,
    };
    material.opacity = baseOpacity;
    material.transparent = true;
}

function setPointerEffectOpacity(sprite, alpha, fill = true) {
    const material = sprite?.material;
    if (!material) return;
    const baseOpacity = finite(material.userData?.pointer_effect_base_opacity, finite(material.opacity, 0));
    const trailSoftening = fill ? 1 : 0.42;
    material.opacity = clamp(baseOpacity * alpha * trailSoftening, 0, 1);
    material.transparent = true;
}

function createPointerEffectObjects(THREE, objectId, trail = false, stats = null) {
    const group = new THREE.Group();
    group.name = `${objectId}.effects`;
    group.userData = {
        source: CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        adapter: 'selection_mode_pointer_scale_effects',
        pointer_scale_boundary: [
            'aura glow/core are rendered at pointer scale',
            'large avatar-only phenomena remain inherited descriptors unless explicitly adapted',
        ],
    };
    const glow = createEffectSprite(THREE, `${objectId}.effects.glow`, {
        map: createPointerEffectTexture(THREE, false),
        color: '#bc13fe',
        transparent: true,
        opacity: trail ? 0.08 : 0.28,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    const core = createEffectSprite(THREE, `${objectId}.effects.core`, {
        map: createPointerEffectTexture(THREE, true),
        color: '#bc13fe',
        transparent: true,
        opacity: trail ? 0.05 : 0.18,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    const rotatingCore = createEffectMesh(THREE, `${objectId}.effects.rotating-core`, {
        color: '#bc13fe',
        opacity: trail ? 0.18 : 0.72,
    });
    const lightning = createEffectLineSegments(THREE, `${objectId}.effects.lightning`, {
        color: '#bc13fe',
        opacity: trail ? 0.18 : 0.68,
        family: 'lightning',
        hook: 'lightningDescriptor',
    });
    const magnetic = createEffectLineSegments(THREE, `${objectId}.effects.magnetic`, {
        color: '#bc13fe',
        opacity: trail ? 0.14 : 0.42,
        family: 'magnetic',
        hook: 'magneticDescriptor',
    });
    if (glow.scale?.set) glow.scale.set(2.6, 2.6, 1);
    if (core.scale?.set) core.scale.set(1.18, 1.18, 1);
    if (rotatingCore.scale?.setScalar) rotatingCore.scale.setScalar(trail ? 0.68 : 1);
    group.add(glow);
    group.add(core);
    group.add(rotatingCore);
    group.add(lightning);
    group.add(magnetic);
    lightning.visible = false;
    magnetic.visible = false;
    if (stats) {
        stats.effect_groups_created += 1;
        stats.geometries_created += 3;
        stats.materials_created += 5;
    }
    return { group, glow, core, rotatingCore, lightning, magnetic, effect_identity: [] };
}

function applyCenteredPointerComposition(instance, geometry = null) {
    if (!instance) return;
    const center = geometryVolumeCenter(geometry || instance.geometry);
    const modelOffset = {
        x: -center.x,
        y: -center.y,
        z: -center.z,
    };
    setObjectPosition(instance.modelGroup, modelOffset);
    setObjectPosition(instance.effects?.group, { x: 0, y: 0, z: 0 });
    if (instance.composition?.userData) {
        instance.composition.userData = {
            ...(instance.composition.userData || {}),
            anchor: 'pointer_volume_center',
            center_local: { x: 0, y: 0, z: 0 },
            source_volume_center_local: center,
            hotspot_local: modelOffset,
        };
    }
    if (instance.effects?.group?.userData) {
        instance.effects.group.userData = {
            ...(instance.effects.group.userData || {}),
            anchor: 'pointer_volume_center',
            center_local: { x: 0, y: 0, z: 0 },
            source_volume_center_local: center,
        };
    }
    if (instance.group?.userData) {
        instance.group.userData.composition_origin = 'pointer_volume_center';
        instance.group.userData.hotspot_local = modelOffset;
        instance.group.userData.source_volume_center_local = center;
    }
}

function createPointerTesseronObjects(THREE, objectId, geometry, config, trail = false, stats = null) {
    const childGeometry = createScaledPointerGeometry(THREE, geometry, config.tesseron_proportion);
    const childEdgeGeometry = typeof THREE.EdgesGeometry === 'function' ? new THREE.EdgesGeometry(childGeometry) : childGeometry;
    const linkGeometry = createPointerTesseronLinkGeometry(THREE, geometry, config.tesseron_proportion);
    const childEdges = new THREE.LineSegments(
        childEdgeGeometry,
        makeFallbackMaterial(THREE, 'edge', trail),
    );
    const links = new THREE.LineSegments(
        linkGeometry,
        makeFallbackMaterial(THREE, 'edge', trail),
    );
    childEdges.name = `${objectId}.tesseron.child.edges`;
    links.name = `${objectId}.tesseron.links`;
    childEdges.userData = {
        kind: 'selection_mode_pointer_tesseron_child',
        tesseron_proportion: config.tesseron_proportion,
    };
    links.userData = {
        kind: 'selection_mode_pointer_tesseron_links',
        tesseron_proportion: config.tesseron_proportion,
    };
    childEdges.visible = config.tesseron_enabled === true;
    links.visible = config.tesseron_enabled === true;
    if (stats) {
        stats.geometries_created += childEdgeGeometry === childGeometry ? 2 : 3;
        stats.materials_created += 2;
    }
    return {
        childGeometry,
        childEdges,
        links,
        linkGeometry,
    };
}

function avatarShapeConfigForPointer(THREE, modelGroup, objectId, geometryDescriptor, avatarSource = {}, trail = false) {
    const resolvedGeometry = normalizePointerGeometry(geometryDescriptor);
    const source = avatarSource || {};
    const face = avatarColorPair(source, 'face');
    const edge = avatarColorPair(source, 'edge', face);
    return {
        group: modelGroup,
        baseGeometryFactory: () => createAvatarDerivedPointerGeometry(THREE, resolvedGeometry),
        tesseronScaleOrigin: 'pointer_volume_center',
        opacity: resolvedGeometry.faces_visible === true ? resolvedGeometry.face_opacity : 0,
        edgeOpacity: resolvedGeometry.edge_opacity,
        stellation: 0,
        isInterior: false,
        isSpecular: true,
        isMask: resolvedGeometry.faces_visible !== true || resolvedGeometry.face_opacity <= 0,
        faceColors: face,
        edgeColors: edge,
        skin: source.skin || 'none',
        isOmega: false,
        tesseron: {
            enabled: resolvedGeometry.tesseron_enabled === true,
            proportion: resolvedGeometry.tesseron_proportion,
            matchMother: resolvedGeometry.tesseron_match_mother !== false,
        },
        pointerObjectId: objectId,
        trail,
    };
}

function namePointerShapeComposition(shape, objectId, resolvedGeometry) {
    if (!shape) return;
    const assignments = [
        [shape.depthMesh, '.depth', 'selection_mode_pointer_depth'],
        [shape.coreMesh, '.core', 'selection_mode_pointer_core'],
        [shape.wireframeMesh, '.edges', 'selection_mode_pointer_edges'],
        [shape.tesseronChildDepthMesh, '.tesseron.child.depth', 'selection_mode_pointer_tesseron_child_depth'],
        [shape.tesseronChildCoreMesh, '.tesseron.child.core', 'selection_mode_pointer_tesseron_child_core'],
        [shape.tesseronChildWireframeMesh, '.tesseron.child.edges', 'selection_mode_pointer_tesseron_child'],
        [shape.innerWireframeMesh, '.tesseron.links', 'selection_mode_pointer_tesseron_links'],
        [shape.innerHighlightWireframeMesh, '.tesseron.links.highlight', 'selection_mode_pointer_tesseron_link_highlight'],
    ];
    for (const [object, suffix, kind] of assignments) {
        if (!object) continue;
        object.name = `${objectId}${suffix}`;
        object.userData = {
            ...(object.userData || {}),
            kind,
            shared_avatar_shape_composition: true,
            tesseron_proportion: resolvedGeometry.tesseron_proportion,
            tesseron_scale_origin: 'pointer_volume_center',
        };
    }
    if (shape.coreMesh) shape.coreMesh.visible = resolvedGeometry.faces_visible === true && resolvedGeometry.face_opacity > 0;
    if (shape.tesseronChildCoreMesh) shape.tesseronChildCoreMesh.visible = resolvedGeometry.tesseron_enabled === true && resolvedGeometry.faces_visible === true && resolvedGeometry.face_opacity > 0;
    if (shape.tesseronChildWireframeMesh) shape.tesseronChildWireframeMesh.visible = resolvedGeometry.tesseron_enabled === true;
    if (shape.innerWireframeMesh) shape.innerWireframeMesh.visible = resolvedGeometry.tesseron_enabled === true && resolvedGeometry.edge_opacity > 0;
    if (shape.innerHighlightWireframeMesh) shape.innerHighlightWireframeMesh.visible = false;
}

function createPointerShapeComposition(THREE, modelGroup, objectId, geometryDescriptor, avatarSource = {}, trail = false, stats = null) {
    const resolvedGeometry = normalizePointerGeometry(geometryDescriptor);
    const shape = createAvatarShapeComposition(
        THREE,
        93,
        avatarShapeConfigForPointer(THREE, modelGroup, objectId, resolvedGeometry, avatarSource, trail),
    );
    namePointerShapeComposition(shape, objectId, resolvedGeometry);
    if (stats) {
        stats.geometries_created += resolvedGeometry.tesseron_enabled ? 8 : 3;
        stats.materials_created += resolvedGeometry.tesseron_enabled ? 8 : 3;
    }
    return shape;
}

function applyAvatarEffectsToInstance(instance, avatarSource = null) {
    if (!instance?.effects || !avatarSource) return;
    const aura = avatarSource.auraDescriptor || {};
    const identity = pointerEffectIdentity(avatarSource);
    const [auraPrimary, auraSecondary] = avatarColorPair(avatarSource, 'aura');
    const enabled = aura.enabled !== false;
    const intensity = clamp(finite(aura.intensity, 1), 0, 4);
    const reach = clamp(finite(aura.reach, 1), 0.1, 4);
    const coreFade = clamp(finite(aura.coreFade, 0.6), 0, 1);
    const coreIntensityFactor = intensity / 3;
    const glowBaseOpacity = instance.trail
        ? clamp(0.32 * intensity, 0.04, 0.38)
        : 1;
    const coreBaseOpacity = instance.trail
        ? clamp((1 - (coreFade * coreIntensityFactor)) * 0.34, 0.04, 0.38)
        : clamp(1 - (coreFade * coreIntensityFactor), 0.12, 1);
    if (!sameIdentity(instance.effects.effect_identity, identity)) {
        setMaterialColor(instance.effects.glow?.material, auraPrimary);
        setMaterialColor(instance.effects.core?.material, auraSecondary || auraPrimary);
        setMaterialColor(instance.effects.rotatingCore?.material, auraSecondary || auraPrimary);
        setMaterialEmissive(instance.effects.rotatingCore?.material, auraPrimary);
        setMaterialColor(instance.effects.lightning?.material, avatarColorPair(avatarSource, 'lightning', [auraPrimary, auraSecondary])[0]);
        setMaterialColor(instance.effects.magnetic?.material, avatarColorPair(avatarSource, 'magnetic', [auraSecondary, auraPrimary])[0]);
        instance.effects.effect_identity = identity;
    }
    instance.effects.group.visible = enabled;
    if (instance.effects.glow?.material) {
        setPointerEffectBaseOpacity(
            instance.effects.glow,
            enabled ? glowBaseOpacity : 0,
        );
    }
    if (instance.effects.core?.material) {
        setPointerEffectBaseOpacity(
            instance.effects.core,
            enabled ? coreBaseOpacity : 0,
        );
    }
    if (instance.effects.rotatingCore?.material) {
        setPointerEffectBaseOpacity(
            instance.effects.rotatingCore,
            enabled ? clamp(0.78 * intensity, 0.2, 1) : 0,
        );
    }
    const lightning = avatarSource.lightningDescriptor || {};
    const magnetic = avatarSource.magneticDescriptor || {};
    const lightningEnabled = lightning.enabled === true;
    const magneticEnabled = magnetic.enabled === true || magnetic.fieldEnabled === true;
    if (instance.effects.lightning) {
        instance.effects.lightning.visible = lightningEnabled;
        setPointerEffectBaseOpacity(
            instance.effects.lightning,
            lightningEnabled ? clamp(finite(lightning.brightness, 1) * (instance.trail ? 0.2 : 0.78), 0.08, 1) : 0,
        );
    }
    if (instance.effects.magnetic) {
        instance.effects.magnetic.visible = magneticEnabled;
        setPointerEffectBaseOpacity(
            instance.effects.magnetic,
            magneticEnabled ? clamp(finite(magnetic.fieldStrength, 1) * (instance.trail ? 0.14 : 0.48), 0.06, 0.72) : 0,
        );
    }
    const glowScale = (instance.trail ? 1.55 : 2.6) * reach;
    const coreScale = (instance.trail ? 0.74 : 1.18) * Math.max(0.5, Math.sqrt(reach));
    if (instance.effects.glow?.scale?.set) instance.effects.glow.scale.set(glowScale, glowScale, 1);
    if (instance.effects.core?.scale?.set) instance.effects.core.scale.set(coreScale, coreScale, 1);
    if (instance.effects.rotatingCore?.scale?.setScalar) {
        instance.effects.rotatingCore.scale.setScalar((instance.trail ? 0.48 : 0.82) * Math.max(0.5, Math.sqrt(reach)));
    }
    const phenomena = avatarSource.phenomenaDescriptor || {};
    const enabledFamilies = ['pulsar', 'accretion', 'gamma', 'neutrino']
        .filter((key) => phenomena[key]?.enabled === true && finite(phenomena[key]?.count, 0) > 0);
    if (lightningEnabled) enabledFamilies.push('lightning');
    if (magneticEnabled) enabledFamilies.push('magnetic');
    const renderedEffects = [];
    if (enabled) renderedEffects.push('aura_glow', 'aura_core', 'aura_rotating_core');
    if (lightningEnabled) renderedEffects.push('lightning');
    if (magneticEnabled) renderedEffects.push('magnetic');
    instance.group.userData.effects_source = avatarSource.effectsSource || avatarSource.effects_source || CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE;
    instance.group.userData.effect_families = [...new Set([...renderedEffects, ...enabledFamilies])];
    instance.group.userData.pointer_effects = {
        source: instance.group.userData.effects_source,
        rendered: renderedEffects,
        inherited_descriptors: enabledFamilies,
        aura: {
            enabled,
            reach,
            intensity,
            primary: auraPrimary,
            secondary: auraSecondary,
        },
        lightning: {
            enabled: lightningEnabled,
            brightness: finite(lightning.brightness, 1),
        },
        magnetic: {
            enabled: magneticEnabled,
            fieldStrength: finite(magnetic.fieldStrength, 1),
        },
        pointer_scale_boundary: instance.effects.group.userData.pointer_scale_boundary,
    };
}

function createModelInstance(THREE, {
    objectId,
    trail = false,
    stats = null,
    avatarSource = null,
    geometryDescriptor = DEFAULT_POINTER_PRISM_GEOMETRY,
} = {}) {
    const group = new THREE.Group();
    const composition = new THREE.Group();
    const spin = new THREE.Group();
    const modelGroup = new THREE.Group();
    const sourceIdentity = sourceMaterialIdentity(avatarSource);
    const geometryIdentity = pointerGeometryIdentity(geometryDescriptor);
    const resolvedGeometry = normalizePointerGeometry(geometryDescriptor);
    if (stats) {
        stats.model_instances_created += 1;
        if (trail) stats.trail_instances_created += 1;
    }
    const shapeComposition = createPointerShapeComposition(
        THREE,
        modelGroup,
        objectId,
        resolvedGeometry,
        avatarSource || {},
        trail,
        stats,
    );
    const geometry = shapeComposition.finalGeometry;
    const core = shapeComposition.coreMesh;
    const edges = shapeComposition.wireframeMesh;
    const effects = createPointerEffectObjects(THREE, objectId, trail, stats);
    composition.name = `${objectId}.composition`;
    modelGroup.name = `${objectId}.centered-model`;
    spin.name = `${objectId}.spin`;
    group.name = objectId;
    group.userData = {
        object_id: objectId,
        parent_object_id: AVATAR_ROOT_OBJECT_ID,
        kind: 'three.object3d',
        model_kind: 'sigil_model',
        source: 'avatar_render_state',
        appearance_source: avatarSource?.appearanceSource || 'current_live_sigil_avatar',
        shape: 'avatar_derived_prism_pointer',
        geometry: 'prism',
        geometry_type: 93,
        geometry_family: 'selection_mode_avatar_prism_pointer',
        long_axis: resolvedGeometry.long_axis,
        base_screen_quadrant: resolvedGeometry.base_screen_quadrant,
        orientation_degrees: resolvedGeometry.orientation_degrees,
        spin_axis: resolvedGeometry.spin_axis,
        faces_visible: resolvedGeometry.faces_visible,
        face_opacity: resolvedGeometry.face_opacity,
        edge_opacity: resolvedGeometry.edge_opacity,
        tesseron_enabled: resolvedGeometry.tesseron_enabled,
        tesseron_proportion: resolvedGeometry.tesseron_proportion,
        tesseron_match_mother: resolvedGeometry.tesseron_match_mother,
        hotspot: 'tip',
        trail,
    };
    group.userData.material_source = avatarSource?.materialSource || 'live_avatar_materials';
    group.userData.effects_source = avatarSource?.effectsSource || avatarSource?.effects_source || CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE;
    group.userData.cursor_overrides = ['geometry', 'orientation', 'hotspot', 'scale', 'visibility', 'single_axis_rotation'];
    group.userData.material_identity = sourceIdentity;
    group.userData.geometry_identity = geometryIdentity;
    group.userData.effect_identity = pointerEffectIdentity(avatarSource);
    const tesseron = {
        shapeComposition,
        childGeometry: shapeComposition.tesseronChildGeometry,
        childCore: shapeComposition.tesseronChildCoreMesh,
        childEdges: shapeComposition.tesseronChildWireframeMesh,
        links: shapeComposition.innerWireframeMesh,
        linkGeometry: shapeComposition.tesseronLinkGeometry,
    };
    spin.add(modelGroup);
    composition.add(spin);
    composition.add(effects.group);
    group.add(composition);
    group.visible = false;
    applyCenteredPointerComposition({ group, composition, modelGroup, effects, geometry });
    applyAvatarMaterialVisuals({ group, core, edges, tesseron, geometry, THREE }, avatarSource || {});
    applyAvatarEffectsToInstance({ group, effects, trail }, avatarSource || {});
    applyPointerRenderPolicy({ group, trail });
    return { group, composition, modelGroup, spin, core, edges, effects, tesseron, geometry, shapeComposition, trail, THREE };
}

function applyPointerTesseronGeometryToInstance(instance, baseGeometry, resolvedGeometry, stats = null) {
    if (!instance?.tesseron) return;
    const THREE = instance.THREE || globalThis.THREE;
    const nextChildGeometry = createScaledPointerGeometry(THREE, baseGeometry, resolvedGeometry.tesseron_proportion);
    const nextChildEdgeGeometry = typeof THREE?.EdgesGeometry === 'function'
        ? new THREE.EdgesGeometry(nextChildGeometry)
        : nextChildGeometry;
    const nextLinkGeometry = createPointerTesseronLinkGeometry(THREE, baseGeometry, resolvedGeometry.tesseron_proportion);
    instance.tesseron.childGeometry?.dispose?.();
    if (instance.tesseron.childEdges?.geometry !== instance.tesseron.childGeometry) {
        instance.tesseron.childEdges?.geometry?.dispose?.();
    }
    instance.tesseron.links?.geometry?.dispose?.();
    instance.tesseron.childGeometry = nextChildGeometry;
    if (instance.tesseron.childEdges) {
        instance.tesseron.childEdges.geometry = nextChildEdgeGeometry;
        instance.tesseron.childEdges.visible = resolvedGeometry.tesseron_enabled === true;
        instance.tesseron.childEdges.userData.tesseron_proportion = resolvedGeometry.tesseron_proportion;
    }
    if (instance.tesseron.links) {
        instance.tesseron.links.geometry = nextLinkGeometry;
        instance.tesseron.links.visible = resolvedGeometry.tesseron_enabled === true;
        instance.tesseron.links.userData.tesseron_proportion = resolvedGeometry.tesseron_proportion;
    }
    instance.tesseron.linkGeometry = nextLinkGeometry;
    if (stats) stats.geometries_created += nextChildEdgeGeometry === nextChildGeometry ? 2 : 3;
}

function applyPointerGeometryToInstance(instance, geometryDescriptor = DEFAULT_POINTER_PRISM_GEOMETRY, stats = null) {
    if (!instance) return;
    const nextIdentity = pointerGeometryIdentity(geometryDescriptor);
    const resolvedGeometry = normalizePointerGeometry(geometryDescriptor);
    if (!sameIdentity(instance.group.userData.geometry_identity || [], nextIdentity)) {
        disposeAvatarShapeComposition(instance.shapeComposition, instance.modelGroup);
        const shapeComposition = createPointerShapeComposition(
            instance.THREE || globalThis.THREE,
            instance.modelGroup,
            instance.group.userData.object_id,
            resolvedGeometry,
            null,
            instance.trail,
            stats,
        );
        instance.shapeComposition = shapeComposition;
        instance.geometry = shapeComposition.finalGeometry;
        instance.core = shapeComposition.coreMesh;
        instance.edges = shapeComposition.wireframeMesh;
        instance.tesseron = {
            shapeComposition,
            childGeometry: shapeComposition.tesseronChildGeometry,
            childCore: shapeComposition.tesseronChildCoreMesh,
            childEdges: shapeComposition.tesseronChildWireframeMesh,
            links: shapeComposition.innerWireframeMesh,
            linkGeometry: shapeComposition.tesseronLinkGeometry,
        };
        applyCenteredPointerComposition(instance, instance.geometry);
        instance.group.userData.visual_identity = null;
        instance.group.userData.geometry_identity = nextIdentity;
    }
    applyCenteredPointerComposition(instance, instance.geometry);
    instance.group.userData.shape = 'avatar_derived_prism_pointer';
    instance.group.userData.geometry = 'prism';
    instance.group.userData.geometry_type = 93;
    instance.group.userData.geometry_family = 'selection_mode_avatar_prism_pointer';
    instance.group.userData.long_axis = resolvedGeometry.long_axis;
    instance.group.userData.base_screen_quadrant = resolvedGeometry.base_screen_quadrant;
    instance.group.userData.orientation_degrees = resolvedGeometry.orientation_degrees;
    instance.group.userData.spin_axis = resolvedGeometry.spin_axis;
    instance.group.userData.faces_visible = resolvedGeometry.faces_visible;
    instance.group.userData.face_opacity = resolvedGeometry.face_opacity;
    instance.group.userData.edge_opacity = resolvedGeometry.edge_opacity;
    instance.group.userData.tesseron_enabled = resolvedGeometry.tesseron_enabled;
    instance.group.userData.tesseron_proportion = resolvedGeometry.tesseron_proportion;
    instance.group.userData.tesseron_match_mother = resolvedGeometry.tesseron_match_mother;
    if (instance.tesseron?.childEdges) instance.tesseron.childEdges.visible = resolvedGeometry.tesseron_enabled === true;
    if (instance.tesseron?.childCore) instance.tesseron.childCore.visible = resolvedGeometry.tesseron_enabled === true && resolvedGeometry.faces_visible === true && resolvedGeometry.face_opacity > 0;
    if (instance.tesseron?.links) instance.tesseron.links.visible = resolvedGeometry.tesseron_enabled === true;
}

function setInstanceOpacity(instance, alpha, fill = true, geometry = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const resolvedGeometry = normalizePointerGeometry(geometry);
    const coreOpacity = fill && resolvedGeometry.faces_visible === true ? resolvedGeometry.face_opacity : 0;
    const edgeSoftening = fill ? 1 : 0.42;
    if (instance.core) instance.core.visible = resolvedGeometry.faces_visible === true && coreOpacity > 0;
    if (instance.core?.material) instance.core.material.opacity = clamp(alpha * coreOpacity, 0, 1);
    if (instance.edges?.material) instance.edges.material.opacity = clamp(alpha * resolvedGeometry.edge_opacity * edgeSoftening, 0, 1);
    if (instance.tesseron?.childCore) instance.tesseron.childCore.visible = resolvedGeometry.tesseron_enabled === true && resolvedGeometry.faces_visible === true && coreOpacity > 0;
    if (instance.tesseron?.childCore?.material) {
        instance.tesseron.childCore.material.opacity = clamp(alpha * coreOpacity, 0, 1);
    }
    if (instance.tesseron?.childEdges?.material) {
        instance.tesseron.childEdges.material.opacity = clamp(alpha * resolvedGeometry.edge_opacity * edgeSoftening, 0, 1);
    }
    if (instance.tesseron?.links?.material) {
        instance.tesseron.links.material.opacity = clamp(alpha * resolvedGeometry.edge_opacity * edgeSoftening, 0, 1);
    }
    setPointerEffectOpacity(instance.effects?.glow, alpha, fill);
    setPointerEffectOpacity(instance.effects?.core, alpha, fill);
    setPointerEffectOpacity(instance.effects?.rotatingCore, alpha, fill);
    setPointerEffectOpacity(instance.effects?.lightning, alpha, fill);
    setPointerEffectOpacity(instance.effects?.magnetic, alpha, fill);
}

function pointerEffectRadius(geometry = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const resolved = normalizePointerGeometry(geometry);
    return Math.max(0.16, Math.max(resolved.bottom_radius, resolved.top_radius, resolved.height * 0.24));
}

function updatePointerLightningEffect(instance, phase, geometry = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const line = instance.effects?.lightning;
    if (!line?.visible) return;
    const THREE = instance.THREE || globalThis.THREE;
    const radius = pointerEffectRadius(geometry) * (instance.trail ? 0.82 : 1.16);
    const positions = [];
    const boltCount = instance.trail ? 2 : 4;
    for (let i = 0; i < boltCount; i += 1) {
        const angle = phase * 1.7 + i * 2.399;
        const lift = Math.sin(phase * 1.13 + i) * radius * 0.18;
        const start = {
            x: Math.cos(angle) * radius * 0.16,
            y: lift,
            z: Math.sin(angle) * radius * 0.16,
        };
        const mid = {
            x: Math.cos(angle + 0.42) * radius * 0.58,
            y: lift + Math.sin(angle * 1.9) * radius * 0.22,
            z: Math.sin(angle + 0.42) * radius * 0.58,
        };
        const end = {
            x: Math.cos(angle + 0.8) * radius,
            y: lift + Math.cos(angle * 1.3) * radius * 0.28,
            z: Math.sin(angle + 0.8) * radius,
        };
        positions.push(start.x, start.y, start.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, end.x, end.y, end.z);
    }
    setLinePositions(THREE, line, positions);
}

function updatePointerMagneticEffect(instance, phase, geometry = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const line = instance.effects?.magnetic;
    if (!line?.visible) return;
    const THREE = instance.THREE || globalThis.THREE;
    const radius = pointerEffectRadius(geometry) * (instance.trail ? 0.74 : 1.04);
    const positions = [];
    const count = instance.trail ? 3 : 6;
    for (let i = 0; i < count; i += 1) {
        const angle = phase * 0.74 + i * ((Math.PI * 2) / count);
        let prior = {
            x: Math.cos(angle) * radius * 0.28,
            y: Math.sin(angle * 0.7) * radius * 0.12,
            z: Math.sin(angle) * radius * 0.28,
        };
        for (let step = 1; step <= 3; step += 1) {
            const t = step / 3;
            const next = {
                x: Math.cos(angle + t * 0.85) * radius * (0.28 + t * 0.72),
                y: Math.sin(phase + i + t * 1.7) * radius * 0.28,
                z: Math.sin(angle + t * 0.85) * radius * (0.28 + t * 0.72),
            };
            positions.push(prior.x, prior.y, prior.z, next.x, next.y, next.z);
            prior = next;
        }
    }
    setLinePositions(THREE, line, positions);
}

function updatePointerEffectAnimation(instance, phase, geometry = DEFAULT_POINTER_PRISM_GEOMETRY) {
    const core = instance.effects?.rotatingCore;
    if (core?.rotation) {
        core.rotation.x = phase * 0.7;
        core.rotation.y = phase * 1.3;
        core.rotation.z = phase * 0.37;
    }
    updatePointerLightningEffect(instance, phase, geometry);
    updatePointerMagneticEffect(instance, phase, geometry);
}

function applyAvatarSourceToInstance(instance, avatarSource = null, stats = null) {
    if (!instance || !avatarSource) return;
    const nextIdentity = sourceMaterialIdentity(avatarSource);
    if (!sameIdentity(instance.group.userData.material_identity, nextIdentity)) {
        const coreTemplate = avatarSource.primaryMaterialTemplate || avatarSource.primaryMaterial;
        const edgeTemplate = avatarSource.edgeMaterialTemplate || avatarSource.edgeMaterial;
        const nextCore = cloneMaterial(coreTemplate);
        const nextChildCore = cloneMaterial(coreTemplate);
        const nextEdge = cloneMaterial(edgeTemplate);
        const nextChildEdge = cloneMaterial(edgeTemplate);
        const nextLinks = cloneMaterial(edgeTemplate);
        if (nextCore) {
            disposeMaterial(instance.core?.material);
            instance.core.material = nextCore;
            if (stats) stats.materials_created += 1;
        }
        if (nextChildCore && instance.tesseron?.childCore) {
            disposeMaterial(instance.tesseron.childCore.material);
            instance.tesseron.childCore.material = nextChildCore;
            if (stats) stats.materials_created += 1;
        }
        if (nextEdge) {
            disposeMaterial(instance.edges?.material);
            instance.edges.material = nextEdge;
            if (stats) stats.materials_created += 1;
        }
        if (nextChildEdge && instance.tesseron?.childEdges) {
            disposeMaterial(instance.tesseron.childEdges.material);
            instance.tesseron.childEdges.material = nextChildEdge;
            if (stats) stats.materials_created += 1;
        }
        if (nextLinks && instance.tesseron?.links) {
            disposeMaterial(instance.tesseron.links.material);
            instance.tesseron.links.material = nextLinks;
            if (stats) stats.materials_created += 1;
        }
        instance.group.userData.material_identity = nextIdentity;
    }
    const coreTemplate = avatarSource.primaryMaterialTemplate || avatarSource.primaryMaterial;
    const edgeTemplate = avatarSource.edgeMaterialTemplate || avatarSource.edgeMaterial;
    copyMaterial(coreTemplate, instance.core?.material);
    copyMaterial(coreTemplate, instance.tesseron?.childCore?.material);
    copyMaterial(edgeTemplate, instance.edges?.material);
    copyMaterial(edgeTemplate, instance.tesseron?.childEdges?.material);
    copyMaterial(edgeTemplate, instance.tesseron?.links?.material);
    applyAvatarMaterialVisuals(instance, avatarSource);
    applyAvatarEffectsToInstance(instance, avatarSource);
    instance.group.userData.appearance_source = avatarSource.appearanceSource || 'current_live_sigil_avatar';
    instance.group.userData.material_source = avatarSource.materialSource || 'live_avatar_materials';
    instance.group.userData.skin = avatarSource.skin || '';
}

function updateInstance(instance, scenePoint, {
    scale = 1,
    alpha = 1,
    phase = 0,
    fill = true,
    geometry = DEFAULT_POINTER_PRISM_GEOMETRY,
    localOffset = null,
} = {}) {
    if (!instance) return false;
    if (!scenePoint) {
        hideInstance(instance);
        return false;
    }
    const resolvedGeometry = normalizePointerGeometry(geometry);
    const nextScale = Math.max(0.0001, scale);
    applyCenteredPointerComposition(instance, instance.geometry);
    setVector(instance.group.position, translatedScenePointForCenteredComposition(instance.THREE || globalThis.THREE, scenePoint, {
        geometry: resolvedGeometry,
        scale: nextScale,
        localOffset,
    }));
    setScale(instance.group.scale, nextScale);
    setRotationDegrees(instance.group.rotation, resolvedGeometry.orientation_degrees);
    resetRotation(instance.spin.rotation);
    instance.spin.rotation[spinAxisKey(resolvedGeometry.spin_axis)] = phase;
    instance.group.visible = true;
    setInstanceOpacity(instance, alpha, fill, geometry);
    updatePointerEffectAnimation(instance, phase, geometry);
    applyPointerRenderPolicy(instance);
    return true;
}

function hideInstance(instance) {
    if (instance?.group) instance.group.visible = false;
}

function disposeMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach((entry) => disposeMaterial(entry));
        return;
    }
    material?.map?.dispose?.();
    material?.dispose?.();
}

function disposeInstance(instance) {
    if (!instance) return;
    disposeAvatarShapeComposition(instance.shapeComposition, instance.modelGroup);
    visitObjectTree(instance.effects?.group, (object) => {
        object.geometry?.dispose?.();
        disposeMaterial(object.material);
    });
}

function recordTrail(history, cursor = null, time = 0, maxAge = 3) {
    if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
        history.length = 0;
        return;
    }
    const prior = history.at(-1);
    if (!prior || Math.hypot(prior.x - cursor.x, prior.y - cursor.y) >= 1 || time - prior.time >= 0.024) {
        history.push({ x: cursor.x, y: cursor.y, time });
    }
    while (history.length && time - history[0].time > maxAge) history.shift();
}

function trailPointForAge(history = [], ageSeconds = 0, fallback = null) {
    if (!history.length) return fallback;
    const targetTime = history.at(-1).time - ageSeconds;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].time <= targetTime) return history[i];
    }
    return history[0] || fallback;
}

export function createSelectionModeCursorModelRenderer({
    scene = null,
    THREE: THREEImpl = null,
    projectPoint = (point) => point,
    projectRadius = null,
    getAvatarRenderSource = () => null,
} = {}) {
    const THREE = ensureThree(THREEImpl);
    const root = new THREE.Group();
    root.name = CURSOR_MODEL_ROOT_ID;
    root.userData = {
        object_id: CURSOR_MODEL_ROOT_ID,
        parent_object_id: AVATAR_ROOT_OBJECT_ID,
        kind: 'three.object3d',
        source: 'selection_mode',
    };
    let primary = null;
    const trailInstances = [];
    const trailHistory = [];
    const trailGhosts = [];
    let lastGhostScenePoint = null;
    let ghostTimer = 0;
    let lastUpdateTime = null;
    const stats = {
        root_groups_created: 1,
        model_instances_created: 0,
        trail_instances_created: 0,
        effect_groups_created: 0,
        geometries_created: 0,
        materials_created: 0,
        scene_adds: 0,
        update_count: 0,
    };
    let mounted = false;
    let lastSnapshot = {
        mounted: false,
        visible: false,
        model_kind: '',
        trail_count: 0,
        hotspot_aligned: false,
    };

    function mount() {
        if (mounted || !scene?.add) return;
        scene.add(root);
        mounted = true;
        stats.scene_adds += 1;
    }

    function ensurePrimary() {
        mount();
        if (primary) return primary;
        primary = createModelInstance(THREE, {
            objectId: CURSOR_MODEL_OBJECT_ID,
            stats,
            avatarSource: getAvatarRenderSource?.(),
        });
        root.add(primary.group);
        return primary;
    }

    function ensureTrail(index) {
        mount();
        while (trailInstances.length <= index) {
            const item = createModelInstance(THREE, {
                objectId: `${CURSOR_TRAIL_OBJECT_ID}.${trailInstances.length + 1}`,
                trail: true,
                stats,
                avatarSource: getAvatarRenderSource?.(),
            });
            trailInstances.push(item);
            root.add(item.group);
        }
        return trailInstances[index];
    }

    function scenePointFor(point = null) {
        if (!point || point.valid === false) return null;
        const projected = projectPoint(point);
        if (!projected) return null;
        if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
            if (Number.isFinite(projected.z)) return projected;
            return makeVector3(THREE, projected.x, projected.y, 0);
        }
        return null;
    }

    function sceneScaleFor(point = null, pixels = 44) {
        const explicit = Number(projectRadius?.(point, pixels));
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const center = scenePointFor(point);
        const edge = scenePointFor({ ...point, x: finite(point?.x) + pixels });
        if (center && edge && typeof center.distanceTo === 'function') return Math.max(0.0001, center.distanceTo(edge));
        return Math.max(0.0001, pixels / 44);
    }

    function hideAll({ clearTrail = true } = {}) {
        root.visible = false;
        hideInstance(primary);
        for (const item of trailInstances) hideInstance(item);
        if (clearTrail) {
            trailHistory.length = 0;
            trailGhosts.length = 0;
            lastGhostScenePoint = null;
            ghostTimer = 0;
            lastUpdateTime = null;
        }
        lastSnapshot = {
            ...lastSnapshot,
            visible: false,
            trail_count: 0,
            hotspot_aligned: false,
            resource_counts: resourceCounts(),
            object_counts: objectCounts(),
        };
    }

    function objectCounts() {
        return {
            root_children: Array.isArray(root.children) ? root.children.length : 0,
            trail_instances: trailInstances.length,
            visible_trail_instances: trailInstances.filter((item) => item.group?.visible === true).length,
            scene_children: Array.isArray(scene?.children) ? scene.children.length : null,
        };
    }

    function resourceCounts() {
        return { ...stats };
    }

    function plainScenePoint(point = null) {
        if (!point) return null;
        return {
            x: finite(point.x),
            y: finite(point.y),
            z: finite(point.z),
        };
    }

    function scenePointDistance(a = null, b = null) {
        if (!a || !b) return 0;
        return Math.hypot(
            finite(a.x) - finite(b.x),
            finite(a.y) - finite(b.y),
            finite(a.z) - finite(b.z),
        );
    }

    function sceneVectorFromPlain(point = null) {
        if (!point) return null;
        return makeVector3(THREE, point.x, point.y, point.z);
    }

    function spawnTrailGhost(scenePoint, {
        phase,
        scale,
        geometry,
        maxLife,
        mode,
    }) {
        trailGhosts.unshift({
            scenePoint: plainScenePoint(scenePoint),
            phase,
            scale,
            geometry,
            life: maxLife,
            maxLife,
            mode,
        });
        while (trailGhosts.length > MAX_POINTER_TRAIL_INSTANCES) trailGhosts.pop();
    }

    function ghostAlphaForMode(mode, progress) {
        const eased = clamp(progress, 0, 1);
        if (mode === 'hold') return 0.34;
        return Math.max(0.02, eased * 0.42);
    }

    function ghostScaleForMode(mode, progress) {
        const eased = clamp(progress, 0, 1);
        if (mode === 'shrink') return Math.max(0.05, eased);
        if (mode === 'scaleWarp') return 0.72 + ((1 - eased) * 0.42);
        return 1;
    }

    function updateTrailGhosts({
        enabled,
        repeatCount,
        repeatDuration,
        primaryPoint,
        phase,
        baseScale,
        trailScale,
        pointerGeometry,
        avatarSource,
        mode,
        dt,
    }) {
        if (!enabled || repeatCount <= 0 || !primaryPoint) {
            trailGhosts.length = 0;
            lastGhostScenePoint = null;
            for (const item of trailInstances) hideInstance(item);
            return 0;
        }

        const primaryPlain = plainScenePoint(primaryPoint);
        if (!lastGhostScenePoint) lastGhostScenePoint = primaryPlain;
        const moved = scenePointDistance(primaryPlain, lastGhostScenePoint);
        ghostTimer -= dt;
        if (moved > 0.01 && ghostTimer <= 0) {
            spawnTrailGhost(primaryPlain, {
                phase,
                scale: baseScale * Math.max(0.28, trailScale * 0.48),
                geometry: pointerGeometry,
                maxLife: repeatDuration,
                mode,
            });
            ghostTimer = repeatDuration / Math.max(1, repeatCount);
        }
        lastGhostScenePoint = primaryPlain;

        for (let i = trailGhosts.length - 1; i >= 0; i -= 1) {
            const ghost = trailGhosts[i];
            ghost.life -= dt;
            if (ghost.life <= 0) trailGhosts.splice(i, 1);
        }

        const visibleGhosts = trailGhosts.slice(0, repeatCount);
        visibleGhosts.forEach((ghost, index) => {
            const instance = ensureTrail(index);
            applyPointerGeometryToInstance(instance, ghost.geometry || pointerGeometry, stats);
            applyAvatarSourceToInstance(instance, avatarSource, stats);
            const progress = clamp(ghost.life / Math.max(0.0001, ghost.maxLife), 0, 1);
            updateInstance(instance, sceneVectorFromPlain(ghost.scenePoint), {
                scale: ghost.scale * ghostScaleForMode(ghost.mode, progress),
                alpha: ghostAlphaForMode(ghost.mode, progress),
                phase: ghost.phase,
                fill: true,
                geometry: ghost.geometry || pointerGeometry,
            });
            instance.group.userData.trail_ghost = {
                source: 'omega_interdimensional_ghost_semantics',
                mode: ghost.mode,
                progress,
            };
        });
        for (let i = visibleGhosts.length; i < trailInstances.length; i += 1) hideInstance(trailInstances[i]);
        return visibleGhosts.length;
    }

    function update(overlay = null, {
        time = 0,
        nowMs = Date.now(),
    } = {}) {
        stats.update_count += 1;
        const previousUpdateTime = lastUpdateTime;
        lastUpdateTime = finite(time, 0);
        const dt = previousUpdateTime === null
            ? 0
            : clamp(lastUpdateTime - previousUpdateTime, 0, 1);
        const glyph = overlay?.cursorGlyph || null;
        const cursor = overlay?.cursor || null;
        const visible = (overlay?.active === true || overlay?.visible === true)
            && cursor
            && glyph?.model_kind === 'sigil_model';
        if (!visible) {
            hideAll();
            return lastSnapshot;
        }

        const model = ensurePrimary();
        const avatarSource = getAvatarRenderSource?.() || null;
        const pointerGeometry = glyph.geometry || DEFAULT_POINTER_PRISM_GEOMETRY;
        const resolvedPointerGeometry = normalizePointerGeometry(pointerGeometry);
        applyPointerGeometryToInstance(model, pointerGeometry, stats);
        applyAvatarSourceToInstance(model, avatarSource, stats);

        const geometry = glyph.geometry || {};
        const length = Math.max(8, finite(geometry.length, 44));
        const trail = overlay.cursorTrail?.timing || overlay.cursorTrail || {};
        const requestedRepeatCount = clamp(Math.round(finite(trail.repeatCount, 0)), 0, 24);
        const repeatCount = Math.min(requestedRepeatCount, MAX_POINTER_TRAIL_INSTANCES);
        const duration = Math.max(0.05, finite(trail.duration, 0.22));
        const delay = Math.max(0, finite(trail.delay, 0));
        const lag = clamp(finite(trail.lag, 0.05), 0.01, 0.5);
        const repeatDuration = Math.max(duration, finite(trail.repeatDuration, 2));
        const trailScale = Math.max(0.4, finite(trail.scale, 1));
        const interDimensionalTrail = trail.interDimensional !== false;
        const vitality = Math.max(0.1, finite(glyph.animation?.session_vitality_multiplier, 1));
        const rotationSpeed = Math.abs(finite(glyph.animation?.rotation_speed, 0.1));
        const rawRotationStartedAtMs = glyph.animation?.rotation_started_at_ms;
        const rotationStartedAtMs = rawRotationStartedAtMs === null || rawRotationStartedAtMs === undefined
            ? NaN
            : Number(rawRotationStartedAtMs);
        const rotationTime = Number.isFinite(rotationStartedAtMs)
            ? Math.max(0, (Number(nowMs) - rotationStartedAtMs) / 1000)
            : finite(time, 0);
        const phase = rotationTime * rotationSpeed * vitality * Math.PI * 2;
        const primaryPoint = scenePointFor(cursor);
        if (!primaryPoint) {
            hideAll();
            lastSnapshot = {
                ...lastSnapshot,
                mounted,
                model_kind: glyph.model_kind,
                source: glyph.source || '',
                object_id: model.group.userData.object_id,
                hotspot: glyph.hotspot || null,
                scene_position: null,
                blocker_reason: cursor?.valid === false ? 'invalid_cursor' : 'cursor_projection_unavailable',
                resource_counts: resourceCounts(),
                object_counts: objectCounts(),
            };
            return lastSnapshot;
        }
        root.visible = true;
        const baseScale = sceneScaleFor(cursor, length);

        const mode = String(trail.trailMode || 'fade');
        const visibleTrailCount = updateTrailGhosts({
            enabled: interDimensionalTrail,
            repeatCount,
            repeatDuration,
            primaryPoint,
            phase,
            baseScale,
            trailScale,
            pointerGeometry,
            avatarSource,
            mode,
            dt: dt || 0.016,
        });

        const hotspotAligned = updateInstance(model, primaryPoint, {
            scale: baseScale * Math.max(0.42, trailScale * 0.62),
            alpha: 0.96,
            phase,
            fill: true,
            geometry: pointerGeometry,
        });
        lastSnapshot = {
            mounted,
            visible: root.visible === true,
            model_kind: glyph.model_kind,
            source: glyph.source || '',
            appearance_source: model.group.userData.appearance_source || '',
            material_source: model.group.userData.material_source || '',
            shape: model.group.userData.shape || '',
            geometry: model.group.userData.geometry || '',
            geometry_type: model.group.userData.geometry_type || null,
            geometry_family: model.group.userData.geometry_family || '',
            long_axis: model.group.userData.long_axis || '',
            orientation_degrees: model.group.userData.orientation_degrees || null,
            spin_axis: model.group.userData.spin_axis || '',
            cursor_overrides: model.group.userData.cursor_overrides || [],
            object_id: model.group.userData.object_id,
            hotspot: glyph.hotspot || null,
            hotspot_aligned: hotspotAligned,
            effects_source: model.group.userData.effects_source || '',
            pointer_effects: model.group.userData.pointer_effects || null,
            effect_families: model.group.userData.effect_families || [],
            resolved_visual: model.group.userData.resolved_visual || null,
            scene_position: primaryPoint
                ? { x: finite(primaryPoint.x), y: finite(primaryPoint.y), z: finite(primaryPoint.z) }
                : null,
            trail_count: visibleTrailCount,
            requested_trail_count: requestedRepeatCount,
            trail_policy: {
                source: 'selection_mode_pointer_omega_interdimensional_ghost_policy',
                max_visible_instances: MAX_POINTER_TRAIL_INSTANCES,
                opacity: 'subtle_avatar_derived_ghost',
                mode,
            },
            resource_counts: resourceCounts(),
            object_counts: objectCounts(),
        };
        return lastSnapshot;
    }

    function destroy() {
        if (scene?.remove) scene.remove(root);
        disposeInstance(primary);
        for (const item of trailInstances) disposeInstance(item);
        trailInstances.length = 0;
        trailHistory.length = 0;
        trailGhosts.length = 0;
        lastGhostScenePoint = null;
        ghostTimer = 0;
        lastUpdateTime = null;
        primary = null;
        mounted = false;
        lastSnapshot = {
            mounted: false,
            visible: false,
            model_kind: '',
            trail_count: 0,
            hotspot_aligned: false,
        };
    }

    return {
        update,
        destroy,
        snapshot: () => ({
            ...lastSnapshot,
            resource_counts: resourceCounts(),
            object_counts: objectCounts(),
        }),
        get root() {
            return root;
        },
    };
}
