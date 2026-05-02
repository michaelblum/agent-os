export const PRESSURE_PRESETS = Object.freeze([
    { id: 'unknown', label: 'Unknown', mode: 'unknown', usedRatio: 0 },
    { id: 'low', label: '20%', mode: 'ratio', usedRatio: 0.2 },
    { id: 'middle', label: '50%', mode: 'ratio', usedRatio: 0.5 },
    { id: 'high', label: '80%', mode: 'ratio', usedRatio: 0.8 },
    { id: 'near-full', label: '95%', mode: 'ratio', usedRatio: 0.95 },
]);

export const LIFECYCLE_EVENTS = Object.freeze([
    'context_compaction_started',
    'context_compacted',
    'handoff_started',
    'handoff_completed',
]);

export const DEFAULT_LAB_STATE = Object.freeze({
    provider: 'codex',
    sessionId: 'session-vitality-lab',
    mode: 'ratio',
    usedRatio: 0.5,
    usedTokens: 50000,
    windowTokens: 100000,
    precision: 'exact',
    delivery: 'agent-terminal',
    targetCanvasId: 'avatar-main',
    terminalCanvasId: 'sigil-codex-terminal',
});

export function clampRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}

export function clampTokenCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.round(number));
}

export function normalizeLabState(input = {}) {
    const usedRatio = clampRatio(input.usedRatio ?? input.used_ratio ?? DEFAULT_LAB_STATE.usedRatio);
    let windowTokens = clampTokenCount(input.windowTokens ?? input.window_tokens ?? DEFAULT_LAB_STATE.windowTokens);
    let usedTokens = clampTokenCount(input.usedTokens ?? input.used_tokens ?? DEFAULT_LAB_STATE.usedTokens);
    if (windowTokens <= 0) windowTokens = DEFAULT_LAB_STATE.windowTokens;
    usedTokens = Math.min(usedTokens, windowTokens);

    return {
        ...DEFAULT_LAB_STATE,
        ...input,
        provider: String(input.provider || DEFAULT_LAB_STATE.provider),
        sessionId: String(input.sessionId || input.session_id || DEFAULT_LAB_STATE.sessionId),
        mode: String(input.mode || DEFAULT_LAB_STATE.mode),
        usedRatio,
        usedTokens,
        windowTokens,
        precision: normalizePrecision(input.precision || DEFAULT_LAB_STATE.precision),
        delivery: String(input.delivery || DEFAULT_LAB_STATE.delivery),
        targetCanvasId: String(input.targetCanvasId || input.target_canvas_id || DEFAULT_LAB_STATE.targetCanvasId),
        terminalCanvasId: String(input.terminalCanvasId || input.terminal_canvas_id || DEFAULT_LAB_STATE.terminalCanvasId),
    };
}

export function makeMetric(value, unit, state = {}) {
    const normalized = normalizeLabState(state);
    return {
        value,
        unit,
        source: {
            kind: 'manual_fixture',
            provider_surface: 'sigil-session-vitality-lab',
            stability: 'synthetic',
            precision: normalized.precision,
        },
    };
}

export function makeTelemetry(input = {}, observedAt = new Date().toISOString()) {
    const state = normalizeLabState(input);
    const context = {};
    const usedRatio = clampRatio(state.usedRatio);
    const remainingRatio = clampRatio(1 - usedRatio);

    if (state.mode === 'ratio') {
        context.used_ratio = makeMetric(usedRatio, 'ratio', state);
        context.remaining_ratio = makeMetric(remainingRatio, 'ratio', state);
    } else if (state.mode === 'used_ratio') {
        context.used_ratio = makeMetric(usedRatio, 'ratio', state);
    } else if (state.mode === 'remaining_ratio') {
        context.remaining_ratio = makeMetric(remainingRatio, 'ratio', state);
    } else if (state.mode === 'tokens') {
        context.used_tokens = makeMetric(state.usedTokens, 'tokens', state);
        context.window_tokens = makeMetric(state.windowTokens, 'tokens', state);
    }

    return {
        type: 'agent.session.telemetry',
        provider: state.provider,
        session_id: state.sessionId,
        observed_at: observedAt,
        context,
        diagnostics: [],
    };
}

export function makeLifecycleEvent(event, input = {}, observedAt = new Date().toISOString()) {
    const state = normalizeLabState(input);
    return {
        type: 'agent.session.lifecycle',
        provider: state.provider,
        session_id: state.sessionId,
        observed_at: observedAt,
        event,
        source: {
            kind: 'manual_fixture',
            provider_surface: 'sigil-session-vitality-lab',
            stability: 'synthetic',
            precision: 'exact',
        },
    };
}

export function makeTelemetryDelivery(input = {}, telemetry = makeTelemetry(input)) {
    const state = normalizeLabState(input);
    if (state.delivery === 'direct') {
        return {
            target: state.targetCanvasId,
            message: telemetry,
        };
    }
    return {
        target: state.targetCanvasId,
        message: {
            type: 'canvas_message',
            id: state.terminalCanvasId,
            payload: {
                type: 'agent_terminal.session_telemetry',
                payload: { telemetry },
            },
        },
    };
}

export function makeLifecycleDelivery(input = {}, event = makeLifecycleEvent('context_compacted', input)) {
    const state = normalizeLabState(input);
    if (state.delivery === 'direct') {
        return {
            target: state.targetCanvasId,
            message: event,
        };
    }
    return {
        target: state.targetCanvasId,
        message: {
            type: 'canvas_message',
            id: state.terminalCanvasId,
            payload: {
                type: 'agent_terminal.session_telemetry',
                payload: { lifecycle_events: [event] },
            },
        },
    };
}

export function summarizeSessionVitality(snapshot) {
    const factors = snapshot?.factors || snapshot || {};
    return {
        confidence: finiteOrNull(factors.confidence),
        pressure: finiteOrNull(factors.pressure),
        usedRatio: finiteOrNull(factors.usedRatio),
        remainingRatio: finiteOrNull(factors.remainingRatio),
        auraReachMultiplier: finiteOrNull(factors.auraReachMultiplier),
        auraIntensityMultiplier: finiteOrNull(factors.auraIntensityMultiplier),
        rotationMultiplier: finiteOrNull(factors.rotationMultiplier),
        brightnessMultiplier: finiteOrNull(factors.brightnessMultiplier),
        flickerAmount: finiteOrNull(factors.flickerAmount),
        scaleMultiplier: finiteOrNull(factors.scaleMultiplier),
        refreshProgress: finiteOrNull(factors.refreshProgress),
    };
}

function normalizePrecision(value) {
    return ['exact', 'derived', 'estimated'].includes(value) ? value : 'exact';
}

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
