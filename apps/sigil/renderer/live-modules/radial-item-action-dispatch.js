import { createSigilRadialActivationRequest } from './radial-menu-activation.js';

function point(value = null) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, valid: value?.valid !== false };
}

function radialActivationInputFromContext(context = {}) {
    return context.input && typeof context.input === 'object'
        ? {
            ...context.input,
            pointer: context.input.pointer || context.pointer || null,
        }
        : context.input || {
            kind: 'gesture',
            source: 'sigil.avatar',
            pointer: context.pointer || null,
        };
}

function actionForItem(item = {}) {
    return String(item?.action || item?.id || 'unknown');
}

export function createSigilRadialItemActionDispatcher({
    agentTerminalCanvasId = 'sigil-agent-terminal',
    wikiWorkbenchCanvasId = 'sigil-wiki-workbench',
    wikiPath = 'aos/concepts/employer-brand-workflow-map.md',
    annotationReticleItemId = 'annotation-mode',
    annotationCameraItemId = 'annotation-camera',
    getPointer = () => null,
    getAvatarPos = () => null,
    setLastRadialActivation = () => {},
    post = () => {},
    warn = () => {},
    createActivationRequest = createSigilRadialActivationRequest,
    startActivationTransition = () => false,
    sendActivationUpdate = () => null,
    enterAnnotationReticle = () => null,
    enterSelectionMode = () => null,
    requestAnnotationSnapshot = () => false,
    openContextMenuAt = () => false,
    toggleUtilityCanvas = () => false,
    openWikiWorkbench = () => Promise.resolve(false),
} = {}) {
    function createActivation(item, snapshot, context = {}) {
        return createActivationRequest({
            item,
            snapshot,
            input: radialActivationInputFromContext(context),
            source: context.source || 'sigil.avatar',
            agentTerminalCanvasId,
            wikiWorkbenchCanvasId,
            wikiPath,
        });
    }

    function postActivationStart(item, snapshot, context = {}) {
        let activation = context.activation || createActivation(item, snapshot, context);
        setLastRadialActivation(activation);
        post('sigil.radial_menu.activation', activation);
        if (startActivationTransition(activation, snapshot)) {
            activation = sendActivationUpdate(activation, 'item_transition', {
                transition: activation.transition,
            }) || activation;
        }
        return activation;
    }

    function dispatch(item = {}, snapshot = null, context = {}) {
        const action = actionForItem(item);
        if (action === 'annotationMode' || item?.id === annotationReticleItemId) {
            const pointer = context.pointer || point(snapshot?.pointer) || getPointer();
            const nextSnapshot = enterSelectionMode(pointer, 'radial-reticle');
            post('sigil.selection_mode.enter', {
                item_id: item?.id,
                entry_source: 'radial-reticle',
                input: context.input || null,
                snapshot: nextSnapshot,
            });
            return { action: 'selection_mode_entered', item_id: item?.id || null };
        }
        if (action === 'annotationSnapshot' || item?.id === annotationCameraItemId) {
            const reason = context.reason === 'radial-camera-target-surface-recovery'
                ? 'radial-camera-target-surface-recovery'
                : context.reason || 'radial-camera';
            const requested = requestAnnotationSnapshot(reason);
            return { action: 'annotation_snapshot_requested', requested };
        }

        const activation = postActivationStart(item, snapshot, context);
        if (action === 'contextMenu') {
            const avatarPos = getAvatarPos() || {};
            const opened = openContextMenuAt(avatarPos.x, avatarPos.y, { force: true });
            sendActivationUpdate(activation, 'completed', { result: { opened: 'context-menu' } });
            return { action: 'context_menu_opened', opened };
        }
        if (action === 'agentTerminal' || action === 'codexTerminal') {
            const result = toggleUtilityCanvas('agent-terminal');
            sendActivationUpdate(activation, 'completed', { result: { canvas_id: agentTerminalCanvasId } });
            return { action: 'agent_terminal_opened', canvas_id: agentTerminalCanvasId, result };
        }
        if (action === 'wikiGraph') {
            const result = openWikiWorkbench(wikiPath, activation).catch((error) => {
                warn('[sigil] wiki workbench activation failed:', error);
                sendActivationUpdate(activation, 'failed', {
                    error: String(error?.message || error),
                });
                return { error: String(error?.message || error) };
            });
            return { action: 'wiki_graph_opened', canvas_id: wikiWorkbenchCanvasId, result };
        }

        post('sigil.radial_menu.action', { action });
        sendActivationUpdate(activation, 'completed', { result: { action } });
        return { action };
    }

    function dispatchContextMenuOpen(pointer, payload = {}) {
        if (payload.context?.item) {
            return dispatch(payload.context.item, payload.context.snapshot, {
                ...(payload.context || {}),
                pointer,
            });
        }
        return pointer && typeof pointer.x === 'number' && typeof pointer.y === 'number'
            ? openContextMenuAt(pointer.x, pointer.y)
            : false;
    }

    const commandHandlers = Object.freeze({
        radialReleaseItem: (item, payload = {}) => (
            dispatch(item, payload.context?.snapshot || null, payload.context || {})
        ),
        contextMenuOpen: dispatchContextMenuOpen,
        annotationReticleEnter: (pointer, payload = {}) => (
            dispatch(payload.context?.item || { id: annotationReticleItemId, action: 'annotationMode' }, payload.context?.snapshot || null, {
                ...(payload.context || {}),
                pointer,
            })
        ),
        annotationCameraCaptureBundle: (_reason, payload = {}) => (
            dispatch(payload.context?.item || { id: annotationCameraItemId, action: 'annotationSnapshot' }, payload.context?.snapshot || null, payload.context || {})
        ),
        wikiGraphOpen: (_path, payload = {}) => (
            dispatch(payload.context?.item || { id: 'wiki-graph', action: 'wikiGraph' }, payload.context?.snapshot || null, payload.context || {})
        ),
        agentTerminalOpen: (_kind, payload = {}) => (
            dispatch(payload.context?.item || { id: 'agent-terminal', action: 'agentTerminal' }, payload.context?.snapshot || null, payload.context || {})
        ),
    });

    return Object.freeze({
        commandHandlers,
        createActivation,
        dispatch,
        inputFromContext: radialActivationInputFromContext,
    });
}
