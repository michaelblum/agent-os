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

const TOOLKIT_SPATIAL_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/spatial.js'
    : '../../../../packages/toolkit/runtime/spatial.js';

const {
    computeDesktopWorldBounds: toolkitComputeDesktopWorldBounds,
    computeVisibleDesktopWorldBounds: toolkitComputeVisibleDesktopWorldBounds,
    normalizeDisplays: toolkitNormalizeDisplays,
    findDisplayForPoint: toolkitFindDisplayForPoint,
    clampPointToDisplays: toolkitClampPointToDisplays,
    nativeToDesktopWorldPoint: toolkitNativeToDesktopWorldPoint,
    desktopWorldToNativePoint: toolkitDesktopWorldToNativePoint,
    globalToUnionLocalPoint: toolkitGlobalToUnionLocalPoint,
} = await import(TOOLKIT_SPATIAL_SPECIFIER);

function visibleBoundsRect(display = {}) {
    return display.visible_bounds ?? display.visibleBounds ?? display.bounds ?? { x: 0, y: 0, w: 0, h: 0 };
}

export { toolkitNormalizeDisplays as normalizeDisplays };
export { toolkitComputeDesktopWorldBounds as computeDesktopWorldBounds };
export { toolkitComputeVisibleDesktopWorldBounds as computeVisibleDesktopWorldBounds };
export { toolkitFindDisplayForPoint as findDisplayForPoint };
export { toolkitClampPointToDisplays as clampPointToDisplays };
export { toolkitNativeToDesktopWorldPoint as nativeToDesktopWorldPoint };
export { toolkitDesktopWorldToNativePoint as desktopWorldToNativePoint };
export { toolkitGlobalToUnionLocalPoint as globalToUnionLocalPoint };

export function computeWorkbenchFrame(displays = [], point, options = {}) {
    if (!point) return null;
    const display = toolkitFindDisplayForPoint(displays, point.x, point.y);
    if (!display) return null;
    const bounds = visibleBoundsRect(display);
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
    const display = toolkitFindDisplayForPoint(displays, point?.x ?? 0, point?.y ?? 0);
    if (!display) return null;
    const bounds = visibleBoundsRect(display);
    const cell = NONANT_CELLS[nonant] ?? NONANT_CELLS['top-left'];
    return {
        x: bounds.x + bounds.w * cell[0],
        y: bounds.y + bounds.h * cell[1],
    };
}
