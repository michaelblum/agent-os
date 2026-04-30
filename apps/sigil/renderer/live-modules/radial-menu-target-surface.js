const TOOLKIT_SURFACE_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/interaction-surface.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/interaction-surface.js'
        : '../../../../packages/toolkit/runtime/interaction-surface.js';

const TOOLKIT_SPATIAL_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/spatial.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/spatial.js'
        : '../../../../packages/toolkit/runtime/spatial.js';

const TOOLKIT_SEMANTIC_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/semantic-targets.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/semantic-targets.js'
        : '../../../../packages/toolkit/runtime/semantic-targets.js';

const { createInteractionSurface } = await import(TOOLKIT_SURFACE_SPECIFIER);
const { desktopWorldToNativePoint } = await import(TOOLKIT_SPATIAL_SPECIFIER);
const { normalizeSemanticTarget } = await import(TOOLKIT_SEMANTIC_SPECIFIER);

const DEFAULT_TARGET_MIN_SIZE = 56;
const DEFAULT_FRAME_PADDING = 10;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function appendQuery(url, params) {
    const separator = url.includes('?') ? '&' : '?';
    const query = new URLSearchParams(params).toString();
    return `${url}${separator}${query}`;
}

function sameFrame(a, b) {
    return Array.isArray(a)
        && Array.isArray(b)
        && a.length >= 4
        && b.length >= 4
        && a[0] === b[0]
        && a[1] === b[1]
        && a[2] === b[2]
        && a[3] === b[3];
}

