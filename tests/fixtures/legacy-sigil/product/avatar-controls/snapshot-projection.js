export function buildAvatarControlsSnapshot(surfaceState, compactSurface, options = {}) {
    const controls = compactSurface?.getControlRecords?.() || options.panelControls || [];
    return {
        open: !!surfaceState.open,
        bounds: surfaceState.bounds ? { ...surfaceState.bounds } : null,
        placementPlan: surfaceState.placementPlan ? { ...surfaceState.placementPlan } : null,
        surface: compactSurface ? 'embedded' : options.panelId ? 'toolkit-panel' : null,
        panelId: options.panelId || null,
        stack: null,
        activeTab: compactSurface?.getActiveTab?.() || options.panelActiveTab || null,
        controls,
    };
}
