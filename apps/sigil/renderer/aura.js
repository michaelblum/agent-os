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

    // 3. Wobbly Core (small opaque white sphere at center)
    const coreGeo = new THREE.IcosahedronGeometry(0.15, 2);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 1.0, transparent: false });
    state.wobbleCoreMesh = new THREE.Mesh(coreGeo, coreMat);
    state.wobbleCoreBasePositions = Float32Array.from(coreGeo.attributes.position.array);
    state.scene.add(state.wobbleCoreMesh);
}

export function computeAuraPosition() {
    let auraPos = state.polyGroup.position.clone();
    let auraScaleMult = 1.0;

    if (state.isMaskEnabled) {
        const pushBackDist = state.auraDepthOffset;
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

    state.auraSpike *= state.auraSpikeDecay;
    const baseScale = state.auraBaseScale * state.auraReach * state.z_depth;
    const pulseOffset = Math.sin(Date.now() * state.auraPulseRate) * (state.auraPulseAmplitude * state.auraReach) * state.z_depth;
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
        state.coreSprite.material.opacity = 1.0 - state.auraCoreFade * iFactor;
    } else if (state.coreSprite) {
        state.coreSprite.visible = false;
    }
    if (state.isAuraEnabled && state.wobbleCoreMesh && state.wobbleCoreBasePositions) {
        state.wobbleCoreMesh.visible = true;
        state.wobbleCoreMesh.position.copy(auraPos);

        // Recompute from cached rest positions so the wobble oscillates in place.
        const positions = state.wobbleCoreMesh.geometry.attributes.position;
        const rest = state.wobbleCoreBasePositions;
        const time = Date.now() * 0.002;

        for (let i = 0; i < positions.count; i++) {
            const offset = i * 3;
            const x = rest[offset];
            const y = rest[offset + 1];
            const z = rest[offset + 2];
            const noise = Math.sin(x * 10 + time) * Math.cos(y * 10 + time * 1.3) * Math.sin(z * 10 + time * 0.7);
            const scale = 1.0 + (noise * 0.1);
            positions.setXYZ(i, x * scale, y * scale, z * scale);
        }
        positions.needsUpdate = true;
    } else if (state.wobbleCoreMesh) {
        state.wobbleCoreMesh.visible = false;
    }
}
