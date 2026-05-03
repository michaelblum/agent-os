// appearance.js — State-as-source-of-truth gateway.
//
// `applyAppearance(blob)` writes a structured appearance blob into the shared
// `state` module and triggers the renderer-side update hooks that rebuild
// Three.js meshes/materials when the underlying field is not read every frame.
//
// `snapshotAppearance()` is the inverse — returns a blob that, fed back through
// applyAppearance, produces an equivalent state (roundtrip-stable).
//
// Neither function touches the DOM. Studio's existing UI listeners continue to
// write `state.x = value` directly on every input event (that flow is unchanged);
// on load, Studio calls `applyAppearance(DEFAULT_APPEARANCE)` then
// `syncUIFromState()` (ui.js) to mirror state back into DOM input values.

import state from './state.js';
import { updateAllColors } from './colors.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from './phenomena.js';
import { updateGeometry, updateOmegaGeometry } from './geometry.js';
import { applySkin } from './skins.js';
import {
    DEFAULT_SIGIL_RADIAL_ITEMS,
    normalizeSigilRadialGestureMenu,
} from './radial-menu-defaults.js';
import {
    DEFAULT_FAST_TRAVEL_EFFECT,
    DEFAULT_TRANSITION_EFFECT,
    normalizeFastTravelEffect,
    normalizeTransitionEffect,
} from './transition-registry.js';
import { normalizePolyhedronType, normalizeTesseronConfig } from './tesseron.js';

const REF_BASE = 300;
const REF_SCALE = 1.1;
const REF_HEIGHT = 1080;

function computeBaseScale(base) {
    return (base / REF_BASE) * REF_SCALE * (REF_HEIGHT / window.innerHeight);
}

