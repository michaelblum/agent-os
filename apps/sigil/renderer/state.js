import { DEFAULT_SIGIL_RADIAL_ITEMS } from './radial-menu-defaults.js';

const defaults = {
    // Three.js object references (set during init)
    scene: null,
    perspCamera: null,
    orthoCamera: null,
    camera: null,  // active camera reference
    renderer: null,
    polyGroup: null,
    glowSprite: null,
    coreSprite: null,
    wobbleMeshes: [],
    wobbleBasePositions: [],
    coreMesh: null,
    wireframeMesh: null,
    innerWireframeMesh: null,
    innerHighlightWireframeMesh: null,
    tesseronChildDepthMesh: null,
    tesseronChildCoreMesh: null,
    tesseronChildWireframeMesh: null,
    depthMesh: null,
    pointLight: null,
    gridHelper: null,
    shockwaveSphere: null,
    shockwaveDisk: null,
    flashVoxel: null,
    pathLine: null,

    // Phenomena groups
    pulsarGroup: null,
    accretionGroup: null,
    gammaRaysGroup: null,
    neutrinoGroup: null,

    // Materials (shared references for color updates)
    beamMat: null,
    diskMat: null,
    gammaBeamMat: null,
    neutrinoMat: null,
    skinMaterial: null,

    // Geometries
    pulsarGeo: null,
    gammaGeo: null,

    // Arrays for per-frame animation logic
    particles: [],
    coloredParticles: [],
    trailSprites: [],
    trailPositions: [],

    // Phenonema sub-object tracking
    accretionRings: [],
    neutrinoParticles: [],

    // Global simulation state
    globalTime: 0,
    isPaused: false,
    isMenuOpen: false,
    isDraggingObject: false,

    // --- Configuration (driven by agent appearance JSON) ---

    // Geometry
    currentType: 12,
    currentGeometryType: 12,
    stellationFactor: 0,
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
    z_depth: 1.0,
    baseScale: 1.0,

    boxWidth: 1.0, boxHeight: 1.0, boxDepth: 1.0,
    torusRadius: 1.0, torusTube: 0.4, torusArc: 1.0,
    cylinderTopRadius: 1.0, cylinderBottomRadius: 1.0, cylinderHeight: 2.0, cylinderSides: 32,
    tetartoidA: 1.0, tetartoidB: 1.0, tetartoidC: 1.0,

    // Appearance
    currentOpacity: 0.8,
    currentEdgeOpacity: 0.6,
    isSpecularEnabled: true,
    isMaskEnabled: false,
    isInteriorEdgesEnabled: false,
    innerEdgePulseAmount: 0.6,
    innerEdgePulseRate: 6.5,
    innerEdgeInsetScale: 0.985,
    innerEdgeHighlightInsetScale: 0.9835,
    innerEdgePeakThreshold: 0.84,
    innerEdgeFlickerAmount: 0.72,
    innerEdgeFlickerRate: 37.0,
    currentSkin: 'none',

    // Aura
    isAuraEnabled: true,
    auraIntensity: 1.0,
    auraReach: 1.0,
    auraPulseRate: 0.002,
    auraDepthOffset: 5.0,
    auraBaseScale: 4.0,
    auraPulseAmplitude: 0.4,
    auraCoreFade: 0.6,
    auraSpikeDecay: 0.92,
    auraSpike: 0,
    spikeMultiplier: 2.5,
    wobbleCount: 1,
    wobbleScaleX: 0.66,
    wobbleScaleY: 0.66,
    wobbleOpacity: 0.7,
    wobbleOrbitRadius: 0.32,
    wobbleRadiusScalar: 0.5,
    wobbleXYRatioScalar: 1.45,
    wobbleSpeed: 9.0,
    wobbleChaos: 0.35,
    wobbleMode: 'random',

    // Phenomena Counts
    pulsarRayCount: 0,
    pulsarCounterRevolveSpeed: 0,
    pulsarMinHeight: 2.5,
    pulsarMaxHeight: 4.5,
    pulsarWidth: 0.15,
    pulsarWidthVariance: 0.04,
    gammaRayCount: 3,
    gammaMinHeight: 1.05,
    gammaMaxHeight: 1.35,
    gammaWidth: 0.017,
    gammaWidthVariance: 0.0035,
    accretionDiskCount: 0,
    accretionMinHeight: 0.01,
    accretionMaxHeight: 0.03,
    accretionWidth: 0.7,
    accretionWidthVariance: 0.18,
    neutrinoJetCount: 0,

    // Toggle States
    isPulsarEnabled: false,
    isGammaEnabled: false,
    isAccretionEnabled: false,
    isNeutrinosEnabled: false,
    isTrailEnabled: false,
    trailLength: 20,
    trailOpacity: 0.5,
    trailFadeMs: 400,
    trailStyle: 'omega',

    // Interaction tuning
    avatarHitRadius: 40,
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
    avatarWindowLevel: 'status_bar',

    // Visibility transitions
    transitionEnterEffect: 'scale',
    transitionExitEffect: 'scale',
    transitionFastTravelEffect: 'line',
    fastTravelLineInterDimensional: true,
    fastTravelLineDuration: 0.22,
    fastTravelLineDelay: 0,
    fastTravelLineRepeatCount: 10,
    fastTravelLineRepeatDuration: 2.0,
    fastTravelLineTrailMode: 'fade',
    fastTravelLineLag: 0.05,
    fastTravelLineScale: 1.5,
    transitionScaleDuration: 0.18,
    wormholeCaptureRadius: 96,
    wormholeImplosionDuration: 1.5,
    wormholeTravelDuration: 0.5,
    wormholeReboundDuration: 1.2,
    wormholeDistortionStrength: 1.2,
    wormholeTwist: 3.14,
    wormholeZoom: 3.5,
    wormholeShadingEnabled: true,
    wormholeTunnelShadow: 0.8,
    wormholeSpecularIntensity: 0.4,
    wormholeLightAngle: 2.35,
    wormholeObjectEnabled: true,
    wormholeObjectHeight: 0.8,
    wormholeObjectSpin: 4.5,
    wormholeParticlesEnabled: true,
    wormholeParticleDensity: 0.05,
    wormholeFlashIntensity: 1.5,
    wormholeWhitePointIntensity: 1.0,
    wormholeStarburstIntensity: 0.95,
    wormholeLensFlareIntensity: 0.8,

    // Turbulence Configs (value, speed, mode)
    turbState: {
        p: { val: 0.2, spd: 1.0, mod: 'staggered' },
        g: { val: 0.2, spd: 0.55, mod: 'random' },
        a: { val: 0.2, spd: 1.0, mod: 'staggered' },
        n: { val: 0.2, spd: 1.0, mod: 'random' }
    },

    // Colors
    colors: {
        face: ['#4488ff', '#0044aa'],
        edge: ['#ffffff', '#88ccff'],
        aura: ['#4488ff', '#0044aa'],
        pulsar: ['#ffffff', '#4488ff'],
        gamma: ['#ffffff', '#00ffcc'],
        accretion: ['#4488ff', '#0044aa'],
        neutrino: ['#ffffff', '#4488ff'],
        lightning: ['#ffffff', '#00ffff'],
        magnetic: ['#4488ff', '#0044aa'],
        omegaFace: ['#4a2b6e', '#1a0b2e'],
        omegaEdge: ['#bc13fe', '#4a2b6e'],
        grid: ['#224488', '#001133']
    },

    // --- Lightning ---
    lightning: [],
    lightningStrikes: [],
    lightningTimer: 0,
    lightningOriginCenter: true,
    lightningSolidBlock: false,
    lightningBoltLength: 100,
    lightningFrequency: 2.0,
    lightningDuration: 0.8,
    lightningBranching: 0.08,
    lightningBrightness: 1.0,
    lightningBranchProbability: 0.2,
    lightningSegmentLength: 0.5,
    lightningWidth: 0.05,
    isLightningEnabled: false,

    // --- Magnetic Field ---
    magneticField: null,
    magneticTentacleGroup: null,
    magneticTentacles: [],
    magneticFieldLineCount: 20,
    magneticFieldRadius: 4.0,
    magneticFieldStrength: 1.0,
    magneticTentacleCount: 10,
    magneticTentacleSpeed: 1.0,
    magneticWander: 3.0,
    isMagneticEnabled: false,
    isMagneticFieldEnabled: false,

    // --- Omega (Secondary shape) ---
    omegaGroup: null,
    omegaDepthMesh: null,
    omegaCoreMesh: null,
    omegaWireframeMesh: null,
    omegaTesseronChildDepthMesh: null,
    omegaTesseronChildCoreMesh: null,
    omegaTesseronChildWireframeMesh: null,
    isOmegaEnabled: false,
    omegaType: 4,
    omegaGeometryType: 4,
    omegaStellationFactor: 0,
    omegaTesseron: {
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
    omegaScale: 1.5,
    omegaOpacity: 0.3,
    omegaEdgeOpacity: 0.2,
    omegaIsSpecularEnabled: false,
    omegaIsMaskEnabled: false,
    omegaIsInteriorEdgesEnabled: true,
    omegaInnerWireframeMesh: null,
    omegaInnerHighlightWireframeMesh: null,
    omegaSkin: 'none',
    omegaCounterSpin: false,
    omegaLockPosition: false,
    omegaInterDimensional: false,
    omegaGhostCount: 10,
    omegaGhostMode: 'fade',
    omegaGhostDuration: 2.0,
    omegaGhostTimer: 0,
    omegaLagFactor: 0.05,
    omegaIsVisible: false,

    // Voxel flash
    voxelFlashTimer: 0,

    // Avatar visibility scale (driven by entrance/exit animations)
    appScale: 1.0,

    // Shockwave
    isShockwaveActive: false,
    shockwaveTime: 0,

    // Pathing / State Machine
    currentPos: { x: 0, y: 0 },
    targetPos: { x: 0, y: 0 },
    currentPath: [],
    currentPathIndex: 0,
    segmentProgress: 0,

    // Force aura visible flag
    forceAuraVisible: false
};

const state = { ...defaults };
export default state;
