import { radialItemPointerMetrics } from './radial-gesture-runtime.js';
import { currentSigilRoot } from './content-roots.js';
import {
    resolveSigilRadialItemEffectRefs,
    resolveSigilRadialItemModule,
} from '../radial-menu/item-registry.js';
import { addEdges, material } from '../radial-menu/item-helpers.js';
import * as wikiBrainEffects from '../radial-menu/items/wiki-brain-effects.js';
import {
    DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM,
    DEFAULT_NESTED_TREE_EFFECT,
    radialItemParts,
    resolveRadialItemModelTransform,
    resolveRadialItemModelVisibility,
    resolveRadialItemPartTransform,
    resolveRadialItemPartVisibility,
    resolveNestedFiberBloomTransform,
    resolveNestedFiberOpticsTransform,
    resolveNestedFiberPulse,
    resolveNestedFiberStemTransform,
    resolveNestedFractalPulse,
    resolveNestedFractalTreeTransform,
    resolveNestedShellTransform,
    resolveNestedTreeTransform,
    resolveNestedVisibility,
    vectorAngles,
    vectorValue,
} from './radial-object-control.js';

export {
    DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM,
    DEFAULT_NESTED_TREE_EFFECT,
    radialItemParts,
    resolveRadialItemModelTransform,
    resolveRadialItemModelVisibility,
    resolveRadialItemPartTransform,
    resolveRadialItemPartVisibility,
    resolveNestedFiberBloomTransform,
    resolveNestedFiberOpticsTransform,
    resolveNestedFiberPulse,
    resolveNestedFiberStemTransform,
    resolveNestedFractalPulse,
    resolveNestedFractalTreeTransform,
    resolveNestedShellTransform,
    resolveNestedTreeTransform,
} from './radial-object-control.js';

export function radialGlyphActivationState({ visualRadial, activeRadial, source, item } = {}) {
    const metrics = visualRadial ? radialItemPointerMetrics(visualRadial, item) : null;
    const selected = !!(activeRadial && item?.id === source?.activeItemId);
    const directHover = metrics?.relation === 'inside';
    return {
        active: selected || directHover,
        selected,
        directHover,
        relation: metrics?.relation || null,
    };
}

export const DEFAULT_RADIAL_ITEM_MOTION = {
    modelHoverSpinSpeed: 1.45,
    shapeHoverSpinSpeed: 1.1,
};

function objectValue(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function resolveRadialItemMotion(item = {}, { nativeGeometry = false, itemMotion = {} } = {}) {
    const menuMotion = objectValue(itemMotion);
    const localMotion = objectValue(item.geometry?.itemMotion ?? item.itemMotion);
    const baseSpeed = nativeGeometry
        ? finite(menuMotion.modelHoverSpinSpeed, DEFAULT_RADIAL_ITEM_MOTION.modelHoverSpinSpeed)
        : finite(menuMotion.shapeHoverSpinSpeed, DEFAULT_RADIAL_ITEM_MOTION.shapeHoverSpinSpeed);
    const localSpeed = nativeGeometry ? localMotion.modelHoverSpinSpeed : localMotion.shapeHoverSpinSpeed;
    const value = item.geometry?.hoverSpinSpeed
        ?? item.hoverSpinSpeed
        ?? localMotion.hoverSpinSpeed
        ?? localSpeed
        ?? baseSpeed;
    return {
        hoverSpinSpeed: Math.max(0, finite(value, baseSpeed)),
    };
}

export function resolveRadialHoverSpinSpeed(item = {}, options = {}) {
    return resolveRadialItemMotion(item, options).hoverSpinSpeed;
}

export function resolveRadialHoverConfig(item = {}) {
    return item?.three?.item?.hover || {};
}

export function resolveRadialHoverProgressFactor(item = {}) {
    return Math.max(0, finite(resolveRadialHoverConfig(item).progress?.factor, 0.22));
}

export function resolveRadialHoverScale(item = {}) {
    const scale = resolveRadialHoverConfig(item).transform?.scale || {};
    return {
        from: finite(scale.from, 1),
        to: finite(scale.to, 1.08),
    };
}

export function resolveRadialHoverSpin(item = {}, options = {}) {
    const spin = resolveRadialHoverConfig(item).transform?.rotate?.spin;
    if (spin === false) return { axis: 'none', rate: 0 };
    const fallbackRate = resolveRadialHoverSpinSpeed(item, options);
    return {
        axis: String(spin?.axis || 'y').toLowerCase(),
        rate: Math.max(0, finite(spin?.rate, fallbackRate)),
    };
}

export function resolveRadialHoverRotationDegrees(item = {}) {
    const degrees = resolveRadialHoverConfig(item).transform?.rotate?.degrees || {};
    return {
        x: finite(degrees.x, 0.12),
        y: finite(degrees.y, 0),
        z: finite(degrees.z, 0.055),
    };
}

export function resolveRadialItemFacesCamera(item = {}) {
    if (item.geometry?.faceCamera === true) return true;
    const value = String(
        item.three?.item?.facing
        ?? item.three?.item?.orientation?.facing
        ?? item.geometry?.facing
        ?? ''
    ).toLowerCase();
    return ['camera', 'camera-facing', 'screen', 'screen-facing', 'billboard', 'face-camera'].includes(value);
}

function applyObjectTransform(object, transform = {}, defaults = {}) {
    if (!object) return;
    const position = vectorValue(transform.position, defaults.position);
    const scale = vectorValue(transform.scale, defaults.scale);
    const rotation = vectorAngles(transform.rotationDegrees ?? transform.rotation, defaults.rotationDegrees);
    object.position.set(position.x, position.y, position.z);
    object.scale.set(scale.x, scale.y, scale.z);
    object.rotation.set(
        rotation.x * Math.PI / 180,
        rotation.y * Math.PI / 180,
        rotation.z * Math.PI / 180
    );
}

function applyNestedFiberStemTransform(stem, transform = {}) {
    applyObjectTransform(stem, transform, DEFAULT_NESTED_TREE_EFFECT.fiberStemTransform);
}

function applyNestedFiberBloomTransform(bloom, transform = {}) {
    applyObjectTransform(bloom, transform, DEFAULT_NESTED_TREE_EFFECT.fiberBloomTransform);
}

function applyNestedFractalTreeTransform(tree, transform = {}) {
    applyObjectTransform(tree, transform, DEFAULT_NESTED_TREE_EFFECT.fractalTreeTransform);
}

function applyNestedShellTransform(shell, transform = {}) {
    applyObjectTransform(shell, transform, DEFAULT_NESTED_TREE_EFFECT.shellTransform);
}

function createLoadingGlyph() {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.18, 0),
        material('#62f2ff', 0.32)
    );
    group.add(shell);
    addEdges(group, shell, '#d8fbff', 0.42);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), material('#c5faff', 0.58));
    group.add(core);
    return group;
}