function safeId(value) {
    return String(value || 'item').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function labelForItem(item = {}) {
    return String(item.label || item.title || item.id || 'Radial item');
}

function actionForItem(item = {}) {
    return String(item.action || item.id || 'unknown');
}

function ownerCanvasId() {
    return (
        typeof window !== 'undefined'
        && (window.__aosCanvasId || window.__aosSurfaceCanvasId)
    ) || 'avatar-main';
}

function offscreenFrame(size = [1, 1]) {
    return [-10000, -10000, Math.max(1, Math.round(size[0] || 1)), Math.max(1, Math.round(size[1] || 1))];
}

function normalizeFrame(frame) {
    return frame.slice(0, 4).map((value) => Math.round(finite(value, 0)));
}

export function radialMenuTargetsFromSnapshot(snapshot, options = {}) {
    if (!snapshot || snapshot.phase !== 'radial' || !Array.isArray(snapshot.items)) return [];
    const minSize = Math.max(1, finite(options.targetMinSize, DEFAULT_TARGET_MIN_SIZE));
    return snapshot.items
        .filter((item) => item?.id && item?.center)
        .map((item) => {
            const x = finite(item.center.x, NaN);
            const y = finite(item.center.y, NaN);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const modelRadius = Math.max(
                finite(item.hitRadius, 0),
                finite(item.visualRadius, 0),
                minSize / 2
            );
            const size = Math.max(minSize, Math.ceil(modelRadius * 2));
            const id = String(item.id);
            const label = labelForItem(item);
            const action = actionForItem(item);
            const semantic = normalizeSemanticTarget({
                id,
                role: 'AXButton',
                name: label,
                action,
                aosRef: `sigil-radial-item-${safeId(id)}`,
                surface: options.surfaceId,
                parentCanvasId: options.parentCanvasId,
                current: snapshot.activeItemId === item.id,
            });
            return {
                id,
                label,
                action,
                role: 'AXButton',
                name: semantic.name,
                ariaLabel: semantic.name,
                aosRef: semantic.aosRef,
                surface: semantic.surface,
                active: snapshot.activeItemId === item.id,
                center: { x, y },
                angle: finite(item.angle, 0),
                size,
                radius: size / 2,
            };
        })
        .filter(Boolean);
}

export function radialMenuWorldRect(targets = [], options = {}) {
    if (!Array.isArray(targets) || targets.length === 0) return null;
    const padding = Math.max(0, finite(options.padding, DEFAULT_FRAME_PADDING));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const target of targets) {
        const radius = finite(target.radius, finite(target.size, DEFAULT_TARGET_MIN_SIZE) / 2);
        minX = Math.min(minX, target.center.x - radius);
        minY = Math.min(minY, target.center.y - radius);
        maxX = Math.max(maxX, target.center.x + radius);
        maxY = Math.max(maxY, target.center.y + radius);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
    return {
        x: Math.floor(minX - padding),
        y: Math.floor(minY - padding),
        w: Math.ceil((maxX - minX) + padding * 2),
        h: Math.ceil((maxY - minY) + padding * 2),
    };
}

function localizeTargets(targets, worldRect) {
    return targets.map((target) => ({
        ...target,
        x: Math.round(target.center.x - worldRect.x),
        y: Math.round(target.center.y - worldRect.y),
        size: Math.round(target.size),
        radius: Math.round(target.radius),
    }));
}

function payloadKey(payload) {
    return JSON.stringify({
        phase: payload.phase,
        activeItemId: payload.activeItemId,
        bounds: payload.bounds,
        items: payload.items.map((item) => [
            item.id,
            item.label,
            item.name,
            item.action,
            item.ariaLabel,
            item.aosRef,
            item.active,
            item.x,
            item.y,
            item.size,
        ]),
    });
}

function postCanvasMessage(runtime, target, message) {
    if (typeof runtime?.post === 'function') {
        runtime.post('canvas.send', { target, message });
    }
}

export function createRadialMenuTargetSurface({
    runtime,
    url,
    id = null,
    idPrefix = 'sigil-radial-menu',
    targetMinSize = DEFAULT_TARGET_MIN_SIZE,
    framePadding = DEFAULT_FRAME_PADDING,
} = {}) {
    if (!runtime) throw new Error('RadialMenuTargetSurface requires runtime');
    if (!url) throw new Error('RadialMenuTargetSurface requires url');

    const parent = ownerCanvasId();
    const surfaceId = id || `${idPrefix}-${Math.random().toString(36).slice(2, 8)}`;
    const state = {
        id: surfaceId,
        parent,
        ready: false,
        creating: false,
        interactive: false,
        frame: offscreenFrame([1, 1]),
        targets: [],
        lastPayloadKey: null,
        pendingSnapshot: null,
        pendingDisplays: [],
    };
    const surface = createInteractionSurface({
        runtime,
        id: surfaceId,
        url: appendQuery(url, { parent, id: surfaceId }),
        parent,
        frame: state.frame,
        interactive: false,
        windowLevel: 'screen_saver',
    });

    async function ensureCreated() {
        if (state.ready || state.creating) return state.id;
        state.creating = true;
        try {
            await surface.ensureCreated();
            state.ready = true;
            return state.id;
        } catch (error) {
            if (String(error?.message || error).includes('DUPLICATE')) {
                state.ready = true;
                return state.id;
            }
            throw error;
        } finally {
            state.creating = false;
        }
    }

    function sendUpdate(payload) {
        const key = payloadKey(payload);
        if (key === state.lastPayloadKey) return;
        state.lastPayloadKey = key;
        postCanvasMessage(runtime, state.id, {
            type: 'radial_menu.surface.update',
            payload,
        });
    }

    function applySnapshot(snapshot, displays = []) {
        if (!state.ready) return false;
        const targets = radialMenuTargetsFromSnapshot(snapshot, {
            targetMinSize,
            surfaceId: state.id,
            parentCanvasId: state.parent,
        });
        if (targets.length === 0) {
            if (state.interactive) {
                const disabledFrame = offscreenFrame([state.frame[2], state.frame[3]]);
                surface.setPlacement(disabledFrame, false);
                state.frame = disabledFrame;
                state.interactive = false;
                state.targets = [];
            }
            sendUpdate({
                phase: snapshot?.phase || 'idle',
                activeItemId: null,
                bounds: { x: 0, y: 0, w: 1, h: 1 },
                items: [],
            });
            return false;
        }

        const worldRect = radialMenuWorldRect(targets, { padding: framePadding });
        if (!worldRect) return false;
        const nativeOrigin = desktopWorldToNativePoint({ x: worldRect.x, y: worldRect.y }, displays) || { x: worldRect.x, y: worldRect.y };
        const frame = normalizeFrame([nativeOrigin.x, nativeOrigin.y, worldRect.w, worldRect.h]);
        if (!sameFrame(frame, state.frame) || !state.interactive) {
            surface.setPlacement(frame, true);
            state.frame = frame;
            state.interactive = true;
        }
        state.targets = localizeTargets(targets, worldRect);
        sendUpdate({
            phase: snapshot.phase,
            activeItemId: snapshot.activeItemId || null,
            bounds: {
                x: 0,
                y: 0,
                w: frame[2],
                h: frame[3],
                worldX: worldRect.x,
                worldY: worldRect.y,
            },
            items: state.targets,
        });
        return true;
    }

    function sync(snapshot, options = {}) {
        state.pendingSnapshot = snapshot || null;
        state.pendingDisplays = Array.isArray(options.displays) ? options.displays : [];
        if (!state.ready) {
            void ensureCreated()
                .then(() => applySnapshot(state.pendingSnapshot, state.pendingDisplays))
                .catch((error) => {
                    console.warn('[sigil] radial menu target surface create failed:', error);
                });
            return false;
        }
        return applySnapshot(state.pendingSnapshot, state.pendingDisplays);
    }

    function disable() {
        state.pendingSnapshot = null;
        if (!state.ready) return false;
        return applySnapshot(null, state.pendingDisplays);
    }

    async function remove() {
        if (!state.ready && !state.creating) return;
        try {
            await surface.remove();
        } finally {
            state.ready = false;
            state.creating = false;
            state.interactive = false;
            state.targets = [];
            state.frame = offscreenFrame([1, 1]);
        }
    }

    function snapshot() {
        return {
            id: state.id,
            parent: state.parent,
            ready: state.ready,
            creating: state.creating,
            interactive: state.interactive,
            frame: [...state.frame],
            targets: state.targets.map((target) => ({
                id: target.id,
                label: target.label,
                action: target.action,
                active: target.active,
                x: target.x,
                y: target.y,
                size: target.size,
            })),
        };
    }

    return {
        id: state.id,
        ensureCreated,
        sync,
        disable,
        remove,
        snapshot,
    };
}
