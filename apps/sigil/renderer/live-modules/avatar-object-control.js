import {
    SIGIL_OBJECT_CONTROL_CANVAS_ID,
    SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
    buildRadialMenuObjectRegistry,
    contractTransformFromEffect,
} from './radial-object-control.js';
import { isTesseronSupportedShape, normalizeTesseronConfig } from '../tesseron.js';

export const AVATAR_ROOT_OBJECT_ID = 'avatar.main';
export const AVATAR_PRIMARY_OBJECT_ID = 'avatar.primary.shape';
export const AVATAR_PRIMARY_TESSERON_OBJECT_ID = 'avatar.primary.tesseron';
export const AVATAR_AURA_OBJECT_ID = 'avatar.effects.aura';
export const AVATAR_PHENOMENA_OBJECT_ID = 'avatar.effects.phenomena';
export const AVATAR_TRAIL_OBJECT_ID = 'avatar.effects.trail';
export const AVATAR_TRAVEL_OBJECT_ID = 'avatar.effects.travel';
export const AVATAR_OMEGA_OBJECT_ID = 'avatar.omega.shape';
export const AVATAR_OMEGA_TESSERON_OBJECT_ID = 'avatar.omega.tesseron';

const CONTRACT_UNITS = {
    position: 'scene',
    scale: 'multiplier',
    rotation: 'degrees',
};

const IDENTITY_TRANSFORM = {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
};

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
    return value === undefined ? fallback : !!value;
}

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function registryObject({
    objectId,
    parentObjectId,
    name,
    visible = true,
    transform = IDENTITY_TRANSFORM,
    descriptors = {},
    controls = {},
    metadata = {},
    capabilities = ['transform.read', 'visibility.read', 'effects.read'],
}) {
    const object = {
        object_id: objectId,
        name,
        kind: 'three.object3d',
        capabilities,
        transform: contractTransformFromEffect(transform),
        units: CONTRACT_UNITS,
        visible: !!visible,
        descriptors,
        metadata: {
            owner: 'sigil',
            subject: 'avatar-main',
            source: 'apps/sigil/renderer/live-modules/avatar-object-control.js',
            ...metadata,
        },
    };
    if (parentObjectId) object.parent_object_id = parentObjectId;
    if (Object.keys(controls).length > 0) object.controls = controls;
    return object;
}

function effectControl({ id, label, type = 'number', value, min, max, step, unit, tooltip }) {
    const control = { id, label, type, value };
    if (min !== undefined) control.min = min;
    if (max !== undefined) control.max = max;
    if (step !== undefined) control.step = step;
    if (unit !== undefined) control.unit = unit;
    if (tooltip !== undefined) control.tooltip = tooltip;
    return control;
}

function effectControls(controls) {
    return { animation_effects: controls };
}

function avatarRootTransform(rendererState = {}, options = {}) {
    const pos = options.avatarPos || rendererState.polyGroup?.position || {};
    const scale = finite(rendererState.z_depth, 1) * finite(rendererState.appScale, 1);
    return {
        position: {
            x: finite(pos.x, 0),
            y: finite(pos.y, 0),
            z: finite(pos.z, 0),
        },
        scale: { x: scale, y: scale, z: scale },
        rotationDegrees: { x: 0, y: 0, z: 0 },
    };
}

function shapeMetadata(rendererState = {}, prefix = 'primary') {
    return {
        role: `${prefix}-shape`,
        source_refs: {
            geometry_type: prefix === 'omega' ? 'state.omegaGeometryType' : 'state.currentGeometryType',
            stellation: prefix === 'omega' ? 'state.omegaStellationFactor' : 'state.stellationFactor',
            opacity: prefix === 'omega' ? 'state.omegaOpacity' : 'state.currentOpacity',
            edge_opacity: prefix === 'omega' ? 'state.omegaEdgeOpacity' : 'state.currentEdgeOpacity',
            skin: prefix === 'omega' ? 'state.omegaSkin' : 'state.currentSkin',
        },
        geometry_type: prefix === 'omega' ? rendererState.omegaGeometryType : rendererState.currentGeometryType,
    };
}

function tesseronActive(rendererState = {}, prefix = 'primary') {
    const geometryType = prefix === 'omega' ? rendererState.omegaGeometryType : rendererState.currentGeometryType;
    const config = normalizeTesseronConfig(prefix === 'omega' ? rendererState.omegaTesseron : rendererState.tesseron);
    return config.enabled && isTesseronSupportedShape(geometryType);
}

