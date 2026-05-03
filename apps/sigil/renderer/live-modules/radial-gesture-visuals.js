import { radialItemPointerMetrics } from './radial-gesture-runtime.js';
import {
    DEFAULT_NESTED_TREE_EFFECT,
    resolveNestedShellTransform,
    resolveNestedTreeTransform,
    vectorAngles,
    vectorValue,
} from './radial-object-control.js';

export {
    DEFAULT_NESTED_TREE_EFFECT,
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

function applyNestedTreeTransform(tree, transform = {}) {
    applyObjectTransform(tree, transform, DEFAULT_NESTED_TREE_EFFECT.treeTransform);
}

function applyNestedShellTransform(shell, transform = {}) {
    applyObjectTransform(shell, transform, DEFAULT_NESTED_TREE_EFFECT.shellTransform);
}

function material(color, opacity = 0.75) {
    return new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        shininess: 55,
        specular: new THREE.Color(0x444444),
        depthWrite: false,
    });
}

function edgeMaterial(color, opacity = 0.9) {
    return new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
    });
}

function addEdges(group, mesh, color = '#ffffff', opacity = 0.55) {
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        edgeMaterial(color, opacity)
    );
    edges.scale.copy(mesh.scale);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
}

function createContextMenuGlyph() {
    const group = new THREE.Group();
    const core = material('#7df8d7', 0.68);
    const accent = material('#d8fff5', 0.82);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 16), core);
    group.add(ring);
    addEdges(group, ring, '#eaffff', 0.5);

    const toothGeometry = new THREE.BoxGeometry(0.075, 0.032, 0.055);
    for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeometry, i % 2 === 0 ? accent : core);
        tooth.position.set(Math.cos(angle) * 0.23, Math.sin(angle) * 0.23, 0);
        tooth.rotation.z = angle;
        group.add(tooth);
    }

    const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), accent);
    group.add(hub);
    return group;
}

function brainLobe(x, y, z, sx, sy, sz, color) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), material(color, 0.76));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
}

function createWikiGraphGlyph() {
    const group = new THREE.Group();
    const lobes = [
        brainLobe(-0.09, 0.05, 0, 1.05, 0.78, 0.65, '#ba8cff'),
        brainLobe(0.09, 0.05, 0, 1.05, 0.78, 0.65, '#78d8ff'),
        brainLobe(-0.07, -0.08, 0, 0.92, 0.72, 0.58, '#9ac8ff'),
        brainLobe(0.07, -0.08, 0, 0.92, 0.72, 0.58, '#d18cff'),
    ];
    for (const lobe of lobes) {
        group.add(lobe);
        addEdges(group, lobe, '#ffffff', 0.42);
    }

    const groove = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.18, 0.03),
        new THREE.Vector3(-0.025, 0.06, 0.04),
        new THREE.Vector3(0.018, -0.03, 0.04),
        new THREE.Vector3(-0.012, -0.18, 0.03),
    ]);
    group.add(new THREE.Line(groove, edgeMaterial('#0b1730', 0.7)));
    return group;
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

function createFallbackForItem(item = {}) {
    if (item.action === 'contextMenu' || item.id === 'context-menu') return createContextMenuGlyph();
    if (item.action === 'wikiGraph' || item.id === 'wiki-graph') return createWikiGraphGlyph();
    return createFallbackGlyph();
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function seededRandom(seed = 0x5eed1234) {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x100000000;
    };
}

function effectConfig(item = {}) {
    const effect = item.geometry?.radialEffect;
    if (!effect || typeof effect !== 'object') return null;
    if (effect.kind !== 'nested-neural-tree') return null;
    const merged = {
        ...DEFAULT_NESTED_TREE_EFFECT,
        ...effect,
        shellOpacity: {
            ...DEFAULT_NESTED_TREE_EFFECT.shellOpacity,
            ...(effect.shellOpacity || {}),
        },
    };
    merged.shellTransform = resolveNestedShellTransform(merged);
    merged.treeTransform = resolveNestedTreeTransform(merged);
    return merged;
}

