import {
    RESOLVED_SIGIL_RADIAL_MENU,
    normalizeSigilRadialGestureMenu,
} from '../radial-menu-defaults.js';
import { toolkitSpecifier } from './content-roots.js';

const {
    createUxTree,
    uxTreeBindingsForGesture,
    uxTreeCommandById,
} = await import(toolkitSpecifier('runtime/ux-tree.js', {
    local: '../../../../packages/toolkit/runtime/ux-tree.js',
}));

const SIGIL_UX_SOURCE_REFS = Object.freeze([
    { id: 'sigil-main', kind: 'source', ref: 'apps/sigil/renderer/live-modules/main.js' },
    { id: 'selection-mode-input', kind: 'source', ref: 'apps/sigil/renderer/live-modules/selection-mode-input.js' },
    { id: 'input-regions', kind: 'source', ref: 'apps/sigil/renderer/live-modules/input-regions.js' },
    { id: 'context-menu-input', kind: 'source', ref: 'apps/sigil/renderer/live-modules/context-menu-input.js' },
    { id: 'radial-gesture-menu', kind: 'source', ref: 'apps/sigil/renderer/live-modules/radial-gesture-menu.js' },
    { id: 'radial-menu-activation', kind: 'source', ref: 'apps/sigil/renderer/live-modules/radial-menu-activation.js' },
    { id: 'radial-menu-target-surface', kind: 'source', ref: 'apps/sigil/renderer/live-modules/radial-menu-target-surface.js' },
    { id: 'sigil-radial-menu', kind: 'resource', ref: 'apps/sigil/renderer/radial-menu/sigil-radial-menu.json' },
]);

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function sourceMetadata(source, extra = {}) {
    return { source, ...extra };
}

function command(id, label, description, sideEffect = 'existing_runtime_path') {
    return {
        id,
        label,
        description,
        handler_ref: id,
        parameters: {},
        safety: {
            execution: 'allowlisted',
            side_effect: sideEffect,
        },
        source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js'),
    };
}

function node(id, label, role, nodeType, extra = {}) {
    return {
        id,
        label,
        role,
        node_type: nodeType,
        resource_refs: [],
        source_metadata: {},
        ...extra,
    };
}

function binding(id, nodeId, mode, gesture, commandId, extra = {}) {
    return {
        id,
        node_id: nodeId,
        mode,
        gesture,
        command_id: commandId,
        enabled: true,
        priority: 100,
        consume_policy: 'consume',
        parameters: {},
        source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js'),
        ...extra,
    };
}

function relation(id, relationType, fromNodeId, toNodeId, extra = {}) {
    return {
        id,
        relation_type: relationType,
        from_node_id: fromNodeId,
        to_node_id: toNodeId,
        source_metadata: {},
        metadata: {},
        ...extra,
    };
}

function radialItemNodeId(itemId) {
    return `sigil.avatar.radial_menu.item.${text(itemId, 'unknown')}`;
}

function radialItemCommandId(item = {}) {
    if (item.action === 'contextMenu') return 'sigil.context_menu.open';
    if (item.action === 'agentTerminal' || item.action === 'codexTerminal') return 'sigil.agent_terminal.open';
    if (item.id === 'annotation-mode' || item.action === 'annotationMode') return 'sigil.selection_mode.enter';
    if (item.action === 'annotationSnapshot') return 'sigil.annotation_camera.capture_bundle';
    if (item.action === 'wikiGraph') return 'sigil.wiki_graph.open';
    return 'sigil.radial.release_item';
}

function modeList() {
    return [
        { id: 'global', label: 'Global' },
        { id: 'idle', label: 'Idle' },
        { id: 'press', label: 'Press' },
        { id: 'goto', label: 'GOTO' },
        { id: 'radial', label: 'Radial' },
        { id: 'fast_travel', label: 'Fast Travel' },
        { id: 'selection_mode', label: 'Selection Mode' },
        { id: 'annotation_reticle', label: 'Annotation Reticle' },
    ];
}

