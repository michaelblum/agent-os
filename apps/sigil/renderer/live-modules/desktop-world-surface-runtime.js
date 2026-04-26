const TOOLKIT_DWS_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/desktop-world-surface-three.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/desktop-world-surface-three.js'
        : '../../../../packages/toolkit/runtime/desktop-world-surface-three.js';

export const {
    DesktopWorldSurface3D,
    DesktopWorldSurfaceThree,
} = await import(TOOLKIT_DWS_SPECIFIER);
