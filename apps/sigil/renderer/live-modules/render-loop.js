const HOVER_SETTLE_EPSILON = 0.002;

export function renderLoopContinuationReasons(frame = {}) {
    const reasons = [];
    if (frame.rendererSuspended) return reasons;
    if (frame.visibilityTransitionActive) reasons.push('visibility-transition');
    if (frame.fastTravelActive) reasons.push('fast-travel');
    if (frame.radialActivationTransitionActive) reasons.push('radial-activation-transition');
    if (frame.radialGestureActive) reasons.push('radial-gesture');
    if (frame.avatarControlsOpen) reasons.push('avatar-controls');
    if (frame.annotationReticleActive) reasons.push('annotation-reticle');
    if (frame.selectionModeActive) reasons.push('selection-mode');
    if (frame.selectionModeEffectActive) reasons.push('selection-mode-effect');
    if (frame.selectionModePerimeterFillActive) reasons.push('selection-mode-perimeter-fill');
    if (frame.avatarMotionActive) reasons.push('avatar-motion');
    if (frame.currentState && frame.currentState !== 'IDLE') reasons.push('interaction-state');
    const hoverProgress = Number(frame.avatarHoverProgress);
    if (Number.isFinite(hoverProgress)) {
        const hoverTarget = frame.avatarHover ? 1 : 0;
        if (Math.abs(hoverTarget - hoverProgress) > HOVER_SETTLE_EPSILON) {
            reasons.push('hover-easing');
        }
    }
    if (frame.sessionVitalityRefreshing) reasons.push('session-vitality-refresh');
    if (Number(frame.sessionVitalityFlickerAmount) > 0) reasons.push('session-vitality-flicker');
    if (frame.forceContinuous) reasons.push('forced');
    return reasons;
}

export function shouldContinueRenderLoop(frame = {}) {
    return renderLoopContinuationReasons(frame).length > 0;
}

export function classifyRenderLoopWork(frame = {}) {
    const continuationReasons = Array.isArray(frame.continuationReasons)
        ? frame.continuationReasons
        : renderLoopContinuationReasons(frame);
    const structuralDirty = !!frame.structuralDirty;
    const selectionModeEffectStateChanged = !!frame.selectionModeEffectStateChanged;
    const visualOnlyReasons = new Set(['avatar-motion', 'selection-mode']);
    const overlayOnlyReasons = new Set(['selection-mode-effect', 'selection-mode-perimeter-fill']);
    // panel-ui-idle: panel UI is animating but no avatar geometry changed.
    // Added in Phase 2: when the shared RAF scheduler drives a co-located
    // document frame for panel-only updates (no avatar geometry dirty), the
    // avatar render step registers this reason instead of avatar-controls.
    // This allows publishState to be skipped on panel-only frames.
    const panelUiIdleReasons = new Set(['panel-ui-idle']);
    const cheapFrameReasons = new Set([...visualOnlyReasons, ...overlayOnlyReasons, ...panelUiIdleReasons]);
    const visualOnly = !structuralDirty
        && continuationReasons.length > 0
        && continuationReasons.every((reason) => visualOnlyReasons.has(reason));
    const cheapFrame = !structuralDirty
        && continuationReasons.length > 0
        && continuationReasons.every((reason) => cheapFrameReasons.has(reason));
    const overlayOnly = cheapFrame
        && continuationReasons.some((reason) => overlayOnlyReasons.has(reason));
    const publishSelectionEffectState = continuationReasons.includes('selection-mode-effect');

    return {
        continuationReasons,
        structural: structuralDirty || (!cheapFrame && continuationReasons.length > 0),
        overlay: structuralDirty
            || selectionModeEffectStateChanged
            || overlayOnly
            || (!cheapFrame && continuationReasons.length > 0),
        publishState: structuralDirty
            || selectionModeEffectStateChanged
            || publishSelectionEffectState
            || (!cheapFrame && continuationReasons.length > 0),
        visualOnly,
    };
}

export function createRenderLoopScheduler(requestFrame) {
    let suspended = false;
    let queued = false;
    let lastMode = 'idle';
    let timer = null;
    let delayed = false;

    function schedule(onFrame, options = {}) {
        const delayMs = Math.max(0, Number(options.delayMs) || 0);
        if (suspended) return;
        if (queued) {
            if (delayed && delayMs <= 0 && timer != null && typeof globalThis.clearTimeout === 'function') {
                globalThis.clearTimeout(timer);
                timer = null;
                queued = false;
                delayed = false;
            } else {
                return;
            }
        }
        queued = true;
        delayed = delayMs > 0;
        lastMode = options.mode || 'dirty';
        const runFrame = () => requestFrame(() => {
            queued = false;
            delayed = false;
            onFrame();
        });
        if (delayMs > 0 && typeof globalThis.setTimeout === 'function') {
            timer = globalThis.setTimeout(() => {
                timer = null;
                if (suspended) {
                    queued = false;
                    delayed = false;
                    return;
                }
                runFrame();
            }, delayMs);
        } else {
            runFrame();
        }
    }

    return {
        schedule,
        suspend() {
            suspended = true;
            if (timer != null && typeof globalThis.clearTimeout === 'function') {
                globalThis.clearTimeout(timer);
                timer = null;
            }
            queued = false;
            delayed = false;
        },
        resume() {
            suspended = false;
        },
        get suspended() {
            return suspended;
        },
        get queued() {
            return queued;
        },
        get delayed() {
            return delayed;
        },
        get lastMode() {
            return lastMode;
        },
    };
}
