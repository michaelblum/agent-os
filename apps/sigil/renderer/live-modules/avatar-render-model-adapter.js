import state from '../state.js';

export const AVATAR_RENDER_SOURCE = 'avatar_render_state';
export const CURRENT_LIVE_SIGIL_AVATAR_SOURCE = 'current_live_sigil_avatar';
export const CURRENT_AVATAR_RENDER_MODEL_SOURCE = 'current_avatar_render_model';
export const CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE = 'current_avatar_effect_descriptors';

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function boolValue(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
}

function colorsSnapshot(colors = {}) {
    const copyPair = (pair = []) => Array.isArray(pair) ? pair.slice(0, 2) : [];
    return {
        face: copyPair(colors.face),
        edge: copyPair(colors.edge),
        aura: copyPair(colors.aura),
        pulsar: copyPair(colors.pulsar),
        accretion: copyPair(colors.accretion),
        gamma: copyPair(colors.gamma),
        neutrino: copyPair(colors.neutrino),
        lightning: copyPair(colors.lightning),
        magnetic: copyPair(colors.magnetic),
        omegaFace: copyPair(colors.omegaFace),
        omegaEdge: copyPair(colors.omegaEdge),
    };
}

function materialTemplateIdentity(material = null) {
    if (!material) return '';
    return String(material.uuid || material.id || material.name || material.type || '');
}

function rootDescriptor(root = null) {
    if (!root) return null;
    return {
        source: 'state.polyGroup',
        objectId: root.userData?.object_id || root.name || 'avatar.main',
        kind: root.type || root.constructor?.name || 'Object3D',
    };
}

function stableVersion(parts = {}) {
    return `avatar-render-model:${JSON.stringify(parts)}`;
}