function createFallbackGlyph() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), material('#b8d8ff', 0.72));
    group.add(mesh);
    addEdges(group, mesh, '#ffffff', 0.45);
    return group;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}


function geometryKind(item = {}) {
    return typeof item.geometry?.type === 'string' ? item.geometry.type.toLowerCase() : null;
}

function resolveGeometryUrl(src) {
    if (typeof src !== 'string' || !src.trim()) return null;
    const trimmed = src.trim();
    if (
        trimmed.startsWith('aos://sigil/')
        && typeof location !== 'undefined'
        && /^https?:$/.test(location.protocol)
    ) {
        return trimmed.replace(/^aos:\/\/sigil\//, `/${currentSigilRoot()}/`);
    }
    try {
        return new URL(trimmed, import.meta.url).href;
    } catch (_) {
        return trimmed;
    }
}

function disposeChildren(group) {
    for (const child of [...group.children]) {
        group.remove(child);
        disposeObject(child);
    }
}

function installFallbackGlyph(group, item, status, error = null) {
    const host = group.userData.modelHost || group;
    disposeChildren(host);
    const fallback = createFallbackGlyph();
    host.add(fallback);
    group.userData.baseRadius = glyphSceneRadius(fallback);
    group.userData.geometryStatus = status;
    group.userData.geometryError = error;
}

export function normalizeModelScene(object, targetRadius = 0.28) {
    const box = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return targetRadius;
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    if (!Number.isFinite(radius) || radius <= 0) return targetRadius;
    object.scale.multiplyScalar(targetRadius / radius);
    object.updateMatrixWorld?.(true);

    const scaledBox = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(scaledBox.min.x) || !Number.isFinite(scaledBox.max.x)) return targetRadius;
    const scaledCenter = new THREE.Vector3();
    scaledBox.getCenter(scaledCenter);
    object.position.sub(scaledCenter);
    return targetRadius;
}

function objectSceneSize(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    return {
        x: size.x,
        y: size.y,
        z: size.z,
    };
}

function applyGeometryOrientation(object, geometry = {}) {
    const rotationDegrees = geometry.rotationDegrees ?? geometry.rotation;
    if (!rotationDegrees) return;
    const rotation = vectorAngles(rotationDegrees);
    object.rotation.x += rotation.x * Math.PI / 180;
    object.rotation.y += rotation.y * Math.PI / 180;
    object.rotation.z += rotation.z * Math.PI / 180;
    object.updateMatrixWorld(true);
}

function applySigilHologramMaterial(object) {
    const hologram = new THREE.MeshPhongMaterial({
        color: new THREE.Color('#62f2ff'),
        emissive: new THREE.Color('#123a66'),
        transparent: true,
        opacity: 0.66,
        shininess: 80,
        specular: new THREE.Color('#c8f8ff'),
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    object.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry && !child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals?.();
        }
        child.material = hologram;
    });
}

