export function buildContextMenuSnapshot(menuState, compactSurface, options = {}) {
    const controls = compactSurface?.getControlRecords?.() || options.panelControls || [];
    return {
        open: !!menuState.open,
        bounds: menuState.bounds ? { ...menuState.bounds } : null,
        surface: compactSurface ? 'embedded' : options.panelId ? 'toolkit-panel' : null,
        panelId: options.panelId || null,
        stack: null,
        activeTab: compactSurface?.getActiveTab?.() || options.panelActiveTab || null,
        controls,
    };
}
