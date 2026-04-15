import state from './state.js';

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
    const reachScale = baseScale + pulseOffset + spikeBonus;

    // Glow Sprite (Outer Reach)
    if (state.isAuraEnabled && state.glowSprite) {
        state.glowSprite.visible = true;
        state.glowSprite.position.copy(auraPos);
        let sr = reachScale * auraScaleMult * state.appScale;
        state.glowSprite.scale.set(sr, sr, 1);
    } else if (state.glowSprite) {
        state.glowSprite.visible = false;
    }

    // Core Sprite (Inner Intensity)
    if (state.isAuraEnabled && state.coreSprite) {
        state.coreSprite.visible = true;
        state.coreSprite.position.copy(auraPos);

        let iFactor = state.auraIntensity / 3.0;
        let ciScale = (0.2 + 1.8 * iFactor) * state.z_depth * auraScaleMult * state.appScale;
        state.coreSprite.scale.set(ciScale, ciScale, 1);
        state.coreSprite.material.opacity = 1.0 - 0.6 * iFactor;
    } else if (state.coreSprite) {
        state.coreSprite.visible = false;
    }
}
