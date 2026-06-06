const DEFAULT_WINDOW_MS = 1000;
const PANEL_PREFIX = 'sigil.avatar_panel.';

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function currentWindowObject() {
    return typeof window !== 'undefined' ? window : null;
}

function urlProbeEnabled(windowObject = currentWindowObject()) {
    try {
        const params = new URLSearchParams(windowObject?.location?.search || '');
        return params.get('aos-surface-transport-probe') === '1'
            || params.get('AOS_SURFACE_TRANSPORT_PROBE') === '1';
    } catch {
        return false;
    }
}

function initialEnabled(windowObject = currentWindowObject()) {
    return Boolean(windowObject?.__aosSurfaceTransportProbeEnabled) || urlProbeEnabled(windowObject);
}

function increment(map, key, amount = 1) {
    const id = String(key || 'unknown');
    map[id] = (map[id] || 0) + amount;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function panelBucket(type) {
    const raw = String(type || 'unknown');
    if (raw === 'sigil.avatar_panel.control_change') return 'control_change';
    if (raw === 'sigil.avatar_panel.snapshot') return 'snapshot';
    if (raw === 'sigil.avatar_panel.update') return 'update';
    if (raw.startsWith(PANEL_PREFIX)) return raw.slice(PANEL_PREFIX.length) || 'other';
    return 'other';
}

function summarizeWindow(events, endedAt = nowMs(), windowMs = DEFAULT_WINDOW_MS) {
    const startedAt = endedAt - windowMs;
    const visible = events.filter((event) => event.at >= startedAt && event.at <= endedAt);
    const byKind = {};
    const byCanvas = {};
    for (const event of visible) {
        increment(byKind, event.kind);
        if (event.canvasId) increment(byCanvas, event.canvasId);
    }
    return {
        window_ms: windowMs,
        started_at_ms: startedAt,
        ended_at_ms: endedAt,
        total: visible.length,
        rate_per_second: visible.length / (windowMs / 1000),
        by_kind: byKind,
        by_canvas: byCanvas,
    };
}

export function createSurfaceTransportProbe({
    windowObject = currentWindowObject(),
    label = 'surface-transport',
} = {}) {
    let enabled = initialEnabled(windowObject);
    const state = {
        label,
        enabled,
        started_at_ms: nowMs(),
        marks: {},
        panel_messages: {
            sent: {},
            received: {},
        },
        in_heap: {
            writes: 0,
            applied: 0,
        },
        render: {
            frames: 0,
            work: {
                structural: 0,
                overlay: 0,
                publishState: 0,
                visualOnly: 0,
            },
            overlay_draws: 0,
            desktop_world_publish_state_calls: 0,
            hit_target_sync_calls: 0,
            hit_target_sync_changes: 0,
            input_region_sync_calls: 0,
            input_region_sync_changes: 0,
        },
        input_events: [],
    };

    function active() {
        return enabled === true;
    }

    function mark(name, payload = {}) {
        if (!active()) return;
        state.marks[name] = {
            at_ms: nowMs(),
            ...payload,
        };
    }

    function recordPanelMessage(direction, type) {
        if (!active()) return;
        const bucket = panelBucket(type);
        const target = direction === 'received' ? state.panel_messages.received : state.panel_messages.sent;
        increment(target, bucket);
        if (!['control_change', 'snapshot', 'update'].includes(bucket) && bucket !== 'other') {
            increment(target, 'other_avatar_panel');
        }
    }

    function recordRenderFrame(work = {}) {
        if (!active()) return;
        state.render.frames += 1;
        for (const key of ['structural', 'overlay', 'publishState', 'visualOnly']) {
            if (work[key]) state.render.work[key] += 1;
        }
    }

    function recordRenderEmit(kind, changed = undefined) {
        if (!active()) return;
        if (kind === 'overlay.draw') state.render.overlay_draws += 1;
        if (kind === 'desktopWorldSurface.publishState') state.render.desktop_world_publish_state_calls += 1;
        if (kind === 'hitTarget.sync') {
            state.render.hit_target_sync_calls += 1;
            if (changed) state.render.hit_target_sync_changes += 1;
        }
        if (kind === 'input_region.sync') {
            state.render.input_region_sync_calls += 1;
            if (changed) state.render.input_region_sync_changes += 1;
        }
    }

    /**
     * Record an in-heap store propagation event for the co-located probe.
     * @param {'write'|'applied'} direction
     */
    function recordInHeapPropagation(direction) {
        if (!active()) return;
        if (direction === 'write') state.in_heap.writes += 1;
        else if (direction === 'applied') state.in_heap.applied += 1;
    }

    function recordInputEvent(event = {}) {
        if (!active()) return;
        state.input_events.push({
            at: nowMs(),
            kind: event.kind || event.type || event.envelope_type || 'unknown',
            canvasId: event.canvas_id || event.canvasId || event.id || null,
        });
        if (state.input_events.length > 5000) {
            state.input_events.splice(0, state.input_events.length - 5000);
        }
    }

    function reset() {
        state.started_at_ms = nowMs();
        state.marks = {};
        state.panel_messages = { sent: {}, received: {} };
        state.in_heap = { writes: 0, applied: 0 };
        state.render = {
            frames: 0,
            work: {
                structural: 0,
                overlay: 0,
                publishState: 0,
                visualOnly: 0,
            },
            overlay_draws: 0,
            desktop_world_publish_state_calls: 0,
            hit_target_sync_calls: 0,
            hit_target_sync_changes: 0,
            input_region_sync_calls: 0,
            input_region_sync_changes: 0,
        };
        state.input_events = [];
    }

    function setEnabled(next = true) {
        enabled = next !== false;
        state.enabled = enabled;
        if (windowObject) windowObject.__aosSurfaceTransportProbeEnabled = enabled;
        return enabled;
    }

    function snapshot(options = {}) {
        const endedAt = nowMs();
        return {
            ...clone(state),
            enabled,
            elapsed_ms: endedAt - state.started_at_ms,
            recent_input_events: summarizeWindow(state.input_events, endedAt, options.windowMs || DEFAULT_WINDOW_MS),
        };
    }

    return {
        get enabled() {
            return enabled;
        },
        setEnabled,
        reset,
        mark,
        recordPanelMessage,
        recordRenderFrame,
        recordRenderEmit,
        recordInHeapPropagation,
        recordInputEvent,
        snapshot,
    };
}
