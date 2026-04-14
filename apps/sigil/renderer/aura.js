import state from './state.js';
import { drawAuraTexture, drawWhiteDwarf, updateMaterialTexture } from './colors.js';
import { updatePulsars, updateGammaRays } from './phenomena.js';

export function createAuraObjects() {
    // 1. Glow Sprite (Reach)
    state.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    state.scene.add(state.glowSprite);

    // 2. Core Sprite (Intensity)
    state.coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    state.scene.add(state.coreSprite);

    // 3. Super Charge Spheroid
    state.chargeSpheroid = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    state.chargeSpheroid.visible = false;
    state.scene.add(state.chargeSpheroid);

    // 4. White Dwarf
    state.whiteDwarfSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    updateMaterialTexture(state.whiteDwarfSprite.material, drawWhiteDwarf);
    state.whiteDwarfSprite.visible = false;
    state.scene.add(state.whiteDwarfSprite);
}

export function computeAuraPosition() {
    let auraPos = state.polyGroup.position.clone();
    let auraScaleMult = 1.0;

    if (state.isMaskEnabled) {
        const pushBackDist = 5.0;
        if (state.camera.isPerspectiveCamera) {
            const sightLine = new THREE.Vector3().subVectors(state.polyGroup.position, state.camera.position).normalize();
            auraPos.addScaledVector(sightLine, pushBackDist);
            const distToObject = state.camera.position.distanceTo(state.polyGroup.position);
            const distToAura = state.camera.position.distanceTo(auraPos);
            auraScaleMult = (distToAura / distToObject);
        } else {
            let camDir = new THREE.Vector3();
            state.camera.getWorldDirection(camDir);
            auraPos.addScaledVector(camDir, pushBackDist);
        }
    }

    return { auraPos, auraScaleMult };
}

