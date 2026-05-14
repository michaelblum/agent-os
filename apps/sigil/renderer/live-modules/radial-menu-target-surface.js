import { toolkitSpecifier } from './content-roots.js';

const { createDesktopWorldHitRegionController } = await import(toolkitSpecifier('runtime/desktop-world-hit-region.js'));
const { normalizeSemanticTarget } = await import(toolkitSpecifier('runtime/semantic-targets.js'));

const DEFAULT_TARGET_MIN_SIZE = 56;
const DEFAULT_FRAME_PADDING = 10;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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

function offscreenFrame(size = [1, 1]) {
    return [-10000, -10000, Math.max(1, Math.round(size[0] || 1)), Math.max(1, Math.round(size[1] || 1))];
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

    const controller = createDesktopWorldHitRegionController({
        runtime,
        url,
        id,
        idPrefix,
        fallbackOwnerCanvasId: 'avatar-main',
        windowLevel: 'screen_saver',
        messageType: 'radial_menu.surface.update',
    });
    const state = {
        id: controller.id,
        parent: controller.parent,
        ready: false,
        creating: false,
        interactive: false,
        frame: offscreenFrame([1, 1]),
        targets: [],
        pendingSnapshot: null,
        pendingDisplays: [],
    };

    function syncControllerState() {
        const snapshot = controller.snapshot();
        state.ready = snapshot.ready;
        state.creating = snapshot.creating;
        state.interactive = snapshot.interactive;
        state.frame = snapshot.frame || offscreenFrame([1, 1]);
    }

    async function ensureCreated() {
        if (state.ready || state.creating) return state.id;
        state.creating = true;
        try {
            await controller.ensureCreated();
            syncControllerState();
            return state.id;
        } finally {
            state.creating = false;
            syncControllerState();
        }
    }

    function applySnapshot(snapshot, displays = []) {
        if (!state.ready) return false;
        const targets = radialMenuTargetsFromSnapshot(snapshot, {
            targetMinSize,
            surfaceId: state.id,
            parentCanvasId: state.parent,
        });
        if (targets.length === 0) {
            state.targets = [];
            const changed = controller.disable({ payload: {
                phase: snapshot?.phase || 'idle',
                activeItemId: null,
                bounds: { x: 0, y: 0, w: 1, h: 1 },
                items: [],
            } });
            syncControllerState();
            return changed && state.interactive;
        }

        const worldRect = radialMenuWorldRect(targets, { padding: framePadding });
        if (!worldRect) return false;
        state.targets = localizeTargets(targets, worldRect);
        const changed = controller.sync({
            worldRect,
            displays,
            interactive: true,
            payload: {
            phase: snapshot.phase,
            activeItemId: snapshot.activeItemId || null,
            bounds: {
                x: 0,
                y: 0,
                w: Math.round(worldRect.w),
                h: Math.round(worldRect.h),
                worldX: worldRect.x,
                worldY: worldRect.y,
            },
            items: state.targets,
            },
        });
        syncControllerState();
        return changed;
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

    function refreshPayload() {
        return controller.refreshPayload?.() || false;
    }

    async function remove() {
        if (!state.ready && !state.creating) return;
        try {
            await controller.remove();
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
        refreshPayload,
        remove,
        snapshot,
    };
}
