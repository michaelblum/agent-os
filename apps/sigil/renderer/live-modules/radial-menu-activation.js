import { createMenuActivationRequest } from './menu-activation-runtime.js';
import { resolveRadialItemActivationTransition } from './radial-transition-runtime.js';

export const SIGIL_RADIAL_MENU_ID = 'sigil.radial';

function actionForItem(item = {}) {
    return String(item.action || item.id || 'unknown');
}

function clonePoint(point = null) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

export function sigilRadialTargetSurfaceForItem(item = {}, {
    agentTerminalCanvasId = 'sigil-agent-terminal',
    wikiWorkbenchCanvasId = 'sigil-wiki-workbench',
    wikiPath = 'aos/concepts/employer-brand-workflow-map.md',
} = {}) {
    const action = actionForItem(item);
    if (action === 'agentTerminal' || action === 'codexTerminal') {
        return {
            kind: 'agent-terminal',
            canvas_id: agentTerminalCanvasId,
        };
    }
    if (action === 'wikiGraph') {
        return {
            kind: 'markdown-workbench',
            canvas_id: wikiWorkbenchCanvasId,
            subject: {
                id: `wiki:${wikiPath}`,
                source: {
                    kind: 'wiki',
                    path: wikiPath,
                },
            },
        };
    }
    if (action === 'contextMenu') {
        return {
            kind: 'sigil-context-menu',
            parent_canvas_id: 'avatar-main',
        };
    }
    return null;
}

export function sigilRadialTransitionForItem(item = {}) {
    return resolveRadialItemActivationTransition(item);
}

export function sigilRadialActivationMetadata(item = {}, snapshot = {}, context = {}) {
    return {
        radial: {
            phase: snapshot?.phase ?? null,
            active_item_id: snapshot?.activeItemId ?? null,
            committed_type: snapshot?.committed?.type ?? null,
            committed_item_id: snapshot?.committed?.itemId ?? item?.id ?? null,
            origin: clonePoint(snapshot?.origin),
            release_point: clonePoint(context?.pointer),
            item_center: clonePoint(item?.center),
        },
    };
}

export function createSigilRadialActivationRequest({
    item,
    snapshot,
    input = { kind: 'gesture', source: 'sigil.avatar' },
    source = null,
    agentTerminalCanvasId,
    wikiWorkbenchCanvasId,
    wikiPath,
    metadata = {},
} = {}) {
    const inputSource = input && typeof input === 'object'
        ? { ...input, source: input.source || source || 'sigil.avatar' }
        : { kind: input || 'gesture', source: source || 'sigil.avatar' };
    const targetSurface = sigilRadialTargetSurfaceForItem(item, {
        agentTerminalCanvasId,
        wikiWorkbenchCanvasId,
        wikiPath,
    });
    return createMenuActivationRequest({
        menuId: SIGIL_RADIAL_MENU_ID,
        item,
        input: inputSource,
        source: inputSource.source,
        targetSurface,
        transition: sigilRadialTransitionForItem(item),
        metadata: {
            ...sigilRadialActivationMetadata(item, snapshot, { pointer: inputSource.pointer }),
            ...metadata,
        },
    });
}
