import { SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS } from './ux-tree-command-registry.js';

function pointerFromMessage(msg = {}) {
    if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return null;
    return { x: msg.x, y: msg.y, valid: true };
}

export function resolveAvatarControlsRightClickRoute(msg = {}, {
    isOpen = false,
    isDuplicateOpenClick = () => false,
} = {}) {
    if (msg?.type !== 'right_mouse_down') {
        return { handled: false, reason: 'event_not_supported' };
    }

    const pointer = pointerFromMessage(msg);
    if (isOpen) {
        if (pointer && isDuplicateOpenClick(pointer.x, pointer.y)) {
            return {
                handled: true,
                direct: 'duplicate_open_echo',
                pointer,
            };
        }
        return {
            handled: true,
            command: 'toggle',
            input: SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS.toggle,
            pointer,
        };
    }

    if (!pointer) {
        return {
            handled: true,
            direct: 'right_click_away',
            pointer: null,
            reason: 'missing_pointer',
        };
    }

    return {
        handled: true,
        command: 'open',
        input: SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS.open,
        pointer,
    };
}

export function avatarControlsOpenCommandOpened(result = {}) {
    return result?.executed === true && result?.handler_result === true;
}
