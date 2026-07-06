export const SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE = 'status_item.operator_annotation';

function finiteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function pointFromMessage(message = {}, fallback = null) {
    const x = finiteNumber(message.origin_x ?? message.x);
    const y = finiteNumber(message.origin_y ?? message.y);
    if (x !== null && y !== null) return { x, y, valid: true };
    const fallbackX = finiteNumber(fallback?.x);
    const fallbackY = finiteNumber(fallback?.y);
    if (fallbackX !== null && fallbackY !== null) {
        return { x: fallbackX, y: fallbackY, valid: fallback?.valid !== false };
    }
    return null;
}

export function createSigilOperatorAnnotationReceiver({
    startEventType,
    mountedSurfaceId = 'avatar-main',
    getPointer = () => null,
    enterSelectionMode = null,
    resetAvatarDoubleClick = () => {},
    setInteractionState = () => {},
    post = () => {},
    warn = () => {},
} = {}) {
    const expectedType = String(startEventType || '').trim();

    function handleMessage(message = {}) {
        if (!expectedType || message?.type !== expectedType) {
            return { handled: false, reason: 'not_operator_annotation_start' };
        }
        if (typeof enterSelectionMode !== 'function') {
            return { handled: false, reason: 'missing_selection_mode_receiver' };
        }

        const pointer = pointFromMessage(message, getPointer());
        const snapshot = enterSelectionMode(pointer, SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE);
        resetAvatarDoubleClick();
        setInteractionState('IDLE', 'operator-annotation-start');

        const event = {
            entry_source: SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE,
            target_surface: mountedSurfaceId,
            action_id: message.action_id || null,
            menu_item_id: message.menu_item_id || null,
            mode: message.mode || null,
            create_pending_annotation: message.create_pending_annotation !== false,
            modifiers: Array.isArray(message.modifiers) ? message.modifiers : [],
            pointer,
            snapshot,
        };
        post('sigil.selection_mode.enter', event);
        return {
            handled: true,
            event,
        };
    }

    function handleOrWarn(message = {}) {
        const result = handleMessage(message);
        if (result.handled) return true;
        if (message?.type === expectedType) {
            warn('[sigil] operator annotation start was not handled:', result.reason);
            return true;
        }
        return false;
    }

    return Object.freeze({
        handleMessage,
        handleOrWarn,
    });
}