function tesseronControls(config = {}) {
    return effectControls([
        effectControl({
            id: 'tesseron.proportion',
            label: 'Tesseron proportion',
            type: 'range',
            value: finite(config.proportion, 0.5),
            min: 0.12,
            max: 0.9,
            step: 0.01,
        }),
        effectControl({
            id: 'tesseron.matchMother',
            label: 'Match primary material',
            type: 'checkbox',
            value: bool(config.matchMother, true),
        }),
    ]);
}

function buildPrimaryObjects(rendererState = {}, options = {}) {
    const tesseron = normalizeTesseronConfig(rendererState.tesseron);
    const objects = [
        registryObject({
            objectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Sigil Avatar',
            transform: avatarRootTransform(rendererState, options),
            visible: options.avatarVisible ?? true,
            descriptors: {
                geometry: 'Live Sigil avatar subject root in DesktopWorld scene space.',
                animation_effects: 'Owns product avatar rendering, not app actions, window chrome, or world context controls.',
            },
            metadata: {
                role: 'subject-root',
                control_domain: 'object-graph',
                source_refs: {
                    position: 'liveJs.avatarPos',
                    scale: 'state.z_depth/state.appScale',
                },
            },
        }),
        registryObject({
            objectId: AVATAR_PRIMARY_OBJECT_ID,
            parentObjectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Primary Avatar Shape',
            visible: options.avatarVisible ?? true,
            transform: IDENTITY_TRANSFORM,
            descriptors: {
                geometry: `Primary polyhedron geometry ${rendererState.currentGeometryType ?? 'unknown'} with stellation, face, edge, skin, and mask settings from appearance state.`,
                animation_effects: 'Idle spin, appearance transitions, masks, interior edges, and skin animation remain Sigil renderer-owned.',
            },
            controls: effectControls([
                effectControl({ id: 'shape.type', label: 'Shape', type: 'number', value: finite(rendererState.currentGeometryType, 6), min: 4, max: 100, step: 1 }),
                effectControl({ id: 'shape.stellation', label: 'Stellation', type: 'range', value: finite(rendererState.stellationFactor, 0), min: 0, max: 2, step: 0.01 }),
                effectControl({ id: 'material.opacity', label: 'Face opacity', type: 'range', value: finite(rendererState.currentOpacity, 0.25), min: 0, max: 1, step: 0.01 }),
                effectControl({ id: 'material.edgeOpacity', label: 'Edge opacity', type: 'range', value: finite(rendererState.currentEdgeOpacity, 1), min: 0, max: 1, step: 0.01 }),
            ]),
            metadata: {
                ...shapeMetadata(rendererState, 'primary'),
                control_domain: 'object-effect',
            },
        }),
    ];

    if (tesseronActive(rendererState, 'primary')) {
        objects.push(registryObject({
            objectId: AVATAR_PRIMARY_TESSERON_OBJECT_ID,
            parentObjectId: AVATAR_PRIMARY_OBJECT_ID,
            name: 'Primary Tesseron Child And Links',
            visible: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                scale: { x: finite(tesseron.proportion, 0.5), y: finite(tesseron.proportion, 0.5), z: finite(tesseron.proportion, 0.5) },
                rotationDegrees: { x: 0, y: 0, z: 0 },
            },
            descriptors: {
                geometry: 'Nested tesseron child shape plus link/depth geometry generated from the primary avatar geometry.',
                animation_effects: 'Interior link pulse and child material settings are driven from state.tesseron.',
            },
            controls: tesseronControls(tesseron),
            metadata: {
                role: 'primary-tesseron',
                control_domain: 'object-effect',
                source_refs: {
                    tesseron: 'state.tesseron',
                    geometry_support: 'isTesseronSupportedShape(state.currentGeometryType)',
                },
            },
        }));
    }
    return objects;
}

