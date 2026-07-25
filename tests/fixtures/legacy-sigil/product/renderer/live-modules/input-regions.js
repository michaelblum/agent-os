import { toolkitSpecifier } from './content-roots.js';

const {
    createManagedInputRegionSet,
} = await import(toolkitSpecifier('runtime/managed-input-region-set.js'));

export const SIGIL_AVATAR_INPUT_REGION_ID = 'sigil-avatar-main-input-region';
export const SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID = 'sigil-avatar-controls-input-region';
export const SIGIL_SELECTION_MODE_INPUT_REGION_ID = 'sigil-selection-mode-input-region';

const CAPTURE_STATES = new Set(['IDLE', 'PRESS', 'RADIAL', 'FAST_TRAVEL']);

export function selectSigilInputRegionOwner(windowObject = globalThis.window, fallbackCanvasId = 'avatar-main') {
    return windowObject?.__aosCanvasId
        || windowObject?.__aosSurfaceCanvasId
        || fallbackCanvasId;
}

function sigilRegionPayload({
    id,
    ownerCanvasId,
    frame,
    semanticLabel,
    priority,
    purpose,
    fallbackCanvasId,
    metadata = {},
}) {
    return {
        id,
        owner_canvas_id: ownerCanvasId,
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
            ...metadata,
        },
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
    avatarControlsNativeFrame,
    avatarControlsIsOpen = () => false,
    selectionModeNativeFrame,
    selectionModeIsActive = () => false,
    logger = console,
} = {}) {
    if (!host) throw new Error('createSigilInputRegionAdapter requires host');
    if (!liveState) throw new Error('createSigilInputRegionAdapter requires liveState');

    function currentOwnerCanvasId() {
        return selectSigilInputRegionOwner(windowObject, fallbackCanvasId);
    }

    const managed = createManagedInputRegionSet({
        host,
        logger,
        ownerCanvasId: currentOwnerCanvasId,
        descriptors: [
            {
                key: 'avatar',
                id: SIGIL_AVATAR_INPUT_REGION_ID,
                enabled: () => (
                    isPrimarySegment()
                    && avatarRegionEnabled()
                    && liveState.avatarVisible
                    && liveState.avatarPos?.valid
                    && CAPTURE_STATES.has(liveState.currentState)
                ),
                frame: () => avatarNativeFrame?.(),
                payload: ({ frame, ownerCanvasId }) => sigilRegionPayload({
                    id: SIGIL_AVATAR_INPUT_REGION_ID,
                    ownerCanvasId,
                    frame,
                    semanticLabel: 'Sigil avatar input claim',
                    priority: 80,
                    purpose: 'avatar-pointer-capture',
                    fallbackCanvasId,
                }),
            },
            {
                key: 'avatarControls',
                id: SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID,
                enabled: () => isPrimarySegment() && avatarControlsIsOpen(),
                frame: () => avatarControlsNativeFrame?.(),
                payload: ({ frame, ownerCanvasId }) => sigilRegionPayload({
                    id: SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID,
                    ownerCanvasId,
                    frame,
                    semanticLabel: 'Sigil avatar controls input claim',
                    priority: 120,
                    purpose: 'avatar-controls-pointer-capture',
                    fallbackCanvasId,
                }),
            },
            {
                key: 'selectionMode',
                id: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
                enabled: () => isPrimarySegment() && selectionModeIsActive(),
                frame: () => selectionModeNativeFrame?.(),
                payload: ({ frame, ownerCanvasId }) => sigilRegionPayload({
                    id: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
                    ownerCanvasId,
                    frame,
                    semanticLabel: 'Sigil Selection Mode input claim',
                    priority: 110,
                    purpose: 'selection-mode-pointer-capture',
                    fallbackCanvasId,
                }),
            },
        ],
    });

    return {
        ids: {
            avatar: SIGIL_AVATAR_INPUT_REGION_ID,
            avatarControls: SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID,
            selectionMode: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
        },
        currentOwnerCanvasId,
        sync: managed.syncAll,
        syncAvatar: () => managed.sync('avatar'),
        syncAvatarControls: () => managed.sync('avatarControls'),
        syncSelectionMode: () => managed.sync('selectionMode'),
        remove: managed.remove,
        removeAll: managed.removeAll,
        snapshot: managed.snapshot,
    };
}
