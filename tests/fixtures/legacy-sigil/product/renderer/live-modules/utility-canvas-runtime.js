import { toolkitSpecifier } from './content-roots.js';
import {
    createSigilUtilityCanvasIdSet,
    utilityConfig as createUtilityConfig,
} from './utility-canvas-config.js';

const {
    createUtilitySurfaceManager,
} = await import(toolkitSpecifier('runtime/utility-surface-manager.js'));

export function createSigilUtilityCanvasRuntime({
    host,
    liveState,
    avatarPanel = null,
    publishStatusMenuItems = () => {},
    consoleObject = console,
} = {}) {
    if (!host) throw new Error('createSigilUtilityCanvasRuntime requires host');
    if (!liveState) throw new Error('createSigilUtilityCanvasRuntime requires liveState');

    const utilityCanvasIds = createSigilUtilityCanvasIdSet([
        avatarPanel?.id,
    ].filter(Boolean));

    function utilityConfig(kind) {
        return createUtilityConfig(kind, {
            displays: liveState.displays || [],
            visibleBounds: liveState.visibleBounds,
        });
    }

    const manager = createUtilitySurfaceManager({
        host,
        states: liveState.utilityCanvases,
        openPromises: liveState.utilityCanvasOpenPromises,
        managedIds: utilityCanvasIds,
        resolveConfig: utilityConfig,
        logger: { warn() {} },
    });

    function isUtilityCanvasVisible(id) {
        return manager.isVisible(id);
    }

    async function prewarmAvatarPanelCanvas() {
        if (!avatarPanel?.usesExternalPanel?.()) return;
        if (liveState._avatarPanelPrewarmStarted) return;
        liveState._avatarPanelPrewarmStarted = true;
        try {
            await manager.prewarm({
                id: avatarPanel.id,
                url: avatarPanel.url,
                frame: avatarPanel.frame,
                interactive: true,
                window_level: 'floating',
            }, { focus: false });
        } catch (error) {
            consoleObject.warn('[sigil] avatar panel prewarm failed:', error);
        }
    }

    async function toggleUtilityCanvas(kind) {
        try {
            await manager.toggle(kind);
        } catch (error) {
            consoleObject.warn('[sigil] utility toggle failed:', kind, error);
        } finally {
            publishStatusMenuItems();
        }
    }

    async function ensureUtilityCanvasVisible(kind, { focus = true } = {}) {
        try {
            return await manager.ensureVisible(kind, { focus });
        } finally {
            publishStatusMenuItems();
        }
    }

    function handleCanvasLifecycle(msg = {}) {
        const result = manager.handleLifecycle(msg);
        if (!result.handled) return false;
        publishStatusMenuItems();
        return true;
    }

    return {
        utilityCanvasIds,
        utilityConfig,
        isUtilityCanvasVisible,
        prewarmAvatarPanelCanvas,
        toggleUtilityCanvas,
        ensureUtilityCanvasVisible,
        handleCanvasLifecycle,
        snapshot: manager.snapshot,
    };
}
