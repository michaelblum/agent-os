import { toolkitSpecifier } from './content-roots.js';
import {
    buildSigilStatusMenuItems,
    normalizeStatusMenuActionId,
    routeSigilStatusMenuAction,
} from './status-menu.js';

const {
    operatorAnnotationStatusMenuItems,
    routeOperatorAnnotationMenuAction,
} = await import(toolkitSpecifier('runtime/operator-annotation-menu.js'));

export function createSigilStatusMenuRuntime({
    host,
    voiceRuntime,
    operatorAnnotationMenu,
    utilityRuntime,
    annotationReticle,
    hitTarget,
    radialTargetSurface,
    avatarPanelCanvasId,
    isPrimarySurfaceSegment = () => true,
    consoleObject = console,
    windowObject = globalThis.window,
} = {}) {
    if (!host) throw new Error('createSigilStatusMenuRuntime requires host');
    if (!utilityRuntime) throw new Error('createSigilStatusMenuRuntime requires utilityRuntime');

    function publishStatusMenuItems() {
        if (!isPrimarySurfaceSegment()) return;
        host.setStatusMenuItems(buildSigilStatusMenuItems({
            operatorAnnotationItems: operatorAnnotationStatusMenuItems(operatorAnnotationMenu),
            voiceResponseItems: voiceRuntime.responseBackendMenuItems(),
            isUtilityCanvasVisible: utilityRuntime.isUtilityCanvasVisible,
            annotationReticleActive: annotationReticle.active,
        }));
    }

    async function reloadFromStatusMenu() {
        try {
            await Promise.allSettled([
                hitTarget.remove(),
                radialTargetSurface.remove(),
                host.canvasRemove({ id: avatarPanelCanvasId }),
            ]);
        } catch (error) {
            consoleObject.warn('[sigil] status menu reload cleanup failed:', error);
        } finally {
            windowObject.location.reload();
        }
    }

    async function handleStatusMenuAction(msg = {}) {
        if (!isPrimarySurfaceSegment()) return true;
        const id = normalizeStatusMenuActionId(msg);
        if (!id) return false;
        const operatorRoute = routeOperatorAnnotationMenuAction(msg, operatorAnnotationMenu, host);
        if (operatorRoute.handled) return true;
        const voiceResponseRoute = voiceRuntime.handleMenuAction(id);
        if (voiceResponseRoute.handled) {
            publishStatusMenuItems();
            return true;
        }
        const statusRoute = await routeSigilStatusMenuAction(id, {
            onConsole: () => utilityRuntime.toggleUtilityCanvas('log-console'),
            onSurfaceInspector: () => utilityRuntime.toggleUtilityCanvas('surface-inspector'),
            async onAnnotationMode() {
                await utilityRuntime.ensureUtilityCanvasVisible('surface-inspector', { focus: true });
                host.post('canvas.send', {
                    target: 'surface-inspector',
                    message: {
                        type: 'canvas_inspector.annotation_toggle',
                        reason: 'status_item_menu',
                    },
                });
                publishStatusMenuItems();
            },
            onReload() {
                void reloadFromStatusMenu();
            },
            async onRemove() {
                await Promise.allSettled([
                    hitTarget.remove(),
                    radialTargetSurface.remove(),
                    host.canvasRemove({ id: avatarPanelCanvasId }),
                ]);
                host.post('canvas.remove', { id: 'avatar-main' });
            },
            onQuit: () => host.aosAction({ action: 'app.quit', source: 'status_item_menu' }),
        });
        return statusRoute.handled;
    }

    return {
        publishStatusMenuItems,
        handleStatusMenuAction,
        reloadFromStatusMenu,
    };
}
