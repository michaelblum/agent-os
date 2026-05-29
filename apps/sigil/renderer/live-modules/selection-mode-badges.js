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

function normalizeRect(rect = null) {
    if (!rect || typeof rect !== 'object') return null;
    const x = Number(rect.x ?? rect.left);
    const y = Number(rect.y ?? rect.top);
    const width = Number(rect.width ?? rect.w);
    const height = Number(rect.height ?? rect.h);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
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

function pointInRect(point = null, rect = null) {
    if (!point || !rect) return false;
    const width = Number(rect.w ?? rect.width);
    const height = Number(rect.h ?? rect.height);
    return point.x >= rect.x && point.x <= rect.x + width
        && point.y >= rect.y && point.y <= rect.y + height;
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
        if (!badgeFits(primaryPoint, bounds)) return false;
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

export function buildSelectionModeBadgeModel({
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

export function hitTestSelectionModeBadge(overlay = {}, point = null) {
    if (!point || !Array.isArray(overlay.badges)) return null;
    return overlay.badges.find((badge) => pointInRect(point, badge.rect)) || null;
}
