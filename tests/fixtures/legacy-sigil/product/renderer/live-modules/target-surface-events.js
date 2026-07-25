export function createSigilTargetSurfaceEventRuntime(deps = {}) {
    let radialTargetSurfaceDragActive = false;

    function pointFromHitPayload(payload = {}) {
        const localX = Number(payload.offsetX);
        const localY = Number(payload.offsetY);
        const frame = deps.hitTarget.hit.frame;
        if (Number.isFinite(localX) && Number.isFinite(localY) && Array.isArray(frame) && frame.length >= 4) {
            const nativePoint = {
                x: Number(frame[0]) + localX,
                y: Number(frame[1]) + localY,
            };
            return deps.nativeToDesktopWorldPoint(nativePoint, deps.liveJs.displays) ?? nativePoint;
        }

        const screenX = Number(payload.x ?? payload.screenX);
        const screenY = Number(payload.y ?? payload.screenY);
        if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
            return deps.nativeToDesktopWorldPoint({ x: screenX, y: screenY }, deps.liveJs.displays) ?? { x: screenX, y: screenY };
        }
        return null;
    }

    function handleHitCanvasEvent(payload = {}) {
        const sourceCanvasId = payload.sourceCanvasId ?? payload.source_canvas_id ?? deps.hitTarget.hit.id;
        const ownerCanvasId = payload.ownerCanvasId ?? payload.owner_canvas_id ?? payload.parent_canvas_id ?? null;
        if (payload.source !== 'sigil-hit' && payload.source_origin !== 'canvas' && sourceCanvasId !== deps.hitTarget.hit.id) return;
        deps.interactionTrace.record('hit-canvas', {
            kind: payload.kind,
            sourceCanvasId,
            ownerCanvasId,
            offsetX: payload.offsetX,
            offsetY: payload.offsetY,
            dx: payload.dx,
            dy: payload.dy,
            avatarControlsOpen: deps.avatarControls.isOpen(),
            hitFrame: deps.hitTarget.hit.frame,
        });
        if (payload.kind === 'right_mouse_down' || payload.kind === 'right_mouse_up' || payload.kind === 'right_mouse_dragged') {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'right-button-daemon-authority' });
            return;
        }
        const isLeftHitEvent = payload.kind === 'left_mouse_down'
            || payload.kind === 'left_mouse_dragged'
            || payload.kind === 'left_mouse_up';
        if (isLeftHitEvent && !deps.avatarControls.isOpen()) {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'controls-closed' });
            return;
        }
        const point = pointFromHitPayload(payload);
        if (!point) {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'no-point' });
            return;
        }
        if (isLeftHitEvent && !deps.avatarControls.containsDesktopPoint(point)) {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'outside-controls', point });
            return;
        }
        if (isLeftHitEvent && deps.isRecentDaemonPointerEcho(payload.kind, point)) {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'daemon-echo', point });
            return;
        }
        const normalized = deps.normalizeCanvasOriginInputMessage({ type: 'canvas_message', id: sourceCanvasId, payload }, {
            desktopWorld: point,
            sourceCanvasId,
            ownerCanvasId,
            sourceEvent: payload.kind,
            native: Array.isArray(deps.hitTarget.hit.frame)
                ? {
                    x: Number(deps.hitTarget.hit.frame[0]) + Number(payload.offsetX ?? 0),
                    y: Number(deps.hitTarget.hit.frame[1]) + Number(payload.offsetY ?? 0),
                }
                : null,
        });
        if (!normalized) {
            deps.interactionTrace.record('hit-canvas:ignored', { kind: payload.kind, reason: 'normalization-failed', point });
            return;
        }
        deps.handleInputEvent({
            ...normalized,
            envelope_type: normalized.envelopeType,
        });
    }

    function handleRadialTargetSurfaceEvent(payload = {}) {
        if (payload.source !== 'sigil-radial-menu-surface') return;
        const receipt = deps.radialTargetSurfaceReceiptEvidence(payload);
        deps.interactionTrace.record('radial-surface', {
            kind: payload.kind,
            ...receipt,
        });
        if (payload.kind === 'radial_surface_ready') {
            deps.radialTargetSurface.refreshPayload();
            return;
        }
        if (payload.kind === 'radial_item_pointer_down') {
            radialTargetSurfaceDragActive = false;
            return;
        }
        if (payload.kind === 'radial_item_pointer_move' || payload.kind === 'radial_surface_pointer_move') {
            if ((Number(payload.buttons) & 1) === 1) {
                radialTargetSurfaceDragActive = deps.applyRadialTargetSurfaceDragPayload(payload, receipt) || radialTargetSurfaceDragActive;
            }
            return;
        }
        if (payload.kind === 'radial_item_pointer_enter' || payload.kind === 'radial_item_pointer_leave') {
            if ((Number(payload.buttons) & 1) === 1) deps.applyRadialTargetSurfaceDragPayload(payload, receipt);
            return;
        }
        if (payload.kind === 'radial_item_pointer_up') {
            if (radialTargetSurfaceDragActive && receipt.worldPoint) {
                radialTargetSurfaceDragActive = false;
                deps.handleLeftMouseUp(receipt.worldPoint.x, receipt.worldPoint.y);
            }
            return;
        }
        if (payload.kind === 'radial_cancel') {
            const radialSnapshot = deps.liveJs.radialGestureMenu;
            const result = deps.getRadialGestureMenu().cancel('radial-surface-cancel');
            deps.exitAnnotationReticle('radial-surface-cancel');
            deps.clearGestureState();
            deps.beginRadialGestureDismissal(result, radialSnapshot);
            deps.fastTravel.clearGesture('radial-surface-cancel');
            deps.setInteractionState('IDLE', 'radial-surface-cancel');
            return;
        }
        if (payload.kind !== 'radial_item_click') return;
        if (deps.liveJs.currentState !== 'RADIAL' || !deps.liveJs.radialGestureMenu) {
            if (payload.itemId === deps.annotationCameraItemId || payload.itemAction === 'annotationSnapshot') {
                const recoveryItem = {
                    id: payload.itemId || deps.annotationCameraItemId,
                    action: payload.itemAction || 'annotationSnapshot',
                };
                const commandResult = deps.executeRadialItemCommand(recoveryItem, null, {
                    input: {
                        kind: 'click',
                        source: 'sigil.radial-target-surface',
                        item_id: payload.itemId,
                        canvas_id: deps.radialTargetSurface.id,
                    },
                    source: 'sigil.radial-target-surface',
                    pointer: receipt.worldPoint || deps.liveJs.pointerPos,
                    reason: 'radial-camera-target-surface-recovery',
                });
                deps.interactionTrace.record('radial-surface:recovered', {
                    reason: 'camera-click-after-radial-cleanup',
                    requested: commandResult.handler_result?.requested || null,
                    command_id: commandResult.command_id,
                    executed: commandResult.executed,
                    ...receipt,
                });
                deps.clearGestureState();
                deps.fastTravel.clearGesture('radial-surface-camera-recovery');
                deps.setInteractionState('IDLE', 'radial-surface-camera-recovery');
                return;
            }
            deps.interactionTrace.record('radial-surface:ignored', {
                reason: 'state-not-radial',
                itemId: payload.itemId,
                ...receipt,
            });
            return;
        }
        const item = deps.liveJs.radialGestureMenu.items?.find((candidate) => candidate.id === payload.itemId);
        if (!item?.center) {
            deps.interactionTrace.record('radial-surface:ignored', {
                reason: 'missing-item',
                itemId: payload.itemId,
                ...receipt,
            });
            return;
        }
        const result = deps.getRadialGestureMenu().release({ ...item.center, valid: true }, {
            input: {
                kind: 'click',
                source: 'sigil.radial-target-surface',
                pointer: { x: item.center.x, y: item.center.y },
                item_id: payload.itemId,
                canvas_id: deps.radialTargetSurface.id,
            },
            source: 'sigil.radial-target-surface',
        });
        const annotationDisposition = deps.annotationReticleReleaseDisposition(result);
        if (annotationDisposition.exit) deps.exitAnnotationReticle(annotationDisposition.reason);
        const radialSnapshot = deps.liveJs.radialGestureMenu;
        deps.clearGestureState();
        deps.beginRadialGestureDismissal(result, radialSnapshot);
        if (result?.committed?.type === 'fastTravel') {
            deps.queueFastTravel(item.center.x, item.center.y);
            deps.setInteractionState('IDLE', 'radial-surface-fast-travel');
            return;
        }
        deps.fastTravel.clearGesture(result?.committed?.type === 'item' ? 'radial-surface-item' : 'radial-surface-release');
        deps.setInteractionState('IDLE', result?.committed?.type === 'item' ? 'radial-surface-item' : 'radial-surface-release');
    }

    return {
        handleHitCanvasEvent,
        handleRadialTargetSurfaceEvent,
        snapshot() {
            return { radialTargetSurfaceDragActive };
        },
    };
}
