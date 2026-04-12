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

// -----------------------------------------------------------------------------
// DEFAULT_APPEARANCE — the canonical zero-state blob.
// Mirrors the initial values in state.js and the plan's example fixture.
// Any field that participates in applyAppearance/snapshotAppearance MUST appear
// here; missing fields cause silent roundtrip drift.
// -----------------------------------------------------------------------------
export const DEFAULT_APPEARANCE = Object.freeze({
    version: 1,

    // Size (logical pixels)
    size: { base: 300, min: 40, max: 400 },

    // Primary geometry
    shape: 6,
    stellation: 0.0,
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
    aura: { enabled: true, reach: 1.0, intensity: 1.0, pulseRate: 0.005, spikeMultiplier: 1.5 },

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
        pulsar: { enabled: false, count: 1 },
        accretion: { enabled: false, count: 1 },
        gamma: { enabled: false, count: 1 },
        neutrino: { enabled: false, count: 1 }
    },

    // Turbulence (per-phenomenon modulation)
    turbulence: {
        p: { val: 0, spd: 1.0, mod: 'uniform' },
        a: { val: 0, spd: 1.0, mod: 'uniform' },
        g: { val: 0, spd: 1.0, mod: 'uniform' },
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
    state.avatarMin = size.min ?? D.size.min;
    state.avatarMax = size.max ?? D.size.max;

    // Primary geometry
    state.currentGeometryType = blob.shape ?? D.shape;
    state.stellationFactor = blob.stellation ?? D.stellation;
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
    state.isAccretionEnabled = ph.accretion?.enabled ?? D.phenomena.accretion.enabled;
    state.accretionDiskCount = ph.accretion?.count ?? D.phenomena.accretion.count;
    state.isGammaEnabled = ph.gamma?.enabled ?? D.phenomena.gamma.enabled;
    state.gammaRayCount = ph.gamma?.count ?? D.phenomena.gamma.count;
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
    state.omegaGeometryType = om.shape ?? D.omega.shape;
    state.omegaStellationFactor = om.stellation ?? D.omega.stellation;
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
            spikeMultiplier: state.spikeMultiplier
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
            pulsar: { enabled: state.isPulsarEnabled, count: state.pulsarRayCount },
            accretion: { enabled: state.isAccretionEnabled, count: state.accretionDiskCount },
            gamma: { enabled: state.isGammaEnabled, count: state.gammaRayCount },
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
