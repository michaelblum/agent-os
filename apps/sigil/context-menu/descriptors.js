import {
    DEFAULT_FAST_TRAVEL_EFFECT,
    FAST_TRAVEL_EFFECTS,
    normalizeFastTravelEffect,
} from '../renderer/transition-registry.js';
import { isTesseronSupportedShape, normalizeTesseronConfig } from '../renderer/tesseron.js';
import { syncAvatarAliasesFromGraph } from '../renderer/state.js';

const NUMBER = 'number';
const BOOLEAN = 'boolean';
const STRING = 'string';
const GEOMETRY = 'geometry';
const FAST_TRAVEL_EFFECT = 'fast-travel-effect';

function path(parts) {
    return Array.isArray(parts) ? parts : String(parts).split('.');
}

function readPath(target, keyPath) {
    return path(keyPath).reduce((value, key) => value?.[key], target);
}

function writePath(target, keyPath, value) {
    const parts = path(keyPath);
    const last = parts.pop();
    let cursor = target;
    for (const part of parts) {
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
        cursor = cursor[part];
    }
    cursor[last] = value;
}

function coerceValue(value, descriptor) {
    if (descriptor.coerce === BOOLEAN) return !!value;
    if (descriptor.coerce === NUMBER || descriptor.coerce === GEOMETRY) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }
    if (descriptor.coerce === FAST_TRAVEL_EFFECT) {
        return normalizeFastTravelEffect(value, DEFAULT_FAST_TRAVEL_EFFECT);
    }
    return String(value);
}