// -----------------------------------------------------------------------------
// DEFAULT_APPEARANCE — the canonical zero-state blob.
// Mirrors the initial values in state.js and the plan's example fixture.
// Any field that participates in applyAppearance/snapshotAppearance MUST appear
// here; missing fields cause silent roundtrip drift.
// -----------------------------------------------------------------------------
export const DEFAULT_APPEARANCE = Object.freeze({
    version: 1,

    // Size (logical pixels)
    size: { base: 153, min: 40, max: 400 },

    // Primary geometry
    shape: 6,
    stellation: 0.0,
    tesseron: {
        enabled: false,
        proportion: 0.5,
        matchMother: true,
        editTarget: 'mother',
        child: {
            opacity: 0.25,
            edgeOpacity: 1.0,
            maskEnabled: true,
            interiorEdges: true,
            specular: true,
        },
    },
    opacity: 0.25,
    edgeOpacity: 1.0,
    maskEnabled: true,
    interiorEdges: true,
    specular: true,
    skin: 'none',
    idleSpin: 0.01,
    zDepth: 1.0,

    // Shape parameter packs (all retained regardless of active shape)
    shapeParams: {
        tetartoid: { a: 1.0, b: 1.5, c: 2.0 },
        torus: { radius: 1.0, tube: 0.3, arc: 1.0 },
        cylinder: { topRadius: 1.0, bottomRadius: 1.0, height: 1.0, sides: 32 },
        box: { width: 1.0, height: 1.0, depth: 1.0 }
    },

    // Aura
    aura: {
        enabled: true,
        reach: 1.0,
        intensity: 1.0,
        pulseRate: 0.005,
        spikeMultiplier: 1.5,
        depthOffset: 5.0,
        baseScale: 4.0,
        pulseAmplitude: 0.4,
        coreFade: 0.6,
        spikeDecay: 0.92,
        wobble: {
            count: 1,
            scaleX: 0.66,
            scaleY: 0.66,
            opacity: 0.7,
            orbitRadius: 0.32,
            radiusScalar: 0.5,
            xyRatioScalar: 1.45,
            speed: 9.0,
            chaos: 0.35,
            mode: 'random',
        },
    },

    interaction: {
        hitRadius: 40,
        dragThreshold: 6,
        dragCancelRadius: 40,
        gotoRingRadius: 60,
        menuRingRadius: 120,
        radialGestureMenu: {
            deadZoneRadius: 0.6,
            itemRadius: 4.15,
            itemHitRadius: 0.9,
            itemVisualRadius: 1.4,
            menuRadius: 2.65,
            handoffRadius: 4.45,
            reentryRadius: 3.95,
            spreadDegrees: 92,
            startAngle: -90,
            orientation: 'fixed',
            items: DEFAULT_SIGIL_RADIAL_ITEMS,
        },
    },

    windowing: {
        avatarLevel: 'status_bar',
    },

    transitions: {
        enter: DEFAULT_TRANSITION_EFFECT,
        exit: DEFAULT_TRANSITION_EFFECT,
        fastTravel: DEFAULT_FAST_TRAVEL_EFFECT,
        lineInterDimensional: true,
        line: {
            duration: 0.22,
            delay: 0,
            repeatCount: 10,
            repeatDuration: 2.0,
            trailMode: 'fade',
            lagFactor: 0.05,
            scale: 1.5,
        },
        scaleDuration: 0.18,
        wormhole: {
            captureRadius: 96,
            implosionDuration: 1.5,
            travelDuration: 0.5,
            reboundDuration: 1.2,
            distortionStrength: 1.2,
            twist: 3.14,
            zoom: 3.5,
            shadingEnabled: true,
            tunnelShadow: 0.8,
            specularIntensity: 0.4,
            lightAngle: 2.35,
            objectEnabled: true,
            objectHeight: 0.8,
            objectSpin: 4.5,
            particlesEnabled: true,
            particleDensity: 0.05,
            flashIntensity: 1.5,
            whitePointIntensity: 1.0,
            starburstIntensity: 0.95,
            lensFlareIntensity: 0.8,
        },
    },

    // Colors (all gradient pairs)
    colors: {
        face: ['#bc13fe', '#4a2b6e'],
        edge: ['#bc13fe', '#4a2b6e'],
        aura: ['#bc13fe', '#2a1b3d'],
        pulsar: ['#ffffff', '#bc13fe'],
        accretion: ['#bc13fe', '#4a2b6e'],
        gamma: ['#ffffff', '#00ffff'],
        neutrino: ['#bc13fe', '#4a2b6e'],
        lightning: ['#ffffff', '#00ffff'],
        magnetic: ['#bc13fe', '#4a2b6e'],
        swarm: ['#ff00aa', '#4a2b6e'],
        omegaFace: ['#4a2b6e', '#1a0b2e'],
        omegaEdge: ['#bc13fe', '#4a2b6e'],
        grid: ['#442266', '#110022']
    },

    // Cosmic phenomena
    phenomena: {
        pulsar: { enabled: false, count: 1, counterRevolveSpeed: 0, minHeight: 2.5, maxHeight: 4.5, width: 0.15, widthVariance: 0.04 },
        accretion: { enabled: false, count: 1, minHeight: 0.01, maxHeight: 0.03, width: 0.7, widthVariance: 0.18 },
        gamma: { enabled: false, count: 3, minHeight: 1.05, maxHeight: 1.35, width: 0.017, widthVariance: 0.0035 },
        neutrino: { enabled: false, count: 1 }
    },

    // Turbulence (per-phenomenon modulation)
    turbulence: {
        p: { val: 0, spd: 1.0, mod: 'uniform' },
        a: { val: 0, spd: 1.0, mod: 'uniform' },
        g: { val: 0, spd: 0.55, mod: 'uniform' },
        n: { val: 0, spd: 1.0, mod: 'uniform' }
    },

    // Lightning
    lightning: {
        enabled: false,
        originCenter: true,
        solidBlock: false,
        boltLength: 100,
        frequency: 2.0,
        duration: 0.8,
        branching: 0.08,
        brightness: 1.0
    },

    // Magnetic field
    magnetic: {
        enabled: false,
        tentacleCount: 10,
        tentacleSpeed: 1.0,
        wander: 3.0
    },

    // Omega (secondary shape)
    omega: {
        enabled: false,
        shape: 6,
        stellation: 0.0,
        tesseron: {
            enabled: false,
            proportion: 0.5,
            matchMother: true,
            editTarget: 'mother',
            child: {
                opacity: 0.15,
                edgeOpacity: 0.8,
                maskEnabled: true,
                interiorEdges: true,
                specular: false,
            },
        },
        scale: 1.5,
        opacity: 0.15,
        edgeOpacity: 0.8,
        maskEnabled: true,
        interiorEdges: true,
        specular: false,
        skin: 'none',
        counterSpin: false,
        lockPosition: false,
        interDimensional: false,
        ghostCount: 10,
        ghostMode: 'fade',
        ghostDuration: 2.0,
        lagFactor: 0.05
    },

    // Swarm + black-hole
    swarm: {
        enabled: false,
        count: 2000,
        gravity: 60,
        eventHorizon: 2.0,
        timeScale: 1.0,
        blackHole: false
    },

    // Grid
    grid: {
        mode: 'flat',
        renderMode: 'wireframe',
        density: 16,
        renderRadius: 30.0,
        snowGlobe: false,
        showProbe: false,
        relativeMotion: false,
        timeScale: 1.0
    },

    // Trails (motion-trail visual behind the avatar).
    // `enabled`/`count` map to state.isTrailEnabled/state.trailLength; the
    // remaining fields (opacity/fadeMs/style) are declared so the seed doc
    // schema (plan 2026-04-12) roundtrips losslessly. They are stored on
    // state but not yet consumed by particles.js — forward-compatible
    // scaffolding for Task 4/6/10.
    trails: {
        enabled: true,
        count: 6,
        opacity: 0.5,
        fadeMs: 400,
        style: 'omega'
    }
});

// -----------------------------------------------------------------------------
// applyAppearance
// -----------------------------------------------------------------------------

/**
 * Apply a full appearance blob to state, then trigger the renderer-side update
 * hooks that require mesh/material rebuilds (colors, phenomena counts).
 *
 * Fields are pulled through `?? DEFAULT_APPEARANCE.*` so partial blobs are OK;
 * the snapshot always returns a full blob.
 *
 * NO DOM access. Safe to call in headless live-js boot.
 */
