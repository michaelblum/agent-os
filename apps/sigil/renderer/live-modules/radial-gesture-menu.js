import { createRadialGestureModel, resolveRadialGestureItems } from './radial-gesture-runtime.js';
import { findDisplayForPoint } from './display-utils.js';
import {
    DEFAULT_SIGIL_RADIAL_ITEMS,
    normalizeSigilRadialGestureMenu,
} from '../radial-menu-defaults.js';

export { DEFAULT_SIGIL_RADIAL_ITEMS };

const DEFAULT_CONFIG = {
    radiusBasis: 40,
    deadZoneRadius: 0.6,
    itemRadius: 1.55,
    itemHitRadius: 0.42,
    itemVisualRadius: 0.28,
    menuRadius: 1.8,
    handoffRadius: 2.25,
    reentryRadius: 1.85,
    spreadDegrees: 88,
    startAngle: -90,
    orientation: 'fixed',
    items: DEFAULT_SIGIL_RADIAL_ITEMS,
};

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function visibleBounds(display = null) {
    return display?.visibleBounds
        || display?.visible_bounds
        || display?.bounds
        || null;
}

function pointInBounds(point = null, bounds = null, inset = 0) {
    if (!point || !bounds) return false;
    const x = Number(bounds.x);
    const y = Number(bounds.y);
    const width = Number(bounds.w ?? bounds.width);
    const height = Number(bounds.h ?? bounds.height);
    if (![x, y, width, height].every(Number.isFinite)) return false;
    return point.x >= x + inset
        && point.x <= x + width - inset
        && point.y >= y + inset
        && point.y <= y + height - inset;
}

function distanceBetween(a = {}, b = {}) {
    return Math.hypot(
        Number(a.x) - Number(b.x),
        Number(a.y) - Number(b.y),
    );
}

function angleFrom(origin = {}, target = {}) {
    return Math.atan2(
        finite(target.y) - finite(origin.y),
        finite(target.x) - finite(origin.x),
    ) * 180 / Math.PI;
}

function pointAtAngle(origin = {}, angle = 0, distance = 0) {
    const radians = finite(angle) * Math.PI / 180;
    return {
        x: finite(origin.x) + Math.cos(radians) * distance,
        y: finite(origin.y) + Math.sin(radians) * distance,
    };
}

function shortestAngleDelta(a = 0, b = 0) {
    return ((finite(a) - finite(b) + 540) % 360) - 180;
}

function safeTriggerPlacementForDisplayFit({
    origin = null,
    pointer = null,
    config = {},
    items = [],
    displays = [],
} = {}) {
    if (!origin || !pointer || config.orientation !== 'trigger-vector' || !Array.isArray(items) || !items.length) {
        return { pointer, config };
    }
    const activeDisplay = findDisplayForPoint(displays, origin.x, origin.y)
        || displays.find((display) => visibleBounds(display))
        || null;
    const bounds = visibleBounds(activeDisplay);
    if (!bounds) return { pointer, config };
    const width = Number(bounds.w ?? bounds.width);
    const height = Number(bounds.h ?? bounds.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { pointer, config };
    }

    const basis = Math.max(1, finite(config.radiusBasis, 1));
    const currentItemRadiusPx = finite(config.itemRadiusPx, 0);
    const minItemRadiusPx = Math.min(
        currentItemRadiusPx,
        Math.max(
            32,
            finite(config.itemHitRadiusPx, 0) + 4,
            finite(config.itemVisualRadiusPx, 0) + 8,
        ),
    );
    const margin = Math.max(
        24,
        finite(config.itemVisualRadiusPx, 0) + 12,
        finite(config.itemHitRadiusPx, 0) + 12,
    );
    const desiredAngle = angleFrom(origin, pointer);
    const desiredDistance = Math.max(
        finite(config.deadZoneRadiusPx, 0) + 1,
        distanceBetween(origin, pointer),
    );

    function overflowFor(center = null) {
        if (!center) return Number.POSITIVE_INFINITY;
        const left = (bounds.x + margin) - center.x;
        const right = center.x - (bounds.x + width - margin);
        const top = (bounds.y + margin) - center.y;
        const bottom = center.y - (bounds.y + height - margin);
        return Math.max(0, left, right) + Math.max(0, top, bottom);
    }

    function bestPlacementForRadius(radiusPx) {
        const nextConfig = {
            ...config,
            itemRadius: radiusPx / basis,
        };
        let best = null;
        for (let delta = 0; delta <= 180; delta += 1) {
            const angles = delta === 0
                ? [desiredAngle]
                : [desiredAngle + delta, desiredAngle - delta];
            for (const angle of angles) {
                const previewItems = resolveRadialGestureItems(items, nextConfig, {
                    origin,
                    triggerAngle: angle,
                });
                const overflow = previewItems.reduce((sum, item) => sum + overflowFor(item?.center || null), 0);
                const candidate = {
                    overflow,
                    radiusPx,
                    angle,
                    pointer: pointAtAngle(origin, angle, desiredDistance),
                    config: nextConfig,
                };
                if (!best
                    || candidate.overflow < best.overflow
                    || (candidate.overflow === best.overflow && candidate.radiusPx > best.radiusPx)
                    || (candidate.overflow === best.overflow && candidate.radiusPx === best.radiusPx && Math.abs(shortestAngleDelta(candidate.angle, desiredAngle)) < Math.abs(shortestAngleDelta(best.angle, desiredAngle)))
                ) {
                    best = candidate;
                }
                if (overflow === 0) return candidate;
            }
        }
        return best;
    }

    for (let radiusPx = Math.floor(currentItemRadiusPx); radiusPx >= Math.ceil(minItemRadiusPx); radiusPx -= 1) {
        const placement = bestPlacementForRadius(radiusPx);
        if (placement?.overflow === 0) return { pointer: placement.pointer, config: placement.config };
    }

    const fallback = bestPlacementForRadius(Math.max(Math.ceil(minItemRadiusPx), Math.floor(currentItemRadiusPx)));
    if (fallback && Number.isFinite(fallback.overflow)) {
        return { pointer: fallback.pointer, config: fallback.config };
    }

    return { pointer, config };
}

