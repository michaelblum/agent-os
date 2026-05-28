export const SIGIL_AVATAR_INPUT_REGION_ID = 'sigil-avatar-main-input-region';
export const SIGIL_CONTEXT_MENU_INPUT_REGION_ID = 'sigil-context-menu-input-region';
export const SIGIL_SELECTION_MODE_INPUT_REGION_ID = 'sigil-selection-mode-input-region';

const CAPTURE_STATES = new Set(['IDLE', 'PRESS', 'RADIAL', 'FAST_TRAVEL']);

export function selectSigilInputRegionOwner(windowObject = globalThis.window, fallbackCanvasId = 'avatar-main') {
    return windowObject?.__aosCanvasId
        || windowObject?.__aosSurfaceCanvasId
        || fallbackCanvasId;
}

function sameNativeFrame(a, b) {
    return Array.isArray(a)
        && Array.isArray(b)
        && a.length >= 4
        && b.length >= 4
        && a[0] === b[0]
        && a[1] === b[1]
        && a[2] === b[2]
        && a[3] === b[3];
}

function cloneFrame(frame) {
    return Array.isArray(frame) ? frame.slice(0, 4) : null;
}

function regionSnapshot(entry) {
    return {
        registered: !!entry?.registered,
        frame: cloneFrame(entry?.frame),
    };
}

export function createSigilInputRegionAdapter({
    host,
    liveState,
    fallbackCanvasId = 'avatar-main',
    windowObject = globalThis.window,
    isPrimarySegment = () => true,
    avatarNativeFrame,
    avatarRegionEnabled = () => true,
    contextMenuNativeFrame,
    contextMenuIsOpen = () => false,
    selectionModeNativeFrame,
    selectionModeIsActive = () => false,
    logger = console,
} = {}) {
    if (!host) throw new Error('createSigilInputRegionAdapter requires host');
    if (!liveState) throw new Error('createSigilInputRegionAdapter requires liveState');

    const regions = new Map();

    function currentOwnerCanvasId() {
        return selectSigilInputRegionOwner(windowObject, fallbackCanvasId);
    }

    function payloadFor(id, frame, { semanticLabel, priority, purpose }) {
        return {
            id,
            owner_canvas_id: currentOwnerCanvasId(),
            frame,
            coordinate_space: 'native',
            semantic_label: semanticLabel,
            priority,
            consume_policy: 'captured',
            remove_on_owner_suspend: true,
            enabled: true,
            metadata: {
                app: 'sigil',
                surface: fallbackCanvasId,
                purpose,
            },
        };
    }

    function shouldSkipSync(prior, payload) {
        return prior
            && prior.owner_canvas_id === payload.owner_canvas_id
            && prior.enabled === payload.enabled
            && sameNativeFrame(prior.frame, payload.frame);
    }

    function syncRegion(id, payload) {
        const prior = regions.get(id);
        if (shouldSkipSync(prior, payload)) return false;

        const method = prior?.registered ? 'inputRegionUpdate' : 'inputRegionRegister';
        regions.set(id, { ...payload, frame: cloneFrame(payload.frame), registered: true });
        void host[method](payload).catch((error) => {
            const message = String(error?.message || error);
            if (method === 'inputRegionUpdate' && message.includes('NOT_FOUND')) {
                void host.inputRegionRegister(payload).catch((registerError) => {
                    logger.warn?.('[sigil] input region register failed:', registerError);
                });
                return;
            }
            logger.warn?.('[sigil] input region sync failed:', error);
        });
        return true;
    }

    function remove(id) {
        if (!regions.has(id)) return false;
        regions.delete(id);
        void host.inputRegionRemove(id).catch((error) => {
            logger.warn?.('[sigil] input region remove failed:', error);
        });
        return true;
    }

    function removeAll() {
        const removed = [
            remove(SIGIL_AVATAR_INPUT_REGION_ID),
            remove(SIGIL_CONTEXT_MENU_INPUT_REGION_ID),
            remove(SIGIL_SELECTION_MODE_INPUT_REGION_ID),
        ];
        return removed.some(Boolean);
    }

    function syncAvatar() {
        if (
            !isPrimarySegment()
            || !avatarRegionEnabled()
            || !liveState.avatarVisible
            || !liveState.avatarPos?.valid
            || !CAPTURE_STATES.has(liveState.currentState)
        ) {
            return remove(SIGIL_AVATAR_INPUT_REGION_ID);
        }
        const frame = avatarNativeFrame?.();
        if (!frame) return remove(SIGIL_AVATAR_INPUT_REGION_ID);
        return syncRegion(SIGIL_AVATAR_INPUT_REGION_ID, payloadFor(SIGIL_AVATAR_INPUT_REGION_ID, frame, {
            semanticLabel: 'Sigil avatar input claim',
            priority: 80,
            purpose: 'avatar-pointer-capture',
        }));
    }

    function syncContextMenu() {
        if (!isPrimarySegment() || !contextMenuIsOpen()) {
            return remove(SIGIL_CONTEXT_MENU_INPUT_REGION_ID);
        }
        const frame = contextMenuNativeFrame?.();
        if (!frame) return remove(SIGIL_CONTEXT_MENU_INPUT_REGION_ID);
        return syncRegion(SIGIL_CONTEXT_MENU_INPUT_REGION_ID, payloadFor(SIGIL_CONTEXT_MENU_INPUT_REGION_ID, frame, {
            semanticLabel: 'Sigil context menu input claim',
            priority: 120,
            purpose: 'context-menu-pointer-capture',
        }));
    }

    function syncSelectionMode() {
        if (!isPrimarySegment() || !selectionModeIsActive()) {
            return remove(SIGIL_SELECTION_MODE_INPUT_REGION_ID);
        }
        const frame = selectionModeNativeFrame?.();
        if (!frame) return remove(SIGIL_SELECTION_MODE_INPUT_REGION_ID);
        return syncRegion(SIGIL_SELECTION_MODE_INPUT_REGION_ID, payloadFor(SIGIL_SELECTION_MODE_INPUT_REGION_ID, frame, {
            semanticLabel: 'Sigil Selection Mode input claim',
            priority: 110,
            purpose: 'selection-mode-pointer-capture',
        }));
    }

    function sync() {
        const avatarChanged = syncAvatar();
        const contextMenuChanged = syncContextMenu();
        const selectionModeChanged = syncSelectionMode();
        return avatarChanged || contextMenuChanged || selectionModeChanged;
    }

    function snapshot() {
        return {
            ownerCanvasId: currentOwnerCanvasId(),
            regions: {
                avatar: {
                    id: SIGIL_AVATAR_INPUT_REGION_ID,
                    ...regionSnapshot(regions.get(SIGIL_AVATAR_INPUT_REGION_ID)),
                },
                contextMenu: {
                    id: SIGIL_CONTEXT_MENU_INPUT_REGION_ID,
                    ...regionSnapshot(regions.get(SIGIL_CONTEXT_MENU_INPUT_REGION_ID)),
                },
                selectionMode: {
                    id: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
                    ...regionSnapshot(regions.get(SIGIL_SELECTION_MODE_INPUT_REGION_ID)),
                },
            },
        };
    }

    return {
        ids: {
            avatar: SIGIL_AVATAR_INPUT_REGION_ID,
            contextMenu: SIGIL_CONTEXT_MENU_INPUT_REGION_ID,
            selectionMode: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
        },
        currentOwnerCanvasId,
        sync,
        syncAvatar,
        syncContextMenu,
        syncSelectionMode,
        remove,
        removeAll,
        snapshot,
    };
}
