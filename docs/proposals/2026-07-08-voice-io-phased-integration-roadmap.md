# Voice I/O — Phased Integration Roadmap (TTS + STT + Trigger)

**Author:** Perplexity Computer (collaborator pass), for @michaelblum / @mikeblum603
**Date:** 2026-07-08
**Status:** Proposal / roadmap — no runtime code changes in this PR
**Pins:** All source references use commit [`1c8dc81`](https://github.com/michaelblum/agent-os/tree/1c8dc81a014e534651c95c3c763cafa539de2799).

**Companion docs (this roadmap sequences and unifies them):**
- [`2026-07-08-kokoro-tts-backend-integration.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/docs/proposals/2026-07-08-kokoro-tts-backend-integration.md) — the TTS-output seam (`aos say` + daemon `announce()`).
- [`2026-07-08-sigil-voice-trigger-ideation.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/docs/proposals/2026-07-08-sigil-voice-trigger-ideation.md) — the trigger/dictation/sound-hook stack (Track 2, Sigil-owned).
- [`2026-07-08-macos-accessibility-features-brainstorm.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/docs/proposals/2026-07-08-macos-accessibility-features-brainstorm.md) — Apple-native features (Personal Voice, Voice Control, Live Captions) to fold in opportunistically.

---

## 0. What this document is

The three companion docs each answer "what could we build and where does it plug in." None of them answers **"in what order do we build it, and where does the road genuinely fork?"** That is this document.

I was given license to make the consequential calls. I have. This roadmap is **opinionated by default** — it states a single recommended path for every decision — and only forks where a wrong pick would be expensive to unwind later. There are exactly **three such forks** (§7). Everything else is a straight line.

Design invariant threaded through every phase: **the `aos` CLI/manifest contract never changes.** Backend selection, capture, dictation, and trigger UX all ride on seams that already exist (`voice://<provider>/<id>` URIs, the daemon event bus `voice` service, the broker permission enum, Sigil's radial-menu overlay). We are *finishing seams the codebase already reserved*, not inventing new command surface.

---

## 1. The end-state ambition (so the phasing has a target)

agent-os today can only *speak*, and only in the system voice. The ambition these three docs collectively point at is a **full-duplex-capable, local-first, pluggable voice I/O layer**:

- **Output:** high-quality on-device TTS (Kokoro first), selectable per-utterance, with a distinct "system acknowledging you" voice vs. "agent talking to you" voice.
- **Input:** hands-free wake ("Hey Sigil") *and* hands-on (hold-spacebar) triggers, feeding a half-duplex dictation state machine that transcribes on-device.
- **Feedback:** a bus-driven sound/voice hook system so any app (Sigil first) can react to `voice.*` events with cue sounds or spoken lines.
- **Ownership discipline:** privileged facts (mic/speech permission) stay in the `./aos` broker; *policy* (what to say, when to listen, which sound to play) stays in Track 2 apps.

The phasing below is ordered so that **each phase ships independent user value** and de-risks the next. You could stop after any phase and have something coherent.

---

## 2. Phase map at a glance

| Phase | Theme | Ships value even if we stop here | Depends on | Fork? |
|---|---|---|---|---|
| **0** | Foundation: finish the output seam | Higher-quality `aos say` / `tell human` voice | — | — |
| **1** | Warm TTS service | Sub-2s local TTS, `tell human` feels instant | 0 | **Fork B** (§7.2) |
| **2** | Broker permissions for input | Mic + Speech Recognition grants exist & probe cleanly | — (parallelizable with 0/1) | — |
| **3** | Trigger + capture (hands-on first) | Hold-spacebar dictation into any app | 2 | **Fork A** (§7.1) |
| **4** | Wake word + dictation state machine | "Hey Sigil" hands-free dictation | 3 | — |
| **5** | Feedback hooks + ephemeral menu | Full Sigil voice experience; cue sounds; live-listening overlay | 1, 4 | — |
| **∞** | Full-duplex (stretch) | Barge-in / interruptible agent speech | 5 | **Fork C** is orthogonal (§7.3) |

Phases 0–1 are the **TTS track**. Phases 2–4 are the **STT/trigger track**. They are independent until Phase 5 joins them, so a two-person split (one per track) is natural and the tracks only need to agree on the `voice.*` event-name vocabulary (§6).

---

## 3. Phase 0 — Finish the output seam (TTS, correctness-first)

**Goal:** replace "system voice only" with "pluggable provider," proving it with Kokoro via a subprocess-per-call runner. Latency is explicitly *not* the goal yet — correctness and voice quality are.

**Scope (exactly the smallest-viable list from the Kokoro doc §7):**
1. Add `SpeakableVoiceProvider: VoiceProvider` to [`src/voice/provider.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/provider.swift) — additive; `SystemVoiceProvider` and `ElevenLabsStubProvider` are untouched.
2. New `src/voice/providers/kokoro.swift` conforming to it; hardcoded en-US/en-GB catalog, `speak_supported: true`, gated availability.
3. Register in [`VoiceRegistry.defaultProviders()`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/registry.swift#L178-L182) (currently `[SystemVoiceProvider(), ElevenLabsStubProvider()]`), gated on an opt-in flag; add `speakableProvider(named:)`.
4. Branch on resolved `VoiceRecord.provider` at the **two** call sites — `SpeechEngine(voice:)` in [`say.swift:125`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/say.swift#L125) and `announce()` around [`unified.swift:3096`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/daemon/unified.swift#L3071-L3105) — with a shared `playAudioFileAndWait(_:)` helper.
5. `scripts/kokoro_say.py` subprocess runner.
6. `tests/say-kokoro-backend.sh` using a stub provider (same pattern as `AOS_VOICE_TEST_PROVIDERS=mock`), so **CI never needs the real Kokoro package**.

**Opinionated calls I'm making here:**
- **Keep the `system` path on `NSSpeechSynthesizer` forever.** Do *not* migrate system voices to the file-synthesize-then-play path. `NSSpeechSynthesizer` already owns blocking, the cancel-key `CGEventTap` ([`say.swift:132`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/say.swift#L132)), and delegate completion. Rewriting that for zero quality gain is pure risk.
- **Selection rides on the existing config field, not a new flag.** `config.voice.voice = "voice://kokoro/af_heart"` already round-trips through `aos config` ([`config.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/shared/config.swift)). No manifest/CLI change. An `AOS_TTS_BACKEND=kokoro` env override is a dev-ergonomics convenience only.
- **`playAudioFileAndWait` = `AVAudioPlayer`, not an `afplay` subprocess.** Staying in-process gives real completion callbacks (matching `--wait` semantics) and avoids a second process spawn per utterance. `afplay` is the fallback only if an AVFoundation link is undesirable in the standalone `aos say` binary.

**Exit criteria:** `aos say --voice voice://kokoro/af_heart "hello"` produces Kokoro audio; every existing system-voice test still passes untouched; `aos voice list` shows Kokoro voices as unreachable (not crashing) when the runner isn't installed.

**Known wart accepted on purpose:** cold model load makes this >1–2s per call. That's fine — Phase 0 exists to validate the *seam and the voice*, and Phase 1 fixes latency.

---

## 4. Phase 1 — Warm TTS service (hit the latency target)

**Goal:** get Kokoro utterances to the ~1–2s target by loading the model once and keeping it warm. This is where **Fork B** (§7.2) lives — *who owns the warm process*.

**Recommended path (Fork B → option 1, daemon-managed):** a small long-lived local Kokoro service (Python, bare Unix-socket loop or FastAPI) that the daemon starts/stops exactly the way it already manages `speechEngine` via `initSpeechEngine()` / `stopSpeechEngine()` ([`unified.swift:3071-3105`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/daemon/unified.swift#L3071-L3105)), keyed off the `voice.backend` toggle. This matches the README's own "daemon owns TTS" split and reuses the daemon's existing socket-service machinery.

**The consequence that makes this a fork, not a detail:** `aos say` today is deliberately daemon-independent — `08-say.json` sets `auto_starts_daemon: false`, so it runs as a fresh process per call ([`manifests/commands/source/aos/08-say.json`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/manifests/commands/source/aos/08-say.json)). Warm loading only helps `aos say` if it routes to the daemon-owned service for **non-system backends specifically** — which means changing that "doesn't need the daemon" property for the Kokoro path. That is an architectural change with a real blast radius, so it's a documented fork rather than a silent decision (see §7.2 for the alternative).

**Exit criteria:** warm `tell human` / `announce()` Kokoro utterances land under 2s wall-clock for short strings; `aos say` Kokoro path either meets the target (if routed to daemon) or is explicitly documented as "cold unless daemon warm" (if not).

---

## 5. Phase 2 — Broker permissions for input (unblocks all of STT)

**Goal:** acquire and probe the two TCC classes the whole input side needs, *before* any capture code exists. Fully parallelizable with Phases 0–1.

**This is legitimately broker-owned work, not Track 2.** [ADR 0015](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/docs/adr/0015-aos-tcc-capability-broker-boundary.md)'s Swift Change Gate lists "a new TCC permission class" as an *accepted* reason to touch the broker. Today `PermissionPromptKind` has exactly four cases — `accessibility`, `screenRecording`, `listenEvent`, `postEvent` ([`operator.swift:404`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/commands/operator.swift#L404)) — and **none touch the microphone**.

**Scope:**
1. Two new `PermissionPromptKind` cases: `microphone` (`AVCaptureDevice.requestAccess(for: .audio)`) and `speechRecognition` (`SFSpeechRecognizer.requestAuthorization`), following the exact shape of the existing four.
2. Add `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription` to wherever the shipped binary's `Info.plist` is generated — **note the loose end from the Sigil doc: no `Info.plist`/`.entitlements` exists in the repo yet**, so this phase includes standing that up (and auditing `com.apple.security.device.audio-input` if the binary is sandboxed/notarized).
3. `aos __permissions prompt microphone --json` / `speech-recognition --json` probe paths.

**Opinionated call:** both grants are held by the **unified `./aos` broker identity**, never a separate helper binary — consistent with ADR 0015's "one permissioned broker binary" principle and answering open-question #1 in the Sigil doc. A separate helper would fragment TCC identity and re-prompt users confusingly.

**Exit criteria:** `aos __permissions prompt microphone --json` triggers the real macOS prompt and reports granted/denied; same for speech-recognition; on-device availability is *probed, not assumed* (it isn't guaranteed for every locale).

---

## 6. Phases 3–4 — Trigger + capture + dictation (Track 2, Sigil-owned)

These realize Concepts A/B from the Sigil doc. Per the Platform Dogfood Boundary, **everything downstream of "permission granted" is Sigil product behavior**; the daemon only delivers `voice.*` events.

**Shared vocabulary both tracks must agree on (freeze this early):** the `voice` service is already declared in the event schema ([`shared/schemas/daemon-event.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/shared/schemas/daemon-event.md), line 18 lists `"voice"` as a valid `service`) but has **zero events defined** — a ready-made namespace. Freeze these names before either track writes code:

```
voice.wake_detected            { source: "phrase" | "hotkey" }
voice.dictation_opened         { }
voice.dictation_closed_send    { reason: "phrase"|"key_release"|"explicit_trigger"|"timeout" }
voice.dictation_closed_cancel  { reason: ... }
```

### Phase 3 — Hands-on trigger first (hold-spacebar)

**Ship the cheap, no-ML path first.** A `CGEventTap` timing key-down→key-up (the tap scaffolding is already proven in [`input-safety-hotkeys.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/perceive/input-safety-hotkeys.swift) and the three existing cancel-speech taps). This validates the entire dictation state machine **without a wake-word model**. This is where **Fork A** (§7.1) — the STT engine choice — must be resolved, because Phase 3 is the first phase that actually transcribes.

### Phase 4 — Wake word + full state machine

Add the always-listening keyword spotter (`voice.wake_detected { source: "phrase" }`) as a small Sigil-owned helper, and complete the four-exit half-duplex state machine (`IDLE → LISTENING → SEND|CANCEL`), including the "silence resolves the ambiguity" pomodoro timeout — the genuinely clever idea in the Sigil doc worth preserving verbatim.

**Opinionated call:** wake-word spotting uses a lightweight local keyword model (openWakeWord-style) on raw buffers, **not** continuous `SFSpeechRecognizer`. Continuous heavy STT purely for wake detection is wasteful and adds latency exactly where users won't tolerate it.

---

## 7. The three genuine forks

Everything above is a straight recommendation. These three are where I'm explicitly *not* collapsing the decision, because the wrong pick is expensive to reverse.

### 7.1 Fork A — STT engine: Apple Speech framework vs. bundled Whisper/Parakeet

Resolved at **Phase 3** (first transcription).

```
                    ┌─ Path A1: Apple SpeechAnalyzer / SFSpeechRecognizer
Phase 3 STT engine ─┤     + zero dependency, ships with macOS, small binary
                    │     + on-device mode (requiresOnDeviceRecognition = true)
                    │     − needs the SEPARATE Speech Recognition TCC prompt (2 prompts total)
                    │     − quality/locale coverage is Apple's, not ours to tune
                    │
                    └─ Path A2: bundled local Whisper/Parakeet (FreeFlow/OpenWhispr pattern)
                          + ONLY needs Microphone TCC (skips Speech Recognition prompt entirely)
                          + full control over model quality; both MIT Tier-1 refs chose this
                          − larger binary + a model-management/download story
                          − we own the ASR quality bar
```

**My lean:** **A1 (Apple Speech) for the first shippable**, because it gets Phase 3 working with zero model-management story and the smallest binary, and `requiresOnDeviceRecognition = true` keeps it local. Revisit A2 if Apple's on-device quality/locale coverage proves inadequate — the `SpeakableVoiceProvider`-style seam means the ASR backend can be swapped without touching the state machine. This is a real fork (not a detail) because it changes the **permission surface** (one prompt vs. two) and the **binary/distribution story**, both of which are hard to walk back once shipped and documented to users.

### 7.2 Fork B — Warm TTS service ownership: daemon-managed vs. standalone

Resolved at **Phase 1**.

```
                       ┌─ Path B1: daemon-managed service (RECOMMENDED)
Phase 1 warm service ──┤     + reuses initSpeechEngine/stopSpeechEngine lifecycle; "one process owns the model"
                       │     + fits README's "daemon owns TTS" split
                       │     − forces aos say (auto_starts_daemon:false) to route through daemon for Kokoro
                       │
                       └─ Path B2: standalone local service (both aos say + daemon are clients)
                             + preserves aos say's "doesn't need the daemon" property
                             + lower blast radius on existing behavior
                             − duplicates warm-up outside daemon lifecycle; two owners of one model
```

**My lean:** **B1 (daemon-managed)** — it's the only option that both hits the latency target *and* matches the project's stated architecture. But it's a fork because it changes `aos say`'s daemon-independence for the Kokoro path, and if the maintainer values that independence highly, B2 is the escape hatch. Decide before writing the warm service, because the two shapes share almost no code.

### 7.3 Fork C — Cross-platform vs. macOS-native UX (orthogonal, product-level)

This is the open question the maintainer's own [PR comment](https://github.com/michaelblum/agent-os/pull/589#issuecomment-4919428700) ended on ("cross-platform support or staying as close as possible to Wispr Flow's UX on macOS?"), and Sigil-doc open-question #7. It's orthogonal to the phase order — it colors *how* Phases 3–5 are built, not *when*.

```
              ┌─ Path C1: macOS-native (FreeFlow, Tier-1 MIT, mac-only reference)
Product reach ┤     + tightest integration with the TCC/AX/CGEvent stack we already depend on
              │     + smaller surface, faster to feature-parity with Wispr Flow UX
              │     − no Windows/Linux story
              │
              └─ Path C2: cross-platform-ready (OpenWhispr, Tier-1 MIT, cross-platform)
                    + Windows/Linux reach from day one
                    − everything in agent-os today (CGEventTap, AX API, TCC broker) is mac-specific;
                      cross-platform would fight the entire existing foundation
```

**My lean:** **C1 (macOS-native)** for anything on this roadmap. agent-os's entire foundation — the AX API element resolution, `CGEventTap`, the TCC broker — is macOS-specific. Bolting cross-platform onto the *voice* layer while the rest of the OS stays mac-only buys reach the product can't actually use yet. Both FreeFlow (C1) and OpenWhispr (C2) are Tier-1 MIT and license-clear to learn from, so **this is purely a product-reach decision, not a licensing constraint** — which is exactly why it's the maintainer's call, not mine to hard-code.

**Blocking upstream dependency for both A2 and either C path:** agent-os has **no `LICENSE` file at the repo root** (verified). Tier-1 MIT code can only be *vendored/adapted* — as opposed to merely read for inspiration — once agent-os declares its own compatible license. That decision sits upstream of any code-copying in Phase 3+.

---

## 8. Phase 5 — Feedback hooks + ephemeral menu (join the tracks)

With warm TTS (Phase 1) and dictation events (Phase 4) both live, Concept C/D become small:

- **Resurrect `feedback.sound`.** It's a config `Bool` defaulting `false` ([`config.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/shared/config.swift), the `case "feedback.sound"` handler exists) with **no `NSSound`/`afplay` behind it** — a stub built for exactly this. Wire it to a Sigil-side, bus-driven response registry keyed by `voice.*` event names. `kind: "tts"` entries call the Phase-1 Kokoro path with a *distinct* `voice://` URI, so "I'm listening, Michael!" speaks in a different voice than the agent's normal replies.
- **Add `voice.wake_detected` as a second radial-menu trigger.** Today `sigil-radial-menu.json`'s `openAnimation.trigger` is `avatar-click` only; the `activationTransition` fade pipeline is already trigger-agnostic ([`apps/sigil/renderer/radial-menu/`](https://github.com/michaelblum/agent-os/tree/1c8dc81a014e534651c95c3c763cafa539de2799/apps/sigil/renderer/radial-menu)). The one real change: feed a live VAD amplitude signal into the opacity interpolation so the overlay "listens back" (brightens on input, fades on silence) instead of running a one-shot timer.

**Opinionated call:** sound-hook config lives in **Sigil's own config** (the `sigil/agents/<id>.md` wiki-doc pattern), not a new daemon-level schema — answering Sigil open-question #4. The daemon delivers events; policy is app-owned.

---

## 9. Phase ∞ — Full-duplex (honest stretch)

Barge-in requires real-time echo cancellation (mic runs while TTS plays). **Don't build custom DSP first.** Spike whether `AVAudioEngine`'s voice-processing I/O unit (`setVoiceProcessingEnabled(true)`) — which Apple ships for VoIP — is good enough out of the box. If not, half-duplex (Phase 4) is a perfectly good *permanent* answer, not a failure. This is intentionally last and intentionally optional.

---

## 10. Sequencing summary & parallelization

- **Two independent tracks** until Phase 5: TTS (0→1) and STT/trigger (2→3→4). Staff one owner each; they only need to agree on the frozen `voice.*` event names (§6).
- **Phase 2 has no dependencies** — start it immediately, in parallel with Phase 0, so permissions/plist scaffolding isn't on the critical path.
- **Resolve Fork B before Phase 1 code**, **Fork A before Phase 3 code**. **Fork C** can be deferred until Phase 3 but should be settled before any Tier-1 code is *copied* (and that copying is itself gated on the repo declaring a LICENSE).
- **Every phase ships standalone value** — you can stop after any one and have a coherent, non-half-built feature.

## 11. Sources

- Companion proposals in this PR (linked in header).
- Verified code anchors at [`1c8dc81`](https://github.com/michaelblum/agent-os/tree/1c8dc81a014e534651c95c3c763cafa539de2799): [`src/voice/provider.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/provider.swift), [`src/voice/registry.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/registry.swift), [`src/voice/say.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/say.swift), [`src/voice/engine.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/voice/engine.swift), [`src/daemon/unified.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/daemon/unified.swift), [`src/commands/operator.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/commands/operator.swift), [`src/shared/config.swift`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/src/shared/config.swift), [`shared/schemas/daemon-event.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/shared/schemas/daemon-event.md), [`docs/adr/0015-aos-tcc-capability-broker-boundary.md`](https://github.com/michaelblum/agent-os/blob/1c8dc81a014e534651c95c3c763cafa539de2799/docs/adr/0015-aos-tcc-capability-broker-boundary.md).
- Prior-art license survey: [PR #589 comment](https://github.com/michaelblum/agent-os/pull/589#issuecomment-4919428700); [FreeFlow (MIT)](https://github.com/zachlatta/freeflow), [OpenWhispr (MIT)](https://github.com/OpenWhispr/openwhispr).
