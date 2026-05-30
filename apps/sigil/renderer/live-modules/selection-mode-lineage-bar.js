const BAR_HEIGHT = 34;
const BAR_TOP_MARGIN = 10;
const BAR_MENU_BAR_FALLBACK_INSET = 24;
const BAR_DISPLAY_MARGIN = 8;
const BAR_PADDING_X = 8;
const BAR_ITEM_HEIGHT = 24;
const BAR_ITEM_MIN_WIDTH = 28;
const BAR_ITEM_MAX_WIDTH = 150;
const BAR_SEPARATOR_WIDTH = 12;
const BAR_MAX_WIDTH = 720;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
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

function rectToBounds(rect = null) {
    const normalized = normalizeRect(rect);
    return normalized
        ? { x: normalized.x, y: normalized.y, w: normalized.width, h: normalized.height }
        : null;
}

function displayId(display = null, fallback = '') {
    const value = display?.display_id ?? display?.id ?? display?.cgID ?? display?.uuid ?? fallback;
    return String(value || '');
}

function displayVisibleBounds(display = null) {
    return rectToBounds(
        display?.visibleBounds
        || display?.visible_bounds
        || display?.visible_desktop_world_bounds
        || display?.desktop_world_visible_bounds
        || display?.bounds
        || display?.desktop_world_bounds
    );
}

function displayExplicitVisibleBounds(display = null) {
    return rectToBounds(
        display?.visibleBounds
        || display?.visible_bounds
        || display?.visible_desktop_world_bounds
        || display?.desktop_world_visible_bounds
    );
}

function displayRawBounds(display = null) {
    return rectToBounds(
        display?.bounds
        || display?.desktop_world_bounds
    );
}

function pointInBounds(point = null, rect = null) {
    if (!point || !rect) return false;
    const width = Number(rect.w ?? rect.width);
    const height = Number(rect.h ?? rect.height);
    return point.x >= rect.x && point.x <= rect.x + width
        && point.y >= rect.y && point.y <= rect.y + height;
}

function rectCenter(rect = null) {
    if (!rect) return null;
    return {
        x: rect.x + (Number(rect.w ?? rect.width) || 0) / 2,
        y: rect.y + (Number(rect.h ?? rect.height) || 0) / 2,
    };
}

function distance(a = null, b = null) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    return Math.hypot(finite(a.x) - finite(b.x), finite(a.y) - finite(b.y));
}

function findDisplayForPoint(displays = [], point = null) {
    const entries = Array.isArray(displays) ? displays : [];
    if (!entries.length || !point) return null;
    const containing = entries.find((display) => pointInBounds(point, displayVisibleBounds(display)));
    if (containing) return containing;
    return entries
        .map((display) => ({ display, rect: displayVisibleBounds(display) }))
        .filter((entry) => entry.rect)
        .sort((a, b) => distance(point, rectCenter(a.rect)) - distance(point, rectCenter(b.rect)))[0]?.display || null;
}

