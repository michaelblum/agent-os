function nextRequestId() {
    return 'sigil-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

export function createHostRuntime() {
    const handlers = [];
    const pending = new Map();
    let installed = false;

    function resolvePending(msg) {
        if (msg?.type !== 'canvas.response' || !msg.request_id) return;
        const entry = pending.get(msg.request_id);
        if (!entry) return;
        pending.delete(msg.request_id);
        clearTimeout(entry.timer);
        if (msg.status === 'ok') {
            entry.resolve(msg);
            return;
        }
        entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`));
    }

    function dispatch(msg) {
        resolvePending(msg);
        for (const handler of handlers.slice()) {
            try {
                handler(msg);
            } catch (error) {
                console.error('[sigil] host handler failed:', error);
            }
        }
    }

    function install() {
        if (installed) return;
        installed = true;
        window.headsup = window.headsup || {};
        window.headsup.receive = function receive(b64) {
            let msg;
            try {
                msg = JSON.parse(atob(b64));
            } catch (error) {
                console.error('[sigil] host bridge decode failed:', error);
                return;
            }
            dispatch(msg);
        };
    }

    function onMessage(handler) {
        if (typeof handler === 'function') handlers.push(handler);
        install();
        return () => {
            const idx = handlers.indexOf(handler);
            if (idx >= 0) handlers.splice(idx, 1);
        };
    }

    function post(type, payload) {
        install();
        const body = payload === undefined ? { type } : { type, payload };
        window.webkit?.messageHandlers?.headsup?.postMessage(body);
    }

    function subscribe(events, options = {}) {
        const list = Array.isArray(events) ? events : [events];
        const payload = { events: list };
        if (options.snapshot !== undefined) payload.snapshot = !!options.snapshot;
        post('subscribe', payload);
        return () => unsubscribe(list);
    }

    function unsubscribe(events) {
        const list = Array.isArray(events) ? events : [events];
        post('unsubscribe', { events: list });
    }

    function request(type, payload = {}, { timeoutMs = 5000, mapResult = (msg) => msg } = {}) {
        install();
        const request_id = nextRequestId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(request_id);
                reject(new Error(`TIMEOUT: ${type} (${timeoutMs}ms)`));
            }, timeoutMs);
            pending.set(request_id, {
                timer,
                resolve(msg) {
                    resolve(mapResult(msg));
                },
                reject,
            });
            post(type, { ...payload, request_id });
        });
    }

    return {
        install,
        onMessage,
        post,
        subscribe,
        unsubscribe,
        request,
        canvasCreate(opts) {
            return request('canvas.create', opts, {
                mapResult(msg) {
                    return { id: msg.id ?? opts.id };
                },
            });
        },
        canvasUpdate(opts) {
            post('canvas.update', opts);
        },
        canvasRemove(opts = {}) {
            return request('canvas.remove', opts, {
                mapResult() {
                    return undefined;
                },
            });
        },
        positionGet(key, opts = {}) {
            return request('position.get', { key }, {
                timeoutMs: opts.timeoutMs ?? 5000,
                mapResult(msg) {
                    if (!msg.position || typeof msg.position !== 'object') return null;
                    return {
                        x: Number(msg.position.x),
                        y: Number(msg.position.y),
                    };
                },
            });
        },
        positionSet(key, position) {
            if (!position) return;
            post('position.set', { key, x: position.x, y: position.y });
        },
        captureRegion(region, opts = {}) {
            return request('capture.region', {
                ...region,
                format: opts.format ?? 'jpg',
                quality: opts.quality ?? 'med',
                exclude_canvas_ids: opts.excludeCanvasIds ?? [],
            }, {
                timeoutMs: opts.timeoutMs ?? 1500,
                mapResult(msg) {
                    if (typeof msg.base64 !== 'string' || typeof msg.mime_type !== 'string') {
                        throw new Error('capture.region returned no image payload');
                    }
                    return {
                        base64: msg.base64,
                        mimeType: msg.mime_type,
                        region: msg.region ?? region,
                    };
                },
            });
        },
    };
}
