import state from './state.js';

// --- Turbulence noise ---
export function getTurbulence(time, speed, mode, index, count, seed) {
    let t = time * speed;
    let phase = 0;
    if (mode === 'staggered') {
        phase = count > 1 ? index * (Math.PI * 2 / count) : 0;
    } else if (mode === 'random') {
        phase = seed * Math.PI * 2;
    }
    return (Math.sin(t + phase) + Math.sin(1.72 * t + phase * 1.5 + 1.2) + Math.sin(2.31 * t + phase * 0.7 + 2.5)) / 3.0;
}

// --- Fibonacci hemisphere distribution ---
function distributeGroupChildren(group, count) {
    if (!group) return;
    const phi = Math.PI * (3.0 - Math.sqrt(5.0));
    for (let i = 0; i < group.children.length; i++) {
        let child = group.children[i];
        if (i < count) {
            child.visible = true;
            let y = 1.0 - (i / count);
            let radius = Math.sqrt(1 - y * y);
            let theta = phi * i;
            let dir = new THREE.Vector3(radius * Math.cos(theta), y, radius * Math.sin(theta)).normalize();
            child.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        } else {
            child.visible = false;
        }
    }
}

/**
 * DRY: Shared instance count syncer for phenomena groups.
 */
function syncGroupInstanceCount(group, count, createItemFn) {
    if (!group) return;
    while (group.children.length < count) {
        let item = createItemFn();
        if (item) {
            item.userData.seed = Math.random();
            group.add(item);
        }
    }
    distributeGroupChildren(group, count);
}

// --- Multi-instance update functions ---
export function updatePulsars(count) {
    syncGroupInstanceCount(state.pulsarGroup, count, () => {
        if (!state.pulsarGeo || !state.beamMat) return null;
        return new THREE.Mesh(state.pulsarGeo, state.beamMat);
    });
}

export function updateGammaRays(count) {
    syncGroupInstanceCount(state.gammaRaysGroup, count, () => {
        if (!state.gammaGeo || !state.gammaBeamMat) return null;
        return new THREE.Mesh(state.gammaGeo, state.gammaBeamMat);
    });
}

export function updateAccretion(count) {
    syncGroupInstanceCount(state.accretionGroup, count, () => {
        if (!state.diskMat) return null;
        let singleDiskGroup = new THREE.Group();
        let diskMesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 4.0, 128), state.diskMat);
        diskMesh.rotation.x = Math.PI / 2;
        singleDiskGroup.add(diskMesh);

        for (let i = 0; i < 10; i++) {
            let rMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
                transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            rMesh.rotation.x = Math.PI / 2;
            rMesh.position.y = 0.01 + (i * 0.002);
            singleDiskGroup.add(rMesh);
            state.accretionRings.push({
                mesh: rMesh,
                radius: 4.0 * (i / 10),
                targetW: 4.0 * (0.1 + Math.random() * 0.2),
                targetOp: 0.5 + Math.random() * 0.25
            });
        }
        return singleDiskGroup;
    });
}

export function updateNeutrinos(count) {
    syncGroupInstanceCount(state.neutrinoGroup, count, () => {
        if (!state.neutrinoMat) return null;
        let jetGroup = new THREE.Group();
        for (let i = 0; i < 30; i++) {
            let p = new THREE.Sprite(state.neutrinoMat);
            p.scale.set(0.12, 0.12, 1);
            jetGroup.add(p);
            state.neutrinoParticles.push({
                mesh: p,
                parentJet: jetGroup,
                seed: Math.random(),
                yPos: (Math.random() - 0.5) * 8.0,
                speed: Math.random() * 2.5 + 1.5,
                dir: Math.random() > 0.5 ? 1 : -1,
                xOffset: (Math.random() - 0.5) * 0.075,
                zOffset: (Math.random() - 0.5) * 0.075
            });
        }
        return jetGroup;
    });
}

export function createPhenomena() {
    // Pulsar Beams
    state.pulsarGroup = new THREE.Group();
    state.pulsarGroup.visible = false;

    state.pulsarGeo = new THREE.CylinderGeometry(0.15, 0.15, 4.0, 16, 16, true);
    const beamPos = state.pulsarGeo.attributes.position;
    for (let i = 0; i < beamPos.count; i++) {
        let scale = 1.0 - 0.5 * (Math.abs(beamPos.getY(i)) / 2.0);
        beamPos.setX(i, beamPos.getX(i) * scale);
        beamPos.setZ(i, beamPos.getZ(i) * scale);
    }
    state.pulsarGeo.computeVertexNormals();

    state.beamMat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    state.polyGroup.add(state.pulsarGroup);
    updatePulsars(state.pulsarRayCount);

    // Gamma Rays
    state.gammaRaysGroup = new THREE.Group();
    state.gammaRaysGroup.visible = false;

    state.gammaBeamMat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    state.gammaGeo = new THREE.CylinderGeometry(0.02, 0.02, 15.0, 16, 1, true);
    state.polyGroup.add(state.gammaRaysGroup);
    updateGammaRays(state.gammaRayCount);

    // Accretion Disk
    state.accretionGroup = new THREE.Group();
    state.accretionGroup.visible = false;

    state.diskMat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.15, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    state.polyGroup.add(state.accretionGroup);
    updateAccretion(state.accretionDiskCount);

    // True Point Flash
    let ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    state.flashVoxel = new THREE.Points(ptGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false
    }));
    state.polyGroup.add(state.flashVoxel);

    // Neutrinos
    state.neutrinoGroup = new THREE.Group();
    state.neutrinoGroup.visible = false;
    state.neutrinoMat = new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false });
    state.polyGroup.add(state.neutrinoGroup);
    updateNeutrinos(state.neutrinoJetCount);
}