export function animateAura(dt) {
    const { auraPos, auraScaleMult } = computeAuraPosition();

    state.auraSpike *= 0.92;
    const baseScale = 4.0 * state.auraReach * state.z_depth;
    const pulseOffset = Math.sin(Date.now() * state.auraPulseRate) * (0.4 * state.auraReach) * state.z_depth;
    const spikeBonus = baseScale * (state.spikeMultiplier - 1.0) * state.auraSpike;

    let reachScale = baseScale + pulseOffset + spikeBonus;
    state.forceAuraVisible = false;

    if (state.isCharging) {
        state.chargeTime += dt;
        state.chargeLevel = Math.min(state.chargeTime / 3.0, 1.0);

        if (state.chargeLevel >= 1.0) {
            const btnSupercharge = document.getElementById('btn-supercharge');
            if (btnSupercharge) btnSupercharge.classList.add('vibrate');
        }

        // --- Inward particles (spawn rate increases over time) ---
        if (state.chargeLevel >= 0.7) {
            let spawnRate = 0.4 + state.chargeLevel * 0.3 + Math.min(state.chargeTime * 0.1, 2.0);
            let spawnCount = Math.floor(spawnRate);
            if (Math.random() < (spawnRate - spawnCount)) spawnCount++;
            for (let j = 0; j < spawnCount; j++) {
                let p = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: state.glowSprite.material.map, color: 0xffffff,
                    blending: THREE.AdditiveBlending, depthWrite: false
                }));
                let dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                let dist = 3 + Math.random() * 4;
                let spawnPos = state.polyGroup.position.clone().add(dir.multiplyScalar(dist * state.z_depth));
                p.position.copy(spawnPos);
                let s = (0.3 + Math.random() * 0.4) * state.z_depth;
                p.scale.set(s, s, 1);
                state.scene.add(p);
                state.inwardParticles.push({ mesh: p, start: spawnPos, life: 1.0 });
            }
        }

        const chargeFill = document.getElementById('charge-fill');
        if (chargeFill) chargeFill.style.width = (state.chargeLevel * 100) + '%';

        state.forceAuraVisible = true;
        let shrinkFactor = 1.0 - (0.5 * state.chargeLevel);
        reachScale = baseScale * shrinkFactor;

        if (state.chargeLevel >= 1.0) reachScale += Math.random() * 0.3;

        // Core Spheroid Growth
        state.chargeSpheroid.visible = true;
        state.chargeSpheroid.position.copy(auraPos);
        let maxSpheroidScale = state.z_depth * 1.5;
        let sScale = maxSpheroidScale * state.chargeLevel;
        state.chargeSpheroid.userData.currentScale = sScale;
        state.chargeSpheroid.scale.set(sScale * auraScaleMult, sScale * auraScaleMult, 1);

        // --- Charge flare spires ---
        for (let i = 0; i < 6; i++) {
            let startTime = i * 0.4;
            if (state.chargeTime > startTime) {
                state.chargeFlares[i].visible = true;
                let activeTime = state.chargeTime - startTime;
                let s = 0;

                if (activeTime < 1.5) {
                    let progress = activeTime / 1.5;
                    s = Math.floor(progress * 10) / 10 * 2.0;
                } else {
                    if (Math.random() < 0.2) state.chargeFlares[i].userData.targetS = 1.0 + Math.random() * 1.0;
                    let currentS = state.chargeFlares[i].scale.x;
                    s = currentS + (state.chargeFlares[i].userData.targetS - currentS) * 0.3;
                }

                state.chargeFlares[i].userData.lastScale = s;
                state.chargeFlares[i].scale.setScalar(s);

                let rTime = Math.min(activeTime, 3.0);
                let speed = 0.08 * Math.pow(2, rTime);
                state.chargeFlares[i].userData.lastSpeed = speed;

                if (i % 2 === 0) state.chargeFlares[i].rotateZ(speed * dt * 50);
                else state.chargeFlares[i].rotateZ(-speed * dt * 50);
            } else {
                state.chargeFlares[i].visible = false;
            }
        }

        // --- Charge beam sequence ---
        // Save pre-charge state on first frame
        if (!state.chargeSequence) {
            state.chargeSequence = {
                prePulsarEnabled: state.isPulsarEnabled,
                prePulsarCount: state.pulsarRayCount,
                preGammaEnabled: state.isGammaEnabled,
                preGammaCount: state.gammaRayCount,
                prePulsarTurb: { ...state.turbState.p },
                preGammaTurb: { ...state.turbState.g },
                beamCount: 0
            };
            // Force pulsars visible with 0 count initially
            state.isPulsarEnabled = true;
            state.pulsarRayCount = 0;
            if (state.pulsarGroup) state.pulsarGroup.visible = true;
            updatePulsars(0);
            // Set turbulence for charge effect
            state.turbState.p.val = 0.6;
            state.turbState.p.spd = 1.0;
            state.turbState.p.mod = 'uniform';
        }

        // Beam schedule: one every 500ms
        let targetBeams = Math.floor(state.chargeTime / 0.5);
        let seq = state.chargeSequence;

        if (targetBeams > seq.beamCount) {
            seq.beamCount = targetBeams;

            if (seq.beamCount <= 10) {
                // Phase 1: Pulsars 1-10, uniform
                state.pulsarRayCount = seq.beamCount;
                updatePulsars(seq.beamCount);
                state.turbState.p.spd = 1.0 + seq.beamCount * 0.5;
            } else if (seq.beamCount <= 15) {
                // Phase 2: Pulsars 11-15, random
                if (seq.beamCount === 11) state.turbState.p.mod = 'random';
                state.pulsarRayCount = seq.beamCount;
                updatePulsars(seq.beamCount);
                state.turbState.p.spd = 1.0 + seq.beamCount * 0.5;
            } else if (seq.beamCount <= 25) {
                // Phase 3: Gamma rays 1-10, uniform
                let gammaCount = seq.beamCount - 15;
                if (gammaCount === 1) {
                    state.isGammaEnabled = true;
                    state.gammaRayCount = 0;
                    if (state.gammaRaysGroup) state.gammaRaysGroup.visible = true;
                    state.turbState.g.val = 0.6;
                    state.turbState.g.spd = 1.0;
                    state.turbState.g.mod = 'uniform';
                }
                state.gammaRayCount = gammaCount;
                updateGammaRays(gammaCount);
                state.turbState.g.spd = 1.0 + gammaCount * 0.5;
            } else if (seq.beamCount <= 30) {
                // Phase 4: Gamma rays 11-15, random
                let gammaCount = seq.beamCount - 15;
                if (seq.beamCount === 26) state.turbState.g.mod = 'random';
                state.gammaRayCount = gammaCount;
                updateGammaRays(gammaCount);
                state.turbState.g.spd = 1.0 + gammaCount * 0.5;
            }
        }

    } else if (state.chargeReleaseTimer > 0) {
        state.forceAuraVisible = true;
        state.chargeReleaseTimer -= dt;
        let expandProgress = 1.0 - (Math.max(0, state.chargeReleaseTimer) / 0.5);
        reachScale = baseScale * (1.0 + expandProgress * 40.0);
    }

    // Glow Sprite (Outer Reach)
    if ((state.isAuraEnabled || state.forceAuraVisible) && state.glowSprite && !state.isDestroyed) {
        state.glowSprite.visible = true;
        state.glowSprite.position.copy(auraPos);
        let sr = reachScale * auraScaleMult * state.novaScale;
        state.glowSprite.scale.set(sr, sr, 1);
    } else if (state.glowSprite) {
        state.glowSprite.visible = false;
    }

    // Core Sprite (Inner Intensity)
    if (state.isAuraEnabled && state.coreSprite && !state.isDestroyed) {
        state.coreSprite.visible = true;
        state.coreSprite.position.copy(auraPos);

        let iFactor = state.auraIntensity / 3.0;
        let ciScale = (0.2 + 1.8 * iFactor) * state.z_depth * auraScaleMult * state.novaScale;
        state.coreSprite.scale.set(ciScale, ciScale, 1);
        state.coreSprite.material.opacity = 1.0 - 0.6 * iFactor;
    } else if (state.coreSprite) {
        state.coreSprite.visible = false;
    }

    // Collapse animation
    if (state.collapseTime > 0) {
        state.collapseTime -= dt;
        let t = Math.max(0, state.collapseTime) / 0.75;
        let ease = t * t * t;

        if (state.chargeSpheroid.visible) {
            let s = state.chargeSpheroid.userData.currentScale * ease * auraScaleMult;
            state.chargeSpheroid.scale.set(s, s, 1);
        }

        for (let i = 0; i < 6; i++) {
            if (state.chargeFlares[i].visible) {
                let fs = state.chargeFlares[i].userData.lastScale * ease;
                state.chargeFlares[i].scale.setScalar(fs);
                if (i % 2 === 0) state.chargeFlares[i].rotateZ(state.chargeFlares[i].userData.lastSpeed * dt * 50);
                else state.chargeFlares[i].rotateZ(-state.chargeFlares[i].userData.lastSpeed * dt * 50);
            }
        }

        if (state.collapseTime <= 0) {
            state.chargeSpheroid.visible = false;
            state.chargeFlares.forEach(f => {
                f.visible = false;
                f.rotation.set(f.userData.baseX, f.userData.baseY, f.userData.baseZ);
            });

            // Restore pre-charge beam state
            if (state.chargeSequence) {
                let seq = state.chargeSequence;
                state.isPulsarEnabled = seq.prePulsarEnabled;
                state.pulsarRayCount = seq.prePulsarCount;
                if (state.pulsarGroup) state.pulsarGroup.visible = seq.prePulsarEnabled;
                updatePulsars(seq.prePulsarCount);
                state.turbState.p = { ...seq.prePulsarTurb };

                state.isGammaEnabled = seq.preGammaEnabled;
                state.gammaRayCount = seq.preGammaCount;
                if (state.gammaRaysGroup) state.gammaRaysGroup.visible = seq.preGammaEnabled;
                updateGammaRays(seq.preGammaCount);
                state.turbState.g = { ...seq.preGammaTurb };

                state.chargeSequence = null;
            }

            if (state.wasFullCharge) {
                state.isShockwaveActive = true;
                state.shockwaveTime = 0;
                state.shockwaveSphere.visible = true;
                state.shockwaveSphere.position.copy(state.polyGroup.position);
                state.shockwaveDisk.visible = true;
                state.shockwaveDisk.position.copy(state.polyGroup.position);
                state.shockwaveDisk.rotation.x = Math.PI / 2;

                // Import dynamically to avoid circular dependency - signal to main
                state._fireSuperNova = true;
                state.wasFullCharge = false;
            } else {
                state._fireExplosion = true;
            }
            state.chargeReleaseTimer = 0.5;
        }
    }
}