function configFromState(state) {
    const source = state.radialGestureMenu && typeof state.radialGestureMenu === 'object'
        ? state.radialGestureMenu
        : {};
    const radial = normalizeSigilRadialGestureMenu(source);
    const sourceHasRadiusBasis = Object.prototype.hasOwnProperty.call(source, 'radiusBasis');
    const cameraAvailable = state.annotationReticle?.camera_available
        || state.annotationReticle?.cameraAvailable
        || state.annotationReticle?.live_anchor_count > 0;
    const items = radial.items.filter((item) => {
        if (!item?.requiresLiveAnnotationAnchors) return true;
        return !!cameraAvailable;
    });
    return {
        ...DEFAULT_CONFIG,
        ...radial,
        items,
        radiusBasis: sourceHasRadiusBasis
            ? numberOr(radial.radiusBasis, DEFAULT_CONFIG.radiusBasis)
            : numberOr(state.avatarHitRadius, numberOr(radial.radiusBasis, DEFAULT_CONFIG.radiusBasis)),
    };
}

function openAnimationForSnapshot(snapshot = {}) {
    const config = snapshot?.visuals?.openAnimation || {};
    const durationMs = Math.max(
        0,
        Number.isFinite(Number(config.durationMs ?? config.duration_ms))
            ? Number(config.durationMs ?? config.duration_ms)
            : 333,
    );
    return {
        ...config,
        trigger: config.trigger || 'radial-start',
        durationMs,
        easing: config.easing || 'easeOutCubic',
        startedAt: Number.isFinite(Number(snapshot?.globalTime))
            ? Number(snapshot.globalTime)
            : Number.isFinite(Number(snapshot?.state?.globalTime))
                ? Number(snapshot.state.globalTime)
                : 0,
    };
}

export function createSigilRadialGestureMenu({ state, onCommitItem } = {}) {
    let model = null;
    let snapshot = null;
    let activeConfig = null;

    function decorateSnapshot(nextSnapshot) {
        if (!nextSnapshot || typeof nextSnapshot !== 'object') return null;
        const decorated = activeConfig?.visuals
            ? {
                ...nextSnapshot,
                visuals: activeConfig.visuals,
            }
            : { ...nextSnapshot };
        if (nextSnapshot.phase === 'radial') {
            decorated.openAnimation = nextSnapshot.openAnimation || snapshot?.openAnimation || openAnimationForSnapshot(state || {});
        } else if (nextSnapshot.openAnimation) {
            decorated.openAnimation = nextSnapshot.openAnimation;
        }
        return decorated;
    }

    function start(origin, pointer = origin) {
        const nextConfig = activeConfig || configFromState(state || {});
        const fit = safeTriggerPlacementForDisplayFit({
            origin,
            pointer,
            config: nextConfig,
            items: nextConfig.items || [],
            displays: Array.isArray(state?.displays) ? state.displays : [],
        });
        activeConfig = fit.config || nextConfig;
        model = createRadialGestureModel(activeConfig);
        snapshot = decorateSnapshot(model.start(origin, fit.pointer));
        return snapshot;
    }

    function move(pointer) {
        if (!model) return null;
        const priorPhase = snapshot?.phase || 'idle';
        const priorActiveItemId = snapshot?.activeItemId || null;
        const movedSnapshot = decorateSnapshot(model.move(pointer));
        snapshot = movedSnapshot?.lastTransition === 'handoff_fast_travel'
            ? {
                ...movedSnapshot,
                phase: 'radial',
                activeItemId: priorActiveItemId,
                lastTransition: 'radial_handoff_pending_release',
            }
            : movedSnapshot;
        return {
            snapshot,
            priorActiveItemId,
            enteredFastTravel: priorPhase !== 'fastTravel' && snapshot.phase === 'fastTravel',
            reenteredRadial: priorPhase === 'fastTravel' && snapshot.phase === 'radial',
        };
    }

    function release(pointer, context = {}) {
        if (!model) return null;
        snapshot = decorateSnapshot(model.release(pointer));
        if (snapshot.committed?.type === 'item') {
            onCommitItem?.(snapshot.committed.item, snapshot, {
                ...context,
                pointer,
            });
        }
        const result = snapshot;
        model = null;
        activeConfig = null;
        snapshot = null;
        return result;
    }

    function cancel(reason = 'cancelled') {
        if (!model) return null;
        snapshot = decorateSnapshot(model.cancel(reason));
        const result = snapshot;
        model = null;
        activeConfig = null;
        snapshot = null;
        return result;
    }

    function applySnapshot(nextSnapshot) {
        activeConfig = configFromState(state || {});
        snapshot = decorateSnapshot(nextSnapshot && typeof nextSnapshot === 'object' ? nextSnapshot : null);
    }

    function currentSnapshot() {
        return snapshot;
    }

    return {
        start,
        move,
        release,
        cancel,
        applySnapshot,
        snapshot: currentSnapshot,
    };
}