function brainTreePoint(rand, depth = 1) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos((rand() * 2) - 1);
    const radius = Math.pow(rand(), 0.38) * depth;
    const yBias = (rand() - 0.5) * 0.08;
    return new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi) * 0.155 * radius,
        (Math.sin(theta) * Math.sin(phi) * 0.105 * radius) + yBias + 0.01,
        Math.cos(phi) * 0.108 * radius
    );
}

function createNestedNeuralTreeGeometry() {
    const rand = seededRandom(0x51a9e1);
    const positions = [];
    const reveals = [];
    const sparkPositions = [];
    const sparkReveals = [];
    const sparkSeeds = [];
    const trunk = new THREE.Vector3(0, -0.12, -0.006);
    let maxReveal = 0.0001;

    for (let path = 0; path < 96; path += 1) {
        const target = brainTreePoint(rand, 0.82 + (rand() * 0.24));
        const control = brainTreePoint(rand, 0.42).add(new THREE.Vector3(0, -0.012 + (rand() * 0.04), 0));
        const steps = 5 + Math.floor(rand() * 4);
        let prior = trunk.clone().add(new THREE.Vector3((rand() - 0.5) * 0.018, (rand() - 0.5) * 0.012, (rand() - 0.5) * 0.014));

        for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            const eased = t * t * (3 - (2 * t));
            const midpoint = new THREE.Vector3().lerpVectors(control, target, eased);
            const next = new THREE.Vector3().lerpVectors(prior, midpoint, 0.5 + (t * 0.42));
            next.x += (rand() - 0.5) * 0.026 * (1 - t);
            next.y += (rand() - 0.5) * 0.018 * (1 - t);
            next.z += (rand() - 0.5) * 0.022 * (1 - t);
            const reveal = Math.max(0.02, ((path / 96) * 0.24) + (t * 0.76));
            maxReveal = Math.max(maxReveal, reveal);

            positions.push(prior.x, prior.y, prior.z, next.x, next.y, next.z);
            reveals.push(reveal - 0.04, reveal);

            if (step === steps || rand() > 0.58) {
                sparkPositions.push(next.x, next.y, next.z);
                sparkReveals.push(reveal);
                sparkSeeds.push(rand());
            }
            prior = next;
        }
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    lineGeometry.setAttribute('a_reveal', new THREE.Float32BufferAttribute(reveals, 1));

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('a_reveal', new THREE.Float32BufferAttribute(sparkReveals, 1));
    sparkGeometry.setAttribute('a_seed', new THREE.Float32BufferAttribute(sparkSeeds, 1));

    return { lineGeometry, sparkGeometry, maxReveal };
}

function createNestedNeuralTreeMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_growth: { value: 0 },
            u_opacity: { value: 0 },
            u_brightness: { value: 1 },
            u_color: { value: new THREE.Color(0x69ffff) },
        },
        vertexShader: `
            attribute float a_reveal;
            varying float v_reveal;
            void main() {
                v_reveal = a_reveal;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float u_growth;
            uniform float u_opacity;
            uniform float u_brightness;
            uniform vec3 u_color;
            varying float v_reveal;
            void main() {
                if (v_reveal > u_growth) discard;
                float edge = smoothstep(0.18, 0.0, u_growth - v_reveal);
                float alpha = u_opacity * (0.32 + edge * 0.68);
                gl_FragColor = vec4(u_color * u_brightness * (1.2 + edge), alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
}

function createNestedNeuralSparkMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_growth: { value: 0 },
            u_opacity: { value: 0 },
            u_time: { value: 0 },
            u_density: { value: 0 },
            u_brightness: { value: 1 },
        },
        vertexShader: `
            attribute float a_reveal;
            attribute float a_seed;
            uniform float u_growth;
            uniform float u_time;
            uniform float u_density;
            varying float v_alpha;
            void main() {
                float visible = step(a_reveal, u_growth);
                float flicker = 0.45 + 0.55 * sin((u_time * (3.0 + u_density * 9.0)) + (a_seed * 80.0));
                v_alpha = visible * smoothstep(0.0, 1.0, u_density) * flicker;
                gl_PointSize = 1.8 + (u_density * 3.8);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float u_opacity;
            uniform float u_brightness;
            varying float v_alpha;
            void main() {
                if (v_alpha <= 0.001) discard;
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                if (d > 0.5) discard;
                float core = smoothstep(0.5, 0.0, d);
                vec3 color = mix(vec3(0.18, 0.95, 1.0), vec3(1.0, 1.0, 0.82), core);
                gl_FragColor = vec4(color * u_brightness * (1.0 + core), u_opacity * v_alpha * core);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
}

function createNestedNeuralTreeEffect() {
    const group = new THREE.Group();
    group.name = 'nested-neural-tree-effect';
    group.visible = false;
    const { lineGeometry, sparkGeometry } = createNestedNeuralTreeGeometry();
    const lineMaterial = createNestedNeuralTreeMaterial();
    const sparkMaterial = createNestedNeuralSparkMaterial();
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    lines.renderOrder = 22;
    sparks.renderOrder = 23;
    group.add(lines, sparks);
    group.userData.lineMaterial = lineMaterial;
    group.userData.sparkMaterial = sparkMaterial;
    group.userData.time = 0;
    return group;
}

function updateNestedNeuralTreeEffect(effect, progress, dt) {
    if (!effect) return;
    const p = clamp01(progress);
    effect.visible = p > 0.015;
    effect.userData.time = finite(effect.userData.time, 0) + dt;
    const lineMaterial = effect.userData.lineMaterial;
    const sparkMaterial = effect.userData.sparkMaterial;
    if (lineMaterial?.uniforms) {
        lineMaterial.uniforms.u_growth.value = p;
        lineMaterial.uniforms.u_opacity.value = Math.pow(p, 0.82) * 0.88;
        lineMaterial.uniforms.u_brightness.value = 0.75 + (p * 2.2);
    }
    if (sparkMaterial?.uniforms) {
        sparkMaterial.uniforms.u_growth.value = p;
        sparkMaterial.uniforms.u_opacity.value = p;
        sparkMaterial.uniforms.u_density.value = p;
        sparkMaterial.uniforms.u_brightness.value = 0.8 + (p * 2.8);
        sparkMaterial.uniforms.u_time.value = effect.userData.time;
    }
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
        return trimmed.replace(/^aos:\/\/sigil\//, '/sigil/');
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
    const fallback = createFallbackForItem(item);
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

function applyGeometryMaterial(object, geometry = {}) {
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

function createRadialEffectHost(group, item = {}) {
    const effect = effectConfig(item);
    if (!effect) return group;

    const composite = new THREE.Group();
    composite.name = `${item.id || 'radial-item'}-effect-composite`;
    const modelHost = new THREE.Group();
    modelHost.name = `${item.id || 'radial-item'}-model-host`;
    const treeEffect = createNestedNeuralTreeEffect();
    treeEffect.name = `${item.id || 'radial-item'}-nested-neural-tree`;
    applyNestedShellTransform(modelHost, effect.shellTransform);
    applyNestedTreeTransform(treeEffect, effect.treeTransform);
    composite.add(modelHost, treeEffect);
    group.add(composite);
    group.userData.modelHost = modelHost;
    group.userData.radialEffectConfig = effect;
    group.userData.radialEffectTree = treeEffect;
    group.userData.radialEffectShellTransform = effect.shellTransform;
    group.userData.radialEffectTreeTransform = effect.treeTransform;
    group.userData.radialEffectState = {
        activation: 0,
        treeProgress: 0,
        heldProgress: 0,
        shellOpacity: effect.shellOpacity.rest,
        relation: null,
        holding: false,
    };
    return modelHost;
}

function syncRadialEffectConfig(glyph, item = {}) {
    if (!glyph?.userData?.radialEffectTree) return;
    const effect = effectConfig(item);
    if (!effect) return;
    glyph.userData.radialEffectConfig = effect;
    glyph.userData.radialEffectShellTransform = effect.shellTransform;
    glyph.userData.radialEffectTreeTransform = effect.treeTransform;
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
    const kind = geometryKind(item);
    if (kind === 'gltf' || kind === 'glb') return createGltfGlyph(item);
    if (item.action === 'contextMenu' || item.id === 'context-menu') return createContextMenuGlyph();
    if (item.action === 'wikiGraph' || item.id === 'wiki-graph') return createWikiGraphGlyph();
    return createFallbackGlyph();
}

function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function glyphSceneRadius(glyph) {
    const box = new THREE.Box3().setFromObject(glyph);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    return Number.isFinite(radius) && radius > 0 ? radius : 0.25;
}

function disposeObject(object) {
    object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose?.());
        } else if (child.material) {
            child.material.dispose?.();
        }
    });
}

