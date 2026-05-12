import { toolkitSpecifier } from './content-roots.js';

const { createDesktopWorldHitRegionController } = await import(toolkitSpecifier('runtime/desktop-world-hit-region.js'));

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function worldRectForCenter(center, size) {
    const half = size / 2;
    return {
        x: finite(center.x) - half,
        y: finite(center.y) - half,
        w: size,
        h: size,
    };
}

function nativeRectFromFrame(frame) {
    if (!Array.isArray(frame) || frame.length < 4) return null;
    const rect = {
        x: finite(frame[0], NaN),
        y: finite(frame[1], NaN),
        w: finite(frame[2], NaN),
        h: finite(frame[3], NaN),
    };
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
    if (rect.w <= 0 || rect.h <= 0) return null;
    return rect;
}

function offscreenFrame(size) {
    const nextSize = Math.max(1, Math.round(finite(size, 1)));
    return [-10000, -10000, nextSize, nextSize];
}

export function createHitTargetController({ runtime, url, size = 80, id = null, idPrefix = 'sigil-hit' }) {
    const initialSize = Math.max(1, Math.round(finite(size, 80)));
    const controller = createDesktopWorldHitRegionController({
        runtime,
        url,
        id,
        idPrefix,
        fallbackOwnerCanvasId: 'avatar-main',
        globalObject: typeof window !== 'undefined' ? window : globalThis,
        initialSize: [initialSize, initialSize],
        windowLevel: 'screen_saver',
    });
    const hit = {
        id: controller.id,
        parent: controller.parent,
        ready: false,
        creating: false,
        interactive: false,
        size: initialSize,
        frame: offscreenFrame(initialSize),
    };

    function syncControllerState() {
        const snapshot = controller.snapshot();
        hit.ready = snapshot.ready;
        hit.creating = snapshot.creating;
        hit.interactive = snapshot.interactive;
        hit.frame = snapshot.frame || offscreenFrame(hit.size);
        hit.parent = snapshot.parent;
    }

    async function ensureCreated() {
        if (hit.ready || hit.creating) return hit.id;
        hit.creating = true;
        try {
            await controller.ensureCreated();
            syncControllerState();
            return hit.id;
        } finally {
            hit.creating = false;
            syncControllerState();
        }
    }

    function syncWorldRect(worldRect, interactive, options = {}) {
        if (!hit.ready) return false;
        const changed = controller.sync({
            worldRect,
            displays: options.displays || [],
            interactive: !!interactive,
        });
        syncControllerState();
        return changed;
    }

    function syncWorldCenter(center, interactive, options = {}) {
        if (!hit.ready) return false;
        if (!center?.valid || !interactive) {
            const changed = controller.disable();
            syncControllerState();
            return changed;
        }
        return syncWorldRect(worldRectForCenter(center, hit.size), true, options);
    }

    function syncFrame(frame, interactive) {
        if (!hit.ready) return false;
        const rect = nativeRectFromFrame(frame);
        if (!rect || !interactive) {
            const changed = controller.disable();
            syncControllerState();
            return changed;
        }
        const changed = controller.sync({
            worldRect: rect,
            displays: [],
            interactive: true,
        });
        syncControllerState();
        return changed;
    }

    function sync(center, interactive, options = {}) {
        return syncWorldCenter(center, interactive, options);
    }

    function setSize(size) {
        const nextSize = Math.max(1, Math.round(finite(size, hit.size)));
        if (nextSize === hit.size) return;
        hit.size = nextSize;
    }

    async function remove() {
        if (!hit.ready && !hit.creating) return;
        try {
            await controller.remove();
        } catch (error) {
            console.warn('[sigil] failed to remove hit target:', error);
        } finally {
            hit.ready = false;
            hit.creating = false;
            hit.interactive = false;
            hit.frame = offscreenFrame(hit.size);
        }
    }

    return {
        hit,
        ensureCreated,
        sync,
        syncWorldCenter,
        syncWorldRect,
        syncFrame,
        setSize,
        remove,
    };
}
