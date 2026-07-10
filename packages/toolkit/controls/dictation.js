export const DICTATION_TIMEOUT_MS = 15000;

export const VOICE_DICTATION_EVENT_NAMES = new Set([
  'wake_detected',
  'dictation_opened',
  'dictation_closed_send',
  'dictation_closed_cancel',
]);

const VOICE_SOURCE_VALUES = new Set(['hotkey', 'phrase']);
const VOICE_CLOSE_REASONS = new Set(['key_release', 'phrase', 'explicit_trigger', 'timeout']);
const CANONICAL_VOICE_EVENT_FIELDS = new Set(['v', 'service', 'event', 'ts', 'data', 'ref']);

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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateVoiceEventData(eventName, data) {
  if (!isObjectRecord(data)) return null;
  const keys = Object.keys(data);
  if (eventName === 'wake_detected' || eventName === 'dictation_opened') {
    if (keys.length !== 1 || keys[0] !== 'source' || !VOICE_SOURCE_VALUES.has(data.source)) return null;
    return { source: data.source };
  }
  if (eventName === 'dictation_closed_send' || eventName === 'dictation_closed_cancel') {
    if (keys.length !== 1 || keys[0] !== 'reason' || !VOICE_CLOSE_REASONS.has(data.reason)) return null;
    return { reason: data.reason };
  }
  return null;
}

function hasCanonicalEnvelopeIdentity(message) {
  if (!isObjectRecord(message)) return false;
  return ['v', 'service', 'event'].some((field) => Object.hasOwn(message, field));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isHoldToDictateInput(msg = {}) {
  if (msg.type !== 'key_down' && msg.type !== 'key_up') return false;
  if (Number(msg.key_code) === 49) return true;
  const key = keyName(msg);
  return key === ' ' || key === 'space' || key === 'spacebar';
}

export function parseCanonicalVoiceDictationEvent(message = {}) {
  if (!isObjectRecord(message)) return null;
  if (message.v !== 1 || message.service !== 'voice' || !VOICE_DICTATION_EVENT_NAMES.has(message.event)) return null;
  if (!Object.keys(message).every((field) => CANONICAL_VOICE_EVENT_FIELDS.has(field))) return null;
  if (typeof message.ts !== 'number' || !Number.isFinite(message.ts)) return null;
  if (message.ref !== undefined && typeof message.ref !== 'string') return null;
  const data = validateVoiceEventData(message.event, message.data);
  if (!data) return null;
  return {
    v: 1,
    service: 'voice',
    event: message.event,
    ts: message.ts,
    data,
    ...(typeof message.ref === 'string' ? { ref: message.ref } : {}),
  };
}

export function adaptLegacyVoiceDictationBridgeEvent(message = {}) {
  if (!isObjectRecord(message) || !VOICE_DICTATION_EVENT_NAMES.has(message.type)) return null;
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : message;
  const rawData = payload.data && typeof payload.data === 'object'
    ? payload.data
    : {
      ...(payload.source ? { source: payload.source } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
    };
  const data = validateVoiceEventData(message.type, rawData);
  if (!data) return null;
  return {
    v: 1,
    service: 'voice',
    event: message.type,
    ts: finiteNumber(payload.ts) ?? defaultTimestampSeconds(),
    data,
    ...(typeof payload.ref === 'string' ? { ref: payload.ref } : {}),
  };
}

export function normalizeVoiceDictationEvent(message = {}) {
  if (hasCanonicalEnvelopeIdentity(message)) {
    return parseCanonicalVoiceDictationEvent(message);
  }
  return adaptLegacyVoiceDictationBridgeEvent(message);
}

export function isVoiceDictationEvent(msg = {}) {
  return normalizeVoiceDictationEvent(msg) !== null;
}

export function createDictationController({
  now = defaultNowMs,
  timestamp = defaultTimestampSeconds,
  timeoutMs = DICTATION_TIMEOUT_MS,
  isDictationInput = isHoldToDictateInput,
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
  let holdKeyDown = false;

  function snapshot() {
    return {
      ...state,
      hasCapture: state.speechDetected || state.transcript.trim().length > 0,
      timeoutMs,
      spacebarHeld: holdKeyDown,
      holdKeyDown,
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
    if (!isDictationInput(msg)) return { handled: false, snapshot: snapshot() };

    if (msg.type === 'key_down') {
      if (holdKeyDown && state.phase === 'LISTENING') {
        return { handled: true, reason: 'spacebar_repeat', snapshot: snapshot() };
      }
      holdKeyDown = true;
      return open('hotkey', 'spacebar_down');
    }

    holdKeyDown = false;
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
    holdKeyDown = false;
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
      holdKeyDown = event.data?.source === 'hotkey';
      return open(event.data?.source, 'voice_event.dictation_opened', { emit: false });
    }
    if (event.event === 'dictation_closed_send') {
      holdKeyDown = false;
      return close(event.data?.reason, 'SEND', { emit: false });
    }
    if (event.event === 'dictation_closed_cancel') {
      holdKeyDown = false;
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
    holdKeyDown = false;
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

export function buildDictationTextValue(currentValue = '', transcript = '', options = {}) {
  const current = String(currentValue ?? '');
  const text = String(transcript ?? '');
  const mode = options.mode === 'replace' || options.mode === 'append' ? options.mode : 'insert';

  if (mode === 'replace') {
    return {
      value: text,
      selectionStart: text.length,
      selectionEnd: text.length,
      changed: current !== text,
    };
  }

  if (mode === 'append') {
    const separator = options.separator ?? (current.trim().length > 0 && text.trim().length > 0 ? ' ' : '');
    const value = `${current}${separator}${text}`;
    return {
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
      changed: current !== value,
    };
  }

  const start = clamp(finiteNumber(options.selectionStart) ?? current.length, 0, current.length);
  const end = clamp(finiteNumber(options.selectionEnd) ?? start, start, current.length);
  const value = `${current.slice(0, start)}${text}${current.slice(end)}`;
  const cursor = start + text.length;
  return {
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
    changed: current !== value,
  };
}

export function applyDictationTextValue(target, transcript = '', options = {}) {
  if (!target) {
    return buildDictationTextValue('', transcript, options);
  }
  const current = typeof target.getValue === 'function'
    ? target.getValue()
    : target.value;
  const result = buildDictationTextValue(current, transcript, {
    selectionStart: options.selectionStart ?? target.selectionStart,
    selectionEnd: options.selectionEnd ?? target.selectionEnd,
    mode: options.mode,
    separator: options.separator,
  });

  if (typeof target.setValue === 'function') {
    target.setValue(result.value, options.setValueOptions || {});
  } else {
    target.value = result.value;
  }

  if (typeof target.setSelectionRange === 'function') {
    target.setSelectionRange(result.selectionStart, result.selectionEnd);
  } else {
    target.selectionStart = result.selectionStart;
    target.selectionEnd = result.selectionEnd;
  }

  return result;
}
