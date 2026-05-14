const HOVER_SETTLE_EPSILON = 0.002;

export function renderLoopContinuationReasons(frame = {}) {
    const reasons = [];
    if (frame.rendererSuspended) return reasons;
    if (frame.visibilityTransitionActive) reasons.push('visibility-transition');
    if (frame.fastTravelActive) reasons.push('fast-travel');
    if (frame.radialActivationTransitionActive) reasons.push('radial-activation-transition');
    if (frame.radialGestureActive) reasons.push('radial-gesture');
    if (frame.contextMenuOpen) reasons.push('context-menu');
    if (frame.annotationReticleActive) reasons.push('annotation-reticle');
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

export function createRenderLoopScheduler(requestFrame) {
    let suspended = false;
    let queued = false;
    let lastMode = 'idle';

    function schedule(onFrame, options = {}) {
        if (suspended || queued) return;
        queued = true;
        lastMode = options.mode || 'dirty';
        requestFrame(() => {
            queued = false;
            onFrame();
        });
    }

    return {
        schedule,
        suspend() {
            suspended = true;
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
        get lastMode() {
            return lastMode;
        },
    };
}
