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

const WIKI_TREE_LOBES = [
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

function deformWikiBrainPoint(source) {
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

function deformWikiBrainGeometry(geometry) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
        const deformed = deformWikiBrainPoint(new THREE.Vector3(
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

function makeBranchClass(branchLen) {
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

function createWikiBrainNetworkGeometry({
    leafMaxDist = 30,
    leafMinDist = 0.8,
    branchLen = 0.5,
    maxIterations = 8000,
    rand = seededRandom(),
} = {}) {
    let leaves = [];
    let branches = [];
    const Branch = makeBranchClass(branchLen);

    WIKI_TREE_LOBES.forEach((lobe, lobeIdx) => {
        for (let i = 0; i < lobe.leaves; i += 1) {
            const r = Math.cbrt(rand()) * 0.85;
            const theta = rand() * 2 * Math.PI;
            const phi = Math.acos((2 * rand()) - 1);
            const x = (r * Math.sin(phi) * Math.cos(theta) * lobe.scale[0]) + lobe.pos[0];
            const y = (r * Math.sin(phi) * Math.sin(theta) * lobe.scale[1]) + lobe.pos[1];
            const z = (r * Math.cos(phi) * lobe.scale[2]) + lobe.pos[2];
            leaves.push({ pos: new THREE.Vector3(x, y, z), reached: false, treeId: lobeIdx });
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
    }

    for (const branch of branches) {
        branch.pos.copy(deformWikiBrainPoint(branch.pos));
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
    return { geometry, maxDist, branches, treeCount: WIKI_TREE_LOBES.length * 2 };
}

function createWikiBrainPulseBaseMaterial(maxDist) {
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

function createWikiBrainSparkMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: `
            attribute float a_alpha;
            varying float v_alpha;
            void main() {
                v_alpha = a_alpha;
                gl_PointSize = 2.4;
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

function buildPulsePath(effect, params) {
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

function spawnWikiBrainPulse(effect, params) {
    const pulses = effect.userData.pulses;
    if (!pulses || pulses.length >= params.concurrent) return;
    const pathBranches = buildPulsePath(effect, params);
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
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 22;
    effect.add(line);
    pulses.push({
        mesh: line,
        material,
        progress: -0.1,
        speed: 0.9 + ((effect.userData.rand || Math.random)() * 1.5),
        pathBranches,
        totalLen,
        lengths,
    });
}

function pulseSparkPosition(pulse, targetDist, netProgress, maxDist) {
    if (targetDist < 0 || targetDist > pulse.totalLen) return null;
    for (let i = 0; i < pulse.lengths.length - 1; i += 1) {
        if (targetDist < pulse.lengths[i] || targetDist > pulse.lengths[i + 1]) continue;
        const segmentLen = pulse.lengths[i + 1] - pulse.lengths[i];
        const t = segmentLen > 0 ? (targetDist - pulse.lengths[i]) / segmentLen : 0;
        const currentDist = THREE.MathUtils.lerp(pulse.pathBranches[i].dist, pulse.pathBranches[i + 1].dist, t);
        if (currentDist <= netProgress * maxDist) {
            return new THREE.Vector3().lerpVectors(pulse.pathBranches[i].pos, pulse.pathBranches[i + 1].pos, t);
        }
        return null;
    }
    return null;
}

function updateWikiBrainTreeEffect(effect, progress, dt) {
    const maxSparks = effect.userData.maxSparks || 300;
    const sparkPositions = effect.userData.sparkPositions;
    const sparkAlphas = effect.userData.sparkAlphas;
    const sparkGeometry = effect.userData.sparkGeometry;
    const params = {
        concurrent: Math.max(1, Math.round(1 + (progress * 19))),
        frequency: 1 + (progress * 14),
        rootRatio: progress * 0.8,
    };

    const material = effect.userData.material;
    if (material) {
        material.uniforms.u_progress.value = progress;
        material.uniforms.u_alpha.value = Math.pow(progress, 1.15) * 0.82;
        material.uniforms.u_brightness.value = 0.35 + (progress * 1.8);
    }

    if (progress > 0.02 && (effect.userData.rand || Math.random)() < params.frequency * dt) {
        spawnWikiBrainPulse(effect, params);
    }

    let sparkIdx = 0;
    const pulses = effect.userData.pulses || [];
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i];
        pulse.progress += pulse.speed * dt;
        pulse.material.uniforms.u_progress.value = pulse.progress;
        pulse.material.uniforms.u_net_progress.value = progress;
        pulse.material.uniforms.u_alpha.value = progress;

        if (pulse.progress >= 0 && pulse.progress <= 1.2) {
            const baseDist = pulse.progress * pulse.totalLen;
            const offsets = [0, 0.15, 0.3];
            const alphas = [1.0, 0.6, 0.15];
            for (let k = 0; k < offsets.length; k += 1) {
                const pos = pulseSparkPosition(
                    pulse,
                    baseDist - offsets[k],
                    progress,
                    effect.userData.maxDist
                );
                if (pos && sparkIdx < maxSparks) {
                    sparkPositions[sparkIdx * 3] = pos.x;
                    sparkPositions[(sparkIdx * 3) + 1] = pos.y;
                    sparkPositions[(sparkIdx * 3) + 2] = pos.z;
                    sparkAlphas[sparkIdx] = alphas[k] * progress;
                    sparkIdx += 1;
                }
            }
        }

        if (pulse.progress > 1.2 || progress <= 0.001) {
            effect.remove(pulse.mesh);
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

function createWikiBrainTreeEffect() {
    const group = new THREE.Group();
    group.name = 'wiki-brain-tree-effect';
    group.visible = false;

    const transparentScaffold = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    for (const lobe of WIKI_TREE_LOBES) {
        const geo = new THREE.IcosahedronGeometry(1, 1);
        geo.scale(lobe.scale[0], lobe.scale[1], lobe.scale[2]);
        const left = geo.clone();
        left.translate(lobe.pos[0], lobe.pos[1], lobe.pos[2]);
        const right = geo.clone();
        right.translate(-lobe.pos[0], lobe.pos[1], lobe.pos[2]);
        deformWikiBrainGeometry(left);
        deformWikiBrainGeometry(right);
        group.add(new THREE.Mesh(left, transparentScaffold));
        group.add(new THREE.Mesh(right, transparentScaffold));
        geo.dispose();
    }

    const stemGeo = new THREE.CylinderGeometry(0.5, 0.3, 4.0, 8);
    stemGeo.translate(0, -3.5, -1.0);
    deformWikiBrainGeometry(stemGeo);
    group.add(new THREE.Mesh(stemGeo, transparentScaffold));

    const { geometry, maxDist, branches, treeCount } = createWikiBrainNetworkGeometry();
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
    group.add(network);

    const maxSparks = 300;
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(maxSparks * 3);
    const sparkAlphas = new Float32Array(maxSparks);
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('a_alpha', new THREE.BufferAttribute(sparkAlphas, 1));
    sparkGeometry.setDrawRange(0, 0);
    const sparkMesh = new THREE.Points(sparkGeometry, createWikiBrainSparkMaterial());
    sparkMesh.renderOrder = 23;
    group.add(sparkMesh);

    group.scale.set(0.046, 0.044, 0.04);
    group.position.set(0, 0.008, 0.004);
    group.userData.network = network;
    group.userData.material = material;
    group.userData.scaffoldMaterial = transparentScaffold;
    group.userData.pulseBaseMaterial = createWikiBrainPulseBaseMaterial(maxDist);
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
    const modelHost = group.userData.wikiBrainModelHost || group;
    disposeChildren(modelHost);
    const fallback = createFallbackForItem(item);
    modelHost.add(fallback);
    group.userData.baseRadius = glyphSceneRadius(fallback);
    group.userData.geometryStatus = status;
    group.userData.geometryError = error;
}

function normalizeModelScene(object, targetRadius = 0.28) {
    const box = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return targetRadius;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    if (!Number.isFinite(radius) || radius <= 0) return targetRadius;
    object.position.sub(center);
    object.scale.multiplyScalar(targetRadius / radius);
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

function vectorAngles(value = {}, fallback = {}) {
    if (Array.isArray(value)) {
        return {
            x: finite(value[0], fallback.x ?? 0),
            y: finite(value[1], fallback.y ?? 0),
            z: finite(value[2], fallback.z ?? 0),
        };
    }
    return {
        x: finite(value.x, fallback.x ?? 0),
        y: finite(value.y, fallback.y ?? 0),
        z: finite(value.z, fallback.z ?? 0),
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

function applyTranslucentBrainMaterial(object, options = {}) {
    const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(options.color || '#8feeff'),
        emissive: new THREE.Color(options.emissive || '#0d2630'),
        specular: new THREE.Color(options.specular || '#c8fbff'),
        shininess: finite(options.shininess, 70),
        transparent: true,
        opacity: finite(options.opacity, 0.28),
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    object.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry && !child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals?.();
        }
        child.material = material;
        child.renderOrder = 20;
    });
}

function applyGeometryMaterial(object, geometry = {}) {
    if (geometry.material === 'source-emissive') {
        applySourceEmissiveMaterial(object, geometry.materialOptions || {});
        return;
    }
    if (geometry.material === 'translucent-brain') {
        applyTranslucentBrainMaterial(object, geometry.materialOptions || {});
        return;
    }
    if (geometry.material === 'sigil-hologram') {
        applySigilHologramMaterial(object);
    }
}

function createWikiBrainComposite(group) {
    const composite = new THREE.Group();
    composite.name = 'wiki-brain-composite';

    const modelHost = new THREE.Group();
    modelHost.name = 'wiki-brain-model-host';
    composite.add(modelHost);

    const treeEffect = createWikiBrainTreeEffect();
    treeEffect.name = 'wiki-brain-tree-host';
    composite.add(treeEffect);

    group.add(composite);
    group.userData.wikiBrainComposite = composite;
    group.userData.wikiBrainModelHost = modelHost;
    group.userData.wikiBrainTrees = treeEffect;
    return { composite, modelHost, treeEffect };
}

function createGltfGlyph(item = {}) {
    const group = new THREE.Group();
    const modelHost = isWikiBrainItem(item) ? createWikiBrainComposite(group).modelHost : group;
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

function isWikiBrainItem(item = {}) {
    return item.action === 'wikiGraph' || item.id === 'wiki-graph';
}

function forEachMaterial(material, visit) {
    if (Array.isArray(material)) {
        material.forEach((mat) => mat && visit(mat));
    } else if (material) {
        visit(material);
    }
}

const highlightColor = new THREE.Color('#ffffff');

function updateMaterialHighlight(material, { active, progress, falloff }) {
    forEachMaterial(material, (mat) => {
        const baseOpacity = Number(mat.userData?.baseOpacity ?? mat.opacity ?? 1);
        mat.userData.baseOpacity = baseOpacity;
        mat.opacity = baseOpacity * Math.min(1, progress * falloff * (active ? 1.5 : 1.2));

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

export function createSigilRadialGestureVisuals({ scene, projectPoint, projectRadius } = {}) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 20;
    scene.add(group);
    const glyphs = new Map();
    let lastState = { visible: false, count: 0, itemIds: [], scales: {} };
    let lastRadial = null;
    let displayProgress = 0;
    let falloffProgress = 1;
    let lastUpdateTime = null;

    function ensureGlyph(item) {
        const id = item.id || 'item';
        let glyph = glyphs.get(id);
        if (glyph) return glyph;
        glyph = createGlyph(item);
        glyph.userData.itemId = id;
        glyph.userData.baseRadius = glyphSceneRadius(glyph);
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

    function visualFalloff(radial) {
        if (!radial || radial.phase !== 'fastTravel') return 1;
        const outer = Math.max(1, finite(radial.radii?.handoff, radial.radii?.menu ?? 1));
        const maxDistance = outer * 1.5;
        const distance = finite(radial.distance, 0);
        const t = Math.max(0, Math.min(1, (distance - outer) / Math.max(1, maxDistance - outer)));
        return 1 - (0.5 * t);
    }

    function update(radial, { time = 0 } = {}) {
        const frameTime = finite(time, 0);
        const dt = lastUpdateTime == null ? 0.016 : Math.max(0, Math.min(0.05, frameTime - lastUpdateTime));
        lastUpdateTime = frameTime;
        const visualRadial = radial?.phase === 'radial' || radial?.phase === 'fastTravel' ? radial : null;
        const activeRadial = radial?.phase === 'radial' ? radial : null;
        if (activeRadial) lastRadial = activeRadial;
        if (visualRadial?.phase === 'fastTravel' && lastRadial) {
            lastRadial = {
                ...lastRadial,
                ...visualRadial,
                items: lastRadial.items,
            };
        }
        const source = visualRadial || lastRadial;
        const targetProgress = visualRadial
            ? Math.max(0.08, Number(visualRadial.menuProgress) || 0)
            : 0;
        const smoothing = visualRadial ? 0.42 : 0.28;
        displayProgress += (targetProgress - displayProgress) * smoothing;
        falloffProgress += (visualFalloff(radial) - falloffProgress) * (visualRadial ? 0.26 : 0.18);

        if (!source || displayProgress <= 0.015) {
            group.visible = false;
            displayProgress = 0;
            falloffProgress = 1;
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

        for (const item of items) {
            const glyph = ensureGlyph(item);
            const projected = projectPoint?.(item.center);
            glyph.visible = !!projected;
            if (!projected) continue;
            const active = activeRadial && item.id === source.activeItemId;
            glyph.userData.hoverProgress += ((active ? 1 : 0) - glyph.userData.hoverProgress) * 0.22;
            const hoverProgress = glyph.userData.hoverProgress;
            glyph.position.copy(projected);
            glyph.traverse((child) => {
                updateMaterialHighlight(child.material, { active, progress, falloff: falloffProgress });
            });
            const itemRadius = finite(item.visualRadius, 14);
            const sceneRadius = projectRadius?.(item.center, itemRadius) ?? 0.24;
            const baseRadius = finite(glyph.userData.baseRadius, 0.25);
            const radiusScale = finite(item.geometry?.radiusScale ?? item.radiusScale, 1);
            const targetScale = (sceneRadius / Math.max(0.01, baseRadius)) * radiusScale * (1 + hoverProgress * 0.08) * progress * falloffProgress;
            glyph.scale.setScalar(targetScale);
            glyph.userData.hoverSpin += hoverProgress * dt * 1.35;
            const spin = glyph.userData.hoverSpin;
            const wikiTrees = glyph.userData.wikiBrainTrees;
            if (wikiTrees) {
                const treeProgress = hoverProgress * progress * falloffProgress;
                wikiTrees.visible = treeProgress > 0.01 && targetScale > 0.001;
                const treeScale = 0.82 + (treeProgress * 0.18);
                wikiTrees.position.set(0, 0.008, 0.004);
                wikiTrees.scale.set(
                    0.046 * treeScale,
                    0.044 * treeScale,
                    0.04 * treeScale
                );
                wikiTrees.rotation.set(0, 0, 0);
                updateWikiBrainTreeEffect(wikiTrees, treeProgress, dt);
            }
            scales[item.id || 'item'] = targetScale;
            if (glyph.userData.geometryKind) {
                geometry[item.id || 'item'] = {
                    type: glyph.userData.geometryKind,
                    status: glyph.userData.geometryStatus || 'unknown',
                    title: glyph.userData.geometryTitle || null,
                    url: glyph.userData.geometryUrl || null,
                    error: glyph.userData.geometryError || null,
                    size: glyph.userData.geometrySize || null,
                };
            }
            const nativeGeometry = !!glyph.userData.geometryKind;
            glyph.rotation.x = nativeGeometry ? 0 : 0.08;
            glyph.rotation.y = (nativeGeometry ? 0 : finite(item.angle, 0) * 0.004) + spin;
            glyph.rotation.z = 0;
        }

        lastState = {
            visible: true,
            count: items.length,
            itemIds: [...glyphs.keys()],
            activeItemId: activeRadial ? (source.activeItemId || null) : null,
            scales,
            geometry,
            falloff: falloffProgress,
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
        falloffProgress = 1;
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
