import { normalizeSigilRadialGestureMenu } from './radial-menu-defaults.js';

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function createDefaultAvatarState() {
    return {
        shape: {
            type: 12,
            size: {
                base: 153,
                min: 40,
                max: 400,
            },
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
            params: {
                box: { width: 1.0, height: 1.0, depth: 1.0 },
                torus: { radius: 1.0, tube: 0.4, arc: 1.0 },
                cylinder: { topRadius: 1.0, bottomRadius: 1.0, height: 2.0, sides: 32 },
                tetartoid: { a: 1.0, b: 1.0, c: 1.0 },
            },
            zDepth: 1.0,
            baseScale: 1.0,
        },
        appearance: {
            opacity: 0.8,
            edgeOpacity: 0.6,
            skin: 'none',
            maskEnabled: false,
            interiorEdges: false,
            specular: true,
            innerEdgePulseAmount: 0.6,
            innerEdgePulseRate: 6.5,
            innerEdgeInsetScale: 0.985,
            innerEdgeHighlightInsetScale: 0.9835,
            innerEdgePeakThreshold: 0.84,
            innerEdgeFlickerAmount: 0.72,
            innerEdgeFlickerRate: 37.0,
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
                grid: ['#224488', '#001133'],
            },
        },
        effects: {
            aura: {
                enabled: true,
                intensity: 1.0,
                reach: 1.0,
                pulseRate: 0.002,
                depthOffset: 5.0,
                baseScale: 4.0,
                pulseAmplitude: 0.4,
                coreFade: 0.6,
                spikeDecay: 0.92,
                spike: 0,
                spikeMultiplier: 2.5,
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
            phenomena: {
                pulsar: { enabled: false, count: 0, counterRevolveSpeed: 0, minHeight: 2.5, maxHeight: 4.5, width: 0.15, widthVariance: 0.04 },
                gamma: { enabled: false, count: 3, minHeight: 1.05, maxHeight: 1.35, width: 0.017, widthVariance: 0.0035 },
                accretion: { enabled: false, count: 0, minHeight: 0.01, maxHeight: 0.03, width: 0.7, widthVariance: 0.18 },
                neutrino: { enabled: false, count: 0 },
            },
            turbulence: {
                p: { val: 0.2, spd: 1.0, mod: 'staggered' },
                g: { val: 0.2, spd: 0.55, mod: 'random' },
                a: { val: 0.2, spd: 1.0, mod: 'staggered' },
                n: { val: 0.2, spd: 1.0, mod: 'random' },
            },
            lightning: {
                enabled: false,
                originCenter: true,
                solidBlock: false,
                boltLength: 100,
                frequency: 2.0,
                duration: 0.8,
                branching: 0.08,
                brightness: 1.0,
            },
            magnetic: {
                enabled: false,
                fieldEnabled: false,
                fieldLineCount: 20,
                fieldRadius: 4.0,
                fieldStrength: 1.0,
                tentacleCount: 10,
                tentacleSpeed: 1.0,
                wander: 3.0,
            },
            trail: {
                enabled: false,
                length: 20,
                opacity: 0.5,
                fadeMs: 400,
                style: 'omega',
            },
            omega: {
                enabled: false,
                shape: {
                    type: 4,
                    stellationFactor: 0,
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
                },
                scale: 1.5,
                opacity: 0.3,
                edgeOpacity: 0.2,
                maskEnabled: false,
                interiorEdges: true,
                specular: false,
                skin: 'none',
                counterSpin: false,
                lockPosition: false,
                interDimensional: false,
                ghostCount: 10,
                ghostMode: 'fade',
                ghostDuration: 2.0,
                lagFactor: 0.05,
            },
        },
        transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: 1.0,
            idleSpin: 0.01,
        },
        interaction: {
            hitRadius: 40,
            dragThreshold: 6,
            dragCancelRadius: 40,
            gotoRingRadius: 60,
            menuRingRadius: 120,
            radialGestureMenu: normalizeSigilRadialGestureMenu(),
        },
        windowing: {
            avatarLevel: 'status_bar',
        },
    };
}

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
    avatar: createDefaultAvatarState(),

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
    radialGestureMenu: normalizeSigilRadialGestureMenu(),
    avatarWindowLevel: 'status_bar',

    // Visibility transitions
    transitionEnterEffect: 'scale',
    transitionExitEffect: 'scale',
    selectionModeEnterEffect: 'supernova',
    selectionModeExitEffect: 'reverse_supernova',
    selectionModeEffects: {
        enter: 'supernova',
        exit: 'reverse_supernova',
    },
    selectionModeTrail: {
        interDimensional: true,
        duration: 0.22,
        delay: 0,
        repeatCount: 10,
        repeatDuration: 2.0,
        trailMode: 'fade',
        lag: 0.05,
        scale: 1.5,
    },
    selectionModeTrailInterDimensional: true,
    selectionModeTrailDuration: 0.22,
    selectionModeTrailDelay: 0,
    selectionModeTrailRepeatCount: 10,
    selectionModeTrailRepeatDuration: 2.0,
    selectionModeTrailMode: 'fade',
    selectionModeTrailLag: 0.05,
    selectionModeTrailScale: 1.5,
    selectionModeAvatarOffset: {
        x: 0,
        y: 0,
    },
    selectionModeAvatarScale: 0.5,
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
    forceAuraVisible: false,

    // Session telemetry expression (Sigil-local, derived from raw AOS metrics)
    sessionVitality: {
        confidence: 0,
        pressure: null,
        usedRatio: null,
        remainingRatio: null,
        auraReachMultiplier: 1,
        auraIntensityMultiplier: 1,
        rotationMultiplier: 1,
        brightnessMultiplier: 1,
        flickerAmount: 0,
        scaleMultiplier: 1,
        refreshProgress: null,
    }
};

