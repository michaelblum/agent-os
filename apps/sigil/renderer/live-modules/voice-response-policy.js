import { normalizeVoiceDictationEvent } from './voice-dictation.js';

export const SIGIL_VOICE_RESPONSE_BACKEND_MENU_PREFIX = 'sigil.voice.response.backend.';

export const SIGIL_VOICE_RESPONSE_BACKEND_IDS = Object.freeze({
    SYSTEM_SOUND: 'system-sound',
    MOCK_TTS: 'mock-tts',
    KOKORO: 'kokoro',
});

export const DEFAULT_SIGIL_VOICE_RESPONSE_BACKENDS = Object.freeze([
    Object.freeze({
        id: SIGIL_VOICE_RESPONSE_BACKEND_IDS.SYSTEM_SOUND,
        title: 'System Sound',
        kind: 'sound',
        available: true,
    }),
    Object.freeze({
        id: SIGIL_VOICE_RESPONSE_BACKEND_IDS.MOCK_TTS,
        title: 'Mock TTS',
        kind: 'tts',
        mocked: true,
        available: true,
    }),
    Object.freeze({
        id: SIGIL_VOICE_RESPONSE_BACKEND_IDS.KOKORO,
        title: 'Kokoro TTS',
        kind: 'tts',
        available: false,
        unavailableReason: 'distribution_clearance_required',
    }),
]);

export const SIGIL_VOICE_RESPONSE_EVENT_POLICY = Object.freeze({
    wake_detected: Object.freeze({
        sound: 'sigil_voice_wake',
        text: 'Voice wake detected.',
    }),
    dictation_opened: Object.freeze({
        sound: 'sigil_dictation_opened',
        text: 'Listening.',
    }),
    dictation_closed_send: Object.freeze({
        sound: 'sigil_dictation_send',
        text: 'Sending dictation.',
    }),
    dictation_closed_cancel: Object.freeze({
        sound: 'sigil_dictation_cancel',
        text: 'Dictation cancelled.',
    }),
});

function stringId(value) {
    return String(value || '').trim();
}

function cloneBackend(backend) {
    return Object.freeze({
        id: backend.id,
        title: backend.title,
        kind: backend.kind,
        mocked: backend.mocked === true,
        available: backend.available !== false,
        unavailableReason: backend.unavailableReason || null,
    });
}

function normalizeBackendCatalog(backends = DEFAULT_SIGIL_VOICE_RESPONSE_BACKENDS) {
    const seen = new Set();
    const records = [];
    for (const backend of backends) {
        const id = stringId(backend?.id);
        const title = stringId(backend?.title);
        const kind = stringId(backend?.kind);
        if (!id || !title || !['sound', 'tts'].includes(kind) || seen.has(id)) continue;
        seen.add(id);
        records.push(cloneBackend({
            id,
            title,
            kind,
            mocked: backend.mocked === true,
            available: backend.available !== false,
            unavailableReason: stringId(backend.unavailableReason),
        }));
    }
    return Object.freeze(records);
}

function titleForBackendMenu(backend) {
    if (backend.available) return `Voice Response: ${backend.title}`;
    return `Voice Response: ${backend.title} (Unavailable)`;
}

function findBackend(catalog, id) {
    const backendId = stringId(id);
    return catalog.find((backend) => backend.id === backendId) || null;
}

function firstAvailableBackend(catalog) {
    return catalog.find((backend) => backend.available) || null;
}

function responseKindForBackend(backend) {
    return backend.kind === 'tts' ? 'tts' : 'system_sound';
}

export function lookupSigilVoiceResponsePolicy(eventName) {
    return SIGIL_VOICE_RESPONSE_EVENT_POLICY[stringId(eventName)] || null;
}

export function sigilVoiceResponseBackendIdFromMenuAction(actionId) {
    const value = stringId(actionId);
    if (!value.startsWith(SIGIL_VOICE_RESPONSE_BACKEND_MENU_PREFIX)) return null;
    return value.slice(SIGIL_VOICE_RESPONSE_BACKEND_MENU_PREFIX.length) || null;
}

export function isSigilVoiceResponseBackendMenuAction(actionId) {
    return sigilVoiceResponseBackendIdFromMenuAction(actionId) !== null;
}

