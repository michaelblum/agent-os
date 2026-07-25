import {
    DEFAULT_NESTED_TREE_EFFECT,
    resolveNestedFiberPulse,
    resolveNestedFractalPulse,
} from '../../live-modules/radial-object-control.js';

function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}


const FRACTAL_TREE_LOBES = [
    { name: 'Hemisphere', pos: [-1.3, 1.4, -0.2], scale: [2.0, 2.8, 3.8], leaves: 150 },
    { name: 'Cerebellum', pos: [-1.0, -1.8, -2.8], scale: [1.4, 0.9, 1.5], leaves: 40 },
    { name: 'Temporal', pos: [-2.2, 0.2, 0.5], scale: [1.2, 1.4, 2.4], leaves: 40 },
    { name: 'Occipital', pos: [-1.0, 0.8, -3.4], scale: [1.3, 1.5, 1.6], leaves: 40 },
    { name: 'Parietal', pos: [-1.3, 2.6, -0.8], scale: [1.5, 1.4, 2.0], leaves: 40 },
    { name: 'Frontal', pos: [-1.3, 1.8, 2.2], scale: [1.6, 2.0, 2.4], leaves: 40 },
];

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

export {
    createFractalBrainTreeEffect as createFractalTree,
    createNestedNeuralTreeEffect as createFiberTree,
    updateFractalBrainTreeEffect as updateFractalTree,
    updateNestedNeuralTreeEffect as updateFiberTree,
};