function cloneColor(value, fallback) {
    if (value?.isColor) return value.clone();
    return new THREE.Color(fallback);
}

function applySourceEmissiveMaterial(object, options = {}) {
    object.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry && !child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals?.();
        }
        const source = Array.isArray(child.material) ? child.material[0] : child.material;
        const color = cloneColor(source?.emissive, options.color || source?.color || '#53f4ff');
        if (color.r + color.g + color.b < 0.05) {
            color.set(options.color || '#53f4ff');
        }
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: finite(options.opacity, 0.94),
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        child.material = material;
    });
}

function applyTranslucentBrainShellMaterial(object, options = {}) {
    const shell = new THREE.MeshPhongMaterial({
        color: new THREE.Color(options.color || '#58b9ca'),
        emissive: new THREE.Color(options.emissive || '#041820'),
        specular: new THREE.Color(options.specular || '#9fefff'),
        shininess: finite(options.shininess, 72),
        transparent: true,
        opacity: finite(options.opacity, 0.75),
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
    });
    shell.userData.radialManagedOpacity = true;
    shell.userData.baseOpacity = shell.opacity;
    shell.userData.radialShell = true;
    const meshes = [];
    object.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry && !child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals?.();
        }
        child.material = shell;
        child.renderOrder = 20;
        meshes.push(child);
    });

    for (const mesh of meshes) {
        if (!mesh.geometry) continue;
        const rim = new THREE.Mesh(
            mesh.geometry,
            new THREE.MeshBasicMaterial({
                color: new THREE.Color(options.rimColor || '#8fefff'),
                transparent: true,
                opacity: finite(options.rimOpacity, 0.08),
                side: THREE.BackSide,
                depthWrite: false,
                depthTest: true,
            })
        );
        rim.name = `${mesh.name || 'brain'}-glass-rim`;
        rim.scale.setScalar(finite(options.rimScale, 1.045));
        rim.renderOrder = 21;
        rim.material.userData.radialShellRim = true;
        rim.material.userData.radialShellMinOpacity = finite(options.rimOpacity, 0.08);
        rim.material.userData.radialShellOpacityScale = finite(options.rimOpacityScale, 0.18);
        mesh.add(rim);

        const wire = new THREE.Mesh(
            mesh.geometry,
            new THREE.MeshBasicMaterial({
                color: new THREE.Color(options.wireColor || '#c8ffff'),
                transparent: true,
                opacity: finite(options.wireOpacity, 0.035),
                wireframe: true,
                depthWrite: false,
                depthTest: true,
            })
        );
        wire.name = `${mesh.name || 'brain'}-glass-highlights`;
        wire.scale.setScalar(finite(options.wireScale, 1.012));
        wire.renderOrder = 24;
        wire.material.userData.radialShellRim = true;
        wire.material.userData.radialShellMinOpacity = finite(options.wireOpacity, 0.035);
        wire.material.userData.radialShellOpacityScale = finite(options.wireOpacityScale, 0.08);
        mesh.add(wire);

        if (typeof THREE.EdgesGeometry === 'function' && typeof THREE.LineSegments === 'function') {
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(mesh.geometry, finite(options.edgeThresholdAngle, 10)),
                new THREE.LineBasicMaterial({
                    color: new THREE.Color(options.edgeColor || '#c8ffff'),
                    transparent: true,
                    opacity: finite(options.edgeOpacity, 0.045),
                    depthWrite: false,
                    depthTest: true,
                })
            );
            edges.name = `${mesh.name || 'brain'}-glass-contours`;
            edges.scale.setScalar(finite(options.edgeScale, 1.035));
            edges.renderOrder = 25;
            edges.material.userData.radialShellRim = true;
            edges.material.userData.radialShellMinOpacity = finite(options.edgeOpacity, 0.045);
            edges.material.userData.radialShellOpacityScale = finite(options.edgeOpacityScale, 0.1);
            mesh.add(edges);
        }
    }
}

function applyHiddenGeometryMaterials(object, materialNames = []) {
    const names = new Set((Array.isArray(materialNames) ? materialNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean));
    if (names.size === 0) return;
    object.traverse((child) => {
        if (!child.isMesh) return;
        forEachMaterial(child.material, (mat) => {
            if (!names.has(mat.name)) return;
            mat.transparent = true;
            mat.opacity = 0;
            mat.depthWrite = false;
            mat.needsUpdate = true;
        });
    });
}

function applyGeometryMaterial(object, geometry = {}) {
    applyHiddenGeometryMaterials(object, geometry.hiddenMaterials);
    if (geometry.material === 'source-emissive') {
        applySourceEmissiveMaterial(object, geometry.materialOptions || {});
        return;
    }
    if (geometry.material === 'translucent-brain-shell') {
        applyTranslucentBrainShellMaterial(object, geometry.materialOptions || {});
        return;
    }
    if (geometry.material === 'sigil-hologram') {
        applySigilHologramMaterial(object);
    }
}

