import { resolveSigilUxTreeBinding } from './ux-tree.js';

export const SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT = Object.freeze({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.escape',
});

export const SIGIL_SELECTION_MODE_COMMAND_INPUTS = Object.freeze({
    escape: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    commit: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'key.enter',
    }),
    snapshot: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'pointer.lineage.snapshot',
    }),
    record: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'pointer.lineage.record',
    }),
    tabPreviousTarget: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'key.tab',
    }),
    arrowUpPreviousTarget: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'key.arrow_up',
    }),
    arrowDownNextTarget: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'key.arrow_down',
    }),
    acquire: Object.freeze({
        nodeId: 'sigil.avatar.selection_mode',
        mode: 'selection_mode',
        gesture: 'pointer.left.click',
    }),
});

export const SIGIL_CONTEXT_MENU_COMMAND_INPUTS = Object.freeze({
    open: Object.freeze({
        nodeId: 'sigil.avatar.body',
        mode: 'idle',
        gesture: 'pointer.right.click',
    }),
    toggle: Object.freeze({
        nodeId: 'sigil.avatar.context_menu',
        mode: 'global',
        gesture: 'pointer.right.click',
    }),
});

export const SIGIL_AVATAR_COMMAND_INPUTS = Object.freeze({
    pressBegin: Object.freeze({
        nodeId: 'sigil.avatar.body',
        mode: 'idle',
        gesture: 'pointer.left.press',
    }),
    gotoBegin: Object.freeze({
        nodeId: 'sigil.avatar.body',
        mode: 'press',
        gesture: 'pointer.left.release',
    }),
    radialBegin: Object.freeze({
        nodeId: 'sigil.avatar.body',
        mode: 'press',
        gesture: 'pointer.left.drag_threshold',
    }),
});

export const SIGIL_RADIAL_COMMAND_INPUTS = Object.freeze({
    itemRelease(itemId) {
        return {
            nodeId: `sigil.avatar.radial_menu.item.${text(itemId, 'unknown')}`,
            mode: 'radial',
            gesture: 'pointer.left.release',
            itemId: text(itemId, 'unknown'),
        };
    },
});

export const SIGIL_UX_TREE_STATIC_COMMAND_INPUTS = Object.freeze([
    SIGIL_CONTEXT_MENU_COMMAND_INPUTS.open,
    SIGIL_CONTEXT_MENU_COMMAND_INPUTS.toggle,
    SIGIL_AVATAR_COMMAND_INPUTS.pressBegin,
    SIGIL_AVATAR_COMMAND_INPUTS.gotoBegin,
    SIGIL_AVATAR_COMMAND_INPUTS.radialBegin,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.escape,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.commit,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.snapshot,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.record,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.tabPreviousTarget,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.arrowUpPreviousTarget,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.arrowDownNextTarget,
    SIGIL_SELECTION_MODE_COMMAND_INPUTS.acquire,
]);

