import { toolkitSpecifier } from './content-roots.js';

const {
    createSemanticChildTargetSurface,
    semanticChildNativeFrameRect,
    semanticChildSurfaceOffscreenFrame,
    semanticChildWorldRectForCenter,
} = await import(toolkitSpecifier('runtime/semantic-child-target-surface.js'));

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function createHitTargetController({ runtime, url, size = 80, id = null, idPrefix = 'sigil-hit' }) {
    const initialSize = Math.max(1, Math.round(finite(size, 80)));
    const surface = createSemanticChildTargetSurface({
        runtime,
        url,
        id,
        idPrefix,
        fallbackOwnerCanvasId: 'avatar-main',
        globalObject: typeof window !== 'undefined' ? window : globalThis,
        initialSize: [initialSize, initialSize],
        windowLevel: 'screen_saver',
        buildPayload: () => undefined,
    });
    const hit = {
        id: surface.id,
        parent: surface.parent,
        ready: false,
        creating: false,
        interactive: false,
        size: initialSize,
        frame: semanticChildSurfaceOffscreenFrame([initialSize, initialSize]),
    };

    function syncSurfaceState() {
        const snapshot = surface.snapshot();
        hit.ready = snapshot.ready;
        hit.creating = snapshot.creating;
        hit.interactive = snapshot.interactive;
        hit.frame = snapshot.frame || semanticChildSurfaceOffscreenFrame([hit.size, hit.size]);
        hit.parent = snapshot.parent;
    }

    async function ensureCreated() {
        if (hit.ready || hit.creating) return hit.id;
        hit.creating = true;
        try {
            await surface.ensureCreated();
            syncSurfaceState();
            return hit.id;
        } finally {
            hit.creating = false;
            syncSurfaceState();
        }
    }

    function syncWorldRect(worldRect, interactive, options = {}) {
        if (!hit.ready) return false;
        const changed = surface.syncWorldRect(worldRect, {
            displays: options.displays || [],
            interactive: !!interactive,
        });
        syncSurfaceState();
        return changed;
    }

    function syncWorldCenter(center, interactive, options = {}) {
        if (!hit.ready) return false;
        if (!center?.valid || !interactive) {
            const changed = surface.disable();
            syncSurfaceState();
            return changed;
        }
        return syncWorldRect(semanticChildWorldRectForCenter(center, hit.size), true, options);
    }

    function syncFrame(frame, interactive) {
        if (!hit.ready) return false;
        const rect = semanticChildNativeFrameRect(frame);
        if (!rect || !interactive) {
            const changed = surface.disable();
            syncSurfaceState();
            return changed;
        }
        const changed = surface.syncWorldRect(rect, {
            displays: [],
            interactive: true,
        });
        syncSurfaceState();
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
            await surface.remove();
        } catch (error) {
            console.warn('[sigil] failed to remove hit target:', error);
        } finally {
            hit.ready = false;
            hit.creating = false;
            hit.interactive = false;
            hit.frame = semanticChildSurfaceOffscreenFrame([hit.size, hit.size]);
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
