# ADR 0022: Public Voice Transport Boundary

**Status:** Accepted
**Date:** 2026-07-12

## Decision

AOS exposes global hold-to-talk input, bounded microphone capture, and streamed
system speech as product-neutral public CLI streams. AOS remains the sole
macOS TCC and audio-device holder. Consumer products own transcription,
dictation policy, conversations, presence, approval, and user experience.

The initial public forms are:

- `aos listen --source hotkey --shortcut <chord> --follow`
- `aos listen --source microphone --output <absolute.wav> --follow`
- `aos say --follow`, with text read from stdin

These forms are connection-scoped leases over the existing unified daemon.
They do not expose the private socket as a consumer API.

## Native Ownership

The broker owns the behavior that requires its stable permissioned identity:

- exact global chord matching, repeat suppression, and consumption;
- 16 kHz mono PCM microphone capture;
- create-new owner-only WAV handoff and cleanup;
- capture and playback meter calculation;
- system speech buffers and playback;
- cancellation, disconnect, daemon-shutdown, and barge-in cleanup.

The managed daemon is the microphone permission holder because it owns capture.
It exposes live authorization as one of `not_determined`, `restricted`,
`denied`, or `authorized`, and it alone calls
`AVCaptureDevice.requestAccess(for:.audio)`. First capture requests access when
state is `not_determined`; every non-authorized terminal state fails before a
WAV is created. Foreground CLI authorization is diagnostic and cannot make
voice readiness true.

The external command adapters own parsing, help, stdin handling, signal
translation, and NDJSON presentation.

## Security And Privacy

- Hotkey streams emit only `dictation_opened` and `dictation_closed_*`; they do
  not expose unrelated key events.
- Capture requires a canonical, non-symlinked, owner-owned `0700` parent and a
  create-new `0600` target.
- Capture is globally singleton, at most 120 seconds, at most 4 MiB, and is
  removed on cancellation, disconnect, failure, or daemon shutdown.
- Speech text enters through stdin and never appears in events or errors.
- Events never contain audio bytes, spoken text, or local paths.
- There is no raw PCM socket stream and no AOS-owned transcription.

## Event Contract

The `voice` event service adds strict capture, `audio_frame`, and speech
lifecycle events beside the existing generic dictation events. `audio_frame`
contains only normalized RMS/peak values and a sequence number, at no more than
10 Hz per stream.

## Compatibility

Existing channel/session `aos listen` forms and one-shot `aos say` behavior are
unchanged. `say --follow` is a separate form using streamed system speech;
provider-backed non-system speech remains behind its existing provider seam.

## Consumer Permission Contract

External consumers, including Sigil, start capture through the public AOS
stream and allow first use to trigger the daemon-owned prompt. When daemon
state is `denied`, the consumer may open
`x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
and poll `aos permissions check --json` until the live daemon state changes.
`restricted` requires administrator policy; `not_determined` remains
requestable. The Microphone pane has no supported Plus button or drag-add
target, and consumers must not shift permission ownership to Electron or
another foreground process.

The raw repo executable receives `NSMicrophoneUsageDescription` from the
identity-free `packaging/RepoRuntimeLinkInfo.plist` during its one existing
`swiftc` link. This preserves the `aos` linker ad-hoc identity and adds no
post-link signing, copy, wrapping, entitlement, or transformation step.

## Consequences

- AOS may be rebuilt when this native transport changes because the work is a
  new privileged native stream under ADR 0015.
- Sigil can consume stable public forms without binding to the private socket.
- A consumer may choose any local transcription worker after AOS finalizes the
  WAV, and must delete the file when transcription ends.
- Partial/live transcription, wake phrases, auto-send, and product-specific
  voice state remain outside this decision.
