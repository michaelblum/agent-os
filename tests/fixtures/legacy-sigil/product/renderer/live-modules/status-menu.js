export const SIGIL_STATUS_MENU_IDS = Object.freeze({
    CONSOLE: 'sigil.status.console',
    SURFACE_INSPECTOR: 'sigil.status.surface_inspector',
    ANNOTATION_MODE: 'sigil.status.annotation_mode',
    RELOAD: 'sigil.status.reload',
    REMOVE: 'sigil.status.remove',
    QUIT: 'aos.app.quit',
});

function menuItemsWithSeparator(items = []) {
    return items.length ? [...items, { type: 'separator' }] : [];
}

export function normalizeStatusMenuActionId(messageOrId = {}) {
    if (typeof messageOrId === 'string') return messageOrId.trim();
    return String(messageOrId.id || messageOrId.action_id || '').trim();
}

export function buildSigilStatusMenuItems({
    operatorAnnotationItems = [],
    voiceResponseItems = [],
    isUtilityCanvasVisible = () => false,
    annotationReticleActive = false,
} = {}) {
    return [
        ...menuItemsWithSeparator(operatorAnnotationItems),
        ...menuItemsWithSeparator(voiceResponseItems),
        {
            id: SIGIL_STATUS_MENU_IDS.CONSOLE,
            title: 'Console Log',
            checked: isUtilityCanvasVisible('__log__'),
        },
        {
            id: SIGIL_STATUS_MENU_IDS.SURFACE_INSPECTOR,
            title: 'Surface Inspector',
            checked: isUtilityCanvasVisible('surface-inspector'),
        },
        {
            id: SIGIL_STATUS_MENU_IDS.ANNOTATION_MODE,
            title: 'Annotation Mode',
            checked: isUtilityCanvasVisible('surface-inspector') && !!annotationReticleActive,
        },
        { type: 'separator' },
        {
            id: SIGIL_STATUS_MENU_IDS.RELOAD,
            title: 'Reload',
            key_equivalent: 'r',
        },
        {
            id: SIGIL_STATUS_MENU_IDS.REMOVE,
            title: 'Remove',
        },
        { type: 'separator' },
        {
            id: SIGIL_STATUS_MENU_IDS.QUIT,
            title: 'Quit AOS',
        },
    ];
}

export async function routeSigilStatusMenuAction(messageOrId = {}, handlers = {}) {
    const id = normalizeStatusMenuActionId(messageOrId);
    if (!id) return { handled: false, id: '', action: null };
    const routes = {
        [SIGIL_STATUS_MENU_IDS.CONSOLE]: ['console', handlers.onConsole],
        [SIGIL_STATUS_MENU_IDS.SURFACE_INSPECTOR]: ['surface_inspector', handlers.onSurfaceInspector],
        [SIGIL_STATUS_MENU_IDS.ANNOTATION_MODE]: ['annotation_mode', handlers.onAnnotationMode],
        [SIGIL_STATUS_MENU_IDS.RELOAD]: ['reload', handlers.onReload],
        [SIGIL_STATUS_MENU_IDS.REMOVE]: ['remove', handlers.onRemove],
        [SIGIL_STATUS_MENU_IDS.QUIT]: ['quit', handlers.onQuit],
    };
    const route = routes[id];
    if (!route) return { handled: false, id, action: null };
    const [action, handler] = route;
    if (typeof handler === 'function') await handler(messageOrId);
    return { handled: true, id, action };
}
