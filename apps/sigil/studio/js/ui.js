import state from '../../renderer/state.js';
import { updateGeometry, updateOmegaGeometry } from '../../renderer/geometry.js';
import { updateAllColors } from '../../renderer/colors.js';
import { applyPreset } from '../../renderer/presets.js';
import { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE } from '../../renderer/appearance.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from '../../renderer/phenomena.js';
export { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from '../../renderer/phenomena.js';
import { applySkin } from '../../renderer/skins.js';
import { EFFECTS } from '../../renderer/fx-registry.js';
import { DEFAULT_TRANSITION_EFFECT, TRANSITION_EFFECTS, normalizeTransitionEffect } from '../../renderer/transition-registry.js';
import { randomizeAll } from './randomize.js';
import { loadAgentIntoStudio, markDraftChanged, setupStudioSession, updateDraftIdentity } from './studio-session.js';

// Inlined from deleted scene.js — converts pixel base size to Three.js scene scale.
const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;
function computeBaseScale(base) {
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / window.innerHeight);
}

function populateTransitionEffectSelects() {
    ['transitionEnterEffectSelect', 'transitionExitEffectSelect'].forEach((id) => {
        const select = document.getElementById(id);
        if (!select || select.options.length > 0) return;
        TRANSITION_EFFECTS.forEach((effect) => {
            const option = document.createElement('option');
            option.value = effect.id;
            option.textContent = effect.label;
            select.appendChild(option);
        });
    });
}

function updateTransitionSettingsVisibility() {
    const container = document.getElementById('wormholeTransitionSettings');
    const enter = document.getElementById('transitionEnterEffectSelect')?.value;
    const exit = document.getElementById('transitionExitEffectSelect')?.value;
    if (!container) return;
    container.style.display = (enter === 'wormhole' || exit === 'wormhole') ? 'block' : 'none';
}

function makeEditable(id, getMin, getMax, isFloat, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('editable-val');
    el.title = "Click to type value";

    el.addEventListener('click', () => {
        const currentVal = el.innerText;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = isFloat ? '0.01' : '1';
        input.value = currentVal;
        input.className = 'edit-input';
        input.style.width = Math.max(4, currentVal.length + 1) + 'ch';
        el.style.display = 'none';
        el.parentNode.insertBefore(input, el);
        input.focus();
        input.select();

        let isCommitted = false;
        function commit() {
            if (isCommitted) return;
            isCommitted = true;
            let val = parseFloat(input.value);
            if (isNaN(val)) val = parseFloat(currentVal);
            const min = typeof getMin === 'function' ? getMin() : getMin;
            const max = typeof getMax === 'function' ? getMax() : getMax;
            val = Math.max(min, Math.min(max, val));
            el.innerText = isFloat ? val.toFixed(input.step.includes('.') ? input.step.split('.')[1].length : 0) : Math.round(val).toString();
            el.style.display = '';
            if (input.parentNode) input.parentNode.removeChild(input);
            onChange(val);
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
                if (isCommitted) return;
                isCommitted = true;
                el.style.display = '';
                if (input.parentNode) input.parentNode.removeChild(input);
            }
        });
    });
}

function updateOpacity(val) {
    state.currentOpacity = val;
    if (state.coreMesh) {
        const isSolid = state.currentOpacity >= 0.99;
        if (state.isMaskEnabled) {
            state.coreMesh.visible = false;
        } else {
            state.coreMesh.visible = true;
            if (state.skinMaterial) {
                // Shader material — update uniforms
                state.skinMaterial.uniforms.uOpacity.value = state.currentOpacity;
                state.skinMaterial.uniforms.uSpecular.value = state.isSpecularEnabled ? 1.0 : 0.0;
                state.skinMaterial.transparent = !isSolid;
                state.skinMaterial.depthWrite = isSolid;
                state.skinMaterial.side = isSolid ? THREE.FrontSide : THREE.DoubleSide;
            } else {
                // MeshPhongMaterial — direct property updates
                state.coreMesh.material.opacity = state.currentOpacity;
                state.coreMesh.material.transparent = !isSolid;
                state.coreMesh.material.depthWrite = isSolid;
                state.coreMesh.material.side = isSolid ? THREE.FrontSide : THREE.DoubleSide;
                if (state.isSpecularEnabled) {
                    state.coreMesh.material.specular = new THREE.Color(0x333333);
                    state.coreMesh.material.shininess = 80;
                } else {
                    state.coreMesh.material.specular = new THREE.Color(0x000000);
                    state.coreMesh.material.shininess = 0;
                }
            }
        }
        state.coreMesh.material.needsUpdate = true;
    }
}

function updateEdgeOpacity(val) {
    state.currentEdgeOpacity = val;
    if (state.wireframeMesh) {
        state.wireframeMesh.material.opacity = state.currentEdgeOpacity;
        state.wireframeMesh.material.needsUpdate = true;
    }
}

function updateFOV(val) {
    state.perspCamera.fov = val;
    state.perspCamera.updateProjectionMatrix();
}


function getConfig() {
    return {
        base: state.avatarBase,
        min: state.avatarMin != null ? state.avatarMin : 40,
        max: state.avatarMax != null ? state.avatarMax : 400,
        shape: state.currentGeometryType,
        colors: state.colors,
        stellation: state.stellationFactor,
        opacity: state.currentOpacity,
        edgeOpacity: state.currentEdgeOpacity,
        mask: state.isMaskEnabled,
        interiorEdges: state.isInteriorEdgesEnabled,
        specular: state.isSpecularEnabled,
        skin: state.currentSkin,
        idleSpin: state.idleSpinSpeed,
        path: state.isPathEnabled,
        centeredView: state.isCenteredView,
        pathType: state.pathType,
        showPath: state.isShowPathEnabled,
        trail: state.isTrailEnabled,
        trailLength: state.trailLength,
        trailOpacity: state.trailOpacity,
        trailFadeMs: state.trailFadeMs,
        trailStyle: state.trailStyle,
        speed: state.pathSpeed,
        aura: state.isAuraEnabled,
        auraReach: state.auraReach,
        auraIntensity: state.auraIntensity,
        pulseRate: state.auraPulseRate,
        auraDepthOffset: state.auraDepthOffset,
        auraBaseScale: state.auraBaseScale,
        auraPulseAmplitude: state.auraPulseAmplitude,
        auraCoreFade: state.auraCoreFade,
        auraSpikeDecay: state.auraSpikeDecay,
        pulsar: state.isPulsarEnabled,
        accretion: state.isAccretionEnabled,
        gamma: state.isGammaEnabled,
        neutrinos: state.isNeutrinosEnabled,
        // Old 2D grid fields removed — unified into gridMode
        ortho: document.getElementById('orthoToggle')?.checked || false,
        fov: state.perspCamera.fov,
        zDepth: state.z_depth,
        pulsarCount: state.pulsarRayCount,
        accretionCount: state.accretionDiskCount,
        gammaCount: state.gammaRayCount,
        neutrinoCount: state.neutrinoJetCount,
        turbState: JSON.parse(JSON.stringify(state.turbState)),
        lightning: state.isLightningEnabled,
        lightningOriginCenter: state.lightningOriginCenter,
        lightningSolidBlock: state.lightningSolidBlock,
        // (lightningShowShell removed)
        lightningBoltLength: state.lightningBoltLength,
        lightningFrequency: state.lightningFrequency,
        lightningDuration: state.lightningDuration,
        lightningBranching: state.lightningBranching,
        lightningBrightness: state.lightningBrightness,
        magnetic: state.isMagneticEnabled,
        magneticTentacleCount: state.magneticTentacleCount,
        magneticTentacleSpeed: state.magneticTentacleSpeed,
        magneticWander: state.magneticWander,
        omega: state.isOmegaEnabled,
        omegaGeometryType: state.omegaGeometryType,
        omegaStellationFactor: state.omegaStellationFactor,
        omegaScale: state.omegaScale,
        omegaOpacity: state.omegaOpacity,
        omegaEdgeOpacity: state.omegaEdgeOpacity,
        omegaCounterSpin: state.omegaCounterSpin,
        omegaLockPosition: state.omegaLockPosition,
        omegaInterDimensional: state.omegaInterDimensional,
        omegaGhostCount: state.omegaGhostCount,
        omegaGhostMode: state.omegaGhostMode,
        omegaGhostDuration: state.omegaGhostDuration,
        omegaIsMaskEnabled: state.omegaIsMaskEnabled,
        omegaIsInteriorEdgesEnabled: state.omegaIsInteriorEdgesEnabled,
        omegaIsSpecularEnabled: state.omegaIsSpecularEnabled,
        omegaSkin: state.omegaSkin,
        // Swarm + Black Hole
        swarm: state.isSwarmEnabled,
        swarmCount: state.swarmCount,
        swarmGravity: state.swarmGravity,
        swarmEventHorizon: state.swarmEventHorizon,
        swarmTimeScale: state.swarmTimeScale,
        blackHoleMode: state.isBlackHoleMode,
        // 3D Grid
        gridMode: state.gridMode,
        grid3dRenderMode: state.grid3dRenderMode,
        grid3dDensity: state.grid3dDensity,
        grid3dRenderRadius: state.grid3dRenderRadius,
        grid3dSnowGlobe: state.grid3dSnowGlobe,
        grid3dShowProbe: state.grid3dShowProbe,
        grid3dRelativeMotion: state.grid3dRelativeMotion,
        grid3dTimeScale: state.grid3dTimeScale,
        // Tetartoid
        tetartoidA: state.tetartoidA,
        tetartoidB: state.tetartoidB,
        tetartoidC: state.tetartoidC,
        // Torus
        torusRadius: state.torusRadius,
        torusTube: state.torusTube,
        torusArc: state.torusArc,
        // Cylinder
        cylinderTopRadius: state.cylinderTopRadius,
        cylinderBottomRadius: state.cylinderBottomRadius,
        cylinderHeight: state.cylinderHeight,
        cylinderSides: state.cylinderSides,
        // Box
        boxWidth: state.boxWidth,
        boxHeight: state.boxHeight,
        boxDepth: state.boxDepth,
        avatarHitRadius: state.avatarHitRadius,
        dragThreshold: state.dragThreshold,
        dragCancelRadius: state.dragCancelRadius,
        gotoRingRadius: state.gotoRingRadius,
        menuRingRadius: state.menuRingRadius,
        transitionEnterEffect: normalizeTransitionEffect(state.transitionEnterEffect, DEFAULT_TRANSITION_EFFECT),
        transitionExitEffect: normalizeTransitionEffect(state.transitionExitEffect, DEFAULT_TRANSITION_EFFECT),
        transitionScaleDuration: state.transitionScaleDuration,
        wormholeCaptureRadius: state.wormholeCaptureRadius,
        wormholeImplosionDuration: state.wormholeImplosionDuration,
        wormholeReboundDuration: state.wormholeReboundDuration,
        wormholeDistortionStrength: state.wormholeDistortionStrength,
        wormholeWhitePointIntensity: state.wormholeWhitePointIntensity,
        wormholeStarburstIntensity: state.wormholeStarburstIntensity,
        wormholeLensFlareIntensity: state.wormholeLensFlareIntensity,
    };
}

