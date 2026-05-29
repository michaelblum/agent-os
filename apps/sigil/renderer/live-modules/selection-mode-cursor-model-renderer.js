const CURSOR_MODEL_ROOT_ID = 'selection-mode.cursor.model-root';
const CURSOR_MODEL_OBJECT_ID = 'selection-mode.cursor.sigil-model';
const CURSOR_TRAIL_OBJECT_ID = 'selection-mode.cursor.trail-model';
const AVATAR_ROOT_OBJECT_ID = 'avatar.main';
const CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE = 'current_avatar_effect_descriptors';
const MAX_POINTER_TRAIL_INSTANCES = 8;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

function createAvatarDerivedPointerGeometry(THREE) {
    const geometry = new THREE.BufferGeometry();
    const sideLength = 0.66;
    const depth = 0.46;
    const baseCenter = { x: 1.32, y: -1.32, z: -depth };
    const tangent = sideLength / 2;
    const normal = sideLength / Math.sqrt(3);
    const vertices = [
        0, 0, 0,
        baseCenter.x - tangent, baseCenter.y - normal / 2, baseCenter.z,
        baseCenter.x + tangent, baseCenter.y - normal / 2, baseCenter.z,
        baseCenter.x, baseCenter.y + normal, baseCenter.z,
    ];
    const indices = [
        0, 1, 2,
        0, 2, 3,
        0, 3, 1,
        1, 3, 2,
    ];
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (typeof geometry.setIndex === 'function') geometry.setIndex(indices);
    if (typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
    geometry.userData = {
        primitive: 'triangular_pyramid',
        geometry_family: 'selection_mode_avatar_derived_pointer',
        hotspot_local: { x: 0, y: 0, z: 0 },
        depth_semantics: 'screen_plane_pointer',
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
        base_cross_section: 'equilateral_triangle',
        equilateral_base_vertex_indices: [1, 2, 3],
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
        setMaterialColor(instance.core.material, face[0]);
        setMaterialEmissive(instance.core.material, aura[0]);
    }
    if (instance.edges?.material) {
        setMaterialColor(instance.edges.material, edge[0]);
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

function createEffectSprite(THREE, name, options = {}) {
    const Material = THREE.SpriteMaterial || THREE.MeshBasicMaterial || THREE.MeshPhongMaterial || THREE.LineBasicMaterial;
    const material = Material ? new Material(options) : { ...options };
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
        color: '#bc13fe',
        transparent: true,
        opacity: trail ? 0.08 : 0.28,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    const core = createEffectSprite(THREE, `${objectId}.effects.core`, {
        color: '#bc13fe',
        transparent: true,
        opacity: trail ? 0.05 : 0.18,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    if (glow.scale?.set) glow.scale.set(2.6, 2.6, 1);
    if (core.scale?.set) core.scale.set(1.18, 1.18, 1);
    if (group.position?.set) group.position.set(0.74, -0.74, -0.18);
    group.add(glow);
    group.add(core);
    if (stats) {
        stats.effect_groups_created += 1;
        stats.materials_created += 2;
    }
    return { group, glow, core, effect_identity: [] };
}

function applyAvatarEffectsToInstance(instance, avatarSource = null) {
    if (!instance?.effects || !avatarSource) return;
    const aura = avatarSource.auraDescriptor || {};
    const identity = pointerEffectIdentity(avatarSource);
    const [auraPrimary, auraSecondary] = avatarColorPair(avatarSource, 'aura');
    const enabled = aura.enabled !== false;
    const intensity = clamp(finite(aura.intensity, 1), 0, 4);
    const reach = clamp(finite(aura.reach, 1), 0.1, 4);
    const trailMultiplier = instance.trail ? 0.34 : 1;
    if (!sameIdentity(instance.effects.effect_identity, identity)) {
        setMaterialColor(instance.effects.glow?.material, auraPrimary);
        setMaterialColor(instance.effects.core?.material, auraSecondary || auraPrimary);
        instance.effects.effect_identity = identity;
    }
    instance.effects.group.visible = enabled;
    if (instance.effects.glow?.material) {
        setPointerEffectBaseOpacity(
            instance.effects.glow,
            enabled ? clamp(0.22 * intensity * trailMultiplier, 0.02, instance.trail ? 0.12 : 0.38) : 0,
        );
    }
    if (instance.effects.core?.material) {
        setPointerEffectBaseOpacity(
            instance.effects.core,
            enabled ? clamp(0.13 * intensity * trailMultiplier, 0.01, instance.trail ? 0.08 : 0.24) : 0,
        );
    }
    const glowScale = (instance.trail ? 1.55 : 2.6) * reach;
    const coreScale = (instance.trail ? 0.74 : 1.18) * Math.max(0.5, Math.sqrt(reach));
    if (instance.effects.glow?.scale?.set) instance.effects.glow.scale.set(glowScale, glowScale, 1);
    if (instance.effects.core?.scale?.set) instance.effects.core.scale.set(coreScale, coreScale, 1);
    const phenomena = avatarSource.phenomenaDescriptor || {};
    const enabledFamilies = ['pulsar', 'accretion', 'gamma', 'neutrino']
        .filter((key) => phenomena[key]?.enabled === true && finite(phenomena[key]?.count, 0) > 0);
    if (avatarSource.lightningDescriptor?.enabled) enabledFamilies.push('lightning');
    if (avatarSource.magneticDescriptor?.enabled || avatarSource.magneticDescriptor?.fieldEnabled) enabledFamilies.push('magnetic');
    instance.group.userData.effects_source = avatarSource.effectsSource || avatarSource.effects_source || CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE;
    instance.group.userData.effect_families = enabled ? ['aura_glow', ...enabledFamilies] : enabledFamilies;
    instance.group.userData.pointer_effects = {
        source: instance.group.userData.effects_source,
        rendered: enabled ? ['aura_glow', 'aura_core'] : [],
        inherited_descriptors: enabledFamilies,
        aura: {
            enabled,
            reach,
            intensity,
            primary: auraPrimary,
            secondary: auraSecondary,
        },
        pointer_scale_boundary: instance.effects.group.userData.pointer_scale_boundary,
    };
}

function createModelInstance(THREE, {
    objectId,
    trail = false,
    stats = null,
    avatarSource = null,
} = {}) {
    const group = new THREE.Group();
    const spin = new THREE.Group();
    const geometry = createAvatarDerivedPointerGeometry(THREE);
    const edgeGeometry = typeof THREE.EdgesGeometry === 'function' ? new THREE.EdgesGeometry(geometry) : geometry;
    const sourceIdentity = sourceMaterialIdentity(avatarSource);
    const coreTemplate = avatarSource?.primaryMaterialTemplate || avatarSource?.primaryMaterial || null;
    const edgeTemplate = avatarSource?.edgeMaterialTemplate || avatarSource?.edgeMaterial || null;
    const coreMaterial = cloneMaterial(coreTemplate) || makeFallbackMaterial(THREE, 'core', trail);
    const edgeMaterial = cloneMaterial(edgeTemplate) || makeFallbackMaterial(THREE, 'edge', trail);
    if (stats) {
        stats.model_instances_created += 1;
        stats.geometries_created += edgeGeometry === geometry ? 1 : 2;
        stats.materials_created += 2;
        if (trail) stats.trail_instances_created += 1;
    }
    const core = new THREE.Mesh(
        geometry,
        coreMaterial,
    );
    const edges = new THREE.LineSegments(
        edgeGeometry,
        edgeMaterial,
    );
    const effects = createPointerEffectObjects(THREE, objectId, trail, stats);
    core.name = `${objectId}.core`;
    edges.name = `${objectId}.edges`;
    spin.name = `${objectId}.spin`;
    group.name = objectId;
    group.userData = {
        object_id: objectId,
        parent_object_id: AVATAR_ROOT_OBJECT_ID,
        kind: 'three.object3d',
        model_kind: 'sigil_model',
        source: 'avatar_render_state',
        appearance_source: avatarSource?.appearanceSource || 'current_live_sigil_avatar',
        shape: 'avatar_derived_triangular_pointer',
        geometry: 'triangular_pyramid',
        geometry_family: 'selection_mode_avatar_derived_pointer',
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
        hotspot: 'tip',
        trail,
    };
    group.userData.material_source = avatarSource?.materialSource || 'live_avatar_materials';
    group.userData.effects_source = avatarSource?.effectsSource || avatarSource?.effects_source || CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE;
    group.userData.cursor_overrides = ['geometry', 'orientation', 'hotspot', 'scale', 'visibility', 'single_axis_rotation'];
    group.userData.material_identity = sourceIdentity;
    group.userData.effect_identity = pointerEffectIdentity(avatarSource);
    spin.add(core);
    spin.add(edges);
    group.add(spin);
    group.add(effects.group);
    group.visible = false;
    applyAvatarMaterialVisuals({ group, core, edges, geometry, THREE }, avatarSource || {});
    applyAvatarEffectsToInstance({ group, effects, trail }, avatarSource || {});
    return { group, spin, core, edges, effects, geometry, trail, THREE };
}

function setInstanceOpacity(instance, alpha, fill = true) {
    const coreOpacity = fill ? 0.82 : 0.18;
    if (instance.core?.material) instance.core.material.opacity = clamp(alpha * coreOpacity, 0, 1);
    if (instance.edges?.material) instance.edges.material.opacity = clamp(alpha * 0.96, 0, 1);
    setPointerEffectOpacity(instance.effects?.glow, alpha, fill);
    setPointerEffectOpacity(instance.effects?.core, alpha, fill);
}

function applyAvatarSourceToInstance(instance, avatarSource = null, stats = null) {
    if (!instance || !avatarSource) return;
    const nextIdentity = sourceMaterialIdentity(avatarSource);
    if (!sameIdentity(instance.group.userData.material_identity, nextIdentity)) {
        const nextCore = cloneMaterial(avatarSource.primaryMaterialTemplate || avatarSource.primaryMaterial);
        const nextEdge = cloneMaterial(avatarSource.edgeMaterialTemplate || avatarSource.edgeMaterial);
        if (nextCore) {
            disposeMaterial(instance.core?.material);
            instance.core.material = nextCore;
            if (stats) stats.materials_created += 1;
        }
        if (nextEdge) {
            disposeMaterial(instance.edges?.material);
            instance.edges.material = nextEdge;
            if (stats) stats.materials_created += 1;
        }
        instance.group.userData.material_identity = nextIdentity;
    }
    const coreTemplate = avatarSource.primaryMaterialTemplate || avatarSource.primaryMaterial;
    const edgeTemplate = avatarSource.edgeMaterialTemplate || avatarSource.edgeMaterial;
    copyMaterial(coreTemplate, instance.core?.material);
    copyMaterial(edgeTemplate, instance.edges?.material);
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
} = {}) {
    if (!instance) return false;
    if (!scenePoint) {
        hideInstance(instance);
        return false;
    }
    setVector(instance.group.position, scenePoint);
    setScale(instance.group.scale, Math.max(0.0001, scale));
    instance.group.rotation.x = 0;
    instance.group.rotation.y = 0;
    instance.group.rotation.z = 0;
    instance.spin.rotation.z = phase;
    instance.group.visible = true;
    setInstanceOpacity(instance, alpha, fill);
    return true;
}

function hideInstance(instance) {
    if (instance?.group) instance.group.visible = false;
}

function disposeMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach((entry) => entry?.dispose?.());
        return;
    }
    material?.dispose?.();
}

function disposeInstance(instance) {
    if (!instance) return;
    instance.geometry?.dispose?.();
    if (instance.edges?.geometry !== instance.geometry) instance.edges?.geometry?.dispose?.();
    disposeMaterial(instance.core?.material);
    disposeMaterial(instance.edges?.material);
    disposeMaterial(instance.effects?.glow?.material);
    disposeMaterial(instance.effects?.core?.material);
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
        if (clearTrail) trailHistory.length = 0;
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

    function update(overlay = null, {
        time = 0,
    } = {}) {
        stats.update_count += 1;
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
        const vitality = Math.max(0.1, finite(glyph.animation?.session_vitality_multiplier, 1));
        const rotationSpeed = Math.abs(finite(glyph.animation?.rotation_speed, 0.01));
        const phase = time * rotationSpeed * vitality * Math.PI * 2;
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

        recordTrail(trailHistory, cursor, time, Math.max(1, repeatDuration + 0.5));
        for (let i = repeatCount; i >= 1; i -= 1) {
            const instance = ensureTrail(repeatCount - i);
            applyAvatarSourceToInstance(instance, avatarSource, stats);
            const age = delay + (duration * lag * i);
            const sample = trailPointForAge(trailHistory, age, cursor);
            const progress = i / Math.max(1, repeatCount);
            const mode = String(trail.trailMode || 'fade');
            const alpha = mode === 'hold'
                ? 0.08 + (0.12 * (1 - progress))
                : Math.max(0.025, 0.18 * (1 - progress));
            updateInstance(instance, scenePointFor(sample), {
                scale: baseScale * Math.max(0.28, trailScale * (0.42 + (1 - progress) * 0.12)),
                alpha,
                phase: phase - i * 0.16,
                fill: false,
            });
        }
        for (let i = repeatCount; i < trailInstances.length; i += 1) hideInstance(trailInstances[i]);

        const hotspotAligned = updateInstance(model, primaryPoint, {
            scale: baseScale * Math.max(0.42, trailScale * 0.62),
            alpha: 0.96,
            phase,
            fill: true,
        });
        lastSnapshot = {
            mounted,
            visible: root.visible === true,
            model_kind: glyph.model_kind,
            source: glyph.source || '',
            appearance_source: model.group.userData.appearance_source || '',
            material_source: model.group.userData.material_source || '',
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
            trail_count: repeatCount,
            requested_trail_count: requestedRepeatCount,
            trail_policy: {
                source: 'selection_mode_pointer_trail_policy',
                max_visible_instances: MAX_POINTER_TRAIL_INSTANCES,
                opacity: 'subtle_avatar_derived_echo',
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
