export function createSigilDebugApi(deps = {}) {
    const api = {
        dispatch(msg) {
            deps.handleHostMessage(msg);
            return deps.liveJs.currentState;
        },
        dispatchDesktop(msg) {
            deps.handleInputEvent(msg);
            return deps.liveJs.currentState;
        },
        stellationResourceSmoke(options) {
            return deps.runPrimaryStellationResourceSmoke(options);
        },
        snapshot() {
            return {
                runtime: deps.runtimeSnapshot(),
                state: deps.liveJs.currentState,
                avatarPos: deps.liveJs.avatarPos,
                travel: deps.liveJs.travel,
                fastTravel: deps.fastTravel.exportSnapshot(),
                radialGestureMenu: deps.liveJs.radialGestureMenu,
                radialGestureVisuals: deps.radialGestureVisuals?.snapshot?.() ?? null,
                radialActivationTransition: deps.radialActivationTransition.snapshot(),
                annotationReticle: deps.liveJs.annotationReticle,
                selectionMode: deps.liveJs.selectionMode,
                selectionModeOverlay: deps.liveJs.selectionModeOverlay,
                uxCommandRuntime: deps.liveJs.uxCommandRuntime,
                activeContext: deps.liveJs.activeContext,
                contextRecording: deps.liveJs.contextRecording,
                annotationReticleOverlay: deps.liveJs.annotationReticleOverlay,
                annotationReticleBrowserDomBridge: deps.liveJs.annotationReticleBrowserDomBridge,
                annotationReticleEvents: deps.liveJs.annotationReticleEvents,
                avatarHover: deps.liveJs.avatarHover,
                avatarHoverProgress: deps.liveJs.avatarHoverProgress,
                avatarControls: deps.avatarControls?.snapshot?.(),
                fastTravelEffect: deps.state.transitionFastTravelEffect,
                fastTravelEvents: deps.liveJs.fastTravelEvents,
                interactionTrace: {
                    count: deps.interactionTrace.snapshot().count,
                    enabled: deps.interactionTrace.snapshot().enabled,
                },
                avatarVisible: deps.liveJs.avatarVisible,
                renderLoop: deps.liveJs.renderLoop,
                sessionVitality: deps.liveJs.sessionVitality,
                hitTargetId: deps.hitTarget.hit.id,
                hitTargetReady: deps.hitTarget.hit.ready,
                hitTargetFrame: deps.hitTarget.hit.frame,
                hitTargetInteractive: deps.hitTarget.hit.interactive,
                inputRegions: deps.sigilInputRegions?.()?.snapshot?.() ?? null,
                radialTargetSurface: deps.radialTargetSurface.snapshot(),
                uxTree: deps.sigilUxTreeSnapshot(),
                uxTreeReadiness: deps.sigilUxTreeReadiness(),
                transition: deps.visibilityTransition.active?.effect ?? null,
                surface: deps.desktopWorldSurface ? {
                    segment: deps.desktopWorldSurface.segment,
                    isPrimary: deps.desktopWorldSurface.isPrimary,
                    latency: deps.desktopWorldSurface.stateLatencySnapshot(),
                } : null,
                surfaceTransportProbe: deps.surfaceTransportProbe.snapshot(),
            };
        },
        surfaceTransportProbe: {
            enable() {
                return deps.surfaceTransportProbe.setEnabled(true);
            },
            disable() {
                return deps.surfaceTransportProbe.setEnabled(false);
            },
            reset() {
                deps.surfaceTransportProbe.reset();
                return deps.surfaceTransportProbe.snapshot();
            },
            snapshot(options) {
                return deps.surfaceTransportProbe.snapshot(options);
            },
            mark(name, payload) {
                deps.surfaceTransportProbe.mark(name, payload);
                return deps.surfaceTransportProbe.snapshot();
            },
        },
        avatarDefinition: deps.avatarDefinition,
        importAvatarDefinitionText: deps.importAvatarDefinitionText,
        utilityConfig(kind) {
            return deps.utilityConfig(kind);
        },
        uxTree() {
            return deps.sigilUxTreeSnapshot();
        },
        uxTreeShadow(input) {
            return deps.sigilUxTreeShadowResolver().resolve(input || {});
        },
        uxTreeReadiness() {
            return deps.sigilUxTreeReadiness();
        },
        uxTreeCommand(input, registry = {}) {
            return deps.executeSigilUxTreeCommand(deps.sigilUxTreeSnapshot(), {
                input: input || {},
                registry,
                context: { source: 'debug-api' },
            });
        },
        openWikiWorkbench(path) {
            return deps.openWikiWorkbench(path || deps.defaultWikiPath);
        },
        fastTravelPreview() {
            return deps.fastTravel.preview();
        },
        interactionTrace() {
            return deps.interactionTrace.snapshot({
                runtime: deps.runtimeSnapshot({ includeUtilityUrls: false }),
                snapshot: api.snapshot(),
            });
        },
        clearInteractionTrace() {
            deps.interactionTrace.clear();
            return deps.interactionTrace.snapshot();
        },
        armInteractionTrace(label = 'manual') {
            return deps.interactionTrace.arm(label);
        },
        stopInteractionTrace(reason = 'manual') {
            return deps.interactionTrace.stop(reason);
        },
        latestInteractionTraceCapture() {
            return deps.interactionTrace.latestCapture();
        },
        setInteractionTraceEnabled(value) {
            return deps.interactionTrace.setEnabled(value);
        },
        createSelectionModeContext(input = {}) {
            return deps.createSelectionModeContextFromDebugInput(input);
        },
        enterSelectionMode(pointer = deps.liveJs.pointerPos) {
            return deps.enterSelectionMode(pointer, 'debug-api');
        },
        cancelSelectionMode(reason = 'debug-api') {
            return deps.exitSelectionMode(reason);
        },
        commitSelectionMode(reason = 'debug-api') {
            return deps.commitSelectionMode(reason);
        },
        setSelectionModeNodeComment(nodeId = '', text = '', options = {}) {
            return deps.setSelectionModeNodeComment(nodeId, text, options);
        },
        appendActiveContextKeyframe(options = {}) {
            return deps.appendContextRecordingKeyframe(deps.liveJs.activeContext?.context_keyframe, options);
        },
        appendContextRecordingEvent(event = {}) {
            return deps.appendContextRecordingEvent(event);
        },
        exportContextRecording() {
            return deps.contextRecordingRuntime.exportContextRecording();
        },
    };
    return api;
}
