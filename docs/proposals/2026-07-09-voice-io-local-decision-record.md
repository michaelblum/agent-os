# Voice I/O Local Decision Record

- **Date:** 2026-07-09
- **Status:** Accepted implementation direction for the voice I/O PR ladder
- **Supersedes:** stale implementation leanings in PR #589 where this document
  conflicts with them
- **Depends on:** PR #590 runtime/TCC foundation findings and telemetry

## Purpose

This record converts the PR #589 voice I/O planning material into the narrower
local implementation direction for the follow-on component PRs. PR #589 remains
useful research and ideation context, but later code PRs should cite this file
when they need the current local decision.

The goal is not to build the whole voice system here. The goal is to freeze the
choices that would otherwise cause downstream PRs to fork: transcription engine,
TTS ownership, runtime packaging, permission surface, and event vocabulary.

## Decisions

### 1. STT Is Bundled Whisper First

The first speech-to-text implementation uses a bundled local Whisper-style
provider seam, not Apple Speech first.

Consequences:

- Default implementation requires Microphone permission only.
- Do not add Speech Recognition permission for the first STT path.
- Do not call `SFSpeechRecognizer`, `SpeechAnalyzer`, or another Apple Speech
  framework API in the first implementation.
- Tests must use fixture audio, synthetic buffers, fake weights, or mock runners.
- Real model downloads and bundled weights remain gated on license, size,
  storage, update, and packaging decisions.

This supersedes PR #589's Apple Speech first leaning. Apple Speech can be a
future backend if a later decision accepts the extra Speech Recognition prompt
and validates on-device availability for the target locales.

### 2. TTS Starts With A Standalone Provider Seam

The first TTS implementation adds a provider-backed speakable seam and keeps
real local model execution behind opt-in, mockable, or unavailable states.

Consequences:

- Preserve the existing `system` path through `NSSpeechSynthesizer`.
- Keep backend selection on `voice://<provider>/<id>`.
- Add Kokoro provider shape and catalog metadata, but do not vendor real weights
  until license and distribution are cleared.
- Prefer a standalone service or runner shape for warm local TTS before making
  the daemon the lifecycle owner.
- Sigil may later expose a multi-backend menu with system, mock, and
  Kokoro-unavailable states.
- Default tests must not install packages dynamically and must not require real
  audio output.

This supersedes PR #589's daemon-managed warm TTS first leaning. The daemon can
become a client or later lifecycle owner after the standalone contract proves
provider lookup, dispatch, unavailable-state behavior, and unchanged system
behavior.

### 3. Runtime Packaging Follows PR #590

Repo-mode development keeps the bare in-repo `./aos` executable shape from
PR #590, with embedded runtime metadata and fail-closed stale-TCC telemetry.

Consequences:

- Do not make `.app` packaging the first voice I/O runtime dependency.
- Do not broaden PR #590 follow-up work into LaunchServices identity, signing
  certificates, notarization, or enterprise/MDM whitelisting.
- Treat post-rebuild stale TCC as a human handoff: detect it, emit structured
  telemetry, stop the agent turn, wait for the user to regrant, then resume
  with the bounded post-permission readiness check.
- Keep voice I/O tests static, mocked, fixture-backed, or isolated by default.

PR #590's option-A build path is enough to carry usage-description metadata for
repo-mode development. A real app bundle can be a release-time decision, not a
blocking dependency for local voice I/O slices.

### 4. Freeze Generic `voice.*` Events Before Behavior

The daemon event namespace must be product-neutral and Sigil-independent before
TTS, STT, or Sigil behavior depends on it.

Minimum events:

| Service | Event | Data |
| --- | --- | --- |
| `voice` | `wake_detected` | `{ "source": "hotkey" | "phrase" }` |
| `voice` | `dictation_opened` | `{ "source": "hotkey" | "phrase" }` |
| `voice` | `dictation_closed_send` | `{ "reason": "key_release" | "phrase" | "explicit_trigger" | "timeout" }` |
| `voice` | `dictation_closed_cancel` | `{ "reason": "key_release" | "phrase" | "explicit_trigger" | "timeout" }` |

Consequences:

- PR2 owns schema and docs only. It must not add real mic capture, STT, TTS, or
  Sigil behavior.
- Downstream shorthand such as `voice.wake_detected` means
  `{ service: "voice", event: "wake_detected" }`.
- The daemon carries generic events; Sigil owns dictation UX, sound policy, and
  menu behavior.

### 5. Permission Surface Is Broker-Owned, Policy Is App-Owned

Microphone permission facts and prompts belong to the AOS broker. Dictation
state, wake behavior, response policy, and menu behavior belong to Sigil or
another app/experience layer.

Consequences:

- The Microphone/STT permission PR adds or verifies
  `NSMicrophoneUsageDescription`.
- Do not add Speech Recognition broker prompts unless a later Apple Speech
  backend decision needs them.
- If runtime metadata already carries `NSSpeechRecognitionUsageDescription`,
  treat it as inert future-proofing, not as a current permission commitment.
- Keyboard, mic, TTS, and model proof must be simulated or mocked when the user
  is AFK.

## Component PR Order

1. Finish or supersede PR #590 as the runtime/TCC foundation.
2. Land this decision record.
3. Freeze generic `voice.*` schema and event-stream docs.
4. Add the provider-backed TTS seam.
5. Add Microphone/STT broker permission surfaces.
6. Add the Bundled Whisper STT spike with fake weights and fixture proof.
7. Add Sigil hold-spacebar dictation consuming generic voice events.
8. Add Sigil sound/TTS hooks and the multi-backend menu.
9. Open a final consolidation PR to `main`; do not merge it from the
   orchestrator lane.

## Validation

For this decision record:

```bash
git diff --check
node scripts/aos-dev-workflow.mjs recommend --json --paths docs/AGENTS.md,docs/proposals/2026-07-09-voice-io-local-decision-record.md
```

For downstream slices, use the slice-specific validators in the voice I/O
orchestration plan plus the shared command-surface validators when command
truth, schemas, generated manifests, or help output are touched.