export function applyAppearance(blob) {
    if (!blob || typeof blob !== 'object') blob = {};
    const D = DEFAULT_APPEARANCE;

    // Size
    const size = blob.size ?? D.size;
    state.avatarBase = size.base ?? D.size.base;
    state.baseScale = computeBaseScale(state.avatarBase);
    state.avatarMin = size.min ?? D.size.min;
    state.avatarMax = size.max ?? D.size.max;

    // Primary geometry
    const primaryShape = blob.shape ?? D.shape;
    state.currentGeometryType = normalizePolyhedronType(primaryShape);
    state.stellationFactor = blob.stellation ?? D.stellation;
    const primaryLegacyTesseract = Number(primaryShape) === 94 && blob.tesseron == null;
    const primaryTesseronFallback = blob.shape == null ? D.tesseron : { ...D.tesseron, enabled: primaryLegacyTesseract };
    state.tesseron = normalizeTesseronConfig(blob.tesseron, primaryTesseronFallback);
    state.currentOpacity = blob.opacity ?? D.opacity;
    state.currentEdgeOpacity = blob.edgeOpacity ?? D.edgeOpacity;
    state.isMaskEnabled = blob.maskEnabled ?? D.maskEnabled;
    state.isInteriorEdgesEnabled = blob.interiorEdges ?? D.interiorEdges;
    state.isSpecularEnabled = blob.specular ?? D.specular;
    state.currentSkin = blob.skin ?? D.skin;
    state.idleSpinSpeed = blob.idleSpin ?? D.idleSpin;
    state.z_depth = blob.zDepth ?? D.zDepth;

    // Shape params
    const sp = blob.shapeParams ?? D.shapeParams;
    const tet = sp.tetartoid ?? D.shapeParams.tetartoid;
    state.tetartoidA = tet.a ?? D.shapeParams.tetartoid.a;
    state.tetartoidB = tet.b ?? D.shapeParams.tetartoid.b;
    state.tetartoidC = tet.c ?? D.shapeParams.tetartoid.c;
    const tor = sp.torus ?? D.shapeParams.torus;
    state.torusRadius = tor.radius ?? D.shapeParams.torus.radius;
    state.torusTube = tor.tube ?? D.shapeParams.torus.tube;
    state.torusArc = tor.arc ?? D.shapeParams.torus.arc;
    const cyl = sp.cylinder ?? D.shapeParams.cylinder;
    state.cylinderTopRadius = cyl.topRadius ?? D.shapeParams.cylinder.topRadius;
    state.cylinderBottomRadius = cyl.bottomRadius ?? D.shapeParams.cylinder.bottomRadius;
    state.cylinderHeight = cyl.height ?? D.shapeParams.cylinder.height;
    state.cylinderSides = cyl.sides ?? D.shapeParams.cylinder.sides;
    const box = sp.box ?? D.shapeParams.box;
    state.boxWidth = box.width ?? D.shapeParams.box.width;
    state.boxHeight = box.height ?? D.shapeParams.box.height;
    state.boxDepth = box.depth ?? D.shapeParams.box.depth;

    // Aura
    const aura = blob.aura ?? D.aura;
    state.isAuraEnabled = aura.enabled ?? D.aura.enabled;
    state.auraReach = aura.reach ?? D.aura.reach;
    state.auraIntensity = aura.intensity ?? D.aura.intensity;
    state.auraPulseRate = aura.pulseRate ?? D.aura.pulseRate;
    state.spikeMultiplier = aura.spikeMultiplier ?? D.aura.spikeMultiplier;
    state.auraDepthOffset = aura.depthOffset ?? D.aura.depthOffset;
    state.auraBaseScale = aura.baseScale ?? D.aura.baseScale;
    state.auraPulseAmplitude = aura.pulseAmplitude ?? D.aura.pulseAmplitude;
    state.auraCoreFade = aura.coreFade ?? D.aura.coreFade;
    state.auraSpikeDecay = aura.spikeDecay ?? D.aura.spikeDecay;
    const wobble = aura.wobble ?? D.aura.wobble;
    state.wobbleCount = wobble.count ?? D.aura.wobble.count;
    state.wobbleScaleX = wobble.scaleX ?? D.aura.wobble.scaleX;
    state.wobbleScaleY = wobble.scaleY ?? D.aura.wobble.scaleY;
    state.wobbleOpacity = wobble.opacity ?? D.aura.wobble.opacity;
    state.wobbleOrbitRadius = wobble.orbitRadius ?? D.aura.wobble.orbitRadius;
    state.wobbleRadiusScalar = wobble.radiusScalar ?? D.aura.wobble.radiusScalar;
    state.wobbleXYRatioScalar = wobble.xyRatioScalar ?? D.aura.wobble.xyRatioScalar;
    state.wobbleSpeed = wobble.speed ?? D.aura.wobble.speed;
    state.wobbleChaos = wobble.chaos ?? D.aura.wobble.chaos;
    state.wobbleMode = wobble.mode ?? D.aura.wobble.mode;

    const interaction = blob.interaction ?? D.interaction;
    state.avatarHitRadius = interaction.hitRadius ?? D.interaction.hitRadius;
    state.dragThreshold = interaction.dragThreshold ?? D.interaction.dragThreshold;
    state.dragCancelRadius = interaction.dragCancelRadius ?? D.interaction.dragCancelRadius;
    state.gotoRingRadius = interaction.gotoRingRadius ?? D.interaction.gotoRingRadius;
    state.menuRingRadius = interaction.menuRingRadius ?? D.interaction.menuRingRadius;
    state.radialGestureMenu = normalizeSigilRadialGestureMenu(
        interaction.radialGestureMenu ?? D.interaction.radialGestureMenu
    );

    const windowing = blob.windowing ?? D.windowing;
    state.avatarWindowLevel = windowing.avatarLevel === 'screen_saver'
        ? 'screen_saver'
        : D.windowing.avatarLevel;

    const transitions = blob.transitions ?? D.transitions;
    const line = transitions.line ?? D.transitions.line;
    const wormhole = transitions.wormhole ?? D.transitions.wormhole;
    state.transitionEnterEffect = normalizeTransitionEffect(transitions.enter, D.transitions.enter);
    state.transitionExitEffect = normalizeTransitionEffect(transitions.exit, D.transitions.exit);
    state.transitionFastTravelEffect = normalizeFastTravelEffect(transitions.fastTravel, D.transitions.fastTravel);
    state.fastTravelLineInterDimensional = transitions.lineInterDimensional ?? D.transitions.lineInterDimensional;
    state.fastTravelLineDuration = line.duration ?? D.transitions.line.duration;
    state.fastTravelLineDelay = line.delay ?? D.transitions.line.delay;
    state.fastTravelLineRepeatCount = line.repeatCount ?? D.transitions.line.repeatCount;
    state.fastTravelLineRepeatDuration = line.repeatDuration ?? D.transitions.line.repeatDuration;
    state.fastTravelLineTrailMode = line.trailMode ?? D.transitions.line.trailMode;
    state.fastTravelLineLag = line.lagFactor ?? D.transitions.line.lagFactor;
    state.fastTravelLineScale = line.scale ?? D.transitions.line.scale;
    state.transitionScaleDuration = transitions.scaleDuration ?? D.transitions.scaleDuration;
    state.wormholeCaptureRadius = wormhole.captureRadius ?? D.transitions.wormhole.captureRadius;
    state.wormholeImplosionDuration = wormhole.implosionDuration ?? D.transitions.wormhole.implosionDuration;
    state.wormholeTravelDuration = wormhole.travelDuration ?? D.transitions.wormhole.travelDuration;
    state.wormholeReboundDuration = wormhole.reboundDuration ?? D.transitions.wormhole.reboundDuration;
    state.wormholeDistortionStrength = wormhole.distortionStrength ?? D.transitions.wormhole.distortionStrength;
    state.wormholeTwist = wormhole.twist ?? D.transitions.wormhole.twist;
    state.wormholeZoom = wormhole.zoom ?? D.transitions.wormhole.zoom;
    state.wormholeShadingEnabled = wormhole.shadingEnabled ?? D.transitions.wormhole.shadingEnabled;
    state.wormholeTunnelShadow = wormhole.tunnelShadow ?? D.transitions.wormhole.tunnelShadow;
    state.wormholeSpecularIntensity = wormhole.specularIntensity ?? D.transitions.wormhole.specularIntensity;
    state.wormholeLightAngle = wormhole.lightAngle ?? D.transitions.wormhole.lightAngle;
    state.wormholeObjectEnabled = wormhole.objectEnabled ?? D.transitions.wormhole.objectEnabled;
    state.wormholeObjectHeight = wormhole.objectHeight ?? D.transitions.wormhole.objectHeight;
    state.wormholeObjectSpin = wormhole.objectSpin ?? D.transitions.wormhole.objectSpin;
    state.wormholeParticlesEnabled = wormhole.particlesEnabled ?? D.transitions.wormhole.particlesEnabled;
    state.wormholeParticleDensity = wormhole.particleDensity ?? D.transitions.wormhole.particleDensity;
    state.wormholeFlashIntensity = wormhole.flashIntensity ?? D.transitions.wormhole.flashIntensity;
    state.wormholeWhitePointIntensity = wormhole.whitePointIntensity ?? D.transitions.wormhole.whitePointIntensity;
    state.wormholeStarburstIntensity = wormhole.starburstIntensity ?? D.transitions.wormhole.starburstIntensity;
    state.wormholeLensFlareIntensity = wormhole.lensFlareIntensity ?? D.transitions.wormhole.lensFlareIntensity;

    // Colors — replace the whole map so stale keys go away.
    const colors = blob.colors ?? D.colors;
    state.colors = {};
    for (const k of Object.keys(D.colors)) {
        const src = colors[k] ?? D.colors[k];
        state.colors[k] = [src[0], src[1]];
    }

    // Phenomena toggles + counts
    const ph = blob.phenomena ?? D.phenomena;
    state.isPulsarEnabled = ph.pulsar?.enabled ?? D.phenomena.pulsar.enabled;
    state.pulsarRayCount = ph.pulsar?.count ?? D.phenomena.pulsar.count;
    state.pulsarCounterRevolveSpeed = ph.pulsar?.counterRevolveSpeed ?? D.phenomena.pulsar.counterRevolveSpeed;
    state.pulsarMinHeight = ph.pulsar?.minHeight ?? D.phenomena.pulsar.minHeight;
    state.pulsarMaxHeight = ph.pulsar?.maxHeight ?? D.phenomena.pulsar.maxHeight;
    state.pulsarWidth = ph.pulsar?.width ?? D.phenomena.pulsar.width;
    state.pulsarWidthVariance = ph.pulsar?.widthVariance ?? D.phenomena.pulsar.widthVariance;
    state.isAccretionEnabled = ph.accretion?.enabled ?? D.phenomena.accretion.enabled;
    state.accretionDiskCount = ph.accretion?.count ?? D.phenomena.accretion.count;
    state.accretionMinHeight = ph.accretion?.minHeight ?? D.phenomena.accretion.minHeight;
    state.accretionMaxHeight = ph.accretion?.maxHeight ?? D.phenomena.accretion.maxHeight;
    state.accretionWidth = ph.accretion?.width ?? D.phenomena.accretion.width;
    state.accretionWidthVariance = ph.accretion?.widthVariance ?? D.phenomena.accretion.widthVariance;
    state.isGammaEnabled = ph.gamma?.enabled ?? D.phenomena.gamma.enabled;
    state.gammaRayCount = ph.gamma?.count ?? D.phenomena.gamma.count;
    state.gammaMinHeight = ph.gamma?.minHeight ?? D.phenomena.gamma.minHeight;
    state.gammaMaxHeight = ph.gamma?.maxHeight ?? D.phenomena.gamma.maxHeight;
    state.gammaWidth = ph.gamma?.width ?? D.phenomena.gamma.width;
    state.gammaWidthVariance = ph.gamma?.widthVariance ?? D.phenomena.gamma.widthVariance;
    state.isNeutrinosEnabled = ph.neutrino?.enabled ?? D.phenomena.neutrino.enabled;
    state.neutrinoJetCount = ph.neutrino?.count ?? D.phenomena.neutrino.count;

    // Turbulence
    const turb = blob.turbulence ?? D.turbulence;
    for (const k of ['p', 'a', 'g', 'n']) {
        const src = turb[k] ?? D.turbulence[k];
        state.turbState[k] = {
            val: src.val ?? D.turbulence[k].val,
            spd: src.spd ?? D.turbulence[k].spd,
            mod: src.mod ?? D.turbulence[k].mod
        };
    }

    // Lightning
    const ln = blob.lightning ?? D.lightning;
    state.isLightningEnabled = ln.enabled ?? D.lightning.enabled;
    state.lightningOriginCenter = ln.originCenter ?? D.lightning.originCenter;
    state.lightningSolidBlock = ln.solidBlock ?? D.lightning.solidBlock;
    state.lightningBoltLength = ln.boltLength ?? D.lightning.boltLength;
    state.lightningFrequency = ln.frequency ?? D.lightning.frequency;
    state.lightningDuration = ln.duration ?? D.lightning.duration;
    state.lightningBranching = ln.branching ?? D.lightning.branching;
    state.lightningBrightness = ln.brightness ?? D.lightning.brightness;

    // Magnetic
    const mg = blob.magnetic ?? D.magnetic;
    state.isMagneticEnabled = mg.enabled ?? D.magnetic.enabled;
    state.magneticTentacleCount = mg.tentacleCount ?? D.magnetic.tentacleCount;
    state.magneticTentacleSpeed = mg.tentacleSpeed ?? D.magnetic.tentacleSpeed;
    state.magneticWander = mg.wander ?? D.magnetic.wander;

    // Omega
    const om = blob.omega ?? D.omega;
    state.isOmegaEnabled = om.enabled ?? D.omega.enabled;
    const omegaShape = om.shape ?? D.omega.shape;
    state.omegaGeometryType = normalizePolyhedronType(omegaShape);
    state.omegaStellationFactor = om.stellation ?? D.omega.stellation;
    const omegaLegacyTesseract = Number(omegaShape) === 94 && om.tesseron == null;
    const omegaTesseronFallback = om.shape == null ? D.omega.tesseron : { ...D.omega.tesseron, enabled: omegaLegacyTesseract };
    state.omegaTesseron = normalizeTesseronConfig(om.tesseron, omegaTesseronFallback);
    state.omegaScale = om.scale ?? D.omega.scale;
    state.omegaOpacity = om.opacity ?? D.omega.opacity;
    state.omegaEdgeOpacity = om.edgeOpacity ?? D.omega.edgeOpacity;
    state.omegaIsMaskEnabled = om.maskEnabled ?? D.omega.maskEnabled;
    state.omegaIsInteriorEdgesEnabled = om.interiorEdges ?? D.omega.interiorEdges;
    state.omegaIsSpecularEnabled = om.specular ?? D.omega.specular;
    state.omegaSkin = om.skin ?? D.omega.skin;
    state.omegaCounterSpin = om.counterSpin ?? D.omega.counterSpin;
    state.omegaLockPosition = om.lockPosition ?? D.omega.lockPosition;
    state.omegaInterDimensional = om.interDimensional ?? D.omega.interDimensional;
    state.omegaGhostCount = om.ghostCount ?? D.omega.ghostCount;
    state.omegaGhostMode = om.ghostMode ?? D.omega.ghostMode;
    state.omegaGhostDuration = om.ghostDuration ?? D.omega.ghostDuration;
    state.omegaLagFactor = om.lagFactor ?? D.omega.lagFactor;

    // Swarm
    const sw = blob.swarm ?? D.swarm;
    state.isSwarmEnabled = sw.enabled ?? D.swarm.enabled;
    state.swarmCount = sw.count ?? D.swarm.count;
    state.swarmGravity = sw.gravity ?? D.swarm.gravity;
    state.swarmEventHorizon = sw.eventHorizon ?? D.swarm.eventHorizon;
    state.swarmTimeScale = sw.timeScale ?? D.swarm.timeScale;
    state.isBlackHoleMode = sw.blackHole ?? D.swarm.blackHole;

    // Grid
    const g = blob.grid ?? D.grid;
    state.gridMode = g.mode ?? D.grid.mode;
    state.grid3dRenderMode = g.renderMode ?? D.grid.renderMode;
    state.grid3dDensity = g.density ?? D.grid.density;
    state.grid3dRenderRadius = g.renderRadius ?? D.grid.renderRadius;
    state.grid3dSnowGlobe = g.snowGlobe ?? D.grid.snowGlobe;
    state.grid3dShowProbe = g.showProbe ?? D.grid.showProbe;
    state.grid3dRelativeMotion = g.relativeMotion ?? D.grid.relativeMotion;
    state.grid3dTimeScale = g.timeScale ?? D.grid.timeScale;

    // Trails
    // `enabled` -> state.isTrailEnabled, `count` -> state.trailLength (trail
    // sprite pool size). `opacity`/`fadeMs`/`style` are stored on state so the
    // seed doc's schema roundtrips; particles.js does not yet consume them.
    const tr = blob.trails ?? D.trails;
    state.isTrailEnabled = tr.enabled ?? D.trails.enabled;
    state.trailLength = tr.count ?? D.trails.count;
    state.trailOpacity = tr.opacity ?? D.trails.opacity;
    state.trailFadeMs = tr.fadeMs ?? D.trails.fadeMs;
    state.trailStyle = tr.style ?? D.trails.style;

    if (window.liveJs) {
        window.liveJs.avatarHitRadius = state.avatarHitRadius;
        window.liveJs.dragThreshold = state.dragThreshold;
        window.liveJs.dragCancelRadius = state.dragCancelRadius;
        window.liveJs.gotoRingRadius = state.gotoRingRadius;
        window.liveJs.menuRingRadius = state.menuRingRadius;
    }

    // Trigger renderer update hooks that need mesh/material rebuilds.
    // Guarded: in headless/test contexts groups/materials may not exist yet,
    // and in pre-init contexts (e.g. Studio applyAppearance(DEFAULT) called
    // before scene.js initScene()) the Three.js groups aren't wired either.
    // Errors surface at console.debug so real regressions are visible in
    // devtools without breaking the headless-safety behavior.
    try { updateGeometry(state.currentGeometryType); }
    catch (e) { console.debug('[appearance] updateGeometry skipped:', e); }
    try { updateOmegaGeometry(state.omegaGeometryType); }
    catch (e) { console.debug('[appearance] updateOmegaGeometry skipped:', e); }
    try { applySkin(state.currentSkin, false); }
    catch (e) { console.debug('[appearance] applySkin(primary) skipped:', e); }
    try { applySkin(state.omegaSkin, true); }
    catch (e) { console.debug('[appearance] applySkin(omega) skipped:', e); }
    try { updateAllColors(); }
    catch (e) { console.debug('[appearance] updateAllColors skipped:', e); }
    try { updatePulsars(state.pulsarRayCount); }
    catch (e) { console.debug('[appearance] updatePulsars skipped:', e); }
    try { updateGammaRays(state.gammaRayCount); }
    catch (e) { console.debug('[appearance] updateGammaRays skipped:', e); }
    try { updateAccretion(state.accretionDiskCount); }
    catch (e) { console.debug('[appearance] updateAccretion skipped:', e); }
    try { updateNeutrinos(state.neutrinoJetCount); }
    catch (e) { console.debug('[appearance] updateNeutrinos skipped:', e); }

    // Opt-in scene-change hook (e.g. live-js boot may attach one for
    // geometry rebuild / skin rebind after first applyAppearance).
    if (typeof state._onAppearanceChanged === 'function') {
        try { state._onAppearanceChanged(); }
        catch (e) { console.debug('[appearance] _onAppearanceChanged hook threw:', e); }
    }
}

