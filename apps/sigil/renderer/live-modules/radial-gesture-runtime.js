const TOOLKIT_RADIAL_GESTURE_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/radial-gesture.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/radial-gesture.js'
        : '../../../../packages/toolkit/runtime/radial-gesture.js';

const toolkit = await import(TOOLKIT_RADIAL_GESTURE_SPECIFIER);

export const {
    createRadialGestureModel,
    radialItemPointerMetrics,
    resolveRadialGestureConfig,
    resolveRadialGestureItems,
} = toolkit;