function buildEffectObjects(rendererState = {}) {
    return [
        registryObject({
            objectId: AVATAR_AURA_OBJECT_ID,
            parentObjectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Aura Effects',
            visible: bool(rendererState.isAuraEnabled, true),
            descriptors: {
                geometry: 'Renderer-neutral aura group covering glow sprites, core fade, spike, and wobble meshes.',
                animation_effects: 'Aura reach, pulse, wobble, spike, and session-vitality multipliers are effect controls, not Sigil app actions.',
            },
            controls: effectControls([
                effectControl({ id: 'aura.intensity', label: 'Aura intensity', type: 'range', value: finite(rendererState.auraIntensity, 1), min: 0, max: 3, step: 0.05 }),
                effectControl({ id: 'aura.reach', label: 'Aura reach', type: 'range', value: finite(rendererState.auraReach, 1), min: 0, max: 4, step: 0.05 }),
                effectControl({ id: 'aura.wobble.count', label: 'Wobble count', type: 'number', value: finite(rendererState.wobbleCount, 1), min: 0, max: 24, step: 1 }),
            ]),
            metadata: {
                role: 'effect-group',
                control_domain: 'object-effect',
                source_refs: {
                    enabled: 'state.isAuraEnabled',
                    intensity: 'state.auraIntensity',
                    reach: 'state.auraReach',
                    wobble: 'state.wobble*',
                },
            },
        }),
        registryObject({
            objectId: AVATAR_PHENOMENA_OBJECT_ID,
            parentObjectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Cosmic Phenomena Effects',
            visible: bool(rendererState.isPulsarEnabled)
                || bool(rendererState.isAccretionEnabled)
                || bool(rendererState.isGammaEnabled)
                || bool(rendererState.isNeutrinosEnabled),
            descriptors: {
                geometry: 'Renderer-neutral group for pulsars, accretion disks, gamma rays, and neutrino jets.',
                animation_effects: 'Counts, beam dimensions, turbulence, and revolve speed are appearance state effects.',
            },
            controls: effectControls([
                effectControl({ id: 'phenomena.pulsar.count', label: 'Pulsars', type: 'number', value: finite(rendererState.pulsarRayCount, 0), min: 0, max: 64, step: 1 }),
                effectControl({ id: 'phenomena.accretion.count', label: 'Accretion disks', type: 'number', value: finite(rendererState.accretionDiskCount, 0), min: 0, max: 64, step: 1 }),
                effectControl({ id: 'phenomena.gamma.count', label: 'Gamma rays', type: 'number', value: finite(rendererState.gammaRayCount, 0), min: 0, max: 64, step: 1 }),
                effectControl({ id: 'phenomena.neutrino.count', label: 'Neutrino jets', type: 'number', value: finite(rendererState.neutrinoJetCount, 0), min: 0, max: 64, step: 1 }),
            ]),
            metadata: {
                role: 'effect-group',
                control_domain: 'object-effect',
                source_refs: {
                    pulsar: 'state.isPulsarEnabled/state.pulsarRayCount',
                    accretion: 'state.isAccretionEnabled/state.accretionDiskCount',
                    gamma: 'state.isGammaEnabled/state.gammaRayCount',
                    neutrino: 'state.isNeutrinosEnabled/state.neutrinoJetCount',
                    turbulence: 'state.turbState',
                },
            },
        }),
        registryObject({
            objectId: AVATAR_TRAIL_OBJECT_ID,
            parentObjectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Avatar Motion Trail',
            visible: bool(rendererState.isTrailEnabled),
            descriptors: {
                geometry: 'Renderer-neutral trail sprite pool behind the primary avatar.',
                animation_effects: 'Trail count, opacity, fade window, and style are appearance state effects.',
            },
            controls: effectControls([
                effectControl({ id: 'trails.count', label: 'Trail count', type: 'number', value: finite(rendererState.trailLength, 0), min: 0, max: 200, step: 1 }),
                effectControl({ id: 'trails.opacity', label: 'Trail opacity', type: 'range', value: finite(rendererState.trailOpacity, 0.5), min: 0, max: 1, step: 0.01 }),
                effectControl({ id: 'trails.fadeMs', label: 'Trail fade', type: 'number', value: finite(rendererState.trailFadeMs, 400), min: 16, max: 5000, step: 16, unit: 'ms' }),
            ]),
            metadata: {
                role: 'effect-group',
                control_domain: 'object-effect',
                source_refs: {
                    enabled: 'state.isTrailEnabled',
                    count: 'state.trailLength',
                    sprites: 'state.trailSprites',
                },
            },
        }),
        registryObject({
            objectId: AVATAR_TRAVEL_OBJECT_ID,
            parentObjectId: AVATAR_ROOT_OBJECT_ID,
            name: 'Fast Travel Effects',
            visible: text(rendererState.transitionFastTravelEffect, 'line') !== 'none',
            descriptors: {
                geometry: 'Renderer-neutral travel effects including line, wormhole, repeated trail, shockwave, and transition helpers.',
                animation_effects: 'Fast-travel effect selection and wormhole/line parameters are appearance state controls.',
            },
            controls: effectControls([
                effectControl({ id: 'fastTravel.effect', label: 'Fast travel effect', type: 'number', value: text(rendererState.transitionFastTravelEffect, 'line') === 'wormhole' ? 2 : 1, min: 0, max: 2, step: 1 }),
                effectControl({ id: 'fastTravel.line.repeatCount', label: 'Line repeats', type: 'number', value: finite(rendererState.fastTravelLineRepeatCount, 10), min: 0, max: 120, step: 1 }),
                effectControl({ id: 'fastTravel.wormhole.objectEnabled', label: 'Wormhole object', type: 'checkbox', value: bool(rendererState.wormholeObjectEnabled, true) }),
            ]),
            metadata: {
                role: 'effect-group',
                control_domain: 'object-effect',
                source_refs: {
                    effect: 'state.transitionFastTravelEffect',
                    line: 'state.fastTravelLine*',
                    wormhole: 'state.wormhole*',
                },
            },
        }),
    ];
}

