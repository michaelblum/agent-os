export function rectFromFrame(frame) {
    if (!Array.isArray(frame) || frame.length < 4) return null;
    const rect = {
        x: Number(frame[0]),
        y: Number(frame[1]),
        w: Number(frame[2]),
        h: Number(frame[3]),
    };
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
    if (rect.w <= 0 || rect.h <= 0) return null;
    return rect;
}

export function frameFromRectDictionary(rect) {
    if (!rect || typeof rect !== 'object') return null;
    return rectFromFrame([
        rect.x,
        rect.y,
        rect.w ?? rect.width,
        rect.h ?? rect.height,
    ]);
}

function rectContainsRect(outer, inner) {
    return !!(outer && inner
        && inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w
        && inner.y + inner.h <= outer.y + outer.h);
}

function rectContainsPoint(rect, point) {
    return !!(rect && point
        && point.x >= rect.x
        && point.y >= rect.y
        && point.x < rect.x + rect.w
        && point.y < rect.y + rect.h);
}

function displayViewportRect(display = {}) {
    return frameFromRectDictionary(display.nativeVisibleBounds)
        || frameFromRectDictionary(display.native_visible_bounds)
        || frameFromRectDictionary(display.visibleBounds)
        || frameFromRectDictionary(display.visible_bounds)
        || frameFromRectDictionary(display.nativeBounds)
        || frameFromRectDictionary(display.native_bounds)
        || frameFromRectDictionary(display.bounds);
}

export function nativeVisibleViewportForRect(displays = [], rect) {
    const viewports = (Array.isArray(displays) ? displays : [])
        .map(displayViewportRect)
        .filter(Boolean);
    return viewports.find((viewport) => rectContainsRect(viewport, rect))
        || viewports.find((viewport) => rectContainsPoint(viewport, {
            x: rect?.x + rect?.w / 2,
            y: rect?.y + rect?.h / 2,
        }))
        || null;
}

export function panelNativeFrameFromLifecycle(message = {}) {
    const canvas = message.canvas || {};
    return rectFromFrame(canvas.placement?.final_settled_frame)
        || rectFromFrame(canvas.placement?.policy_adjusted_frame)
        || rectFromFrame(canvas.at)
        || rectFromFrame(message.at);
}

export function avatarNativeFrame({
    avatarPos = null,
    avatarHitRadius = 0,
    displays = [],
    desktopWorldToNativePoint = null,
} = {}) {
    if (!avatarPos?.valid) return null;
    const center = typeof desktopWorldToNativePoint === 'function'
        ? (desktopWorldToNativePoint(avatarPos, displays) || avatarPos)
        : avatarPos;
    const size = Math.max(1, Math.round(avatarHitRadius * 2));
    const half = size / 2;
    return [
        Math.round(center.x - half),
        Math.round(center.y - half),
        size,
        size,
    ];
}

export function panelFrameToAvatarControlsBounds(frame, {
    displays = [],
    nativeToDesktopWorldRect = null,
} = {}) {
    const nativeRect = Array.isArray(frame) ? rectFromFrame(frame) : frameFromRectDictionary(frame);
    if (!nativeRect) return null;
    return typeof nativeToDesktopWorldRect === 'function'
        ? (nativeToDesktopWorldRect(nativeRect, displays) || nativeRect)
        : nativeRect;
}

export function resolveAvatarPanelLifecycleAvoidance(message = {}, {
    avatarControlsOpen = false,
    avatarVisible = false,
    avatarPos = null,
    avatarHitRadius = 0,
    displays = [],
    desktopWorldToNativePoint = null,
    nativeToDesktopWorldPoint = null,
    resolveAvatarPanelAvoidancePosition = null,
    margin = 12,
} = {}) {
    if (!avatarControlsOpen || !avatarVisible || !avatarPos?.valid) return null;
    if (typeof resolveAvatarPanelAvoidancePosition !== 'function') return null;
    const panelRect = panelNativeFrameFromLifecycle(message);
    const avatarRect = rectFromFrame(avatarNativeFrame({
        avatarPos,
        avatarHitRadius,
        displays,
        desktopWorldToNativePoint,
    }));
    const viewport = nativeVisibleViewportForRect(displays, panelRect);
    const next = resolveAvatarPanelAvoidancePosition({
        avatarRect,
        panelRect,
        viewport,
        margin,
    });
    if (!next || next.overlap !== 0) return null;
    const desktopPoint = typeof nativeToDesktopWorldPoint === 'function'
        ? (nativeToDesktopWorldPoint({ x: next.x, y: next.y }, displays) || { x: next.x, y: next.y })
        : { x: next.x, y: next.y };
    return {
        panelRect,
        avatarRect,
        viewport,
        next,
        desktopPoint,
    };
}
