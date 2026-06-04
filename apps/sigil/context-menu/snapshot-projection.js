export function buildContextMenuSnapshot(menuState, compactSurface) {
    const controls = compactSurface?.getControlRecords?.() || [];
    return {
        open: !!menuState.open,
        bounds: menuState.bounds ? { ...menuState.bounds } : null,
        stack: null,
        activeTab: compactSurface?.getActiveTab?.() || null,
        controls,
    };
}
