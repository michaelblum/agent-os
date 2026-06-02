let compactSurfaceModulePromise = null;

function loadCompactSurfaceModule() {
    compactSurfaceModulePromise ||= import('../avatar-editor/compact-surface.js');
    return compactSurfaceModulePromise;
}

function cacheKey(value) {
    if (value === undefined) return 'undefined';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function requiredFunction(name, value) {
    if (typeof value !== 'function') {
        throw new TypeError(`Sigil context menu compact surface session requires ${name}.`);
    }
    return value;
}

export function createContextMenuCompactSurfaceSession({
    anchor,
    state,
    document,
    visualObjectBinding,
    routeDescriptorUpdate,
    onUtilityAction,
    onAvatarAction,
    syncFromState,
    syncSnapshot,
    recordTrace,
} = {}) {
    const routeDescriptor = requiredFunction('routeDescriptorUpdate', routeDescriptorUpdate);
    const syncState = requiredFunction('syncFromState', syncFromState);
    const publishSnapshot = requiredFunction('syncSnapshot', syncSnapshot);
    const traceStage = requiredFunction('recordTrace', recordTrace);
    if (!anchor) throw new TypeError('Sigil context menu compact surface session requires anchor.');
    if (!document) throw new TypeError('Sigil context menu compact surface session requires document.');
    if (!visualObjectBinding?.routeHandlers || !visualObjectBinding?.rendererSyncHandlers) {
        throw new TypeError('Sigil context menu compact surface session requires visualObjectBinding handlers.');
    }

    let compactSurface = null;
    const compactValueCache = new Map();

    function surface() {
        return compactSurface;
    }

    function controlRecords() {
        return compactSurface?.getControlRecords() || [];
    }

    function activeTab() {
        return compactSurface?.getActiveTab() || null;
    }

    function refreshVisibility() {
        compactSurface?.refreshVisibility?.();
    }

    function seedValueCache(surfaceToSeed = compactSurface) {
        compactValueCache.clear();
        if (!surfaceToSeed) return;
        for (const tab of surfaceToSeed.viewModel.tabs || []) {
            for (const section of tab.sections || []) {
                for (const control of section.controls || []) {
                    compactValueCache.set(control.id, cacheKey(control.value));
                }
            }
        }
        for (const control of surfaceToSeed.viewModel.projection_tools || []) {
            compactValueCache.set(control.id, cacheKey(control.value));
        }
    }

    function routeChangedControls(controls = [], values = {}) {
        let changed = false;
        for (const control of controls) {
            if (!control?.id || !Object.prototype.hasOwnProperty.call(values, control.id)) continue;
            const value = values[control.id];
            const nextKey = cacheKey(value);
            if (compactValueCache.get(control.id) === nextKey) continue;
            compactValueCache.set(control.id, nextKey);
            const result = routeDescriptor(control.descriptor_id || control.id, value);
            changed ||= !!result;
        }
        if (changed) {
            syncState();
            publishSnapshot();
        }
        return changed;
    }

    function handleProjectionAction(payload = {}) {
        const control = payload.control || {};
        const id = control.descriptor_id || control.id;
        routeDescriptor(id, id);
        if (id?.startsWith?.('toggle-')) {
            onUtilityAction?.(control.action_id || id);
            publishSnapshot();
            return;
        }
        Promise.resolve(onAvatarAction?.(id)).then((changed) => {
            if (changed) {
                void mount().then(() => {
                    syncState();
                    seedValueCache();
                    publishSnapshot();
                });
            }
        }).catch((error) => {
            console.warn('[sigil] avatar control surface action failed:', error);
        });
    }

    async function mount(activeTab = null) {
        const { createSigilAvatarCompactControlSurface } = await loadCompactSurfaceModule();
        const previousActiveTab = compactSurface?.getActiveTab?.() || undefined;
        compactSurface?.destroy?.();
        compactSurface = createSigilAvatarCompactControlSurface(anchor, state || {}, {
            document,
            defaultTab: activeTab || previousActiveTab,
            visualObjectBinding: {
                state,
                routeHandlers: visualObjectBinding.routeHandlers,
                rendererSyncHandlers: visualObjectBinding.rendererSyncHandlers,
            },
            onControlChange() {
                queueMicrotask(() => {
                    syncState();
                    publishSnapshot();
                });
            },
            onProjectionChange(payload = {}) {
                routeChangedControls(payload.controls || [], payload.values || {});
            },
            onProjectionAction: handleProjectionAction,
            onTabChange(payload = {}) {
                traceStage('surface-tab', { value: payload.value });
                publishSnapshot();
            },
        });
        seedValueCache(compactSurface);
        publishSnapshot();
        return compactSurface;
    }

    function destroy() {
        compactSurface?.destroy?.();
        compactSurface = null;
        compactValueCache.clear();
    }

    return {
        activeTab,
        controlRecords,
        destroy,
        mount,
        refreshVisibility,
        seedValueCache,
        surface,
    };
}