function commandList() {
    return [
        command('sigil.context_menu.open', 'Open context menu', 'Open the current Sigil context menu.'),
        command('sigil.context_menu.toggle', 'Toggle context menu', 'Toggle the current Sigil context menu.'),
        command('sigil.avatar.press.begin', 'Begin avatar press', 'Begin the existing avatar left-press state.'),
        command('sigil.avatar.goto.begin', 'Begin GOTO', 'Begin the existing avatar GOTO behavior.'),
        command('sigil.radial.begin', 'Begin radial gesture', 'Begin the existing radial gesture path.'),
        command('sigil.radial.release_item', 'Release radial item', 'Release the active radial item through the current activation path.'),
        command('sigil.selection_mode.enter', 'Enter Selection Mode', 'Enter Selection Mode from the radial reticle item.'),
        command('sigil.selection_mode.cancel', 'Cancel Selection Mode', 'Cancel active Selection Mode.'),
        command('sigil.selection_mode.commit', 'Commit Selection Mode', 'Commit the active Selection Mode context.'),
        command('sigil.selection_mode.cycle_target', 'Cycle Selection Mode target', 'Cycle the active target in Selection Mode.'),
        command('sigil.selection_mode.acquire', 'Acquire Selection Mode target', 'Acquire selection candidates from the current pointer.'),
        command('sigil.annotation_reticle.enter', 'Enter annotation reticle', 'Enter the existing annotation reticle flow.'),
        command('sigil.annotation_camera.capture_bundle', 'Capture annotation bundle', 'Request the existing annotation snapshot bundle.', 'captures_snapshot'),
        command('sigil.wiki_graph.open', 'Open wiki graph', 'Open the Sigil wiki graph workbench.', 'opens_surface'),
        command('sigil.agent_terminal.open', 'Open Agent Terminal', 'Open the Sigil Agent Terminal canvas.', 'opens_surface'),
    ];
}

function nodeList(radialMenu) {
    const radialItemNodes = (Array.isArray(radialMenu.items) ? radialMenu.items : []).map((item) => node(
        radialItemNodeId(item.id),
        text(item.label, item.id),
        text(item.role, 'menuitem'),
        'radial_item',
        {
            parent_id: 'sigil.avatar.radial_menu',
            settings_ref: `settings.radial.items.${item.id}`,
            resource_refs: [
                { id: `radial-item-${item.id}`, kind: 'radial_item', ref: `sigil.radial.main#${item.id}` },
            ],
            source_metadata: sourceMetadata('apps/sigil/renderer/radial-menu/sigil-radial-menu.json', {
                radial_item_id: item.id,
                action: item.action || null,
            }),
        }
    ));
    return [
        node('sigil.avatar', 'Sigil Avatar', 'root', 'avatar', {
            hit_source: { kind: 'avatar_state', ref: 'liveJs.avatarPos' },
            settings_ref: 'settings.avatar',
            children: [
                'sigil.avatar.body',
                'sigil.avatar.radial_menu',
                'sigil.avatar.context_menu',
                'sigil.avatar.selection_mode',
                'sigil.avatar.annotation_reticle',
                'sigil.avatar.annotation_camera',
            ],
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', {
                state_ref: 'liveJs',
            }),
        }),
        node('sigil.avatar.body', 'Avatar Body', 'button', 'hit_target', {
            parent_id: 'sigil.avatar',
            hit_source: { kind: 'input_region', ref: 'sigil-avatar-main-input-region' },
            settings_ref: 'settings.avatar.hit_target',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/input-regions.js'),
        }),
        node('sigil.avatar.radial_menu', 'Radial Menu', 'menu', 'radial_menu', {
            parent_id: 'sigil.avatar',
            settings_ref: 'settings.radial',
            resource_refs: [
                { id: 'sigil-radial-menu-config', kind: 'resource', ref: 'apps/sigil/renderer/radial-menu/sigil-radial-menu.json' },
            ],
            children: radialItemNodes.map((item) => item.id),
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/radial-gesture-menu.js'),
        }),
        ...radialItemNodes,
        node('sigil.avatar.context_menu', 'Context Menu', 'menu', 'context_menu', {
            parent_id: 'sigil.avatar',
            hit_source: { kind: 'input_region', ref: 'sigil-context-menu-input-region' },
            source_metadata: sourceMetadata('apps/sigil/context-menu/menu.js'),
        }),
        node('sigil.avatar.selection_mode', 'Selection Mode', 'mode', 'mode_scope', {
            parent_id: 'sigil.avatar',
            hit_source: { kind: 'input_region', ref: 'sigil-selection-mode-input-region' },
            settings_ref: 'settings.selection_mode',
            children: [
                'sigil.avatar.selection_mode.cursor_overlay',
                'sigil.avatar.selection_mode.lineage_bar',
            ],
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', {
                state_ref: 'liveJs.selectionMode',
            }),
        }),
        node('sigil.avatar.selection_mode.cursor_overlay', 'Selection Cursor Overlay', 'overlay', 'visual_overlay', {
            parent_id: 'sigil.avatar.selection_mode',
            settings_ref: 'settings.visual_overlays.selection_mode.cursor',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js'),
        }),
        node('sigil.avatar.selection_mode.lineage_bar', 'Selection Lineage Bar', 'overlay', 'visual_overlay', {
            parent_id: 'sigil.avatar.selection_mode',
            settings_ref: 'settings.visual_overlays.selection_mode.lineage_bar',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js'),
        }),
        node('sigil.avatar.annotation_reticle', 'Annotation Reticle', 'tool', 'reticle', {
            parent_id: 'sigil.avatar',
            settings_ref: 'settings.annotation_reticle',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/annotation-reticle.js'),
        }),
        node('sigil.avatar.annotation_camera', 'Annotation Camera', 'tool', 'camera', {
            parent_id: 'sigil.avatar',
            settings_ref: 'settings.annotation_camera',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/annotation-reticle.js'),
        }),
    ];
}