// -----------------------------------------------------------------------------
// snapshotAppearance
// -----------------------------------------------------------------------------

/**
 * Dump the current appearance-relevant state into a structured blob.
 * Inverse of applyAppearance — roundtrip stable with DEFAULT_APPEARANCE.
 */
export function snapshotAppearance() {
    return {
        version: 1,
        size: {
            base: state.avatarBase,
            min: state.avatarMin,
            max: state.avatarMax
        },
        shape: state.currentGeometryType,
        stellation: state.stellationFactor,
        tesseron: normalizeTesseronConfig(state.tesseron, DEFAULT_APPEARANCE.tesseron),
        opacity: state.currentOpacity,
        edgeOpacity: state.currentEdgeOpacity,
        maskEnabled: state.isMaskEnabled,
        interiorEdges: state.isInteriorEdgesEnabled,
        specular: state.isSpecularEnabled,
        skin: state.currentSkin,
        idleSpin: state.idleSpinSpeed,
        zDepth: state.z_depth,

        shapeParams: {
            tetartoid: { a: state.tetartoidA, b: state.tetartoidB, c: state.tetartoidC },
            torus: { radius: state.torusRadius, tube: state.torusTube, arc: state.torusArc },
            cylinder: {
                topRadius: state.cylinderTopRadius,
                bottomRadius: state.cylinderBottomRadius,
                height: state.cylinderHeight,
                sides: state.cylinderSides
            },
            box: { width: state.boxWidth, height: state.boxHeight, depth: state.boxDepth }
        },

        aura: {
            enabled: state.isAuraEnabled,
            reach: state.auraReach,
            intensity: state.auraIntensity,
            pulseRate: state.auraPulseRate,
            spikeMultiplier: state.spikeMultiplier,
            depthOffset: state.auraDepthOffset,
            baseScale: state.auraBaseScale,
            pulseAmplitude: state.auraPulseAmplitude,
            coreFade: state.auraCoreFade,
            spikeDecay: state.auraSpikeDecay,
            wobble: {
                count: state.wobbleCount,
                scaleX: state.wobbleScaleX,
                scaleY: state.wobbleScaleY,
                opacity: state.wobbleOpacity,
                orbitRadius: state.wobbleOrbitRadius,
                radiusScalar: state.wobbleRadiusScalar,
                xyRatioScalar: state.wobbleXYRatioScalar,
                speed: state.wobbleSpeed,
                chaos: state.wobbleChaos,
                mode: state.wobbleMode,
            },
        },

        interaction: {
            hitRadius: state.avatarHitRadius,
            dragThreshold: state.dragThreshold,
            dragCancelRadius: state.dragCancelRadius,
            gotoRingRadius: state.gotoRingRadius,
            menuRingRadius: state.menuRingRadius,
            radialGestureMenu: state.radialGestureMenu,
        },

        windowing: {
            avatarLevel: state.avatarWindowLevel === 'screen_saver' ? 'screen_saver' : 'status_bar',
        },

        transitions: {
            enter: normalizeTransitionEffect(state.transitionEnterEffect, DEFAULT_APPEARANCE.transitions.enter),
            exit: normalizeTransitionEffect(state.transitionExitEffect, DEFAULT_APPEARANCE.transitions.exit),
            fastTravel: normalizeFastTravelEffect(state.transitionFastTravelEffect, DEFAULT_APPEARANCE.transitions.fastTravel),
            lineInterDimensional: state.fastTravelLineInterDimensional ?? DEFAULT_APPEARANCE.transitions.lineInterDimensional,
            line: {
                duration: state.fastTravelLineDuration ?? DEFAULT_APPEARANCE.transitions.line.duration,
                delay: state.fastTravelLineDelay ?? DEFAULT_APPEARANCE.transitions.line.delay,
                repeatCount: state.fastTravelLineRepeatCount ?? DEFAULT_APPEARANCE.transitions.line.repeatCount,
                repeatDuration: state.fastTravelLineRepeatDuration ?? DEFAULT_APPEARANCE.transitions.line.repeatDuration,
                trailMode: state.fastTravelLineTrailMode ?? DEFAULT_APPEARANCE.transitions.line.trailMode,
                lagFactor: state.fastTravelLineLag ?? DEFAULT_APPEARANCE.transitions.line.lagFactor,
                scale: state.fastTravelLineScale ?? DEFAULT_APPEARANCE.transitions.line.scale,
            },
            scaleDuration: state.transitionScaleDuration ?? DEFAULT_APPEARANCE.transitions.scaleDuration,
            wormhole: {
                captureRadius: state.wormholeCaptureRadius ?? DEFAULT_APPEARANCE.transitions.wormhole.captureRadius,
                implosionDuration: state.wormholeImplosionDuration ?? DEFAULT_APPEARANCE.transitions.wormhole.implosionDuration,
                travelDuration: state.wormholeTravelDuration ?? DEFAULT_APPEARANCE.transitions.wormhole.travelDuration,
                reboundDuration: state.wormholeReboundDuration ?? DEFAULT_APPEARANCE.transitions.wormhole.reboundDuration,
                distortionStrength: state.wormholeDistortionStrength ?? DEFAULT_APPEARANCE.transitions.wormhole.distortionStrength,
                twist: state.wormholeTwist ?? DEFAULT_APPEARANCE.transitions.wormhole.twist,
                zoom: state.wormholeZoom ?? DEFAULT_APPEARANCE.transitions.wormhole.zoom,
                shadingEnabled: state.wormholeShadingEnabled ?? DEFAULT_APPEARANCE.transitions.wormhole.shadingEnabled,
                tunnelShadow: state.wormholeTunnelShadow ?? DEFAULT_APPEARANCE.transitions.wormhole.tunnelShadow,
                specularIntensity: state.wormholeSpecularIntensity ?? DEFAULT_APPEARANCE.transitions.wormhole.specularIntensity,
                lightAngle: state.wormholeLightAngle ?? DEFAULT_APPEARANCE.transitions.wormhole.lightAngle,
                objectEnabled: state.wormholeObjectEnabled ?? DEFAULT_APPEARANCE.transitions.wormhole.objectEnabled,
                objectHeight: state.wormholeObjectHeight ?? DEFAULT_APPEARANCE.transitions.wormhole.objectHeight,
                objectSpin: state.wormholeObjectSpin ?? DEFAULT_APPEARANCE.transitions.wormhole.objectSpin,
                particlesEnabled: state.wormholeParticlesEnabled ?? DEFAULT_APPEARANCE.transitions.wormhole.particlesEnabled,
                particleDensity: state.wormholeParticleDensity ?? DEFAULT_APPEARANCE.transitions.wormhole.particleDensity,
                flashIntensity: state.wormholeFlashIntensity ?? DEFAULT_APPEARANCE.transitions.wormhole.flashIntensity,
                whitePointIntensity: state.wormholeWhitePointIntensity ?? DEFAULT_APPEARANCE.transitions.wormhole.whitePointIntensity,
                starburstIntensity: state.wormholeStarburstIntensity ?? DEFAULT_APPEARANCE.transitions.wormhole.starburstIntensity,
                lensFlareIntensity: state.wormholeLensFlareIntensity ?? DEFAULT_APPEARANCE.transitions.wormhole.lensFlareIntensity,
            },
        },

        colors: (() => {
            const out = {};
            for (const k of Object.keys(DEFAULT_APPEARANCE.colors)) {
                const v = state.colors[k] ?? DEFAULT_APPEARANCE.colors[k];
                out[k] = [v[0], v[1]];
            }
            return out;
        })(),

        phenomena: {
            pulsar: { enabled: state.isPulsarEnabled, count: state.pulsarRayCount, counterRevolveSpeed: state.pulsarCounterRevolveSpeed, minHeight: state.pulsarMinHeight, maxHeight: state.pulsarMaxHeight, width: state.pulsarWidth, widthVariance: state.pulsarWidthVariance },
            accretion: { enabled: state.isAccretionEnabled, count: state.accretionDiskCount, minHeight: state.accretionMinHeight, maxHeight: state.accretionMaxHeight, width: state.accretionWidth, widthVariance: state.accretionWidthVariance },
            gamma: { enabled: state.isGammaEnabled, count: state.gammaRayCount, minHeight: state.gammaMinHeight, maxHeight: state.gammaMaxHeight, width: state.gammaWidth, widthVariance: state.gammaWidthVariance },
            neutrino: { enabled: state.isNeutrinosEnabled, count: state.neutrinoJetCount }
        },

        turbulence: {
            p: { val: state.turbState.p.val, spd: state.turbState.p.spd, mod: state.turbState.p.mod },
            a: { val: state.turbState.a.val, spd: state.turbState.a.spd, mod: state.turbState.a.mod },
            g: { val: state.turbState.g.val, spd: state.turbState.g.spd, mod: state.turbState.g.mod },
            n: { val: state.turbState.n.val, spd: state.turbState.n.spd, mod: state.turbState.n.mod }
        },

        lightning: {
            enabled: state.isLightningEnabled,
            originCenter: state.lightningOriginCenter,
            solidBlock: state.lightningSolidBlock,
            boltLength: state.lightningBoltLength,
            frequency: state.lightningFrequency,
            duration: state.lightningDuration,
            branching: state.lightningBranching,
            brightness: state.lightningBrightness
        },

        magnetic: {
            enabled: state.isMagneticEnabled,
            tentacleCount: state.magneticTentacleCount,
            tentacleSpeed: state.magneticTentacleSpeed,
            wander: state.magneticWander
        },

        omega: {
            enabled: state.isOmegaEnabled,
            shape: state.omegaGeometryType,
            stellation: state.omegaStellationFactor,
            tesseron: normalizeTesseronConfig(state.omegaTesseron, DEFAULT_APPEARANCE.omega.tesseron),
            scale: state.omegaScale,
            opacity: state.omegaOpacity,
            edgeOpacity: state.omegaEdgeOpacity,
            maskEnabled: state.omegaIsMaskEnabled,
            interiorEdges: state.omegaIsInteriorEdgesEnabled,
            specular: state.omegaIsSpecularEnabled,
            skin: state.omegaSkin,
            counterSpin: state.omegaCounterSpin,
            lockPosition: state.omegaLockPosition,
            interDimensional: state.omegaInterDimensional,
            ghostCount: state.omegaGhostCount,
            ghostMode: state.omegaGhostMode,
            ghostDuration: state.omegaGhostDuration,
            lagFactor: state.omegaLagFactor
        },

        swarm: {
            enabled: state.isSwarmEnabled,
            count: state.swarmCount,
            gravity: state.swarmGravity,
            eventHorizon: state.swarmEventHorizon,
            timeScale: state.swarmTimeScale,
            blackHole: state.isBlackHoleMode
        },

        grid: {
            mode: state.gridMode,
            renderMode: state.grid3dRenderMode,
            density: state.grid3dDensity,
            renderRadius: state.grid3dRenderRadius,
            snowGlobe: state.grid3dSnowGlobe,
            showProbe: state.grid3dShowProbe,
            relativeMotion: state.grid3dRelativeMotion,
            timeScale: state.grid3dTimeScale
        },

        trails: {
            enabled: state.isTrailEnabled,
            count: state.trailLength,
            opacity: state.trailOpacity ?? DEFAULT_APPEARANCE.trails.opacity,
            fadeMs: state.trailFadeMs ?? DEFAULT_APPEARANCE.trails.fadeMs,
            style: state.trailStyle ?? DEFAULT_APPEARANCE.trails.style
        }
    };
}
