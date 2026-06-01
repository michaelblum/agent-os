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
    createTesseronDepthGeometry,
    createTesseronLinkGeometry,
    isTesseronSupportedShape,
    normalizeTesseronConfig,
    scaleGeometryPositions,
} from './tesseron.js';

export function createStellatedGeometry(baseGeometry, factor) {
    return createSharedStellatedGeometry(globalThis.THREE || THREE, baseGeometry, factor);
}

export function createTetartoid(size, a, b, c) {
    return createSharedTetartoid(globalThis.THREE || THREE, size, a, b, c);
}

function shapeParamSource(params = {}) {
    return {
        boxWidth: params.box?.width ?? state.boxWidth,
        boxHeight: params.box?.height ?? state.boxHeight,
        boxDepth: params.box?.depth ?? state.boxDepth,
        torusRadius: params.torus?.radius ?? state.torusRadius,
        torusTube: params.torus?.tube ?? state.torusTube,
        torusArc: params.torus?.arc ?? state.torusArc,
        cylinderTopRadius: params.cylinder?.topRadius ?? state.cylinderTopRadius,
        cylinderBottomRadius: params.cylinder?.bottomRadius ?? state.cylinderBottomRadius,
        cylinderHeight: params.cylinder?.height ?? state.cylinderHeight,
        cylinderSides: params.cylinder?.sides ?? state.cylinderSides,
        tetartoidA: params.tetartoid?.a ?? state.tetartoidA,
        tetartoidB: params.tetartoid?.b ?? state.tetartoidB,
        tetartoidC: params.tetartoid?.c ?? state.tetartoidC,
    };
}

function createBaseGeometry(type, size, params = state.avatar?.shape?.params) {
    return createAvatarBaseGeometry(globalThis.THREE || THREE, type, size, shapeParamSource(params));
}

function defaultAvatarBaseSize() {
    return 1;
}

function geometryStats() {
    const defaults = {
        primaryFullRebuilds: 0,
        primaryStellationUpdates: 0,
        primaryStellationSuppressed: 0,
        primaryStellationReplacementGeometriesCreated: 0,
        primaryStellationReplacementGeometriesDisposed: 0,
        primaryStellationRetainedGeometries: 0,
        primaryStellationMaxRetainedGeometries: 0,
        primaryAppearanceUpdates: 0,
        primaryAppearanceSuppressed: 0,
        primaryAppearanceMaterialsMutated: 0,
        primaryTesseronProportionUpdates: 0,
        primaryTesseronProportionSuppressed: 0,
        primaryTesseronProportionTemporaryGeometriesCreated: 0,
        primaryTesseronProportionTemporaryGeometriesDisposed: 0,
        primaryTesseronProportionRetainedGeometries: 0,
        primaryTesseronProportionMaxRetainedGeometries: 0,
        omegaFullRebuilds: 0,
    };
    state.__sigilGeometryStats ??= {};
    for (const [key, value] of Object.entries(defaults)) {
        state.__sigilGeometryStats[key] ??= value;
    }
    return state.__sigilGeometryStats;
}

function disposeUniqueGeometries(...geometries) {
    const seen = new Set();
    let disposed = 0;
    for (const geometry of geometries) {
        if (!geometry || seen.has(geometry)) continue;
        seen.add(geometry);
        geometry.dispose?.();
        disposed += 1;
    }
    return disposed;
}

function countUniqueGeometries(...geometries) {
    return new Set(geometries.filter(Boolean)).size;
}

function recordPrimaryStellationRetainedGeometries(stats, ...geometries) {
    const retained = countUniqueGeometries(...geometries);
    stats.primaryStellationRetainedGeometries = retained;
    stats.primaryStellationMaxRetainedGeometries = Math.max(
        stats.primaryStellationMaxRetainedGeometries || 0,
        retained,
    );
}

function recordPrimaryTesseronRetainedGeometries(stats, ...geometries) {
    const retained = countUniqueGeometries(...geometries);
    stats.primaryTesseronProportionRetainedGeometries = retained;
    stats.primaryTesseronProportionMaxRetainedGeometries = Math.max(
        stats.primaryTesseronProportionMaxRetainedGeometries || 0,
        retained,
    );
}

