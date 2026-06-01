export function createContextMenuSnapshotProjection({
    anchor,
    liveJs,
    getMenuState,
    getCompactSurface,
} = {}) {
    function compactControlRecords() {
        return getCompactSurface?.()?.getControlRecords?.() || [];
    }

    function snapshot() {
        const menuState = getMenuState?.() || {};
        const compactSurface = getCompactSurface?.() || null;
        return {
            open: !!menuState.open,
            bounds: menuState.bounds ? { ...menuState.bounds } : null,
            stack: null,
            activeTab: compactSurface?.getActiveTab?.() || null,
            controls: compactControlRecords(),
        };
    }

    function syncSnapshot() {
        const menuState = getMenuState?.();
        if (!menuState) return;
        const compactSurface = getCompactSurface?.() || null;
        menuState.snapshot = {
            activeTab: compactSurface?.getActiveTab?.() || null,
            controlCount: compactControlRecords().length,
        };
        anchor?.setAttribute?.('aria-hidden', menuState.open ? 'false' : 'true');
        anchor?.setAttribute?.('data-state', menuState.open ? 'open' : 'closed');
        if (liveJs) liveJs.contextMenu = snapshot();
    }

    return {
        compactControlRecords,
        snapshot,
        syncSnapshot,
    };
}