const SLIDER_LIMITS = Object.freeze({
    'sigil-menu-mother-scale': Object.freeze({ min: 40, max: 400, step: 1 }),
    'sigil-menu-tetartoid-a': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-tetartoid-b': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-tetartoid-c': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-torus-radius': Object.freeze({ min: 0.1, max: 1.5, step: 0.01 }),
    'sigil-menu-torus-tube': Object.freeze({ min: 0.05, max: 0.8, step: 0.01 }),
    'sigil-menu-torus-arc': Object.freeze({ min: 0.1, max: 1, step: 0.01 }),
    'sigil-menu-prism-top-radius': Object.freeze({ min: 0, max: 2, step: 0.01 }),
    'sigil-menu-prism-bottom-radius': Object.freeze({ min: 0.1, max: 2, step: 0.01 }),
    'sigil-menu-prism-height': Object.freeze({ min: 0.2, max: 4, step: 0.01 }),
    'sigil-menu-prism-sides': Object.freeze({ min: 3, max: 64, step: 1 }),
    'sigil-menu-box-width': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-box-height': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-box-depth': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-tesseron-proportion': Object.freeze({ min: 0.12, max: 0.9, step: 0.01 }),
    'sigil-menu-stellation': Object.freeze({ min: -1, max: 2, step: 0.05 }),
    'sigil-menu-opacity': Object.freeze({ min: 0, max: 1, step: 0.01 }),
    'sigil-menu-edge-opacity': Object.freeze({ min: 0, max: 1, step: 0.01 }),
    'sigil-menu-omega-tetartoid-a': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-omega-tetartoid-b': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-omega-tetartoid-c': Object.freeze({ min: 0.01, max: 2, step: 0.01 }),
    'sigil-menu-omega-torus-radius': Object.freeze({ min: 0.1, max: 1.5, step: 0.01 }),
    'sigil-menu-omega-torus-tube': Object.freeze({ min: 0.05, max: 0.8, step: 0.01 }),
    'sigil-menu-omega-torus-arc': Object.freeze({ min: 0.1, max: 1, step: 0.01 }),
    'sigil-menu-omega-prism-top-radius': Object.freeze({ min: 0, max: 2, step: 0.01 }),
    'sigil-menu-omega-prism-bottom-radius': Object.freeze({ min: 0.1, max: 2, step: 0.01 }),
    'sigil-menu-omega-prism-height': Object.freeze({ min: 0.2, max: 4, step: 0.01 }),
    'sigil-menu-omega-prism-sides': Object.freeze({ min: 3, max: 64, step: 1 }),
    'sigil-menu-omega-box-width': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-omega-box-height': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-omega-box-depth': Object.freeze({ min: 0.1, max: 4, step: 0.01 }),
    'sigil-menu-omega-tesseron-proportion': Object.freeze({ min: 0.12, max: 0.9, step: 0.01 }),
    'sigil-menu-omega-scale': Object.freeze({ min: 0.1, max: 5, step: 0.05 }),
    'sigil-menu-omega-stellation': Object.freeze({ min: -1, max: 2, step: 0.05 }),
    'sigil-menu-aura-reach': Object.freeze({ min: 0, max: 3, step: 0.01 }),
    'sigil-menu-aura-intensity': Object.freeze({ min: 0, max: 3, step: 0.01 }),
    'sigil-menu-spin': Object.freeze({ min: 0, max: 0.1, step: 0.001 }),
    'sigil-menu-ring': Object.freeze({ min: 40, max: 260, step: 1 }),
    'sigil-menu-lightning-length': Object.freeze({ min: 10, max: 240, step: 1 }),
    'sigil-menu-lightning-frequency': Object.freeze({ min: 0, max: 8, step: 0.1 }),
    'sigil-menu-lightning-duration': Object.freeze({ min: 0.1, max: 5, step: 0.1 }),
    'sigil-menu-lightning-branching': Object.freeze({ min: 0, max: 0.5, step: 0.01 }),
    'sigil-menu-lightning-brightness': Object.freeze({ min: 0.1, max: 5, step: 0.1 }),
    'sigil-menu-magnetic-count': Object.freeze({ min: 0, max: 40, step: 1 }),
    'sigil-menu-magnetic-speed': Object.freeze({ min: 0, max: 4, step: 0.05 }),
    'sigil-menu-magnetic-wander': Object.freeze({ min: 0, max: 8, step: 0.1 }),
    'sigil-menu-line-duration': Object.freeze({ min: 0.05, max: 1.2, step: 0.01 }),
    'sigil-menu-line-delay': Object.freeze({ min: 0, max: 0.8, step: 0.01 }),
    'sigil-menu-line-repeat-count': Object.freeze({ min: 0, max: 80, step: 1 }),
    'sigil-menu-line-repeat-duration': Object.freeze({ min: 0.1, max: 5, step: 0.05 }),
    'sigil-menu-line-lag': Object.freeze({ min: 0, max: 0.4, step: 0.005 }),
    'sigil-menu-line-scale': Object.freeze({ min: 0.1, max: 4, step: 0.05 }),
    'sigil-menu-wormhole-radius': Object.freeze({ min: 56, max: 220, step: 2 }),
    'sigil-menu-wormhole-implosion': Object.freeze({ min: 0.08, max: 3, step: 0.01 }),
    'sigil-menu-wormhole-transit': Object.freeze({ min: 0.1, max: 1.2, step: 0.01 }),
    'sigil-menu-wormhole-rebound': Object.freeze({ min: 0.12, max: 3, step: 0.01 }),
    'sigil-menu-wormhole-distortion': Object.freeze({ min: -3, max: 3, step: 0.01 }),
    'sigil-menu-wormhole-twist': Object.freeze({ min: -15, max: 15, step: 0.01 }),
    'sigil-menu-wormhole-zoom': Object.freeze({ min: 0.1, max: 10, step: 0.01 }),
    'sigil-menu-wormhole-object-height': Object.freeze({ min: 0.05, max: 2, step: 0.01 }),
    'sigil-menu-wormhole-object-spin': Object.freeze({ min: 0, max: 12, step: 0.05 }),
    'sigil-menu-wormhole-particle-density': Object.freeze({ min: 0, max: 1, step: 0.01 }),
    'sigil-menu-wormhole-shadow': Object.freeze({ min: 0, max: 1, step: 0.01 }),
    'sigil-menu-wormhole-specular': Object.freeze({ min: 0, max: 2, step: 0.01 }),
    'sigil-menu-wormhole-light-angle': Object.freeze({ min: 0, max: 6.283, step: 0.001 }),
    'sigil-menu-wormhole-flash': Object.freeze({ min: 0, max: 5, step: 0.01 }),
    'sigil-menu-wormhole-white': Object.freeze({ min: 0.1, max: 2, step: 0.01 }),
    'sigil-menu-wormhole-starburst': Object.freeze({ min: 0, max: 2, step: 0.01 }),
    'sigil-menu-wormhole-lens': Object.freeze({ min: 0, max: 2, step: 0.01 }),
    'sigil-menu-trail-length': Object.freeze({ min: 0, max: 120, step: 1 }),
    'sigil-menu-trail-opacity': Object.freeze({ min: 0, max: 1, step: 0.01 }),
    'sigil-menu-trail-fade': Object.freeze({ min: 100, max: 2000, step: 50 }),
    'sigil-menu-cancel-radius': Object.freeze({ min: 10, max: 120, step: 1 }),
});

const SELECT_OPTIONS = Object.freeze({
    'sigil-menu-fast-travel-effect': Object.freeze(FAST_TRAVEL_EFFECTS.map((effect) => Object.freeze({
        value: effect.id,
        label: effect.label,
    }))),
    'sigil-menu-line-trail-mode': Object.freeze([
        Object.freeze({ value: 'fade', label: 'Fade' }),
        Object.freeze({ value: 'shrink', label: 'Shrink' }),
        Object.freeze({ value: 'edgeScatter', label: 'Edge Scatter' }),
        Object.freeze({ value: 'vertexDissolve', label: 'Vertex Dissolve' }),
        Object.freeze({ value: 'scaleWarp', label: 'Scale Warp' }),
    ]),
    'sigil-menu-grid-mode': Object.freeze([
        Object.freeze({ value: 'off', label: 'Off' }),
        Object.freeze({ value: 'flat', label: '2D Flat' }),
        Object.freeze({ value: '3d', label: '3D Volumetric' }),
    ]),
    'sigil-menu-trail-style': Object.freeze([
        Object.freeze({ value: 'omega', label: 'Omega' }),
        Object.freeze({ value: 'soft', label: 'Soft' }),
    ]),
});

