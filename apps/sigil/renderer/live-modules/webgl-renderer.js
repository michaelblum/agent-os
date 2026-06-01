export function transparentSigilRendererOptions(overrides = {}) {
    return {
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
        ...overrides,
    };
}

export function viewportPixelRatio() {
    const ratio = Number(globalThis.window?.devicePixelRatio);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function configureTransparentSigilRenderer(renderer, {
    width = globalThis.window?.innerWidth || 1,
    height = globalThis.window?.innerHeight || 1,
    pixelRatio = viewportPixelRatio(),
    updatePixelRatio = true,
} = {}) {
    if (!renderer) return null;
    if (updatePixelRatio && typeof renderer.setPixelRatio === 'function') {
        renderer.setPixelRatio(pixelRatio);
    }
    renderer.setSize?.(width, height);
    renderer.setClearColor?.(0x000000, 0);
    return {
        width,
        height,
        pixelRatio,
        premultipliedAlpha: false,
    };
}
