import { toolkitSpecifier } from './content-roots.js';

export const {
    DesktopWorldSurface3D,
    DesktopWorldSurfaceThree,
} = await import(toolkitSpecifier('runtime/desktop-world-surface-three.js'));