function createTerminalScreenTexture(options = {}) {
    if (typeof document === 'undefined' || typeof THREE.CanvasTexture !== 'function') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const accent = options.accent || '#68f7ff';
    const dim = options.dim || 'rgba(104, 247, 255, 0.42)';
    const dark = options.color || '#071318';
    const glow = options.glow || 'rgba(104, 247, 255, 0.22)';
    const title = String(options.title || 'AGENT TERM').slice(0, 18);
    const lines = (Array.isArray(options.lines) ? options.lines : [])
        .map((line) => String(line || '').slice(0, 28))
        .filter(Boolean)
        .slice(0, 5);
    const terminalLines = lines.length > 0 ? lines : [
        '> attach provider',
        '> route session',
        '> resume stream',
        '> surface ready',
    ];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bg.addColorStop(0, '#031014');
    bg.addColorStop(0.52, dark);
    bg.addColorStop(1, '#020608');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = glow;
    ctx.lineWidth = 2;
    for (let x = 28; x < canvas.width; x += 46) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 30, canvas.height);
        ctx.stroke();
    }
    for (let y = 24; y < canvas.height; y += 38) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y + 16);
        ctx.stroke();
    }

    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
    ctx.strokeStyle = dim;
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

    ctx.fillStyle = accent;
    ctx.font = '700 32px Menlo, Monaco, monospace';
    ctx.fillText(title, 48, 72);
    ctx.font = '600 18px Menlo, Monaco, monospace';
    ctx.fillStyle = 'rgba(210, 255, 255, 0.88)';
    terminalLines.forEach((line, index) => ctx.fillText(line, 52, 126 + (index * 30)));

    ctx.fillStyle = 'rgba(104, 247, 255, 0.78)';
    for (let i = 0; i < 7; i += 1) {
        ctx.fillRect(330 + (i * 18), 120, 8, 72 - (i % 3) * 14);
    }
    ctx.beginPath();
    ctx.arc(426, 216, 38, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(426, 216, 22, -0.6, Math.PI * 1.24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.RepeatWrapping !== undefined) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = -1;
        texture.offset.x = 1;
    }
    texture.needsUpdate = true;
    return texture;
}

