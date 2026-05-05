import { radialItemPointerMetrics } from './radial-gesture-runtime.js';
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

const FRACTAL_TREE_LOBES = [
    { name: 'Hemisphere', pos: [-1.3, 1.4, -0.2], scale: [2.0, 2.8, 3.8], leaves: 150 },
    { name: 'Cerebellum', pos: [-1.0, -1.8, -2.8], scale: [1.4, 0.9, 1.5], leaves: 40 },
    { name: 'Temporal', pos: [-2.2, 0.2, 0.5], scale: [1.2, 1.4, 2.4], leaves: 40 },
    { name: 'Occipital', pos: [-1.0, 0.8, -3.4], scale: [1.3, 1.5, 1.6], leaves: 40 },
    { name: 'Parietal', pos: [-1.3, 2.6, -0.8], scale: [1.5, 1.4, 2.0], leaves: 40 },
    { name: 'Frontal', pos: [-1.3, 1.8, 2.2], scale: [1.6, 2.0, 2.4], leaves: 40 },
];

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

function randomUnitVector(rand) {
    const v = new THREE.Vector3(
        rand() - 0.5,
        rand() - 0.5,
        rand() - 0.5
    );
    if (v.lengthSq() < 0.000001) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
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
    merged.visibility = resolveNestedVisibility(merged);
    merged.shellTransform = resolveNestedShellTransform(merged);
    merged.fiberOpticsTransform = resolveNestedFiberOpticsTransform(merged);
    merged.fiberStemTransform = resolveNestedFiberStemTransform(merged);
    merged.fiberBloomTransform = resolveNestedFiberBloomTransform(merged);
    merged.fractalTreeTransform = resolveNestedFractalTreeTransform(merged);
    merged.fiberPulse = resolveNestedFiberPulse(merged);
    merged.fractalPulse = resolveNestedFractalPulse(merged);
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
    const stem = {
        positions: [],
        reveals: [],
        sparkPositions: [],
        sparkReveals: [],
        sparkSeeds: [],
    };
    const bloom = {
        positions: [],
        reveals: [],
        sparkPositions: [],
        sparkReveals: [],
        sparkSeeds: [],
    };
    const trunk = new THREE.Vector3(0, -0.12, -0.006);
    const stemStepRatio = 0.42;
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

            const bucket = t <= stemStepRatio ? stem : bloom;
            bucket.positions.push(prior.x, prior.y, prior.z, next.x, next.y, next.z);
            bucket.reveals.push(reveal - 0.04, reveal);

            if (step === steps || rand() > 0.58) {
                bucket.sparkPositions.push(next.x, next.y, next.z);
                bucket.sparkReveals.push(reveal);
                bucket.sparkSeeds.push(rand());
            }
            prior = next;
        }
    }

    function geometryFor(bucket) {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
        lineGeometry.setAttribute('a_reveal', new THREE.Float32BufferAttribute(bucket.reveals, 1));

        const sparkGeometry = new THREE.BufferGeometry();
        sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.sparkPositions, 3));
        sparkGeometry.setAttribute('a_reveal', new THREE.Float32BufferAttribute(bucket.sparkReveals, 1));
        sparkGeometry.setAttribute('a_seed', new THREE.Float32BufferAttribute(bucket.sparkSeeds, 1));

        return { lineGeometry, sparkGeometry };
    }

    return {
        stem: geometryFor(stem),
        bloom: geometryFor(bloom),
        maxReveal,
    };
}

function createNestedNeuralTreePart(name, geometry, renderOrder = 22) {
    const group = new THREE.Group();
    group.name = name;
    const lineMaterial = createNestedNeuralTreeMaterial();
    const sparkMaterial = createNestedNeuralSparkMaterial();
    const lines = new THREE.LineSegments(geometry.lineGeometry, lineMaterial);
    const sparks = new THREE.Points(geometry.sparkGeometry, sparkMaterial);
    lines.renderOrder = renderOrder;
    sparks.renderOrder = renderOrder + 1;
    group.add(lines, sparks);
    group.userData.lineMaterial = lineMaterial;
    group.userData.sparkMaterial = sparkMaterial;
    return group;
}

