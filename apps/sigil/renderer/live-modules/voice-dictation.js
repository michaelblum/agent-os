export const SIGIL_DICTATION_TIMEOUT_MS = 15000;

export const VOICE_DICTATION_EVENT_NAMES = new Set([
    'wake_detected',
    'dictation_opened',
    'dictation_closed_send',
    'dictation_closed_cancel',
]);

const VOICE_SOURCE_VALUES = new Set(['hotkey', 'phrase']);
const VOICE_CLOSE_REASONS = new Set(['key_release', 'phrase', 'explicit_trigger', 'timeout']);

function defaultNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function defaultTimestampSeconds() {
    return Date.now() / 1000;
}

function stringField(value) {
    return typeof value === 'string' ? value : '';
}

function normalizeSource(source) {
    return VOICE_SOURCE_VALUES.has(source) ? source : 'hotkey';
}

function normalizeCloseReason(reason) {
    return VOICE_CLOSE_REASONS.has(reason) ? reason : 'explicit_trigger';
}

function keyName(msg = {}) {
    return String(msg.key ?? msg.key_name ?? msg.code ?? '').toLowerCase();
}

export function isSpacebarDictationInput(msg = {}) {
    if (msg.type !== 'key_down' && msg.type !== 'key_up') return false;
    if (Number(msg.key_code) === 49) return true;
    const key = keyName(msg);
    return key === ' ' || key === 'space' || key === 'spacebar';
}

export function normalizeVoiceDictationEvent(msg = {}) {
    if (msg?.service === 'voice' && VOICE_DICTATION_EVENT_NAMES.has(msg.event)) {
        return {
            v: msg.v ?? 1,
            service: 'voice',
            event: msg.event,
            ts: Number(msg.ts) || defaultTimestampSeconds(),
            data: (msg.data && typeof msg.data === 'object') ? msg.data : {},
            ref: msg.ref,
        };
    }

    if (VOICE_DICTATION_EVENT_NAMES.has(msg?.type)) {
        const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : msg;
        const data = (payload.data && typeof payload.data === 'object')
            ? payload.data
            : {
                ...(payload.source ? { source: payload.source } : {}),
                ...(payload.reason ? { reason: payload.reason } : {}),
            };
        return {
            v: 1,
            service: 'voice',
            event: msg.type,
            ts: Number(payload.ts) || defaultTimestampSeconds(),
            data,
            ref: payload.ref,
        };
    }

    return null;
}

export function isVoiceDictationEvent(msg = {}) {
    return normalizeVoiceDictationEvent(msg) !== null;
}