function createRadialItemPartMaterial(part = {}) {
    const material = part.material || {};
    if (material.kind === 'terminal-screen') {
        const texture = createTerminalScreenTexture(material);
        return new THREE.MeshBasicMaterial({
            map: texture || null,
            color: texture ? new THREE.Color('#ffffff') : new THREE.Color(material.accent || '#68f7ff'),
            transparent: true,
            opacity: finite(material.opacity, 0.94),
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }
    return new THREE.MeshPhongMaterial({
        color: new THREE.Color(material.color || '#071318'),
        emissive: new THREE.Color(material.emissive || '#28f6ff'),
        transparent: true,
        opacity: finite(material.opacity, 0.74),
        side: THREE.DoubleSide,
        depthWrite: false,
    });
}

function createRadialItemPartMesh(part = {}) {
    if (part.kind !== 'plane') return null;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        createRadialItemPartMaterial(part)
    );
    mesh.name = part.name || part.label || part.id || 'radial-item-part';
    mesh.renderOrder = 32;
    return mesh;
}

function createRadialItemPartHosts(item = {}) {
    const hosts = new Map();
    for (const part of radialItemParts(item)) {
        const object = createRadialItemPartMesh(part);
        if (!object) continue;
        object.userData.radialItemPartId = part.id;
        object.userData.radialItemPartMaterialSignature = JSON.stringify(part.material || {});
        hosts.set(part.id, object);
    }
    return hosts;
}

function radialEffectHelpers() {
    return {
        DEFAULT_NESTED_TREE_EFFECT,
        DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM,
        applyNestedFiberBloomTransform,
        applyNestedFiberStemTransform,
        applyNestedFractalTreeTransform,
        applyNestedShellTransform,
        applyObjectTransform,
        createFractalTree: wikiBrainEffects.createFractalTree,
        createFiberTree: wikiBrainEffects.createFiberTree,
        updateFractalTree: wikiBrainEffects.updateFractalTree,
        updateFiberTree: wikiBrainEffects.updateFiberTree,
        radialItemPointerMetrics,
        resolveNestedFiberBloomTransform,
        resolveNestedFiberOpticsTransform,
        resolveNestedFiberPulse,
        resolveNestedFiberStemTransform,
        resolveNestedFractalPulse,
        resolveNestedFractalTreeTransform,
        resolveNestedShellTransform,
        resolveNestedVisibility,
        resolveRadialItemModelTransform,
        resolveRadialItemModelVisibility,
    };
}

function syncRadialItemPartConfig(glyph, item = {}) {
    if (!glyph?.userData?.radialItemPartHosts) return;
    const parts = new Map(radialItemParts(item).map((part) => [part.id, part]));
    for (const [partId, object] of glyph.userData.radialItemPartHosts) {
        const part = parts.get(partId);
        if (!part) {
            object.visible = false;
            continue;
        }
        const materialSignature = JSON.stringify(part.material || {});
        if (object.userData.radialItemPartMaterialSignature !== materialSignature) {
            disposeMaterial(object.material);
            object.material = createRadialItemPartMaterial(part);
            object.userData.radialItemPartMaterialSignature = materialSignature;
        }
        applyObjectTransform(object, resolveRadialItemPartTransform(part), DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
        object.visible = resolveRadialItemPartVisibility(part);
    }
}

function createRadialEffectHost(group, item = {}) {
    const modelHost = new THREE.Group();
    modelHost.name = `${item.id || 'radial-item'}-model-host`;
    group.userData.modelHost = modelHost;
    group.userData.radialItemModelTransform = resolveRadialItemModelTransform(item);
    group.userData.radialItemModelVisible = resolveRadialItemModelVisibility(item);

    const moduleDef = resolveSigilRadialItemModule(item);
    const moduleModelHost = moduleDef?.createEffectHost?.(group, item, radialEffectHelpers());
    if (moduleModelHost) return moduleModelHost;

    if (!moduleDef?.createEffectHost) {
        applyObjectTransform(modelHost, group.userData.radialItemModelTransform, DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
        modelHost.visible = group.userData.radialItemModelVisible;
        group.add(modelHost);
        const partHosts = createRadialItemPartHosts(item);
        group.userData.radialItemPartHosts = partHosts;
        for (const object of partHosts.values()) group.add(object);
        syncRadialItemPartConfig(group, item);
        return modelHost;
    }
    return modelHost;
}

function syncRadialEffectConfig(glyph, item = {}) {
    if (!glyph?.userData?.radialEffectTree) return;
    const moduleDef = resolveSigilRadialItemModule(item);
    moduleDef?.syncEffectConfig?.(glyph, item, radialEffectHelpers());
}

function syncRadialItemModelConfig(glyph, item = {}) {
    if (!glyph?.userData?.modelHost || glyph.userData.radialEffectTree) return;
    glyph.userData.radialItemModelTransform = resolveRadialItemModelTransform(item);
    glyph.userData.radialItemModelVisible = resolveRadialItemModelVisibility(item);
    syncRadialItemPartConfig(glyph, item);
}

function applyRadialItemModelConfig(glyph) {
    if (!glyph?.userData?.modelHost || glyph.userData.radialEffectTree) return;
    applyObjectTransform(
        glyph.userData.modelHost,
        glyph.userData.radialItemModelTransform,
        DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM
    );
    glyph.userData.modelHost.visible = glyph.userData.radialItemModelVisible !== false;
}

function createGltfGlyph(item = {}) {
    const group = new THREE.Group();
    const modelHost = createRadialEffectHost(group, item);
    const placeholder = createLoadingGlyph();
    modelHost.add(placeholder);
    group.userData.baseRadius = glyphSceneRadius(placeholder);
    group.userData.geometryKind = geometryKind(item);
    group.userData.geometryStatus = 'loading';
    group.userData.geometryTitle = item.geometry?.title || item.label || item.id || 'model';

    const url = resolveGeometryUrl(item.geometry?.src);
    group.userData.geometryUrl = url;
    if (!url) {
        installFallbackGlyph(group, item, 'missing-src');
        return group;
    }
    if (typeof THREE.GLTFLoader !== 'function') {
        installFallbackGlyph(group, item, 'loader-unavailable');
        return group;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(
        url,
        (gltf) => {
            if (group.userData.disposed) return;
            const model = gltf.scene || gltf.scenes?.[0];
            if (!model) {
                installFallbackGlyph(group, item, 'empty');
                return;
            }
            applyGeometryOrientation(model, item.geometry);
            applyGeometryMaterial(model, item.geometry);
            const targetRadius = finite(item.geometry?.normalizedRadius, 0.28);
            group.userData.baseRadius = normalizeModelScene(model, targetRadius);
            group.userData.geometrySize = objectSceneSize(model);
            disposeChildren(modelHost);
            modelHost.add(model);
            group.userData.geometryStatus = 'ready';
        },
        undefined,
        (error) => {
            if (group.userData.disposed) return;
            installFallbackGlyph(group, item, 'error', error?.message || String(error));
            console.warn('[sigil] radial glTF geometry failed:', url, error);
        }
    );

    return group;
}

function createGlyph(item = {}) {
    const moduleDef = resolveSigilRadialItemModule(item);
    const kind = geometryKind(item);
    if (kind === 'gltf' || kind === 'glb') {
        const glyph = createGltfGlyph(item);
        glyph.userData.itemModuleRef = moduleDef?.ref || item.geometry?.module_ref || null;
        return glyph;
    }
    if (typeof moduleDef?.createGlyph === 'function') {
        const glyph = moduleDef.createGlyph({ item, THREE });
        if (glyph) {
            glyph.userData.itemModuleRef = moduleDef.ref || item.geometry?.module_ref || null;
            return glyph;
        }
    }
    return createFallbackGlyph();
}

function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_RADIAL_OPEN_ANIMATION_MS = 333;

function easeRadialOpenProgress(progress, easing = 'easeOutCubic') {
    const t = clamp01(progress);
    switch (String(easing || '').toLowerCase()) {
        case 'linear':
            return t;
        case 'easeoutcubic':
        case 'ease-out-cubic':
        default:
            return 1 - Math.pow(1 - t, 3);
    }
}

export function radialOpenExpansionState(radial = {}, { time = 0 } = {}) {
    const animation = radial?.openAnimation;
    if (!animation) {
        return { active: false, progress: null, rawProgress: null };
    }
    const durationMs = Math.max(0, finite(animation.durationMs ?? animation.duration_ms, DEFAULT_RADIAL_OPEN_ANIMATION_MS));
    const durationSeconds = durationMs / 1000;
    const startedAt = finite(animation.startedAt ?? animation.started_at, time);
    const rawProgress = durationSeconds <= 0
        ? 1
        : clamp01((finite(time, startedAt) - startedAt) / durationSeconds);
    return {
        active: rawProgress < 1,
        progress: easeRadialOpenProgress(rawProgress, animation.easing),
        rawProgress,
        durationMs,
    };
}

export function radialDismissExpansionState(radial = {}, { time = 0 } = {}) {
    const animation = radial?.dismissAnimation || radial?.openAnimation;
    if (!animation) {
        return { active: false, progress: null, rawProgress: null };
    }
    const durationMs = Math.max(0, finite(animation.durationMs ?? animation.duration_ms, DEFAULT_RADIAL_OPEN_ANIMATION_MS));
    const durationSeconds = durationMs / 1000;
    const startedAt = finite(animation.startedAt ?? animation.started_at, time);
    const rawProgress = durationSeconds <= 0
        ? 1
        : clamp01((finite(time, startedAt) - startedAt) / durationSeconds);
    return {
        active: rawProgress < 1,
        progress: easeRadialOpenProgress(1 - rawProgress, animation.easing),
        rawProgress,
        durationMs,
    };
}

export function radialItemExpansionCenter(radial = {}, item = {}, progress = 1) {
    const origin = radial?.origin;
    const center = item?.center;
    if (!origin || !center || progress >= 0.999) return center || null;
    const t = clamp01(progress);
    return {
        x: finite(origin.x, 0) + ((finite(center.x, 0) - finite(origin.x, 0)) * t),
        y: finite(origin.y, 0) + ((finite(center.y, 0) - finite(origin.y, 0)) * t),
    };
}

function glyphSceneRadius(glyph) {
    const box = new THREE.Box3().setFromObject(glyph);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    return Number.isFinite(radius) && radius > 0 ? radius : 0.25;
}

function disposeMaterial(material) {
    forEachMaterial(material, (mat) => {
        mat.map?.dispose?.();
        mat.dispose?.();
    });
}

function disposeObject(object) {
    object.traverse((child) => {
        child.geometry?.dispose?.();
        disposeMaterial(child.material);
    });
}

function forEachMaterial(material, visit) {
    if (Array.isArray(material)) {
        material.forEach((mat) => mat && visit(mat));
    } else if (material) {
        visit(material);
    }
}

let highlightColor = null;

function getHighlightColor() {
    if (!highlightColor) highlightColor = new THREE.Color('#ffffff');
    return highlightColor;
}

function updateMaterialHighlight(material, { active, progress }) {
    forEachMaterial(material, (mat) => {
        const baseOpacity = Number(mat.userData?.baseOpacity ?? mat.opacity ?? 1);
        mat.userData.baseOpacity = baseOpacity;
        if (!mat.userData.radialManagedOpacity) {
            mat.opacity = baseOpacity * Math.min(1, progress * (active ? 1.5 : 1.2));
        }

        if (mat.color?.isColor) {
            if (!mat.userData.baseColor) mat.userData.baseColor = mat.color.clone();
            mat.color.copy(mat.userData.baseColor).lerp(getHighlightColor(), active ? 0.2 : 0);
        }
        if (mat.emissive?.isColor) {
            if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.clone();
            mat.emissive.copy(mat.userData.baseEmissive).lerp(getHighlightColor(), active ? 0.16 : 0);
        }
    });
}

function activationDisplayForItem(activationTransition, itemId) {
    if (!activationTransition?.item_id) return null;
    const active = activationTransition.item_id === itemId;
    if (active) {
        return {
            active,
            opacity: finite(activationTransition.item?.opacity, 1),
            focusMode: activationTransition.item?.focus?.mode || null,
            eased: finite(activationTransition.item?.eased, activationTransition.eased),
        };
    }
    return {
        active,
        opacity: finite(activationTransition.menu?.opacity, 1),
        focusMode: null,
        eased: finite(activationTransition.menu?.eased, activationTransition.eased),
    };
}

function applyGlyphDisplayOpacity(glyph, opacity = 1) {
    const multiplier = clamp01(opacity);
    if (multiplier >= 0.999) return;
    glyph.traverse((child) => {
        forEachMaterial(child.material, (mat) => {
            if (typeof mat.opacity !== 'number') return;
            mat.transparent = true;
            mat.opacity *= multiplier;
        });
    });
}


export function createSigilRadialGestureVisuals({ scene, projectPoint, projectRadius, itemMotion = {} } = {}) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 20;
    scene.add(group);
    const glyphs = new Map();
    let lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    let lastRadial = null;
    let displayProgress = 0;
    let lastUpdateTime = null;

    function resolveItemMotion(source = {}) {
        return {
            ...objectValue(itemMotion),
            ...objectValue(source?.visuals?.itemMotion ?? source?.itemMotion),
        };
    }

    function ensureGlyph(item) {
        const id = item.id || 'item';
        let glyph = glyphs.get(id);
        if (glyph) return glyph;
        glyph = createGlyph(item);
        glyph.userData.itemId = id;
        if (!glyph.userData.geometryKind) {
            glyph.userData.baseRadius = glyphSceneRadius(glyph);
        }
        glyph.userData.hoverProgress = 0;
        glyph.userData.hoverSpin = 0;
        glyphs.set(id, glyph);
        group.add(glyph);
        return glyph;
    }

    function removeMissing(items) {
        const ids = new Set(items.map((item) => item.id || 'item'));
        for (const [id, glyph] of glyphs.entries()) {
            if (ids.has(id)) continue;
            group.remove(glyph);
            glyph.userData.disposed = true;
            disposeObject(glyph);
            glyphs.delete(id);
        }
    }

    function update(radial, { time = 0, activationTransition = null } = {}) {
        const dt = lastUpdateTime == null ? 1 / 60 : Math.min(0.08, Math.max(0, time - lastUpdateTime));
        lastUpdateTime = time;
        const transitionRadial = activationTransition?.radial || null;
        const radialSource = transitionRadial || radial;
        const visualRadial = radialSource?.phase === 'radial'
            || radialSource?.phase === 'fastTravel'
            || radialSource?.phase === 'closing'
            ? radialSource
            : null;
        const activeRadial = radial?.phase === 'radial' ? radial : null;
        if (visualRadial) lastRadial = visualRadial;
        const source = visualRadial || lastRadial;
        const openExpansion = visualRadial ? radialOpenExpansionState(visualRadial, { time }) : { progress: null };
        const dismissExpansion = visualRadial?.phase === 'closing'
            ? radialDismissExpansionState(visualRadial, { time })
            : { progress: null };
        const openExpansionProgress = openExpansion.progress == null
            ? null
            : Number(openExpansion.progress);
        const dismissExpansionProgress = dismissExpansion.progress == null
            ? null
            : Number(dismissExpansion.progress);
        const animatedProgress = dismissExpansionProgress ?? openExpansionProgress;
        const targetProgress = visualRadial
            ? animatedProgress ?? (Number(visualRadial.menuProgress) || 0)
            : 0;
        if (animatedProgress != null) {
            displayProgress = targetProgress;
        } else {
            const smoothing = visualRadial ? 0.42 : 0.28;
            displayProgress += (targetProgress - displayProgress) * smoothing;
        }

        if (!source || displayProgress <= 0.015) {
            group.visible = false;
            displayProgress = 0;
            if (!visualRadial || visualRadial.phase === 'closing') lastRadial = null;
            lastState = { visible: false, count: 0, itemIds: [], scales: {} };
            return lastState;
        }

        const items = Array.isArray(source.items) ? source.items : [];
        removeMissing(items);
        group.visible = true;
        const progress = displayProgress;
        const scales = {};
        const geometry = {};
        const effects = {};
        const sourceItemMotion = resolveItemMotion(source);

        for (const item of items) {
            const glyph = ensureGlyph(item);
            syncRadialItemModelConfig(glyph, item);
            syncRadialEffectConfig(glyph, item);
            const expandedCenter = radialItemExpansionCenter(source, item, animatedProgress ?? 1);
            const projected = projectPoint?.(expandedCenter);
            glyph.visible = !!projected;
            if (!projected) continue;
            const activation = radialGlyphActivationState({ visualRadial, activeRadial, source, item });
            const active = activation.active;
            glyph.userData.hoverProgress += ((active ? 1 : 0) - glyph.userData.hoverProgress) * resolveRadialHoverProgressFactor(item);
            const hoverProgress = glyph.userData.hoverProgress;
            glyph.position.copy(projected);
            glyph.traverse((child) => {
                updateMaterialHighlight(child.material, { active, progress });
            });
            const itemRadius = finite(item.visualRadius, 14);
            const sceneRadius = projectRadius?.(item.center, itemRadius) ?? 0.24;
            const baseRadius = finite(glyph.userData.baseRadius, 0.25);
            const radiusScale = finite(item.geometry?.radiusScale ?? item.radiusScale, 1);
            const hoverScale = resolveRadialHoverScale(item);
            const hoverScaleMultiplier = lerp(hoverScale.from, hoverScale.to, hoverProgress);
            let targetScale = (sceneRadius / Math.max(0.01, baseRadius)) * radiusScale * hoverScaleMultiplier * progress;
            const activationDisplay = activationDisplayForItem(activationTransition, item.id || 'item');
            if (activationDisplay?.active && activationDisplay.focusMode === 'fill-camera') {
                const viewportWidth = finite(globalThis.window?.innerWidth, 800);
                const viewportHeight = finite(globalThis.window?.innerHeight, 600);
                const fillRadius = projectRadius?.(item.center, Math.min(viewportWidth, viewportHeight) * 0.56);
                const fillMultiplier = Number.isFinite(fillRadius) && sceneRadius > 0
                    ? Math.max(1, fillRadius / Math.max(0.001, sceneRadius))
                    : 1;
                targetScale *= 1 + ((fillMultiplier - 1) * clamp01(activationDisplay.eased));
            }
            glyph.scale.setScalar(targetScale);
            applyRadialItemModelConfig(glyph);
            const itemModule = resolveSigilRadialItemModule(item);
            const effectState = itemModule?.updateEffect?.(glyph, item, {
                active,
                visualRadial,
                progress,
                dt,
            }, radialEffectHelpers()) || null;
            if (effectState) effects[item.id || 'item'] = effectState;
            scales[item.id || 'item'] = targetScale;
            const nativeGeometry = !!glyph.userData.geometryKind;
            if (nativeGeometry) {
                geometry[item.id || 'item'] = {
                    type: glyph.userData.geometryKind,
                    status: glyph.userData.geometryStatus || 'unknown',
                    title: glyph.userData.geometryTitle || null,
                    url: glyph.userData.geometryUrl || null,
                    error: glyph.userData.geometryError || null,
                    size: glyph.userData.geometrySize || null,
                    moduleRef: glyph.userData.itemModuleRef || item.geometry?.module_ref || null,
                    effectRefs: resolveSigilRadialItemEffectRefs(item),
                };
            }
            const hoverSpin = resolveRadialHoverSpin(item, {
                nativeGeometry,
                itemMotion: sourceItemMotion,
            });
            const facesCamera = resolveRadialItemFacesCamera(item);
            glyph.userData.hoverSpin = hoverSpin.rate > 0
                ? finite(glyph.userData.hoverSpin, 0) + (dt * hoverProgress * hoverSpin.rate)
                : 0;
            const hoverRotation = resolveRadialHoverRotationDegrees(item);
            const baseRotationX = nativeGeometry
                ? hoverProgress * hoverRotation.x
                : 0.08 + (hoverProgress * 0.04);
            const baseRotationY = (nativeGeometry ? 0 : finite(item.angle, 0) * 0.004)
                + (hoverSpin.axis === 'y' ? glyph.userData.hoverSpin : 0)
                + (hoverProgress * hoverRotation.y);
            glyph.rotation.x = facesCamera ? 0 : baseRotationX;
            glyph.rotation.y = facesCamera ? 0 : baseRotationY;
            glyph.rotation.z = (hoverProgress * hoverRotation.z) + (hoverSpin.axis === 'z' ? glyph.userData.hoverSpin : 0);
            glyph.userData.hoverSpinAxis = hoverSpin.axis;
            glyph.userData.facesCamera = facesCamera;
            glyph.userData.hoverScaleMultiplier = hoverScaleMultiplier;
            if (activationDisplay) {
                applyGlyphDisplayOpacity(glyph, activationDisplay.opacity);
            }
        }

        lastState = {
            visible: true,
            count: items.length,
            itemIds: [...glyphs.keys()],
            activeItemId: activeRadial || activationTransition ? (source.activeItemId || null) : null,
            activationTransition: activationTransition ? {
                activation_id: activationTransition.activation_id,
                item_id: activationTransition.item_id,
                preset: activationTransition.preset,
                progress: activationTransition.progress,
                completed: activationTransition.completed,
            } : null,
            scales,
            geometry,
            effects,
        };
        return lastState;
    }

    function destroy() {
        scene.remove(group);
        disposeObject(group);
        glyphs.clear();
    }

    function reset() {
        group.visible = false;
        lastRadial = null;
        displayProgress = 0;
        lastUpdateTime = null;
        lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    }

    return {
        group,
        update,
        reset,
        destroy,
        snapshot() {
            return {
                ...lastState,
                visible: group.visible && lastState.visible,
            };
        },
    };
}
