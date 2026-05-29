import { toolkitSpecifier } from './content-roots.js';
import { createDisplayAnnotationSubject } from './annotation-reticle.js';
import { findDisplayForPoint } from './display-utils.js';
import { resolveSelectionModeInputRoute } from './selection-mode-input.js';

const {
    createSelectionModeContextSession,
} = await import(toolkitSpecifier('workbench/selection-mode.js'));

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
const BADGE_SIZE = 28;
const BADGE_OFFSET_START = 28;
const BADGE_OFFSET_STEP = 25;
const BADGE_MARGIN = 6;
const BADGE_FAN_GAP = 8;
const BADGE_DIRECTIONS = Object.freeze([
    Object.freeze({ id: 'down-right', dx: 1, dy: 1 }),
    Object.freeze({ id: 'down-left', dx: -1, dy: 1 }),
    Object.freeze({ id: 'up-left', dx: -1, dy: -1 }),
    Object.freeze({ id: 'up-right', dx: 1, dy: -1 }),
]);

export function createDefaultSelectionModeState() {
    return {
        active: false,
        entered_at: null,
        cursor: null,
        leaf_candidate: null,
        path_candidates: [],
        selected_node_id: '',
        context_session: null,
        events: [],
        effects: [],
        blocker: null,
    };
}