function replacePositionAttribute(targetGeometry, sourceGeometry) {
    const source = sourceGeometry?.getAttribute?.('position');
    if (!targetGeometry || !source) return false;
    const target = targetGeometry.getAttribute?.('position');
    if (!target || target.count !== source.count || target.itemSize !== source.itemSize || target.array?.length !== source.array?.length) {
        targetGeometry.setAttribute('position', source.clone ? source.clone() : source);
    } else {
        target.array.set(source.array);
        target.needsUpdate = true;
    }
    targetGeometry.userData = {
        ...(targetGeometry.userData || {}),
        ...(sourceGeometry.userData || {}),
    };
    targetGeometry.computeVertexNormals?.();
    targetGeometry.computeBoundingBox?.();
    targetGeometry.computeBoundingSphere?.();
    return true;
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
        baseGeometryFactory: (shapeType, size) => createBaseGeometry(shapeType, size, config.shapeParams),
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
        shapeParams: avatar.shape.params,
        isOmega: false
    });
}

function setMaterialOpacity(material, opacity) {
    if (!material) return false;
    const isSolid = opacity >= 0.99;
    let changed = false;
    if ('opacity' in material && material.opacity !== opacity) {
        material.opacity = opacity;
        changed = true;
    }
    if ('transparent' in material && material.transparent !== !isSolid) {
        material.transparent = !isSolid;
        changed = true;
    }
    if ('depthWrite' in material && material.depthWrite !== isSolid) {
        material.depthWrite = isSolid;
        changed = true;
    }
    if ('side' in material) {
        const side = isSolid ? THREE.FrontSide : THREE.DoubleSide;
        if (material.side !== side) {
            material.side = side;
            changed = true;
        }
    }
    if (material.uniforms?.uOpacity && material.uniforms.uOpacity.value !== opacity) {
        material.uniforms.uOpacity.value = opacity;
        changed = true;
    }
    if (changed) material.needsUpdate = true;
    return changed;
}

function setMaterialSpecular(material, enabled) {
    if (!material) return false;
    let changed = false;
    const shininess = enabled ? 80 : 0;
    if ('shininess' in material && material.shininess !== shininess) {
        material.shininess = shininess;
        changed = true;
    }
    if (material.specular?.setHex) {
        const hex = enabled ? 0x333333 : 0x000000;
        material.specular.setHex(hex);
        changed = true;
    }
    if (material.uniforms?.uSpecular) {
        const specular = enabled ? 1.0 : 0.0;
        if (material.uniforms.uSpecular.value !== specular) {
            material.uniforms.uSpecular.value = specular;
            changed = true;
        }
    }
    if (changed) material.needsUpdate = true;
    return changed;
}

function countMutated(...results) {
    return results.filter(Boolean).length;
}

