const DEFAULT_SELECTION_MODE_EFFECTS = Object.freeze({
    enter: 'supernova',
    exit: 'reverse_supernova',
});
const DEFAULT_SELECTION_MODE_EFFECT_DURATION_MS = 520;
const SELECTION_MODE_EFFECT_DURATIONS_MS = Object.freeze({
    supernova: 520,
    reverse_supernova: 520,
});
const DEFAULT_AVATAR_IDLE_SPIN_SPEED = 0.01;

// These values intentionally mirror the legacy fast-travel line defaults so
// Selection Mode keeps its current feel without reading fastTravelLine* state.
const DEFAULT_SELECTION_MODE_TRAIL = Object.freeze({
    interDimensional: true,
    duration: 0.22,
    delay: 0,
    repeatCount: 10,
    repeatDuration: 2.0,
    trailMode: 'fade',
    lag: 0.05,
    scale: 1.5,
});

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function hexToRgba(value = '', alpha = 1) {
    const hex = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return value || `rgba(94, 252, 210, ${alpha})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function normalizeSelectionModeEffects(rendererState = null) {
    const configured = rendererState?.selectionModeEffects
        || rendererState?.selectionMode?.effects
        || {};
    const enter = String(configured.enter || rendererState?.selectionModeEnterEffect || '').trim()
        || DEFAULT_SELECTION_MODE_EFFECTS.enter;
    const exit = String(configured.exit || rendererState?.selectionModeExitEffect || '').trim()
        || DEFAULT_SELECTION_MODE_EFFECTS.exit;
    return { enter, exit };
}

export function selectionModeEffectDurationMs(effect = '') {
    return SELECTION_MODE_EFFECT_DURATIONS_MS[effect] || DEFAULT_SELECTION_MODE_EFFECT_DURATION_MS;
}

export function resolveSigilAvatarIdleRotation(rendererState = null) {
    const configured = Number(rendererState?.idleSpinSpeed ?? rendererState?.idleSpin ?? DEFAULT_AVATAR_IDLE_SPIN_SPEED);
    const baseSpeed = Number.isFinite(configured) ? configured : DEFAULT_AVATAR_IDLE_SPIN_SPEED;
    return {
        source: 'sigil_avatar_idle_rotation',
        base_speed: baseSpeed,
        cursor_long_axis_speed: baseSpeed,
        visible_avatar_y_speed: baseSpeed * 0.5,
        visible_avatar_x_speed: baseSpeed * 0.2,
    };
}

function resolveAvatarCursorSource(rendererState = null) {
    const colors = rendererState?.colors || {};
    const primaryColor = colors.face?.[0] || colors.edge?.[0] || colors.aura?.[0] || '#5efcd2';
    const auraColor = colors.aura?.[0] || primaryColor;
    const auraSecondary = colors.aura?.[1] || colors.edge?.[1] || '#8eddff';
    const vitality = rendererState?.sessionVitality || {};
    const vitalityMultiplier = Number(vitality.scaleMultiplier ?? vitality.rotationMultiplier ?? 1);
    const rotation = resolveSigilAvatarIdleRotation(rendererState);
    return {
        source: 'sigil_avatar',
        primaryColor,
        aura: {
            enabled: rendererState?.isAuraEnabled !== false,
            family: 'sigil-avatar-aura',
            primary: hexToRgba(auraColor, 0.96),
            secondary: hexToRgba(auraSecondary, 0.86),
            glow: hexToRgba(auraColor, 0.34),
            core: 'rgba(12, 22, 28, 0.58)',
            highlight: 'rgba(255, 255, 255, 0.88)',
            reach: Number(rendererState?.auraReach ?? 1),
            intensity: Number(rendererState?.auraIntensity ?? 1),
            pulseRate: Number(rendererState?.auraPulseRate ?? 0.005),
            spikeMultiplier: Number(rendererState?.spikeMultiplier ?? 1.5),
        },
        trail: {
            enabled: rendererState?.isTrailEnabled !== false,
            style: rendererState?.trailStyle || 'omega',
            count: Number(rendererState?.trailLength ?? 6),
            opacity: Number(rendererState?.trailOpacity ?? 0.5),
            fadeMs: Number(rendererState?.trailFadeMs ?? 400),
        },
        rotation: {
            axis: 'long',
            source: rotation.source,
            speed: rotation.cursor_long_axis_speed,
            visible_avatar_y_speed: rotation.visible_avatar_y_speed,
            visible_avatar_x_speed: rotation.visible_avatar_x_speed,
            session_vitality_multiplier: Number.isFinite(vitalityMultiplier) ? vitalityMultiplier : 1,
        },
    };
}

export function buildSelectionModeVisualStyle(rendererState = null) {
    const avatar = resolveAvatarCursorSource(rendererState);
    return {
        source: avatar.source,
        primary: avatar.primaryColor,
        aura: avatar.aura,
        badge: {
            active: {
                shadow: avatar.aura.primary,
                fill: avatar.aura.core,
                stroke: avatar.aura.primary,
                text: avatar.aura.highlight,
            },
            inactive: {
                shadow: avatar.aura.glow,
                fill: 'rgba(11, 17, 26, 0.78)',
                stroke: avatar.aura.secondary,
                text: 'rgba(238, 248, 255, 0.94)',
            },
            leaf: {
                ring: avatar.aura.secondary,
            },
        },
        frame: {
            active: {
                stroke: hexToRgba(avatar.primaryColor, 0.58),
                fill: hexToRgba(avatar.primaryColor, 0.035),
            },
            leaf: {
                stroke: avatar.aura.secondary,
                fill: hexToRgba(avatar.primaryColor, 0.026),
            },
            ancestor: {
                stroke: hexToRgba(avatar.primaryColor, 0.22),
                fill: hexToRgba(avatar.primaryColor, 0.018),
            },
        },
        connector: {
            stroke: avatar.aura.secondary,
        },
        highlight: {
            stroke: avatar.aura.highlight,
            glow: avatar.aura.glow,
        },
        effect: {
            primary: avatar.aura.primary,
            secondary: avatar.aura.secondary,
            glow: avatar.aura.glow,
            highlight: avatar.aura.highlight,
        },
    };
}

export function buildSelectionModeVisualEffects(selectionMode = {}, {
    projectPoint = (point) => point,
    nowMs = Date.now(),
} = {}) {
    if (!Array.isArray(selectionMode.effects)) return [];
    return selectionMode.effects
        .map((entry, index) => {
            const effect = String(entry?.effect || '').trim();
            const startedAtMs = Number(entry?.started_at_ms ?? Date.parse(entry?.at || ''));
            const durationMs = Math.max(80, Number(entry?.duration_ms) || selectionModeEffectDurationMs(effect));
            if (!effect || !Number.isFinite(startedAtMs)) return null;
            const progress = Math.max(0, Math.min(1, (Number(nowMs) - startedAtMs) / durationMs));
            const anchor = entry.anchor ? projectPoint(entry.anchor) : (selectionMode.cursor ? projectPoint(selectionMode.cursor) : null);
            return {
                id: `selection-mode-effect:${index}:${entry.phase || 'effect'}:${startedAtMs}`,
                phase: entry.phase || '',
                effect,
                reason: entry.reason || '',
                at: entry.at || '',
                started_at_ms: startedAtMs,
                duration_ms: durationMs,
                bounded: true,
                active: progress < 1,
                progress,
                anchor,
            };
        })
        .filter(Boolean);
}

export function selectionModeOverlayHasActiveEffects(overlay = {}, nowMs = Date.now()) {
    return Array.isArray(overlay?.visualEffects) && overlay.visualEffects.some((effect) => {
        const startedAtMs = Number(effect?.started_at_ms);
        const durationMs = Number(effect?.duration_ms);
        if (!Number.isFinite(startedAtMs) || !Number.isFinite(durationMs)) return effect?.active === true;
        return Number(nowMs) - startedAtMs < durationMs;
    });
}

export function buildSelectionModeCursorGlyph(cursor = null, rendererState = null) {
    if (!cursor) return null;
    const avatar = resolveAvatarCursorSource(rendererState);
    const length = 44;
    const base = length / 2;
    return {
        kind: 'selection_mode_cursor',
        model_kind: 'sigil_model',
        source: avatar.source,
        shape: 'three_sided_pyramid_prism',
        point: cursor,
        hotspot: {
            kind: 'tip',
            x: cursor.x,
            y: cursor.y,
            local: { x: 0, y: 0 },
        },
        geometry: {
            primitive: 'triangular_prism',
            sides: 3,
            length,
            base,
            length_base_ratio: 2,
            orientation: 'northwest',
        },
        animation: {
            rotates_on_axis: 'long',
            axis: avatar.rotation.axis,
            source: avatar.rotation.source,
            rotation_speed: avatar.rotation.speed,
            visible_avatar_y_speed: avatar.rotation.visible_avatar_y_speed,
            visible_avatar_x_speed: avatar.rotation.visible_avatar_x_speed,
            session_vitality_multiplier: avatar.rotation.session_vitality_multiplier,
        },
        color: {
            primary: avatar.primaryColor,
            aura_primary: avatar.aura.primary,
            aura_secondary: avatar.aura.secondary,
        },
        aura: avatar.aura,
        trail: avatar.trail,
        animatedGlow: avatar.aura.enabled,
    };
}

export function resolveSelectionModeTrailTiming(rendererState = null) {
    const configured = rendererState?.selectionModeTrail
        || rendererState?.selectionMode?.trail
        || {};
    return {
        source: 'selection_mode_trail',
        interDimensional: boolOr(
            configured.interDimensional ?? rendererState?.selectionModeTrailInterDimensional,
            DEFAULT_SELECTION_MODE_TRAIL.interDimensional,
        ),
        duration: numberOr(
            configured.duration ?? rendererState?.selectionModeTrailDuration,
            DEFAULT_SELECTION_MODE_TRAIL.duration,
        ),
        delay: numberOr(
            configured.delay ?? rendererState?.selectionModeTrailDelay,
            DEFAULT_SELECTION_MODE_TRAIL.delay,
        ),
        repeatCount: Math.max(0, Math.round(numberOr(
            configured.repeatCount ?? rendererState?.selectionModeTrailRepeatCount,
            DEFAULT_SELECTION_MODE_TRAIL.repeatCount,
        ))),
        repeatDuration: numberOr(
            configured.repeatDuration ?? rendererState?.selectionModeTrailRepeatDuration,
            DEFAULT_SELECTION_MODE_TRAIL.repeatDuration,
        ),
        trailMode: String(
            configured.trailMode ?? rendererState?.selectionModeTrailMode ?? DEFAULT_SELECTION_MODE_TRAIL.trailMode,
        ),
        lag: numberOr(
            configured.lag ?? configured.lagFactor ?? rendererState?.selectionModeTrailLag,
            DEFAULT_SELECTION_MODE_TRAIL.lag,
        ),
        scale: numberOr(
            configured.scale ?? rendererState?.selectionModeTrailScale,
            DEFAULT_SELECTION_MODE_TRAIL.scale,
        ),
    };
}

export function buildSelectionModeCursorTrailModel(rendererState = null) {
    const avatar = resolveAvatarCursorSource(rendererState);
    const timing = resolveSelectionModeTrailTiming(rendererState);
    return {
        kind: 'selection_mode_cursor_trail',
        model_kind: 'sigil_model',
        shape: 'three_sided_pyramid_prism',
        repeatShape: 'three_sided_pyramid_prism',
        source: avatar.source,
        aura: avatar.aura,
        trail: avatar.trail,
        timing,
        timingSource: timing.source,
        duration: timing.duration,
        delay: timing.delay,
        repeatCount: timing.repeatCount,
        repeatDuration: timing.repeatDuration,
        trailMode: timing.trailMode,
        lag: timing.lag,
        scale: timing.scale,
    };
}