function descriptor({
    id,
    panel,
    card = panel,
    label,
    type,
    path: statePath,
    coerce,
    route,
    persistence = 'appearance',
    rendererSync = [],
    actionId = null,
    aliases = [],
    afterApply = null,
    visibleWhen = null,
}) {
    const slider = type === 'slider' ? SLIDER_LIMITS[id] : null;
    const options = SELECT_OPTIONS[id] || null;
    return {
        id,
        panel,
        card,
        label,
        type,
        statePath,
        coerce,
        route,
        persistence,
        rendererSync: Array.isArray(rendererSync) ? rendererSync : [rendererSync],
        actionId,
        aliases,
        afterApply,
        visibleWhen,
        ...(slider ? { ...slider } : {}),
        ...(options ? { options: options.map((option) => ({ ...option })) } : {}),
    };
}

function shapeParamDescriptor({
    id,
    label,
    statePath,
    shape,
    selector = 'sigil-menu-shape-select',
    rendererSync = ['updateGeometry'],
}) {
    return descriptor({
        id,
        panel: 'shape',
        card: 'shape-parameters',
        label,
        type: 'slider',
        path: statePath,
        coerce: NUMBER,
        route: 'canvas_object.transform.patch',
        rendererSync,
        visibleWhen: { field: selector, equals: shape },
    });
}