function forEachMaterial(material, visit) {
    if (Array.isArray(material)) {
        material.forEach((mat) => mat && visit(mat));
    } else if (material) {
        visit(material);
    }
}

const highlightColor = new THREE.Color('#ffffff');

function updateMaterialHighlight(material, { active, progress }) {
    forEachMaterial(material, (mat) => {
        const baseOpacity = Number(mat.userData?.baseOpacity ?? mat.opacity ?? 1);
        mat.userData.baseOpacity = baseOpacity;
        if (!mat.userData.radialManagedOpacity) {
            mat.opacity = baseOpacity * Math.min(1, progress * (active ? 1.5 : 1.2));
        }

        if (mat.color?.isColor) {
            if (!mat.userData.baseColor) mat.userData.baseColor = mat.color.clone();
            mat.color.copy(mat.userData.baseColor).lerp(highlightColor, active ? 0.2 : 0);
        }
        if (mat.emissive?.isColor) {
            if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.clone();
            mat.emissive.copy(mat.userData.baseEmissive).lerp(highlightColor, active ? 0.16 : 0);
        }
    });
}

function setManagedShellOpacity(glyph, opacity, display = 1) {
    const shellOpacity = clamp01(opacity);
    const displayOpacity = clamp01(display);
    const modelHost = glyph.userData.modelHost || glyph;
    modelHost.traverse((child) => {
        forEachMaterial(child.material, (mat) => {
            if (mat.userData?.radialShell) {
                mat.opacity = shellOpacity;
            } else if (mat.userData?.radialShellRim) {
                const minOpacity = finite(mat.userData.radialShellMinOpacity, 0.12) * displayOpacity;
                const opacityScale = finite(mat.userData.radialShellOpacityScale, 0.35);
                mat.opacity = Math.max(minOpacity, shellOpacity * opacityScale);
            }
        });
    });
}

function updateRadialEffect(glyph, item, {
    active,
    visualRadial,
    progress,
    dt,
} = {}) {
    const config = glyph.userData.radialEffectConfig;
    const state = glyph.userData.radialEffectState;
    const modelHost = glyph.userData.modelHost;
    const tree = glyph.userData.radialEffectTree;
    if (!config || !state || !tree) return null;

    const metrics = visualRadial ? radialItemPointerMetrics(visualRadial, item) : null;
    const relation = metrics?.relation || null;
    const effectActive = !!active || relation === 'inside';
    const smoothing = effectActive ? 0.24 : 0.16;
    state.activation += ((effectActive ? 1 : 0) - state.activation) * smoothing;
    if (effectActive) {
        state.heldProgress = Math.max(state.heldProgress, state.activation);
    }

    const holding = !!(
        visualRadial
        && !effectActive
        && relation === config.holdExitDirection
        && state.heldProgress > 0.05
    );
    if (!visualRadial) state.heldProgress = 0;

    const treeTarget = holding
        ? Math.max(state.treeProgress, state.heldProgress)
        : effectActive
            ? state.activation
            : 0;
    state.treeProgress += (treeTarget - state.treeProgress) * (treeTarget >= state.treeProgress ? 0.18 : 0.12);

    const restOpacity = finite(config.shellOpacity?.rest, 0.75);
    const activeOpacity = finite(config.shellOpacity?.active, 0.26);
    const heldOpacity = finite(config.shellOpacity?.held, 0.75);
    const shellTarget = holding
        ? heldOpacity
        : effectActive
            ? lerp(restOpacity, activeOpacity, clamp01(state.activation))
            : restOpacity;
    state.shellOpacity += (shellTarget - state.shellOpacity) * 0.2;

    const display = clamp01(progress);
    applyNestedShellTransform(modelHost, glyph.userData.radialEffectShellTransform || config.shellTransform);
    setManagedShellOpacity(glyph, state.shellOpacity * display, display);
    updateNestedNeuralTreeEffect(tree, state.treeProgress * display, dt);
    applyNestedTreeTransform(tree, glyph.userData.radialEffectTreeTransform || config.treeTransform);
    state.relation = relation;
    state.holding = holding;

    return {
        kind: config.kind,
        activation: state.activation,
        treeProgress: state.treeProgress,
        shellOpacity: state.shellOpacity,
        relation,
        holding,
    };
}

