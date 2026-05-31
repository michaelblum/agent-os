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

function defaultAvatarBaseSize() {
    return 1;
}

function geometryStats() {
    state.__sigilGeometryStats ??= {
        primaryFullRebuilds: 0,
        primaryStellationUpdates: 0,
        primaryStellationSuppressed: 0,
        omegaFullRebuilds: 0,
    };
    return state.__sigilGeometryStats;
}

function disposeUniqueGeometries(...geometries) {
    const seen = new Set();
    for (const geometry of geometries) {
        if (!geometry || seen.has(geometry)) continue;
        seen.add(geometry);
        geometry.dispose?.();
    }
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
    const edgeOpacity = isOmega
        ? state.avatar.effects.omega.edgeOpacity
        : state.avatar.appearance.edgeOpacity;
    const colors = isOmega ? state.avatar.appearance.colors.omegaEdge : state.avatar.appearance.colors.edge;
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
    const tesseron = isOmega ? state.avatar.effects.omega.shape.tesseron : state.avatar.shape.tesseron;
    const geometryType = isOmega ? state.avatar.effects.omega.shape.type : state.avatar.shape.type;
    const geometryActive = !!tesseron?.enabled && isTesseronSupportedShape(geometryType);
    const visible = edgeOpacity > 0.001 && geometryActive;
    const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), 0.35);
    mesh.material.color.setHex(0xffffff);
    mesh.material.opacity = visible ? Math.min(1, edgeOpacity) : 0;
    mesh.visible = visible;
    mesh.scale.setScalar(1);

    if (!highlightMesh?.material) return;
    const highlightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5);
    highlightMesh.material.color.copy(highlightColor);
    highlightMesh.material.opacity = visible
        ? Math.min(1, edgeOpacity * peakPulse * activity * flickerBoost * (state.innerEdgePulseAmount * 0.65))
        : 0;
    highlightMesh.visible = visible && peakPulse > 0.001;
    highlightMesh.scale.setScalar(state.innerEdgeHighlightInsetScale);
}

export function updateGeometry(type) {
    geometryStats().primaryFullRebuilds += 1;
    const avatar = state.avatar;
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
        opacity: avatar.appearance.opacity,
        edgeOpacity: avatar.appearance.edgeOpacity,
        stellation: avatar.shape.stellationFactor,
        isInterior: avatar.appearance.interiorEdges,
        isSpecular: avatar.appearance.specular,
        isMask: avatar.appearance.maskEnabled,
        faceColors: avatar.appearance.colors.face,
        edgeColors: avatar.appearance.colors.edge,
        skin: avatar.appearance.skin,
        tesseron: avatar.shape.tesseron,
        isOmega: false
    });
}

export function updatePrimaryStellation(value = state.avatar?.shape?.stellationFactor) {
    const avatar = state.avatar;
    const shape = avatar?.shape || {};
    const type = shape.type ?? state.currentGeometryType ?? state.currentType;
    const tesseronActive = !!shape.tesseron?.enabled && isTesseronSupportedShape(type);
    const stats = geometryStats();

    if (tesseronActive) {
        stats.primaryStellationSuppressed += 1;
        return { updated: false, suppressed: true };
    }

    const depthMesh = state.depthMesh;
    const coreMesh = state.coreMesh;
    const wireframeMesh = state.wireframeMesh;
    if (!depthMesh?.geometry || !coreMesh?.geometry || !wireframeMesh?.geometry) {
        updateGeometry(type);
        return { updated: false, rebuilt: true };
    }

    const THREE_NS = globalThis.THREE || THREE;
    const baseGeometry = createBaseGeometry(type, defaultAvatarBaseSize());
    const finalGeometry = createSharedStellatedGeometry(THREE_NS, baseGeometry, value);
    finalGeometry.userData = {
        ...(baseGeometry?.userData || {}),
        ...(finalGeometry.userData || {}),
    };
    const edgeGeometry = typeof THREE_NS.EdgesGeometry === 'function'
        ? new THREE_NS.EdgesGeometry(finalGeometry)
        : finalGeometry;

    const oldDepthGeometry = depthMesh.geometry;
    const oldCoreGeometry = coreMesh.geometry;
    const oldWireGeometry = wireframeMesh.geometry;

    depthMesh.geometry = finalGeometry;
    coreMesh.geometry = finalGeometry;
    wireframeMesh.geometry = edgeGeometry;
    applyGradientVertexColors(coreMesh, avatar.appearance.colors.face);
    applyGradientVertexColors(wireframeMesh, avatar.appearance.colors.edge);

    baseGeometry.dispose?.();
    disposeUniqueGeometries(oldDepthGeometry, oldCoreGeometry, oldWireGeometry);
    stats.primaryStellationUpdates += 1;
    return { updated: true, suppressed: false };
}

export function updateOmegaGeometry(type) {
    geometryStats().omegaFullRebuilds += 1;
    const omega = state.avatar.effects.omega;
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
        opacity: omega.opacity,
        edgeOpacity: omega.edgeOpacity,
        stellation: omega.shape.stellationFactor,
        isInterior: omega.interiorEdges,
        isSpecular: omega.specular,
        isMask: omega.maskEnabled,
        faceColors: state.avatar.appearance.colors.omegaFace,
        edgeColors: state.avatar.appearance.colors.omegaEdge,
        skin: omega.skin,
        tesseron: omega.shape.tesseron,
        isOmega: true
    });
}