function bindingList(radialMenu) {
    const radialItemBindings = (Array.isArray(radialMenu.items) ? radialMenu.items : []).map((item) => binding(
        `sigil.radial.item.release.${item.id}`,
        radialItemNodeId(item.id),
        'radial',
        'pointer.left.release',
        radialItemCommandId(item),
        {
            priority: 120,
            parameters: {
                item_id: item.id,
                action: item.action || null,
                release_command_id: 'sigil.radial.release_item',
            },
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/radial-gesture-menu.js', {
                radial_item_id: item.id,
                action: item.action || null,
            }),
        }
    ));
    return [
        binding('sigil.avatar.context_menu.right_click', 'sigil.avatar.body', 'idle', 'pointer.right.click', 'sigil.context_menu.open', {
            consume_policy: 'route',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'right_mouse_down' }),
        }),
        binding('sigil.avatar.context_menu.right_click_toggle', 'sigil.avatar.context_menu', 'global', 'pointer.right.click', 'sigil.context_menu.toggle', {
            priority: 90,
            consume_policy: 'route',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'right_mouse_down' }),
        }),
        binding('sigil.avatar.press.left_press', 'sigil.avatar.body', 'idle', 'pointer.left.press', 'sigil.avatar.press.begin', {
            priority: 80,
            consume_policy: 'route',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'left_mouse_down' }),
        }),
        binding('sigil.avatar.goto.left_release', 'sigil.avatar.body', 'press', 'pointer.left.release', 'sigil.avatar.goto.begin', {
            priority: 80,
            consume_policy: 'route',
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'left_mouse_up' }),
        }),
        binding('sigil.avatar.radial.drag_threshold', 'sigil.avatar.body', 'press', 'pointer.left.drag_threshold', 'sigil.radial.begin', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'left_mouse_dragged' }),
        }),
        binding('sigil.selection_mode.escape', 'sigil.avatar.selection_mode', 'selection_mode', 'key.escape', 'sigil.selection_mode.cancel'),
        binding('sigil.selection_mode.enter', 'sigil.avatar.selection_mode', 'selection_mode', 'key.enter', 'sigil.selection_mode.commit'),
        binding('sigil.selection_mode.tab', 'sigil.avatar.selection_mode', 'selection_mode', 'key.tab', 'sigil.selection_mode.cycle_target', {
            parameters: { delta: -1 },
        }),
        binding('sigil.selection_mode.arrow_up', 'sigil.avatar.selection_mode', 'selection_mode', 'key.arrow_up', 'sigil.selection_mode.cycle_target', {
            parameters: { delta: -1 },
        }),
        binding('sigil.selection_mode.arrow_down', 'sigil.avatar.selection_mode', 'selection_mode', 'key.arrow_down', 'sigil.selection_mode.cycle_target', {
            parameters: { delta: 1 },
        }),
        binding('sigil.selection_mode.left_click_acquire', 'sigil.avatar.selection_mode', 'selection_mode', 'pointer.left.click', 'sigil.selection_mode.acquire', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/main.js', { event_type: 'left_mouse_up' }),
        }),
        ...radialItemBindings,
    ];
}