export function createSigilVoiceDictationController({
    now = defaultNowMs,
    timestamp = defaultTimestampSeconds,
    timeoutMs = SIGIL_DICTATION_TIMEOUT_MS,
    onChange = () => {},
    onVoiceEvent = () => {},
} = {}) {
    let state = {
        phase: 'IDLE',
        source: null,
        openedAtMs: null,
        closedAtMs: null,
        closeReason: null,
        transcript: '',
        speechDetected: false,
        lastVoiceEvent: null,
    };
    let spacebarHeld = false;

    function snapshot() {
        return {
            ...state,
            hasCapture: state.speechDetected || state.transcript.trim().length > 0,
            timeoutMs,
            spacebarHeld,
        };
    }

    function publishChange(previousPhase, cause) {
        const current = snapshot();
        const transition = {
            cause,
            from: previousPhase,
            to: current.phase,
            source: current.source,
            reason: current.closeReason,
        };
        onChange(current, transition);
        return { handled: true, transition, snapshot: current };
    }

    function makeVoiceEvent(event, data = {}) {
        return {
            v: 1,
            service: 'voice',
            event,
            ts: timestamp(),
            data,
        };
    }

    function publishVoiceEvent(event, data, transition) {
        const envelope = makeVoiceEvent(event, data);
        state.lastVoiceEvent = envelope;
        onVoiceEvent(envelope, transition);
        return envelope;
    }

    function open(source = 'hotkey', cause = 'dictation_opened', { emit = true } = {}) {
        const previousPhase = state.phase;
        state = {
            phase: 'LISTENING',
            source: normalizeSource(source),
            openedAtMs: now(),
            closedAtMs: null,
            closeReason: null,
            transcript: '',
            speechDetected: false,
            lastVoiceEvent: state.lastVoiceEvent,
        };
        const result = publishChange(previousPhase, cause);
        if (emit) publishVoiceEvent('dictation_opened', { source: state.source }, result.transition);
        return result;
    }

    function close(reason = 'explicit_trigger', forcedPhase = null, { emit = true } = {}) {
        if (state.phase !== 'LISTENING') {
            return { handled: false, reason: 'not_listening', snapshot: snapshot() };
        }
        const previousPhase = state.phase;
        const closeReason = normalizeCloseReason(reason);
        const hasCapture = state.speechDetected || state.transcript.trim().length > 0;
        const nextPhase = forcedPhase || (hasCapture ? 'SEND' : 'CANCEL');
        state = {
            ...state,
            phase: nextPhase,
            closedAtMs: now(),
            closeReason,
        };
        const result = publishChange(previousPhase, `dictation_closed_${nextPhase.toLowerCase()}`);
        if (emit) {
            const event = nextPhase === 'SEND' ? 'dictation_closed_send' : 'dictation_closed_cancel';
            publishVoiceEvent(event, { reason: closeReason }, result.transition);
        }
        return result;
    }

    function handleInput(msg = {}) {
        if (!isSpacebarDictationInput(msg)) return { handled: false, snapshot: snapshot() };

        if (msg.type === 'key_down') {
            if (spacebarHeld && state.phase === 'LISTENING') {
                return { handled: true, reason: 'spacebar_repeat', snapshot: snapshot() };
            }
            spacebarHeld = true;
            return open('hotkey', 'spacebar_down');
        }

        spacebarHeld = false;
        return close('key_release');
    }

    function recordSpeech(input = {}) {
        const previousPhase = state.phase;
        const transcript = typeof input === 'string' ? input : stringField(input.transcript);
        const speechDetected = typeof input === 'object' && input !== null && input.speechDetected === true;
        state = {
            ...state,
            transcript,
            speechDetected: speechDetected || transcript.trim().length > 0,
        };
        return publishChange(previousPhase, 'speech_update');
    }

    function handleTimeout() {
        if (state.phase !== 'LISTENING') return { handled: false, reason: 'not_listening', snapshot: snapshot() };
        if (now() - state.openedAtMs < timeoutMs) return { handled: false, reason: 'not_due', snapshot: snapshot() };
        spacebarHeld = false;
        return close('timeout');
    }

    function handleVoiceEvent(msg = {}) {
        const event = normalizeVoiceDictationEvent(msg);
        if (!event) return { handled: false, snapshot: snapshot() };
        state.lastVoiceEvent = event;

        if (event.event === 'wake_detected') {
            return publishChange(state.phase, 'wake_detected');
        }
        if (event.event === 'dictation_opened') {
            spacebarHeld = event.data?.source === 'hotkey';
            return open(event.data?.source, 'voice_event.dictation_opened', { emit: false });
        }
        if (event.event === 'dictation_closed_send') {
            spacebarHeld = false;
            return close(event.data?.reason, 'SEND', { emit: false });
        }
        if (event.event === 'dictation_closed_cancel') {
            spacebarHeld = false;
            return close(event.data?.reason, 'CANCEL', { emit: false });
        }

        return { handled: false, snapshot: snapshot() };
    }

    function reset(cause = 'reset') {
        const previousPhase = state.phase;
        state = {
            phase: 'IDLE',
            source: null,
            openedAtMs: null,
            closedAtMs: null,
            closeReason: null,
            transcript: '',
            speechDetected: false,
            lastVoiceEvent: state.lastVoiceEvent,
        };
        spacebarHeld = false;
        return publishChange(previousPhase, cause);
    }

    return {
        handleInput,
        handleTimeout,
        handleVoiceEvent,
        recordSpeech,
        reset,
        snapshot,
    };
}
