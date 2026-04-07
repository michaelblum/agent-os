import state from '../../js/state.js';
import { initScene } from './scene.js';
import { updateGeometry } from '../../js/geometry.js';
import { updateAllColors } from '../../js/colors.js';
import { createAuraObjects, animateAura } from '../../js/aura.js';
import { createPhenomena, animatePhenomena } from '../../js/phenomena.js';
import { createParticleObjects, animateParticles, animateTrails, fireExplosion, fireSuperNova } from '../../js/particles.js';
// grid.js removed — unified into grid3d.js
import { setupInteraction, updateCameraTransition } from './interaction.js';
import { animatePathing } from './pathing.js';
import { setupUI, setupEditableLabels } from './ui.js';
import { createLightning, animateLightning } from '../../js/lightning.js';
import { createMagneticField, animateMagneticField } from '../../js/magnetic.js';
import { createOmega, animateOmega } from '../../js/omega.js';
import { createGrid3d, animateGrid3d } from './grid3d.js';
import { createSwarm, animateSwarm } from './swarm.js';
import { animateSkybox } from './skybox.js';
import { animateSkins } from '../../js/skins.js';
import Stats from '../../js/lib/stats.module.js';

function init() {
    initScene();
    // Old 2D grid removed — unified into grid3d
    createAuraObjects();
    createParticleObjects();
    createPhenomena();
    createLightning();
    createMagneticField();
    createOmega();
    createGrid3d();
    createSwarm();

    updateGeometry(state.currentGeometryType);
    updateAllColors();

    state.polyGroup.scale.set(state.z_depth, state.z_depth, state.z_depth);

    setupInteraction();
    setupUI();
    setupEditableLabels();

    // Performance stats (toggle with 'P' key)
    state.stats = new Stats();
    state.stats.dom.style.cssText = 'position:fixed;top:0;right:0;z-index:10000;';
    state.stats.dom.style.display = 'none';
    document.body.appendChild(state.stats.dom);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            state.statsVisible = !state.statsVisible;
            state.stats.dom.style.display = state.statsVisible ? '' : 'none';
        }
    });

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

    // Camera transition (smooth reorientation on mode switch)
    updateCameraTransition(dt);

    // Module animations
    animateSkybox(dt);
    animatePathing(dt);
    // Old animateGrid() removed — unified into grid3d
    animateGrid3d(dt);
    animateSwarm(dt);
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

    // Z-depth scale interpolation
    if (state.scale_anim_active && !state.isDestroyed && !state.isRespawning) {
        const elapsed = performance.now() - state.scale_anim_start_time;
        const progress = Math.min(elapsed / 2000, 1.0);
        const ease = progress * progress * (3 - 2 * progress);
        state.z_depth = state.scale_anim_start_val + (state.target_z_depth - state.scale_anim_start_val) * ease;
        document.getElementById('zDepthSlider').value = state.z_depth;
        document.getElementById('zDepthVal').innerText = state.z_depth.toFixed(2);
        if (progress >= 1.0) { state.z_depth = state.target_z_depth; state.scale_anim_active = false; }
    }

    // Apply unified scale
    state.polyGroup.scale.setScalar(state.z_depth * state.novaScale);

    state.renderer.render(state.scene, state.camera);
    if (state.stats) state.stats.update();
}

window.onload = init;
