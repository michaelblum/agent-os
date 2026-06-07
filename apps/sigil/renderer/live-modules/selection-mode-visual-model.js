import {
    CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
    CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
} from './avatar-render-model-adapter.js';

const DEFAULT_SELECTION_MODE_EFFECTS = Object.freeze({
    enter: 'supernova',
    exit: 'reverse_supernova',
});
const DEFAULT_SELECTION_MODE_EFFECT_DURATION_MS = 720;
const SELECTION_MODE_EFFECT_DURATIONS_MS = Object.freeze({
    supernova: 380,
    reverse_supernova: 340,
});
const DEFAULT_AVATAR_IDLE_SPIN_SPEED = 0.01;

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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

function selectionModeEffectProfile(effect = '') {
    if (effect === 'supernova' || effect === 'reverse_supernova') {
        return {
            source: 'celestial-v1-supernova-release',
            reference: 'celestial/_legacy/celestial-v1.html',
            shockwave_ms: 200,
            particle_families: ['white_release_sparks', 'edge_color_friction_sparks', 'white_dwarf_core'],
        };
    }
    return {
        source: 'selection_mode_custom_effect',
        reference: '',
        shockwave_ms: 0,
        particle_families: [],
    };
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
        lineage: {
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
            perimeter: {
                fill: hexToRgba(primaryColor, 0.11),
                line: aura.secondary,
                glow: aura.glow,
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
                profile: selectionModeEffectProfile(effect),
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
