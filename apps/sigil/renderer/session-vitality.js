const DEFAULT_REFRESH_DURATION_MS = 1200;

export const DEFAULT_SESSION_VITALITY_FACTORS = Object.freeze({
    confidence: 0,
    pressure: null,
    usedRatio: null,
    remainingRatio: null,
    auraReachMultiplier: 1,
    auraIntensityMultiplier: 1,
    rotationMultiplier: 1,
    brightnessMultiplier: 1,
    flickerAmount: 0,
    scaleMultiplier: 1,
    refreshProgress: null,
});

function clamp01(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(1, value));
}

function smoothstep(value) {
    const x = clamp01(value);
    if (x == null) return 0;
    return x * x * (3 - (2 * x));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function easeOutBack(value) {
    const x = clamp01(value) ?? 0;
    const c1 = 1.45;
    const c3 = c1 + 1;
    return 1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2));
}

function metricValue(metric) {
    const value = Number(metric?.value);
    return Number.isFinite(value) ? value : null;
}

export function contextRatiosFromTelemetry(telemetry) {
    const context = telemetry?.context;
    if (!context || typeof context !== 'object') {
        return { usedRatio: null, remainingRatio: null, confidence: 0 };
    }

    const usedRatioMetric = context.used_ratio;
    const remainingRatioMetric = context.remaining_ratio;
    let usedRatio = clamp01(metricValue(usedRatioMetric));
    let remainingRatio = clamp01(metricValue(remainingRatioMetric));
    const confidenceMetrics = [];
    if (usedRatio != null) confidenceMetrics.push(usedRatioMetric);
    if (remainingRatio != null) confidenceMetrics.push(remainingRatioMetric);

    const usedTokens = metricValue(context.used_tokens);
    const windowTokens = metricValue(context.window_tokens);
    if (usedRatio == null && usedTokens != null && windowTokens > 0) {
        usedRatio = clamp01(usedTokens / windowTokens);
        confidenceMetrics.push(context.used_tokens, context.window_tokens);
    }
    if (remainingRatio == null && usedRatio != null) {
        remainingRatio = clamp01(1 - usedRatio);
    }
    if (usedRatio == null && remainingRatio != null) {
        usedRatio = clamp01(1 - remainingRatio);
    }

    if (usedRatio == null && remainingRatio == null) {
        return { usedRatio: null, remainingRatio: null, confidence: 0 };
    }

    return {
        usedRatio,
        remainingRatio,
        confidence: sourceConfidence(confidenceMetrics),
    };
}

export function factorsFromTelemetry(telemetry) {
    const ratios = contextRatiosFromTelemetry(telemetry);
    if (ratios.usedRatio == null) return { ...DEFAULT_SESSION_VITALITY_FACTORS };

    const pressure = ratios.usedRatio;
    const pressureCurve = smoothstep((pressure - 0.42) / 0.56);
    const highPressure = smoothstep((pressure - 0.72) / 0.24);

    return {
        confidence: ratios.confidence,
        pressure,
        usedRatio: ratios.usedRatio,
        remainingRatio: ratios.remainingRatio,
        auraReachMultiplier: lerp(1, 0.34, pressureCurve),
        auraIntensityMultiplier: lerp(1, 0.58, highPressure),
        rotationMultiplier: pressure >= 0.97 ? 0 : lerp(1, 0.18, pressureCurve),
        brightnessMultiplier: lerp(1, 0.72, highPressure),
        flickerAmount: lerp(0, 0.24, highPressure),
        scaleMultiplier: 1,
        refreshProgress: null,
    };
}

export function refreshFactors(elapsedMs, durationMs = DEFAULT_REFRESH_DURATION_MS) {
    const progress = clamp01(elapsedMs / durationMs) ?? 1;
    if (progress >= 1) {
        return { active: false, scaleMultiplier: 1, auraReachBoost: 0, progress: 1 };
    }
    if (progress < 0.36) {
        const collapse = smoothstep(progress / 0.36);
        return {
            active: true,
            scaleMultiplier: lerp(1, 0.18, collapse),
            auraReachBoost: lerp(0.15, 0.75, collapse),
            progress,
        };
    }
    const rebound = easeOutBack((progress - 0.36) / 0.64);
    return {
        active: true,
        scaleMultiplier: Math.max(0.18, 0.18 + (rebound * 0.88)),
        auraReachBoost: Math.max(0, lerp(0.75, 0, smoothstep((progress - 0.36) / 0.64))),
        progress,
    };
}

export function createSessionVitalityController(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => performance.now();
    const refreshDurationMs = Math.max(120, Number(options.refreshDurationMs) || DEFAULT_REFRESH_DURATION_MS);
    let telemetry = null;
    let factors = { ...DEFAULT_SESSION_VITALITY_FACTORS };
    let refreshStartedAt = null;
    let lastLifecycleEvent = null;

    function recompute() {
        factors = factorsFromTelemetry(telemetry);
        return factors;
    }

    function applyTelemetry(nextTelemetry) {
        if (nextTelemetry?.type !== 'agent.session.telemetry') return snapshot();
        telemetry = nextTelemetry;
        recompute();
        return snapshot();
    }

    function applyLifecycle(event) {
        if (event?.type !== 'agent.session.lifecycle') return snapshot();
        lastLifecycleEvent = event;
        if (isRefreshLifecycleEvent(event)) {
            refreshStartedAt = now();
        }
        return snapshot();
    }

    function tick(elapsedMs = 0, nowMs = now()) {
        let next = { ...factors };
        if (refreshStartedAt != null) {
            const refresh = refreshFactors(Math.max(0, nowMs - refreshStartedAt), refreshDurationMs);
            if (refresh.active) {
                next = {
                    ...next,
                    auraReachMultiplier: Math.max(next.auraReachMultiplier, next.auraReachMultiplier + refresh.auraReachBoost),
                    brightnessMultiplier: Math.max(next.brightnessMultiplier, 1 + (refresh.auraReachBoost * 0.14)),
                    scaleMultiplier: refresh.scaleMultiplier,
                    refreshProgress: refresh.progress,
                };
            } else {
                refreshStartedAt = null;
            }
        }
        if (next.flickerAmount > 0) {
            const wave = Math.sin(nowMs * 0.037) * Math.sin(nowMs * 0.071 + 0.7);
            next.brightnessMultiplier *= 1 - (next.flickerAmount * Math.max(0, wave));
        }
        return next;
    }

    function snapshot() {
        return {
            telemetry,
            factors: { ...factors },
            refreshing: refreshStartedAt != null,
            lastLifecycleEvent,
        };
    }

    recompute();
    return {
        applyTelemetry,
        applyLifecycle,
        tick,
        snapshot,
    };
}

function isRefreshLifecycleEvent(event) {
    return [
        'context_compaction_started',
        'context_compacted',
        'handoff_started',
        'handoff_completed',
    ].includes(event.event);
}

function sourceConfidence(metrics = []) {
    const presentMetrics = metrics.filter(Boolean);
    if (presentMetrics.some((metric) => metric?.source?.precision === 'estimated')) return 0.55;
    if (presentMetrics.some((metric) => metric?.source?.precision === 'derived')) return 0.78;
    if (presentMetrics.some((metric) => metric?.source?.precision === 'exact')) return 1;
    return 0.65;
}