function applyConfig(c) {
    if (!c) return;
    const setUI = (id, val, strVal) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') {
            if (el.checked !== val) { el.checked = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
        } else {
            el.value = val;
            if (strVal !== undefined) {
                const vDisp = document.getElementById(id.replace('Slider', 'Val'));
                if (vDisp) vDisp.innerText = strVal;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    // Size
    if (c.base != null) {
        state.avatarBase = c.base;
        state.baseScale = computeBaseScale(c.base);
        const baseEl = document.getElementById('baseSizeSlider');
        if (baseEl) { baseEl.value = c.base; }
        const baseValEl = document.getElementById('baseSizeVal');
        if (baseValEl) { baseValEl.innerText = Math.round(c.base); }
    }
    if (c.min != null) {
        state.avatarMin = c.min;
        const minEl = document.getElementById('minSizeSlider');
        if (minEl) { minEl.value = c.min; }
        const minValEl = document.getElementById('minSizeVal');
        if (minValEl) { minValEl.innerText = Math.round(c.min); }
    }
    if (c.max != null) {
        state.avatarMax = c.max;
        const maxEl = document.getElementById('maxSizeSlider');
        if (maxEl) { maxEl.value = c.max; }
        const maxValEl = document.getElementById('maxSizeVal');
        if (maxValEl) { maxValEl.innerText = Math.round(c.max); }
    }

    if (c.shape !== undefined) setUI('shapeSelect', c.shape);
    if (c.stellation !== undefined) setUI('stellationSlider', c.stellation, c.stellation.toFixed(2));
    if (c.opacity !== undefined) setUI('opacitySlider', c.opacity, c.opacity.toFixed(2));
    if (c.edgeOpacity !== undefined) setUI('edgeOpacitySlider', c.edgeOpacity, c.edgeOpacity.toFixed(2));
    if (c.mask !== undefined) setUI('maskToggle', !c.mask); // inverted: mask=true → Show Faces unchecked
    if (c.interiorEdges !== undefined) setUI('interiorEdgesToggle', c.interiorEdges);
    if (c.specular !== undefined) setUI('specularToggle', c.specular);
    if (c.skin !== undefined) setUI('skinSelect', c.skin);
    if (c.idleSpin !== undefined) setUI('idleSpinSlider', c.idleSpin, c.idleSpin.toFixed(3));

    if (c.colors) {
        Object.keys(c.colors).forEach(k => {
            state.colors[k] = c.colors[k];
            setUI(k + 'Color1', state.colors[k][0]);
            setUI(k + 'Color2', state.colors[k][1]);
        });
    }

    if (c.path !== undefined) setUI('pathToggle', c.path);
    if (c.centeredView !== undefined) setUI('centeredViewToggle', c.centeredView);
    if (c.pathType !== undefined) setUI('pathTypeSelect', c.pathType);
    if (c.showPath !== undefined) setUI('showPathToggle', c.showPath);
    if (c.trail !== undefined) setUI('trailToggle', c.trail);
    if (c.trailLength !== undefined) setUI('trailLengthSlider', c.trailLength, c.trailLength);
    if (c.trailOpacity !== undefined) setUI('trailOpacitySlider', c.trailOpacity, c.trailOpacity.toFixed(2));
    if (c.trailFadeMs !== undefined) setUI('trailFadeSlider', c.trailFadeMs, String(c.trailFadeMs));
    if (c.trailStyle !== undefined) setUI('trailStyleSelect', c.trailStyle);
    if (c.speed !== undefined) setUI('speedSlider', c.speed, c.speed.toFixed(1));
    if (c.aura !== undefined) setUI('auraToggle', c.aura);
    if (c.auraReach !== undefined) setUI('auraReachSlider', c.auraReach, c.auraReach.toFixed(2));
    if (c.auraIntensity !== undefined) setUI('auraIntensitySlider', c.auraIntensity, c.auraIntensity.toFixed(2));
    if (c.pulseRate !== undefined) setUI('pulseRateSlider', c.pulseRate, c.pulseRate.toFixed(3));
    if (c.auraDepthOffset !== undefined) setUI('auraDepthOffsetSlider', c.auraDepthOffset, c.auraDepthOffset.toFixed(1));
    if (c.auraBaseScale !== undefined) setUI('auraBaseScaleSlider', c.auraBaseScale, c.auraBaseScale.toFixed(1));
    if (c.auraPulseAmplitude !== undefined) setUI('auraPulseAmplitudeSlider', c.auraPulseAmplitude, c.auraPulseAmplitude.toFixed(2));
    if (c.auraCoreFade !== undefined) setUI('auraCoreFadeSlider', c.auraCoreFade, c.auraCoreFade.toFixed(2));
    if (c.auraSpikeDecay !== undefined) setUI('auraSpikeDecaySlider', c.auraSpikeDecay, c.auraSpikeDecay.toFixed(2));
    if (c.pulsar !== undefined) setUI('pulsarToggle', c.pulsar);
    if (c.accretion !== undefined) setUI('accretionToggle', c.accretion);
    if (c.gamma !== undefined) setUI('gammaToggle', c.gamma);
    if (c.neutrinos !== undefined) setUI('neutrinoToggle', c.neutrinos);
    if (c.gridMode !== undefined) setUI('gridModeSelect', c.gridMode);
    if (c.ortho !== undefined) setUI('orthoToggle', c.ortho);
    if (c.fov !== undefined) setUI('fovSlider', c.fov, c.fov);
    if (c.zDepth !== undefined) setUI('zDepthSlider', c.zDepth, c.zDepth.toFixed(2));

    // Restore multi-instance counts
    if (c.pulsarCount !== undefined) { state.pulsarRayCount = c.pulsarCount; setUI('pulsarCount', c.pulsarCount); updatePulsars(c.pulsarCount); }
    if (c.accretionCount !== undefined) { state.accretionDiskCount = c.accretionCount; setUI('accretionCount', c.accretionCount); updateAccretion(c.accretionCount); }
    if (c.gammaCount !== undefined) { state.gammaRayCount = c.gammaCount; setUI('gammaCount', c.gammaCount); updateGammaRays(c.gammaCount); }
    if (c.neutrinoCount !== undefined) { state.neutrinoJetCount = c.neutrinoCount; setUI('neutrinoCount', c.neutrinoCount); updateNeutrinos(c.neutrinoCount); }

    // Restore turbulence state
    if (c.turbState) {
        ['p', 'a', 'g', 'n'].forEach(k => {
            if (c.turbState[k]) {
                state.turbState[k] = { ...state.turbState[k], ...c.turbState[k] };
                setUI(`${k}TurbSlider`, state.turbState[k].val, state.turbState[k].val.toFixed(2));
                setUI(`${k}TurbSpdSlider`, state.turbState[k].spd, state.turbState[k].spd.toFixed(1));
                document.getElementById(`${k}TurbMod`).value = state.turbState[k].mod;
            }
        });
    }

    // Restore lightning state
    if (c.lightning !== undefined) setUI('lightningToggle', c.lightning);
    if (c.lightningOriginCenter !== undefined) setUI('lightningOriginCenter', c.lightningOriginCenter);
    if (c.lightningSolidBlock !== undefined) setUI('lightningSolidBlock', c.lightningSolidBlock);
    // (lightningShowShell removed)
    if (c.lightningBoltLength !== undefined) setUI('lightningLengthSlider', c.lightningBoltLength, c.lightningBoltLength);
    if (c.lightningFrequency !== undefined) setUI('lightningFreqSlider', c.lightningFrequency, c.lightningFrequency.toFixed(1));
    if (c.lightningDuration !== undefined) setUI('lightningDurSlider', c.lightningDuration, c.lightningDuration.toFixed(1));
    if (c.lightningBranching !== undefined) setUI('lightningBranchSlider', c.lightningBranching, c.lightningBranching.toFixed(2));
    if (c.lightningBrightness !== undefined) setUI('lightningBrightSlider', c.lightningBrightness, c.lightningBrightness.toFixed(1));
    // Magnetic field
    if (c.magnetic !== undefined) setUI('magneticToggle', c.magnetic);
    if (c.magneticTentacleCount !== undefined) setUI('magneticCountSlider', c.magneticTentacleCount, c.magneticTentacleCount);
    if (c.magneticTentacleSpeed !== undefined) setUI('magneticSpeedSlider', c.magneticTentacleSpeed, c.magneticTentacleSpeed.toFixed(1));
    if (c.magneticWander !== undefined) setUI('magneticWanderSlider', c.magneticWander, c.magneticWander.toFixed(1));

    // Omega
    if (c.omega !== undefined) setUI('omegaToggle', c.omega);
    if (c.omegaGeometryType !== undefined) setUI('omegaShapeSelect', c.omegaGeometryType);
    if (c.omegaStellationFactor !== undefined) setUI('omegaStellationSlider', c.omegaStellationFactor, c.omegaStellationFactor.toFixed(2));
    if (c.omegaScale !== undefined) setUI('omegaScaleSlider', c.omegaScale, c.omegaScale.toFixed(2));
    if (c.omegaOpacity !== undefined) setUI('omegaOpacitySlider', c.omegaOpacity, c.omegaOpacity.toFixed(2));
    if (c.omegaEdgeOpacity !== undefined) setUI('omegaEdgeOpacitySlider', c.omegaEdgeOpacity, c.omegaEdgeOpacity.toFixed(2));
    if (c.omegaIsMaskEnabled !== undefined) setUI('omegaMaskToggle', !c.omegaIsMaskEnabled);
    if (c.omegaIsInteriorEdgesEnabled !== undefined) setUI('omegaInteriorEdgesToggle', c.omegaIsInteriorEdgesEnabled);
    if (c.omegaIsSpecularEnabled !== undefined) setUI('omegaSpecularToggle', c.omegaIsSpecularEnabled);
    if (c.omegaSkin !== undefined) setUI('omegaSkinSelect', c.omegaSkin);

    // Swarm + Black Hole
    if (c.swarm !== undefined) setUI('swarmToggle', c.swarm);
    if (c.swarmCount !== undefined) setUI('swarmCountSlider', c.swarmCount, c.swarmCount);
    if (c.swarmGravity !== undefined) setUI('swarmGravitySlider', c.swarmGravity, c.swarmGravity);
    if (c.swarmEventHorizon !== undefined) setUI('swarmHorizonSlider', c.swarmEventHorizon, c.swarmEventHorizon.toFixed(1));
    if (c.swarmTimeScale !== undefined) setUI('swarmTimeSlider', c.swarmTimeScale, c.swarmTimeScale.toFixed(1));
    if (c.blackHoleMode !== undefined) setUI('blackHoleModeToggle', c.blackHoleMode);

    // 3D Grid
    // grid3dToggle removed — unified into gridMode
    if (c.grid3dRenderMode !== undefined) setUI('grid3dRenderMode', c.grid3dRenderMode);
    if (c.grid3dDensity !== undefined) setUI('grid3dDensitySlider', c.grid3dDensity, c.grid3dDensity);
    if (c.grid3dRenderRadius !== undefined) setUI('grid3dRadiusSlider', c.grid3dRenderRadius, c.grid3dRenderRadius >= 30 ? 'Full' : c.grid3dRenderRadius.toFixed(1));
    // grid3dMass and grid3dEventHorizon removed — uses swarmGravity and z_depth instead
    if (c.grid3dSnowGlobe !== undefined) setUI('grid3dSnowGlobeToggle', c.grid3dSnowGlobe);
    if (c.grid3dShowProbe !== undefined) setUI('grid3dProbeToggle', c.grid3dShowProbe);
    if (c.grid3dRelativeMotion !== undefined) setUI('grid3dRelativeToggle', c.grid3dRelativeMotion);
    if (c.grid3dTimeScale !== undefined) setUI('grid3dTimeSlider', c.grid3dTimeScale, c.grid3dTimeScale.toFixed(1));

    // Tetartoid
    if (c.tetartoidA !== undefined) { state.tetartoidA = c.tetartoidA; setUI('tetASlider', c.tetartoidA, c.tetartoidA.toFixed(2)); }
    if (c.tetartoidB !== undefined) { state.tetartoidB = c.tetartoidB; setUI('tetBSlider', c.tetartoidB, c.tetartoidB.toFixed(2)); }
    if (c.tetartoidC !== undefined) { state.tetartoidC = c.tetartoidC; setUI('tetCSlider', c.tetartoidC, c.tetartoidC.toFixed(2)); }
    // Torus
    if (c.torusRadius !== undefined) { state.torusRadius = c.torusRadius; setUI('torusRadiusSlider', c.torusRadius, c.torusRadius.toFixed(2)); }
    if (c.torusTube !== undefined) { state.torusTube = c.torusTube; setUI('torusTubeSlider', c.torusTube, c.torusTube.toFixed(2)); }
    if (c.torusArc !== undefined) { state.torusArc = c.torusArc; setUI('torusArcSlider', c.torusArc, c.torusArc.toFixed(2)); }
    // Cylinder
    if (c.cylinderTopRadius !== undefined) { state.cylinderTopRadius = c.cylinderTopRadius; setUI('cylinderTopSlider', c.cylinderTopRadius, c.cylinderTopRadius.toFixed(2)); }
    if (c.cylinderBottomRadius !== undefined) { state.cylinderBottomRadius = c.cylinderBottomRadius; setUI('cylinderBottomSlider', c.cylinderBottomRadius, c.cylinderBottomRadius.toFixed(2)); }
    if (c.cylinderHeight !== undefined) { state.cylinderHeight = c.cylinderHeight; setUI('cylinderHeightSlider', c.cylinderHeight, c.cylinderHeight.toFixed(2)); }
    if (c.cylinderSides !== undefined) { state.cylinderSides = c.cylinderSides; setUI('cylinderSidesSlider', c.cylinderSides, c.cylinderSides); }
    // Box
    if (c.boxWidth !== undefined) { state.boxWidth = c.boxWidth; setUI('boxWidthSlider', c.boxWidth, c.boxWidth.toFixed(2)); }
    if (c.boxHeight !== undefined) { state.boxHeight = c.boxHeight; setUI('boxHeightSlider', c.boxHeight, c.boxHeight.toFixed(2)); }
    if (c.boxDepth !== undefined) { state.boxDepth = c.boxDepth; setUI('boxDepthSlider', c.boxDepth, c.boxDepth.toFixed(2)); }
    if (c.avatarHitRadius !== undefined) setUI('avatarHitRadiusSlider', c.avatarHitRadius, String(c.avatarHitRadius));
    if (c.dragThreshold !== undefined) setUI('dragThresholdSlider', c.dragThreshold, String(c.dragThreshold));
    if (c.dragCancelRadius !== undefined) setUI('dragCancelRadiusSlider', c.dragCancelRadius, String(c.dragCancelRadius));
    if (c.gotoRingRadius !== undefined) setUI('gotoRingRadiusSlider', c.gotoRingRadius, String(c.gotoRingRadius));
    if (c.menuRingRadius !== undefined) setUI('menuRingRadiusSlider', c.menuRingRadius, String(c.menuRingRadius));
    if (c.transitionEnterEffect !== undefined) setUI('transitionEnterEffectSelect', normalizeTransitionEffect(c.transitionEnterEffect, DEFAULT_TRANSITION_EFFECT));
    if (c.transitionExitEffect !== undefined) setUI('transitionExitEffectSelect', normalizeTransitionEffect(c.transitionExitEffect, DEFAULT_TRANSITION_EFFECT));
    if (c.transitionScaleDuration !== undefined) setUI('transitionScaleDurationSlider', c.transitionScaleDuration, c.transitionScaleDuration.toFixed(2));
    if (c.wormholeCaptureRadius !== undefined) setUI('wormholeCaptureRadiusSlider', c.wormholeCaptureRadius, String(c.wormholeCaptureRadius));
    if (c.wormholeImplosionDuration !== undefined) setUI('wormholeImplosionDurationSlider', c.wormholeImplosionDuration, c.wormholeImplosionDuration.toFixed(2));
    if (c.wormholeReboundDuration !== undefined) setUI('wormholeReboundDurationSlider', c.wormholeReboundDuration, c.wormholeReboundDuration.toFixed(2));
    if (c.wormholeDistortionStrength !== undefined) setUI('wormholeDistortionStrengthSlider', c.wormholeDistortionStrength, c.wormholeDistortionStrength.toFixed(2));
    if (c.wormholeWhitePointIntensity !== undefined) setUI('wormholeWhitePointIntensitySlider', c.wormholeWhitePointIntensity, c.wormholeWhitePointIntensity.toFixed(2));
    if (c.wormholeStarburstIntensity !== undefined) setUI('wormholeStarburstIntensitySlider', c.wormholeStarburstIntensity, c.wormholeStarburstIntensity.toFixed(2));
    if (c.wormholeLensFlareIntensity !== undefined) setUI('wormholeLensFlareIntensitySlider', c.wormholeLensFlareIntensity, c.wormholeLensFlareIntensity.toFixed(2));

    updateAllColors();
    updateTransitionSettingsVisibility();
}

/**
 * syncUIFromState — populate DOM input values from `state`, WITHOUT dispatching
 * input/change events. State is already the source of truth (via applyAppearance
 * or direct UI listener writes); this is the reverse mirror used after a
 * preset/appearance load so the Studio sliders/toggles show the right positions.
 *
 * Only fields present in appearance.js are synced here — drag-only runtime
 * state (avatar position, charge level, quick-spin axis, etc.) is intentionally
 * ignored.
 */
export function syncUIFromState() {
    const setVal = (id, val, strVal) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') {
            el.checked = !!val;
        } else {
            el.value = val;
            if (strVal !== undefined) {
                const vDisp = document.getElementById(id.replace('Slider', 'Val'));
                if (vDisp) vDisp.innerText = strVal;
            }
        }
    };
    const setInverted = (id, val) => {
        // Mask toggles are inverted in UI (Show Faces = !mask)
        const el = document.getElementById(id);
        if (el) el.checked = !val;
    };
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    // Size
    setVal('baseSizeSlider', state.avatarBase);
    setText('baseSizeVal', Math.round(state.avatarBase));
    setVal('minSizeSlider', state.avatarMin);
    setText('minSizeVal', Math.round(state.avatarMin));
    setVal('maxSizeSlider', state.avatarMax);
    setText('maxSizeVal', Math.round(state.avatarMax));

    // Primary geometry
    setVal('shapeSelect', state.currentGeometryType);
    setVal('stellationSlider', state.stellationFactor, state.stellationFactor.toFixed(2));
    setVal('opacitySlider', state.currentOpacity, state.currentOpacity.toFixed(2));
    setVal('edgeOpacitySlider', state.currentEdgeOpacity, state.currentEdgeOpacity.toFixed(2));
    setInverted('maskToggle', state.isMaskEnabled);
    setVal('interiorEdgesToggle', state.isInteriorEdgesEnabled);
    setVal('specularToggle', state.isSpecularEnabled);
    setVal('skinSelect', state.currentSkin);
    setVal('idleSpinSlider', state.idleSpinSpeed, state.idleSpinSpeed.toFixed(3));
    setVal('zDepthSlider', state.z_depth, state.z_depth.toFixed(2));

    // Shape params
    setVal('tetASlider', state.tetartoidA, state.tetartoidA.toFixed(2));
    setVal('tetBSlider', state.tetartoidB, state.tetartoidB.toFixed(2));
    setVal('tetCSlider', state.tetartoidC, state.tetartoidC.toFixed(2));
    setVal('torusRadiusSlider', state.torusRadius, state.torusRadius.toFixed(2));
    setVal('torusTubeSlider', state.torusTube, state.torusTube.toFixed(2));
    setVal('torusArcSlider', state.torusArc, state.torusArc.toFixed(2));
    setVal('cylinderTopSlider', state.cylinderTopRadius, state.cylinderTopRadius.toFixed(2));
    setVal('cylinderBottomSlider', state.cylinderBottomRadius, state.cylinderBottomRadius.toFixed(2));
    setVal('cylinderHeightSlider', state.cylinderHeight, state.cylinderHeight.toFixed(2));
    setVal('cylinderSidesSlider', state.cylinderSides, String(state.cylinderSides));
    setVal('boxWidthSlider', state.boxWidth, state.boxWidth.toFixed(2));
    setVal('boxHeightSlider', state.boxHeight, state.boxHeight.toFixed(2));
    setVal('boxDepthSlider', state.boxDepth, state.boxDepth.toFixed(2));

    // Aura
    setVal('auraToggle', state.isAuraEnabled);
    setVal('auraReachSlider', state.auraReach, state.auraReach.toFixed(2));
    setVal('auraIntensitySlider', state.auraIntensity, state.auraIntensity.toFixed(2));
    setVal('pulseRateSlider', state.auraPulseRate, state.auraPulseRate.toFixed(3));
    setVal('spikeMultiplier', state.spikeMultiplier);
    setVal('auraDepthOffsetSlider', state.auraDepthOffset, state.auraDepthOffset.toFixed(1));
    setVal('auraBaseScaleSlider', state.auraBaseScale, state.auraBaseScale.toFixed(1));
    setVal('auraPulseAmplitudeSlider', state.auraPulseAmplitude, state.auraPulseAmplitude.toFixed(2));
    setVal('auraCoreFadeSlider', state.auraCoreFade, state.auraCoreFade.toFixed(2));
    setVal('auraSpikeDecaySlider', state.auraSpikeDecay, state.auraSpikeDecay.toFixed(2));

    // Colors — component gradient pickers (keys match renderer state.colors)
    const colorKeys = Object.keys(state.colors || {});
    colorKeys.forEach(k => {
        const v = state.colors[k];
        if (!v) return;
        setVal(k + 'Color1', v[0]);
        setVal(k + 'Color2', v[1]);
    });

    // Phenomena
    setVal('pulsarToggle', state.isPulsarEnabled);
    setVal('pulsarCount', state.pulsarRayCount);
    setVal('accretionToggle', state.isAccretionEnabled);
    setVal('accretionCount', state.accretionDiskCount);
    setVal('gammaToggle', state.isGammaEnabled);
    setVal('gammaCount', state.gammaRayCount);
    setVal('neutrinoToggle', state.isNeutrinosEnabled);
    setVal('neutrinoCount', state.neutrinoJetCount);

    // Turbulence
    ['p', 'a', 'g', 'n'].forEach(k => {
        const t = state.turbState[k];
        if (!t) return;
        setVal(`${k}TurbSlider`, t.val, t.val.toFixed(2));
        setVal(`${k}TurbSpdSlider`, t.spd, t.spd.toFixed(1));
        setVal(`${k}TurbMod`, t.mod);
    });

    // Lightning
    setVal('lightningToggle', state.isLightningEnabled);
    setVal('lightningOriginCenter', state.lightningOriginCenter);
    setVal('lightningSolidBlock', state.lightningSolidBlock);
    setVal('lightningLengthSlider', state.lightningBoltLength, String(state.lightningBoltLength));
    setVal('lightningFreqSlider', state.lightningFrequency, state.lightningFrequency.toFixed(1));
    setVal('lightningDurSlider', state.lightningDuration, state.lightningDuration.toFixed(1));
    setVal('lightningBranchSlider', state.lightningBranching, state.lightningBranching.toFixed(2));
    setVal('lightningBrightSlider', state.lightningBrightness, state.lightningBrightness.toFixed(1));

    // Magnetic
    setVal('magneticToggle', state.isMagneticEnabled);
    setVal('magneticCountSlider', state.magneticTentacleCount, String(state.magneticTentacleCount));
    setVal('magneticSpeedSlider', state.magneticTentacleSpeed, state.magneticTentacleSpeed.toFixed(1));
    setVal('magneticWanderSlider', state.magneticWander, state.magneticWander.toFixed(1));

    // Omega
    setVal('omegaToggle', state.isOmegaEnabled);
    setVal('omegaShapeSelect', state.omegaGeometryType);
    setVal('omegaStellationSlider', state.omegaStellationFactor, state.omegaStellationFactor.toFixed(2));
    setVal('omegaScaleSlider', state.omegaScale, state.omegaScale.toFixed(2));
    setVal('omegaOpacitySlider', state.omegaOpacity, state.omegaOpacity.toFixed(2));
    setVal('omegaEdgeOpacitySlider', state.omegaEdgeOpacity, state.omegaEdgeOpacity.toFixed(2));
    setInverted('omegaMaskToggle', state.omegaIsMaskEnabled);
    setVal('omegaInteriorEdgesToggle', state.omegaIsInteriorEdgesEnabled);
    setVal('omegaSpecularToggle', state.omegaIsSpecularEnabled);
    setVal('omegaSkinSelect', state.omegaSkin);
    setVal('omegaCounterSpin', state.omegaCounterSpin);
    setVal('omegaLockPosition', state.omegaLockPosition);
    setVal('omegaInterDimensional', state.omegaInterDimensional);
    setVal('omegaGhostCountSlider', state.omegaGhostCount, String(state.omegaGhostCount));
    setVal('omegaGhostDurSlider', state.omegaGhostDuration, state.omegaGhostDuration.toFixed(1));
    setVal('omegaGhostMode', state.omegaGhostMode);

    // Swarm
    setVal('swarmToggle', state.isSwarmEnabled);
    setVal('swarmCountSlider', state.swarmCount, String(state.swarmCount));
    setVal('swarmGravitySlider', state.swarmGravity, String(state.swarmGravity));
    setVal('swarmHorizonSlider', state.swarmEventHorizon, state.swarmEventHorizon.toFixed(1));
    setVal('swarmTimeSlider', state.swarmTimeScale, state.swarmTimeScale.toFixed(1));
    setVal('blackHoleModeToggle', state.isBlackHoleMode);

    // Grid
    setVal('gridModeSelect', state.gridMode);
    setVal('grid3dRenderMode', state.grid3dRenderMode);
    setVal('grid3dDensitySlider', state.grid3dDensity, String(state.grid3dDensity));
    setVal('grid3dRadiusSlider', state.grid3dRenderRadius,
        state.grid3dRenderRadius >= 30 ? 'Full' : state.grid3dRenderRadius.toFixed(1));
    setVal('grid3dSnowGlobeToggle', state.grid3dSnowGlobe);
    setVal('grid3dProbeToggle', state.grid3dShowProbe);
    setVal('grid3dRelativeToggle', state.grid3dRelativeMotion);
    setVal('grid3dTimeSlider', state.grid3dTimeScale, state.grid3dTimeScale.toFixed(1));

    // Trails
    setVal('trailToggle', state.isTrailEnabled);
    setVal('trailLengthSlider', state.trailLength, String(state.trailLength));
    setVal('trailOpacitySlider', state.trailOpacity, state.trailOpacity.toFixed(2));
    setVal('trailFadeSlider', state.trailFadeMs, String(state.trailFadeMs));
    setVal('trailStyleSelect', state.trailStyle);

    // Interaction
    setVal('avatarHitRadiusSlider', state.avatarHitRadius, String(state.avatarHitRadius));
    setVal('dragThresholdSlider', state.dragThreshold, String(state.dragThreshold));
    setVal('dragCancelRadiusSlider', state.dragCancelRadius, String(state.dragCancelRadius));
    setVal('gotoRingRadiusSlider', state.gotoRingRadius, String(state.gotoRingRadius));
    setVal('menuRingRadiusSlider', state.menuRingRadius, String(state.menuRingRadius));
    setVal('transitionEnterEffectSelect', normalizeTransitionEffect(state.transitionEnterEffect, DEFAULT_TRANSITION_EFFECT));
    setVal('transitionExitEffectSelect', normalizeTransitionEffect(state.transitionExitEffect, DEFAULT_TRANSITION_EFFECT));
    setVal('transitionScaleDurationSlider', state.transitionScaleDuration, state.transitionScaleDuration.toFixed(2));
    setVal('wormholeCaptureRadiusSlider', state.wormholeCaptureRadius, String(state.wormholeCaptureRadius));
    setVal('wormholeImplosionDurationSlider', state.wormholeImplosionDuration, state.wormholeImplosionDuration.toFixed(2));
    setVal('wormholeReboundDurationSlider', state.wormholeReboundDuration, state.wormholeReboundDuration.toFixed(2));
    setVal('wormholeDistortionStrengthSlider', state.wormholeDistortionStrength, state.wormholeDistortionStrength.toFixed(2));
    setVal('wormholeWhitePointIntensitySlider', state.wormholeWhitePointIntensity, state.wormholeWhitePointIntensity.toFixed(2));
    setVal('wormholeStarburstIntensitySlider', state.wormholeStarburstIntensity, state.wormholeStarburstIntensity.toFixed(2));
    setVal('wormholeLensFlareIntensitySlider', state.wormholeLensFlareIntensity, state.wormholeLensFlareIntensity.toFixed(2));
    updateTransitionSettingsVisibility();
}

