import { globalToUnionLocalPoint } from './display-utils.js';

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function segmentBounds(segment) {
    const bounds = segment?.dw_bounds || segment?.dwBounds || segment?.desktop_world_bounds;
    return Array.isArray(bounds) && bounds.length >= 4
        ? bounds.map((value) => Number(value))
        : null;
}

export function desktopWorldToSegmentLocalPoint(point, { segment = null, globalBounds = null } = {}) {
    if (!point) return null;
    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    if (x == null || y == null) return null;

    const bounds = segmentBounds(segment);
    if (bounds && Number.isFinite(bounds[0]) && Number.isFinite(bounds[1])) {
        return {
            x: x - bounds[0],
            y: y - bounds[1],
            valid: point.valid ?? true,
        };
    }

    const local = globalToUnionLocalPoint({ x, y }, globalBounds);
    if (!local) return null;
    return {
        ...local,
        valid: point.valid ?? true,
    };
}

export function omegaRenderStateSnapshot(rendererState = {}) {
    return {
        enabled: !!rendererState.isOmegaEnabled,
        interDimensional: !!rendererState.omegaInterDimensional,
        ghostCount: finiteNumber(rendererState.omegaGhostCount) ?? 0,
        ghostDuration: finiteNumber(rendererState.omegaGhostDuration) ?? 0,
        ghostMode: String(rendererState.omegaGhostMode || 'fade'),
        lagFactor: finiteNumber(rendererState.omegaLagFactor) ?? 0,
        scale: finiteNumber(rendererState.omegaScale) ?? 1,
    };
}

export function applyOmegaRenderStateSnapshot(rendererState, snapshot) {
    if (!rendererState || !snapshot || typeof snapshot !== 'object') return false;
    if (typeof snapshot.enabled === 'boolean') rendererState.isOmegaEnabled = snapshot.enabled;
    if (typeof snapshot.interDimensional === 'boolean') rendererState.omegaInterDimensional = snapshot.interDimensional;

    const ghostCount = finiteNumber(snapshot.ghostCount);
    if (ghostCount != null) rendererState.omegaGhostCount = ghostCount;

    const ghostDuration = finiteNumber(snapshot.ghostDuration);
    if (ghostDuration != null) rendererState.omegaGhostDuration = ghostDuration;

    if (typeof snapshot.ghostMode === 'string' && snapshot.ghostMode) {
        rendererState.omegaGhostMode = snapshot.ghostMode;
    }

    const lagFactor = finiteNumber(snapshot.lagFactor);
    if (lagFactor != null) rendererState.omegaLagFactor = lagFactor;

    const scale = finiteNumber(snapshot.scale);
    if (scale != null) rendererState.omegaScale = scale;

    return true;
}