export function sigilVoiceResponseBackendMenuItems(snapshot = {}) {
    const selectedBackendId = stringId(snapshot.selectedBackendId);
    const backends = normalizeBackendCatalog(snapshot.backends);
    return backends.map((backend) => ({
        id: `${SIGIL_VOICE_RESPONSE_BACKEND_MENU_PREFIX}${backend.id}`,
        title: titleForBackendMenu(backend),
        checked: backend.id === selectedBackendId,
        enabled: backend.available,
    }));
}

export function createSigilVoiceResponsePolicy({
    backends = DEFAULT_SIGIL_VOICE_RESPONSE_BACKENDS,
    defaultBackendId = SIGIL_VOICE_RESPONSE_BACKEND_IDS.SYSTEM_SOUND,
    playSound = () => {},
    speak = () => {},
    onAction = () => {},
    onChange = () => {},
} = {}) {
    const catalog = normalizeBackendCatalog(backends);
    const fallbackBackend = firstAvailableBackend(catalog);
    let selectedBackendId = (
        findBackend(catalog, defaultBackendId)?.available
            ? stringId(defaultBackendId)
            : fallbackBackend?.id
    ) || null;
    let lastAction = null;

    function selectedBackend() {
        return findBackend(catalog, selectedBackendId) || fallbackBackend;
    }

    function snapshot() {
        const backend = selectedBackend();
        return Object.freeze({
            selectedBackendId: backend?.id || null,
            selectedBackend: backend || null,
            backends: catalog.map(cloneBackend),
            lastAction,
        });
    }

    function publishChange(reason, detail = {}) {
        onChange(snapshot(), { reason, ...detail });
    }

    function selectBackend(backendId) {
        const backend = findBackend(catalog, backendId);
        if (!backend) {
            return { handled: false, selected: false, reason: 'unknown_backend', snapshot: snapshot() };
        }
        if (!backend.available) {
            const result = {
                handled: false,
                selected: false,
                reason: backend.unavailableReason || 'backend_unavailable',
                backend,
                snapshot: snapshot(),
            };
            publishChange(result.reason, { backendId: backend.id });
            return result;
        }
        selectedBackendId = backend.id;
        publishChange('backend_selected', { backendId: backend.id });
        return { handled: true, selected: true, backend, snapshot: snapshot() };
    }

    function handleMenuAction(actionId) {
        const backendId = sigilVoiceResponseBackendIdFromMenuAction(actionId);
        if (!backendId) return { handled: false, reason: 'not_voice_response_menu_action', snapshot: snapshot() };
        const result = selectBackend(backendId);
        return { ...result, handled: true, menuAction: true };
    }

    function handleVoiceEvent(message = {}) {
        const voiceEvent = normalizeVoiceDictationEvent(message);
        if (!voiceEvent) return { handled: false, reason: 'not_voice_event', snapshot: snapshot() };

        const policy = lookupSigilVoiceResponsePolicy(voiceEvent.event);
        if (!policy) return { handled: false, reason: 'unmapped_voice_event', event: voiceEvent, snapshot: snapshot() };

        const backend = selectedBackend();
        if (!backend?.available) {
            return { handled: false, reason: 'no_available_backend', event: voiceEvent, snapshot: snapshot() };
        }

        const action = Object.freeze({
            kind: responseKindForBackend(backend),
            backendId: backend.id,
            backendTitle: backend.title,
            event: voiceEvent.event,
            text: policy.text,
            sound: policy.sound,
            mocked: backend.mocked === true || backend.id === SIGIL_VOICE_RESPONSE_BACKEND_IDS.MOCK_TTS,
            data: voiceEvent.data,
            ts: voiceEvent.ts,
        });
        if (backend.kind === 'tts') {
            speak(action);
        } else {
            playSound(action);
        }
        lastAction = action;
        onAction(action, voiceEvent);
        publishChange('voice_event_response', { event: voiceEvent.event, backendId: backend.id });
        return { handled: true, event: voiceEvent, action, snapshot: snapshot() };
    }

    return Object.freeze({
        handleMenuAction,
        handleVoiceEvent,
        selectBackend,
        snapshot,
    });
}
