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

const { createInteractionSurface } = await import(TOOLKIT_SURFACE_SPECIFIER);

function frameFor(center, size) {
    const half = size / 2;
    return [
        Math.round(center.x - half),
        Math.round(center.y - half),
        size,
        size,
    ];
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

export function createHitTargetController({ runtime, url, size = 80, id = null, idPrefix = 'sigil-hit' }) {
    const hitId = id || `${idPrefix}-${Math.random().toString(36).slice(2, 8)}`;
    const ownerCanvasId = (
        typeof window !== 'undefined'
        && (window.__aosCanvasId || window.__aosSurfaceCanvasId)
    ) || 'avatar-main';
    const hit = {
        id: hitId,
        ready: false,
        creating: false,
        interactive: true,
        size,
        frame: [-1000, -1000, size, size],
    };
    const surface = createInteractionSurface({
        runtime,
        id: hit.id,
        url: appendQuery(url, { parent: ownerCanvasId, id: hit.id }),
        parent: ownerCanvasId,
        frame: hit.frame,
        interactive: true,
        windowLevel: 'screen_saver',
    });

    async function ensureCreated() {
        if (hit.ready || hit.creating) return hit.id;
        hit.creating = true;
        try {
            await surface.ensureCreated();
            hit.ready = true;
            return hit.id;
        } catch (error) {
            if (String(error?.message || error).includes('DUPLICATE')) {
                hit.ready = true;
                return hit.id;
            }
            throw error;
        } finally {
            hit.creating = false;
        }
    }

    function syncFrame(frame, interactive) {
        if (!hit.ready || !Array.isArray(frame) || frame.length < 4) return;
        const nextFrame = frame.map((value) => Math.round(Number(value) || 0));
        const nextInteractive = !!interactive;
        const targetFrame = nextInteractive ? nextFrame : [-10000, -10000, hit.size, hit.size];
        if (sameFrame(hit.frame, targetFrame) && hit.interactive === nextInteractive) return;
        surface.setPlacement(targetFrame, nextInteractive);
        hit.frame = targetFrame;
        hit.interactive = nextInteractive;
    }

    function sync(center, interactive) {
        if (!hit.ready || !center?.valid) return;
        const nextInteractive = !!interactive;
        const targetCenter = nextInteractive ? center : { x: -10000, y: -10000 };
        syncFrame(frameFor(targetCenter, hit.size), nextInteractive);
    }

    function setSize(size) {
        const nextSize = Math.max(1, Math.round(size));
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
        }
    }

    return {
        hit,
        ensureCreated,
        sync,
        syncFrame,
        setSize,
        remove,
    };
}
