# Sigil Voice Response Policy

Sigil owns the first response policy for generic `voice.*` lifecycle events. The
daemon still owns capture, permissions, transport, and future model execution;
Sigil only decides how its avatar should respond when it sees voice lifecycle
events such as `voice.dictation_opened`.

## Current Proof

`apps/sigil/renderer/live-modules/voice-response-policy.js` maps normalized
voice dictation events to Sigil response actions:

- `dictation_opened` -> `sigil_dictation_opened` or mocked "Listening." TTS
- `dictation_closed_send` -> `sigil_dictation_send` or mocked "Sending dictation." TTS
- `dictation_closed_cancel` -> `sigil_dictation_cancel` or mocked "Dictation cancelled." TTS
- `wake_detected` -> `sigil_voice_wake` or mocked "Voice wake detected." TTS

The status-item menu exposes three backends:

- System Sound, available by default
- Mock TTS, available for deterministic renderer proof
- Kokoro TTS, visible but disabled until model distribution is cleared

The current Sigil hooks record response actions in renderer state. They do not
call `aos say`, daemon voice assignment APIs, Whisper, Kokoro, or native audio
engines. This keeps default validation static and mocked while proving policy
lookup, backend selection, and event-to-response routing.

## Future Real Assets

Real Kokoro and Whisper assets can be enabled only after distribution clearance
answers these questions:

- license terms permit bundling or deterministic local download for the exact
  model files
- model weights have stable hashes, size expectations, and documented storage
  paths
- the packaged runtime has an approved launch path for the model process
- microphone and speech permissions remain brokered by the runtime/TCC layer
- renderer tests keep using mock audio and mock TTS by default

When those gates are satisfied, Sigil should keep this policy shape and swap the
backend callbacks behind the selected backend. The generic `voice.*` event names
should remain the renderer contract; daemon-specific schemas and provider
records should stay out of Sigil policy code.
