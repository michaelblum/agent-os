const BAR_HEIGHT = 34;
const BAR_TOP_MARGIN = 10;
const BAR_MENU_BAR_FALLBACK_INSET = 24;
const BAR_DISPLAY_MARGIN = 8;
const BAR_PADDING_X = 8;
const BAR_ITEM_HEIGHT = 24;
const BAR_ITEM_MIN_WIDTH = 28;
const BAR_ITEM_MAX_WIDTH = 180;
const BAR_SEPARATOR_WIDTH = 12;
const BAR_MAX_WIDTH = 720;
const BAR_COMMENT_ICON_SIZE = 10;
const BAR_COMMENT_ICON_GAP = 4;
const BAR_CONTEXT_MENU_WIDTH = 138;
const BAR_CONTEXT_MENU_ITEM_HEIGHT = 22;
const BAR_CONTEXT_MENU_PADDING = 4;

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

function displayOwnerId(owner = null) {
    if (!owner || typeof owner !== 'object') return '';
    return String(owner.display_id ?? owner.displayId ?? owner.id ?? owner.display?.display_id ?? owner.display?.id ?? '').trim();
}

function findDisplayById(displays = [], id = '') {
    const target = String(id || '').trim();
    if (!target) return null;
    return (Array.isArray(displays) ? displays : [])
        .find((display, index) => displayId(display, `index:${index}`) === target) || null;
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

function intersectRect(a = null, b = null) {
    if (!a || !b) return null;
    const ax = Number(a.x);
    const ay = Number(a.y);
    const aw = Number(a.width ?? a.w);
    const ah = Number(a.height ?? a.h);
    const bx = Number(b.x);
    const by = Number(b.y);
    const bw = Number(b.width ?? b.w);
    const bh = Number(b.height ?? b.h);
    if (![ax, ay, aw, ah, bx, by, bw, bh].every(Number.isFinite)) return null;
    const x = Math.max(ax, bx);
    const y = Math.max(ay, by);
    const right = Math.min(ax + aw, bx + bw);
    const bottom = Math.min(ay + ah, by + bh);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
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

function roleTokenForText(text = '') {
    if (text.includes('union')) return 'union';
    if (text.includes('desktopworld') || text.includes('desktop_world') || /\bdesktop\b/.test(text)) return 'desktop';
    if (text.includes('display') || text.includes('screen')) return 'display';
    if (text.includes('browser_tab') || text.includes('browser tab') || /\btab\b/.test(text)) return 'browser_tab';
    if (text.includes('document') || /\bdom\b/.test(text)) return 'document';
    if (/\bbody\b/.test(text) || text.includes('document body')) return 'body';
    if (text.includes('native_app') || text.includes('application') || /\bapp\b/.test(text)) return 'app';
    if (text.includes('canvas')) return 'canvas';
    if (text.includes('image')) return 'image';
    if (text.includes('native_window') || /\bwindow\b/.test(text)) return 'window';
    if (text.includes('split')) return 'split';
    if (text.includes('outline')) return 'outline';
    if (text.includes('row')) return 'row';
    if (text.includes('editor')) return 'editor';
    if (text.includes('sidebar') || text.includes('side bar')) return 'sidebar';
    if (text.includes('toolbar') || text.includes('tool bar')) return 'toolbar';
    if (text.includes('button')) return 'button';
    if (text.includes('statictext') || text.includes('static text') || /\btext\b/.test(text)) return 'text';
    if (text.includes('layout')) return 'layout';
    if (text.includes('container') || text.includes('group')) return 'container';
    return '';
}

function normalizeRoleToken(node = {}) {
    const structuralText = [
        node.role,
        node.kind,
        node.subject_kind,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    const structuralToken = roleTokenForText(structuralText);
    if (structuralToken) return structuralToken;
    const labelText = [
        node.label,
        node.name,
        node.title,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    const labelToken = roleTokenForText(labelText);
    if (labelToken) return labelToken;
    const identityText = [
        node.address,
        node.id,
        node.subject_id,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    return roleTokenForText(identityText);
}

function nodeId(node = {}) {
    return String(node.id || node.node_id || node.address || node.subject_id || '').trim();
}

function nodeTitle(node = {}, fallback = '') {
    const role = String(node.role || node.subject_kind || node.kind || '').trim();
    const label = labelForNode(node, { fallback });
    return role && role !== label ? `${label} (${role})` : label;
}

function shortDisplayLabel(display = null) {
    const label = String(display?.label || display?.name || '').trim();
    if (label) return label;
    const id = displayId(display);
    return id ? `Display ${id}` : 'Display';
}

function compactUrlLabel(value = '') {
    try {
        const url = new URL(String(value));
        const path = url.pathname && url.pathname !== '/' ? url.pathname.split('/').filter(Boolean).at(-1) : '';
        return path ? `${url.hostname}/${path}` : url.hostname;
    } catch {
        return '';
    }
}

function isGenericLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized
        || normalized === 'axgroup'
        || normalized === 'axsplitgroup'
        || normalized === 'axoutline'
        || normalized === 'axrow'
        || normalized === 'group'
        || normalized === 'container'
        || normalized === 'layout'
        || normalized === 'row'
        || normalized === 'text'
        || normalized === 'static text'
        || normalized === 'button'
        || normalized === 'window'
        || normalized === 'application'
        || normalized === 'display';
}

function metadataLabel(node = {}) {
    const metadata = node.source_metadata || node.metadata || {};
    const candidates = [
        node.title,
        node.accessible_name,
        node.value,
        metadata.title,
        metadata.accessible_name,
        metadata.value,
        metadata.ax_title,
        metadata.ax_description,
        metadata.dom_label,
        metadata.text_excerpt,
        metadata.name,
        metadata.identifier,
        metadata.target_id,
        metadata.data_aos_ref,
        metadata.aos_ref,
    ];
    for (const candidate of candidates) {
        const label = String(candidate || '').trim();
        if (label && !isGenericLabel(label)) return label;
    }
    const urlLabel = compactUrlLabel(metadata.active_url || metadata.source_url || node.source_url || '');
    if (urlLabel) return urlLabel;
    return '';
}

function labelForNode(node = {}, { index = 0, activeDisplay = null, fallback = '' } = {}) {
    const token = normalizeRoleToken(node);
    const rawLabel = String(node.label || node.name || node.subject_id || node.address || node.id || '').trim();
    const semanticLabel = !isGenericLabel(rawLabel) ? rawLabel : metadataLabel(node);
    if (token === 'display') return rawLabel || shortDisplayLabel(activeDisplay);
    if (token === 'desktop') return 'Desktop';
    if (token === 'app') return semanticLabel || 'App';
    if (token === 'window') return semanticLabel || 'Window';
    if (token === 'browser_tab') return semanticLabel || 'Tab';
    if (token === 'canvas') return semanticLabel || 'Canvas';
    if (token === 'document') return semanticLabel || 'DOM';
    if (token === 'body') return semanticLabel || 'Body';
    if (token === 'split') return semanticLabel || 'Split';
    if (token === 'outline') return semanticLabel || 'Outline';
    if (token === 'row') return semanticLabel || `Row ${index + 1}`;
    if (token === 'editor') return semanticLabel || 'Editor';
    if (token === 'sidebar') return semanticLabel || 'Sidebar';
    if (token === 'toolbar') return semanticLabel || 'Toolbar';
    if (token === 'button') return semanticLabel || 'Button';
    if (token === 'text') return semanticLabel || 'Text';
    if (token === 'image') return semanticLabel || 'Image';
    if (token === 'layout') return semanticLabel || 'Layout';
    if (token === 'container') return semanticLabel || 'Container';
    return semanticLabel || rawLabel || fallback || `Target ${index + 1}`;
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

function lineageNodeKey(node = {}) {
    return [
        nodeId(node),
        String(node.address || '').trim(),
        String(node.subject_id || '').trim(),
    ].filter(Boolean).join('|');
}

function collapseAdjacentDuplicateNodes(path = []) {
    if (!Array.isArray(path) || !path.length) return [];
    const collapsed = [];
    let priorKey = '';
    for (const node of path) {
        const key = lineageNodeKey(node);
        if (!key) continue;
        if (key === priorKey) continue;
        collapsed.push(node);
        priorKey = key;
    }
    return collapsed;
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
    activeDisplay = null,
    activeDisplayId = '',
    displayOwner = null,
    acquisitionPointer = null,
    cursor = null,
    path = [],
} = {}) {
    const entries = Array.isArray(displays) ? displays : [];
    const explicitId = displayOwnerId(displayOwner)
        || displayOwnerId(activeDisplay)
        || String(activeDisplayId || '').trim();
    const explicitDisplay = findDisplayById(entries, explicitId);
    if (explicitDisplay) return explicitDisplay;
    if (!entries.length && activeDisplay && displayVisibleBounds(activeDisplay)) return activeDisplay;
    return findDisplayForPoint(entries, acquisitionPointer)
        || findDisplayForPoint(entries, cursor)
        || (() => {
            const displayNode = pathDisplayNode(path);
            const displayNodeBounds = nodeProjectionBounds(displayNode);
            if (!displayNodeBounds) return null;
            return findDisplayForPoint(entries, rectCenter(displayNodeBounds));
        })()
        || entries[0]
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

function commentCountForNode(node = {}) {
    if (!node || typeof node !== 'object') return 0;
    if (Number.isFinite(Number(node.comment_count))) return Math.max(0, Number(node.comment_count));
    if (Number.isFinite(Number(node.commentCount))) return Math.max(0, Number(node.commentCount));
    return Array.isArray(node.comments) ? node.comments.filter((comment) => comment && comment.status !== 'removed').length : 0;
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
        comment: {
            fill: lineage.action?.fill || 'rgba(255, 255, 255, 0.08)',
            stroke: lineage.action?.stroke || 'rgba(255, 255, 255, 0.16)',
            icon: lineage.action?.text || 'rgba(238, 248, 255, 0.92)',
            badgeFill: lineage.action?.mutedFill || 'rgba(255, 255, 255, 0.04)',
            badgeStroke: lineage.action?.mutedStroke || 'rgba(255, 255, 255, 0.08)',
            badgeIcon: lineage.action?.mutedIcon || 'rgba(238, 248, 255, 0.42)',
        },
        menu: {
            fill: lineage.action?.fill || 'rgba(14, 18, 24, 0.94)',
            stroke: lineage.action?.stroke || 'rgba(142, 221, 255, 0.34)',
            text: lineage.action?.text || 'rgba(238, 248, 255, 0.94)',
            mutedText: lineage.action?.mutedIcon || 'rgba(238, 248, 255, 0.5)',
            hoverFill: lineage.action?.mutedFill || 'rgba(255, 255, 255, 0.08)',
        },
    };
}

function centeredScrollOffsetForItem(item = null, { barWidth = 0, maxScrollOffset = 0 } = {}) {
    if (!item?.localRect) return null;
    const itemCenter = item.localRect.x + item.localRect.width / 2;
    return clamp(itemCenter - barWidth / 2, 0, maxScrollOffset);
}

function commentIconRectForItem(item = null) {
    const rect = item?.rect || null;
    if (!rect || !item?.hasComment) return null;
    const size = BAR_COMMENT_ICON_SIZE;
    const x = Math.round(rect.x + rect.width - size - 6);
    const y = Math.round(rect.y + ((rect.height - size) / 2));
    return {
        x,
        y,
        width: size,
        height: size,
    };
}

function contextMenuRectForAnchor(anchorRect = null, barRect = null) {
    if (!anchorRect || !barRect) return null;
    const width = BAR_CONTEXT_MENU_WIDTH;
    const itemCount = 3;
    const height = (BAR_CONTEXT_MENU_ITEM_HEIGHT * itemCount) + (BAR_CONTEXT_MENU_PADDING * 2);
    const preferredX = Math.round(anchorRect.x + anchorRect.width + 8);
    const preferredY = Math.round(anchorRect.y - 2);
    const x = clamp(
        preferredX,
        Math.round(barRect.x + BAR_CONTEXT_MENU_PADDING),
        Math.round(barRect.x + barRect.width - width - BAR_CONTEXT_MENU_PADDING),
    );
    const y = clamp(
        preferredY,
        Math.round(barRect.y + BAR_CONTEXT_MENU_PADDING),
        Math.round(barRect.y + barRect.height - height - BAR_CONTEXT_MENU_PADDING),
    );
    return { x, y, width, height };
}

function makeLineageContextMenu(menuState = null, items = [], barRect = null) {
    if (!menuState?.visible || !Array.isArray(items) || !items.length || !barRect) return null;
    const anchorNodeId = String(menuState.node_id || menuState.anchor_node_id || '').trim();
    const anchorItem = items.find((item) => item.nodeId === anchorNodeId || item.id === menuState.item_id) || items[0] || null;
    if (!anchorItem?.rect) return null;
    const rect = contextMenuRectForAnchor(anchorItem.rect, barRect);
    if (!rect) return null;
    const menuItems = [
        { id: 'snapshot', action: 'snapshot', label: 'Snapshot', enabled: true },
        { id: 'record', action: 'record', label: 'Record', enabled: true },
        { id: 'add_comment', action: 'add_comment', label: 'Add comment', enabled: true },
    ].map((entry, index) => {
        const itemRect = {
            x: rect.x + BAR_CONTEXT_MENU_PADDING,
            y: rect.y + BAR_CONTEXT_MENU_PADDING + (index * BAR_CONTEXT_MENU_ITEM_HEIGHT),
            width: rect.width - (BAR_CONTEXT_MENU_PADDING * 2),
            height: BAR_CONTEXT_MENU_ITEM_HEIGHT,
        };
        return {
            ...entry,
            rect: itemRect,
            visibleRect: intersectRect(itemRect, barRect),
            anchorNodeId,
            hovered: String(menuState.hovered_item_id || '') === entry.id,
            pressed: String(menuState.pressed_item_id || '') === entry.id,
        };
    });
    return {
        visible: true,
        nodeId: anchorNodeId,
        itemId: anchorItem.id,
        pointer: menuState.pointer || null,
        rect,
        items: menuItems,
        style: lineageBarStyle().menu,
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
    scrollOffset = 0,
    scrollTargetNodeId = null,
    displays = [],
    activeDisplay: explicitActiveDisplay = null,
    activeDisplayId: explicitActiveDisplayId = '',
    displayOwner = null,
    overlayBounds = null,
    projectPoint = (point) => point,
    visualStyle = null,
    lineageContextMenu = null,
} = {}) {
    const activeDisplay = activeDisplayForLineage({
        displays,
        activeDisplay: explicitActiveDisplay,
        activeDisplayId: explicitActiveDisplayId,
        displayOwner,
        acquisitionPointer,
        cursor,
        path,
    });
    const displayRect = activeDisplayProjectedRect({ activeDisplay, path, overlayBounds, projectPoint });
    const lineagePath = collapseAdjacentDuplicateNodes(selectablePath(path, activeDisplay));
    if (!displayRect || !lineagePath.length) {
        return {
            lineageBar: {
                visible: false,
                items: [],
                lineageContextMenu: null,
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
    const items = lineagePath.map((node, index) => {
        const commentCount = commentCountForNode(node);
        return {
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
        commentCount,
        hasComment: commentCount > 0,
        comments: Array.isArray(node.comments) ? node.comments.filter((comment) => comment && comment.status !== 'removed') : [],
    };
    });
    const widths = items.map((item) => desiredItemWidth(item.label) + (item.hasComment ? BAR_COMMENT_ICON_SIZE + BAR_COMMENT_ICON_GAP + 4 : 0));
    const desiredInnerWidth = widths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, items.length - 1) * separatorWidth;
    const contentWidth = desiredInnerWidth + BAR_PADDING_X * 2;
    const barWidth = Math.min(maxBarWidth, Math.max(Math.min(48, maxBarWidth), contentWidth));
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
    const maxScrollOffset = Math.max(0, contentWidth - barWidth);
    const itemY = Math.round(barY + (BAR_HEIGHT - BAR_ITEM_HEIGHT) / 2);
    const barRect = {
        x: Math.round(barX),
        y: Math.round(barY),
        width: Math.round(barWidth),
        height: BAR_HEIGHT,
    };
    let localX = BAR_PADDING_X;
    const separators = [];
    items.forEach((item, index) => {
        const width = widths[index] || BAR_ITEM_MIN_WIDTH;
        item.localRect = {
            x: localX,
            y: Math.round((BAR_HEIGHT - BAR_ITEM_HEIGHT) / 2),
            width,
            height: BAR_ITEM_HEIGHT,
        };
        item.contentRect = {
            x: Math.round(barX + localX),
            y: itemY,
            width,
            height: BAR_ITEM_HEIGHT,
        };
        if (index < items.length - 1) {
            separators.push({
                id: `selection-mode-lineage-separator:${index}`,
                label: '>',
                localRect: {
                    x: localX + width,
                    y: Math.round((BAR_HEIGHT - BAR_ITEM_HEIGHT) / 2),
                    width: separatorWidth,
                    height: BAR_ITEM_HEIGHT,
                },
                contentRect: {
                    x: Math.round(barX + localX + width),
                    y: itemY,
                    width: separatorWidth,
                    height: BAR_ITEM_HEIGHT,
                },
            });
        }
        localX += width + (index < items.length - 1 ? separatorWidth : 0);
    });
    const targetNodeId = scrollTargetNodeId == null
        ? String(hoverNodeId || activeNodeId || leafNodeId || '').trim()
        : String(scrollTargetNodeId || '').trim();
    const targetItem = targetNodeId ? items.find((item) => item.nodeId === targetNodeId || item.address === targetNodeId) : null;
    const requestedScrollOffset = Number(scrollOffset);
    const normalizedManualScrollOffset = clamp(Number.isFinite(requestedScrollOffset) ? requestedScrollOffset : 0, 0, maxScrollOffset);
    const centeredScrollOffset = centeredScrollOffsetForItem(targetItem, { barWidth, maxScrollOffset });
    const resolvedScrollOffset = centeredScrollOffset == null ? normalizedManualScrollOffset : centeredScrollOffset;
    items.forEach((item) => {
        item.rect = {
            x: Math.round(item.contentRect.x - resolvedScrollOffset),
            y: item.contentRect.y,
            width: item.contentRect.width,
            height: item.contentRect.height,
        };
        item.visibleRect = intersectRect(item.rect, barRect);
        item.commentIconRect = commentIconRectForItem(item);
        item.commentIconVisibleRect = item.commentIconRect ? intersectRect(item.commentIconRect, barRect) : null;
    });
    separators.forEach((separator) => {
        separator.rect = {
            x: Math.round(separator.contentRect.x - resolvedScrollOffset),
            y: separator.contentRect.y,
            width: separator.contentRect.width,
            height: separator.contentRect.height,
        };
        separator.visibleRect = intersectRect(separator.rect, barRect);
    });
    const contextMenu = makeLineageContextMenu(lineageContextMenu, items, barRect);

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
            rect: barRect,
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
            contentWidth: Math.round(contentWidth),
            viewportWidth: Math.round(barWidth),
            scrollOffset: Math.round(resolvedScrollOffset),
            maxScrollOffset: Math.round(maxScrollOffset),
            scrollTargetNodeId: targetItem?.nodeId || '',
            scroll: {
                axis: 'x',
                offset: Math.round(resolvedScrollOffset),
                maxOffset: Math.round(maxScrollOffset),
                contentWidth: Math.round(contentWidth),
                viewportWidth: Math.round(barWidth),
                targetNodeId: targetItem?.nodeId || '',
                centered: centeredScrollOffset != null,
            },
            selectedNodeId: activeNodeId || '',
            hoverNodeId: hoverNodeId || '',
            leafNodeId: leafNodeId || '',
            items,
            separators,
            lineageContextMenu: contextMenu,
            style: lineageBarStyle(visualStyle),
        },
    };
}

export function hitTestSelectionModeLineageItem(overlay = {}, point = null) {
    if (!point || overlay?.lineageBar?.visible !== true || !Array.isArray(overlay.lineageBar.items)) return null;
    if (!pointInBounds(point, overlay.lineageBar.rect)) return null;
    return overlay.lineageBar.items.find((item) => pointInBounds(point, item.rect)) || null;
}

export function hitTestSelectionModeLineageMenu(overlay = {}, point = null) {
    if (!point || overlay?.lineageBar?.visible !== true) return null;
    const menu = overlay.lineageBar.lineageContextMenu;
    if (!menu?.visible || !Array.isArray(menu.items)) return null;
    const menuItem = menu.items.find((item) => pointInBounds(point, item.rect));
    if (menuItem) return { kind: 'menu_item', id: menuItem.id, action: menuItem.action, item: menuItem, rect: menuItem.rect };
    if (pointInBounds(point, menu.rect)) {
        return {
            kind: 'menu',
            id: menu.nodeId || menu.itemId || 'selection-mode-lineage-menu',
            rect: menu.rect,
        };
    }
    return null;
}

export function hitTestSelectionModeLineageBar(overlay = {}, point = null) {
    if (!point || overlay?.lineageBar?.visible !== true) return null;
    const menuHit = hitTestSelectionModeLineageMenu(overlay, point);
    if (menuHit) return menuHit;
    const commentItem = Array.isArray(overlay.lineageBar.items)
        ? overlay.lineageBar.items.find((entry) => entry.commentIconVisibleRect && pointInBounds(point, entry.commentIconVisibleRect))
        : null;
    if (commentItem) {
        const latestComment = Array.isArray(commentItem.comments) ? commentItem.comments.at(-1) || null : null;
        return {
            kind: 'comment',
            id: `selection-mode-lineage-comment:${commentItem.nodeId}`,
            nodeId: commentItem.nodeId,
            item: commentItem,
            commentId: latestComment?.id || '',
            comment: latestComment,
            rect: commentItem.commentIconRect || null,
        };
    }
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
