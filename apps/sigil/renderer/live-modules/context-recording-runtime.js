import { toolkitSpecifier } from './content-roots.js';

const {
    createContextKeyframe,
    createContextRecording,
} = await import(toolkitSpecifier('workbench/context-session.js'));

const RETICLE_CONTEXT_ASSET_REFS = Object.freeze({
    capture_image: 'capture.png',
    capture_json: 'capture.json',
    display_geometry_json: 'display-geometry.json',
    canvas_list_json: 'canvas-list.json',
    inspector_state_json: 'inspector-state.json',
    surface_inspector_annotation_snapshot: 'annotation-snapshot.json',
});

export function createDefaultActiveContextState() {
    return {
        source: '',
        updated_at: null,
        context_session: null,
        context_keyframe: null,
        unavailable: null,
    };
}

export function createDefaultContextRecordingState() {
    return {
        recording: null,
        keyframes: [],
        events: [],
    };
}

export function createSigilContextRecordingRuntime({
    liveState = {},
    rendererState = null,
    now = () => new Date().toISOString(),
} = {}) {
    if (!liveState.activeContext) liveState.activeContext = createDefaultActiveContextState();
    if (!liveState.contextRecording) liveState.contextRecording = createDefaultContextRecordingState();

    function syncActiveContext(activeContext) {
        liveState.activeContext = activeContext;
        if (rendererState) rendererState.activeContext = activeContext;
        return activeContext;
    }

    function syncContextRecording(recordingState) {
        liveState.contextRecording = recordingState;
        if (rendererState) rendererState.contextRecording = recordingState;
        return recordingState;
    }

    function createContextKeyframeForSession(contextSession = null, {
        trigger = 'manual',
        reason = '',
        source = 'active_context',
        capturedAt = now(),
        assetRefs = {},
        metadata = {},
    } = {}) {
        if (contextSession?.schema !== 'aos_context_session') return null;
        return createContextKeyframe({
            captured_at: capturedAt,
            trigger,
            artifact_ids: Array.isArray(contextSession.artifacts)
                ? contextSession.artifacts.map((artifact) => artifact.id).filter(Boolean)
                : [],
            session_summary: {
                schema: contextSession.schema,
                version: contextSession.version,
                id: contextSession.id,
            },
            asset_refs: assetRefs,
            metadata: {
                source,
                request_reason: reason,
                ...metadata,
            },
        });
    }

    function setActiveContextProvider({
        source = '',
        contextSession = null,
        contextKeyframe = null,
        unavailable = null,
        trigger = 'active_context',
        reason = '',
        assetRefs = {},
        metadata = {},
    } = {}) {
        const capturedAt = now();
        const keyframe = contextKeyframe || createContextKeyframeForSession(contextSession, {
            trigger,
            reason,
            source,
            capturedAt,
            assetRefs,
            metadata,
        });
        return syncActiveContext({
            source,
            updated_at: capturedAt,
            context_session: contextSession || null,
            context_keyframe: keyframe || null,
            unavailable: contextSession ? null : (unavailable || {
                status: 'skipped',
                reason: 'context_session_unavailable',
            }),
        });
    }

    function updateActiveContextFromReticle(contextSession = null, reason = 'reticle') {
        return setActiveContextProvider({
            source: 'sigil_annotation_reticle',
            contextSession,
            trigger: 'sigil_radial_camera',
            reason,
            assetRefs: RETICLE_CONTEXT_ASSET_REFS,
        });
    }

    function appendContextRecordingKeyframe(keyframe = liveState.activeContext?.context_keyframe, options = {}) {
        if (!keyframe) return null;
        const keyframes = [...(liveState.contextRecording?.keyframes || []), keyframe];
        const events = [...(liveState.contextRecording?.events || [])];
        const recording = createContextRecording({
            id: options.id || liveState.contextRecording?.recording?.id,
            created_at: liveState.contextRecording?.recording?.created_at || keyframe.captured_at,
            updated_at: options.updated_at || now(),
            source_session_ref: options.source_session_ref || {
                schema: liveState.activeContext?.context_session?.schema || '',
                id: liveState.activeContext?.context_session?.id || '',
            },
            keyframes,
            events,
            asset_refs: options.asset_refs || liveState.contextRecording?.recording?.asset_refs || {},
            source_metadata: {
                source: 'sigil_renderer_debug_recording',
                ...(options.source_metadata || {}),
            },
        });
        syncContextRecording({ recording, keyframes: recording.keyframes, events: recording.events });
        return recording;
    }

    function appendContextRecordingEvent(event = {}) {
        const keyframes = [...(liveState.contextRecording?.keyframes || [])];
        const events = [...(liveState.contextRecording?.events || []), event];
        const recording = createContextRecording({
            id: liveState.contextRecording?.recording?.id,
            created_at: liveState.contextRecording?.recording?.created_at || event.occurred_at || now(),
            updated_at: now(),
            source_session_ref: liveState.contextRecording?.recording?.source_session_ref || null,
            keyframes,
            events,
            asset_refs: liveState.contextRecording?.recording?.asset_refs || {},
            source_metadata: liveState.contextRecording?.recording?.source_metadata || { source: 'sigil_renderer_debug_recording' },
        });
        syncContextRecording({ recording, keyframes: recording.keyframes, events: recording.events });
        return recording;
    }

    function exportContextRecording() {
        return liveState.contextRecording?.recording || createContextRecording({
            keyframes: liveState.contextRecording?.keyframes || [],
            events: liveState.contextRecording?.events || [],
        });
    }

    return {
        createContextKeyframeForSession,
        setActiveContextProvider,
        updateActiveContextFromReticle,
        appendContextRecordingKeyframe,
        appendContextRecordingEvent,
        exportContextRecording,
        snapshot() {
            return {
                activeContext: liveState.activeContext || createDefaultActiveContextState(),
                contextRecording: liveState.contextRecording || createDefaultContextRecordingState(),
            };
        },
    };
}
