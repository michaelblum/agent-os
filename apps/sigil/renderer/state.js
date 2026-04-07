// Centralized application state
const state = {
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
    chargeSpheroid: null,
    whiteDwarfSprite: null,
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

    // Collections
    accretionRings: [],
    neutrinoParticles: [],
    particles: [],
    coloredParticles: [],
    inwardParticles: [],
    chargeFlares: [],
    trailSprites: [],
    trailPositions: [],

    // Constants
    frustumSize: 8,

    // Gradient Color System
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

    // Geometry
    currentOpacity: 0.25,
    currentEdgeOpacity: 1.0,
    idleSpinSpeed: 0.01,
    currentGeometryType: 6,
    stellationFactor: 0.0,
    // Tetartoid parameters (0 ≤ a ≤ b ≤ c)
    tetartoidA: 1.0,
    tetartoidB: 1.5,
    tetartoidC: 2.0,
    // Torus parameters
    torusRadius: 1.0,
    torusTube: 0.3,
    torusArc: 1.0,
    // Cylinder parameters
    cylinderTopRadius: 1.0,
    cylinderBottomRadius: 1.0,
    cylinderHeight: 1.0,
    cylinderSides: 32,
    // Box parameters
    boxWidth: 1.0,
    boxHeight: 1.0,
    boxDepth: 1.0,
    isMaskEnabled: true,
    isInteriorEdgesEnabled: true,
    isSpecularEnabled: true,
    // Skin system
    currentSkin: 'none',
    omegaSkin: 'none',
    skinMaterial: null,
    omegaSkinMaterial: null,
    skinColorRamp: null,
    omegaSkinColorRamp: null,

    // Aura
    isAuraEnabled: true,
    auraReach: 1.0,
    auraIntensity: 1.0,
    auraPulseRate: 0.005,
    auraSpike: 0.0,
    spikeMultiplier: 1.5,

    // Cosmic Phenomena Toggles
    isPulsarEnabled: false,
    isAccretionEnabled: false,
    isGammaEnabled: false,
    isNeutrinosEnabled: false,

    // Multi-instance counts
    pulsarRayCount: 1,
    accretionDiskCount: 1,
    gammaRayCount: 1,
    neutrinoJetCount: 1,

    // Shared geometry refs (for multi-instance cloning)
    pulsarGeo: null,
    gammaGeo: null,

    // Turbulence system
    globalTime: 0,
    turbState: {
        p: { val: 0, spd: 1.0, mod: 'uniform' },
        a: { val: 0, spd: 1.0, mod: 'uniform' },
        g: { val: 0, spd: 1.0, mod: 'uniform' },
        n: { val: 0, spd: 1.0, mod: 'uniform' }
    },

    // Lightning Arcs
    isLightningEnabled: false,
    lightningOriginCenter: true,
    lightningSolidBlock: false,
    lightningBoltLength: 100,
    lightningFrequency: 2.0,
    lightningDuration: 0.8,
    lightningBranching: 0.08,
    lightningBrightness: 1.0,
    lightningTimer: 0,
    lightningStrikes: [],

    // Magnetic Field
    isMagneticEnabled: false,
    magneticTentacleSpeed: 1.0,
    magneticTentacleCount: 10,
    magneticWander: 3.0,
    magneticTentacleGroup: null,
    magneticTentacles: [],

    // Omega Shape
    isOmegaEnabled: false,
    omegaGroup: null,
    omegaCoreMesh: null,
    omegaWireframeMesh: null,
    omegaDepthMesh: null,
    omegaGeometryType: 6,
    omegaStellationFactor: 0.0,
    omegaOpacity: 0.15,
    omegaEdgeOpacity: 0.8,
    omegaScale: 1.5,
    omegaIsMaskEnabled: true,
    omegaIsInteriorEdgesEnabled: true,
    omegaIsSpecularEnabled: false,
    omegaCounterSpin: false,
    omegaLockPosition: false,
    omegaInterDimensional: false,
    omegaGhostCount: 10,
    omegaGhostMode: 'fade',
    omegaGhostDuration: 2.0,
    omegaGhosts: [],
    omegaGhostMeshPool: [],
    omegaLagFactor: 0.05,
    omegaGhostTimer: 0,

    // Voxel flash
    voxelFlashTimer: 0,

    // Super Charge/Nova
    isCharging: false,
    chargeLevel: 0,
    chargeTime: 0,
    chargeReleaseTimer: 0,
    wasFullCharge: false,
    collapseTime: 0,

    // Super Nova
    isDestroyed: false,
    superNovaTimer: 0,
    isRespawning: false,
    respawnTimer: 0,
    novaScale: 1.0,

    // Shockwave
    isShockwaveActive: false,
    shockwaveTime: 0,

    // Quick Spin
    quickSpinActive: false,
    quickSpinAxis: null, // set to THREE.Vector3 during init
    quickSpinSpeed: 0,
    quickSpinEndTime: 0,

    // Grid (unified — off / flat / 3d)
    gridMode: 'flat',

    // Particle Swarm (standalone phenomenon)
    isSwarmEnabled: false,
    swarmCount: 2000,
    swarmGravity: 60,
    swarmTimeScale: 1.0,
    swarmEventHorizon: 2.0,
    swarmAbsorbed: 0,
    swarmMesh: null,

    // Black Hole Mode (standalone — affects swarm gravity + shows disk)
    isBlackHoleMode: false,
    blackHoleDiskMesh: null,
    blackHoleHaloMesh: null,

    // Grid 3D settings (shared by flat and 3d modes)
    grid3dRenderMode: 'wireframe',
    grid3dDensity: 16,
    grid3dRenderRadius: 30.0,
    // grid3dMass and grid3dEventHorizon removed — uses swarmGravity and z_depth
    grid3dSnowGlobe: false,
    grid3dShowProbe: false,
    grid3dTimeScale: 1.0,
    grid3dRelativeMotion: false,
    grid3dTime: 0,
    // 3D Grid object refs (set during init)
    grid3dMesh: null,
    grid3dPointCloud: null,
    grid3dProbeMesh: null,
    grid3dGlobeMesh: null,

    // Skybox refs
    skyboxVisible: true,
    skyboxNebula: null,
    skyboxStars: null,
    skyboxHeroStars: null,

    // Performance stats
    statsVisible: false,
    stats: null,

    // Scale / Depth
    depth_range: { min: 0.25, max: 3.0 },
    z_depth: 1.1,
    scale_anim_active: false,
    target_z_depth: 1.1,
    scale_anim_start_val: 1.1,
    scale_anim_start_time: 0,
    steps: 3,
    active_step: -1,

    // Drag & Momentum
    isDraggingObject: false,
    isPanningCamera: false,
    isPanningObject: false,
    previousMouse: { x: 0, y: 0 },
    dragVelocity: { x: 0, y: 0 },
    lastMoveTime: 0,
    dragMomentumAxis: null, // set to THREE.Vector3 during init
    dragMomentumSpeed: 0,
    isMenuOpen: false,

    // Movement / Pathing
    targetPosition: null, // set to THREE.Vector3 during init
    moveRotationAxis: null, // set to THREE.Vector3 during init
    moveRotationSpeed: 0,
    isPathEnabled: false,
    isCenteredView: false,
    pathType: 'direct',
    isPaused: false,
    pathSpeed: 1.0,

    // Path Visuals
    isShowPathEnabled: false,
    isTrailEnabled: false,
    trailLength: 50,

    // Path coordinates (set during init)
    pathPoints: null,
    smoothCurve: null,
    pathProgress: 0,
    currentPathIndex: 0,
    segmentProgress: 0,

    // Force aura visible flag (used during charge)
    forceAuraVisible: false,

    // Charge beam sequence state (saved/restored during supernova charge)
    chargeSequence: null
};

export default state;