export function currentAvatarRenderSource(rendererState = state) {
    const primaryMaterialTemplate = rendererState?.coreMesh?.material
        || rendererState?.skinMaterial
        || null;
    const edgeMaterialTemplate = rendererState?.wireframeMesh?.material || null;
    const colors = colorsSnapshot(rendererState?.colors || {});
    const colorRamp = {
        face: colors.face,
        edge: colors.edge,
        aura: colors.aura,
    };
    const auraDescriptor = {
        source: 'state.aura',
        enabled: rendererState?.isAuraEnabled !== false,
        reach: finite(rendererState?.auraReach, 1),
        intensity: finite(rendererState?.auraIntensity, 1),
        pulseRate: finite(rendererState?.auraPulseRate, 0.005),
        depthOffset: finite(rendererState?.auraDepthOffset, 5),
        baseScale: finite(rendererState?.auraBaseScale, 4),
        pulseAmplitude: finite(rendererState?.auraPulseAmplitude, 0.4),
        coreFade: finite(rendererState?.auraCoreFade, 0.6),
        spikeDecay: finite(rendererState?.auraSpikeDecay, 0.92),
        spikeMultiplier: finite(rendererState?.spikeMultiplier, 1.5),
        wobble: {
            count: finite(rendererState?.wobbleCount, 0),
            scaleX: finite(rendererState?.wobbleScaleX, 0.66),
            scaleY: finite(rendererState?.wobbleScaleY, 0.66),
            opacity: finite(rendererState?.wobbleOpacity, 0.7),
            orbitRadius: finite(rendererState?.wobbleOrbitRadius, 0.32),
            radiusScalar: finite(rendererState?.wobbleRadiusScalar, 0.5),
            xyRatioScalar: finite(rendererState?.wobbleXYRatioScalar, 1.45),
            speed: finite(rendererState?.wobbleSpeed, 9),
            chaos: finite(rendererState?.wobbleChaos, 0.35),
            mode: String(rendererState?.wobbleMode || 'random'),
        },
    };
    const phenomenaDescriptor = {
        source: 'state.avatar_phenomena',
        pulsar: {
            enabled: boolValue(rendererState?.isPulsarEnabled, false),
            count: finite(rendererState?.pulsarRayCount, 0),
            counterRevolveSpeed: finite(rendererState?.pulsarCounterRevolveSpeed, 0),
            minHeight: finite(rendererState?.pulsarMinHeight, 2.5),
            maxHeight: finite(rendererState?.pulsarMaxHeight, 4.5),
            width: finite(rendererState?.pulsarWidth, 0.15),
            widthVariance: finite(rendererState?.pulsarWidthVariance, 0.04),
        },
        accretion: {
            enabled: boolValue(rendererState?.isAccretionEnabled, false),
            count: finite(rendererState?.accretionDiskCount, 0),
            minHeight: finite(rendererState?.accretionMinHeight, 0.01),
            maxHeight: finite(rendererState?.accretionMaxHeight, 0.03),
            width: finite(rendererState?.accretionWidth, 0.7),
            widthVariance: finite(rendererState?.accretionWidthVariance, 0.18),
        },
        gamma: {
            enabled: boolValue(rendererState?.isGammaEnabled, false),
            count: finite(rendererState?.gammaRayCount, 0),
            minHeight: finite(rendererState?.gammaMinHeight, 1.05),
            maxHeight: finite(rendererState?.gammaMaxHeight, 1.35),
            width: finite(rendererState?.gammaWidth, 0.017),
            widthVariance: finite(rendererState?.gammaWidthVariance, 0.0035),
        },
        neutrino: {
            enabled: boolValue(rendererState?.isNeutrinosEnabled, false),
            count: finite(rendererState?.neutrinoJetCount, 0),
        },
        turbulence: rendererState?.turbState || {},
    };
    const trailDescriptor = {
        source: 'state.avatar_trail',
        enabled: rendererState?.isTrailEnabled !== false,
        style: String(rendererState?.trailStyle || 'omega'),
        count: finite(rendererState?.trailLength, 0),
        opacity: finite(rendererState?.trailOpacity, 0.5),
        fadeMs: finite(rendererState?.trailFadeMs, 400),
        spriteCount: Array.isArray(rendererState?.trailSprites) ? rendererState.trailSprites.length : 0,
    };
    const lightningDescriptor = {
        source: 'state.lightning',
        enabled: boolValue(rendererState?.isLightningEnabled, false),
        originCenter: rendererState?.lightningOriginCenter !== false,
        solidBlock: boolValue(rendererState?.lightningSolidBlock, false),
        boltLength: finite(rendererState?.lightningBoltLength, 100),
        frequency: finite(rendererState?.lightningFrequency, 2),
        duration: finite(rendererState?.lightningDuration, 0.8),
        branching: finite(rendererState?.lightningBranching, 0.08),
        brightness: finite(rendererState?.lightningBrightness, 1),
    };
    const magneticDescriptor = {
        source: 'state.magnetic',
        enabled: boolValue(rendererState?.isMagneticEnabled, false),
        fieldEnabled: boolValue(rendererState?.isMagneticFieldEnabled, false),
        tentacleCount: finite(rendererState?.magneticTentacleCount, 0),
        tentacleSpeed: finite(rendererState?.magneticTentacleSpeed, 1),
        wander: finite(rendererState?.magneticWander, 3),
        fieldLineCount: finite(rendererState?.magneticFieldLineCount, 20),
        fieldRadius: finite(rendererState?.magneticFieldRadius, 4),
        fieldStrength: finite(rendererState?.magneticFieldStrength, 1),
    };
    const effectRootDescriptor = rootDescriptor(rendererState?.polyGroup || null);
    const versionParts = {
        geometryType: rendererState?.currentGeometryType,
        skin: rendererState?.currentSkin,
        opacity: rendererState?.currentOpacity,
        edgeOpacity: rendererState?.currentEdgeOpacity,
        specular: rendererState?.isSpecularEnabled,
        mask: rendererState?.isMaskEnabled,
        interiorEdges: rendererState?.isInteriorEdgesEnabled,
        materialTemplates: {
            primary: materialTemplateIdentity(primaryMaterialTemplate),
            edge: materialTemplateIdentity(edgeMaterialTemplate),
        },
        colors,
        aura: auraDescriptor,
        phenomena: phenomenaDescriptor,
        trail: trailDescriptor,
        lightning: lightningDescriptor,
        magnetic: magneticDescriptor,
    };
    const version = stableVersion(versionParts);
    return {
        source: AVATAR_RENDER_SOURCE,
        appearanceSource: CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
        appearance_source: CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
        materialSource: CURRENT_AVATAR_RENDER_MODEL_SOURCE,
        material_source: CURRENT_AVATAR_RENDER_MODEL_SOURCE,
        effectsSource: CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        effects_source: CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        version,
        identity: version,
        geometryType: rendererState?.currentGeometryType,
        geometry_type: rendererState?.currentGeometryType,
        skin: rendererState?.currentSkin || 'none',
        primaryMaterialTemplate,
        edgeMaterialTemplate,
        primaryMaterial: primaryMaterialTemplate,
        edgeMaterial: edgeMaterialTemplate,
        colors,
        colorRamp,
        auraDescriptor,
        phenomenaDescriptor,
        trailDescriptor,
        lightningDescriptor,
        magneticDescriptor,
        effectRootDescriptor,
        effectRoot: rendererState?.polyGroup || null,
    };
}