function updateNestedNeuralTreePart(part, progress, time, pulseConfig = {}) {
    if (!part) return;
    const pulse = resolveNestedFiberPulse({ fiberPulse: pulseConfig });
    const intensity = pulse.intensity;
    const sparkDensity = pulse.sparkDensity;
    const lineMaterial = part.userData.lineMaterial;
    const sparkMaterial = part.userData.sparkMaterial;
    if (lineMaterial?.uniforms) {
        lineMaterial.uniforms.u_growth.value = progress;
        lineMaterial.uniforms.u_opacity.value = Math.pow(progress, 0.82) * 0.88 * intensity;
        lineMaterial.uniforms.u_brightness.value = 0.75 + (progress * 2.2 * intensity);
    }
    if (sparkMaterial?.uniforms) {
        sparkMaterial.uniforms.u_growth.value = progress;
        sparkMaterial.uniforms.u_opacity.value = progress * sparkDensity;
        sparkMaterial.uniforms.u_density.value = progress * sparkDensity;
        sparkMaterial.uniforms.u_brightness.value = 0.8 + (progress * 2.8 * intensity);
        sparkMaterial.uniforms.u_time.value = time;
    }
    part.visible = progress > 0.015;
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
    const { stem, bloom } = createNestedNeuralTreeGeometry();
    const stemGroup = createNestedNeuralTreePart('nested-neural-tree-stem', stem, 22);
    const bloomGroup = createNestedNeuralTreePart('nested-neural-tree-bloom', bloom, 24);
    group.add(stemGroup, bloomGroup);
    group.userData.stem = stemGroup;
    group.userData.bloom = bloomGroup;
    group.userData.parts = [stemGroup, bloomGroup];
    group.userData.time = 0;
    return group;
}

function updateNestedNeuralTreeEffect(effect, progress, dt, pulseConfig = {}) {
    if (!effect) return;
    const p = clamp01(progress);
    effect.visible = p > 0.015;
    effect.userData.time = finite(effect.userData.time, 0) + dt;
    for (const part of effect.userData.parts || []) {
        updateNestedNeuralTreePart(part, p, effect.userData.time, pulseConfig);
    }
}

function deformFractalBrainPoint(source) {
    const y = source.y < -1
        ? -1 + ((source.y + 1) * 0.42)
        : source.y > 2.35
            ? 2.35 + ((source.y - 2.35) * 0.62)
            : source.y;
    const heightT = clamp01((y + 2.35) / 5.25);
    const crown = Math.sin(heightT * Math.PI);
    const lowerTaper = 0.62 + (0.38 * crown);
    const upperTaper = 0.76 + (0.24 * Math.sin(clamp01((y + 1.2) / 3.5) * Math.PI));
    const sideTaper = Math.min(lowerTaper, upperTaper);
    const frontBackTaper = 0.68 + (0.32 * crown);
    const hemispherePull = Math.sign(source.x) * Math.pow(Math.abs(source.x) / 3.4, 1.35) * 0.18;
    const foldedZ = (source.z * frontBackTaper * 0.62) - (Math.max(0, -y - 0.65) * 0.28);

    return new THREE.Vector3(
        (source.x * sideTaper * 0.72) - hemispherePull,
        y * 0.72,
        foldedZ
    );
}

function deformFractalBrainGeometry(geometry) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
        const deformed = deformFractalBrainPoint(new THREE.Vector3(
            position.getX(i),
            position.getY(i),
            position.getZ(i)
        ));
        position.setXYZ(i, deformed.x, deformed.y, deformed.z);
    }
    position.needsUpdate = true;
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
}

function makeFractalBranchClass(branchLen) {
    return class Branch {
        constructor(parent, pos, dir, treeId) {
            this.parent = parent;
            this.pos = pos;
            this.dir = dir.clone();
            this.origDir = dir.clone();
            this.count = 0;
            this.children = [];
            this.treeId = treeId;
            if (parent) parent.children.push(this);
            this.dist = parent ? parent.dist + parent.pos.distanceTo(pos) : 0;
        }

        reset() {
            this.dir.copy(this.origDir);
            this.count = 0;
        }

        next() {
            return new this.constructor(
                this,
                this.pos.clone().add(this.dir.clone().multiplyScalar(branchLen)),
                this.dir.clone(),
                this.treeId
            );
        }
    };
}

