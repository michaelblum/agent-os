const NONANT_CELLS = {
    'top-left': [1 / 6, 1 / 6],
    'top-center': [3 / 6, 1 / 6],
    'top-right': [5 / 6, 1 / 6],
    'middle-left': [1 / 6, 3 / 6],
    'middle-center': [3 / 6, 3 / 6],
    'middle-right': [5 / 6, 3 / 6],
    'bottom-left': [1 / 6, 5 / 6],
    'bottom-center': [3 / 6, 5 / 6],
    'bottom-right': [5 / 6, 5 / 6],
};

function normalizeBounds(bounds = {}) {
    return {
        x: Number(bounds.x ?? 0),
        y: Number(bounds.y ?? 0),
        w: Number(bounds.w ?? bounds.width ?? 0),
        h: Number(bounds.h ?? bounds.height ?? 0),
    };
}

function distanceSquaredToBounds(bounds, x, y) {
    const cx = Math.max(bounds.x, Math.min(x, bounds.x + bounds.w - 1));
    const cy = Math.max(bounds.y, Math.min(y, bounds.y + bounds.h - 1));
    return ((x - cx) ** 2) + ((y - cy) ** 2);
}

export function normalizeDisplays(displays = []) {
    const list = Array.isArray(displays) ? displays : [];
    return list.map((display) => ({
        ...display,
        uuid: display.uuid ?? display.display_uuid ?? null,
        is_main: Boolean(display.is_main),
        visible_bounds: normalizeBounds(display.visible_bounds ?? display.bounds ?? {}),
        bounds: normalizeBounds(display.bounds ?? display.visible_bounds ?? {}),
    }));
}

export function computeDisplayUnion(displays = []) {
    const list = normalizeDisplays(displays);
    if (list.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const display of list) {
        const bounds = display.visible_bounds;
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.w);
        maxY = Math.max(maxY, bounds.y + bounds.h);
    }
    if (!Number.isFinite(minX)) {
        return { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        minX,
        minY,
        maxX,
        maxY,
    };
}

export function desktopPointToStageLocal(globalBounds = {}, point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const originX = Number(globalBounds.minX ?? globalBounds.x ?? 0);
    const originY = Number(globalBounds.minY ?? globalBounds.y ?? 0);
    return {
        x: x - originX,
        y: y - originY,
    };
}

export function findDisplayForPoint(displays = [], x, y) {
    const list = normalizeDisplays(displays);
    let best = null;
    let bestDistance = Infinity;
    for (const display of list) {
        const bounds = display.visible_bounds;
        const inside =
            x >= bounds.x &&
            x < bounds.x + bounds.w &&
            y >= bounds.y &&
            y < bounds.y + bounds.h;
        if (inside) return display;
        const distance = distanceSquaredToBounds(bounds, x, y);
        if (distance < bestDistance) {
            best = display;
            bestDistance = distance;
        }
    }
    return best;
}

export function clampPointToDisplays(displays = [], x, y) {
    const display = findDisplayForPoint(displays, x, y);
    if (!display) return { x, y };
    const bounds = display.visible_bounds;
    return {
        x: Math.max(bounds.x, Math.min(x, bounds.x + bounds.w - 1)),
        y: Math.max(bounds.y, Math.min(y, bounds.y + bounds.h - 1)),
    };
}

export function computeWorkbenchFrame(displays = [], point, options = {}) {
    if (!point) return null;
    const display = findDisplayForPoint(displays, point.x, point.y);
    if (!display) return null;
    const bounds = display.visible_bounds;
    const marginX = options.marginX ?? 32;
    const marginY = options.marginY ?? 28;
    const minWidth = options.minWidth ?? 480;
    const minHeight = options.minHeight ?? 360;
    const usableWidth = Math.max(minWidth, bounds.w - marginX * 2);
    const usableHeight = Math.max(minHeight, bounds.h - marginY * 2);
    const width = Math.max(minWidth, Math.round((usableWidth * 2) / 3));
    const height = usableHeight;
    return [
        Math.round(bounds.x + bounds.w - marginX - width),
        Math.round(bounds.y + marginY),
        Math.round(width),
        Math.round(height),
    ];
}

export function computeDisplayNonant(displays = [], point, nonant = 'top-left') {
    const display = findDisplayForPoint(displays, point?.x ?? 0, point?.y ?? 0);
    if (!display) return null;
    const bounds = display.visible_bounds;
    const cell = NONANT_CELLS[nonant] ?? NONANT_CELLS['top-left'];
    return {
        x: bounds.x + bounds.w * cell[0],
        y: bounds.y + bounds.h * cell[1],
    };
}