const state = { ...defaults };
state.avatar = cloneJson(defaults.avatar);

export function syncAvatarAliasesFromGraph(target = state) {
    const avatar = target.avatar ?? (target.avatar = createDefaultAvatarState());
    const shape = avatar.shape ?? (avatar.shape = createDefaultAvatarState().shape);
    const appearance = avatar.appearance ?? (avatar.appearance = createDefaultAvatarState().appearance);
    const effects = avatar.effects ?? (avatar.effects = createDefaultAvatarState().effects);
    const transform = avatar.transform ?? (avatar.transform = createDefaultAvatarState().transform);
    const interaction = avatar.interaction ?? (avatar.interaction = createDefaultAvatarState().interaction);
    const windowing = avatar.windowing ?? (avatar.windowing = createDefaultAvatarState().windowing);

    target.currentType = shape.type;
    target.currentGeometryType = shape.type;
    target.stellationFactor = shape.stellationFactor;
    target.tesseron = shape.tesseron;
    target.z_depth = shape.zDepth;
    target.baseScale = shape.baseScale;
    target.avatarBase = shape.size?.base ?? target.avatarBase;
    target.avatarMin = shape.size?.min ?? target.avatarMin;
    target.avatarMax = shape.size?.max ?? target.avatarMax;
    target.boxWidth = shape.params?.box?.width ?? target.boxWidth;
    target.boxHeight = shape.params?.box?.height ?? target.boxHeight;
    target.boxDepth = shape.params?.box?.depth ?? target.boxDepth;
    target.torusRadius = shape.params?.torus?.radius ?? target.torusRadius;
    target.torusTube = shape.params?.torus?.tube ?? target.torusTube;
    target.torusArc = shape.params?.torus?.arc ?? target.torusArc;
    target.cylinderTopRadius = shape.params?.cylinder?.topRadius ?? target.cylinderTopRadius;
    target.cylinderBottomRadius = shape.params?.cylinder?.bottomRadius ?? target.cylinderBottomRadius;
    target.cylinderHeight = shape.params?.cylinder?.height ?? target.cylinderHeight;
    target.cylinderSides = shape.params?.cylinder?.sides ?? target.cylinderSides;
    target.tetartoidA = shape.params?.tetartoid?.a ?? target.tetartoidA;
    target.tetartoidB = shape.params?.tetartoid?.b ?? target.tetartoidB;
    target.tetartoidC = shape.params?.tetartoid?.c ?? target.tetartoidC;

    target.currentOpacity = appearance.opacity;
    target.currentEdgeOpacity = appearance.edgeOpacity;
    target.currentSkin = appearance.skin;
    target.isMaskEnabled = appearance.maskEnabled;
    target.isInteriorEdgesEnabled = appearance.interiorEdges;
    target.isSpecularEnabled = appearance.specular;
    target.innerEdgePulseAmount = appearance.innerEdgePulseAmount;
    target.innerEdgePulseRate = appearance.innerEdgePulseRate;
    target.innerEdgeInsetScale = appearance.innerEdgeInsetScale;
    target.innerEdgeHighlightInsetScale = appearance.innerEdgeHighlightInsetScale;
    target.innerEdgePeakThreshold = appearance.innerEdgePeakThreshold;
    target.innerEdgeFlickerAmount = appearance.innerEdgeFlickerAmount;
    target.innerEdgeFlickerRate = appearance.innerEdgeFlickerRate;
    target.colors = appearance.colors;

    const aura = effects.aura ?? {};
    target.isAuraEnabled = aura.enabled;
    target.auraIntensity = aura.intensity;
    target.auraReach = aura.reach;
    target.auraPulseRate = aura.pulseRate;
    target.auraDepthOffset = aura.depthOffset;
    target.auraBaseScale = aura.baseScale;
    target.auraPulseAmplitude = aura.pulseAmplitude;
    target.auraCoreFade = aura.coreFade;
    target.auraSpikeDecay = aura.spikeDecay;
    target.auraSpike = aura.spike;
    target.spikeMultiplier = aura.spikeMultiplier;
    target.wobbleCount = aura.wobble?.count ?? target.wobbleCount;
    target.wobbleScaleX = aura.wobble?.scaleX ?? target.wobbleScaleX;
    target.wobbleScaleY = aura.wobble?.scaleY ?? target.wobbleScaleY;
    target.wobbleOpacity = aura.wobble?.opacity ?? target.wobbleOpacity;
    target.wobbleOrbitRadius = aura.wobble?.orbitRadius ?? target.wobbleOrbitRadius;
    target.wobbleRadiusScalar = aura.wobble?.radiusScalar ?? target.wobbleRadiusScalar;
    target.wobbleXYRatioScalar = aura.wobble?.xyRatioScalar ?? target.wobbleXYRatioScalar;
    target.wobbleSpeed = aura.wobble?.speed ?? target.wobbleSpeed;
    target.wobbleChaos = aura.wobble?.chaos ?? target.wobbleChaos;
    target.wobbleMode = aura.wobble?.mode ?? target.wobbleMode;

    const phenomena = effects.phenomena ?? {};
    target.isPulsarEnabled = phenomena.pulsar?.enabled ?? target.isPulsarEnabled;
    target.pulsarRayCount = phenomena.pulsar?.count ?? target.pulsarRayCount;
    target.pulsarCounterRevolveSpeed = phenomena.pulsar?.counterRevolveSpeed ?? target.pulsarCounterRevolveSpeed;
    target.pulsarMinHeight = phenomena.pulsar?.minHeight ?? target.pulsarMinHeight;
    target.pulsarMaxHeight = phenomena.pulsar?.maxHeight ?? target.pulsarMaxHeight;
    target.pulsarWidth = phenomena.pulsar?.width ?? target.pulsarWidth;
    target.pulsarWidthVariance = phenomena.pulsar?.widthVariance ?? target.pulsarWidthVariance;
    target.isGammaEnabled = phenomena.gamma?.enabled ?? target.isGammaEnabled;
    target.gammaRayCount = phenomena.gamma?.count ?? target.gammaRayCount;
    target.gammaMinHeight = phenomena.gamma?.minHeight ?? target.gammaMinHeight;
    target.gammaMaxHeight = phenomena.gamma?.maxHeight ?? target.gammaMaxHeight;
    target.gammaWidth = phenomena.gamma?.width ?? target.gammaWidth;
    target.gammaWidthVariance = phenomena.gamma?.widthVariance ?? target.gammaWidthVariance;
    target.isAccretionEnabled = phenomena.accretion?.enabled ?? target.isAccretionEnabled;
    target.accretionDiskCount = phenomena.accretion?.count ?? target.accretionDiskCount;
    target.accretionMinHeight = phenomena.accretion?.minHeight ?? target.accretionMinHeight;
    target.accretionMaxHeight = phenomena.accretion?.maxHeight ?? target.accretionMaxHeight;
    target.accretionWidth = phenomena.accretion?.width ?? target.accretionWidth;
    target.accretionWidthVariance = phenomena.accretion?.widthVariance ?? target.accretionWidthVariance;
    target.isNeutrinosEnabled = phenomena.neutrino?.enabled ?? target.isNeutrinosEnabled;
    target.neutrinoJetCount = phenomena.neutrino?.count ?? target.neutrinoJetCount;
    target.turbState = effects.turbulence;

    const lightning = effects.lightning ?? {};
    target.isLightningEnabled = lightning.enabled;
    target.lightningOriginCenter = lightning.originCenter;
    target.lightningSolidBlock = lightning.solidBlock;
    target.lightningBoltLength = lightning.boltLength;
    target.lightningFrequency = lightning.frequency;
    target.lightningDuration = lightning.duration;
    target.lightningBranching = lightning.branching;
    target.lightningBrightness = lightning.brightness;

    const magnetic = effects.magnetic ?? {};
    target.isMagneticEnabled = magnetic.enabled;
    target.isMagneticFieldEnabled = magnetic.fieldEnabled;
    target.magneticFieldLineCount = magnetic.fieldLineCount;
    target.magneticFieldRadius = magnetic.fieldRadius;
    target.magneticFieldStrength = magnetic.fieldStrength;
    target.magneticTentacleCount = magnetic.tentacleCount;
    target.magneticTentacleSpeed = magnetic.tentacleSpeed;
    target.magneticWander = magnetic.wander;

    const trail = effects.trail ?? {};
    target.isTrailEnabled = trail.enabled;
    target.trailLength = trail.length;
    target.trailOpacity = trail.opacity;
    target.trailFadeMs = trail.fadeMs;
    target.trailStyle = trail.style;

    const omega = effects.omega ?? {};
    target.isOmegaEnabled = omega.enabled;
    target.omegaType = omega.shape?.type;
    target.omegaGeometryType = omega.shape?.type;
    target.omegaStellationFactor = omega.shape?.stellationFactor;
    target.omegaTesseron = omega.shape?.tesseron;
    target.omegaScale = omega.scale;
    target.omegaOpacity = omega.opacity;
    target.omegaEdgeOpacity = omega.edgeOpacity;
    target.omegaIsMaskEnabled = omega.maskEnabled;
    target.omegaIsInteriorEdgesEnabled = omega.interiorEdges;
    target.omegaIsSpecularEnabled = omega.specular;
    target.omegaSkin = omega.skin;
    target.omegaCounterSpin = omega.counterSpin;
    target.omegaLockPosition = omega.lockPosition;
    target.omegaInterDimensional = omega.interDimensional;
    target.omegaGhostCount = omega.ghostCount;
    target.omegaGhostMode = omega.ghostMode;
    target.omegaGhostDuration = omega.ghostDuration;
    target.omegaLagFactor = omega.lagFactor;

    target.idleSpinSpeed = transform.idleSpin;
    target.avatarHitRadius = interaction.hitRadius;
    target.dragThreshold = interaction.dragThreshold;
    target.dragCancelRadius = interaction.dragCancelRadius;
    target.gotoRingRadius = interaction.gotoRingRadius;
    target.menuRingRadius = interaction.menuRingRadius;
    target.radialGestureMenu = interaction.radialGestureMenu;
    target.avatarWindowLevel = windowing.avatarLevel;
}

syncAvatarAliasesFromGraph(state);

export default state;