const CONTROL_DESCRIPTORS = [
    descriptor({ id: 'sigil-menu-shape-select', panel: 'shape', label: 'Geometry', type: 'select', path: 'avatar.shape.type', coerce: GEOMETRY, route: 'canvas_object.transform.patch', rendererSync: 'updateGeometry' }),
    descriptor({ id: 'sigil-menu-mother-scale', panel: 'shape', label: 'Mother Scale', type: 'slider', path: 'avatar.shape.size.base', coerce: NUMBER, route: 'canvas_object.transform.patch', rendererSync: 'avatarScale' }),
    shapeParamDescriptor({ id: 'sigil-menu-tetartoid-a', label: 'Tetartoid A', statePath: 'avatar.shape.params.tetartoid.a', shape: 90 }),
    shapeParamDescriptor({ id: 'sigil-menu-tetartoid-b', label: 'Tetartoid B', statePath: 'avatar.shape.params.tetartoid.b', shape: 90 }),
    shapeParamDescriptor({ id: 'sigil-menu-tetartoid-c', label: 'Tetartoid C', statePath: 'avatar.shape.params.tetartoid.c', shape: 90 }),
    shapeParamDescriptor({ id: 'sigil-menu-torus-radius', label: 'Torus Radius', statePath: 'avatar.shape.params.torus.radius', shape: 92 }),
    shapeParamDescriptor({ id: 'sigil-menu-torus-tube', label: 'Torus Tube', statePath: 'avatar.shape.params.torus.tube', shape: 92 }),
    shapeParamDescriptor({ id: 'sigil-menu-torus-arc', label: 'Torus Arc', statePath: 'avatar.shape.params.torus.arc', shape: 92 }),
    shapeParamDescriptor({ id: 'sigil-menu-prism-top-radius', label: 'Prism Top Radius', statePath: 'avatar.shape.params.cylinder.topRadius', shape: 93 }),
    shapeParamDescriptor({ id: 'sigil-menu-prism-bottom-radius', label: 'Prism Bottom Radius', statePath: 'avatar.shape.params.cylinder.bottomRadius', shape: 93 }),
    shapeParamDescriptor({ id: 'sigil-menu-prism-height', label: 'Prism Height', statePath: 'avatar.shape.params.cylinder.height', shape: 93 }),
    shapeParamDescriptor({ id: 'sigil-menu-prism-sides', label: 'Prism Sides', statePath: 'avatar.shape.params.cylinder.sides', shape: 93 }),
    shapeParamDescriptor({ id: 'sigil-menu-box-width', label: 'Box Width', statePath: 'avatar.shape.params.box.width', shape: 6 }),
    shapeParamDescriptor({ id: 'sigil-menu-box-height', label: 'Box Height', statePath: 'avatar.shape.params.box.height', shape: 6 }),
    shapeParamDescriptor({ id: 'sigil-menu-box-depth', label: 'Box Depth', statePath: 'avatar.shape.params.box.depth', shape: 6 }),
    descriptor({ id: 'sigil-menu-tesseron', panel: 'shape', label: 'Tesseron', type: 'checkbox', path: 'avatar.shape.tesseron.enabled', coerce: BOOLEAN, route: 'canvas_object.transform.patch', rendererSync: 'updateGeometry' }),
    descriptor({ id: 'sigil-menu-tesseron-proportion', panel: 'shape', label: 'Child Proportion', type: 'slider', path: 'avatar.shape.tesseron.proportion', coerce: NUMBER, route: 'canvas_object.transform.patch', rendererSync: 'updateGeometry' }),
    descriptor({ id: 'sigil-menu-tesseron-match', panel: 'shape', label: 'Match Mother', type: 'checkbox', path: 'avatar.shape.tesseron.matchMother', coerce: BOOLEAN, route: 'canvas_object.transform.patch', rendererSync: 'updateGeometry' }),
    descriptor({ id: 'sigil-menu-stellation', panel: 'shape', label: 'Stellation', type: 'slider', path: 'avatar.shape.stellationFactor', coerce: NUMBER, route: 'canvas_object.transform.patch', rendererSync: 'updatePrimaryStellation' }),
    descriptor({ id: 'sigil-menu-opacity', panel: 'shape', label: 'Face Opacity', type: 'slider', path: 'avatar.appearance.opacity', coerce: NUMBER, route: 'canvas_object.effects.patch', rendererSync: 'updatePrimaryAppearance' }),
    descriptor({ id: 'sigil-menu-edge-opacity', panel: 'shape', label: 'Edge Opacity', type: 'slider', path: 'avatar.appearance.edgeOpacity', coerce: NUMBER, route: 'canvas_object.effects.patch', rendererSync: 'updatePrimaryAppearance' }),
    descriptor({ id: 'sigil-menu-xray', panel: 'shape', label: 'X-Ray', type: 'checkbox', path: 'avatar.appearance.interiorEdges', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updatePrimaryAppearance' }),
    descriptor({ id: 'sigil-menu-specular', panel: 'shape', label: 'Specular', type: 'checkbox', path: 'avatar.appearance.specular', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updatePrimaryAppearance' }),
    descriptor({ id: 'sigil-menu-primary-color', panel: 'look', label: 'Primary Color', type: 'color', path: ['avatar', 'appearance', 'colors', 'face', 0], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-edge-color', panel: 'look', label: 'Edge Color', type: 'color', path: ['avatar', 'appearance', 'colors', 'edge', 0], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-face1', panel: 'look', card: 'core-colors', label: 'Face 1', type: 'color', path: ['avatar', 'appearance', 'colors', 'face', 0], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-face2', panel: 'look', card: 'core-colors', label: 'Face 2', type: 'color', path: ['avatar', 'appearance', 'colors', 'face', 1], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-edge1', panel: 'look', card: 'core-colors', label: 'Edge 1', type: 'color', path: ['avatar', 'appearance', 'colors', 'edge', 0], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-edge2', panel: 'look', card: 'core-colors', label: 'Edge 2', type: 'color', path: ['avatar', 'appearance', 'colors', 'edge', 1], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-aura1', panel: 'look', card: 'core-colors', label: 'Aura 1', type: 'color', path: ['avatar', 'appearance', 'colors', 'aura', 0], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-aura2', panel: 'look', card: 'core-colors', label: 'Aura 2', type: 'color', path: ['avatar', 'appearance', 'colors', 'aura', 1], coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' }),
    descriptor({ id: 'sigil-menu-aura-reach', panel: 'effects', label: 'Aura Reach', type: 'slider', path: 'avatar.effects.aura.reach', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-aura-intensity', panel: 'effects', label: 'Aura Intensity', type: 'slider', path: 'avatar.effects.aura.intensity', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-spin', panel: 'effects', label: 'Spin Speed', type: 'slider', path: 'avatar.transform.idleSpin', coerce: NUMBER, route: 'canvas_object.transform.patch' }),
    descriptor({ id: 'sigil-menu-pulsar', panel: 'effects', label: 'Pulsar', type: 'checkbox', path: 'avatar.effects.phenomena.pulsar.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updatePulsars' }),
    descriptor({ id: 'sigil-menu-accretion', panel: 'effects', label: 'Accretion', type: 'checkbox', path: 'avatar.effects.phenomena.accretion.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updateAccretion' }),
    descriptor({ id: 'sigil-menu-gamma', panel: 'effects', label: 'Gamma', type: 'checkbox', path: 'avatar.effects.phenomena.gamma.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updateGammaRays' }),
    descriptor({ id: 'sigil-menu-neutrino', panel: 'effects', label: 'Neutrino', type: 'checkbox', path: 'avatar.effects.phenomena.neutrino.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch', rendererSync: 'updateNeutrinos' }),
    descriptor({ id: 'sigil-menu-lightning', panel: 'effects', label: 'Lightning', type: 'checkbox', path: 'avatar.effects.lightning.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-magnetic', panel: 'effects', label: 'Magnetic', type: 'checkbox', path: 'avatar.effects.magnetic.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-interdim', panel: 'effects', label: 'Line Inter-dimensional Trail', type: 'checkbox', path: 'fastTravelLineInterDimensional', coerce: BOOLEAN, route: 'canvas_object.effects.patch', aliases: ['sigil-menu-line-trail-enabled'] }),
    descriptor({ id: 'sigil-menu-fast-travel-effect', panel: 'effects', label: 'Fast Travel Effect', type: 'segmented', path: 'transitionFastTravelEffect', coerce: FAST_TRAVEL_EFFECT, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-duration', panel: 'effects', card: 'line-trail', label: 'Travel Duration', type: 'slider', path: 'fastTravelLineDuration', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-delay', panel: 'effects', card: 'line-trail', label: 'Start Delay', type: 'slider', path: 'fastTravelLineDelay', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-repeat-count', panel: 'effects', card: 'line-trail', label: 'Repeated Objects', type: 'slider', path: 'fastTravelLineRepeatCount', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-repeat-duration', panel: 'effects', card: 'line-trail', label: 'Object Lifetime', type: 'slider', path: 'fastTravelLineRepeatDuration', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-lag', panel: 'effects', card: 'line-trail', label: 'Object Delay', type: 'slider', path: 'fastTravelLineLag', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-scale', panel: 'effects', card: 'line-trail', label: 'Object Scale', type: 'slider', path: 'fastTravelLineScale', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-line-trail-mode', panel: 'effects', card: 'line-trail', label: 'Trail Effect', type: 'segmented', path: 'fastTravelLineTrailMode', coerce: STRING, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-origin-center', panel: 'effects', card: 'lightning', label: 'Origin at Center', type: 'checkbox', path: 'avatar.effects.lightning.originCenter', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-solid-block', panel: 'effects', card: 'lightning', label: 'Solid Block', type: 'checkbox', path: 'avatar.effects.lightning.solidBlock', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-length', panel: 'effects', card: 'lightning', label: 'Length', type: 'slider', path: 'avatar.effects.lightning.boltLength', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-frequency', panel: 'effects', card: 'lightning', label: 'Frequency', type: 'slider', path: 'avatar.effects.lightning.frequency', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-duration', panel: 'effects', card: 'lightning', label: 'Duration', type: 'slider', path: 'avatar.effects.lightning.duration', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-branching', panel: 'effects', card: 'lightning', label: 'Branching', type: 'slider', path: 'avatar.effects.lightning.branching', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-lightning-brightness', panel: 'effects', card: 'lightning', label: 'Brightness', type: 'slider', path: 'avatar.effects.lightning.brightness', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-magnetic-count', panel: 'effects', card: 'magnetic', label: 'Tentacles', type: 'slider', path: 'avatar.effects.magnetic.tentacleCount', coerce: NUMBER, route: 'canvas_object.effects.patch', rendererSync: 'updateMagneticTentacleCount' }),
    descriptor({ id: 'sigil-menu-magnetic-speed', panel: 'effects', card: 'magnetic', label: 'Speed', type: 'slider', path: 'avatar.effects.magnetic.tentacleSpeed', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-magnetic-wander', panel: 'effects', card: 'magnetic', label: 'Wander', type: 'slider', path: 'avatar.effects.magnetic.wander', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-wormhole-shading', panel: 'effects', card: 'wormhole', label: 'Shader Shading', type: 'checkbox', path: 'wormholeShadingEnabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-wormhole-object', panel: 'effects', card: 'wormhole', label: 'Travel Object', type: 'checkbox', path: 'wormholeObjectEnabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-wormhole-particles', panel: 'effects', card: 'wormhole', label: 'Wispy Particles', type: 'checkbox', path: 'wormholeParticlesEnabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    ...[
        ['sigil-menu-wormhole-radius', 'Capture Radius', 'wormholeCaptureRadius'],
        ['sigil-menu-wormhole-implosion', 'Opening', 'wormholeImplosionDuration'],
        ['sigil-menu-wormhole-transit', 'Object Travel', 'wormholeTravelDuration'],
        ['sigil-menu-wormhole-rebound', 'Closing', 'wormholeReboundDuration'],
        ['sigil-menu-wormhole-distortion', 'Pinch Strength', 'wormholeDistortionStrength'],
        ['sigil-menu-wormhole-twist', 'Twist', 'wormholeTwist'],
        ['sigil-menu-wormhole-zoom', 'Tunnel Zoom', 'wormholeZoom'],
        ['sigil-menu-wormhole-object-height', 'Object Height', 'wormholeObjectHeight'],
        ['sigil-menu-wormhole-object-spin', 'Object Spin', 'wormholeObjectSpin'],
        ['sigil-menu-wormhole-particle-density', 'Particle Density', 'wormholeParticleDensity'],
        ['sigil-menu-wormhole-shadow', 'Tunnel Shadow', 'wormholeTunnelShadow'],
        ['sigil-menu-wormhole-specular', 'Surface Highlight', 'wormholeSpecularIntensity'],
        ['sigil-menu-wormhole-light-angle', 'Light Angle', 'wormholeLightAngle'],
        ['sigil-menu-wormhole-flash', 'Flash', 'wormholeFlashIntensity'],
        ['sigil-menu-wormhole-white', 'White Point', 'wormholeWhitePointIntensity'],
        ['sigil-menu-wormhole-starburst', 'Starburst', 'wormholeStarburstIntensity'],
        ['sigil-menu-wormhole-lens', 'Lens Flare', 'wormholeLensFlareIntensity'],
    ].map(([id, label, statePath]) => descriptor({ id, panel: 'effects', card: 'wormhole', label, type: 'slider', path: statePath, coerce: NUMBER, route: 'canvas_object.effects.patch' })),
    descriptor({ id: 'sigil-menu-grid-mode', panel: 'world', label: 'Grid Mode', type: 'select', path: 'gridMode', coerce: STRING, route: 'world-context.patch' }),
    descriptor({ id: 'sigil-menu-ring', panel: 'world', label: 'Menu Ring', type: 'slider', path: 'menuRingRadius', coerce: NUMBER, route: 'world-context.patch', rendererSync: 'syncLiveMenuRing' }),
    descriptor({ id: 'sigil-menu-avatar-above-menu', panel: 'world', label: 'Avatar Above Menu Bar', type: 'checkbox', path: 'avatarWindowLevel', coerce: BOOLEAN, route: 'world-context.patch', rendererSync: 'onAvatarWindowLevelChange', afterApply: 'avatarWindowLevel' }),
    descriptor({ id: 'sigil-menu-omega-enabled', panel: 'shape', card: 'omega', label: 'Enable Omega', type: 'checkbox', path: 'avatar.effects.omega.enabled', coerce: BOOLEAN, route: 'canvas_object.transform.patch' }),
    descriptor({ id: 'sigil-menu-omega-shape', panel: 'shape', card: 'omega', label: 'Omega Geometry', type: 'select', path: 'avatar.effects.omega.shape.type', coerce: GEOMETRY, route: 'canvas_object.transform.patch', rendererSync: 'updateOmegaGeometry' }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-tetartoid-a', label: 'Omega Tetartoid A', statePath: 'avatar.effects.omega.shape.params.tetartoid.a', shape: 90, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-tetartoid-b', label: 'Omega Tetartoid B', statePath: 'avatar.effects.omega.shape.params.tetartoid.b', shape: 90, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-tetartoid-c', label: 'Omega Tetartoid C', statePath: 'avatar.effects.omega.shape.params.tetartoid.c', shape: 90, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-torus-radius', label: 'Omega Torus Radius', statePath: 'avatar.effects.omega.shape.params.torus.radius', shape: 92, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-torus-tube', label: 'Omega Torus Tube', statePath: 'avatar.effects.omega.shape.params.torus.tube', shape: 92, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-torus-arc', label: 'Omega Torus Arc', statePath: 'avatar.effects.omega.shape.params.torus.arc', shape: 92, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-prism-top-radius', label: 'Omega Prism Top Radius', statePath: 'avatar.effects.omega.shape.params.cylinder.topRadius', shape: 93, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-prism-bottom-radius', label: 'Omega Prism Bottom Radius', statePath: 'avatar.effects.omega.shape.params.cylinder.bottomRadius', shape: 93, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-prism-height', label: 'Omega Prism Height', statePath: 'avatar.effects.omega.shape.params.cylinder.height', shape: 93, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-prism-sides', label: 'Omega Prism Sides', statePath: 'avatar.effects.omega.shape.params.cylinder.sides', shape: 93, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-box-width', label: 'Omega Box Width', statePath: 'avatar.effects.omega.shape.params.box.width', shape: 6, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-box-height', label: 'Omega Box Height', statePath: 'avatar.effects.omega.shape.params.box.height', shape: 6, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    shapeParamDescriptor({ id: 'sigil-menu-omega-box-depth', label: 'Omega Box Depth', statePath: 'avatar.effects.omega.shape.params.box.depth', shape: 6, selector: 'sigil-menu-omega-shape', rendererSync: ['updateOmegaGeometry'] }),
    descriptor({ id: 'sigil-menu-omega-tesseron', panel: 'shape', card: 'omega', label: 'Omega Tesseron', type: 'checkbox', path: 'avatar.effects.omega.shape.tesseron.enabled', coerce: BOOLEAN, route: 'canvas_object.transform.patch', rendererSync: 'updateOmegaGeometry' }),
    descriptor({ id: 'sigil-menu-omega-tesseron-proportion', panel: 'shape', card: 'omega', label: 'Omega Child Proportion', type: 'slider', path: 'avatar.effects.omega.shape.tesseron.proportion', coerce: NUMBER, route: 'canvas_object.transform.patch', rendererSync: 'updateOmegaGeometry' }),
    descriptor({ id: 'sigil-menu-omega-tesseron-match', panel: 'shape', card: 'omega', label: 'Omega Match Mother', type: 'checkbox', path: 'avatar.effects.omega.shape.tesseron.matchMother', coerce: BOOLEAN, route: 'canvas_object.transform.patch', rendererSync: 'updateOmegaGeometry' }),
    descriptor({ id: 'sigil-menu-omega-stellation', panel: 'shape', card: 'omega', label: 'Omega Stellation', type: 'slider', path: 'avatar.effects.omega.shape.stellationFactor', coerce: NUMBER, route: 'canvas_object.transform.patch', rendererSync: 'updateOmegaGeometry' }),
    descriptor({ id: 'sigil-menu-omega-scale', panel: 'shape', card: 'omega', label: 'Omega Scale', type: 'slider', path: 'avatar.effects.omega.scale', coerce: NUMBER, route: 'canvas_object.transform.patch' }),
    descriptor({ id: 'sigil-menu-omega-counterspin', panel: 'shape', card: 'omega', label: 'Counter Spin', type: 'checkbox', path: 'avatar.effects.omega.counterSpin', coerce: BOOLEAN, route: 'canvas_object.transform.patch' }),
    descriptor({ id: 'sigil-menu-omega-lock', panel: 'shape', card: 'omega', label: 'Lock Pos', type: 'checkbox', path: 'avatar.effects.omega.lockPosition', coerce: BOOLEAN, route: 'canvas_object.transform.patch' }),
    descriptor({ id: 'sigil-menu-trail-enabled', panel: 'effects', card: 'path-trail', label: 'Trail', type: 'checkbox', path: 'avatar.effects.trail.enabled', coerce: BOOLEAN, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-trail-length', panel: 'effects', card: 'path-trail', label: 'Trail Length', type: 'slider', path: 'avatar.effects.trail.length', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-trail-opacity', panel: 'effects', card: 'path-trail', label: 'Trail Opacity', type: 'slider', path: 'avatar.effects.trail.opacity', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-trail-fade', panel: 'effects', card: 'path-trail', label: 'Trail Fade', type: 'slider', path: 'avatar.effects.trail.fadeMs', coerce: NUMBER, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-trail-style', panel: 'effects', card: 'path-trail', label: 'Trail Style', type: 'select', path: 'avatar.effects.trail.style', coerce: STRING, route: 'canvas_object.effects.patch' }),
    descriptor({ id: 'sigil-menu-cancel-radius', panel: 'effects', card: 'path-trail', label: 'Drag Cancel Radius', type: 'slider', path: 'dragCancelRadius', coerce: NUMBER, route: 'world-context.patch', rendererSync: 'syncLiveDragCancelRadius' }),
    ...[
        ['sigil-menu-lightning1', 'Lightning 1', ['avatar', 'appearance', 'colors', 'lightning', 0]],
        ['sigil-menu-lightning2', 'Lightning 2', ['avatar', 'appearance', 'colors', 'lightning', 1]],
        ['sigil-menu-magnetic1', 'Magnetic 1', ['avatar', 'appearance', 'colors', 'magnetic', 0]],
        ['sigil-menu-magnetic2', 'Magnetic 2', ['avatar', 'appearance', 'colors', 'magnetic', 1]],
        ['sigil-menu-grid1', 'Grid 1', ['colors', 'grid', 0]],
        ['sigil-menu-grid2', 'Grid 2', ['colors', 'grid', 1]],
    ].map(([id, label, statePath]) => descriptor({ id, panel: 'look', card: 'effect-colors', label, type: 'color', path: statePath, coerce: STRING, route: 'canvas_object.effects.patch', rendererSync: 'updateAllColors' })),
    ...[
        ['toggle-inspector', 'Surface Inspector', 'surface-inspector'],
        ['toggle-trace', 'Interaction Trace', 'sigil-interaction-trace'],
        ['toggle-render-performance', 'Render Performance', 'render-performance'],
        ['toggle-log', 'Console Log', 'log-console'],
        ['copy', 'Copy', 'copy-avatar-json'],
        ['save', 'Save', 'save-avatar-json'],
        ['import', 'Import', 'import-avatar-json'],
    ].map(([id, label, actionId]) => descriptor({ id, panel: 'world', label, type: 'action', coerce: STRING, route: 'sigil.action', persistence: 'none', actionId })),
];

export const contextMenuControlDescriptors = Object.freeze(CONTROL_DESCRIPTORS.map(Object.freeze));

const DESCRIPTOR_BY_ID = new Map();
for (const entry of contextMenuControlDescriptors) {
    DESCRIPTOR_BY_ID.set(entry.id, entry);
    for (const alias of entry.aliases || []) DESCRIPTOR_BY_ID.set(alias, entry);
}

export function getContextMenuControlDescriptor(id) {
    return DESCRIPTOR_BY_ID.get(id) || null;
}

function syncRenderer(descriptor, value, context) {
    for (const hook of descriptor.rendererSync || []) {
        if (hook === 'updateGeometry') context.updateGeometry?.(context.state?.avatar?.shape?.type ?? context.state?.currentGeometryType ?? context.state?.currentType);
        else if (hook === 'updatePrimaryStellation') context.updatePrimaryStellation?.(value);
        else if (hook === 'updatePrimaryAppearance') context.updatePrimaryAppearance?.();
        else if (hook === 'updateOmegaGeometry') context.updateOmegaGeometry?.(context.state?.avatar?.effects?.omega?.shape?.type ?? context.state?.omegaGeometryType ?? context.state?.omegaType);
        else if (hook === 'updateAllColors') context.updateAllColors?.();
        else if (hook === 'updatePulsars') context.updatePulsars?.(context.state?.pulsarRayCount);
        else if (hook === 'updateGammaRays') context.updateGammaRays?.(context.state?.gammaRayCount);
        else if (hook === 'updateAccretion') context.updateAccretion?.(context.state?.accretionDiskCount);
        else if (hook === 'updateNeutrinos') context.updateNeutrinos?.(context.state?.neutrinoJetCount);
        else if (hook === 'updateMagneticTentacleCount') context.updateMagneticTentacleCount?.(value);
        else if (hook === 'syncLiveMenuRing' && context.liveJs) context.liveJs.menuRingRadius = value;
        else if (hook === 'syncLiveDragCancelRadius' && context.liveJs) context.liveJs.dragCancelRadius = value;
        else if (hook === 'onAvatarWindowLevelChange') context.onAvatarWindowLevelChange?.(value);
        else if (hook === 'avatarScale') {
            context.state.baseScale = context.computeBaseScale?.(value) ?? context.state.baseScale;
        }
    }
}

function applyCompatibilityBehavior(id, descriptor, value, context) {
    const { state, setControlDisabled, setControlValue } = context;
    if (!state) return value;

    if (descriptor.id === 'sigil-menu-shape-select') {
        state.currentType = value;
        const supported = isTesseronSupportedShape(value);
        setControlDisabled?.('sigil-menu-tesseron', !supported);
        setControlDisabled?.('sigil-menu-stellation', supported && !!state.avatar?.shape?.tesseron?.enabled);
    } else if (descriptor.id === 'sigil-menu-tesseron') {
        state.avatar.shape.tesseron = normalizeTesseronConfig(state.avatar.shape.tesseron);
        setControlDisabled?.('sigil-menu-stellation', value);
        setControlDisabled?.('sigil-menu-tesseron-proportion', !value);
        setControlDisabled?.('sigil-menu-tesseron-match', !value);
    } else if (descriptor.id === 'sigil-menu-tesseron-match' && !value) {
        state.avatar.shape.tesseron = normalizeTesseronConfig(state.avatar.shape.tesseron);
        state.avatar.shape.tesseron.child.opacity ??= state.avatar.appearance.opacity;
        state.avatar.shape.tesseron.child.edgeOpacity ??= state.avatar.appearance.edgeOpacity;
        state.avatar.shape.tesseron.child.maskEnabled ??= state.avatar.appearance.maskEnabled;
        state.avatar.shape.tesseron.child.interiorEdges ??= state.avatar.appearance.interiorEdges;
        state.avatar.shape.tesseron.child.specular ??= state.avatar.appearance.specular;
    } else if (descriptor.id === 'sigil-menu-pulsar' && value && (state.avatar?.effects?.phenomena?.pulsar?.count ?? 0) <= 0) {
        state.avatar.effects.phenomena.pulsar.count = 1;
    } else if (descriptor.id === 'sigil-menu-accretion' && value && (state.avatar?.effects?.phenomena?.accretion?.count ?? 0) <= 0) {
        state.avatar.effects.phenomena.accretion.count = 1;
    } else if (descriptor.id === 'sigil-menu-gamma' && value && (state.avatar?.effects?.phenomena?.gamma?.count ?? 0) <= 0) {
        state.avatar.effects.phenomena.gamma.count = 3;
    } else if (descriptor.id === 'sigil-menu-neutrino' && value && (state.avatar?.effects?.phenomena?.neutrino?.count ?? 0) <= 0) {
        state.avatar.effects.phenomena.neutrino.count = 1;
    } else if (descriptor.id === 'sigil-menu-line-interdim') {
        setControlValue?.('sigil-menu-line-trail-enabled', null, value);
        if (id === 'sigil-menu-line-trail-enabled') {
            setControlValue?.('sigil-menu-line-interdim', null, value);
        }
    } else if (descriptor.id === 'sigil-menu-omega-shape') {
        state.omegaType = value;
        const supported = isTesseronSupportedShape(value);
        setControlDisabled?.('sigil-menu-omega-tesseron', !supported);
        setControlDisabled?.('sigil-menu-omega-stellation', supported && !!state.avatar?.effects?.omega?.shape?.tesseron?.enabled);
    } else if (descriptor.id === 'sigil-menu-omega-tesseron') {
        state.avatar.effects.omega.shape.tesseron = normalizeTesseronConfig(state.avatar.effects.omega.shape.tesseron);
        setControlDisabled?.('sigil-menu-omega-stellation', value);
        setControlDisabled?.('sigil-menu-omega-tesseron-proportion', !value);
        setControlDisabled?.('sigil-menu-omega-tesseron-match', !value);
    } else if (descriptor.id === 'sigil-menu-avatar-above-menu') {
        return value ? 'screen_saver' : 'status_bar';
    }
    return value;
}

export function applyContextMenuDescriptorUpdate(id, rawValue, context = {}) {
    const descriptor = getContextMenuControlDescriptor(id);
    if (!descriptor) return null;
    if (descriptor.type === 'action') {
        return {
            descriptor,
            value: rawValue,
            route: descriptor.route,
            persisted: false,
            actionId: descriptor.actionId,
        };
    }

    const state = context.state;
    if (!state) return null;
    const previousValue = readPath(state, descriptor.statePath);
    let value = coerceValue(rawValue, descriptor);
    value = applyCompatibilityBehavior(id, descriptor, value, context);
    writePath(state, descriptor.statePath, value);
    if (path(descriptor.statePath)[0] === 'avatar') syncAvatarAliasesFromGraph(state);
    syncRenderer(descriptor, value, context);

    const result = {
        descriptor,
        value,
        previousValue,
        route: descriptor.route,
        persisted: descriptor.persistence === 'appearance',
        actionId: descriptor.actionId,
    };
    if (result.persisted) context.onAppearanceChange?.({ controlId: id, value, descriptor });
    return result;
}