function defaultNowIso() {
    return new Date().toISOString();
}

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeRect(rect = null) {
    if (!rect || typeof rect !== 'object') return null;
    const x = Number(rect.x ?? rect.left);
    const y = Number(rect.y ?? rect.top);
    const width = Number(rect.width ?? rect.w);
    const height = Number(rect.height ?? rect.h);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

function projectionRect(candidate = null) {
    const rect = normalizeRect(
        candidate?.projection?.visible_display_rect
        || candidate?.projection?.display_space_rect
        || candidate?.visible_display_rect
        || candidate?.display_space_rect
        || candidate?.rect
    );
    return rect
        ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
        : null;
}

function pointInRect(point = null, rect = null) {
    if (!point || !rect) return false;
    const width = Number(rect.w ?? rect.width);
    const height = Number(rect.h ?? rect.height);
    return point.x >= rect.x && point.x <= rect.x + width
        && point.y >= rect.y && point.y <= rect.y + height;
}

function candidateArea(candidate = null) {
    const rect = projectionRect(candidate);
    return rect ? rect.w * rect.h : Number.POSITIVE_INFINITY;
}

function cursorFromPoint(point = null) {
    if (!point) return null;
    return {
        x: finite(point.x),
        y: finite(point.y),
        valid: point.valid !== false,
    };
}

function projectRect(rect = null, projectPoint = (point) => point) {
    const normalized = normalizeRect(rect);
    if (!normalized) return null;
    const origin = projectPoint({ x: normalized.x, y: normalized.y, valid: true });
    if (!origin) return null;
    return {
        x: origin.x,
        y: origin.y,
        width: normalized.width,
        height: normalized.height,
    };
}

function normalizeBounds(bounds = null) {
    const x = Number(bounds?.x ?? bounds?.left);
    const y = Number(bounds?.y ?? bounds?.top);
    const width = Number(bounds?.w ?? bounds?.width);
    const height = Number(bounds?.h ?? bounds?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, w: width, h: height };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeSelectionModeEffects(rendererState = null) {
    const configured = rendererState?.selectionModeEffects
        || rendererState?.selectionMode?.effects
        || {};
    const enter = String(configured.enter || rendererState?.selectionModeEnterEffect || '').trim()
        || DEFAULT_SELECTION_MODE_EFFECTS.enter;
    const exit = String(configured.exit || rendererState?.selectionModeExitEffect || '').trim()
        || DEFAULT_SELECTION_MODE_EFFECTS.exit;
    return { enter, exit };
}

function effectDurationMs(effect = '') {
    return SELECTION_MODE_EFFECT_DURATIONS_MS[effect] || DEFAULT_SELECTION_MODE_EFFECT_DURATION_MS;
}

function hexToRgba(value = '', alpha = 1) {
    const hex = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return value || `rgba(94, 252, 210, ${alpha})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function buildSelectionModeVisualStyle(rendererState = null) {
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

function badgeVisualStyle(visualStyle = null, { active = false, leaf = false } = {}) {
    if (active) return visualStyle?.badge?.active || null;
    return leaf
        ? { ...(visualStyle?.badge?.inactive || {}), ...(visualStyle?.badge?.leaf || {}) }
        : (visualStyle?.badge?.inactive || null);
}

function fitBadgeRect(point, bounds = null) {
    if (!bounds) return { x: point.x, y: point.y, width: BADGE_SIZE, height: BADGE_SIZE };
    return {
        x: clamp(point.x, bounds.x + BADGE_MARGIN, bounds.x + bounds.w - BADGE_SIZE - BADGE_MARGIN),
        y: clamp(point.y, bounds.y + BADGE_MARGIN, bounds.y + bounds.h - BADGE_SIZE - BADGE_MARGIN),
        width: BADGE_SIZE,
        height: BADGE_SIZE,
    };
}

function badgeFits(point, bounds = null) {
    if (!bounds) return true;
    return point.x >= bounds.x + BADGE_MARGIN
        && point.y >= bounds.y + BADGE_MARGIN
        && point.x + BADGE_SIZE <= bounds.x + bounds.w - BADGE_MARGIN
        && point.y + BADGE_SIZE <= bounds.y + bounds.h - BADGE_MARGIN;
}

function badgeOverlapArea(a = {}, b = {}) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function badgeRectsSubstantiallyOverlap(a = {}, b = {}) {
    const overlap = badgeOverlapArea(a, b);
    const smallerArea = Math.min(
        Math.max(0, a.width) * Math.max(0, a.height),
        Math.max(0, b.width) * Math.max(0, b.height),
    );
    return a.x === b.x && a.y === b.y
        || (smallerArea > 0 && overlap / smallerArea > 0.35)
        || (a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
        && overlap > 64);
}

function canPlaceBadgeGroups(groups = [], startPoint, bounds, direction, fanDx) {
    if (!bounds) return true;
    const rects = [];
    for (let i = 0; i < groups.length; i += 1) {
        const offset = BADGE_OFFSET_START + (i * BADGE_OFFSET_STEP);
        const primaryPoint = {
            x: startPoint.x + direction.dx * offset,
            y: startPoint.y + direction.dy * offset,
        };
        if (!badgeFits(primaryPoint, bounds)) {
            return false;
        }
        const primaryRect = { ...primaryPoint, width: BADGE_SIZE, height: BADGE_SIZE };
        if (rects.some((rect) => badgeRectsSubstantiallyOverlap(rect, primaryRect))) return false;
        rects.push(primaryRect);
        const secondaryCount = groups[i]?.secondaries?.length || 0;
        for (let secondaryIndex = 0; secondaryIndex < secondaryCount; secondaryIndex += 1) {
            const secondaryPoint = {
                x: primaryPoint.x + fanDx * (BADGE_SIZE + BADGE_FAN_GAP) * (secondaryIndex + 1),
                y: primaryPoint.y,
            };
            if (!badgeFits(secondaryPoint, bounds)) return false;
            const secondaryRect = { ...secondaryPoint, width: BADGE_SIZE, height: BADGE_SIZE };
            if (rects.some((rect) => badgeRectsSubstantiallyOverlap(rect, secondaryRect))) return false;
            rects.push(secondaryRect);
        }
    }
    return true;
}

function chooseBadgeLayout(groups, startPoint, bounds = null) {
    for (const candidate of BADGE_DIRECTIONS) {
        const preferredFanDx = candidate.dx >= 0 ? 1 : -1;
        const fanCandidates = [preferredFanDx, -preferredFanDx];
        for (const fanDx of fanCandidates) {
            if (canPlaceBadgeGroups(groups, startPoint, bounds, candidate, fanDx)) {
                return {
                    ...candidate,
                    fanDx,
                    fallback: false,
                };
            }
        }
    }
    const direction = BADGE_DIRECTIONS[0];
    return {
        ...direction,
        fanDx: direction.dx >= 0 ? -1 : 1,
        fallback: true,
    };
}

function normalizedRoleToken(node = {}) {
    const text = [
        node.role,
        node.kind,
        node.subject_kind,
        node.label,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    if (text.includes('display') || text.includes('screen')) return 'display';
    if (/\bbody\b/.test(text) || text.includes('document body')) return 'body';
    if (text.includes('native_app') || text.includes('application') || /\bapp\b/.test(text)) return 'app';
    if (text.includes('native_window') || /\bwindow\b/.test(text)) return 'window';
    return '';
}

function nodeRoleLabel(node = {}) {
    return String(node.role || node.subject_kind || node.kind || node.label || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function genericNodeLabel(node = {}) {
    const label = String(node.label || '').toLowerCase().trim();
    return !label || ['frame', 'group', 'container', 'element', 'unknown'].includes(label);
}

function rectDistance(a = null, b = null) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const acx = a.x + (a.width || a.w || 0) / 2;
    const acy = a.y + (a.height || a.h || 0) / 2;
    const bcx = b.x + (b.width || b.w || 0) / 2;
    const bcy = b.y + (b.height || b.h || 0) / 2;
    return Math.hypot(acx - bcx, acy - bcy);
}

function rectSimilar(a = null, b = null) {
    if (!a || !b) return false;
    const aw = Number(a.width ?? a.w);
    const ah = Number(a.height ?? a.h);
    const bw = Number(b.width ?? b.w);
    const bh = Number(b.height ?? b.h);
    if (![aw, ah, bw, bh].every(Number.isFinite)) return false;
    return Math.abs(aw - bw) <= 8
        && Math.abs(ah - bh) <= 8
        && rectDistance(a, b) <= 12;
}

function badgeNodeDistinct(node = {}, primary = {}) {
    const token = normalizedRoleToken(node);
    const primaryToken = normalizedRoleToken(primary);
    if (token || primaryToken) return token !== primaryToken;
    const rect = normalizeRect(node.projection?.visible_display_rect || node.projection?.display_space_rect);
    const primaryRect = normalizeRect(primary.projection?.visible_display_rect || primary.projection?.display_space_rect);
    if (rectSimilar(rect, primaryRect)) {
        const role = nodeRoleLabel(node);
        const primaryRole = nodeRoleLabel(primary);
        if (!role || role === primaryRole || (genericNodeLabel(node) && genericNodeLabel(primary))) return false;
    }
    return true;
}

function badgeTokenLabel(token = '', fallback = '') {
    if (token === 'display') return 'D';
    if (token === 'body') return 'B';
    if (token === 'app') return 'A';
    if (token === 'window') return 'W';
    return fallback;
}

function badgeTitle(node = {}, fallback = '') {
    const role = String(node.role || node.subject_kind || node.kind || '').trim();
    const label = String(node.label || node.address || node.id || fallback).trim();
    return role && role !== label ? `${label} (${role})` : label;
}

function buildBadgeGroups(path = []) {
    const ordered = path.map((node, pathIndex) => ({ node, pathIndex })).reverse();
    const groups = [];
    for (const entry of ordered) {
        const last = groups.at(-1);
        if (!last || badgeNodeDistinct(entry.node, last.primary.node)) {
            groups.push({ primary: entry, secondaries: [] });
        } else {
            last.secondaries.push(entry);
        }
    }
    return groups;
}

function buildBadgeModel({
    path = [],
    activeNodeId = '',
    leafNodeId = '',
    cursor = null,
    overlayBounds = null,
    visualStyle = null,
} = {}) {
    if (!path.length || !cursor) return { badges: [], badgeGroups: [], badgeLayout: null };
    const groups = buildBadgeGroups(path);
    const bounds = normalizeBounds(overlayBounds);
    const direction = chooseBadgeLayout(groups, cursor, bounds);
    const fanDx = direction.fanDx;
    const badges = [];
    const badgeGroups = groups.map((group, groupIndex) => {
        const offset = BADGE_OFFSET_START + (groupIndex * BADGE_OFFSET_STEP);
        const primaryPoint = {
            x: cursor.x + direction.dx * offset,
            y: cursor.y + direction.dy * offset,
        };
        const token = normalizedRoleToken(group.primary.node);
        const primaryLabel = badgeTokenLabel(token, String(groupIndex + 1));
        const primaryBadge = {
            id: `selection-mode-badge:${group.primary.node.id}`,
            kind: 'primary',
            nodeId: group.primary.node.id,
            address: group.primary.node.address,
            label: primaryLabel,
            title: badgeTitle(group.primary.node, primaryLabel),
            pathIndex: group.primary.pathIndex,
            groupIndex,
            token,
            active: group.primary.node.id === activeNodeId,
            leaf: group.primary.node.id === leafNodeId,
            rect: fitBadgeRect(primaryPoint, bounds),
            decoration: {
                token,
                style: token ? `key-${token}` : 'ancestor',
            },
            style: badgeVisualStyle(visualStyle, {
                active: group.primary.node.id === activeNodeId,
                leaf: group.primary.node.id === leafNodeId,
            }),
        };
        badges.push(primaryBadge);
        const secondaryIds = [];
        group.secondaries.forEach((secondary, secondaryIndex) => {
            const secondaryToken = normalizedRoleToken(secondary.node);
            const rect = fitBadgeRect({
                x: primaryBadge.rect.x + fanDx * (BADGE_SIZE + BADGE_FAN_GAP) * (secondaryIndex + 1),
                y: primaryBadge.rect.y,
            }, bounds);
            const secondaryBadge = {
                id: `selection-mode-badge:${secondary.node.id}`,
                kind: 'secondary',
                nodeId: secondary.node.id,
                address: secondary.node.address,
                label: `${primaryLabel}.${secondaryIndex + 1}`,
                title: badgeTitle(secondary.node, `${primaryLabel}.${secondaryIndex + 1}`),
                pathIndex: secondary.pathIndex,
                groupIndex,
                token: secondaryToken,
                active: secondary.node.id === activeNodeId,
                leaf: secondary.node.id === leafNodeId,
                rect,
                decoration: {
                    token: secondaryToken,
                    style: secondaryToken ? `key-${secondaryToken}` : 'grouped-ancestor',
                },
                style: badgeVisualStyle(visualStyle, {
                    active: secondary.node.id === activeNodeId,
                    leaf: secondary.node.id === leafNodeId,
                }),
            };
            secondaryIds.push(secondaryBadge.id);
            badges.push(secondaryBadge);
        });
        return {
            id: `selection-mode-badge-group:${groupIndex}`,
            primaryId: primaryBadge.id,
            secondaryIds,
            fanoutDirection: fanDx > 0 ? 'right' : 'left',
            groupedCount: group.secondaries.length,
            pathNodeIds: [group.primary, ...group.secondaries].map((entry) => entry.node.id),
        };
    });
    return {
        badges,
        badgeGroups,
        badgeLayout: {
            order: 'leaf-to-root',
            direction: direction.id,
            fallback: direction.fallback,
            fanoutDirection: fanDx > 0 ? 'right' : 'left',
            badgeSize: BADGE_SIZE,
            offsetStart: BADGE_OFFSET_START,
            offsetStep: BADGE_OFFSET_STEP,
        },
    };
}

function buildSelectionModeVisualEffects(selectionMode = {}, {
    projectPoint = (point) => point,
    nowMs = Date.now(),
} = {}) {
    if (!Array.isArray(selectionMode.effects)) return [];
    return selectionMode.effects
        .map((entry, index) => {
            const effect = String(entry?.effect || '').trim();
            const startedAtMs = Number(entry?.started_at_ms ?? Date.parse(entry?.at || ''));
            const durationMs = Math.max(80, Number(entry?.duration_ms) || effectDurationMs(effect));
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

function buildCursorGlyph(cursor = null, rendererState = null) {
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

function buildCursorTrailModel(rendererState = null) {
    const avatar = resolveAvatarCursorSource(rendererState);
    return {
        kind: 'selection_mode_cursor_trail',
        model_kind: 'sigil_model',
        shape: 'three_sided_pyramid_prism',
        repeatShape: 'three_sided_pyramid_prism',
        source: avatar.source,
        aura: avatar.aura,
        trail: avatar.trail,
        timingSource: 'fast_travel_line',
    };
}

export function hitTestSelectionModeBadge(overlay = {}, point = null) {
    if (!point || !Array.isArray(overlay.badges)) return null;
    return overlay.badges.find((badge) => pointInRect(point, badge.rect)) || null;
}

export function buildProjectedSelectionModeOverlay(selectionMode = {}, {
    projectPoint = (point) => point,
    overlayBounds = null,
    rendererState = null,
    nowMs = Date.now(),
} = {}) {
    const visualStyle = buildSelectionModeVisualStyle(rendererState);
    const visualEffects = buildSelectionModeVisualEffects(selectionMode, { projectPoint, nowMs });
    const effectsActive = visualEffects.some((effect) => effect.active);
    if (!selectionMode?.active && !selectionMode?.context_session && !effectsActive) return {
        visible: false,
        active: false,
        styles: visualStyle,
        visualEffects,
    };
    const artifact = selectionMode.context_session?.artifacts?.[0] || null;
    const path = Array.isArray(artifact?.path) ? artifact.path : [];
    const activeNodeId = artifact?.active_target_node_id || selectionMode.selected_node_id || '';
    const leafNodeId = artifact?.acquisition?.leaf_node_id || path.at(-1)?.id || '';
    const frames = path.map((node, index) => {
        const rect = projectRect(
            node.projection?.visible_display_rect
            || node.projection?.display_space_rect,
            projectPoint,
        );
        if (!rect) return null;
        return {
            kind: node.id === activeNodeId ? 'active_target' : (node.id === leafNodeId ? 'clicked_leaf' : 'ancestor'),
            id: node.id,
            address: node.address,
            label: node.label || node.role || node.kind || node.id,
            rect,
            index,
            active: node.id === activeNodeId,
            leaf: node.id === leafNodeId,
            style: node.id === activeNodeId
                ? visualStyle.frame.active
                : (node.id === leafNodeId ? visualStyle.frame.leaf : visualStyle.frame.ancestor),
        };
    }).filter(Boolean);
    const cursor = selectionMode.cursor ? projectPoint(selectionMode.cursor) : null;
    const badgeAnchor = artifact?.acquisition?.pointer
        ? projectPoint(artifact.acquisition.pointer)
        : cursor;
    const badgeModel = buildBadgeModel({
        path,
        activeNodeId,
        leafNodeId,
        cursor: badgeAnchor,
        overlayBounds,
        visualStyle,
    });
    return {
        visible: selectionMode.active === true || effectsActive,
        active: selectionMode.active === true,
        cursor,
        cursorGlyph: buildCursorGlyph(cursor, rendererState),
        cursorTrail: buildCursorTrailModel(rendererState),
        frames,
        ...badgeModel,
        styles: visualStyle,
        visualEffects,
        activeNodeId,
        leafNodeId,
        blocker: selectionMode.blocker || null,
        eventCount: Array.isArray(selectionMode.events) ? selectionMode.events.length : 0,
    };
}

export function createSigilSelectionModeRuntime({
    liveState = {},
    rendererState = null,
    nowMs = () => Date.now(),
    nowIso = defaultNowIso,
    getPointer = () => null,
    getDisplays = () => [],
    getCandidateList = () => [],
    projectPoint = (point) => point,
    getOverlayBounds = () => null,
    closeContextMenu = () => {},
    exitAnnotationReticle = () => {},
    clearGestureState = () => {},
    syncInputRegions = () => {},
    scheduleRenderFrame = () => {},
    clearSelectionModeEntryReleasePending = () => {},
    consumeSelectionModeEntryRelease = () => false,
    isOnAvatar = () => false,
    consumeAvatarDoubleClick = () => false,
    setActiveContextProvider = () => null,
    executeCommand = () => null,
} = {}) {
    if (!liveState.selectionMode) liveState.selectionMode = createDefaultSelectionModeState();
    if (liveState.selectionModeOverlay === undefined) liveState.selectionModeOverlay = null;

    function buildOverlay(selectionMode = liveState.selectionMode) {
        return buildProjectedSelectionModeOverlay(selectionMode, {
            projectPoint,
            overlayBounds: getOverlayBounds(),
            rendererState,
            nowMs: nowMs(),
        });
    }

    function publish({ inputRegions = false, render = false } = {}) {
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        if (rendererState) rendererState.selectionMode = liveState.selectionMode;
        if (inputRegions) syncInputRegions();
        if (render) scheduleRenderFrame();
        return liveState.selectionMode;
    }

    function recordEvent(type, extra = {}) {
        const entry = {
            type,
            at: nowIso(),
            ...extra,
        };
        liveState.selectionMode.events = [...(liveState.selectionMode.events || []), entry].slice(-40);
        return entry;
    }

    function recordEffect(phase, reason = '') {
        const effects = normalizeSelectionModeEffects(rendererState);
        const effect = phase === 'enter' ? effects.enter : effects.exit;
        const startedAtMs = nowMs();
        const entry = {
            phase,
            effect,
            reason,
            at: nowIso(),
            started_at_ms: startedAtMs,
            duration_ms: effectDurationMs(effect),
            anchor: liveState.selectionMode?.cursor || null,
            bounded: true,
        };
        liveState.selectionMode.effects = [
            ...(liveState.selectionMode.effects || []),
            entry,
        ].slice(-20);
        recordEvent('selection_mode_effect', entry);
        return entry;
    }

    function recordAcquireFeedback(reason = 'acquire') {
        if (rendererState) {
            rendererState.auraSpike = Math.max(Number(rendererState.auraSpike) || 0, 1);
        }
        return recordEvent('selection_mode_aura_spike', {
            reason,
            style: 'avatar_aura_spike',
            bounded: true,
        });
    }

    function displayCandidate(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const displays = Array.isArray(getDisplays()) ? getDisplays() : [];
        const display = findDisplayForPoint(displays, cursor.x, cursor.y)
            || displays[0]
            || null;
        return createDisplayAnnotationSubject(display, cursor, {
            role: 'selection-root',
        });
    }

    function candidatesAtPoint(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const displayRoot = displayCandidate(cursor);
        const containing = getCandidateList()
            .filter((candidate) => pointInRect(cursor, projectionRect(candidate)))
            .sort((a, b) => candidateArea(b) - candidateArea(a));
        const path = [displayRoot, ...containing];
        const seen = new Set();
        return path.filter((candidate) => {
            const key = String(candidate?.id || candidate?.subject_id || candidate?.address || '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function buildContextSession({ selectedNodeId = liveState.selectionMode.selected_node_id } = {}) {
        const pathCandidates = Array.isArray(liveState.selectionMode.path_candidates)
            ? liveState.selectionMode.path_candidates
            : [];
        if (!pathCandidates.length) return null;
        const contextSession = createSelectionModeContextSession({
            id: liveState.selectionMode.context_session?.id,
            updated_at: nowIso(),
            pointer: liveState.selectionMode.cursor,
            clicked_leaf_candidate: liveState.selectionMode.leaf_candidate || pathCandidates.at(-1),
            path_candidates: pathCandidates,
            selected_target_id: selectedNodeId || liveState.selectionMode.selected_node_id || pathCandidates.at(-1)?.id,
            adapter_blockers: liveState.selectionMode.blocker ? [liveState.selectionMode.blocker] : [],
            session_metadata: {
                source: 'sigil_selection_mode_runtime',
            },
        });
        const artifact = contextSession.artifacts?.[0] || null;
        liveState.selectionMode.context_session = contextSession;
        liveState.selectionMode.selected_node_id = artifact?.active_target_node_id || '';
        liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        return contextSession;
    }

    function enter(pointer = null, reason = 'avatar-double-click') {
        closeContextMenu('selection-mode');
        exitAnnotationReticle('selection-mode');
        clearGestureState();
        const cursor = cursorFromPoint(pointer || getPointer());
        liveState.selectionMode = {
            ...createDefaultSelectionModeState(),
            active: true,
            entered_at: nowIso(),
            cursor,
        };
        recordEffect('enter', reason);
        recordEvent('enter', { reason, cursor });
        publish({ inputRegions: true, render: true });
        return liveState.selectionMode;
    }

    function exit(reason = 'cancel') {
        if (!liveState.selectionMode?.active) return liveState.selectionMode;
        clearSelectionModeEntryReleasePending();
        recordEffect('exit', reason);
        recordEvent('exit', { reason });
        liveState.selectionMode = {
            ...liveState.selectionMode,
            active: false,
            blocker: reason === 'cancel' ? { status: 'cancelled', reason } : liveState.selectionMode.blocker,
        };
        publish({ inputRegions: true, render: true });
        return liveState.selectionMode;
    }

    function acquire(point = null) {
        const cursor = cursorFromPoint(point || getPointer()) || { x: 0, y: 0, valid: true };
        const pathCandidates = candidatesAtPoint(cursor);
        const leaf = pathCandidates.at(-1) || null;
        liveState.selectionMode = {
            ...liveState.selectionMode,
            cursor,
            leaf_candidate: leaf,
            path_candidates: pathCandidates,
            selected_node_id: leaf?.id || leaf?.subject_id || leaf?.address || '',
            blocker: pathCandidates.length > 1 ? null : {
                status: 'degraded',
                reason: 'selection_mode_only_display_fallback_available',
            },
        };
        recordEvent('acquire', {
            cursor,
            path_candidate_count: pathCandidates.length,
            leaf_candidate_id: leaf?.id || leaf?.subject_id || leaf?.address || '',
        });
        recordAcquireFeedback('acquire');
        const contextSession = buildContextSession();
        publish({ render: true });
        return contextSession;
    }

    function cycleTarget(delta = -1) {
        const contextSession = liveState.selectionMode?.context_session;
        const path = contextSession?.artifacts?.[0]?.path || [];
        if (!path.length) return null;
        const current = path.findIndex((node) => node.id === liveState.selectionMode.selected_node_id);
        const nextIndex = (current >= 0 ? current : path.length - 1) + delta;
        const wrapped = ((nextIndex % path.length) + path.length) % path.length;
        const context = buildContextSession({ selectedNodeId: path[wrapped].id });
        recordEvent('select_target', {
            selected_node_id: liveState.selectionMode.selected_node_id,
        });
        publish({ render: true });
        return context;
    }

    function selectTargetNode(nodeId = '', { reason = 'badge-click' } = {}) {
        const target = String(nodeId || '').trim();
        const path = liveState.selectionMode?.context_session?.artifacts?.[0]?.path || [];
        if (!target || !path.some((node) => node.id === target || node.address === target)) return null;
        const context = buildContextSession({ selectedNodeId: target });
        recordEvent('select_target', {
            reason,
            selected_node_id: liveState.selectionMode.selected_node_id,
        });
        publish({ render: true });
        return context;
    }

    function hitTestBadge(point = null) {
        const cursor = cursorFromPoint(point);
        if (!cursor) return null;
        const projected = projectPoint(cursor);
        const overlay = buildOverlay(liveState.selectionMode);
        return hitTestSelectionModeBadge(overlay, projected);
    }

    function commit(reason = 'selection-mode-commit') {
        const contextSession = liveState.selectionMode?.context_session || buildContextSession();
        if (!contextSession) return null;
        const activeContext = setActiveContextProvider({
            source: 'selection_mode',
            contextSession,
            trigger: 'selection_mode_commit',
            reason,
        });
        recordEvent('commit', {
            reason,
            context_session_id: contextSession.id,
            context_keyframe_id: activeContext?.context_keyframe?.id || '',
        });
        exit('commit');
        return contextSession;
    }

    function setNodeComment(nodeId = '', text = '', options = {}) {
        const target = String(nodeId || liveState.selectionMode?.selected_node_id || '').trim();
        const path = liveState.selectionMode?.path_candidates || [];
        const contextPath = liveState.selectionMode?.context_session?.artifacts?.[0]?.path || [];
        const targetIndex = contextPath.findIndex((node) => node.id === target || node.address === target);
        const nextPath = path.map((candidate, index) => {
            const key = String(candidate.id || candidate.node_id || candidate.subject_id || candidate.address || '').trim();
            if (key !== target && index !== targetIndex) return candidate;
            return {
                ...candidate,
                comments: [
                    ...(Array.isArray(candidate.comments) ? candidate.comments : []),
                    {
                        id: options.id || `comment:selection-mode:${Date.now()}`,
                        text,
                        actor: options.actor || { role: 'operator', id: 'human' },
                        created_at: options.created_at || nowIso(),
                        updated_at: options.updated_at || nowIso(),
                    },
                ],
            };
        });
        liveState.selectionMode.path_candidates = nextPath;
        const context = buildContextSession({ selectedNodeId: liveState.selectionMode.selected_node_id });
        publish();
        return context;
    }

    function createContextFromDebugInput(input = {}) {
        const contextSession = createSelectionModeContextSession(input, {
            updated_at: input.updated_at || nowIso(),
        });
        liveState.selectionMode = {
            active: Boolean(input.active ?? false),
            entered_at: input.entered_at || null,
            cursor: input.pointer || input.cursor || null,
            leaf_candidate: input.clicked_leaf_candidate || input.leaf_candidate || null,
            path_candidates: input.path_candidates || input.ancestor_candidates || [],
            selected_node_id: contextSession.artifacts?.[0]?.active_target_node_id || '',
            context_session: contextSession,
            events: [],
            effects: [],
            blocker: input.blocker || null,
        };
        setActiveContextProvider({
            source: 'selection_mode_debug',
            contextSession,
            trigger: 'selection_mode_debug',
            reason: 'debug-api',
        });
        publish();
        return contextSession;
    }

    function handleInput(msg = {}) {
        if (!liveState.selectionMode?.active) return false;
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
            liveState.selectionMode.cursor = { x: msg.x, y: msg.y, valid: true };
            liveState.selectionModeOverlay = buildOverlay(liveState.selectionMode);
        }
        const route = resolveSelectionModeInputRoute(msg, {
            consumeSelectionModeEntryRelease,
            isOnAvatar,
            consumeAvatarDoubleClick,
            hitTestBadge,
        });
        if (!route.handled) return false;
        if (route.direct === 'render_only') {
            scheduleRenderFrame();
            return true;
        }
        if (route.direct === 'avatar_double_click_exit') {
            exit('avatar-double-click');
            return true;
        }
        if (route.command === 'escape') {
            exit('escape');
            return true;
        }
        if (!route.command) return true;

        executeCommand(route.command, msg, {
            pointer: route.pointer || null,
            nodeId: route.nodeId || null,
            badgeId: route.badgeId || null,
        });
        return true;
    }

    return {
        buildContextSession,
        buildProjectedOverlay: buildOverlay,
        candidatesAtPoint,
        enter,
        exit,
        acquire,
        cycleTarget,
        selectTargetNode,
        hitTestBadge,
        commit,
        setNodeComment,
        createContextFromDebugInput,
        handleInput,
        snapshot() {
            return {
                selectionMode: liveState.selectionMode || createDefaultSelectionModeState(),
                selectionModeOverlay: liveState.selectionModeOverlay || buildOverlay(liveState.selectionMode),
            };
        },
    };
}
