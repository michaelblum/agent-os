import {
    createSigilVoiceDictationController,
    isSpacebarDictationInput,
    isVoiceDictationEvent,
} from './voice-dictation.js';
import {
    createSigilVoiceResponsePolicy,
    sigilVoiceResponseBackendMenuItems,
} from './voice-response-policy.js';

function boundedPush(list, value, maxItems) {
    list.push(value);
    while (list.length > maxItems) list.shift();
}

function ensureList(target, key) {
    if (!Array.isArray(target[key])) target[key] = [];
    return target[key];
}

export function isSigilTextEntryActive(doc = globalThis.document, commentEditorRoot = null) {
    const active = doc?.activeElement;
    if (!active || active === doc?.body || active === doc?.documentElement) return false;
    if (commentEditorRoot?.contains?.(active)) return true;
    if (active.isContentEditable) return true;
    return typeof active.matches === 'function' && active.matches([
        'input:not([type="checkbox"]):not([type="radio"])',
        'textarea',
        'select',
        '[role="textbox"]',
        '[contenteditable="true"]',
    ].join(','));
}

export function normalizeSigilVoiceInputSourceIdentity(message = {}) {
    return {
        sourceOrigin: message.sourceOrigin ?? message.source_origin ?? null,
        sourceCanvasId: message.sourceCanvasId ?? message.source_canvas_id ?? null,
        ownerCanvasId: message.ownerCanvasId ?? message.owner_canvas_id ?? null,
        envelopeType: message.envelopeType ?? message.envelope_type ?? null,
    };
}

function sourceIdentityAllowsGlobalHotkey(identity = {}) {
    if (identity.sourceOrigin === 'canvas') return false;
    if (identity.envelopeType === 'input_region.event') return false;
    return !identity.sourceCanvasId && !identity.ownerCanvasId;
}

function voiceInputDecision(message, snapshot, context = {}) {
    if (!isSpacebarDictationInput(message)) return { canHandle: false, reason: 'not_spacebar' };
    if (snapshot.spacebarHeld || snapshot.holdKeyDown) {
        return { canHandle: true, reason: 'dictation_active' };
    }
    if (context.textInputActive) return { canHandle: false, reason: 'text_input_active' };
    if (context.selectionModeActive) return { canHandle: false, reason: 'selection_mode_active' };
    if (context.avatarControlsOpen || context.panelOpen) return { canHandle: false, reason: 'panel_active' };
    if (context.currentState === 'RADIAL' || context.currentState === 'FAST_TRAVEL') {
        return { canHandle: false, reason: 'higher_priority_mode_active' };
    }
    if (!sourceIdentityAllowsGlobalHotkey(context.sourceIdentity)) {
        return { canHandle: false, reason: 'non_global_source' };
    }
    return { canHandle: true, reason: 'global_hotkey' };
}

export function createSigilVoiceRuntime({
    liveState,
    recordInteraction = () => {},
    scheduleRenderFrame = () => {},
    isRendererSuspended = () => false,
    maxActions = 32,
    maxEvents = 32,
    createDictationController = createSigilVoiceDictationController,
    createResponsePolicy = createSigilVoiceResponsePolicy,
    getInputContext = () => ({}),
} = {}) {
    if (!liveState || typeof liveState !== 'object') {
        throw new TypeError('createSigilVoiceRuntime requires liveState');
    }

    function scheduleVoiceFrame() {
        if (!isRendererSuspended()) scheduleRenderFrame({ structural: false });
    }

    function recordVoiceResponseAction(action) {
        boundedPush(ensureList(liveState, 'voiceResponseActions'), action, maxActions);
        recordInteraction('voice-response:action', {
            kind: action.kind,
            event: action.event,
            backendId: action.backendId,
            mocked: action.mocked,
        });
    }

    const voiceResponsePolicy = createResponsePolicy({
        playSound: recordVoiceResponseAction,
        speak: recordVoiceResponseAction,
        onChange(snapshot, transition) {
            liveState.voiceResponse = snapshot;
            recordInteraction('voice-response', { transition });
            scheduleVoiceFrame();
        },
    });
    liveState.voiceResponse = voiceResponsePolicy.snapshot();

    let voiceDictation = null;
    voiceDictation = createDictationController({
        onChange(snapshot, transition) {
            liveState.voiceDictation = snapshot;
            recordInteraction('voice-dictation', { transition });
            scheduleVoiceFrame();
        },
        onVoiceEvent(event, transition) {
            boundedPush(ensureList(liveState, 'voiceDictationEvents'), event, maxEvents);
            liveState.voiceDictation = voiceDictation.snapshot();
            recordInteraction('voice-dictation:event', {
                event: event.event,
                data: event.data,
                transition,
            });
            voiceResponsePolicy.handleVoiceEvent(event);
        },
    });
    liveState.voiceDictation = voiceDictation.snapshot();

    function responseBackendMenuItems() {
        return sigilVoiceResponseBackendMenuItems(voiceResponsePolicy.snapshot());
    }

    function handleMenuAction(actionId) {
        const result = voiceResponsePolicy.handleMenuAction(actionId);
        if (result.handled) liveState.voiceResponse = voiceResponsePolicy.snapshot();
        return result;
    }

    function handleInput(message = {}) {
        const snapshot = voiceDictation.snapshot();
        if (!isSpacebarDictationInput(message)) {
            return { handled: false, reason: 'not_spacebar', snapshot };
        }
        const context = typeof getInputContext === 'function' ? getInputContext(message) || {} : {};
        const decision = voiceInputDecision(message, snapshot, context);
        if (!decision.canHandle) {
            return { handled: false, reason: decision.reason, snapshot };
        }
        return { ...voiceDictation.handleInput(message), policy: decision.reason };
    }

    function handleVoiceEvent(message = {}) {
        if (!isVoiceDictationEvent(message)) {
            return { handled: false, reason: 'not_voice_dictation_event' };
        }
        return {
            handled: true,
            dictation: voiceDictation.handleVoiceEvent(message),
            response: voiceResponsePolicy.handleVoiceEvent(message),
        };
    }

    return Object.freeze({
        handleInput,
        handleMenuAction,
        handleVoiceEvent,
        responseBackendMenuItems,
        snapshot() {
            return Object.freeze({
                voiceDictation: voiceDictation.snapshot(),
                voiceResponse: voiceResponsePolicy.snapshot(),
            });
        },
    });
}
