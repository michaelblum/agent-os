import {
    AVATAR_RENDER_SOURCE,
    CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
    CURRENT_AVATAR_RENDER_MODEL_SOURCE,
    CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
} from './avatar-render-model-adapter.js';

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

const DEFAULT_SELECTION_CURSOR_PRISM = Object.freeze({
    geometryType: 93,
    topRadius: 0,
    bottomRadius: 0.8,
    height: 2,
    sides: 3,
    faceOpacity: 0.8,
    edgeOpacity: 0.6,
    rotationDegrees: Object.freeze({ x: 0, y: 0, z: 45 }),
    spinAxis: 'local_y',
    spinSpeed: 0.1,
    tesseronProportion: 0.5,
});

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function integerOr(value, fallback) {
    return Math.round(numberOr(value, fallback));
}

function clampNumber(value, min, max, fallback) {
    const n = numberOr(value, numberOr(fallback, min));
    return Math.max(min, Math.min(max, n));
}

function tripletOr(value = {}, fallback = { x: 0, y: 0, z: 0 }) {
    return {
        x: numberOr(value?.x, fallback.x),
        y: numberOr(value?.y, fallback.y),
        z: numberOr(value?.z, fallback.z),
    };
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

function resolveAvatarPointerSource(rendererState = null) {
    const vitality = rendererState?.sessionVitality || {};
    const vitalityMultiplier = Number(vitality.scaleMultiplier ?? vitality.rotationMultiplier ?? 1);
    return {
        source: AVATAR_RENDER_SOURCE,
        appearance_source: CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
        material_source: CURRENT_AVATAR_RENDER_MODEL_SOURCE,
        effects_source: CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        trail: {
            enabled: rendererState?.isTrailEnabled !== false,
            style: rendererState?.trailStyle || 'omega',
            count: Number(rendererState?.trailLength ?? 6),
            opacity: Number(rendererState?.trailOpacity ?? 0.5),
            fadeMs: Number(rendererState?.trailFadeMs ?? 400),
        },
        rotation: {
            axis: 'screen_plane_z',
            source: 'selection_mode_pointer_single_axis',
            speed: DEFAULT_SELECTION_CURSOR_PRISM.spinSpeed,
            visible_avatar_y_speed: 0,
            visible_avatar_x_speed: 0,
            session_vitality_multiplier: Number.isFinite(vitalityMultiplier) ? vitalityMultiplier : 1,
        },
    };
}

export function resolveSelectionModeCursorPrism(rendererState = null) {
    const configured = rendererState?.selectionModeCursor || {};
    const geometry = configured.geometry || {};
    const tesseron = rendererState?.tesseron || {};
    const rotation = tripletOr(
        geometry.rotationDegrees
            || geometry.rotation_degrees
            || configured.rotationDegrees
            || configured.rotation_degrees,
        DEFAULT_SELECTION_CURSOR_PRISM.rotationDegrees,
    );
    return {
        source: 'selection_mode_cursor_prism_defaults',
        geometryType: 93,
        topRadius: numberOr(
            geometry.topRadius ?? geometry.top_radius ?? configured.prismTopRadius,
            DEFAULT_SELECTION_CURSOR_PRISM.topRadius,
        ),
        bottomRadius: numberOr(
            geometry.bottomRadius ?? geometry.bottom_radius ?? configured.prismBottomRadius,
            DEFAULT_SELECTION_CURSOR_PRISM.bottomRadius,
        ),
        height: numberOr(
            geometry.height ?? configured.prismHeight,
            DEFAULT_SELECTION_CURSOR_PRISM.height,
        ),
        sides: Math.max(3, Math.min(64, integerOr(
            geometry.sides ?? configured.prismSides,
            DEFAULT_SELECTION_CURSOR_PRISM.sides,
        ))),
        faceOpacity: clampNumber(
            geometry.faceOpacity ?? geometry.face_opacity ?? configured.faceOpacity,
            0,
            1,
            rendererState?.currentOpacity ?? DEFAULT_SELECTION_CURSOR_PRISM.faceOpacity,
        ),
        edgeOpacity: clampNumber(
            geometry.edgeOpacity ?? geometry.edge_opacity ?? configured.edgeOpacity,
            0,
            1,
            rendererState?.currentEdgeOpacity ?? DEFAULT_SELECTION_CURSOR_PRISM.edgeOpacity,
        ),
        facesVisible: boolOr(
            geometry.facesVisible ?? geometry.faces_visible ?? configured.facesVisible,
            rendererState?.isMaskEnabled === true
                ? false
                : numberOr(rendererState?.currentOpacity, DEFAULT_SELECTION_CURSOR_PRISM.faceOpacity) > 0.001,
        ),
        tesseronEnabled: boolOr(geometry.tesseronEnabled ?? geometry.tesseron_enabled ?? configured.tesseronEnabled, tesseron.enabled === true),
        tesseronProportion: clampNumber(
            geometry.tesseronProportion ?? geometry.tesseron_proportion ?? configured.tesseronProportion,
            0.12,
            0.9,
            tesseron.proportion ?? DEFAULT_SELECTION_CURSOR_PRISM.tesseronProportion,
        ),
        tesseronMatchMother: boolOr(
            geometry.tesseronMatchMother ?? geometry.tesseron_match_mother ?? configured.tesseronMatchMother,
            tesseron.matchMother !== false,
        ),
        rotationDegrees: rotation,
        spinAxis: String(geometry.spinAxis || geometry.spin_axis || configured.spinAxis || DEFAULT_SELECTION_CURSOR_PRISM.spinAxis),
        spinSpeed: numberOr(geometry.spinSpeed ?? geometry.spin_speed ?? configured.spinSpeed, DEFAULT_SELECTION_CURSOR_PRISM.spinSpeed),
    };
}

function resolveAvatarPointerEffects(rendererState = null) {
    const colors = rendererState?.colors || {};
    const auraPrimary = colors.aura?.[0] || colors.face?.[0] || '#bc13fe';
    const auraSecondary = colors.aura?.[1] || colors.edge?.[0] || auraPrimary;
    const phenomena = rendererState?.phenomena || {};
    const enabledFamilies = [];
    if (rendererState?.isPulsarEnabled || phenomena.pulsar?.enabled) enabledFamilies.push('pulsar');
    if (rendererState?.isAccretionEnabled || phenomena.accretion?.enabled) enabledFamilies.push('accretion');
    if (rendererState?.isGammaEnabled || phenomena.gamma?.enabled) enabledFamilies.push('gamma');
    if (rendererState?.isNeutrinosEnabled || phenomena.neutrino?.enabled) enabledFamilies.push('neutrino');
    if (rendererState?.isLightningEnabled || rendererState?.lightning?.enabled) enabledFamilies.push('lightning');
    if (rendererState?.isMagneticEnabled || rendererState?.magnetic?.enabled) enabledFamilies.push('magnetic');
    return {
        source: CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
        appearance_source: CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
        rendered_pointer_families: rendererState?.isAuraEnabled === false ? [] : ['aura_glow', 'aura_core'],
        inherited_descriptor_families: enabledFamilies,
        aura: {
            enabled: rendererState?.isAuraEnabled !== false,
            primary: auraPrimary,
            secondary: auraSecondary,
            reach: Number(rendererState?.auraReach ?? 1),
            intensity: Number(rendererState?.auraIntensity ?? 1),
            pulseRate: Number(rendererState?.auraPulseRate ?? 0.005),
            wobbleCount: Number(rendererState?.wobbleCount ?? 0),
        },
        pointer_scale_boundary: [
            'aura glow/core render in the Selection Mode pointer harness',
            'large avatar-only phenomena remain inherited descriptors until they have pointer-scale adapters',
        ],
    };
}

export function buildSelectionModeVisualStyle(rendererState = null) {
    const colors = rendererState?.colors || {};
    const primaryColor = colors.face?.[0] || colors.edge?.[0] || colors.aura?.[0] || '#5efcd2';
    const auraColor = colors.aura?.[0] || primaryColor;
    const auraSecondary = colors.aura?.[1] || colors.edge?.[1] || '#8eddff';
    const aura = {
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
    };
    return {
        source: 'sigil_avatar',
        primary: primaryColor,
        aura,
        badge: {
            active: {
                shadow: aura.primary,
                fill: aura.core,
                stroke: aura.primary,
                text: aura.highlight,
            },
            inactive: {
                shadow: aura.glow,
                fill: 'rgba(11, 17, 26, 0.78)',
                stroke: aura.secondary,
                text: 'rgba(238, 248, 255, 0.94)',
            },
            leaf: {
                ring: aura.secondary,
            },
        },
        frame: {
            active: {
                stroke: hexToRgba(primaryColor, 0.58),
                fill: hexToRgba(primaryColor, 0.035),
            },
            leaf: {
                stroke: aura.secondary,
                fill: hexToRgba(primaryColor, 0.026),
            },
            ancestor: {
                stroke: hexToRgba(primaryColor, 0.22),
                fill: hexToRgba(primaryColor, 0.018),
            },
        },
        connector: {
            stroke: aura.secondary,
        },
        highlight: {
            stroke: aura.highlight,
            glow: aura.glow,
        },
        effect: {
            primary: aura.primary,
            secondary: aura.secondary,
            glow: aura.glow,
            highlight: aura.highlight,
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

export function buildSelectionModeCursorGlyph(cursor = null, rendererState = null, {
    rotationStartedAtMs = null,
} = {}) {
    if (!cursor) return null;
    const avatar = resolveAvatarPointerSource(rendererState);
    const avatarEffects = resolveAvatarPointerEffects(rendererState);
    const prism = resolveSelectionModeCursorPrism(rendererState);
    const length = Math.max(8, prism.height * 22);
    const base = Math.max(4, prism.bottomRadius * 24);
    return {
        kind: 'selection_mode_cursor',
        model_kind: 'sigil_model',
        source: avatar.source,
        appearance_source: avatar.appearance_source,
        material_source: avatar.material_source,
        effects_source: avatar.effects_source,
        avatar_effects: avatarEffects,
        shape: 'avatar_derived_prism_pointer',
        point: cursor,
        hotspot: {
            kind: 'tip',
            x: cursor.x,
            y: cursor.y,
            local: { x: 0, y: 0, z: 0 },
        },
        geometry: {
            primitive: 'prism',
            geometry_type: 93,
            top_radius: prism.topRadius,
            bottom_radius: prism.bottomRadius,
            height: prism.height,
            sides: prism.sides,
            length,
            base,
            cross_section: prism.sides === 3 ? 'triangular' : 'regular_polygon',
            expected_depth_axis: 'screen_plane',
            long_axis: 'screen_north_west',
            base_screen_quadrant: 'down_right',
            hotspot_local: { x: 0, y: 0, z: 0 },
            faces_visible: prism.facesVisible,
            face_opacity: prism.faceOpacity,
            edge_opacity: prism.edgeOpacity,
            tesseron_enabled: prism.tesseronEnabled,
            tesseron_proportion: prism.tesseronProportion,
            tesseron_match_mother: prism.tesseronMatchMother,
            orientation_degrees: prism.rotationDegrees,
            spin_axis: prism.spinAxis,
            source: prism.source,
        },
        animation: {
            rotates_on_axis: 'long_axis',
            axis: prism.spinAxis,
            source: avatar.rotation.source,
            rotation_speed: prism.spinSpeed,
            rotation_started_at_ms: rotationStartedAtMs,
            visible_avatar_y_speed: avatar.rotation.visible_avatar_y_speed,
            visible_avatar_x_speed: avatar.rotation.visible_avatar_x_speed,
            session_vitality_multiplier: avatar.rotation.session_vitality_multiplier,
        },
        trail: avatar.trail,
        cursor_overrides: {
            geometry: true,
            orientation: true,
            hotspot: true,
            scale: true,
            visibility: true,
            single_axis_rotation: true,
        },
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
    const avatar = resolveAvatarPointerSource(rendererState);
    const timing = resolveSelectionModeTrailTiming(rendererState);
    const prism = resolveSelectionModeCursorPrism(rendererState);
    return {
        kind: 'selection_mode_cursor_trail',
        model_kind: 'sigil_model',
        shape: 'avatar_derived_prism_pointer',
        repeatShape: 'avatar_derived_prism_pointer',
        repeatGeometry: 'prism',
        geometry: {
            primitive: 'prism',
            geometry_type: 93,
            top_radius: prism.topRadius,
            bottom_radius: prism.bottomRadius,
            height: prism.height,
            sides: prism.sides,
            long_axis: 'screen_north_west',
            faces_visible: prism.facesVisible,
            face_opacity: prism.faceOpacity,
            edge_opacity: prism.edgeOpacity,
            tesseron_enabled: prism.tesseronEnabled,
            tesseron_proportion: prism.tesseronProportion,
            tesseron_match_mother: prism.tesseronMatchMother,
            orientation_degrees: prism.rotationDegrees,
            spin_axis: prism.spinAxis,
        },
        source: avatar.source,
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
