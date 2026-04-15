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
    coreMesh: null,
    wireframeMesh: null,
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
    stellationFactor: 0,
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
    currentSkin: 'none',

    // Aura
    isAuraEnabled: true,
    auraIntensity: 1.0,
    auraReach: 1.0,
    auraPulseRate: 0.002,
    auraSpike: 0,
    spikeMultiplier: 2.5,

    // Phenomena Counts
    pulsarRayCount: 0,
    gammaRayCount: 0,
    accretionDiskCount: 0,
    neutrinoJetCount: 0,

    // Toggle States
    isPulsarEnabled: false,
    isGammaEnabled: false,
    isAccretionEnabled: false,
    isNeutrinosEnabled: false,
    isTrailEnabled: false,
    trailLength: 20,

    // Turbulence Configs (value, speed, mode)
    turbState: {
        p: { val: 0.2, spd: 1.0, mod: 'staggered' },
        g: { val: 0.2, spd: 1.0, mod: 'random' },
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
        grid: ['#224488', '#001133']
    },

    // --- Lightning ---
    lightning: [],
    lightningBranchProbability: 0.2,
    lightningSegmentLength: 0.5,
    lightningWidth: 0.05,
    isLightningEnabled: false,

    // --- Magnetic Field ---
    magneticField: null,
    magneticFieldLineCount: 20,
    magneticFieldRadius: 4.0,
    magneticFieldStrength: 1.0,
    isMagneticFieldEnabled: false,

    // --- Omega (Secondary shape) ---
    omegaGroup: null,
    omegaDepthMesh: null,
    omegaCoreMesh: null,
    omegaWireframeMesh: null,
    omegaType: 4,
    omegaStellationFactor: 0,
    omegaOpacity: 0.3,
    omegaEdgeOpacity: 0.2,
    omegaIsSpecularEnabled: false,
    omegaIsMaskEnabled: false,
    omegaIsInteriorEdgesEnabled: true,
    omegaSkin: 'none',
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
