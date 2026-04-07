import state from '../../js/state.js';
import { initScene, screenToScene } from './scene.js';
import { updateGeometry } from '../../js/geometry.js';
import { updateAllColors } from '../../js/colors.js';
import { createAuraObjects, animateAura } from '../../js/aura.js';
import { createPhenomena, animatePhenomena } from '../../js/phenomena.js';
import { createParticleObjects, animateParticles, animateTrails, fireExplosion, fireSuperNova } from '../../js/particles.js';
import { animatePathing, setScenePosition } from './pathing.js';
import { createLightning, animateLightning } from '../../js/lightning.js';
import { createMagneticField, animateMagneticField } from '../../js/magnetic.js';
import { createOmega, animateOmega } from '../../js/omega.js';
import { animateSkins } from '../../js/skins.js';

function init() {
    initScene();
    createAuraObjects();
    createParticleObjects();
    createPhenomena();
    createLightning();
    createMagneticField();
    createOmega();

    updateGeometry(state.currentGeometryType);
    updateAllColors();

    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);

    setupIPC();
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    const dt = 0.016;

    // Advance global turbulence clock
    state.globalTime += dt;

    // Nova scale calculation
    if (state.collapseTime > 0 && state.wasFullCharge) {
        let t = Math.max(0, state.collapseTime) / 0.75;
        state.novaScale = t * t * t;
    } else if (state.isDestroyed) {
        state.novaScale = 0.0;
    } else if (state.isRespawning) {
        state.respawnTimer += dt;
        let progress = Math.min(state.respawnTimer / 2.0, 1.0);
        let c4 = (2.0 * Math.PI) / 3;
        state.novaScale = progress === 0 ? 0 : progress === 1 ? 1 :
            Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;
        if (progress >= 1.0) state.isRespawning = false;
    } else {
        state.novaScale = 1.0;
    }

    // Module animations (no skybox, grid, swarm, or camera transition in live mode)
    animatePathing(dt);
    animateParticles(dt);
    animatePhenomena(dt);
    animateAura(dt);
    animateLightning(dt);
    animateMagneticField(dt);
    animateOmega(dt);
    animateSkins(dt);
    animateTrails(dt);

    // Check for deferred fire signals from aura collapse
    if (state._fireSuperNova) {
        state._fireSuperNova = false;
        fireSuperNova();
    }
    if (state._fireExplosion) {
        state._fireExplosion = false;
        fireExplosion();
    }

    // Apply unified scale
    state.polyGroup.scale.setScalar(state.z_depth * state.novaScale);

    state.renderer.render(state.scene, state.camera);
}

// --- IPC ---

function setupIPC() {
    if (!window.headsup) return;

    window.headsup.receive((msg) => {
        try {
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            handleMessage(data);
        } catch (e) {
            console.error('[live] IPC parse error:', e);
        }
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'scene_position': {
            const [px, py] = msg.position;
            const { x, y } = screenToScene(px, py);
            setScenePosition(x, y);
            break;
        }

        case 'transit_start': {
            const [px, py] = msg.position;
            const { x, y } = screenToScene(px, py);
            // Snap to initial position before transit begins
            setScenePosition(x, y);
            state.omegaInterDimensional = true;
            break;
        }

        case 'transit_end': {
            _waitForEffectsSettled().then(() => {
                window.postMessage({ type: 'effects_settled' }, '*');
            });
            break;
        }

        case 'config': {
            applyConfig(msg.data);
            break;
        }

        case 'show': {
            document.body.style.visibility = 'visible';
            break;
        }

        case 'hide': {
            document.body.style.visibility = 'hidden';
            break;
        }

        case 'behavior': {
            applyBehaviorPreset(msg.slot, msg.data);
            break;
        }

        default:
            break;
    }
}

function applyConfig(config) {
    if (config == null) return;

    // Geometry
    if (config.shape != null) {
        state.currentGeometryType = config.shape;
        updateGeometry(state.currentGeometryType);
    }
    if (config.stellationFactor != null) {
        state.stellationFactor = config.stellationFactor;
        updateGeometry(state.currentGeometryType);
    }
    if (config.opacity != null) {
        state.currentOpacity = config.opacity;
    }
    if (config.edgeOpacity != null) {
        state.currentEdgeOpacity = config.edgeOpacity;
    }
    if (config.isMaskEnabled != null) {
        state.isMaskEnabled = config.isMaskEnabled;
    }
    if (config.isInteriorEdgesEnabled != null) {
        state.isInteriorEdgesEnabled = config.isInteriorEdgesEnabled;
    }
    if (config.isSpecularEnabled != null) {
        state.isSpecularEnabled = config.isSpecularEnabled;
    }

    // Colors
    if (config.colors != null) {
        Object.assign(state.colors, config.colors);
    }

    // Aura
    if (config.isAuraEnabled != null) {
        state.isAuraEnabled = config.isAuraEnabled;
    }
    if (config.auraReach != null) {
        state.auraReach = config.auraReach;
    }
    if (config.auraIntensity != null) {
        state.auraIntensity = config.auraIntensity;
    }
    if (config.auraPulseRate != null) {
        state.auraPulseRate = config.auraPulseRate;
    }

    // Effects toggles
    if (config.isPulsarEnabled != null) state.isPulsarEnabled = config.isPulsarEnabled;
    if (config.isAccretionEnabled != null) state.isAccretionEnabled = config.isAccretionEnabled;
    if (config.isGammaEnabled != null) state.isGammaEnabled = config.isGammaEnabled;
    if (config.isNeutrinosEnabled != null) state.isNeutrinosEnabled = config.isNeutrinosEnabled;
    if (config.isLightningEnabled != null) state.isLightningEnabled = config.isLightningEnabled;
    if (config.isMagneticEnabled != null) state.isMagneticEnabled = config.isMagneticEnabled;

    // Omega / ghost settings
    if (config.isOmegaEnabled != null) state.isOmegaEnabled = config.isOmegaEnabled;
    if (config.omegaInterDimensional != null) state.omegaInterDimensional = config.omegaInterDimensional;
    if (config.omegaGhostCount != null) state.omegaGhostCount = config.omegaGhostCount;
    if (config.omegaGhostMode != null) state.omegaGhostMode = config.omegaGhostMode;
    if (config.omegaGhostDuration != null) state.omegaGhostDuration = config.omegaGhostDuration;
    if (config.omegaLagFactor != null) state.omegaLagFactor = config.omegaLagFactor;
    if (config.omegaScale != null) state.omegaScale = config.omegaScale;
    if (config.omegaOpacity != null) state.omegaOpacity = config.omegaOpacity;
    if (config.omegaEdgeOpacity != null) state.omegaEdgeOpacity = config.omegaEdgeOpacity;
    if (config.omegaCounterSpin != null) state.omegaCounterSpin = config.omegaCounterSpin;

    // Spin speed
    if (config.idleSpinSpeed != null) state.idleSpinSpeed = config.idleSpinSpeed;

    // Rebuild colors after any changes
    updateAllColors();
}

function applyBehaviorPreset(slot, data) {
    switch (slot) {
        case 'fast_travel':
            state.omegaInterDimensional = true;
            state.isOmegaEnabled = true;
            break;

        case 'standby':
        case 'idle':
            state.omegaInterDimensional = false;
            break;

        default:
            break;
    }

    // Allow fine-grained overrides from the data payload
    if (data) {
        applyConfig(data);
    }
}

function _waitForEffectsSettled() {
    return new Promise((resolve) => {
        const check = () => {
            if (!state.omegaGhosts || state.omegaGhosts.length === 0) {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

window.onload = init;