export function createSigilRadialGestureVisuals({ scene, projectPoint, projectRadius } = {}) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 20;
    scene.add(group);
    const glyphs = new Map();
    let lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    let lastRadial = null;
    let displayProgress = 0;
    let lastUpdateTime = null;

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

    function update(radial, { time = 0 } = {}) {
        const dt = lastUpdateTime == null ? 1 / 60 : Math.min(0.08, Math.max(0, time - lastUpdateTime));
        lastUpdateTime = time;
        const visualRadial = radial?.phase === 'radial' || radial?.phase === 'fastTravel' ? radial : null;
        const activeRadial = radial?.phase === 'radial' ? radial : null;
        if (visualRadial) lastRadial = visualRadial;
        const source = visualRadial || lastRadial;
        const targetProgress = visualRadial
            ? Math.max(0.08, Number(visualRadial.menuProgress) || 0)
            : 0;
        const smoothing = visualRadial ? 0.42 : 0.28;
        displayProgress += (targetProgress - displayProgress) * smoothing;

        if (!source || displayProgress <= 0.015) {
            group.visible = false;
            displayProgress = 0;
            if (!visualRadial) lastRadial = null;
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

        for (const item of items) {
            const glyph = ensureGlyph(item);
            syncRadialEffectConfig(glyph, item);
            const projected = projectPoint?.(item.center);
            glyph.visible = !!projected;
            if (!projected) continue;
            const activation = radialGlyphActivationState({ visualRadial, activeRadial, source, item });
            const active = activation.active;
            glyph.userData.hoverProgress += ((active ? 1 : 0) - glyph.userData.hoverProgress) * 0.22;
            const hoverProgress = glyph.userData.hoverProgress;
            glyph.position.copy(projected);
            glyph.traverse((child) => {
                updateMaterialHighlight(child.material, { active, progress });
            });
            const itemRadius = finite(item.visualRadius, 14);
            const sceneRadius = projectRadius?.(item.center, itemRadius) ?? 0.24;
            const baseRadius = finite(glyph.userData.baseRadius, 0.25);
            const radiusScale = finite(item.geometry?.radiusScale ?? item.radiusScale, 1);
            const targetScale = (sceneRadius / Math.max(0.01, baseRadius)) * radiusScale * (1 + hoverProgress * 0.08) * progress;
            glyph.scale.setScalar(targetScale);
            const effectState = updateRadialEffect(glyph, item, {
                active,
                visualRadial,
                progress,
                dt,
            });
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
                };
            }
            glyph.userData.hoverSpin = finite(glyph.userData.hoverSpin, 0) + (dt * hoverProgress * (nativeGeometry ? 1.45 : 1.1));
            glyph.rotation.x = nativeGeometry ? hoverProgress * 0.12 : 0.08 + (hoverProgress * 0.04);
            glyph.rotation.y = (nativeGeometry ? 0 : finite(item.angle, 0) * 0.004) + glyph.userData.hoverSpin;
            glyph.rotation.z = hoverProgress * 0.055;
        }

        lastState = {
            visible: true,
            count: items.length,
            itemIds: [...glyphs.keys()],
            activeItemId: activeRadial ? (source.activeItemId || null) : null,
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