function relationList() {
    return [
        relation('sigil.avatar.body.opens_context_menu', 'opens', 'sigil.avatar.body', 'sigil.avatar.context_menu', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/context-menu-input.js', {
                binding_id: 'sigil.avatar.context_menu.right_click',
                command_id: 'sigil.context_menu.open',
            }),
            metadata: {
                gesture: 'pointer.right.click',
            },
        }),
        relation('sigil.avatar.body.triggers_radial_menu', 'triggers', 'sigil.avatar.body', 'sigil.avatar.radial_menu', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/radial-gesture-menu.js', {
                binding_id: 'sigil.avatar.radial.drag_threshold',
                command_id: 'sigil.radial.begin',
            }),
            metadata: {
                gesture: 'pointer.left.drag_threshold',
            },
        }),
        relation('sigil.avatar.radial_reticle.triggers_selection_mode', 'triggers', 'sigil.avatar.radial_menu.item.annotation-mode', 'sigil.avatar.selection_mode', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/ux-tree.js', {
                binding_id: 'sigil.radial.item.release.annotation-mode',
                command_id: 'sigil.selection_mode.enter',
            }),
            metadata: {
                gesture: 'pointer.left.release',
                mode: 'radial',
            },
        }),
        relation('sigil.avatar.anchors_radial_menu', 'anchors', 'sigil.avatar', 'sigil.avatar.radial_menu', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/radial-gesture-menu.js'),
            metadata: {
                anchor: {
                    kind: 'avatar_position',
                    state_ref: 'liveJs.avatarPos',
                },
            },
        }),
        relation('sigil.avatar.body.anchors_context_menu', 'anchors', 'sigil.avatar.body', 'sigil.avatar.context_menu', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/context-menu-input.js'),
            metadata: {
                anchor: {
                    kind: 'pointer_open_point',
                    state_ref: 'contextMenu.openPoint',
                },
            },
        }),
        relation('sigil.avatar.radial_menu.targets_items', 'targets', 'sigil.avatar.radial_menu', 'sigil.avatar.radial_menu.item.*', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/radial-menu-target-surface.js'),
            metadata: {
                target_surface: {
                    kind: 'radial_menu_targets',
                    lifecycle: 'active_radial_phase',
                    hit_source_ref: 'radialTargetSurface',
                    collection_ref: 'sigil.avatar.radial_menu.item.*',
                },
            },
        }),
        relation('sigil.avatar.context_menu.targets_input_region', 'targets', 'sigil.avatar.context_menu', 'sigil.avatar.context_menu', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/context-menu-input.js'),
            metadata: {
                target_surface: {
                    kind: 'input_region',
                    lifecycle: 'context_menu_open',
                    hit_source_ref: 'sigil-context-menu-input-region',
                    consume_policy: 'captured',
                },
            },
        }),
        relation('sigil.avatar.selection_mode.targets_input_region', 'targets', 'sigil.avatar.selection_mode', 'sigil.avatar.selection_mode', {
            source_metadata: sourceMetadata('apps/sigil/renderer/live-modules/selection-mode-input.js'),
            metadata: {
                target_surface: {
                    kind: 'input_region',
                    lifecycle: 'selection_mode_active',
                    hit_source_ref: 'sigil-selection-mode-input-region',
                    consume_policy: 'captured',
                },
            },
        }),
    ];
}

