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

export function createHitTargetController({ runtime, url, size = 80, id = null, idPrefix = 'sigil-hit' }) {
    const hit = {
        id: id || `${idPrefix}-${Math.random().toString(36).slice(2, 8)}`,
        ready: false,
        creating: false,
        interactive: true,
        size,
    };

    async function ensureCreated() {
        if (hit.ready || hit.creating) return hit.id;
        hit.creating = true;
        try {
            await runtime.canvasCreate({
                id: hit.id,
                url: appendQuery(url, { parent: 'avatar-main', id: hit.id }),
                frame: [-1000, -1000, hit.size, hit.size],
                interactive: true,
            });
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

    function sync(center, interactive) {
        if (!hit.ready || !center?.valid) return;
        const nextInteractive = !!interactive;
        const targetCenter = nextInteractive ? center : { x: -10000, y: -10000 };
        const update = {
            id: hit.id,
            frame: frameFor(targetCenter, hit.size),
        };
        if (nextInteractive !== hit.interactive) {
            update.interactive = nextInteractive;
            hit.interactive = nextInteractive;
        }
        runtime.canvasUpdate(update);
    }

    function setSize(size) {
        const nextSize = Math.max(1, Math.round(size));
        if (nextSize === hit.size) return;
        hit.size = nextSize;
    }

    async function remove() {
        if (!hit.ready && !hit.creating) return;
        try {
            await runtime.canvasRemove({ id: hit.id });
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
        setSize,
        remove,
    };
}
