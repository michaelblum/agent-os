function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, finite(value, 0)));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function durationMs(block) {
    if (!isPlainObject(block)) return 0;
    return Math.max(0, finite(block.duration_ms, 0));
}

function easeInOut(progress) {
    const p = clamp01(progress);
    return p < 0.5
        ? 4 * p * p * p
        : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function fadeOpacity(fade, progress, fallbackFrom = 1, fallbackTo = 1) {
    const source = isPlainObject(fade) ? fade : {};
    const from = finite(source.from, fallbackFrom);
    const to = finite(source.to, fallbackTo);
    return from + ((to - from) * progress);
}

function dissolveOpacity(enabled, progress) {
    if (!enabled) return 1;
    const p = clamp01((progress - 0.62) / 0.38);
    const eased = p * p * (3 - (2 * p));
    return 1 - eased;
}

export function radialActivationTransitionDuration(transition = {}) {
    return Math.max(
        0,
        durationMs(transition.item),
        durationMs(transition.menu),
        durationMs(transition.surface),
        durationMs(transition.cancel),
    );
}

export function transitionRadialSnapshot(snapshot = {}) {
    const committed = snapshot?.committed || {};
    const itemId = committed.itemId || committed.item?.id || snapshot?.activeItemId || null;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const item = committed.item || items.find((candidate) => candidate.id === itemId) || null;
    return {
        ...cloneJson(snapshot),
        phase: 'radial',
        activeItemId: itemId,
        pointer: item?.center ? cloneJson(item.center) : cloneJson(snapshot?.pointer),
        menuProgress: 1,
        handoffProgress: 0,
        committed: null,
        cancelReason: null,
    };
}

export function radialActivationTransitionFrame(record = {}, nowSeconds = 0) {
    const transition = record.activation?.transition;
    if (!transition) return null;
    const duration = Math.max(1, finite(record.duration_ms, radialActivationTransitionDuration(transition)));
    const elapsed = Math.max(0, (finite(nowSeconds, 0) - finite(record.started_at, 0)) * 1000);
    const progress = clamp01(elapsed / duration);
    const eased = easeInOut(progress);
    const item = transition.item || {};
    const menu = transition.menu || {};
    const surface = transition.surface || {};
    return {
        active: progress < 1,
        completed: progress >= 1,
        activation_id: record.activation?.id || null,
        item_id: record.item_id || null,
        preset: transition.preset || null,
        progress,
        eased,
        elapsed_ms: elapsed,
        duration_ms: duration,
        radial: cloneJson(record.radial),
        item: {
            ...cloneJson(item),
            progress,
            eased,
            opacity: dissolveOpacity(item.dissolve, progress) * fadeOpacity(item.fade, eased, 1, 1),
        },
        menu: {
            ...cloneJson(menu),
            progress,
            eased,
            opacity: fadeOpacity(menu.fade, eased, 1, 1),
        },
        surface: {
            ...cloneJson(surface),
            progress,
            eased,
            opacity: fadeOpacity(surface.opacity, eased, 0, 1),
        },
    };
}

export function createRadialActivationTransitionController({ now = () => 0 } = {}) {
    let record = null;

    function start(activation = {}, snapshot = {}, options = {}) {
        if (!activation?.transition) {
            record = null;
            return null;
        }
        const radial = transitionRadialSnapshot(snapshot);
        const itemId = radial.activeItemId || activation.item?.id || null;
        record = {
            activation: cloneJson(activation),
            radial,
            item_id: itemId,
            started_at: finite(options.startedAt, now()),
            duration_ms: Math.max(
                1,
                finite(options.durationMs, radialActivationTransitionDuration(activation.transition)),
            ),
        };
        return radialActivationTransitionFrame(record, record.started_at);
    }

    function tick(nextNow = now()) {
        if (!record) return null;
        return radialActivationTransitionFrame(record, nextNow);
    }

    function clear() {
        record = null;
    }

    function active() {
        return !!record;
    }

    function snapshot() {
        return record ? cloneJson(record) : null;
    }

    return {
        start,
        tick,
        clear,
        active,
        snapshot,
    };
}
