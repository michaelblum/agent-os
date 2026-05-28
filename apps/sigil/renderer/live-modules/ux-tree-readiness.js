const HAS_OWN = Object.prototype.hasOwnProperty;

const DEFAULT_ROUTED_BINDING_IDS = Object.freeze(new Set([
    'sigil.avatar.context_menu.right_click',
    'sigil.avatar.context_menu.right_click_toggle',
    'sigil.avatar.press.left_press',
    'sigil.avatar.goto.left_release',
    'sigil.avatar.radial.drag_threshold',
    'sigil.avatar.selection_mode.double_click',
    'sigil.selection_mode.escape',
    'sigil.selection_mode.enter',
    'sigil.selection_mode.tab',
    'sigil.selection_mode.arrow_up',
    'sigil.selection_mode.arrow_down',
    'sigil.selection_mode.left_click_acquire',
]));

const DEFAULT_RUNTIME_MECHANICS = Object.freeze([
    {
        id: 'sigil.selection_mode.entry_release',
        category: 'guard',
        reason: 'Suppresses the mouse-up that completes Selection Mode entry; not a user-editable command.',
    },
    {
        id: 'sigil.selection_mode.avatar_exit_double_click',
        category: 'guard',
        reason: 'Selection Mode avatar double-click exit is a local mode guard, not an entered command binding.',
    },
    {
        id: 'sigil.selection_mode.render_only_pointer',
        category: 'state_machine',
        reason: 'Pointer move and drag events refresh hover/render state without invoking a command.',
    },
    {
        id: 'sigil.context_menu.duplicate_echo',
        category: 'guard',
        reason: 'Duplicate right-click echo suppression protects the existing context-menu toggle path.',
    },
    {
        id: 'sigil.context_menu.right_click_away',
        category: 'fallback',
        reason: 'Missing pointer coordinates close or cancel the context menu instead of executing a command.',
    },
    {
        id: 'sigil.radial.pointer_tracking',
        category: 'gesture_recognition',
        reason: 'Radial hover, fast-travel handoff, reentry, and target-surface drag tracking remain runtime mechanics.',
    },
    {
        id: 'sigil.radial.release_fallbacks',
        category: 'fallback',
        reason: 'Release fallback preserves fast-travel and cancellation behavior when no radial command commits.',
    },
    {
        id: 'sigil.annotation_reticle.preview_commit',
        category: 'state_machine',
        reason: 'Reticle preview, live-anchor acquisition, and release commit remain annotation runtime mechanics.',
    },
]);

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function list(value) {
    return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function ownValue(object, key) {
    if (!object || typeof object !== 'object' || !HAS_OWN.call(object, key)) return undefined;
    return object[key];
}

function ownFunction(object, key) {
    const value = ownValue(object, key);
    return typeof value === 'function' ? value : null;
}

function registryHandler(registry = {}, command = {}) {
    const keys = [
        text(command.handler_ref),
        text(command.id),
    ].filter(Boolean);
    for (const key of keys) {
        if (registry instanceof Map && typeof registry.get(key) === 'function') {
            return { key, registered: true };
        }
        if (ownFunction(registry, key)) {
            return { key, registered: true };
        }
        const nestedHandlers = ownValue(registry, 'handlers');
        if (ownFunction(nestedHandlers, key)) {
            return { key, registered: true };
        }
    }
    return { key: keys[0] || null, registered: false };
}

function radialItemReleaseBinding(binding = {}) {
    return text(binding.id).startsWith('sigil.radial.item.release.')
        && text(binding.parameters?.item_id);
}

function classifyCommand(command = {}, {
    registry = {},
    commandStatuses = {},
} = {}) {
    const handler = registryHandler(registry, command);
    if (handler.registered) {
        return {
            id: command.id,
            handler_ref: command.handler_ref || command.id,
            status: 'registered_runtime_handler',
            handler_key: handler.key,
        };
    }
    const explicit = commandStatuses[command.id] || null;
    if (explicit) {
        return {
            id: command.id,
            handler_ref: command.handler_ref || command.id,
            status: explicit.status || 'deferred',
            reason: explicit.reason || '',
        };
    }
    return {
        id: command.id,
        handler_ref: command.handler_ref || command.id,
        status: 'unclassified_missing_handler',
        reason: 'No allowlisted runtime handler or explicit deferred status was provided.',
    };
}

function classifyBinding(binding = {}, {
    routedBindingIds = DEFAULT_ROUTED_BINDING_IDS,
    deferredBindings = {},
    runtimeMechanicBindings = {},
} = {}) {
    if (routedBindingIds.has(binding.id) || radialItemReleaseBinding(binding)) {
        return {
            id: binding.id,
            command_id: binding.command_id,
            node_id: binding.node_id,
            gesture: binding.gesture,
            status: 'routed_through_ux_command_adapter',
        };
    }
    const deferred = deferredBindings[binding.id] || null;
    if (deferred) {
        return {
            id: binding.id,
            command_id: binding.command_id,
            node_id: binding.node_id,
            gesture: binding.gesture,
            status: 'deferred',
            reason: deferred.reason || '',
        };
    }
    const mechanic = runtimeMechanicBindings[binding.id] || null;
    if (mechanic) {
        return {
            id: binding.id,
            command_id: binding.command_id,
            node_id: binding.node_id,
            gesture: binding.gesture,
            status: 'runtime_mechanic',
            category: mechanic.category || 'runtime_mechanic',
            reason: mechanic.reason || '',
        };
    }
    return {
        id: binding.id,
        command_id: binding.command_id,
        node_id: binding.node_id,
        gesture: binding.gesture,
        status: 'unclassified',
        reason: 'Binding is neither routed, explicitly deferred, nor classified as a non-command runtime mechanic.',
    };
}

function relationTopology(tree = {}) {
    return list(tree.relations)
        .filter((relation) => ['triggers', 'opens', 'anchors', 'targets'].includes(relation?.relation_type))
        .map((relation) => ({
            id: relation.id,
            relation_type: relation.relation_type,
            from_node_id: relation.from_node_id,
            to_node_id: relation.to_node_id,
            source_metadata: cloneJson(relation.source_metadata || {}),
            metadata: cloneJson(relation.metadata || {}),
        }));
}

export function createSigilUxTreeReadinessAudit(tree = {}, options = {}) {
    const commandCoverage = list(tree.commands).map((command) => classifyCommand(command, options));
    const bindingCoverage = list(tree.bindings).map((binding) => classifyBinding(binding, options));
    const unclassifiedCommands = commandCoverage.filter((entry) => entry.status === 'unclassified_missing_handler');
    const unclassifiedBindings = bindingCoverage.filter((entry) => entry.status === 'unclassified');
    const routedBindings = bindingCoverage.filter((entry) => entry.status === 'routed_through_ux_command_adapter');
    const deferredBindings = bindingCoverage.filter((entry) => entry.status === 'deferred');
    const runtimeMechanicBindings = bindingCoverage.filter((entry) => entry.status === 'runtime_mechanic');

    return {
        schema: 'sigil_ux_tree_readiness_audit',
        version: 1,
        ok: unclassifiedCommands.length === 0 && unclassifiedBindings.length === 0,
        summary: {
            commands_total: commandCoverage.length,
            commands_registered: commandCoverage.filter((entry) => entry.status === 'registered_runtime_handler').length,
            commands_unclassified: unclassifiedCommands.length,
            bindings_total: bindingCoverage.length,
            bindings_routed: routedBindings.length,
            bindings_deferred: deferredBindings.length,
            bindings_runtime_mechanic: runtimeMechanicBindings.length,
            bindings_unclassified: unclassifiedBindings.length,
            relations_topology: relationTopology(tree).length,
            direct_runtime_mechanics: DEFAULT_RUNTIME_MECHANICS.length,
        },
        commandCoverage,
        bindingCoverage,
        directRuntimeMechanics: cloneJson(DEFAULT_RUNTIME_MECHANICS),
        relationTopology: relationTopology(tree),
        failures: [
            ...unclassifiedCommands.map((entry) => ({
                kind: 'command',
                id: entry.id,
                reason: entry.reason,
            })),
            ...unclassifiedBindings.map((entry) => ({
                kind: 'binding',
                id: entry.id,
                reason: entry.reason,
            })),
        ],
    };
}