export function animatePhenomena(dt) {
    const turb = state.turbState;
    const gt = state.globalTime;

    // --- Turbulence trainee ---
    const applyTurbulence = (group, config, baseStretch, baseBulge = 0) => {
        if (!group || !group.visible) return;
        const count = group.children.length;
        for (let i = 0; i < count; i++) {
            const m = group.children[i];
            if (!m.visible) continue;
            const noise = getTurbulence(gt, config.spd, config.mod, i, count, m.userData.seed);
            const stretch = 1.0 + noise * config.val * baseStretch;
            if (baseBulge > 0) {
                const bulge = 1.0 + noise * config.val * baseBulge;
                m.scale.set(bulge, stretch, bulge);
            } else {
                m.scale.set(1.0, stretch, 1.0);
            }
        }
    };

    applyTurbulence(state.pulsarGroup, turb.p, 3.0, 0.5);
    applyTurbulence(state.gammaRaysGroup, turb.g, 5.0);

    // --- Accretion disk turbulence + ring animation ---
    if (state.isAccretionEnabled && state.accretionRings) {
        let triggeredFlash = false;
        let c = state.accretionDiskCount;
        const c1 = new THREE.Color(state.colors.accretion[0]);
        const c2 = new THREE.Color(state.colors.accretion[1]);

        // Group-level turbulence
        for (let i = 0; i < state.accretionGroup.children.length; i++) {
            let diskGrp = state.accretionGroup.children[i];
            if (!diskGrp.visible) continue;
            let nX = getTurbulence(gt, turb.a.spd, turb.a.mod, i, c, diskGrp.userData.seed);
            let nY = getTurbulence(gt, turb.a.spd, turb.a.mod, i, c, diskGrp.userData.seed * 1.5);
            let scaleXY = 1.0 + nX * turb.a.val * 0.8;
            diskGrp.scale.set(scaleXY, 1.0 + Math.abs(nY) * turb.a.val * 2.0, scaleXY);
            diskGrp.children.forEach(mesh => {
                mesh.rotation.x = Math.PI / 2 + nX * turb.a.val * 0.4;
                mesh.rotation.y = nY * turb.a.val * 0.4;
            });
        }

        // Ring animation
        state.accretionRings.forEach(ring => {
            let speed = 0.2 + (1.5 / Math.max(ring.radius, 0.4));
            ring.radius -= speed * dt;

            if (ring.radius <= 0) {
                ring.radius = 4.0;
                ring.targetW = 4.0 * (0.1 + Math.random() * 0.2);
                ring.targetOp = 0.5 + Math.random() * 0.25;
                triggeredFlash = true;
            }

            let currentR = ring.radius;
            let currentW = 0.01;
            let currentOp = 0;

            if (currentR > 3.0) {
                let t = (4.0 - currentR) / 1.0;
                currentW = 0.01 + (ring.targetW - 0.01) * t;
                currentOp = ring.targetOp * t;
            } else if (currentR > 1.0) {
                currentW = ring.targetW;
                currentOp = ring.targetOp;
            } else {
                let t = currentR / 1.0;
                currentW = ring.targetW * Math.max(t, 0.001);
                currentOp = ring.targetOp;
            }

            if (currentR > 0.001) {
                ring.mesh.visible = true;
                if (ring.mesh.geometry) ring.mesh.geometry.dispose();
                let innerR = Math.max(0.0001, currentR - currentW / 2);
                let outerR = Math.max(innerR + 0.0001, currentR + currentW / 2);
                ring.mesh.geometry = new THREE.RingGeometry(innerR, outerR, 128);
                ring.mesh.material.opacity = currentOp;
                ring.mesh.material.color.copy(c1).lerp(c2, currentR / 4.0);
            } else {
                ring.mesh.visible = false;
            }
        });

        if (triggeredFlash) state.voxelFlashTimer = 1.0;
    } else {
        state.voxelFlashTimer = 0;
    }

    // Voxel Flash
    if (state.voxelFlashTimer > 0) {
        state.voxelFlashTimer -= dt * 6.0;
        if (state.flashVoxel) state.flashVoxel.material.opacity = Math.max(0, state.voxelFlashTimer);
    } else if (state.flashVoxel) {
        state.flashVoxel.material.opacity = 0;
    }

    // --- Neutrino turbulence ---
    if (state.isNeutrinosEnabled && state.neutrinoParticles) {
        // Compute per-jet noise
        let c = state.neutrinoJetCount;
        for (let i = 0; i < state.neutrinoGroup.children.length; i++) {
            let grp = state.neutrinoGroup.children[i];
            if (!grp.visible) continue;
            grp.userData.currentNoise = getTurbulence(gt, turb.n.spd, turb.n.mod, i, c, grp.userData.seed);
        }

        state.neutrinoParticles.forEach(p => {
            let noise = (p.parentJet && p.parentJet.userData.currentNoise) || 0;
            let spdMult = 1.0 + noise * turb.n.val * 3.0;

            p.yPos += p.speed * p.dir * dt * 3.0 * spdMult;

            // Scatter sideways
            p.xOffset += Math.cos(gt * 10 + p.seed) * turb.n.val * 0.01;
            p.zOffset += Math.sin(gt * 10 + p.seed) * turb.n.val * 0.01;

            if (Math.abs(p.yPos) > 3.5) {
                p.yPos = 0;
                let r = Math.random() * 0.075 + Math.abs(noise) * turb.n.val * 0.2;
                let th = Math.random() * Math.PI * 2;
                p.xOffset = r * Math.cos(th);
                p.zOffset = r * Math.sin(th);
            }
            p.mesh.position.set(p.xOffset, p.yPos, p.zOffset);
            p.mesh.material.opacity = 1.0 - (Math.abs(p.yPos) / 3.5);
        });
    }
}