const ALLOWLISTED_EXECUTION = 'allowlisted';
const HAS_OWN = Object.prototype.hasOwnProperty;

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function list(value) {
    return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function radialItemReleaseBinding(binding = {}) {
    return text(binding.id).startsWith('sigil.radial.item.release.')
        && text(binding.parameters?.item_id);
}

function ownValue(object, key) {
    if (!object || typeof object !== 'object' || !HAS_OWN.call(object, key)) {
        return undefined;
    }
    return object[key];
}

function ownFunction(object, key) {
    const value = ownValue(object, key);
    return typeof value === 'function' ? value : null;
}

function resultFor(input = {}, extra = {}) {
    return {
        matched: false,
        executed: false,
        command_id: null,
        binding_id: null,
        handler_ref: null,
        reason: 'not_started',
        errors: [],
        input: {
            nodeId: text(input.nodeId || input.node_id),
            mode: text(input.mode, 'global'),
            gesture: text(input.gesture),
            ...(text(input.itemId || input.item_id) ? { itemId: text(input.itemId || input.item_id) } : {}),
        },
        ...extra,
    };
}

function validationErrors(tree = {}) {
    if (!tree || typeof tree !== 'object') {
        return [{ code: 'tree.type', message: 'resolved UX tree must be an object' }];
    }
    if (!tree.validation || tree.validation.ok !== true) {
        return list(tree.validation?.errors).length
            ? list(tree.validation.errors)
            : [{ code: 'tree.validation', message: 'resolved UX tree validation must be ok' }];
    }
    return [];
}

export function resolveSigilUxTreeCommandRegistryHandler(registry = {}, command = {}) {
    const keys = [
        text(command.handler_ref),
        text(command.id),
    ].filter(Boolean);
    for (const key of keys) {
        if (registry instanceof Map && typeof registry.get(key) === 'function') {
            return { handler: registry.get(key), key };
        }
        const directHandler = ownFunction(registry, key);
        if (directHandler) {
            return { handler: directHandler, key };
        }
        const nestedHandlers = ownValue(registry, 'handlers');
        const nestedHandler = ownFunction(nestedHandlers, key);
        if (nestedHandler) {
            return { handler: nestedHandler, key };
        }
    }
    return { handler: null, key: keys[0] || null };
}

export function selectionModeInputForRoute(command = '') {
    return command === 'escape'
        ? SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT
        : SIGIL_SELECTION_MODE_COMMAND_INPUTS[command] || null;
}

export function createSigilUxTreeCommandRouteCatalog(tree = {}) {
    const routes = [];
    const seen = new Set();
    function push(input = {}, source = 'static') {
        const resolution = resolveSigilUxTreeBinding(tree, input);
        const binding = resolution.binding || null;
        if (!binding?.id || seen.has(binding.id)) return;
        seen.add(binding.id);
        routes.push({
            binding_id: binding.id,
            command_id: binding.command_id || resolution.command?.id || null,
            node_id: binding.node_id || input.nodeId || input.node_id || '',
            mode: binding.mode || input.mode || 'global',
            gesture: binding.gesture || input.gesture || '',
            input: resultFor(input).input,
            source,
        });
    }

    for (const input of SIGIL_UX_TREE_STATIC_COMMAND_INPUTS) {
        push(input, 'static_command_input');
    }
    for (const binding of list(tree.bindings)) {
        const itemId = radialItemReleaseBinding(binding);
        if (itemId) {
            push(SIGIL_RADIAL_COMMAND_INPUTS.itemRelease(itemId), 'radial_item_binding');
        }
    }
    return Object.freeze(routes);
}

export function createSigilUxTreeCommandRegistry({
    avatarPressBegin,
    avatarGotoBegin,
    radialBegin,
    radialReleaseItem,
    selectionModeEnter,
    selectionModeCancel,
    selectionModeCommit,
    selectionModeSnapshot,
    selectionModeRecord,
    selectionModeCycleTarget,
    selectionModeAcquire,
    contextMenuOpen,
    contextMenuToggle,
    annotationReticleEnter,
    annotationCameraCaptureBundle,
    wikiGraphOpen,
    agentTerminalOpen,
} = {}) {
    const registry = {};
    if (typeof contextMenuOpen === 'function') {
        registry['sigil.context_menu.open'] = (payload = {}) => (
            contextMenuOpen(payload.context?.pointer || null, payload)
        );
    }
    if (typeof contextMenuToggle === 'function') {
        registry['sigil.context_menu.toggle'] = (payload = {}) => (
            contextMenuToggle(payload.context?.pointer || null, payload)
        );
    }
    if (typeof avatarPressBegin === 'function') {
        registry['sigil.avatar.press.begin'] = (payload = {}) => avatarPressBegin(payload.context?.pointer || null, payload);
    }
    if (typeof avatarGotoBegin === 'function') {
        registry['sigil.avatar.goto.begin'] = (payload = {}) => avatarGotoBegin(payload.context?.pointer || null, payload);
    }
    if (typeof radialBegin === 'function') {
        registry['sigil.radial.begin'] = (payload = {}) => radialBegin(payload.context?.pointer || null, payload);
    }
    if (typeof radialReleaseItem === 'function') {
        registry['sigil.radial.release_item'] = (payload = {}) => radialReleaseItem(payload.context?.item || null, payload);
    }
    if (typeof selectionModeEnter === 'function') {
        registry['sigil.selection_mode.enter'] = (payload = {}) => selectionModeEnter(payload.context?.pointer || null, payload);
    }
    if (typeof selectionModeCancel === 'function') {
        registry['sigil.selection_mode.cancel'] = selectionModeCancel;
    }
    if (typeof selectionModeCommit === 'function') {
        registry['sigil.selection_mode.commit'] = () => selectionModeCommit('enter');
    }
    if (typeof selectionModeSnapshot === 'function') {
        registry['sigil.selection_mode.snapshot'] = (payload = {}) => selectionModeSnapshot(payload.context?.pointer || null, payload);
    }
    if (typeof selectionModeRecord === 'function') {
        registry['sigil.selection_mode.record'] = (payload = {}) => selectionModeRecord(payload.context?.pointer || null, payload);
    }
    if (typeof selectionModeCycleTarget === 'function') {
        registry['sigil.selection_mode.cycle_target'] = ({ binding } = {}) => {
            const delta = Number(binding?.parameters?.delta);
            return selectionModeCycleTarget(Number.isFinite(delta) ? delta : -1);
        };
    }
    if (typeof selectionModeAcquire === 'function') {
        registry['sigil.selection_mode.acquire'] = ({ context } = {}) => (
            selectionModeAcquire(context?.pointer || null)
        );
    }
    if (typeof annotationReticleEnter === 'function') {
        registry['sigil.annotation_reticle.enter'] = (payload = {}) => annotationReticleEnter(payload.context?.pointer || null, payload);
    }
    if (typeof annotationCameraCaptureBundle === 'function') {
        registry['sigil.annotation_camera.capture_bundle'] = (payload = {}) => annotationCameraCaptureBundle(payload.context?.reason || 'radial-camera', payload);
    }
    if (typeof wikiGraphOpen === 'function') {
        registry['sigil.wiki_graph.open'] = (payload = {}) => wikiGraphOpen(payload.context?.path || null, payload);
    }
    if (typeof agentTerminalOpen === 'function') {
        registry['sigil.agent_terminal.open'] = (payload = {}) => agentTerminalOpen(payload.context?.kind || 'agent-terminal', payload);
    }
    return Object.freeze(registry);
}

export function createSigilUxTreeCommandRunner({
    getTree = () => null,
    registry = {},
    recordRuntime = () => {},
} = {}) {
    function execute(input = {}, context = {}) {
        const result = executeSigilUxTreeCommand(getTree(), {
            input,
            registry,
            context,
        });
        recordRuntime(result, { fallback: false });
        return result;
    }

    return Object.freeze({
        execute,
        executeSelectionModeRoute(command = '', msg = {}, {
            pointer = null,
            source = 'handleSelectionModeInput',
            nodeId = null,
            lineageItemId = null,
            commentId = null,
            lineageMenuItemId = null,
            lineageMenuAction = null,
        } = {}) {
            const input = selectionModeInputForRoute(command);
            if (!input) return null;
            return execute(input, {
                source,
                msg,
                pointer,
                nodeId,
                lineageItemId,
                commentId,
                lineageMenuItemId,
                lineageMenuAction,
            });
        },
        routeCatalog() {
            return createSigilUxTreeCommandRouteCatalog(getTree());
        },
    });
}

export function createSigilUxTreeCommandRuntime({
    liveState = {},
    getTree = () => null,
    recordRuntime = () => {},
    radialItemActionDispatcher = null,
    getRadialGestureMenu = () => null,
    fastTravel = null,
    clearGestureState = () => {},
    clearRadialGestureDismissTimer = () => {},
    consumeAvatarDoubleClick = () => false,
    resetAvatarDoubleClick = () => {},
    setInteractionState = () => {},
    applyRadialGestureMove = () => false,
    enterSelectionMode = () => null,
    exitSelectionMode = () => null,
    acquireSelectionModeCandidates = () => null,
    cycleSelectionModeTarget = () => null,
    commitSelectionMode = () => null,
    contextMenu = null,
    cancelInteraction = () => {},
    wikiPath = '',
} = {}) {
    const registry = createSigilUxTreeCommandRegistry({
        avatarPressBegin(pointer) {
            if (!pointer) return false;
            liveState.mousedownPos = { x: pointer.x, y: pointer.y, valid: true };
            liveState.mousedownAvatarPos = { x: liveState.avatarPos.x, y: liveState.avatarPos.y, valid: true };
            setInteractionState('PRESS', 'mousedown-on-avatar');
            return { state: liveState.currentState, pointer };
        },
        avatarGotoBegin(pointer) {
            if (!pointer) return false;
            clearGestureState();
            fastTravel?.clearGesture?.('press-click');
            consumeAvatarDoubleClick(pointer.x, pointer.y);
            setInteractionState('GOTO', 'press-click');
            return { state: liveState.currentState, pointer };
        },
        radialBegin(pointer) {
            if (!pointer) return false;
            clearRadialGestureDismissTimer();
            const radialGestureMenu = getRadialGestureMenu();
            liveState.radialGestureMenu = radialGestureMenu.start(
                { ...liveState.avatarPos, valid: true },
                { x: pointer.x, y: pointer.y, valid: true }
            );
            if (applyRadialGestureMove(radialGestureMenu.move({ x: pointer.x, y: pointer.y, valid: true }), pointer.x, pointer.y)) {
                return { state: liveState.currentState, snapshot: liveState.radialGestureMenu };
            }
            setInteractionState('RADIAL', 'press-threshold-radial');
            return { state: liveState.currentState, snapshot: liveState.radialGestureMenu };
        },
        radialReleaseItem: radialItemActionDispatcher?.commandHandlers?.radialReleaseItem,
        selectionModeEnter(pointer, payload = {}) {
            enterSelectionMode(pointer, payload.context?.reason || 'radial-reticle');
            resetAvatarDoubleClick();
            setInteractionState('IDLE', 'selection-mode-enter');
            return liveState.selectionMode;
        },
        selectionModeCancel: () => exitSelectionMode('escape'),
        selectionModeCommit: (reason) => commitSelectionMode(reason),
        selectionModeSnapshot: (pointer, payload = {}) => selectionModeSnapshot(pointer, payload),
        selectionModeRecord: (pointer, payload = {}) => selectionModeRecord(pointer, payload),
        selectionModeCycleTarget: (delta) => cycleSelectionModeTarget(delta),
        selectionModeAcquire: (pointer) => acquireSelectionModeCandidates(pointer),
        contextMenuOpen: radialItemActionDispatcher?.commandHandlers?.contextMenuOpen,
        contextMenuToggle: () => {
            contextMenu?.close?.('right-click-toggle');
            cancelInteraction('right-click-toggle');
            return true;
        },
        annotationReticleEnter: radialItemActionDispatcher?.commandHandlers?.annotationReticleEnter,
        annotationCameraCaptureBundle: radialItemActionDispatcher?.commandHandlers?.annotationCameraCaptureBundle,
        wikiGraphOpen: radialItemActionDispatcher?.commandHandlers?.wikiGraphOpen,
        agentTerminalOpen: radialItemActionDispatcher?.commandHandlers?.agentTerminalOpen,
    });
    const runner = createSigilUxTreeCommandRunner({ getTree, registry, recordRuntime });

    function executeWithContext(input, msg = {}, context = {}) {
        return runner.execute(input, {
            source: context.source || 'handleInputEvent',
            msg,
            pointer: context.pointer || null,
            item: context.item || null,
            snapshot: context.snapshot || null,
            input: context.input || null,
            reason: context.reason || '',
            path: context.path || wikiPath,
            nodeId: context.nodeId || null,
            lineageItemId: context.lineageItemId || null,
            commentId: context.commentId || null,
            lineageMenuItemId: context.lineageMenuItemId || null,
            lineageMenuAction: context.lineageMenuAction || null,
        });
    }

    return Object.freeze({
        registry,
        execute: executeWithContext,
        executeAvatarPressBegin(msg = {}, context = {}) {
            return executeWithContext(SIGIL_AVATAR_COMMAND_INPUTS.pressBegin, msg, context);
        },
        executeAvatarGotoBegin(msg = {}, context = {}) {
            return executeWithContext(SIGIL_AVATAR_COMMAND_INPUTS.gotoBegin, msg, context);
        },
        executeAvatarRadialBegin(msg = {}, context = {}) {
            return executeWithContext(SIGIL_AVATAR_COMMAND_INPUTS.radialBegin, msg, context);
        },
        executeContextMenuRightClick(route = {}, msg = {}) {
            return executeWithContext(route.input || {}, msg, {
                source: 'handleInputEvent',
                pointer: route.pointer || null,
            });
        },
        executeRadialItem(item = {}, snapshot = null, context = {}) {
            return executeWithContext(SIGIL_RADIAL_COMMAND_INPUTS.itemRelease(item?.id), context.input || {}, {
                source: context.source || 'sigil.radial_menu',
                item,
                snapshot,
                pointer: context.pointer || snapshot?.pointer || liveState.pointerPos,
                input: radialItemActionDispatcher?.inputFromContext?.(context) || context.input || null,
                reason: context.reason || 'radial-camera',
                path: wikiPath,
            });
        },
        executeSelectionModeRoute(command = '', msg = {}, options = {}) {
            return runner.executeSelectionModeRoute(command, msg, options);
        },
        routeCatalog: runner.routeCatalog,
    });
}

export function executeSigilUxTreeCommand(tree, { input = {}, registry = {}, context = {} } = {}) {
    const invalidTreeErrors = validationErrors(tree);
    if (invalidTreeErrors.length > 0) {
        return resultFor(input, {
            reason: 'invalid_tree',
            errors: invalidTreeErrors,
        });
    }

    const resolution = resolveSigilUxTreeBinding(tree, input);
    const binding = resolution.binding || null;
    const command = resolution.command || null;
    const base = resultFor(input, {
        matched: !!binding && !!command,
        command_id: command?.id || binding?.command_id || null,
        binding_id: binding?.id || null,
        handler_ref: command?.handler_ref || null,
    });

    if (!binding) {
        return {
            ...base,
            reason: 'binding_not_found',
        };
    }
    if (!command) {
        return {
            ...base,
            reason: 'command_not_found',
        };
    }
    if (command.safety?.execution !== ALLOWLISTED_EXECUTION) {
        return {
            ...base,
            reason: 'command_not_allowlisted',
            errors: [{
                code: 'command.safety.execution',
                message: `command ${command.id} is not allowlisted for execution`,
            }],
        };
    }

    const { handler, key } = resolveSigilUxTreeCommandRegistryHandler(registry, command);
    if (typeof handler !== 'function') {
        return {
            ...base,
            reason: 'handler_not_registered',
            errors: [{
                code: 'command.handler.missing',
                message: `no registered handler for ${command.handler_ref || command.id}`,
            }],
        };
    }

    try {
        const handlerResult = handler({
            tree,
            binding,
            command,
            input: base.input,
            context,
        });
        return {
            ...base,
            executed: true,
            reason: 'executed',
            handler_key: key,
            handler_result: handlerResult,
        };
    } catch (error) {
        return {
            ...base,
            reason: 'handler_error',
            errors: [{
                code: 'command.handler.error',
                message: String(error?.message || error),
            }],
        };
    }
}