function buildFxGrid() {
    const grid = document.getElementById('fxGrid');
    if (!grid) return;

    // Filter out swarm (removed from UI)
    const studioEffects = EFFECTS.filter(fx => fx.id !== 'swarm');
    let openSubId = null;

    studioEffects.forEach(fx => {
        const tile = document.createElement('div');
        tile.className = 'fx-tile';
        tile.dataset.effect = fx.id;

        // Sync initial active state from hidden toggle
        const srcToggle = document.getElementById(fx.sidebarId);
        if (srcToggle && srcToggle.checked) tile.classList.add('active');

        const emoji = document.createElement('span');
        emoji.className = 'fx-tile-emoji';
        emoji.textContent = fx.emoji;
        tile.appendChild(emoji);

        const label = document.createElement('span');
        label.className = 'fx-tile-label';
        label.textContent = fx.label;
        tile.appendChild(label);

        const gear = document.createElement('span');
        gear.className = 'fx-tile-gear';
        gear.textContent = '\u2699';
        gear.title = fx.label + ' Settings';
        gear.addEventListener('click', (e) => {
            e.stopPropagation();
            const settingsId = fx.id + 'Settings';
            const panel = document.getElementById(settingsId);
            if (!panel) return;
            if (openSubId === settingsId) {
                panel.classList.remove('open');
                openSubId = null;
            } else {
                if (openSubId) {
                    const prev = document.getElementById(openSubId);
                    if (prev) prev.classList.remove('open');
                }
                panel.classList.add('open');
                openSubId = settingsId;
            }
        });
        tile.appendChild(gear);

        // Click tile (not gear) = toggle effect via sidebar checkbox
        tile.addEventListener('click', (e) => {
            if (e.target.closest('.fx-tile-gear')) return;
            const sideEl = document.getElementById(fx.sidebarId);
            if (!sideEl) return;
            sideEl.checked = !sideEl.checked;
            sideEl.dispatchEvent(new Event('change', { bubbles: true }));
            tile.classList.toggle('active');
        });

        grid.appendChild(tile);
    });
}

