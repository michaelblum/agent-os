import { toolkitSpecifier } from './content-roots.js';

const {
    createSemanticChildTargetSurface,
    projectSemanticChildTargets,
    semanticChildSurfaceOffscreenFrame,
    semanticChildTargetsWorldRect,
} = await import(toolkitSpecifier('runtime/semantic-child-target-surface.js'));
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
            const logical = item.logical && typeof item.logical === 'object'
                ? item.logical
                : {
                    id,
                    label,
                    action,
                    role: item.role || 'menuitem',
                    disabled: !!item.disabled,
                    hidden: !!item.hidden,
                    checked: !!item.checked,
                    current: snapshot.activeItemId === item.id,
                    close_on_select: item.close_on_select !== false,
                };
            const semantic = normalizeSemanticTarget({
                id,
                role: 'AXButton',
                name: label,
                action,
                ref: `sigil-radial-item-${safeId(id)}`,
                surface: options.surfaceId,
                parent_canvas_id: options.parentCanvasId,
                current: snapshot.activeItemId === item.id,
            });
            return {
                id,
                label,
                action,
                role: 'AXButton',
                name: semantic.name,
                ariaLabel: semantic.name,
                ref: semantic.ref,
                surface: semantic.surface,
                active: snapshot.activeItemId === item.id,
                center: { x, y },
                angle: finite(item.angle, 0),
                size,
                radius: size / 2,
                logical,
            };
        })
        .filter(Boolean);
}

export function radialMenuWorldRect(targets = [], options = {}) {
    return semanticChildTargetsWorldRect(targets, {
        padding: Math.max(0, finite(options.padding, DEFAULT_FRAME_PADDING)),
    });
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

    const surface = createSemanticChildTargetSurface({
        runtime,
        url,
        id,
        idPrefix,
        fallbackOwnerCanvasId: 'avatar-main',
        windowLevel: 'screen_saver',
        messageType: 'radial_menu.surface.update',
        returnDisableChange: false,
        resolveTargets: (snapshot, options) => radialMenuTargetsFromSnapshot(snapshot, {
            targetMinSize,
            surfaceId: options.surfaceId,
            parentCanvasId: options.parentCanvasId,
        }),
        resolveWorldRect: (targets) => radialMenuWorldRect(targets, { padding: framePadding }),
        projectTargets: projectSemanticChildTargets,
        buildPayload: ({ input, targets, worldRect }) => ({
            phase: input.phase,
            activeItemId: input.activeItemId || null,
            bounds: {
                x: 0,
                y: 0,
                w: Math.round(worldRect.w),
                h: Math.round(worldRect.h),
                worldX: worldRect.x,
                worldY: worldRect.y,
            },
            items: targets,
        }),
        buildDisabledPayload: (snapshot) => ({
            phase: snapshot?.phase || 'idle',
            activeItemId: null,
            bounds: { x: 0, y: 0, w: 1, h: 1 },
            items: [],
        }),
    });
    const state = {
        id: surface.id,
        parent: surface.parent,
        ready: false,
        creating: false,
        interactive: false,
        frame: semanticChildSurfaceOffscreenFrame([1, 1]),
        targets: [],
        pendingSnapshot: null,
        pendingDisplays: [],
    };

    function syncSurfaceState() {
        const snapshot = surface.snapshot();
        state.ready = snapshot.ready;
        state.creating = snapshot.creating;
        state.interactive = snapshot.interactive;
        state.frame = snapshot.frame || semanticChildSurfaceOffscreenFrame([1, 1]);
        state.targets = snapshot.targets || [];
    }

    async function ensureCreated() {
        if (state.ready || state.creating) return state.id;
        state.creating = true;
        try {
            await surface.ensureCreated();
            syncSurfaceState();
            return state.id;
        } finally {
            state.creating = false;
            syncSurfaceState();
        }
    }

    function sync(snapshot, options = {}) {
        state.pendingSnapshot = snapshot || null;
        state.pendingDisplays = Array.isArray(options.displays) ? options.displays : [];
        if (!state.ready) {
            void ensureCreated()
                .then(() => {
                    surface.sync(state.pendingSnapshot, { displays: state.pendingDisplays });
                    syncSurfaceState();
                })
                .catch((error) => {
                    console.warn('[sigil] radial menu target surface create failed:', error);
                });
            return false;
        }
        const changed = surface.sync(state.pendingSnapshot, { displays: state.pendingDisplays });
        syncSurfaceState();
        return changed;
    }

    function disable() {
        state.pendingSnapshot = null;
        if (!state.ready) return false;
        const changed = surface.sync(null, { displays: state.pendingDisplays });
        syncSurfaceState();
        return changed;
    }

    function refreshPayload() {
        return surface.refreshPayload?.() || false;
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
            state.frame = semanticChildSurfaceOffscreenFrame([1, 1]);
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
