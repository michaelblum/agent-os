import state from './state.js';
import { applyGradientVertexColors } from './colors.js';
import { applySkin } from './skins.js';
import {
    createAvatarBaseGeometry,
    createAvatarShapeComposition,
    createStellatedGeometry as createSharedStellatedGeometry,
    createTetartoid as createSharedTetartoid,
} from './avatar-shape-composition.js';
import {
    isTesseronSupportedShape,
} from './tesseron.js';

export function createStellatedGeometry(baseGeometry, factor) {
    return createSharedStellatedGeometry(globalThis.THREE || THREE, baseGeometry, factor);
}

export function createTetartoid(size, a, b, c) {
    return createSharedTetartoid(globalThis.THREE || THREE, size, a, b, c);
}

function createBaseGeometry(type, size) {
    return createAvatarBaseGeometry(globalThis.THREE || THREE, type, size, state);
}

/**
 * DRY: Shared builder for poly geometries (depth + core + wireframe).
 * Config: { group, depthKey, coreKey, wireKey, innerWireKey, innerHighlightWireKey, childDepthKey, childCoreKey,
 *           childWireKey, opacity, edgeOpacity, stellation, isInterior, isSpecular, isMask, colors, skin,
 *           tesseron, isOmega }
 */
function buildShapeHierarchy(type, config) {
    createAvatarShapeComposition(globalThis.THREE || THREE, type, {
        ...config,
        stateTarget: state,
        stateSource: state,
        keys: {
            depthKey: config.depthKey,
            coreKey: config.coreKey,
            wireKey: config.wireKey,
            innerWireKey: config.innerWireKey,
            innerHighlightWireKey: config.innerHighlightWireKey,
            childDepthKey: config.childDepthKey,
            childCoreKey: config.childCoreKey,
            childWireKey: config.childWireKey,
        },
        baseGeometryFactory: (shapeType, size) => createBaseGeometry(shapeType, size),
        tesseronScaleOrigin: 'origin',
        applyGradientVertexColors,
        applySkin,
    });
}

export function updateInnerEdgePulse(isOmega = false) {
    const wireKey = isOmega ? 'omegaInnerWireframeMesh' : 'innerWireframeMesh';
    const highlightKey = isOmega ? 'omegaInnerHighlightWireframeMesh' : 'innerHighlightWireframeMesh';
    const opacityKey = isOmega ? 'omegaEdgeOpacity' : 'currentEdgeOpacity';
    const colors = isOmega ? state.colors.omegaEdge : state.colors.edge;
    const mesh = state[wireKey];
    const highlightMesh = state[highlightKey];
    if (!mesh?.material) return;

    const gammaConfig = state.turbState?.g ?? { val: 0, spd: 1.0 };
    const gammaEnabled = !!(state.isGammaEnabled && state.gammaRayCount > 0);
    const gammaPulse = gammaEnabled
        ? Math.max(0, Math.sin(state.globalTime * Math.max(0.001, gammaConfig.spd * state.innerEdgePulseRate)))
        : 0;
    const gammaTurbulence = Math.max(0, gammaConfig.val ?? 0);
    const gammaSpeed = Math.max(0.001, gammaConfig.spd ?? 1.0);
    const peakPulse = gammaPulse > state.innerEdgePeakThreshold
        ? (gammaPulse - state.innerEdgePeakThreshold) / Math.max(0.001, 1 - state.innerEdgePeakThreshold)
        : 0;
    const activity = Math.min(1.6, 0.55 + (gammaTurbulence * 2.6));
    const flickerRate = state.innerEdgeFlickerRate * (0.8 + (gammaSpeed * 0.6));
    const flickerNoise = peakPulse > 0
        ? (0.5 + (0.5 * Math.sin((state.globalTime * flickerRate) + 1.7)))
            * (0.5 + (0.5 * Math.sin((state.globalTime * (flickerRate * 1.73)) + 0.31)))
        : 0;
    const flickerBoost = peakPulse > 0
        ? ((1 - state.innerEdgeFlickerAmount) + (flickerNoise * state.innerEdgeFlickerAmount))
        : 0;
    const tesseron = isOmega ? state.omegaTesseron : state.tesseron;
    const geometryType = isOmega ? state.omegaGeometryType : state.currentGeometryType;
    const geometryActive = !!tesseron?.enabled && isTesseronSupportedShape(geometryType);
    const visible = state[opacityKey] > 0.001 && geometryActive;
    const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), 0.35);
    mesh.material.color.setHex(0xffffff);
    mesh.material.opacity = visible ? Math.min(1, state[opacityKey]) : 0;
    mesh.visible = visible;
    mesh.scale.setScalar(1);

    if (!highlightMesh?.material) return;
    const highlightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5);
    highlightMesh.material.color.copy(highlightColor);
    highlightMesh.material.opacity = visible
        ? Math.min(1, state[opacityKey] * peakPulse * activity * flickerBoost * (state.innerEdgePulseAmount * 0.65))
        : 0;
    highlightMesh.visible = visible && peakPulse > 0.001;
    highlightMesh.scale.setScalar(state.innerEdgeHighlightInsetScale);
}

export function updateGeometry(type) {
    buildShapeHierarchy(type, {
        group: state.polyGroup,
        depthKey: 'depthMesh',
        coreKey: 'coreMesh',
        wireKey: 'wireframeMesh',
        innerWireKey: 'innerWireframeMesh',
        innerHighlightWireKey: 'innerHighlightWireframeMesh',
        childDepthKey: 'tesseronChildDepthMesh',
        childCoreKey: 'tesseronChildCoreMesh',
        childWireKey: 'tesseronChildWireframeMesh',
        opacity: state.currentOpacity,
        edgeOpacity: state.currentEdgeOpacity,
        stellation: state.stellationFactor,
        isInterior: state.isInteriorEdgesEnabled,
        isSpecular: state.isSpecularEnabled,
        isMask: state.isMaskEnabled,
        faceColors: state.colors.face,
        edgeColors: state.colors.edge,
        skin: state.currentSkin,
        tesseron: state.tesseron,
        isOmega: false
    });
}

export function updateOmegaGeometry(type) {
    buildShapeHierarchy(type, {
        group: state.omegaGroup,
        depthKey: 'omegaDepthMesh',
        coreKey: 'omegaCoreMesh',
        wireKey: 'omegaWireframeMesh',
        innerWireKey: 'omegaInnerWireframeMesh',
        innerHighlightWireKey: 'omegaInnerHighlightWireframeMesh',
        childDepthKey: 'omegaTesseronChildDepthMesh',
        childCoreKey: 'omegaTesseronChildCoreMesh',
        childWireKey: 'omegaTesseronChildWireframeMesh',
        opacity: state.omegaOpacity,
        edgeOpacity: state.omegaEdgeOpacity,
        stellation: state.omegaStellationFactor,
        isInterior: state.omegaIsInteriorEdgesEnabled,
        isSpecular: state.omegaIsSpecularEnabled,
        isMask: state.omegaIsMaskEnabled,
        faceColors: state.colors.omegaFace,
        edgeColors: state.colors.omegaEdge,
        skin: state.omegaSkin,
        tesseron: state.omegaTesseron,
        isOmega: true
    });
}
