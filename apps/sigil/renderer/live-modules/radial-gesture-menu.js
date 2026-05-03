import { createRadialGestureModel } from './radial-gesture-runtime.js';
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

function configFromState(state) {
    const source = state.radialGestureMenu && typeof state.radialGestureMenu === 'object'
        ? state.radialGestureMenu
        : {};
    const radial = normalizeSigilRadialGestureMenu(source);
    return {
        ...DEFAULT_CONFIG,
        ...radial,
        radiusBasis: numberOr(radial.radiusBasis, numberOr(state.avatarHitRadius, DEFAULT_CONFIG.radiusBasis)),
    };
}

export function createSigilRadialGestureMenu({ state, onCommitItem } = {}) {
    let model = null;
    let snapshot = null;
    let activeConfig = null;

    function ensureModel() {
        activeConfig = configFromState(state || {});
        model = createRadialGestureModel(activeConfig);
        return model;
    }

    function decorateSnapshot(nextSnapshot) {
        if (!nextSnapshot || typeof nextSnapshot !== 'object') return null;
        if (!activeConfig?.visuals) return nextSnapshot;
        return {
            ...nextSnapshot,
            visuals: activeConfig.visuals,
        };
    }

    function start(origin, pointer = origin) {
        snapshot = decorateSnapshot(ensureModel().start(origin, pointer));
        return snapshot;
    }

    function move(pointer) {
        if (!model) return null;
        const priorPhase = snapshot?.phase || 'idle';
        snapshot = decorateSnapshot(model.move(pointer));
        return {
            snapshot,
            enteredFastTravel: priorPhase !== 'fastTravel' && snapshot.phase === 'fastTravel',
            reenteredRadial: priorPhase === 'fastTravel' && snapshot.phase === 'radial',
        };
    }

    function release(pointer) {
        if (!model) return null;
        snapshot = decorateSnapshot(model.release(pointer));
        if (snapshot.committed?.type === 'item') {
            onCommitItem?.(snapshot.committed.item, snapshot);
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