function settingsFor(radialMenu, state = {}) {
    const radialItems = {};
    for (const item of Array.isArray(radialMenu.items) ? radialMenu.items : []) {
        radialItems[item.id] = cloneJson(item);
    }
    return {
        avatar: {
            hit_target: {
                radius: state.avatarHitRadius ?? null,
                drag_threshold: state.dragThreshold ?? null,
                drag_cancel_radius: state.dragCancelRadius ?? null,
                goto_ring_radius: state.gotoRingRadius ?? null,
                menu_ring_radius: state.menuRingRadius ?? null,
            },
        },
        radial: {
            geometry: cloneJson(radialMenu.geometry || {
                radiusBasis: radialMenu.radiusBasis,
                deadZoneRadius: radialMenu.deadZoneRadius,
                itemRadius: radialMenu.itemRadius,
                itemHitRadius: radialMenu.itemHitRadius,
                itemVisualRadius: radialMenu.itemVisualRadius,
                menuRadius: radialMenu.menuRadius,
                handoffRadius: radialMenu.handoffRadius,
                reentryRadius: radialMenu.reentryRadius,
                spreadDegrees: radialMenu.spreadDegrees,
                startAngle: radialMenu.startAngle,
                orientation: radialMenu.orientation,
            }),
            menu_config: cloneJson(radialMenu),
            items: radialItems,
        },
        visual_overlays: {
            selection_mode: {
                cursor: cloneJson(state.selectionModeOverlay?.cursor || null),
                cursor_model: cloneJson(state.selectionModeCursorModel || null),
                lineage_bar: cloneJson(state.selectionModeOverlay?.lineageBar || null),
            },
            annotation_reticle: cloneJson(state.annotationReticleOverlay || null),
        },
        overrides: {},
    };
}

export function createSigilUxTree({ state = {}, metadata = {} } = {}) {
    const radialMenu = normalizeSigilRadialGestureMenu(state.radialGestureMenu || RESOLVED_SIGIL_RADIAL_MENU);
    return createUxTree({
        schema: 'aos_ux_tree',
        version: '0.1.0',
        id: 'sigil.avatar.ux_tree',
        label: 'Sigil Avatar UX Tree',
        owner: 'sigil',
        source_refs: cloneJson(SIGIL_UX_SOURCE_REFS),
        modes: modeList(),
        nodes: nodeList(radialMenu),
        commands: commandList(),
        bindings: bindingList(radialMenu),
        relations: relationList(),
        settings: settingsFor(radialMenu, state),
        metadata: {
            runtime_state: 'sigil_side_command_routed',
            behavior_cutover: true,
            generated_at: new Date().toISOString(),
            radial_menu_id: radialMenu.id,
            ...cloneJson(metadata),
        },
    }, { strict: false });
}

export function resolveSigilUxTreeBinding(tree, input = {}) {
    const itemId = text(input.itemId || input.item_id);
    const nodeId = text(input.nodeId || input.node_id, itemId ? radialItemNodeId(itemId) : '');
    const candidates = uxTreeBindingsForGesture(tree, {
        nodeId,
        mode: text(input.mode, 'global'),
        gesture: text(input.gesture),
    });
    const bindingMatch = itemId
        ? candidates.find((binding) => binding.parameters?.item_id === itemId) || candidates[0] || null
        : candidates[0] || null;
    const command = bindingMatch ? uxTreeCommandById(tree, bindingMatch.command_id) : null;
    return {
        matched: !!bindingMatch && !!command,
        binding: bindingMatch,
        command,
        command_id: command?.id || null,
        item_id: itemId || bindingMatch?.parameters?.item_id || null,
    };
}

export function createSigilUxTreeShadowResolver(tree) {
    return {
        resolve(input = {}) {
            return resolveSigilUxTreeBinding(tree, input);
        },
    };
}
