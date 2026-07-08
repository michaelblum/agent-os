# Pluggable local TTS backend for `aos say` (Kokoro-first)

Author: Perplexity Computer (collaborator pass), for @michaelblum
Date: 2026-07-08
Status: Proposal / discussion draft — no code changes included in this PR
Scope: `aos say` and the daemon's `announce()` / `tell human` voice route

## 1. Summary

`agent-os` already speaks through `NSSpeechSynthesizer` (macOS `say`) everywhere, but the voice
*discovery* layer (`VoiceRegistry` / `VoiceProvider`) was explicitly designed as multi-backend from
day one — it just never got a second backend that can actually produce audio. The ElevenLabs
provider it ships today is a metadata-only stub (`speak_supported: false`), and the project's own
design notes call a real remote/alternate synthesis path out of scope for v1
([`docs/archive/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/docs/archive/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md)).

That means the cleanest way to add a local, higher-quality, on-device voice (Kokoro-82M first,
Qwen3-TTS/Chatterbox later) is to **finish the seam the codebase already started**: give
`VoiceProvider` an optional synthesis capability, add a `KokoroVoiceProvider`, and teach the two
actual speech call sites (`aos say` and the daemon's `announce()`) to dispatch to a provider's
synthesizer instead of always constructing an `NSSpeechSynthesizer`-backed `SpeechEngine`. The
external CLI contract of `aos say` does not need to change at all.

## 2. How `aos say` actually works today (call chain)

```
aos say "hello"
  -> manifests/commands/source/external/18-say.json   (external command table entry)
  -> scripts/aos-say.mjs                               (arg validation, spawns internal primitive)
  -> ./aos __say ...                                   (src/main.swift dispatch)
  -> sayCommand(args:)                                 (src/voice/say.swift)
       -> loadConfig() / VoiceRegistry (resolve --voice / --voice-slot / filters)
       -> SpeechEngine(voice: voiceID)                 (src/voice/engine.swift — NSSpeechSynthesizer)
       -> engine.speakAndWait(text)
       -> prints {status, text, voice, characters} JSON
```

Key files:
- [`manifests/commands/source/external/18-say.json`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/manifests/commands/source/external/18-say.json) — declares `aos say` as an external command that shells out to `scripts/aos-say.mjs`.
- [`scripts/aos-say.mjs`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/scripts/aos-say.mjs) — validates flags, then `spawnSync('./aos', ['__say', ...args])`.
- [`src/main.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/main.swift#L42-L43) — the unified binary's `switch command` block maps `__say` to `sayCommand(args:)`. All the "verbs" (`__say`, `__see`, `__do`, `__serve`, `__render`, …) are internal primitives dispatched the same way; the public-facing `aos <verb>` commands are declared separately in the `manifests/commands/source/{aos,external}` JSON tables and are largely thin wrappers (Node scripts or direct primitive calls) around these primitives.
- [`src/voice/say.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/say.swift) — parses `--voice`, `--voice-slot`, `--language`, `--gender`, `--quality-tier`, `--rate`; resolves a voice via `VoiceRegistry`; then **unconditionally** builds `SpeechEngine(voice: voiceID)` and calls `speakAndWait`.
- [`src/voice/engine.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/engine.swift) — `SpeechEngine` is a thin wrapper around `NSSpeechSynthesizer`. This is the *only* thing that ever produces audio for `aos say`.

So today: **`aos say` does not shell out to the macOS `say` binary** — it uses `NSSpeechSynthesizer`
directly via `AppKit`, but that's the same underlying system TTS engine the `say` CLI uses. Either
way, it is 100% the system voice path; there is no non-system audio production anywhere in the repo.

Important operational detail: the `say` manifest entry has `"auto_starts_daemon": false`
([`08-say.json`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/manifests/commands/source/aos/08-say.json#L86)) — `aos say` runs as a **fresh, standalone process per invocation**. It does not talk to the daemon at all. That matters for latency/warm-loading design (see §5).

## 3. The second, separate speech call site: the daemon's `announce()` / `tell human`

There is a **second, independent** TTS code path inside the long-running daemon
([`src/daemon/unified.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/daemon/unified.swift#L3071-L3105)):

- `initSpeechEngine()` / `stopSpeechEngine()` create/destroy a **persistent** `SpeechEngine` instance tied to `voice.enabled` config changes.
- `announce(_ text:, voiceID:)` is the entry point used by `deliverHumanVoiceRoute` (the `tell human` → voice route) and by autonomic/status announcements. It reuses the warm `speechEngine` instance and just calls `setVoice` + `speak`.
- This is exactly the kind of "daemon owns TTS, agent decides what to say" split the README describes: *"The daemon handles element resolution, cursor tracking, TTS, visual feedback. The agent decides WHAT and WHY."* ([`README.md`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/README.md?plain=1#L10)), and `aos say` is documented as *"Direct TTS convenience aligned with `tell human`"* ([`README.md`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/README.md?plain=1#L21)).

**Implication:** a real backend swap has two distinct integration points, not one. `aos say`
(standalone, cold-start each call) and daemon `announce()` (warm, persistent, used for `tell human`)
both hardcode `SpeechEngine`. A complete solution should abstract both, but the warm-loading payoff
(the thing that gets Kokoro under ~1–2s per utterance) is much easier to realize on the daemon side,
since that process already stays alive.

## 4. The existing (metadata-only) provider abstraction

`agent-os` already has a provider-agnostic voice **catalog**, just not a provider-agnostic
**synthesizer**:

- [`src/voice/provider.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/provider.swift) — `protocol VoiceProvider { name, availability, enumerate() -> [VoiceRecord] }`. No `speak()` method exists on the protocol at all today.
- [`src/voice/providers/system.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/providers/system.swift) — enumerates `NSSpeechSynthesizer.availableVoices`, tags them `capabilities.speak_supported: true`.
- [`src/voice/providers/elevenlabs-stub.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/providers/elevenlabs-stub.swift) — a hardcoded catalog of 5 ElevenLabs voice IDs with `capabilities.speak_supported: false`. It exists purely to exercise "not speakable" branches in the allocator; there is no synthesis code behind it.
- [`src/voice/registry.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/registry.swift) — `VoiceRegistry` aggregates `[SystemVoiceProvider(), ElevenLabsStubProvider()]` (plus a test-only `MockVoiceProvider`), applies policy (`voice/policy.json`, enable/disable, session pinning), and exposes `snapshot()`, `allocatableSnapshot()`, `snapshot(matching: VoiceFilter)`.
- Canonical voice identity is already provider-namespaced: `VoiceID.make(provider:, providerVoiceID:)` produces URIs like `voice://system/com.apple.voice.compact.en-US.Samantha` or `voice://elevenlabs/21m00Tcm4TlvDq8ikWAM` ([`registry.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/registry.swift#L1-L27)). `VoiceFilter` already has a `provider` field for filtering by backend.

The project's own design spec is explicit that this was intentional and incomplete by design (not
an oversight):

> "Explicit out-of-scope items: ElevenLabs synthesis path, dynamic provider registration, hot-swap
> when a preferred voice becomes available later, concurrent-speech mixing, per-channel/per-purpose
> routing." — [voice-registry-provider-allocation-design.md](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/docs/archive/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md)

**This is the finding that shapes the whole recommendation:** agent-os does not need a new
plug-in system invented from scratch. It needs someone to implement the synthesis half of a
seam that the voice registry design already reserved — `speak_supported` and the `voice://<provider>/<id>`
URI scheme exist specifically to let a second, real backend slot in later. Kokoro is a good first
candidate to actually build that missing half.

## 5. Hardware/backend fit for this Mac (M1 Pro, 10 cores, 16 GB RAM, ~90 GiB free, macOS 26.5.1)

| Backend | Fit for this use case | Notes |
|---|---|---|
| **Kokoro-82M** | Best first choice | ~82M params, CPU/MPS-friendly, sub-second to ~1s synthesis for short utterances on Apple Silicon once the model is warm; small disk/RAM footprint; English-focused which matches the stated "neutral American/UK-style English" requirement; simple `pip install kokoro` path, and CoreML/Apple-optimized variants exist. |
| **Qwen3-TTS** | Good phase-2/premium option | Heavier (larger weights, more RAM/first-load latency), richer voice control/multilingual/cloning — better suited once the pluggable seam exists and quality/latency headroom is available. |
| **Chatterbox-TTS** | Good phase-2/expressive option | MIT-licensed, ElevenLabs-style expressiveness, 16 GB RAM is the documented minimum, so it's usable but leaves little headroom alongside the rest of the agent-os daemon + Xcode/Swift toolchain running concurrently; best treated as an optional "expressive mode," not the default. |

Given the target of short interjections/replies, "1–2s with half-duplex cue sounds is fine," and
"simplest local integration path first," **Kokoro is the right first backend**, exactly as the
research already concluded — the rest of this document is about *where* it plugs in, not *whether*
it's the right model.

## 6. Recommended design: pluggable backend at the provider layer, not a parallel system

### 6.1 Extend the provider protocol with an optional synthesis capability

Add a new protocol (kept separate from `VoiceProvider` so existing metadata-only providers like
`ElevenLabsStubProvider` don't need any change):

```swift
// src/voice/provider.swift (addition)
protocol SpeakableVoiceProvider: VoiceProvider {
    /// Synthesize `text` for `providerVoiceID` and return a URL to a playable audio file
    /// (e.g. WAV/AIFF in a temp dir), or throw. Implementations own their own process/model
    /// lifecycle; callers are responsible for playback.
    func synthesize(text: String, providerVoiceID: String, rateWPM: Float?) throws -> URL
}
```

`SystemVoiceProvider` does not need to conform (system playback keeps using `SpeechEngine`/
`NSSpeechSynthesizer` directly, since that already handles playback+blocking+cancel-key
integration). Only *new* backends that need "synthesize an audio file, then play it" conform to
`SpeakableVoiceProvider`.

### 6.2 Add `KokoroVoiceProvider`

New file `src/voice/providers/kokoro.swift`:
- `enumerate()` returns a small, hardcoded catalog of Kokoro's American/British English voices (e.g. `af_heart`, `af_bella`, `am_michael`, `am_fenrir`, `bf_emma`, `bm_george`), each `provider: "kokoro"`, `capabilities: .init(local: true, streaming: false, ssml: false, speak_supported: true)`, `quality_tier: "enhanced"` (or a new tier if you want it distinguishable from system voices in `--quality-tier` filtering).
- `availability` reports `reachable: false` with a reason if the local Kokoro runner/service isn't installed or isn't responding (mirrors the pattern already used by `ElevenLabsStubProvider`'s env-var-gated availability), so `aos voice list` / the allocator degrade gracefully instead of crashing when Kokoro isn't installed on a given machine.
- Conforms to `SpeakableVoiceProvider`; `synthesize(...)` shells out to a small local runner (see §6.4) and returns a temp file URL.

Register it in `VoiceRegistry.defaultProviders()` ([`registry.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/registry.swift#L178-L185)) — one line, additive, same pattern as the existing `AOS_VOICE_TEST_PROVIDERS=mock` gate (e.g. gate on an `AOS_TTS_KOKORO_ENABLED=1` / config flag if you want it opt-in during rollout).

### 6.3 Dispatch in the two speech call sites

Both `sayCommand` ([`say.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/say.swift#L124-L160)) and the daemon's `announce()` ([`unified.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/daemon/unified.swift#L3096-L3105)) currently go straight to `SpeechEngine(voice:)`. The smallest viable change is to branch on the *resolved* `VoiceRecord.provider` right before that call:

```swift
let record = registry.lookup(reportedVoiceID)   // already have provider info here
if let record, record.provider != "system",
   let provider = registry.speakableProvider(named: record.provider) {
    let fileURL = try provider.synthesize(text: text, providerVoiceID: record.provider_voice_id, rateWPM: rate)
    playAudioFileAndWait(fileURL)          // simple AVAudioPlayer or `afplay` wrapper
} else {
    // existing NSSpeechSynthesizer path, unchanged
    let engine = SpeechEngine(voice: voiceID)
    ...
}
```

This preserves:
- The external CLI contract (`aos say "hello" [--voice ...] [--voice-slot ...] [--rate ...]`) — completely unchanged.
- The JSON response shape (`status`, `text`, `voice`, `characters`) — unchanged.
- All existing system-voice tests (`tests/say-voice-slot.sh`, `tests/voice-*.sh`) — unchanged, since the `system` path is untouched.
- Backend selection reuses the mechanism the registry already has (`voice://kokoro/<id>` via `--voice`, or `--voice-slot` + `--quality-tier`/`--language` filtering once Kokoro voices are tagged) instead of inventing a second, competing selector.

For a lower-friction opt-in during development, also honor an environment/config default so the
user doesn't have to spell out a full `voice://kokoro/...` URI every time:
- `AOS_TTS_BACKEND=kokoro` (env, matches the existing `AOS_VOICE_TEST_PROVIDERS`-style convention) or
- `config.voice.voice = "voice://kokoro/af_heart"` in `~/.config/agent-os` (reuses the existing `VoiceConfig.voice` field — no schema change needed at all, since it's already a free-form voice-URI string).

Either is a few lines; the config-field option is preferable long-term since it needs zero new
schema and already round-trips through `aos config` today ([`src/shared/config.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/shared/config.swift#L46-L52)).

### 6.4 The Kokoro runner itself (phase 1 → phase 2)

Kokoro is a Python package (`pip install kokoro`), so the Swift side needs a thin process
boundary. Two viable shapes, in order of recommended rollout:

**Phase 1 — subprocess-per-call (fastest to ship, correctness-first):**
- `scripts/kokoro_say.py`: loads `kokoro`, synthesizes `--text` with `--voice`, writes a WAV to a temp path (or to stdout), exits.
- `KokoroVoiceProvider.synthesize` calls `Process` → `python3 scripts/kokoro_say.py ...` and returns the WAV path.
- Simple, easy to test in isolation, but pays full model-load cost (likely >1–2s) on every single `aos say` call, since there's no daemon involved in that path today (§2). Good for validating voice quality and the plumbing; not the final latency target.

**Phase 2 — warm local service (meets the 1–2s target, fits the project's own architecture):**
- A small long-lived local process (Python, `uvicorn`/FastAPI or even a bare Unix-socket loop) that loads the Kokoro model once and serves synthesis requests over a local Unix socket, analogous to the daemon's own `voice.list` / `voice.final_response` socket actions already visible in [`tests/daemon-ipc-voice.sh`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/tests/daemon-ipc-voice.sh).
- Two ways to own its lifecycle, both consistent with how the project already treats TTS as a daemon responsibility ("daemon handles ... TTS," README):
  1. **Daemon-managed** (recommended): the `aos` daemon starts/stops the Kokoro service the same way it starts/stops `speechEngine` today (`initSpeechEngine()` / `stopSpeechEngine()` in `unified.swift`), keyed off a new `voice.backend` / `AOS_TTS_BACKEND` config toggle. `aos say` (standalone) then talks to that daemon-owned service over the existing socket instead of invoking Kokoro cold each time — this does mean `aos say` would need `auto_starts_daemon` semantics reconsidered for the Kokoro path specifically (system-voice `aos say` can stay daemon-independent).
  2. **Standalone local service** (lower blast radius, if you don't want `aos say`'s "doesn't need the daemon" property to change): a small `launchd`-style or manually started Kokoro server that both `aos say` and the daemon's `announce()` hit as clients. Simpler to reason about, but you lose "one process owns the model" tidiness and duplicate the warm-up outside the daemon's existing lifecycle machinery.
- Recommendation: start with 6.4-Phase 1 to validate voice quality/latency end-to-end this week, then move to 6.4-Phase 2 option (1) once you're happy with Kokoro's output, since it's the option that actually fits the project's stated architecture and hits the 1–2s target via warm loading.

### 6.5 Masking latency with cue sounds

The existing `FeedbackConfig.sound` flag and the daemon's visual/sound feedback plumbing
([`src/shared/config.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/shared/config.swift#L79-L82)) is a natural home for the "thinking/speaking" cue sounds you proposed — no new subsystem needed, just wiring a short chime immediately before `synthesize()` is called and another right before playback starts.

## 7. Smallest viable change — concrete file list

1. `src/voice/provider.swift` — add `SpeakableVoiceProvider` protocol (additive, no breaking change).
2. `src/voice/providers/kokoro.swift` — new file, `KokoroVoiceProvider` (enumerate + synthesize).
3. `src/voice/registry.swift` — register `KokoroVoiceProvider()` in `defaultProviders()`; add a `speakableProvider(named:) -> SpeakableVoiceProvider?` lookup helper.
4. `src/voice/say.swift` — branch on `record.provider` before constructing `SpeechEngine`; add a tiny `playAudioFileAndWait(_ url: URL)` helper (AVFoundation or `afplay` subprocess).
5. `src/daemon/unified.swift` — same branch inside `announce(_:voiceID:)`, reusing the helper from (4).
6. `scripts/kokoro_say.py` — phase-1 subprocess runner (or a `kokoro-service/` directory for phase 2's persistent server).
7. `tests/say-kokoro-backend.sh` — new test mirroring `tests/say-voice-slot.sh`, using a mock/stub Kokoro provider (same pattern as `AOS_VOICE_TEST_PROVIDERS=mock`) so CI doesn't need the real Kokoro package installed.
8. Docs: update `docs/reference/voice-control-commands.md` and `README.md`'s command table entry for `aos say` to mention backend selection once shipped.

Nothing in `manifests/commands/source/{aos,external}/*say*.json` needs to change — the CLI surface
is untouched by design.

## 8. Non-goals for this first pass (mirrors how the project itself scoped ElevenLabs)

- No redesign of voice across `tell`/`listen`/canvas feedback.
- No Qwen3-TTS or Chatterbox wiring yet — just make sure `KokoroVoiceProvider`'s shape (protocol + registry slot) is generic enough that adding `QwenVoiceProvider` / `ChatterboxVoiceProvider` later is "copy the file, change the runner command."
- No dynamic/runtime provider registration — keep providers hardcoded in `defaultProviders()`, consistent with the existing design decision to defer that.
- No streaming synthesis in v1 (`capabilities.streaming: false` for Kokoro, matching the "wait for completion" semantics `aos say --wait` already assumes).

## 9. Answers to the specific questions asked

- **Where is `aos say` implemented?** [`src/voice/say.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/say.swift), invoked as the `__say` internal primitive from [`src/main.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/main.swift#L42-L43), reached from the public `aos say` command via [`scripts/aos-say.mjs`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/scripts/aos-say.mjs) as declared in [`manifests/commands/source/external/18-say.json`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/manifests/commands/source/external/18-say.json).
- **Does it shell out to macOS `say` or use another internal path?** Neither literally — it links `AppKit`/`NSSpeechSynthesizer` directly via `SpeechEngine` ([`src/voice/engine.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/engine.swift)); no `Process` call to `/usr/bin/say` exists in the repo. It is functionally the same system voice engine, just invoked in-process.
- **How are command handlers structured inside the unified `aos` binary?** A two-layer model: (1) a JSON manifest table per command (`manifests/commands/source/{aos,external}/*.json`) declares the public CLI surface, args, and whether it's a Swift-internal primitive or an external wrapper script; (2) `src/main.swift` is a flat `switch` over `__`-prefixed internal primitive names (`__say`, `__see`, `__do`, `__serve`, `__render`, etc.), each dispatching to a dedicated Swift function/file under `src/`.
- **Is the daemon/runtime model the right place for a persistent local TTS backend?** Yes — it already owns a persistent `SpeechEngine` instance for `announce()`/`tell human` ([`src/daemon/unified.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/daemon/unified.swift#L3071-L3105)) and already exposes a `voice` service over its Unix socket ([`tests/daemon-ipc-voice.sh`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/tests/daemon-ipc-voice.sh)). Note, though, that `aos say` itself currently bypasses the daemon entirely (`auto_starts_daemon: false`), so daemon-hosted warm-loading only pays off automatically for the `tell human` path unless `aos say` is changed to route through the daemon for non-system backends specifically.
- **Smallest viable change for pluggable backend selection without disturbing the CLI contract?** Add a `SpeakableVoiceProvider` capability to the existing (currently metadata-only) `VoiceProvider` protocol, implement it once for Kokoro, and branch on `VoiceRecord.provider` at the two existing `SpeechEngine(...)` call sites. Backend selection rides on the `voice://<provider>/<id>` URI scheme and `VoiceFilter.provider` that already exist — no new flags, no new config schema, no manifest changes required.

## 10. Sources

- [`README.md`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/README.md) — daemon/agent split, `aos say` command table entry.
- [`src/main.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/main.swift) — internal primitive dispatch.
- [`src/voice/say.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/say.swift), [`src/voice/engine.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/engine.swift), [`src/voice/provider.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/provider.swift), [`src/voice/registry.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/registry.swift), [`src/voice/providers/system.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/providers/system.swift), [`src/voice/providers/elevenlabs-stub.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/providers/elevenlabs-stub.swift), [`src/voice/providers/mock.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/voice/providers/mock.swift).
- [`src/daemon/unified.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/daemon/unified.swift) — daemon `speechEngine` lifecycle and `announce()`.
- [`src/shared/config.swift`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/src/shared/config.swift) — `VoiceConfig` schema.
- [`manifests/commands/source/aos/08-say.json`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/manifests/commands/source/aos/08-say.json), [`manifests/commands/source/external/18-say.json`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/manifests/commands/source/external/18-say.json), [`scripts/aos-say.mjs`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/scripts/aos-say.mjs).
- [`docs/archive/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/docs/archive/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md) — original design intent, confirming synthesis-path abstraction was deliberately deferred.
- [`tests/say-voice-slot.sh`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/tests/say-voice-slot.sh), [`tests/daemon-ipc-voice.sh`](https://github.com/michaelblum/agent-os/blob/58037f2bf5adbeaa993589d4dd2e2fd093ba4306/tests/daemon-ipc-voice.sh).
- Kokoro-82M: [Hugging Face — mattmireles/kokoro-coreml](https://huggingface.co/mattmireles/kokoro-coreml); [GitHub — hexgrad/kokoro](https://github.com/hexgrad/kokoro); [dev.to — local voice AI stack on Apple Silicon](https://dev.to/xadenai/building-a-local-voice-ai-stack-whisper-ollama-kokoro-tts-on-apple-silicon-eo0).
- Qwen3-TTS Apple Silicon port: [GitHub — kapi2800/qwen3-tts-apple-silicon](https://github.com/kapi2800/qwen3-tts-apple-silicon).
- Chatterbox-TTS: [localaimaster.com setup guide](https://localaimaster.com/blog/chatterbox-tts-setup-guide); [Hugging Face Space — Jimmi42/chatterbox-tts-apple-silicon](https://huggingface.co/spaces/Jimmi42/chatterbox-tts-apple-silicon).
- General local TTS landscape on macOS: [SourceForge — Mac Text-to-Speech (TTS) Models directory](https://sourceforge.net/directory/text-to-speech-tts-models/mac/).
