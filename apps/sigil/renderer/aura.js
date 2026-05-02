import state from './state.js';
import { balancedDirectionForIndex, getTurbulence, phaseForIndex, syncInstanceCount } from './effect-utils.js';

function createWobbleMesh() {
    const geometry = new THREE.IcosahedronGeometry(0.15, 2);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: state.wobbleOpacity,
        transparent: state.wobbleOpacity < 0.999,
        depthTest: true,
        depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 5;
    mesh.userData.seed = Math.random();
    return {
        mesh,
        rest: Float32Array.from(geometry.attributes.position.array),
    };
}

function syncWobbleMeshes() {
    const targetCount = Math.max(0, Math.round(state.wobbleCount));
    syncInstanceCount(() => state.wobbleMeshes.length, targetCount, () => {
        const wobble = createWobbleMesh();
        state.wobbleMeshes.push(wobble.mesh);
        state.wobbleBasePositions.push(wobble.rest);
        state.polyGroup.add(wobble.mesh);
    }, () => {
        const mesh = state.wobbleMeshes.pop();
        state.wobbleBasePositions.pop();
        if (!mesh) return;
        state.polyGroup.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    });
}

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

    // 3. Wobbles (enumerated 3D occluder meshes balanced around the aura center)
    syncWobbleMeshes();
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
    const vitality = state.sessionVitality || {};
    const reachMultiplier = Number.isFinite(vitality.auraReachMultiplier) ? vitality.auraReachMultiplier : 1;
    const intensityMultiplier = Number.isFinite(vitality.auraIntensityMultiplier) ? vitality.auraIntensityMultiplier : 1;

    state.auraSpike *= state.auraSpikeDecay;
    const baseScale = state.auraBaseScale * state.auraReach * reachMultiplier * state.z_depth;
    const pulseOffset = Math.sin(Date.now() * state.auraPulseRate) * (state.auraPulseAmplitude * state.auraReach * reachMultiplier) * state.z_depth;
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

        let iFactor = (state.auraIntensity * intensityMultiplier) / 3.0;
        let ciScale = (0.2 + 1.8 * iFactor) * state.z_depth * auraScaleMult * state.appScale;
        state.coreSprite.scale.set(ciScale, ciScale, 1);
        state.coreSprite.material.opacity = 1.0 - state.auraCoreFade * iFactor;
    } else if (state.coreSprite) {
        state.coreSprite.visible = false;
    }
    syncWobbleMeshes();
    const wobbleVisible = state.isAuraEnabled && state.appScale > 0.001;
    if (wobbleVisible && state.wobbleMeshes.length > 0) {
        const count = state.wobbleMeshes.length;
        const time = state.globalTime * Math.max(0.01, state.wobbleSpeed);
        const chaos = Math.max(0, state.wobbleChaos);
        const ratioScalar = Math.max(0.05, state.wobbleXYRatioScalar);
        const ratioX = Math.sqrt(ratioScalar);
        const ratioY = 1 / ratioX;
        const scaleX = Math.max(0.01, state.wobbleScaleX * ratioX) * state.appScale;
        const scaleY = Math.max(0.01, state.wobbleScaleY * ratioY) * state.appScale;
        const scaleZ = Math.max(0.01, Math.min(scaleX, scaleY) * 0.92);
        const radiusGain = 1 + (
            state.wobbleOrbitRadius
            * Math.max(0, state.wobbleRadiusScalar)
            * 0.15
        );

        for (let i = 0; i < count; i++) {
            const mesh = state.wobbleMeshes[i];
            const rest = state.wobbleBasePositions[i];
            if (!mesh || !rest) continue;

            const phase = phaseForIndex(i, count);
            const noise = getTurbulence(time, 1.0, state.wobbleMode, i, count, mesh.userData.seed ?? 0);
            const dir = balancedDirectionForIndex(i, count);
            const orient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            const spin = new THREE.Quaternion().setFromAxisAngle(
                dir,
                time * 0.9 + phase + noise * chaos * 0.3
            );
            const stretch = 1.0 + noise * chaos * 0.24;
            const wobbleX = scaleX * radiusGain;
            const wobbleY = scaleY * radiusGain;
            const wobbleZ = scaleZ * radiusGain;
            const stretchX = wobbleX >= wobbleY ? stretch : 1.0;
            const stretchY = wobbleY > wobbleX ? stretch : 1.0;
            mesh.visible = true;
            mesh.position.set(0, 0, 0);
            mesh.scale.set(
                wobbleX * stretchX,
                wobbleY * stretchY,
                wobbleZ
            );
            mesh.quaternion.copy(orient).multiply(spin);
            mesh.material.opacity = state.wobbleOpacity;
            mesh.material.transparent = state.wobbleOpacity < 0.999;
            mesh.material.depthWrite = true;
            mesh.material.needsUpdate = true;

            // Recompute from cached rest positions so each wobble oscillates independently.
            const positions = mesh.geometry.attributes.position;
            for (let vertex = 0; vertex < positions.count; vertex++) {
                const offset = vertex * 3;
                const x = rest[offset];
                const y = rest[offset + 1];
                const z = rest[offset + 2];
                const vertexNoise = Math.sin(x * 10 + time + phase)
                    * Math.cos(y * 10 + time * 1.3 + phase * 0.7)
                    * Math.sin(z * 10 + time * 0.7 - phase * 0.5);
                const wobbleScale = 1.0 + (vertexNoise * (0.08 + chaos * 0.08));
                positions.setXYZ(vertex, x * wobbleScale, y * wobbleScale, z * wobbleScale);
            }
            positions.needsUpdate = true;
        }
    } else {
        state.wobbleMeshes.forEach((mesh) => {
            mesh.visible = false;
        });
    }
}
