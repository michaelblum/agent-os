# Bundled Whisper STT Spike

Status: Spike proof, distribution-gated.

Owner: `scripts/lib/aos-stt/bundled-whisper.mjs`

## Purpose

This spike proves the local speech-to-text provider boundary for consumer-side
Bundled Whisper integration without requiring live microphone input, real model
downloads, or vendored weights in the repository.

It is intentionally internal. Public AOS now provides bounded microphone-to-WAV
transport through `aos listen --source microphone`; this spike does not make
transcription an AOS daemon responsibility. Consumer dictation and model
execution remain separate.

## Proven Contract

The `bundled-whisper` STT provider exposes two small operations:

- `bundledWhisperStatus({ modelPath, runnerPath, fakeRunner })` reports
  `available`, `missing_model`, or `runner_unavailable`.
- `transcribeWithBundledWhisper({ audioPath, modelPath, runnerPath, fakeRunner })`
  returns a structured transcript result or throws `STTProviderError` with a
  stable `code` and diagnostic `details`.

Default proof uses:

- fixture audio under `tests/fixtures/stt/bundled-whisper/`
- a fake model metadata file instead of real Whisper weights
- `fakeRunner: true` instead of a real native runner

The fake runner computes the fixture audio SHA-256 and resolves the transcript
from fake model metadata. If the fixture is not mapped, it fails closed with
`STT_TRANSCRIPT_NOT_FOUND`.

## Explicit Unavailable States

The seam treats model and runner absence as first-class states:

- missing or unset `modelPath` reports `missing_model` and transcription fails
  with `STT_MODEL_MISSING`
- missing or unset real runner path reports `runner_unavailable` and
  transcription fails with `STT_RUNNER_UNAVAILABLE`

The model check runs before runner dispatch so callers can tell the operator
which install step is missing without attempting runner startup.

## Distribution Gates

This PR does not choose, download, or vendor real Whisper assets. Real
Bundled Whisper enablement remains gated on:

- model weight license and redistribution terms
- model size and update strategy
- packaged runtime location and integrity checks
- runner implementation, sandbox expectations, and crash behavior
- consumer integration with the public WAV handoff and consumer-owned dictation state

Until those decisions are closed, tests must continue to use fake weights,
fixture audio, and synthetic runner behavior.

## Verification

Run the focused proof with:

```bash
node --test tests/bundled-whisper-stt.test.mjs
```

This verifies deterministic fixture transcription, missing-model reporting,
runner-unavailable reporting, and fail-closed handling for unmapped audio.
