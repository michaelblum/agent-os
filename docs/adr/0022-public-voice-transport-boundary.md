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
- `aos listen --source microphone --segments <absolute-directory> --follow`
- `aos say --follow`, with text read from stdin
- `aos play --audio <absolute.wav> --follow`

These forms are connection-scoped leases over the existing unified daemon.
They do not expose the private socket as a consumer API.

## Native Ownership

The broker owns the behavior that requires its stable permissioned identity:

- exact global chord matching, repeat suppression, and consumption;
- 16 kHz mono PCM microphone capture;
- create-new owner-only WAV handoff and cleanup;
- continuous capture with atomically published, deterministic WAV checkpoints;
- an optional bounded ready chime after microphone arming and before segmented
  capture admission;
- capture and playback meter calculation;
- system speech buffers and playback;
- bounded owner-only WAV validation and playback;
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
- One-shot capture requires a canonical, non-symlinked, owner-owned `0700`
  parent and a create-new `0600` target. Segmented capture requires an empty,
  canonical, non-symlinked, owner-owned `0700` directory and creates only
  deterministic `0600` WAV segments within it.
- Capture is globally singleton, at most 120 seconds, at most 4 MiB, and is
  removed on cancellation, disconnect, failure, or daemon shutdown.
- Speech text enters through stdin and never appears in events or errors.
- WAV playback requires a canonical `0600` regular file beneath a canonical,
  non-symlinked, owner-owned `0700` parent. Input is at most 4 MiB and 120
  seconds, with mono or stereo PCM at 8 to 192 kHz.
- Events never contain audio bytes, spoken text, or local paths.
- When segmented capture requests the ready chime, AOS starts the input engine
  with its capture gate closed, discards cue and settling audio, then opens the
  gate and emits `capture_segmented_started`. Cue failure emits no start event
  and leaves no capture output.
- Segmented capture startup is asynchronous after its connection-scoped lease
  is acknowledged. Only `capture_segmented_started` proves microphone
  admission. Owner disconnect and cancellation remain observable while input
  arming or cue playback is in progress, and terminal cleanup waits for any
  in-flight engine arming to settle.
- Cue exclusion uses the microphone callback's host clock when available and
  its sample clock otherwise. A cue request fails with
  `CAPTURE_CLOCK_UNAVAILABLE` rather than claiming readiness when neither clock
  can establish the capture boundary.
- There is no raw PCM socket stream and no AOS-owned transcription.

## Event Contract

The `voice` event service adds strict one-shot and segmented capture,
`audio_frame`, and speech lifecycle events beside the existing generic
dictation events. A segment-ready event exposes only its deterministic index,
duration, and byte count after atomic publication. `audio_frame` contains only
normalized RMS/peak values and a sequence number, at no more than 10 Hz per
stream.

## Compatibility

Existing channel/session `aos listen`, hotkey, one-shot microphone, and
one-shot `aos say` behavior are unchanged. Segmented microphone capture is a
separate form selected by `--segments`; `--ready-cue chime` is opt-in and
defaults to no cue. `say --follow` remains a separate form
using streamed system speech; provider-backed non-system speech remains behind
its existing provider seam. `aos play --follow` shares the singleton output
lease with streamed speech, so capture, barge-in, cancellation, owner loss, and
daemon shutdown retain one cleanup boundary.

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

Packaged AOS metadata owns `NSMicrophoneUsageDescription`. The enterprise-Mac
raw repo build remains the plain artifact shape owned by ADR 0023 and does not
consume packaged metadata; development microphone proof is therefore an
explicit environment-sensitive gate, not a portable distribution claim.

## Consequences

- AOS may be rebuilt when this native transport changes because the work is a
  new privileged native stream under ADR 0015.
- Sigil can consume stable public forms without binding to the private socket.
- A consumer may choose any local transcription worker after AOS atomically
  publishes a WAV or segment, and must delete each file when transcription
  ends.
- AOS-owned transcription, cross-segment text stability, wake phrases,
  auto-send, and product-specific voice state remain outside this decision.