// Update range input background to show filled track
function updateSliderFill(el) {
    if (!el || el.type !== 'range') return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 1;
    const val = parseFloat(el.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    el.style.background = `linear-gradient(to right, #bc13fe 0%, #bc13fe ${pct}%, #2a1b3d ${pct}%, #2a1b3d 100%)`;
}

export function setupUI() {
    // Disable grid and swarm by default (removed from UI)
    state.gridMode = 'off';
    if (state.gridHelper) state.gridHelper.visible = false;
    state.isSwarmEnabled = false;
    populateTransitionEffectSelects();

    // Slider fill tracks — apply to all range inputs and update on input
    document.querySelectorAll('input[type="range"]').forEach(el => {
        // Skip dual-slider container sliders (they have their own fill)
        if (el.closest('.dual-slider-container')) return;
        updateSliderFill(el);
        el.addEventListener('input', () => updateSliderFill(el));
    });

    // Shape tab switching
    document.querySelectorAll('.shape-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            // Don't switch if clicking the checkbox
            if (e.target.type === 'checkbox') return;
            const target = tab.dataset.shapeTab;
            document.querySelectorAll('.shape-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('primary-shape-content').classList.remove('active');
            document.getElementById('secondary-shape-content').classList.remove('active');
            document.getElementById(target === 'primary' ? 'primary-shape-content' : 'secondary-shape-content').classList.add('active');
            // Update slider fills for newly visible tab
            const activeContent = document.getElementById(target === 'primary' ? 'primary-shape-content' : 'secondary-shape-content');
            activeContent.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
        });
    });

    // Nav rail — switches active panel. No sidebar expand/collapse in the
    // stageless shell; the rail is always visible and panels swap in-place.
    const navIcons = document.querySelectorAll('.nav-icon[data-target]');
    const panels = document.querySelectorAll('.panel');
    navIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            navIcons.forEach(n => n.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            icon.classList.add('active');
            const targetPanel = document.getElementById(icon.getAttribute('data-target'));
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // Esc closes the Studio canvas. No explicit button — close is handled by
    // the chip menu (Delete) + OS window controls.
    function closeStudio() {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
            window.webkit.messageHandlers.headsup.postMessage({ action: 'close' });
        } else {
            window.close();
        }
    }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            closeStudio();
        }
    });

    // Open Chat surface — ask daemon to create a chat canvas
    const btnChat = document.getElementById('btn-open-chat');
    if (btnChat) {
        btnChat.addEventListener('click', () => {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
                window.webkit.messageHandlers.headsup.postMessage({
                    type: 'create_canvas',
                    id: 'chat',
                    url: 'aos://sigil/chat/index.html',
                    interactive: true,
                    at: [100, 100, 380, 600]
                });
            } else {
                window.open('../chat/index.html', '_blank', 'width=380,height=600');
            }
        });
    }

    // --- Settings: wire to daemon config via IPC ---
    const headsup = window.webkit?.messageHandlers?.headsup;

    // Callback for config responses from daemon
    window.__aosConfigLoaded = (config) => {
        const voiceEl = document.getElementById('settingsVoiceEnabled');
        const visualEl = document.getElementById('settingsVisualFeedback');
        if (voiceEl) voiceEl.value = config.voice?.enabled ? 'on' : 'off';
        if (visualEl) visualEl.value = config.feedback?.visual !== false ? 'on' : 'off';
    };

    // Load config on startup
    if (headsup) {
        headsup.postMessage({ type: 'get_config' });
    }

    // Wire change handlers
    document.getElementById('settingsVoiceEnabled')?.addEventListener('change', (e) => {
        if (headsup) {
            headsup.postMessage({ type: 'set_config', key: 'voice.enabled', value: e.target.value === 'on' ? 'true' : 'false' });
        }
    });
    document.getElementById('settingsVisualFeedback')?.addEventListener('change', (e) => {
        if (headsup) {
            headsup.postMessage({ type: 'set_config', key: 'feedback.visual', value: e.target.value === 'on' ? 'true' : 'false' });
        }
    });

    function pushLivePreview(appearance) {
        const headsup = window.webkit?.messageHandlers?.headsup;
        if (!headsup) return;
        headsup.postMessage({
            type: 'canvas.send',
            payload: {
                target: 'avatar-main',
                message: { type: 'live_appearance', appearance }
            }
        });
    }

    // --- Agent panel — draft identity + birthplace ---
    const agentNameInput = document.getElementById('agentDisplayName');
    const agentAnchorSel = document.getElementById('agentHomeAnchor');
    const agentNonantSel = document.getElementById('agentHomeNonant');
    const agentDisplaySel = document.getElementById('agentHomeDisplay');
    const baseSizeSlider = document.getElementById('baseSizeSlider');
    const baseSizeVal = document.getElementById('baseSizeVal');
    const minSizeSlider = document.getElementById('minSizeSlider');
    const minSizeVal = document.getElementById('minSizeVal');
    const maxSizeSlider = document.getElementById('maxSizeSlider');
    const maxSizeVal = document.getElementById('maxSizeVal');

    function writeAgentPanel(agent) {
        if (!agent) return;
        if (agentNameInput) agentNameInput.value = agent.name ?? agent.id ?? '';
        const birthplace = agent.instance?.birthplace ?? agent.instance?.home ?? {};
        if (agentAnchorSel) agentAnchorSel.value = birthplace.anchor ?? 'nonant';
        if (agentNonantSel) agentNonantSel.value = birthplace.nonant ?? 'bottom-right';
        if (agentDisplaySel) agentDisplaySel.value = birthplace.display ?? 'main';
    }

    function readAgentPanel() {
        return {
            name: agentNameInput?.value?.trim() || '',
            instance: {
                birthplace: {
                    anchor: agentAnchorSel?.value || 'nonant',
                    nonant: agentNonantSel?.value || 'bottom-right',
                    display: agentDisplaySel?.value || 'main',
                },
                size: parseInt(baseSizeSlider?.value || `${state.avatarBase}`, 10),
            },
        };
    }

    agentNameInput?.addEventListener('input', (e) => {
        updateDraftIdentity({ name: e.target.value.trim() });
    });

    if (minSizeSlider) {
        minSizeSlider.addEventListener('input', (e) => {
            state.avatarMin = parseFloat(e.target.value);
            if (minSizeVal) minSizeVal.innerText = Math.round(state.avatarMin);
        });
    }

    if (maxSizeSlider) {
        maxSizeSlider.addEventListener('input', (e) => {
            state.avatarMax = parseFloat(e.target.value);
            if (maxSizeVal) maxSizeVal.innerText = Math.round(state.avatarMax);
        });
    }

    if (baseSizeSlider) {
        baseSizeSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            state.avatarBase = v;
            state.baseScale = computeBaseScale(v);
            if (baseSizeVal) baseSizeVal.innerText = Math.round(v);
        });
    }

    const draftPanels = ['panel-geom', 'panel-colors', 'panel-anim', 'panel-env'];
    draftPanels.forEach(id => {
        const panel = document.getElementById(id);
        if (!panel) return;
        panel.addEventListener('input', () => markDraftChanged({ preview: true }));
        panel.addEventListener('change', () => markDraftChanged({ preview: true }));
    });

    // Seed state from the canonical appearance defaults before any UI listener
    // fires. applyAppearance is the single gateway into state; syncUIFromState
    // mirrors state into DOM inputs (no events dispatched — state is truth).
    applyAppearance(DEFAULT_APPEARANCE);
    syncUIFromState();

    setupStudioSession({
        syncUIFromState,
        writeAgentPanel,
        readAgentPanel,
        pushLivePreview,
    });

    const activeAgentId = new URLSearchParams(location.search).get('agent') ?? 'default';
    void loadAgentIntoStudio(activeAgentId, { force: true });

    const btnShare = document.getElementById('btn-share');
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            const config = getConfig();
            const shareUrl = new URL(window.location.origin + window.location.pathname);
            shareUrl.searchParams.set('config', btoa(JSON.stringify(config)));
            navigator.clipboard.writeText(shareUrl.toString()).then(() => {
                btnShare.style.background = 'rgba(188, 19, 254, 0.4)';
                setTimeout(() => { btnShare.style.background = ''; }, 600);
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = shareUrl.toString();
                ta.style.position = 'fixed'; ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
            });
        });
    }

    const btnSnapshot = document.getElementById('btn-snapshot');
    if (btnSnapshot) {
        btnSnapshot.addEventListener('click', () => {
            state.renderer.render(state.scene, state.camera);
            const dataUrl = state.renderer.domElement.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = 'celestial_snapshot.png';
            a.click();
            btnSnapshot.style.background = 'rgba(188, 19, 254, 0.4)';
            setTimeout(() => { btnSnapshot.style.background = ''; }, 600);
        });
    }

    // Header save/revert controls are owned by the draft session; share/snapshot
    // remain optional local tools when the embedded preview exists.

    // Master Gradient color pickers
    const colorKeys = ['face', 'edge', 'aura', 'pulsar', 'accretion', 'gamma', 'neutrino', 'lightning', 'magnetic'];
    document.getElementById('masterColor1').addEventListener('input', (e) => {
        const v = e.target.value;
        colorKeys.forEach(k => {
            const el = document.getElementById(k + 'Color1');
            if (el) el.value = v;
            state.colors[k][0] = v;
        });
        updateAllColors();
    });
    document.getElementById('masterColor2').addEventListener('input', (e) => {
        const v = e.target.value;
        colorKeys.forEach(k => {
            const el = document.getElementById(k + 'Color2');
            if (el) el.value = v;
            state.colors[k][1] = v;
        });
        updateAllColors();
    });

    // Component gradient pickers
    colorKeys.forEach(k => {
        const el1 = document.getElementById(k + 'Color1');
        const el2 = document.getElementById(k + 'Color2');
        if (el1) el1.addEventListener('input', e => { state.colors[k][0] = e.target.value; updateAllColors(); });
        if (el2) el2.addEventListener('input', e => { state.colors[k][1] = e.target.value; updateAllColors(); });
    });

    // Unified context menu proxy inputs — safe version that skips missing elements
    const proxyInput = (ctxId, sidebarId) => {
        const el = document.getElementById(ctxId);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const sideEl = document.getElementById(sidebarId);
            if (!sideEl) return;
            if (sideEl.type === 'checkbox') sideEl.checked = e.target.checked;
            else sideEl.value = e.target.value;
            sideEl.dispatchEvent(new Event('change', { bubbles: true }));
            sideEl.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    // Shape tab
    proxyInput('ctx-shape', 'shapeSelect');
    proxyInput('ctx-opacity', 'opacitySlider');
    proxyInput('ctx-edge-opacity', 'edgeOpacitySlider');
    proxyInput('ctx-stellation', 'stellationSlider');
    proxyInput('ctx-tet-a', 'tetASlider');
    proxyInput('ctx-tet-b', 'tetBSlider');
    proxyInput('ctx-tet-c', 'tetCSlider');
    proxyInput('ctx-torus-radius', 'torusRadiusSlider');
    proxyInput('ctx-torus-tube', 'torusTubeSlider');
    proxyInput('ctx-torus-arc', 'torusArcSlider');
    proxyInput('ctx-cyl-top', 'cylinderTopSlider');
    proxyInput('ctx-cyl-bottom', 'cylinderBottomSlider');
    proxyInput('ctx-cyl-height', 'cylinderHeightSlider');
    proxyInput('ctx-cyl-sides', 'cylinderSidesSlider');
    proxyInput('ctx-box-width', 'boxWidthSlider');
    proxyInput('ctx-box-height', 'boxHeightSlider');
    proxyInput('ctx-box-depth', 'boxDepthSlider');
    proxyInput('ctx-skin', 'skinSelect');
    proxyInput('ctx-mask', 'maskToggle');
    proxyInput('ctx-interior', 'interiorEdgesToggle');
    proxyInput('ctx-specular', 'specularToggle');
    proxyInput('ctx-omega-toggle', 'omegaToggle');
    proxyInput('ctx-omega-shape', 'omegaShapeSelect');
    proxyInput('ctx-omega-scale', 'omegaScaleSlider');
    proxyInput('ctx-omega-stellation', 'omegaStellationSlider');
    proxyInput('ctx-omega-opacity', 'omegaOpacitySlider');
    proxyInput('ctx-omega-edge-opacity', 'omegaEdgeOpacitySlider');
    proxyInput('ctx-omega-skin', 'omegaSkinSelect');
    proxyInput('ctx-omega-mask', 'omegaMaskToggle');
    proxyInput('ctx-omega-interior', 'omegaInteriorEdgesToggle');
    proxyInput('ctx-omega-specular', 'omegaSpecularToggle');
    proxyInput('ctx-omega-counterspin', 'omegaCounterSpin');
    proxyInput('ctx-omega-lock', 'omegaLockPosition');
    proxyInput('ctx-omega-interdim', 'omegaInterDimensional');
    proxyInput('ctx-omega-tet-a', 'tetASlider');
    proxyInput('ctx-omega-tet-b', 'tetBSlider');
    proxyInput('ctx-omega-tet-c', 'tetCSlider');
    proxyInput('ctx-omega-torus-radius', 'torusRadiusSlider');
    proxyInput('ctx-omega-torus-tube', 'torusTubeSlider');
    proxyInput('ctx-omega-torus-arc', 'torusArcSlider');
    proxyInput('ctx-omega-cyl-top', 'cylinderTopSlider');
    proxyInput('ctx-omega-cyl-bottom', 'cylinderBottomSlider');
    proxyInput('ctx-omega-cyl-height', 'cylinderHeightSlider');
    proxyInput('ctx-omega-cyl-sides', 'cylinderSidesSlider');
    proxyInput('ctx-omega-box-width', 'boxWidthSlider');
    proxyInput('ctx-omega-box-height', 'boxHeightSlider');
    proxyInput('ctx-omega-box-depth', 'boxDepthSlider');

    // Show/hide parameterized shape settings in context menus
    const ctxShapeSettingsMap = { 90: 'ctx-tetartoid-settings', 92: 'ctx-torus-settings', 93: 'ctx-cylinder-settings', 6: 'ctx-box-settings' };
    const ctxOmegaShapeSettingsMap = { 90: 'ctx-omega-tetartoid-settings', 92: 'ctx-omega-torus-settings', 93: 'ctx-omega-cylinder-settings', 6: 'ctx-omega-box-settings' };
    const showCtxShapeSettings = (code, map) => {
        Object.entries(map).forEach(([k, id]) => {
            const el = document.getElementById(id);
            if (el) el.style.display = (parseInt(k) === code) ? '' : 'none';
        });
    };
    const ctxShape = document.getElementById('ctx-shape');
    if (ctxShape) {
        ctxShape.addEventListener('change', () => showCtxShapeSettings(parseInt(ctxShape.value), ctxShapeSettingsMap));
    }
    const ctxOmegaShape = document.getElementById('ctx-omega-shape');
    if (ctxOmegaShape) {
        ctxOmegaShape.addEventListener('change', () => showCtxShapeSettings(parseInt(ctxOmegaShape.value), ctxOmegaShapeSettingsMap));
    }

    // Look tab
    proxyInput('ctx-preset', 'presetSelect');
    proxyInput('ctx-face1', 'faceColor1');
    proxyInput('ctx-face2', 'faceColor2');
    proxyInput('ctx-edge1', 'edgeColor1');
    proxyInput('ctx-edge2', 'edgeColor2');
    proxyInput('ctx-aura1', 'auraColor1');
    proxyInput('ctx-aura2', 'auraColor2');
    proxyInput('ctx-omega-face1', 'omegaFaceColor1');
    proxyInput('ctx-omega-face2', 'omegaFaceColor2');
    proxyInput('ctx-omega-edge1', 'omegaEdgeColor1');
    proxyInput('ctx-omega-edge2', 'omegaEdgeColor2');
    proxyInput('ctx-pulsar-c1', 'pulsarColor1');
    proxyInput('ctx-pulsar-c2', 'pulsarColor2');
    proxyInput('ctx-accretion-c1', 'accretionColor1');
    proxyInput('ctx-accretion-c2', 'accretionColor2');
    proxyInput('ctx-gamma-c1', 'gammaColor1');
    proxyInput('ctx-gamma-c2', 'gammaColor2');
    proxyInput('ctx-neutrino-c1', 'neutrinoColor1');
    proxyInput('ctx-neutrino-c2', 'neutrinoColor2');
    proxyInput('ctx-lightning-c1', 'lightningColor1');
    proxyInput('ctx-lightning-c2', 'lightningColor2');
    proxyInput('ctx-magnetic-c1', 'magneticColor1');
    proxyInput('ctx-magnetic-c2', 'magneticColor2');
    proxyInput('ctx-swarm-fc1', 'swarmColor1');
    proxyInput('ctx-swarm-fc2', 'swarmColor2');
    proxyInput('ctx-grid-c1', 'gridColor1');
    proxyInput('ctx-grid-c2', 'gridColor2');

    // Context menu master color proxy (Primary Color → all color1 slots)
    const ctxColor = document.getElementById('ctx-color');
    if (ctxColor) {
        ctxColor.addEventListener('input', (e) => {
            const v = e.target.value;
            ['face', 'edge', 'aura', 'grid', 'pulsar', 'accretion', 'gamma', 'neutrino', 'lightning', 'magnetic'].forEach(k => {
                const el = document.getElementById(k + 'Color1');
                if (el) { el.value = v; state.colors[k][0] = v; }
            });
            updateAllColors();
        });
    }
    const ctxMaster1 = document.getElementById('ctx-master1');
    if (ctxMaster1) {
        ctxMaster1.addEventListener('input', (e) => {
            document.getElementById('masterColor1').value = e.target.value;
            document.getElementById('masterColor1').dispatchEvent(new Event('input'));
        });
    }
    const ctxMaster2 = document.getElementById('ctx-master2');
    if (ctxMaster2) {
        ctxMaster2.addEventListener('input', (e) => {
            document.getElementById('masterColor2').value = e.target.value;
            document.getElementById('masterColor2').dispatchEvent(new Event('input'));
        });
    }

    // Build FX tile grid
    buildFxGrid();

    // FX tab
    proxyInput('ctx-reach', 'auraReachSlider');
    proxyInput('ctx-intensity', 'auraIntensitySlider');
    proxyInput('ctx-spin', 'idleSpinSlider');
    proxyInput('ctx-lightning-center', 'lightningOriginCenter');
    proxyInput('ctx-lightning-solid', 'lightningSolidBlock');
    proxyInput('ctx-lightning-length', 'lightningLengthSlider');
    proxyInput('ctx-lightning-freq', 'lightningFreqSlider');
    proxyInput('ctx-lightning-dur', 'lightningDurSlider');
    proxyInput('ctx-lightning-branch', 'lightningBranchSlider');
    proxyInput('ctx-lightning-bright', 'lightningBrightSlider');
    proxyInput('ctx-magnetic-count', 'magneticCountSlider');
    proxyInput('ctx-magnetic-speed', 'magneticSpeedSlider');
    proxyInput('ctx-magnetic-wander', 'magneticWanderSlider');
    proxyInput('ctx-pulse-rate', 'pulseRateSlider');
    proxyInput('ctx-spike-mult', 'spikeMultiplier');
    // Pulsar sub-menu
    proxyInput('ctx-pulsar-count', 'pulsarCount');
    proxyInput('ctx-pulsar-turb', 'pTurbSlider');
    proxyInput('ctx-pulsar-turb-spd', 'pTurbSpdSlider');
    proxyInput('ctx-pulsar-phase', 'pTurbMod');

    // Accretion sub-menu
    proxyInput('ctx-accretion-count', 'accretionCount');
    proxyInput('ctx-accretion-turb', 'aTurbSlider');
    proxyInput('ctx-accretion-turb-spd', 'aTurbSpdSlider');
    proxyInput('ctx-accretion-phase', 'aTurbMod');

    // Gamma sub-menu
    proxyInput('ctx-gamma-count', 'gammaCount');
    proxyInput('ctx-gamma-turb', 'gTurbSlider');
    proxyInput('ctx-gamma-turb-spd', 'gTurbSpdSlider');
    proxyInput('ctx-gamma-phase', 'gTurbMod');

    // Neutrino sub-menu
    proxyInput('ctx-neutrino-count', 'neutrinoCount');
    proxyInput('ctx-neutrino-turb', 'nTurbSlider');
    proxyInput('ctx-neutrino-turb-spd', 'nTurbSpdSlider');
    proxyInput('ctx-neutrino-phase', 'nTurbMod');

    proxyInput('ctx-zdepth', 'zDepthSlider');

    // Preset select removed from the stageless shell — presets are reachable
    // via the reroll flyout's "style" scope (apps/sigil/studio/js/reroll.js).

    // Shape param settings: map shape code -> settings container ID
    const shapeSettingsMap = { 90: 'tetartoidSettings', 92: 'torusSettings', 93: 'cylinderSettings', 6: 'boxSettings' };
    const showShapeSettings = (code, prefix) => {
        const pfx = prefix || '';
        Object.entries(shapeSettingsMap).forEach(([k, id]) => {
            const el = document.getElementById(pfx + id);
            if (el) el.style.display = (parseInt(k) === code) ? '' : 'none';
        });
    };

    // Update avatar card labels when shape or preset changes
    function updateAvatarCard() {
        const shapeSelect = document.getElementById('shapeSelect');
        const presetSelect = document.getElementById('presetSelect');
        const shapeLabel = document.getElementById('avatar-shape-label');
        const presetLabel = document.getElementById('avatar-preset-label');
        if (shapeLabel && shapeSelect) shapeLabel.textContent = shapeSelect.options[shapeSelect.selectedIndex].text;
        if (presetLabel && presetSelect) presetLabel.textContent = presetSelect.options[presetSelect.selectedIndex].text;
    }

    // Avatar roster — persisted via content server state endpoint, localStorage fallback
    const ROSTER_KEY = 'sigil-avatar-roster';
    const ROSTER_URL = '/_state/avatar-roster.json';
    const shapeNames = { 4: 'Tetrahedron', 6: 'Box', 8: 'Octahedron', 12: 'Dodecahedron', 20: 'Icosahedron', 90: 'Tetartoid', 91: 'Torus Knot', 92: 'Torus', 93: 'Prism', 94: 'Tesseract', 100: 'Sphere' };

    // In-memory cache — loaded async at startup, sync reads thereafter
    let _rosterCache = [];
    let _rosterLoaded = false;

    function loadRoster() {
        return _rosterCache;
    }
    function saveRosterData(roster) {
        _rosterCache = roster;
        // Try content server state endpoint, fall back to localStorage
        fetch(ROSTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roster)
        }).catch(() => {
            try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch(e) {}
        });
    }
    // Async initial load — tries fetch first, falls back to localStorage
    function initRoster() {
        return fetch(ROSTER_URL).then(r => {
            if (!r.ok) throw new Error(r.status);
            return r.json();
        }).then(data => {
            _rosterCache = Array.isArray(data) ? data : [];
        }).catch(() => {
            try { _rosterCache = JSON.parse(localStorage.getItem(ROSTER_KEY) || '[]'); } catch(e) { _rosterCache = []; }
        }).then(() => {
            _rosterLoaded = true;
            renderRoster();
        });
    }

    function renderRoster() {
        const container = document.getElementById('avatar-roster');
        if (!container) return;
        const roster = loadRoster();
        container.innerHTML = '';

        roster.forEach((entry, idx) => {
            const card = document.createElement('div');
            card.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:1px solid rgba(188,19,254,0.3); background:rgba(30,15,50,0.6); cursor:pointer; transition:all 0.2s;';
            card.innerHTML = '<div style="font-size:1.2rem; opacity:0.7;">&#9670;</div>'
                + '<div style="flex:1; min-width:0;">'
                + '<div style="font-size:0.75rem; color:#fff; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + entry.name + '</div>'
                + '<div style="font-size:0.6rem; color:#aaa;">' + (shapeNames[entry.config.shape] || 'Shape') + (entry.config.omega ? ' + secondary' : '') + '</div>'
                + '</div>'
                + '<div class="roster-overwrite" style="font-size:0.55rem; color:rgba(209,135,255,0.5); cursor:pointer; padding:2px 4px;" title="Overwrite with current config">&#8635;</div>'
                + '<div class="roster-delete" style="font-size:0.7rem; color:rgba(209,135,255,0.4); cursor:pointer; padding:2px 4px;" title="Delete">&#215;</div>';

            card.addEventListener('mouseenter', () => { card.style.borderColor = 'rgba(188,19,254,0.8)'; card.style.background = 'rgba(188,19,254,0.15)'; });
            card.addEventListener('mouseleave', () => { card.style.borderColor = 'rgba(188,19,254,0.3)'; card.style.background = 'rgba(30,15,50,0.6)'; });

            // Click card = load this avatar
            card.addEventListener('click', (e) => {
                if (e.target.closest('.roster-delete') || e.target.closest('.roster-overwrite')) return;
                applyConfig(entry.config);
                updateAvatarCard();
            });

            // Overwrite = save current config into this slot
            card.querySelector('.roster-overwrite').addEventListener('click', (e) => {
                e.stopPropagation();
                const r = loadRoster();
                r[idx].config = getConfig();
                saveRosterData(r);
                renderRoster();
            });

            // Delete
            card.querySelector('.roster-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                const r = loadRoster();
                r.splice(idx, 1);
                saveRosterData(r);
                renderRoster();
            });

            container.appendChild(card);
        });

        // Action buttons row
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:4px; margin-top:6px;';

        // Save current as new
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-action';
        saveBtn.style.cssText = 'flex:1; font-size:0.65rem; padding:6px 8px;';
        saveBtn.textContent = '+ Save As New';
        saveBtn.addEventListener('click', () => {
            // Show inline name input instead of prompt()
            const inputRow = document.createElement('div');
            inputRow.style.cssText = 'display:flex; gap:4px; margin-top:6px;';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'Avatar name...';
            nameInput.style.cssText = 'flex:1; background:#1a0b2e; border:1px solid #bc13fe; color:white; padding:6px 8px; border-radius:4px; font-size:0.7rem; outline:none;';
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'btn-action';
            confirmBtn.style.cssText = 'font-size:0.65rem; padding:6px 10px;';
            confirmBtn.textContent = 'Save';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn-action';
            cancelBtn.style.cssText = 'font-size:0.65rem; padding:6px 8px; opacity:0.6;';
            cancelBtn.textContent = 'Cancel';

            function doSave() {
                try {
                    const name = nameInput.value.trim();
                    if (!name) return;
                    const config = getConfig();
                    const roster = loadRoster();
                    roster.push({ name: name, config: config });
                    saveRosterData(roster);
                    renderRoster();
                } catch(err) {
                    console.error('Roster save failed:', err);
                }
            }
            confirmBtn.addEventListener('click', doSave);
            nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') inputRow.remove(); });
            cancelBtn.addEventListener('click', () => inputRow.remove());

            inputRow.appendChild(nameInput);
            inputRow.appendChild(confirmBtn);
            inputRow.appendChild(cancelBtn);
            container.appendChild(inputRow);
            nameInput.focus();
        });
        actions.appendChild(saveBtn);

        // Export roster to file
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn-action';
        exportBtn.style.cssText = 'font-size:0.65rem; padding:6px 8px;';
        exportBtn.textContent = 'Export';
        exportBtn.title = 'Download roster as JSON file';
        exportBtn.addEventListener('click', () => {
            const roster = loadRoster();
            const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'sigil-roster.json'; a.click();
            URL.revokeObjectURL(url);
        });
        actions.appendChild(exportBtn);

        // Import roster from file
        const importBtn = document.createElement('button');
        importBtn.className = 'btn-action';
        importBtn.style.cssText = 'font-size:0.65rem; padding:6px 8px;';
        importBtn.textContent = 'Import';
        importBtn.title = 'Load roster from JSON file';
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const imported = JSON.parse(ev.target.result);
                        if (!Array.isArray(imported)) throw new Error('Not an array');
                        const existing = loadRoster();
                        const merged = [...existing, ...imported];
                        saveRosterData(merged);
                        renderRoster();
                    } catch(err) { alert('Invalid roster file: ' + err.message); }
                };
                reader.readAsText(file);
            });
            input.click();
        });
        actions.appendChild(importBtn);

        container.appendChild(actions);
    }
    initRoster();

    // Shape
    document.getElementById('shapeSelect').addEventListener('change', (e) => {
        state.currentGeometryType = parseInt(e.target.value);
        updateGeometry(state.currentGeometryType);
        showShapeSettings(state.currentGeometryType);
    });
    document.getElementById('shapeSelect').addEventListener('change', updateAvatarCard);
    // Show shape-specific params for initial shape
    showShapeSettings(state.currentGeometryType);
    document.getElementById('skinSelect').addEventListener('change', (e) => {
        applySkin(e.target.value, false);
    });
    document.getElementById('stellationSlider').addEventListener('input', (e) => {
        state.stellationFactor = parseFloat(e.target.value);
        document.getElementById('stellationVal').innerText = state.stellationFactor.toFixed(2);
        updateGeometry(state.currentGeometryType);
    });

    // Tetartoid parameter sliders
    ['A', 'B', 'C'].forEach(p => {
        const slider = document.getElementById(`tet${p}Slider`);
        const valSpan = document.getElementById(`tet${p}Val`);
        if (!slider) return;
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state[`tetartoid${p}`] = val;
            if (valSpan) valSpan.textContent = val.toFixed(2);
            if (state.currentGeometryType === 90) updateGeometry(90);
        });
    });

    // Torus parameter sliders
    [['torusRadiusSlider', 'torusRadiusVal', 'torusRadius'],
     ['torusTubeSlider', 'torusTubeVal', 'torusTube'],
     ['torusArcSlider', 'torusArcVal', 'torusArc']].forEach(([sliderId, valId, stateKey]) => {
        const slider = document.getElementById(sliderId);
        if (!slider) return;
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state[stateKey] = val;
            const valSpan = document.getElementById(valId);
            if (valSpan) valSpan.textContent = val.toFixed(2);
            if (state.currentGeometryType === 92) updateGeometry(92);
        });
    });

    // Cylinder parameter sliders
    [['cylinderTopSlider', 'cylinderTopVal', 'cylinderTopRadius', false],
     ['cylinderBottomSlider', 'cylinderBottomVal', 'cylinderBottomRadius', false],
     ['cylinderHeightSlider', 'cylinderHeightVal', 'cylinderHeight', false],
     ['cylinderSidesSlider', 'cylinderSidesVal', 'cylinderSides', true]].forEach(([sliderId, valId, stateKey, isInt]) => {
        const slider = document.getElementById(sliderId);
        if (!slider) return;
        slider.addEventListener('input', (e) => {
            const val = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
            state[stateKey] = val;
            const valSpan = document.getElementById(valId);
            if (valSpan) valSpan.textContent = isInt ? val : val.toFixed(2);
            if (state.currentGeometryType === 93) updateGeometry(93);
        });
    });

    // Box parameter sliders
    [['boxWidthSlider', 'boxWidthVal', 'boxWidth'],
     ['boxHeightSlider', 'boxHeightVal', 'boxHeight'],
     ['boxDepthSlider', 'boxDepthVal', 'boxDepth']].forEach(([sliderId, valId, stateKey]) => {
        const slider = document.getElementById(sliderId);
        if (!slider) return;
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state[stateKey] = val;
            const valSpan = document.getElementById(valId);
            if (valSpan) valSpan.textContent = val.toFixed(2);
            if (state.currentGeometryType === 6) updateGeometry(6);
        });
    });

    // Opacity
    document.getElementById('opacitySlider').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('opacityVal').innerText = val.toFixed(2);
        updateOpacity(val);
    });
    document.getElementById('edgeOpacitySlider').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('edgeOpacityVal').innerText = val.toFixed(2);
        updateEdgeOpacity(val);
        // Show/hide interior edges checkbox based on edge visibility
        const edgeControls = document.getElementById('edgeSubControls');
        if (edgeControls) edgeControls.style.display = val > 0 ? '' : 'none';
    });
    document.getElementById('maskToggle').addEventListener('change', (e) => {
        state.isMaskEnabled = !e.target.checked; // inverted: "Show Faces" checked = mask disabled
        updateOpacity(state.currentOpacity);
        // Show/hide face-dependent controls
        const faceControls = document.getElementById('faceSubControls');
        if (faceControls) faceControls.style.display = e.target.checked ? 'flex' : 'none';
    });
    document.getElementById('interiorEdgesToggle').addEventListener('change', (e) => {
        state.isInteriorEdgesEnabled = e.target.checked;
        if (state.depthMesh) state.depthMesh.visible = !state.isInteriorEdgesEnabled;
        updateOpacity(state.currentOpacity);
    });
    document.getElementById('specularToggle').addEventListener('change', (e) => { state.isSpecularEnabled = e.target.checked; updateOpacity(state.currentOpacity); });

    // Phenomena toggles with inline settings
    const phenomenonConfig = [
        { toggleId: 'pulsarToggle', settingsId: 'pulsarSettings', countId: 'pulsarCount',
          stateKey: 'isPulsarEnabled', groupKey: 'pulsarGroup', countKey: 'pulsarRayCount',
          turbKey: 'p', updateFn: updatePulsars },
        { toggleId: 'accretionToggle', settingsId: 'accretionSettings', countId: 'accretionCount',
          stateKey: 'isAccretionEnabled', groupKey: 'accretionGroup', countKey: 'accretionDiskCount',
          turbKey: 'a', updateFn: updateAccretion },
        { toggleId: 'gammaToggle', settingsId: 'gammaSettings', countId: 'gammaCount',
          stateKey: 'isGammaEnabled', groupKey: 'gammaRaysGroup', countKey: 'gammaRayCount',
          turbKey: 'g', updateFn: updateGammaRays },
        { toggleId: 'neutrinoToggle', settingsId: 'neutrinoSettings', countId: 'neutrinoCount',
          stateKey: 'isNeutrinosEnabled', groupKey: 'neutrinoGroup', countKey: 'neutrinoJetCount',
          turbKey: 'n', updateFn: updateNeutrinos }
    ];

    phenomenonConfig.forEach(cfg => {
        // Toggle on/off (sub-settings visibility handled by gear icon)
        document.getElementById(cfg.toggleId).addEventListener('change', (e) => {
            state[cfg.stateKey] = e.target.checked;
            if (state[cfg.groupKey]) state[cfg.groupKey].visible = state[cfg.stateKey];
        });

        // Count input
        document.getElementById(cfg.countId).addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val)) return;
            if (val < 1) val = 1; if (val > 150) val = 150; e.target.value = val;
            state[cfg.countKey] = val;
            cfg.updateFn(val);
        });

        // Turbulence amount slider
        const k = cfg.turbKey;
        document.getElementById(`${k}TurbSlider`).addEventListener('input', (e) => {
            state.turbState[k].val = parseFloat(e.target.value);
            document.getElementById(`${k}TurbVal`).innerText = parseFloat(e.target.value).toFixed(2);
        });

        // Turbulence speed slider
        document.getElementById(`${k}TurbSpdSlider`).addEventListener('input', (e) => {
            state.turbState[k].spd = parseFloat(e.target.value);
            document.getElementById(`${k}TurbSpdVal`).innerText = parseFloat(e.target.value).toFixed(1);
        });

        // Phase mode dropdown
        document.getElementById(`${k}TurbMod`).addEventListener('change', (e) => {
            state.turbState[k].mod = e.target.value;
        });
    });

    // Lightning Arcs
    document.getElementById('lightningToggle').addEventListener('change', (e) => {
        state.isLightningEnabled = e.target.checked;
    });
    document.getElementById('lightningOriginCenter').addEventListener('change', (e) => { state.lightningOriginCenter = e.target.checked; });
    document.getElementById('lightningSolidBlock').addEventListener('change', (e) => { state.lightningSolidBlock = e.target.checked; });
    document.getElementById('lightningLengthSlider').addEventListener('input', (e) => {
        state.lightningBoltLength = parseInt(e.target.value);
        document.getElementById('lightningLengthVal').innerText = state.lightningBoltLength;
    });
    document.getElementById('lightningFreqSlider').addEventListener('input', (e) => {
        state.lightningFrequency = parseFloat(e.target.value);
        document.getElementById('lightningFreqVal').innerText = state.lightningFrequency.toFixed(1);
    });
    document.getElementById('lightningDurSlider').addEventListener('input', (e) => {
        state.lightningDuration = parseFloat(e.target.value);
        document.getElementById('lightningDurVal').innerText = state.lightningDuration.toFixed(1);
    });
    document.getElementById('lightningBranchSlider').addEventListener('input', (e) => {
        state.lightningBranching = parseFloat(e.target.value);
        document.getElementById('lightningBranchVal').innerText = state.lightningBranching.toFixed(2);
    });
    document.getElementById('lightningBrightSlider').addEventListener('input', (e) => {
        state.lightningBrightness = parseFloat(e.target.value);
        document.getElementById('lightningBrightVal').innerText = state.lightningBrightness.toFixed(1);
    });
    // Magnetic Field
    document.getElementById('magneticToggle').addEventListener('change', (e) => {
        state.isMagneticEnabled = e.target.checked;
    });
    document.getElementById('magneticCountSlider').addEventListener('input', (e) => {
        state.magneticTentacleCount = parseInt(e.target.value);
        document.getElementById('magneticCountVal').innerText = state.magneticTentacleCount;
    });
    document.getElementById('magneticSpeedSlider').addEventListener('input', (e) => {
        state.magneticTentacleSpeed = parseFloat(e.target.value);
        document.getElementById('magneticSpeedVal').innerText = state.magneticTentacleSpeed.toFixed(1);
    });
    document.getElementById('magneticWanderSlider').addEventListener('input', (e) => {
        state.magneticWander = parseFloat(e.target.value);
        document.getElementById('magneticWanderVal').innerText = state.magneticWander.toFixed(1);
    });

    // Omega Shape
    document.getElementById('omegaToggle').addEventListener('change', (e) => {
        state.isOmegaEnabled = e.target.checked;
        // Toggle dimmed state on secondary content
        const secondaryContent = document.getElementById('secondary-shape-content');
        if (secondaryContent) secondaryContent.classList.toggle('dimmed', !e.target.checked);
        // Toggle omega colors in Colors panel
        const omegaColors = document.getElementById('omegaColorGroup');
        if (omegaColors) omegaColors.style.display = e.target.checked ? '' : 'none';
    });
    document.getElementById('omegaShapeSelect').addEventListener('change', (e) => {
        state.omegaGeometryType = parseInt(e.target.value);
        updateOmegaGeometry(state.omegaGeometryType);
    });
    document.getElementById('omegaSkinSelect').addEventListener('change', (e) => {
        applySkin(e.target.value, true);
    });
    document.getElementById('omegaStellationSlider').addEventListener('input', (e) => {
        state.omegaStellationFactor = parseFloat(e.target.value);
        document.getElementById('omegaStellationVal').innerText = state.omegaStellationFactor.toFixed(2);
        updateOmegaGeometry(state.omegaGeometryType);
    });
    document.getElementById('omegaScaleSlider').addEventListener('input', (e) => {
        state.omegaScale = parseFloat(e.target.value);
        document.getElementById('omegaScaleVal').innerText = state.omegaScale.toFixed(2);
    });
    document.getElementById('omegaOpacitySlider').addEventListener('input', (e) => {
        state.omegaOpacity = parseFloat(e.target.value);
        document.getElementById('omegaOpacityVal').innerText = state.omegaOpacity.toFixed(2);
        if (state.omegaCoreMesh) {
            state.omegaCoreMesh.material.opacity = state.omegaOpacity;
            state.omegaCoreMesh.material.transparent = state.omegaOpacity < 0.99;
            state.omegaCoreMesh.material.needsUpdate = true;
        }
    });
    document.getElementById('omegaEdgeOpacitySlider').addEventListener('input', (e) => {
        state.omegaEdgeOpacity = parseFloat(e.target.value);
        document.getElementById('omegaEdgeOpacityVal').innerText = state.omegaEdgeOpacity.toFixed(2);
        if (state.omegaWireframeMesh) {
            state.omegaWireframeMesh.material.opacity = state.omegaEdgeOpacity;
            state.omegaWireframeMesh.material.needsUpdate = true;
        }
        const omegaEdgeSub = document.getElementById('omegaEdgeSubControls');
        if (omegaEdgeSub) omegaEdgeSub.style.display = state.omegaEdgeOpacity > 0 ? '' : 'none';
    });
    document.getElementById('omegaMaskToggle').addEventListener('change', (e) => {
        state.omegaIsMaskEnabled = !e.target.checked; // inverted: Show Faces checked = mask disabled
        if (state.omegaCoreMesh) state.omegaCoreMesh.visible = e.target.checked;
        const omegaFaceSub = document.getElementById('omegaFaceSubControls');
        if (omegaFaceSub) omegaFaceSub.style.display = e.target.checked ? 'flex' : 'none';
    });
    document.getElementById('omegaInteriorEdgesToggle').addEventListener('change', (e) => {
        state.omegaIsInteriorEdgesEnabled = e.target.checked;
        if (state.omegaDepthMesh) state.omegaDepthMesh.visible = !e.target.checked;
    });
    document.getElementById('omegaSpecularToggle').addEventListener('change', (e) => {
        state.omegaIsSpecularEnabled = e.target.checked;
        if (state.omegaCoreMesh) {
            state.omegaCoreMesh.material.specular = e.target.checked ? new THREE.Color(0x333333) : new THREE.Color(0x000000);
            state.omegaCoreMesh.material.shininess = e.target.checked ? 80 : 0;
            state.omegaCoreMesh.material.needsUpdate = true;
        }
    });
    // Omega colors
    document.getElementById('omegaFaceColor1').addEventListener('input', (e) => { state.colors.omegaFace[0] = e.target.value; updateAllColors(); });
    document.getElementById('omegaFaceColor2').addEventListener('input', (e) => { state.colors.omegaFace[1] = e.target.value; updateAllColors(); });
    document.getElementById('omegaEdgeColor1').addEventListener('input', (e) => { state.colors.omegaEdge[0] = e.target.value; updateAllColors(); });
    document.getElementById('omegaEdgeColor2').addEventListener('input', (e) => { state.colors.omegaEdge[1] = e.target.value; updateAllColors(); });
    // Omega motion
    document.getElementById('omegaCounterSpin').addEventListener('change', (e) => { state.omegaCounterSpin = e.target.checked; });
    document.getElementById('omegaLockPosition').addEventListener('change', (e) => { state.omegaLockPosition = e.target.checked; });
    document.getElementById('omegaInterDimensional').addEventListener('change', (e) => {
        state.omegaInterDimensional = e.target.checked;
        document.getElementById('omegaGhostSettings').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('omegaGhostCountSlider').addEventListener('input', (e) => {
        state.omegaGhostCount = parseInt(e.target.value);
        document.getElementById('omegaGhostCountVal').innerText = state.omegaGhostCount;
    });
    document.getElementById('omegaGhostDurSlider').addEventListener('input', (e) => {
        state.omegaGhostDuration = parseFloat(e.target.value);
        document.getElementById('omegaGhostDurVal').innerText = state.omegaGhostDuration.toFixed(1);
    });
    document.getElementById('omegaGhostMode').addEventListener('change', (e) => { state.omegaGhostMode = e.target.value; });

    // Spin
    document.getElementById('idleSpinSlider').addEventListener('input', (e) => {
        state.idleSpinSpeed = parseFloat(e.target.value);
        document.getElementById('idleSpinVal').innerText = state.idleSpinSpeed.toFixed(3);
    });
    document.getElementById('btn-quick-spin').addEventListener('click', () => {
        state.quickSpinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        state.quickSpinSpeed = 0.4;
        state.quickSpinActive = true;
        state.quickSpinEndTime = performance.now() + 2000;
    });

    // Aura
    document.getElementById('auraToggle').addEventListener('change', (e) => {
        state.isAuraEnabled = e.target.checked;
        document.getElementById('auraIntensityWrapper').style.display = state.isAuraEnabled ? 'block' : 'none';
    });
    document.getElementById('auraReachSlider').addEventListener('input', (e) => {
        state.auraReach = parseFloat(e.target.value);
        document.getElementById('auraReachVal').innerText = state.auraReach.toFixed(2);
    });
    document.getElementById('auraIntensitySlider').addEventListener('input', (e) => {
        state.auraIntensity = parseFloat(e.target.value);
        document.getElementById('auraIntensityVal').innerText = state.auraIntensity.toFixed(2);
    });
    document.getElementById('pulseRateSlider').addEventListener('input', (e) => {
        state.auraPulseRate = parseFloat(e.target.value);
        document.getElementById('pulseRateVal').innerText = state.auraPulseRate.toFixed(3);
    });
    document.getElementById('btn-spike').addEventListener('click', () => { state.auraSpike = 1.0; });
    document.getElementById('spikeMultiplier').addEventListener('input', (e) => { state.spikeMultiplier = parseFloat(e.target.value); });
    document.getElementById('auraDepthOffsetSlider').addEventListener('input', (e) => {
        state.auraDepthOffset = parseFloat(e.target.value);
        document.getElementById('auraDepthOffsetVal').innerText = state.auraDepthOffset.toFixed(1);
    });
    document.getElementById('auraBaseScaleSlider').addEventListener('input', (e) => {
        state.auraBaseScale = parseFloat(e.target.value);
        document.getElementById('auraBaseScaleVal').innerText = state.auraBaseScale.toFixed(1);
    });
    document.getElementById('auraPulseAmplitudeSlider').addEventListener('input', (e) => {
        state.auraPulseAmplitude = parseFloat(e.target.value);
        document.getElementById('auraPulseAmplitudeVal').innerText = state.auraPulseAmplitude.toFixed(2);
    });
    document.getElementById('auraCoreFadeSlider').addEventListener('input', (e) => {
        state.auraCoreFade = parseFloat(e.target.value);
        document.getElementById('auraCoreFadeVal').innerText = state.auraCoreFade.toFixed(2);
    });
    document.getElementById('auraSpikeDecaySlider').addEventListener('input', (e) => {
        state.auraSpikeDecay = parseFloat(e.target.value);
        document.getElementById('auraSpikeDecayVal').innerText = state.auraSpikeDecay.toFixed(2);
    });

    // Super Charge button removed with the 3D preview — the charge gesture
    // only made sense against the in-app canvas. Desktop avatar is the
    // preview now; charge is triggered via agent channel events if needed.

    document.getElementById('trailToggle').addEventListener('change', (e) => {
        state.isTrailEnabled = e.target.checked;
    });
    document.getElementById('trailLengthSlider').addEventListener('input', (e) => {
        state.trailLength = parseInt(e.target.value, 10);
        document.getElementById('trailLengthVal').innerText = state.trailLength;
    });
    document.getElementById('trailOpacitySlider').addEventListener('input', (e) => {
        state.trailOpacity = parseFloat(e.target.value);
        document.getElementById('trailOpacityVal').innerText = state.trailOpacity.toFixed(2);
    });
    document.getElementById('trailFadeSlider').addEventListener('input', (e) => {
        state.trailFadeMs = parseInt(e.target.value, 10);
        document.getElementById('trailFadeVal').innerText = state.trailFadeMs;
    });
    document.getElementById('trailStyleSelect').addEventListener('change', (e) => {
        state.trailStyle = e.target.value;
    });

    // Z-Depth scale
    document.getElementById('zDepthSlider').addEventListener('input', (e) => {
        state.z_depth = parseFloat(e.target.value);
        document.getElementById('zDepthVal').innerText = state.z_depth.toFixed(2);
    });

    document.getElementById('avatarHitRadiusSlider').addEventListener('input', (e) => {
        state.avatarHitRadius = parseInt(e.target.value, 10);
        document.getElementById('avatarHitRadiusVal').innerText = state.avatarHitRadius;
    });
    document.getElementById('dragThresholdSlider').addEventListener('input', (e) => {
        state.dragThreshold = parseInt(e.target.value, 10);
        document.getElementById('dragThresholdVal').innerText = state.dragThreshold;
    });
    document.getElementById('dragCancelRadiusSlider').addEventListener('input', (e) => {
        state.dragCancelRadius = parseInt(e.target.value, 10);
        document.getElementById('dragCancelRadiusVal').innerText = state.dragCancelRadius;
    });
    document.getElementById('gotoRingRadiusSlider').addEventListener('input', (e) => {
        state.gotoRingRadius = parseInt(e.target.value, 10);
        document.getElementById('gotoRingRadiusVal').innerText = state.gotoRingRadius;
    });
    document.getElementById('menuRingRadiusSlider').addEventListener('input', (e) => {
        state.menuRingRadius = parseInt(e.target.value, 10);
        document.getElementById('menuRingRadiusVal').innerText = state.menuRingRadius;
    });
    document.getElementById('transitionEnterEffectSelect').addEventListener('change', (e) => {
        state.transitionEnterEffect = normalizeTransitionEffect(e.target.value, DEFAULT_TRANSITION_EFFECT);
        updateTransitionSettingsVisibility();
    });
    document.getElementById('transitionExitEffectSelect').addEventListener('change', (e) => {
        state.transitionExitEffect = normalizeTransitionEffect(e.target.value, DEFAULT_TRANSITION_EFFECT);
        updateTransitionSettingsVisibility();
    });
    document.getElementById('transitionScaleDurationSlider').addEventListener('input', (e) => {
        state.transitionScaleDuration = parseFloat(e.target.value);
        document.getElementById('transitionScaleDurationVal').innerText = state.transitionScaleDuration.toFixed(2);
    });
    document.getElementById('wormholeCaptureRadiusSlider').addEventListener('input', (e) => {
        state.wormholeCaptureRadius = parseInt(e.target.value, 10);
        document.getElementById('wormholeCaptureRadiusVal').innerText = state.wormholeCaptureRadius;
    });
    document.getElementById('wormholeImplosionDurationSlider').addEventListener('input', (e) => {
        state.wormholeImplosionDuration = parseFloat(e.target.value);
        document.getElementById('wormholeImplosionDurationVal').innerText = state.wormholeImplosionDuration.toFixed(2);
    });
    document.getElementById('wormholeReboundDurationSlider').addEventListener('input', (e) => {
        state.wormholeReboundDuration = parseFloat(e.target.value);
        document.getElementById('wormholeReboundDurationVal').innerText = state.wormholeReboundDuration.toFixed(2);
    });
    document.getElementById('wormholeDistortionStrengthSlider').addEventListener('input', (e) => {
        state.wormholeDistortionStrength = parseFloat(e.target.value);
        document.getElementById('wormholeDistortionStrengthVal').innerText = state.wormholeDistortionStrength.toFixed(2);
    });
    document.getElementById('wormholeWhitePointIntensitySlider').addEventListener('input', (e) => {
        state.wormholeWhitePointIntensity = parseFloat(e.target.value);
        document.getElementById('wormholeWhitePointIntensityVal').innerText = state.wormholeWhitePointIntensity.toFixed(2);
    });
    document.getElementById('wormholeStarburstIntensitySlider').addEventListener('input', (e) => {
        state.wormholeStarburstIntensity = parseFloat(e.target.value);
        document.getElementById('wormholeStarburstIntensityVal').innerText = state.wormholeStarburstIntensity.toFixed(2);
    });
    document.getElementById('wormholeLensFlareIntensitySlider').addEventListener('input', (e) => {
        state.wormholeLensFlareIntensity = parseFloat(e.target.value);
        document.getElementById('wormholeLensFlareIntensityVal').innerText = state.wormholeLensFlareIntensity.toFixed(2);
    });

    // --- URL query string handling ---
    const params = new URLSearchParams(window.location.search);
    if (params.has('seed')) {
        const seed = parseInt(params.get('seed'));
        if (!isNaN(seed)) setTimeout(() => randomizeAll(seed, 'everything', { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos }), 100);
    } else if (params.has('config')) {
        try {
            const json = atob(params.get('config'));
            setTimeout(() => applyConfig(JSON.parse(json)), 100);
        } catch (e) { console.warn('Invalid config param', e); }
    }

}

export function setupEditableLabels() {
    makeEditable('stellationVal', -1, 2, true, (val) => { document.getElementById('stellationSlider').value = val; state.stellationFactor = val; updateGeometry(state.currentGeometryType); });
    makeEditable('opacityVal', 0, 1, true, (val) => { document.getElementById('opacitySlider').value = val; updateOpacity(val); });
    makeEditable('edgeOpacityVal', 0, 1, true, (val) => { document.getElementById('edgeOpacitySlider').value = val; updateEdgeOpacity(val); });
    makeEditable('idleSpinVal', 0, 0.1, true, (val) => { document.getElementById('idleSpinSlider').value = val; state.idleSpinSpeed = val; });
    makeEditable('auraReachVal', 0, 3, true, (val) => { document.getElementById('auraReachSlider').value = val; state.auraReach = val; });
    makeEditable('auraIntensityVal', 0, 3, true, (val) => { document.getElementById('auraIntensitySlider').value = val; state.auraIntensity = val; });
    makeEditable('pulseRateVal', 0.001, 0.02, true, (val) => { document.getElementById('pulseRateSlider').value = val; state.auraPulseRate = val; });
    // Old 2D grid editables removed — unified into grid3d
    makeEditable('zDepthVal', 0.25, 3.0, true, (val) => { document.getElementById('zDepthSlider').value = val; state.z_depth = val; });

    // Turbulence editable labels
    ['p', 'a', 'g', 'n'].forEach(k => {
        makeEditable(`${k}TurbVal`, 0, 1, true, (val) => { document.getElementById(`${k}TurbSlider`).value = val; state.turbState[k].val = val; });
        makeEditable(`${k}TurbSpdVal`, 0.1, 10, true, (val) => { document.getElementById(`${k}TurbSpdSlider`).value = val; state.turbState[k].spd = val; });
    });
}
