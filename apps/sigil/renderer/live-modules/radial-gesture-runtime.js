import { toolkitSpecifier } from './content-roots.js';

const toolkit = await import(toolkitSpecifier('runtime/radial-gesture.js'));

export const {
    createRadialGestureModel,
    radialItemPointerMetrics,
    resolveRadialGestureConfig,
    resolveRadialGestureItems,
} = toolkit;
