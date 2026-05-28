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

const ALLOWLISTED_EXECUTION = 'allowlisted';
const HAS_OWN = Object.prototype.hasOwnProperty;

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function list(value) {
    return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
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

function registryHandler(registry = {}, command = {}) {
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

export function createSigilUxTreeCommandRegistry({
    selectionModeCancel,
    selectionModeCommit,
    selectionModeCycleTarget,
    selectionModeAcquire,
    contextMenuOpen,
    contextMenuToggle,
} = {}) {
    const registry = {};
    if (typeof contextMenuOpen === 'function') {
        registry['sigil.context_menu.open'] = ({ context } = {}) => (
            contextMenuOpen(context?.pointer || null)
        );
    }
    if (typeof contextMenuToggle === 'function') {
        registry['sigil.context_menu.toggle'] = ({ context } = {}) => (
            contextMenuToggle(context?.pointer || null)
        );
    }
    if (typeof selectionModeCancel === 'function') {
        registry['sigil.selection_mode.cancel'] = selectionModeCancel;
    }
    if (typeof selectionModeCommit === 'function') {
        registry['sigil.selection_mode.commit'] = () => selectionModeCommit('enter');
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
    return Object.freeze(registry);
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

    const { handler, key } = registryHandler(registry, command);
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
