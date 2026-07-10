import {
    createSigilVoiceDictationController,
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

export function createSigilVoiceRuntime({
    liveState,
    recordInteraction = () => {},
    scheduleRenderFrame = () => {},
    isRendererSuspended = () => false,
    maxActions = 32,
    maxEvents = 32,
    createDictationController = createSigilVoiceDictationController,
    createResponsePolicy = createSigilVoiceResponsePolicy,
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
        return voiceDictation.handleInput(message);
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