function buildOmegaObjects(rendererState = {}) {
    const objects = [];
    if (!bool(rendererState.isOmegaEnabled)) return objects;
    const tesseron = normalizeTesseronConfig(rendererState.omegaTesseron);
    objects.push(registryObject({
        objectId: AVATAR_OMEGA_OBJECT_ID,
        parentObjectId: AVATAR_ROOT_OBJECT_ID,
        name: 'Omega Secondary Shape',
        visible: true,
        transform: {
            position: { x: 0, y: 0, z: 0 },
            scale: { x: finite(rendererState.omegaScale, 1.5), y: finite(rendererState.omegaScale, 1.5), z: finite(rendererState.omegaScale, 1.5) },
            rotationDegrees: { x: 0, y: 0, z: 0 },
        },
        descriptors: {
            geometry: `Secondary omega polyhedron geometry ${rendererState.omegaGeometryType ?? 'unknown'}.`,
            animation_effects: 'Counter-spin, lock-position, inter-dimensional lag, and ghost trails are omega effect controls.',
        },
        controls: effectControls([
            effectControl({ id: 'omega.scale', label: 'Omega scale', type: 'range', value: finite(rendererState.omegaScale, 1.5), min: 0, max: 6, step: 0.05 }),
            effectControl({ id: 'omega.opacity', label: 'Omega opacity', type: 'range', value: finite(rendererState.omegaOpacity, 0.15), min: 0, max: 1, step: 0.01 }),
            effectControl({ id: 'omega.ghostCount', label: 'Omega ghosts', type: 'number', value: finite(rendererState.omegaGhostCount, 10), min: 0, max: 200, step: 1 }),
            effectControl({ id: 'omega.interDimensional', label: 'Inter-dimensional lag', type: 'checkbox', value: bool(rendererState.omegaInterDimensional) }),
        ]),
        metadata: {
            ...shapeMetadata(rendererState, 'omega'),
            control_domain: 'object-effect',
            source_refs: {
                ...shapeMetadata(rendererState, 'omega').source_refs,
                enabled: 'state.isOmegaEnabled',
                ghosts: 'state.omegaGhost*',
            },
        },
    }));
    if (tesseronActive(rendererState, 'omega')) {
        objects.push(registryObject({
            objectId: AVATAR_OMEGA_TESSERON_OBJECT_ID,
            parentObjectId: AVATAR_OMEGA_OBJECT_ID,
            name: 'Omega Tesseron Child And Links',
            visible: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                scale: { x: finite(tesseron.proportion, 0.5), y: finite(tesseron.proportion, 0.5), z: finite(tesseron.proportion, 0.5) },
                rotationDegrees: { x: 0, y: 0, z: 0 },
            },
            descriptors: {
                geometry: 'Nested tesseron child shape plus link/depth geometry generated from the omega geometry.',
                animation_effects: 'Omega tesseron material and link pulse settings are driven from state.omegaTesseron.',
            },
            controls: tesseronControls(tesseron),
            metadata: {
                role: 'omega-tesseron',
                control_domain: 'object-effect',
                source_refs: {
                    tesseron: 'state.omegaTesseron',
                    geometry_support: 'isTesseronSupportedShape(state.omegaGeometryType)',
                },
            },
        }));
    }
    return objects;
}

export function buildAvatarObjectRegistry(rendererState = {}, options = {}) {
    const canvasId = text(options.canvasId, SIGIL_OBJECT_CONTROL_CANVAS_ID);
    const objects = [
        ...buildPrimaryObjects(rendererState, options),
        ...buildEffectObjects(rendererState),
        ...buildOmegaObjects(rendererState),
    ];
    const radialObjects = buildRadialMenuObjectRegistry(rendererState.radialGestureMenu, { canvasId }).objects
        .map((object) => ({
            ...object,
            parent_object_id: object.parent_object_id || AVATAR_ROOT_OBJECT_ID,
            metadata: {
                ...(object.metadata || {}),
                owner: 'sigil',
                subject: 'avatar-main',
                control_domain: 'object-effect',
                source_refs: {
                    radial_item: 'state.radialGestureMenu.items',
                    ...(object.metadata?.source_refs || {}),
                },
            },
        }));

    return {
        type: 'canvas_object.registry',
        schema_version: SIGIL_OBJECT_CONTROL_SCHEMA_VERSION,
        canvas_id: canvasId,
        source_id: text(options.sourceId, 'sigil.avatar-object-control'),
        objects: [...objects, ...radialObjects],
    };
}