function createFractalBrainTreeGeometry({
    leafMaxDist = 30,
    leafMinDist = 0.8,
    branchLen = 0.5,
    maxIterations = 8000,
    rand = seededRandom(),
} = {}) {
    let leaves = [];
    let branches = [];
    const Branch = makeFractalBranchClass(branchLen);

    FRACTAL_TREE_LOBES.forEach((lobe, lobeIdx) => {
        for (let i = 0; i < lobe.leaves; i += 1) {
            const r = Math.cbrt(rand()) * 0.85;
            const theta = rand() * 2 * Math.PI;
            const phi = Math.acos((2 * rand()) - 1);
            leaves.push({
                pos: new THREE.Vector3(
                    (r * Math.sin(phi) * Math.cos(theta) * lobe.scale[0]) + lobe.pos[0],
                    (r * Math.sin(phi) * Math.sin(theta) * lobe.scale[1]) + lobe.pos[1],
                    (r * Math.cos(phi) * lobe.scale[2]) + lobe.pos[2]
                ),
                reached: false,
                treeId: lobeIdx,
            });
        }

        const xOff = (rand() - 0.5) * 0.4;
        const zOff = (rand() - 0.5) * 0.4;
        const root = new Branch(
            null,
            new THREE.Vector3(-0.3 + xOff, -4.2, -1.0 + zOff),
            new THREE.Vector3(0, 1, 0),
            lobeIdx
        );
        branches.push(root);

        let curr = root;
        for (let y = -3.7; y <= -0.5; y += branchLen) {
            const next = new Branch(
                curr,
                new THREE.Vector3(curr.pos.x, y, curr.pos.z + ((y + 3.7) * 0.1)),
                new THREE.Vector3(0, 1, 0),
                lobeIdx
            );
            branches.push(next);
            curr = next;
        }
    });

    let growing = true;
    let iterations = 0;
    while (growing && iterations < maxIterations) {
        iterations += 1;
        growing = false;

        for (const leaf of leaves) {
            let closestBranch = null;
            let record = leafMaxDist;

            for (const branch of branches) {
                if (branch.treeId !== leaf.treeId) continue;
                const d = leaf.pos.distanceTo(branch.pos);
                if (d < leafMinDist) {
                    leaf.reached = true;
                    closestBranch = null;
                    break;
                }
                if (d < record) {
                    closestBranch = branch;
                    record = d;
                }
            }

            if (closestBranch) {
                closestBranch.dir.add(leaf.pos.clone().sub(closestBranch.pos).normalize());
                closestBranch.count += 1;
                growing = true;
            }
        }

        leaves = leaves.filter((leaf) => !leaf.reached);

        for (let i = branches.length - 1; i >= 0; i -= 1) {
            const branch = branches[i];
            if (branch.count > 0) {
                branch.dir.divideScalar(branch.count + 1);
                branch.dir.add(randomUnitVector(rand).setLength(0.2)).normalize();
                branches.push(branch.next());
            }
            branch.reset();
        }
    }

    const rightBranches = [];
    const mirrorMap = new Map();
    for (const branch of branches) {
        const rPos = branch.pos.clone();
        rPos.x *= -1;
        const rDir = branch.dir.clone();
        rDir.x *= -1;
        const rBranch = new Branch(null, rPos, rDir, branch.treeId + 100);
        rBranch.dist = branch.dist;
        rightBranches.push(rBranch);
        mirrorMap.set(branch, rBranch);
    }

    for (const branch of branches) {
        const rBranch = mirrorMap.get(branch);
        if (branch.parent) rBranch.parent = mirrorMap.get(branch.parent);
        for (const child of branch.children) {
            rBranch.children.push(mirrorMap.get(child));
        }
    }
    branches = branches.concat(rightBranches);

    let maxDist = 0;
    for (const branch of branches) {
        maxDist = Math.max(maxDist, branch.dist);
        branch.pos.copy(deformFractalBrainPoint(branch.pos));
    }

    const positions = [];
    const p0s = [];
    const p1s = [];
    const d0s = [];
    const d1s = [];
    const isEnds = [];

    for (let i = 1; i < branches.length; i += 1) {
        const branch = branches[i];
        if (!branch.parent) continue;
        positions.push(branch.parent.pos.x, branch.parent.pos.y, branch.parent.pos.z);
        p0s.push(branch.parent.pos.x, branch.parent.pos.y, branch.parent.pos.z);
        p1s.push(branch.pos.x, branch.pos.y, branch.pos.z);
        d0s.push(branch.parent.dist);
        d1s.push(branch.dist);
        isEnds.push(0);

        positions.push(branch.pos.x, branch.pos.y, branch.pos.z);
        p0s.push(branch.parent.pos.x, branch.parent.pos.y, branch.parent.pos.z);
        p1s.push(branch.pos.x, branch.pos.y, branch.pos.z);
        d0s.push(branch.parent.dist);
        d1s.push(branch.dist);
        isEnds.push(1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('a_p0', new THREE.Float32BufferAttribute(p0s, 3));
    geometry.setAttribute('a_p1', new THREE.Float32BufferAttribute(p1s, 3));
    geometry.setAttribute('a_d0', new THREE.Float32BufferAttribute(d0s, 1));
    geometry.setAttribute('a_d1', new THREE.Float32BufferAttribute(d1s, 1));
    geometry.setAttribute('a_isEnd', new THREE.Float32BufferAttribute(isEnds, 1));
    return { geometry, maxDist, branches, treeCount: FRACTAL_TREE_LOBES.length * 2 };
}

function createFractalPulseBaseMaterial(maxDist) {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_color: { value: new THREE.Color(0xffffff) },
            u_progress: { value: 0 },
            u_trailLength: { value: 0.6 },
            u_net_progress: { value: 1 },
            u_maxDist: { value: maxDist },
            u_alpha: { value: 1 },
        },
        vertexShader: `
            attribute float a_percent;
            attribute float a_dist;
            varying float v_percent;
            varying float v_dist;
            void main() {
                v_percent = a_percent;
                v_dist = a_dist;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 u_color;
            uniform float u_progress;
            uniform float u_trailLength;
            uniform float u_net_progress;
            uniform float u_maxDist;
            uniform float u_alpha;
            varying float v_percent;
            varying float v_dist;
            void main() {
                if (v_dist > u_net_progress * u_maxDist) discard;
                float dist = u_progress - v_percent;
                if (dist < 0.0 || dist > u_trailLength) discard;
                float alpha = pow(1.0 - (dist / u_trailLength), 1.5) * u_alpha;
                vec3 glowColor = mix(u_color, vec3(1.0, 1.0, 0.8), smoothstep(0.1, 0.0, dist));
                gl_FragColor = vec4(glowColor * alpha * 2.0, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
}

function createFractalSparkMaterial(pointSize = DEFAULT_NESTED_TREE_EFFECT.fractalPulse.dotSizePx) {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_pointSize: { value: Math.max(0.5, finite(pointSize, DEFAULT_NESTED_TREE_EFFECT.fractalPulse.dotSizePx)) },
        },
        vertexShader: `
            uniform float u_pointSize;
            attribute float a_alpha;
            varying float v_alpha;
            void main() {
                v_alpha = a_alpha;
                gl_PointSize = u_pointSize;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying float v_alpha;
            void main() {
                if (v_alpha <= 0.0) discard;
                vec2 uv = gl_PointCoord - 0.5;
                float dist = length(uv);
                if (dist > 0.5) discard;
                vec3 color = vec3(1.0, 0.0, 0.0);
                color = mix(color, vec3(1.0, 0.7, 0.0), smoothstep(0.5, 0.2, dist));
                color = mix(color, vec3(1.0, 1.0, 1.0), smoothstep(0.2, 0.0, dist));
                float alpha = smoothstep(0.5, 0.0, dist) * v_alpha;
                gl_FragColor = vec4(color * 2.5, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
}

function buildFractalPulsePath(effect, params) {
    const branches = effect.userData.branches || [];
    const rand = effect.userData.rand || Math.random;
    if (branches.length === 0) return null;

    const pathBranches = [];
    if (rand() < params.rootRatio) {
        const roots = branches.filter((branch) => !branch.parent);
        let curr = roots[Math.floor(rand() * roots.length)];
        if (!curr) return null;
        pathBranches.push(curr);
        while (curr.children?.length > 0) {
            curr = curr.children[Math.floor(rand() * curr.children.length)];
            pathBranches.push(curr);
        }
    } else {
        let curr = branches[Math.floor(rand() * branches.length)];
        if (!curr) return null;
        const steps = 10 + Math.floor(rand() * 40);
        pathBranches.push(curr);
        for (let i = 0; i < steps; i += 1) {
            if (!curr.parent) break;
            curr = curr.parent;
            pathBranches.push(curr);
        }
        pathBranches.reverse();
    }

    return pathBranches.length >= 2 ? pathBranches : null;
}

function spawnFractalPulse(effect, params) {
    const pulses = effect.userData.pulses;
    if (!pulses || pulses.length >= params.concurrent) return;
    const pathBranches = buildFractalPulsePath(effect, params);
    if (!pathBranches) return;

    const positions = new Float32Array(pathBranches.length * 3);
    const percents = new Float32Array(pathBranches.length);
    const dists = new Float32Array(pathBranches.length);
    let totalLen = 0;
    const lengths = [0];
    for (let i = 1; i < pathBranches.length; i += 1) {
        totalLen += pathBranches[i].pos.distanceTo(pathBranches[i - 1].pos);
        lengths.push(totalLen);
    }
    if (totalLen <= 0) return;

    for (let i = 0; i < pathBranches.length; i += 1) {
        positions[i * 3] = pathBranches[i].pos.x;
        positions[(i * 3) + 1] = pathBranches[i].pos.y;
        positions[(i * 3) + 2] = pathBranches[i].pos.z;
        percents[i] = lengths[i] / totalLen;
        dists[i] = pathBranches[i].dist;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('a_percent', new THREE.BufferAttribute(percents, 1));
    geometry.setAttribute('a_dist', new THREE.BufferAttribute(dists, 1));
    const material = effect.userData.pulseBaseMaterial.clone();
    material.uniforms.u_maxDist.value = effect.userData.maxDist;
    material.uniforms.u_trailLength.value = params.trailLength;
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 24;
    const content = effect.userData.content || effect;
    content.add(line);
    pulses.push({
        mesh: line,
        material,
        progress: -0.1,
        speed: params.minSpeed + ((effect.userData.rand || Math.random)() * params.speedJitter),
        pathBranches,
        totalLen,
        lengths,
    });
}

function fractalPulseSparkPosition(pulse, targetDist, netProgress, maxDist) {
    if (targetDist < 0 || targetDist > pulse.totalLen) return null;
    for (let i = 0; i < pulse.lengths.length - 1; i += 1) {
        if (targetDist < pulse.lengths[i] || targetDist > pulse.lengths[i + 1]) continue;
        const segmentLen = pulse.lengths[i + 1] - pulse.lengths[i];
        const t = segmentLen > 0 ? (targetDist - pulse.lengths[i]) / segmentLen : 0;
        const currentDist = lerp(pulse.pathBranches[i].dist, pulse.pathBranches[i + 1].dist, t);
        if (currentDist <= netProgress * maxDist) {
            return new THREE.Vector3().lerpVectors(pulse.pathBranches[i].pos, pulse.pathBranches[i + 1].pos, t);
        }
        return null;
    }
    return null;
}

function updateFractalBrainTreeEffect(effect, progress, dt, pulseConfig = {}) {
    if (!effect) return;
    const p = clamp01(progress);
    const pulseConfigResolved = resolveNestedFractalPulse({ fractalPulse: pulseConfig });
    const pulseIntensity = pulseConfigResolved.intensity;
    effect.visible = p > 0.015;
    const maxSparks = Math.min(pulseConfigResolved.maxSparks, effect.userData.maxSparks || pulseConfigResolved.maxSparks);
    const sparkPositions = effect.userData.sparkPositions;
    const sparkAlphas = effect.userData.sparkAlphas;
    const sparkGeometry = effect.userData.sparkGeometry;
    const params = {
        concurrent: Math.max(0, Math.round(
            pulseConfigResolved.baseConcurrent + (p * pulseConfigResolved.concurrent * pulseIntensity)
        )),
        frequency: pulseConfigResolved.baseFrequency + (p * pulseConfigResolved.frequency * pulseIntensity),
        rootRatio: p * pulseConfigResolved.rootRatio,
        trailLength: pulseConfigResolved.trailLength,
        minSpeed: pulseConfigResolved.minSpeed,
        speedJitter: pulseConfigResolved.speedJitter,
    };

    const material = effect.userData.material;
    if (material?.uniforms) {
        material.uniforms.u_progress.value = p;
        material.uniforms.u_alpha.value = Math.pow(p, 1.15) * 0.72;
        material.uniforms.u_brightness.value = 0.4 + (p * 1.7);
    }

    const sparkMaterial = effect.userData.sparkMesh?.material;
    if (sparkMaterial?.uniforms?.u_pointSize) {
        sparkMaterial.uniforms.u_pointSize.value = pulseConfigResolved.dotSizePx;
    }

    if (p > 0.02 && pulseIntensity > 0 && (effect.userData.rand || Math.random)() < params.frequency * dt) {
        spawnFractalPulse(effect, params);
    }

    let sparkIdx = 0;
    const pulses = effect.userData.pulses || [];
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i];
        pulse.progress += pulse.speed * dt;
        pulse.material.uniforms.u_progress.value = pulse.progress;
        pulse.material.uniforms.u_net_progress.value = p;
        pulse.material.uniforms.u_alpha.value = p * Math.min(1, pulseIntensity);

        if (pulse.progress >= 0 && pulse.progress <= 1.2) {
            const baseDist = pulse.progress * pulse.totalLen;
            const offsets = pulseConfigResolved.tailSteps;
            const alphas = pulseConfigResolved.tailAlphas;
            for (let k = 0; k < offsets.length; k += 1) {
                const pos = fractalPulseSparkPosition(
                    pulse,
                    baseDist - offsets[k],
                    p,
                    effect.userData.maxDist
                );
                if (pos && sparkIdx < maxSparks) {
                    sparkPositions[sparkIdx * 3] = pos.x;
                    sparkPositions[(sparkIdx * 3) + 1] = pos.y;
                    sparkPositions[(sparkIdx * 3) + 2] = pos.z;
                    sparkAlphas[sparkIdx] = finite(alphas[k], 0) * p * Math.min(1, pulseIntensity);
                    sparkIdx += 1;
                }
            }
        }

        if (pulse.progress > 1.2 || p <= 0.001) {
            const content = effect.userData.content || effect;
            content.remove(pulse.mesh);
            pulse.mesh.geometry.dispose();
            pulse.material.dispose();
            pulses.splice(i, 1);
        }
    }

    for (let i = sparkIdx; i < maxSparks; i += 1) {
        sparkAlphas[i] = 0;
    }
    sparkGeometry.setDrawRange(0, sparkIdx);
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.a_alpha.needsUpdate = true;
    effect.userData.signalParams = params;
}

function createFractalBrainTreeEffect(pulseConfig = {}) {
    const group = new THREE.Group();
    group.name = 'fractal-brain-tree-effect';
    group.visible = false;
    const content = new THREE.Group();
    content.name = 'fractal-brain-tree-content';
    group.add(content);

    const transparentScaffold = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    for (const lobe of FRACTAL_TREE_LOBES) {
        const geo = new THREE.IcosahedronGeometry(1, 1);
        geo.scale(lobe.scale[0], lobe.scale[1], lobe.scale[2]);
        const left = geo.clone();
        left.translate(lobe.pos[0], lobe.pos[1], lobe.pos[2]);
        const right = geo.clone();
        right.translate(-lobe.pos[0], lobe.pos[1], lobe.pos[2]);
        deformFractalBrainGeometry(left);
        deformFractalBrainGeometry(right);
        content.add(new THREE.Mesh(left, transparentScaffold));
        content.add(new THREE.Mesh(right, transparentScaffold));
        geo.dispose();
    }

    const stemGeo = new THREE.CylinderGeometry(0.5, 0.3, 4.0, 8);
    stemGeo.translate(0, -3.5, -1.0);
    deformFractalBrainGeometry(stemGeo);
    content.add(new THREE.Mesh(stemGeo, transparentScaffold));

    const { geometry, maxDist, branches, treeCount } = createFractalBrainTreeGeometry();
    const material = new THREE.ShaderMaterial({
        uniforms: {
            u_progress: { value: 0 },
            u_maxDist: { value: maxDist },
            u_alpha: { value: 0 },
            u_brightness: { value: 0.35 },
            u_color: { value: new THREE.Color(0x00ffff) },
        },
        vertexShader: `
            attribute vec3 a_p0;
            attribute vec3 a_p1;
            attribute float a_d0;
            attribute float a_d1;
            attribute float a_isEnd;
            uniform float u_progress;
            uniform float u_maxDist;
            varying float v_opacity;
            void main() {
                float current_growth_dist = u_progress * u_maxDist;
                vec3 final_pos = position;
                v_opacity = 1.0;
                if (current_growth_dist <= a_d0) {
                    final_pos = a_p0;
                    v_opacity = 0.0;
                } else if (current_growth_dist < a_d1) {
                    if (a_isEnd > 0.5) {
                        float t = (current_growth_dist - a_d0) / max(0.0001, a_d1 - a_d0);
                        final_pos = mix(a_p0, a_p1, t);
                    } else {
                        final_pos = a_p0;
                    }
                }
                gl_Position = projectionMatrix * modelViewMatrix * vec4(final_pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 u_color;
            uniform float u_alpha;
            uniform float u_brightness;
            varying float v_opacity;
            void main() {
                if (v_opacity < 0.5 || u_alpha <= 0.001) discard;
                gl_FragColor = vec4(u_color * u_brightness, u_alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    });

    const network = new THREE.LineSegments(geometry, material);
    network.renderOrder = 21;
    content.add(network);

    const pulseConfigResolved = resolveNestedFractalPulse({ fractalPulse: pulseConfig });
    const maxSparks = pulseConfigResolved.maxSparks;
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(maxSparks * 3);
    const sparkAlphas = new Float32Array(maxSparks);
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('a_alpha', new THREE.BufferAttribute(sparkAlphas, 1));
    sparkGeometry.setDrawRange(0, 0);
    const sparkMesh = new THREE.Points(sparkGeometry, createFractalSparkMaterial(pulseConfigResolved.dotSizePx));
    sparkMesh.renderOrder = 25;
    content.add(sparkMesh);

    content.scale.set(0.046, 0.044, 0.04);
    content.position.set(0, 0.008, 0.004);
    group.userData.content = content;
    group.userData.network = network;
    group.userData.material = material;
    group.userData.scaffoldMaterial = transparentScaffold;
    group.userData.pulseBaseMaterial = createFractalPulseBaseMaterial(maxDist);
    group.userData.sparkGeometry = sparkGeometry;
    group.userData.sparkPositions = sparkPositions;
    group.userData.sparkAlphas = sparkAlphas;
    group.userData.sparkMesh = sparkMesh;
    group.userData.maxSparks = maxSparks;
    group.userData.pulses = [];
    group.userData.rand = seededRandom(0x51a9e1);
    group.userData.branches = branches;
    group.userData.maxDist = maxDist;
    group.userData.treeCount = treeCount;
    group.userData.fractalPulse = pulseConfigResolved;
    return group;
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

    const effect = effectConfig(item);
    if (!effect) {
        applyObjectTransform(modelHost, group.userData.radialItemModelTransform, DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
        modelHost.visible = group.userData.radialItemModelVisible;
        group.add(modelHost);
        const partHosts = createRadialItemPartHosts(item);
        group.userData.radialItemPartHosts = partHosts;
        for (const object of partHosts.values()) group.add(object);
        syncRadialItemPartConfig(group, item);
        return modelHost;
    }

    const composite = new THREE.Group();
    composite.name = `${item.id || 'radial-item'}-effect-composite`;
    applyObjectTransform(composite, resolveRadialItemModelTransform(item), DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
    composite.visible = resolveRadialItemModelVisibility(item);
    const fiberEffect = createNestedNeuralTreeEffect();
    fiberEffect.name = `${item.id || 'radial-item'}-fiber-optics`;
    const fiberStemEffect = fiberEffect.userData.stem;
    const fiberBloomEffect = fiberEffect.userData.bloom;
    const fractalTreeEffect = createFractalBrainTreeEffect(effect.fractalPulse);
    fractalTreeEffect.name = `${item.id || 'radial-item'}-fractal-tree`;
    applyNestedShellTransform(modelHost, effect.shellTransform);
    applyObjectTransform(fiberEffect, effect.fiberOpticsTransform, DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM);
    applyNestedFiberStemTransform(fiberStemEffect, effect.fiberStemTransform);
    applyNestedFiberBloomTransform(fiberBloomEffect, effect.fiberBloomTransform);
    applyNestedFractalTreeTransform(fractalTreeEffect, effect.fractalTreeTransform);
    composite.add(modelHost, fiberEffect, fractalTreeEffect);
    group.add(composite);
    group.userData.radialEffectConfig = effect;
    group.userData.radialEffectComposite = composite;
    group.userData.radialEffectTree = fiberEffect;
    group.userData.radialEffectFiber = fiberEffect;
    group.userData.radialEffectFiberStem = fiberStemEffect;
    group.userData.radialEffectFiberBloom = fiberBloomEffect;
    group.userData.radialEffectFractalTree = fractalTreeEffect;
    group.userData.radialEffectShellTransform = effect.shellTransform;
    group.userData.radialEffectFiberOpticsTransform = effect.fiberOpticsTransform;
    group.userData.radialEffectFiberStemTransform = effect.fiberStemTransform;
    group.userData.radialEffectFiberBloomTransform = effect.fiberBloomTransform;
    group.userData.radialEffectFractalTreeTransform = effect.fractalTreeTransform;
    group.userData.radialEffectFiberPulse = effect.fiberPulse;
    group.userData.radialEffectFractalPulse = effect.fractalPulse;
    group.userData.radialEffectVisibility = effect.visibility;
    group.userData.radialEffectState = {
        activation: 0,
        treeProgress: 0,
        fractalTreeProgress: 0,
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
    glyph.userData.radialItemModelTransform = resolveRadialItemModelTransform(item);
    glyph.userData.radialItemModelVisible = resolveRadialItemModelVisibility(item);
    glyph.userData.radialEffectShellTransform = effect.shellTransform;
    glyph.userData.radialEffectFiberOpticsTransform = effect.fiberOpticsTransform;
    glyph.userData.radialEffectFiberStemTransform = effect.fiberStemTransform;
    glyph.userData.radialEffectFiberBloomTransform = effect.fiberBloomTransform;
    glyph.userData.radialEffectFractalTreeTransform = effect.fractalTreeTransform;
    glyph.userData.radialEffectFiberPulse = effect.fiberPulse;
    glyph.userData.radialEffectFractalPulse = effect.fractalPulse;
    glyph.userData.radialEffectVisibility = effect.visibility;
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

function disposeMaterial(material) {
    forEachMaterial(material, (mat) => {
        mat.map?.dispose?.();
        mat.dispose?.();
    });
}

function disposeObject(object) {
    object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
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
    const fiberStem = glyph.userData.radialEffectFiberStem;
    const fiberBloom = glyph.userData.radialEffectFiberBloom;
    const fractalTree = glyph.userData.radialEffectFractalTree;
    const composite = glyph.userData.radialEffectComposite;
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
    const visibility = glyph.userData.radialEffectVisibility || config.visibility || DEFAULT_NESTED_TREE_EFFECT.visibility;
    if (composite) {
        applyObjectTransform(
            composite,
            glyph.userData.radialItemModelTransform,
            DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM
        );
        composite.visible = glyph.userData.radialItemModelVisible !== false;
    }
    applyNestedShellTransform(modelHost, glyph.userData.radialEffectShellTransform || config.shellTransform);
    if (modelHost) modelHost.visible = visibility.shell !== false;
    setManagedShellOpacity(glyph, state.shellOpacity * display, display);
    applyObjectTransform(
        tree,
        glyph.userData.radialEffectFiberOpticsTransform || config.fiberOpticsTransform,
        DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM
    );
    updateNestedNeuralTreeEffect(
        tree,
        state.treeProgress * display,
        dt,
        glyph.userData.radialEffectFiberPulse || config.fiberPulse
    );
    tree.visible = visibility.fiberOptics !== false && tree.visible;
    if (fiberStem) {
        applyNestedFiberStemTransform(
            fiberStem,
            glyph.userData.radialEffectFiberStemTransform || config.fiberStemTransform
        );
        fiberStem.visible = visibility.fiberOptics !== false && visibility.fiberStem !== false && fiberStem.visible;
    }
    if (fiberBloom) {
        applyNestedFiberBloomTransform(
            fiberBloom,
            glyph.userData.radialEffectFiberBloomTransform || config.fiberBloomTransform
        );
        fiberBloom.visible = visibility.fiberOptics !== false && visibility.fiberBloom !== false && fiberBloom.visible;
    }
    if (fractalTree) {
        state.fractalTreeProgress += (treeTarget - state.fractalTreeProgress) * (
            treeTarget >= state.fractalTreeProgress ? 0.14 : 0.1
        );
        updateFractalBrainTreeEffect(
            fractalTree,
            state.fractalTreeProgress * display,
            dt,
            glyph.userData.radialEffectFractalPulse || config.fractalPulse
        );
        fractalTree.visible = visibility.fractalTree !== false && fractalTree.visible;
        applyNestedFractalTreeTransform(
            fractalTree,
            glyph.userData.radialEffectFractalTreeTransform || config.fractalTreeTransform
        );
    }
    state.relation = relation;
    state.holding = holding;

    return {
        kind: config.kind,
        activation: state.activation,
        treeProgress: state.treeProgress,
        fiberProgress: state.treeProgress,
        fractalTreeProgress: state.fractalTreeProgress,
        shellOpacity: state.shellOpacity,
        relation,
        holding,
    };
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
        const sourceItemMotion = resolveItemMotion(source);

        for (const item of items) {
            const glyph = ensureGlyph(item);
            syncRadialItemModelConfig(glyph, item);
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
            applyRadialItemModelConfig(glyph);
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
            const hoverSpinSpeed = resolveRadialHoverSpinSpeed(item, {
                nativeGeometry,
                itemMotion: sourceItemMotion,
            });
            glyph.userData.hoverSpin = hoverSpinSpeed > 0
                ? finite(glyph.userData.hoverSpin, 0) + (dt * hoverProgress * hoverSpinSpeed)
                : 0;
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