function normalizeRoleToken(node = {}) {
    const text = [
        node.role,
        node.kind,
        node.subject_kind,
        node.label,
        node.address,
        node.id,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    if (text.includes('union')) return 'union';
    if (text.includes('desktopworld') || text.includes('desktop_world') || /\bdesktop\b/.test(text)) return 'desktop';
    if (text.includes('display') || text.includes('screen')) return 'display';
    if (text.includes('browser_tab') || text.includes('browser tab') || /\btab\b/.test(text)) return 'browser_tab';
    if (text.includes('document') || /\bdom\b/.test(text)) return 'document';
    if (/\bbody\b/.test(text) || text.includes('document body')) return 'body';
    if (text.includes('native_app') || text.includes('application') || /\bapp\b/.test(text)) return 'app';
    if (text.includes('native_window') || /\bwindow\b/.test(text)) return 'window';
    if (text.includes('canvas')) return 'canvas';
    if (text.includes('layout')) return 'layout';
    if (text.includes('container') || text.includes('group')) return 'container';
    return '';
}

function nodeId(node = {}) {
    return String(node.id || node.node_id || node.address || node.subject_id || '').trim();
}

function nodeTitle(node = {}, fallback = '') {
    const role = String(node.role || node.subject_kind || node.kind || '').trim();
    const label = String(node.label || node.name || node.address || node.id || fallback).trim();
    return role && role !== label ? `${label} (${role})` : label;
}

function shortDisplayLabel(display = null) {
    const label = String(display?.label || display?.name || '').trim();
    if (label) return label;
    const id = displayId(display);
    return id ? `Display ${id}` : 'Display';
}

function labelForNode(node = {}, { index = 0, activeDisplay = null } = {}) {
    const token = normalizeRoleToken(node);
    const rawLabel = String(node.label || node.name || node.subject_id || node.address || node.id || '').trim();
    if (token === 'display') return rawLabel || shortDisplayLabel(activeDisplay);
    if (token === 'desktop') return 'Desktop';
    if (token === 'app') return rawLabel || 'App';
    if (token === 'window') return rawLabel || 'Window';
    if (token === 'browser_tab') return rawLabel || 'Tab';
    if (token === 'canvas') return rawLabel || 'Canvas';
    if (token === 'document') return rawLabel || 'DOM';
    if (token === 'body') return rawLabel || 'Body';
    if (token === 'layout') return rawLabel || 'Layout';
    if (token === 'container') return rawLabel || 'Container';
    return rawLabel || `Target ${index + 1}`;
}

function syntheticDisplayNode(display = null) {
    const id = displayId(display, 'display');
    const bounds = displayVisibleBounds(display);
    const projectionRect = bounds ? { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h } : null;
    return {
        id: `selection-mode-display:${id}`,
        address: `sigil:display:${id}:selection-root`,
        role: 'selection-root',
        subject_kind: 'display',
        label: shortDisplayLabel(display),
        projection: {
            visible_display_rect: projectionRect,
            display_space_rect: projectionRect,
        },
        source_metadata: {
            display_id: id,
            synthetic_lineage_root: true,
        },
    };
}

function pathDisplayNode(path = []) {
    return path.find((node) => normalizeRoleToken(node) === 'display') || null;
}

function hasUnionRoot(path = []) {
    return path.some((node) => normalizeRoleToken(node) === 'union');
}

function selectablePath(path = [], activeDisplay = null) {
    if (!Array.isArray(path) || !path.length) return [];
    const hasDisplay = !!pathDisplayNode(path);
    const next = [];
    if (!hasDisplay && activeDisplay && hasUnionRoot(path)) {
        next.push(syntheticDisplayNode(activeDisplay));
    }
    for (const node of path) {
        const token = normalizeRoleToken(node);
        if (token === 'union' && (hasDisplay || activeDisplay)) continue;
        next.push(node);
    }
    return next.filter((node) => nodeId(node));
}

function projectBounds(bounds = null, projectPoint = (point) => point) {
    if (!bounds) return null;
    const origin = projectPoint({ x: bounds.x, y: bounds.y, valid: true });
    const opposite = projectPoint({ x: bounds.x + bounds.w, y: bounds.y + bounds.h, valid: true });
    if (!origin || !opposite) return null;
    const x = Math.min(origin.x, opposite.x);
    const y = Math.min(origin.y, opposite.y);
    const width = Math.abs(opposite.x - origin.x) || bounds.w;
    const height = Math.abs(opposite.y - origin.y) || bounds.h;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

function nodeProjectionBounds(node = null) {
    return rectToBounds(
        node?.projection?.visible_display_rect
        || node?.projection?.display_space_rect
        || node?.visible_display_rect
        || node?.display_space_rect
        || node?.rect
    );
}

function overlayBoundsRect(overlayBounds = null) {
    const bounds = rectToBounds(overlayBounds);
    return bounds
        ? { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h }
        : null;
}

function activeDisplayForLineage({
    displays = [],
    acquisitionPointer = null,
    cursor = null,
    path = [],
} = {}) {
    return findDisplayForPoint(displays, acquisitionPointer)
        || findDisplayForPoint(displays, cursor)
        || (() => {
            const displayNode = pathDisplayNode(path);
            const displayNodeBounds = nodeProjectionBounds(displayNode);
            if (!displayNodeBounds) return null;
            return findDisplayForPoint(displays, rectCenter(displayNodeBounds));
        })()
        || (Array.isArray(displays) ? displays[0] : null)
        || null;
}

function activeDisplayProjectedRect({
    activeDisplay = null,
    path = [],
    overlayBounds = null,
    projectPoint = (point) => point,
} = {}) {
    const displayBounds = displayVisibleBounds(activeDisplay);
    const projectedDisplay = projectBounds(displayBounds, projectPoint);
    if (projectedDisplay) return projectedDisplay;
    const displayNode = pathDisplayNode(path) || path[0] || null;
    const nodeBounds = nodeProjectionBounds(displayNode);
    const projectedNode = projectBounds(nodeBounds, projectPoint);
    if (projectedNode) return projectedNode;
    return overlayBoundsRect(overlayBounds);
}

function desiredItemWidth(label = '') {
    return clamp(String(label).length * 7 + 18, BAR_ITEM_MIN_WIDTH, BAR_ITEM_MAX_WIDTH);
}

function distributeItemWidths(items = [], availableWidth = 0) {
    if (!items.length) return [];
    const desired = items.map((item) => desiredItemWidth(item.label));
    const desiredTotal = desired.reduce((sum, width) => sum + width, 0);
    if (desiredTotal <= availableWidth) return desired;
    const minWidth = Math.max(14, Math.min(BAR_ITEM_MIN_WIDTH, Math.floor(availableWidth / items.length)));
    const minTotal = minWidth * items.length;
    if (minTotal >= availableWidth) {
        const base = Math.max(10, Math.floor(availableWidth / items.length));
        let remainder = Math.max(0, Math.floor(availableWidth - base * items.length));
        return items.map(() => base + (remainder-- > 0 ? 1 : 0));
    }
    const extra = availableWidth - minTotal;
    const desiredExtra = desired
        .map((width) => Math.max(0, width - minWidth))
        .reduce((sum, width) => sum + width, 0);
    return desired.map((width) => minWidth + (desiredExtra > 0
        ? Math.floor((Math.max(0, width - minWidth) / desiredExtra) * extra)
        : 0));
}

function lineageBarStyle(visualStyle = null) {
    const lineage = visualStyle?.lineage || {};
    return {
        surface: {
            fill: 'rgba(8, 12, 18, 0.72)',
            stroke: visualStyle?.aura?.secondary || 'rgba(142, 221, 255, 0.54)',
            shadow: visualStyle?.aura?.glow || 'rgba(94, 252, 210, 0.24)',
        },
        item: {
            fill: 'rgba(255, 255, 255, 0.065)',
            stroke: 'rgba(255, 255, 255, 0.1)',
            text: lineage.inactive?.text || 'rgba(238, 248, 255, 0.9)',
        },
        selected: {
            fill: lineage.active?.fill || 'rgba(12, 22, 28, 0.82)',
            stroke: lineage.active?.stroke || 'rgba(94, 252, 210, 0.86)',
            text: lineage.active?.text || 'rgba(255, 255, 255, 0.95)',
        },
        hovered: {
            fill: 'rgba(255, 255, 255, 0.12)',
            stroke: visualStyle?.highlight?.stroke || 'rgba(255, 255, 255, 0.78)',
            text: 'rgba(255, 255, 255, 0.98)',
        },
        leaf: {
            stroke: lineage.leaf?.ring || visualStyle?.aura?.secondary || 'rgba(142, 221, 255, 0.82)',
        },
        separator: {
            text: 'rgba(238, 248, 255, 0.36)',
        },
    };
}

export function buildSelectionModeLineageBarModel({
    path = [],
    activeNodeId = '',
    hoverNodeId = '',
    leafNodeId = '',
    acquisitionPointer = null,
    cursor = null,
    manualPosition = null,
    displays = [],
    overlayBounds = null,
    projectPoint = (point) => point,
    visualStyle = null,
} = {}) {
    const activeDisplay = activeDisplayForLineage({ displays, acquisitionPointer, cursor, path });
    const displayRect = activeDisplayProjectedRect({ activeDisplay, path, overlayBounds, projectPoint });
    const lineagePath = selectablePath(path, activeDisplay);
    if (!displayRect || !lineagePath.length) {
        return {
            lineageBar: {
                visible: false,
                items: [],
                activeDisplayId: displayId(activeDisplay) || null,
                selectedNodeId: activeNodeId || '',
                hoverNodeId: hoverNodeId || '',
                leafNodeId: leafNodeId || '',
            },
        };
    }

    const activeDisplayId = displayId(activeDisplay) || null;
    const displayWidth = Math.max(1, displayRect.width);
    const maxBarWidth = Math.max(1, Math.min(BAR_MAX_WIDTH, displayWidth - BAR_DISPLAY_MARGIN * 2));
    const separatorWidth = lineagePath.length > 8 ? Math.max(6, Math.floor(BAR_SEPARATOR_WIDTH * 0.65)) : BAR_SEPARATOR_WIDTH;
    const items = lineagePath.map((node, index) => ({
        id: `selection-mode-lineage:${nodeId(node)}`,
        kind: 'lineage_item',
        nodeId: nodeId(node),
        address: node.address,
        label: labelForNode(node, { index, activeDisplay }),
        title: nodeTitle(node, `Target ${index + 1}`),
        pathIndex: path.findIndex((pathNode) => nodeId(pathNode) === nodeId(node)),
        lineageIndex: index,
        token: normalizeRoleToken(node),
        selected: nodeId(node) === activeNodeId,
        hovered: nodeId(node) === hoverNodeId,
        leaf: nodeId(node) === leafNodeId,
        source: node.source_metadata?.synthetic_lineage_root ? 'active_display' : 'context_session_path',
    }));
    const desiredInnerWidth = items
        .map((item) => desiredItemWidth(item.label))
        .reduce((sum, width) => sum + width, 0)
        + Math.max(0, items.length - 1) * separatorWidth;
    const barWidth = Math.min(maxBarWidth, Math.max(Math.min(48, maxBarWidth), desiredInnerWidth + BAR_PADDING_X * 2));
    const explicitVisibleBounds = displayExplicitVisibleBounds(activeDisplay);
    const rawDisplayBounds = displayRawBounds(activeDisplay);
    const explicitTopInset = explicitVisibleBounds && rawDisplayBounds
        ? Math.abs(explicitVisibleBounds.y - rawDisplayBounds.y)
        : 0;
    const needsMenuBarFallback = !!activeDisplay && explicitTopInset < 18;
    const topInset = needsMenuBarFallback
        ? BAR_TOP_MARGIN + BAR_MENU_BAR_FALLBACK_INSET
        : BAR_TOP_MARGIN;
    const defaultBarX = clamp(
        displayRect.x + displayRect.width / 2 - barWidth / 2,
        displayRect.x + BAR_DISPLAY_MARGIN,
        displayRect.x + displayRect.width - BAR_DISPLAY_MARGIN - barWidth,
    );
    const defaultBarY = clamp(
        displayRect.y + topInset,
        displayRect.y + BAR_DISPLAY_MARGIN,
        displayRect.y + Math.max(BAR_DISPLAY_MARGIN, displayRect.height - BAR_DISPLAY_MARGIN - BAR_HEIGHT),
    );
    const manualDisplayId = String(manualPosition?.displayId || manualPosition?.display_id || '');
    const manualX = Number(manualPosition?.x);
    const manualY = Number(manualPosition?.y);
    const useManualPosition = Number.isFinite(manualX)
        && Number.isFinite(manualY)
        && (!manualDisplayId || !activeDisplayId || manualDisplayId === activeDisplayId);
    const barX = useManualPosition
        ? clamp(manualX, displayRect.x + BAR_DISPLAY_MARGIN, displayRect.x + displayRect.width - BAR_DISPLAY_MARGIN - barWidth)
        : defaultBarX;
    const barY = useManualPosition
        ? clamp(manualY, displayRect.y + BAR_DISPLAY_MARGIN, displayRect.y + Math.max(BAR_DISPLAY_MARGIN, displayRect.height - BAR_DISPLAY_MARGIN - BAR_HEIGHT))
        : defaultBarY;
    const availableItemWidth = Math.max(
        items.length * 10,
        barWidth - BAR_PADDING_X * 2 - Math.max(0, items.length - 1) * separatorWidth,
    );
    const widths = distributeItemWidths(items, availableItemWidth);
    const itemY = Math.round(barY + (BAR_HEIGHT - BAR_ITEM_HEIGHT) / 2);
    let x = Math.round(barX + BAR_PADDING_X);
    const separators = [];
    items.forEach((item, index) => {
        const width = widths[index] || BAR_ITEM_MIN_WIDTH;
        item.rect = {
            x,
            y: itemY,
            width,
            height: BAR_ITEM_HEIGHT,
        };
        if (index < items.length - 1) {
            separators.push({
                id: `selection-mode-lineage-separator:${index}`,
                label: '>',
                rect: {
                    x: x + width,
                    y: itemY,
                    width: separatorWidth,
                    height: BAR_ITEM_HEIGHT,
                },
            });
        }
        x += width + (index < items.length - 1 ? separatorWidth : 0);
    });

    return {
        lineageBar: {
            id: 'selection-mode-lineage-bar',
            kind: 'selection_lineage_bar',
            visible: true,
            order: 'root-to-leaf',
            activeDisplayId,
            activeDisplayLabel: shortDisplayLabel(activeDisplay),
            displayRect: {
                x: displayRect.x,
                y: displayRect.y,
                width: displayRect.width,
                height: displayRect.height,
            },
            rect: {
                x: Math.round(barX),
                y: Math.round(barY),
                width: Math.round(barWidth),
                height: BAR_HEIGHT,
            },
            defaultRect: {
                x: Math.round(defaultBarX),
                y: Math.round(defaultBarY),
                width: Math.round(barWidth),
                height: BAR_HEIGHT,
            },
            placement: useManualPosition ? 'manual' : 'default_menu_bar_below',
            draggable: true,
            maxWidth: Math.round(maxBarWidth),
            itemCount: items.length,
            selectedNodeId: activeNodeId || '',
            hoverNodeId: hoverNodeId || '',
            leafNodeId: leafNodeId || '',
            items,
            separators,
            style: lineageBarStyle(visualStyle),
        },
    };
}

export function hitTestSelectionModeLineageItem(overlay = {}, point = null) {
    if (!point || overlay?.lineageBar?.visible !== true || !Array.isArray(overlay.lineageBar.items)) return null;
    return overlay.lineageBar.items.find((item) => pointInBounds(point, item.rect)) || null;
}

export function hitTestSelectionModeLineageBar(overlay = {}, point = null) {
    if (!point || overlay?.lineageBar?.visible !== true) return null;
    const item = hitTestSelectionModeLineageItem(overlay, point);
    if (item) return { kind: 'item', id: item.id, nodeId: item.nodeId, item };
    if (pointInBounds(point, overlay.lineageBar.rect)) {
        return {
            kind: 'bar',
            id: overlay.lineageBar.id || 'selection-mode-lineage-bar',
            rect: overlay.lineageBar.rect,
        };
    }
    return null;
}