function clampUnit(value, fallback = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function tesseronChildAppearance(avatar, mother) {
    const tesseron = normalizeTesseronConfig(avatar?.shape?.tesseron);
    if (tesseron.matchMother) return mother;
    return {
        faceOpacity: clampUnit(tesseron.child.opacity, mother.faceOpacity),
        lineOpacity: clampUnit(tesseron.child.edgeOpacity, mother.lineOpacity),
        interiorEdges: tesseron.child.interiorEdges ?? mother.interiorEdges,
        maskEnabled: tesseron.child.maskEnabled ?? mother.maskEnabled,
        specular: tesseron.child.specular ?? mother.specular,
    };
}

export function updatePrimaryAppearance() {
    const avatar = state.avatar;
    const type = avatar?.shape?.type ?? state.currentGeometryType ?? state.currentType;
    const tesseronActive = !!avatar?.shape?.tesseron?.enabled && isTesseronSupportedShape(type);
    const stats = geometryStats();

    if (!state.depthMesh?.material || !state.coreMesh?.material || !state.wireframeMesh?.material) {
        updateGeometry(type);
        return { updated: false, rebuilt: true };
    }

    const opacity = Number(avatar.appearance.opacity);
    const edgeOpacity = Number(avatar.appearance.edgeOpacity);
    const faceOpacity = clampUnit(opacity);
    const lineOpacity = clampUnit(edgeOpacity);
    const interiorEdges = !!avatar.appearance.interiorEdges;
    const maskEnabled = !!avatar.appearance.maskEnabled;
    const specular = !!avatar.appearance.specular;
    const childAppearance = tesseronChildAppearance(avatar, {
        faceOpacity,
        lineOpacity,
        interiorEdges,
        maskEnabled,
        specular,
    });

    let mutated = 0;
    mutated += countMutated(setMaterialOpacity(state.coreMesh.material, faceOpacity));
    mutated += countMutated(setMaterialSpecular(state.coreMesh.material, specular));
    if (state.tesseronChildCoreMesh?.material) {
        mutated += countMutated(setMaterialOpacity(state.tesseronChildCoreMesh.material, childAppearance.faceOpacity));
        mutated += countMutated(setMaterialSpecular(state.tesseronChildCoreMesh.material, childAppearance.specular));
    }
    if (state.wireframeMesh.material.opacity !== lineOpacity) {
        state.wireframeMesh.material.opacity = lineOpacity;
        state.wireframeMesh.material.needsUpdate = true;
        mutated += 1;
    }
    if (state.tesseronChildWireframeMesh?.material && state.tesseronChildWireframeMesh.material.opacity !== childAppearance.lineOpacity) {
        state.tesseronChildWireframeMesh.material.opacity = childAppearance.lineOpacity;
        state.tesseronChildWireframeMesh.material.needsUpdate = true;
        mutated += 1;
    }

    state.depthMesh.visible = !interiorEdges;
    state.coreMesh.visible = !maskEnabled;
    state.wireframeMesh.visible = lineOpacity > 0.001;
    if (state.tesseronChildDepthMesh) state.tesseronChildDepthMesh.visible = tesseronActive && !childAppearance.interiorEdges;
    if (state.tesseronChildCoreMesh) state.tesseronChildCoreMesh.visible = tesseronActive && !childAppearance.maskEnabled;
    if (state.tesseronChildWireframeMesh) state.tesseronChildWireframeMesh.visible = tesseronActive && childAppearance.lineOpacity > 0.001;
    updateInnerEdgePulse(false);

    stats.primaryAppearanceUpdates += 1;
    stats.primaryAppearanceMaterialsMutated += mutated;
    if (!mutated) stats.primaryAppearanceSuppressed += 1;
    return { updated: true, rebuilt: false, materialsMutated: mutated };
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
    const baseGeometry = createBaseGeometry(type, defaultAvatarBaseSize(), shape.params);
    const finalGeometry = createSharedStellatedGeometry(THREE_NS, baseGeometry, value);
    finalGeometry.userData = {
        ...(baseGeometry?.userData || {}),
        ...(finalGeometry.userData || {}),
    };
    const edgeGeometry = typeof THREE_NS.EdgesGeometry === 'function'
        ? new THREE_NS.EdgesGeometry(finalGeometry)
        : finalGeometry;
    stats.primaryStellationReplacementGeometriesCreated += countUniqueGeometries(finalGeometry, edgeGeometry);

    const oldDepthGeometry = depthMesh.geometry;
    const oldCoreGeometry = coreMesh.geometry;
    const oldWireGeometry = wireframeMesh.geometry;

    depthMesh.geometry = finalGeometry;
    coreMesh.geometry = finalGeometry;
    wireframeMesh.geometry = edgeGeometry;
    applyGradientVertexColors(coreMesh, avatar.appearance.colors.face);
    applyGradientVertexColors(wireframeMesh, avatar.appearance.colors.edge);

    baseGeometry.dispose?.();
    stats.primaryStellationReplacementGeometriesDisposed += disposeUniqueGeometries(oldDepthGeometry, oldCoreGeometry, oldWireGeometry);
    recordPrimaryStellationRetainedGeometries(stats, depthMesh.geometry, coreMesh.geometry, wireframeMesh.geometry);
    stats.primaryStellationUpdates += 1;
    return { updated: true, suppressed: false };
}

export function updatePrimaryTesseronProportion(value = state.avatar?.shape?.tesseron?.proportion) {
    const avatar = state.avatar;
    const shape = avatar?.shape || {};
    const type = shape.type ?? state.currentGeometryType ?? state.currentType;
    const tesseron = normalizeTesseronConfig({
        ...(shape.tesseron || {}),
        proportion: value,
    });
    const stats = geometryStats();
    const tesseronActive = !!tesseron.enabled && isTesseronSupportedShape(type);

    const meshes = [
        state.depthMesh,
        state.coreMesh,
        state.wireframeMesh,
        state.tesseronChildDepthMesh,
        state.tesseronChildCoreMesh,
        state.tesseronChildWireframeMesh,
        state.innerWireframeMesh,
        state.innerHighlightWireframeMesh,
    ];
    if (!tesseronActive || meshes.some((mesh) => !mesh?.geometry)) {
        stats.primaryTesseronProportionSuppressed += 1;
        updateGeometry(type);
        return { updated: false, rebuilt: true, suppressed: !tesseronActive };
    }

    const THREE_NS = globalThis.THREE || THREE;
    const finalGeometry = state.coreMesh.geometry;
    const temporary = [];
    const createEdges = (geometry) => {
        if (typeof THREE_NS.EdgesGeometry !== 'function') return geometry;
        const edgeGeometry = new THREE_NS.EdgesGeometry(geometry);
        temporary.push(edgeGeometry);
        return edgeGeometry;
    };

    const childGeometry = scaleGeometryPositions(finalGeometry, tesseron.proportion);
    const childDepthGeometry = createTesseronDepthGeometry(finalGeometry, tesseron.proportion);
    const childWireGeometry = createEdges(childGeometry);
    const linkGeometry = createTesseronLinkGeometry(finalGeometry, tesseron.proportion);
    const highlightLinkGeometry = createTesseronLinkGeometry(finalGeometry, tesseron.proportion);
    temporary.push(childGeometry, childDepthGeometry, linkGeometry, highlightLinkGeometry);
    stats.primaryTesseronProportionTemporaryGeometriesCreated += countUniqueGeometries(...temporary);

    replacePositionAttribute(state.tesseronChildCoreMesh.geometry, childGeometry);
    replacePositionAttribute(state.tesseronChildDepthMesh.geometry, childDepthGeometry);
    replacePositionAttribute(state.tesseronChildWireframeMesh.geometry, childWireGeometry);
    replacePositionAttribute(state.innerWireframeMesh.geometry, linkGeometry);
    replacePositionAttribute(state.innerHighlightWireframeMesh.geometry, highlightLinkGeometry);

    applyGradientVertexColors(state.tesseronChildCoreMesh, avatar.appearance.colors.face);
    applyGradientVertexColors(state.tesseronChildWireframeMesh, avatar.appearance.colors.edge);
    applyGradientVertexColors(state.innerWireframeMesh, avatar.appearance.colors.edge);
    applyGradientVertexColors(state.innerHighlightWireframeMesh, avatar.appearance.colors.edge);

    stats.primaryTesseronProportionTemporaryGeometriesDisposed += disposeUniqueGeometries(...temporary);
    recordPrimaryTesseronRetainedGeometries(
        stats,
        state.depthMesh.geometry,
        state.coreMesh.geometry,
        state.wireframeMesh.geometry,
        state.tesseronChildDepthMesh.geometry,
        state.tesseronChildCoreMesh.geometry,
        state.tesseronChildWireframeMesh.geometry,
        state.innerWireframeMesh.geometry,
        state.innerHighlightWireframeMesh.geometry,
    );
    stats.primaryTesseronProportionUpdates += 1;
    return { updated: true, rebuilt: false, suppressed: false };
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
        shapeParams: omega.shape.params,
        isOmega: true
    });
}
