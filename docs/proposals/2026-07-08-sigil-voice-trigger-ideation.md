# Sigil Voice Trigger System — Deep Ideation (Track 2)

**Status:** Ideation / pre-design. No code changes proposed here — this is a
grounding document for a follow-up design pass.

**Author:** Perplexity Computer, on behalf of @mikeblum603

**Related:** `docs/proposals/2026-07-08-kokoro-tts-backend-integration.md`
(pluggable local TTS backend for `aos say` — the sound-hook system below reuses
that work for spoken responses).

## Framing: this is explicitly Track 2

Everything below is scoped as an **app/experience-layer concern**, not a
change to the `aos` binary or its command surface. `apps/sigil/AGENTS.md`
already states this precisely:

> "Sigil is a **Track 2 consumer** of agent-os... It does not belong in
> `packages/` — it's an application, not a toolkit component."

And its Platform Dogfood Boundary draws the ownership lines we should respect
when scoping any of this work:

- **Sigil** owns avatar personality, product behavior, effects, agent-facing
  content, and special visual expression.
- **AOS daemon** owns native canvas lifecycle, display topology, input
  streams, content serving, and generic routing primitives.
- **Toolkit** owns reusable surface/windowing policy and interaction-region
  helpers.
- Rule of thumb: "If Sigil needs a reusable platform capability, extract it
  downward before growing a private Sigil-only subsystem."

Practically, that means: wake-word detection, dictation state, sound-hook
config, and the ephemeral voice menu should be designed and prototyped as
**Sigil product behavior**, consuming only generic AOS daemon primitives that
already exist (event bus pub/sub, canvas lifecycle, global hotkey capture
points). Only if a piece proves genuinely reusable across future apps (not
just Sigil) should it be proposed for extraction into `packages/toolkit` or
the daemon core. Nothing here should touch `manifests/commands/` or add new
`aos` subcommands as a first move.

## Current-state audit

Before ideating, it's worth being precise about what already exists versus
what's a green field. This matters because two of the four features below are
much cheaper than they look — they're extensions of existing plumbing, not new
subsystems.

### What does not exist at all

An exhaustive search of the codebase (`AVAudioEngine`, `SFSpeechRecognizer`,
`microphone`, `wakeword`, `hotword`) turns up **zero matches**. There is
currently no microphone capture, voice activity detection (VAD), wake-word
spotting, or speech-to-text anywhere in agent-os. `aos listen` looks like a
natural fit by name, but it is a **text-based** inter-agent coordination
channel (`scripts/aos-tell-listen.mjs`, socket actions `listen.read` /
`listen.follow` / `listen.channels`), paired with `aos tell` — it has nothing
to do with audio. This whole feature area is a genuine green field, which is
exactly why it belongs in Track 2 (an app can iterate on this fast; the core
binary should not carry speculative audio-pipeline code).

### What already exists and is directly reusable

- **The daemon event bus already reserves a `voice` service with zero
  events.** `shared/schemas/daemon-event.md` documents the wire protocol
  (ndjson over a Unix socket, `{v, service, event, ts, data, ref?}` envelopes,
  `subscribe` with optional `events` filter and `snapshot`) and lists valid
  `service` values as `perceive`, `display`, `act`, and **`voice`** — but the
  events table only defines perceive/display/act events today. This is a
  ready-made namespace: `voice.wake_detected`, `voice.dictation_opened`,
  `voice.dictation_closed_send`, `voice.dictation_closed_cancel`, etc. can be
  added as new event names without any protocol or schema redesign.
- **`feedback.sound` is a config flag that has never been implemented.**
  `FeedbackConfig.sound: Bool` (default `false`) exists in
  `src/shared/config.swift`, but there is no `NSSound` or `afplay` call
  anywhere in the Swift codebase. It's a stub that was clearly meant for
  exactly this kind of feedback-hook use case and has been sitting unused.
- **Global hotkey capture has an established pattern.** `CGEvent.tapCreate`
  is already used in three places for a "cancel speech" hotkey:
  `src/voice/say.swift:132` (per-invocation), `src/daemon/unified.swift:3201`
  (daemon-persistent), and `src/perceive/daemon.swift:134`. There's also
  `src/perceive/input-safety-hotkeys.swift` and a keyCode-53 (Escape) cancel in
  `src/perceive/capture-pipeline.swift:1344`. None of these implement a
  *hold-duration* trigger (e.g., "spacebar held >2s"), but the tap-creation and
  event-loop scaffolding is proven and copyable.
- **Sigil's radial menu is already an ephemeral, fading overlay.** The exact
  UX shape the user is describing — "an overlay appears, fades over time if
  nothing happens" — is not hypothetical, it's shipping today.
  `apps/sigil/renderer/radial-menu/sigil-radial-menu.json` defines the menu
  (`avatar-controls`, `agent-terminal`, `annotation-mode`,
  `annotation-camera`, `wiki-graph` items) with a real
  `activationTransition` block driving fade/dissolve/zoom via `duration_ms`
  and eased opacity interpolation
  (`apps/sigil/renderer/live-modules/radial-activation-transition.js`:
  `fadeOpacity()`, `dissolveOpacity()`). Today it's triggered by
  `avatar-click` only. The fade math is currently driven by a monotonic
  elapsed-time `progress` value, not a live signal — worth noting because
  "brightens again on new mic input" needs a different (bidirectional, signal-
  driven) input than what's wired in today, even though the visual fade
  machinery itself is ready to be reused.

This gives a clean way to describe the whole feature set: **new capture layer
(green field) → existing event bus (`voice.*` namespace) → existing but
unimplemented feedback hook (`feedback.sound`) → existing but currently
one-directional fade UI (radial menu)**. Each arrow is a seam where new work
plugs into something that already works, rather than a from-scratch stack.

## Concept A — Wake phrase + hold-spacebar alternate trigger

Two independent entry points into the same downstream state machine (below),
so users have a hands-free and a hands-on path:

- **Wake phrase ("Hey Sigil", or whatever name is configured):** requires the
  new green-field piece — a small always-listening capture process. Given
  there is zero existing audio infra, the honest options are (a) an on-device
  lightweight keyword spotter (e.g., a small ONNX/CoreML wake-word model
  running continuously at negligible CPU, similar in spirit to how
  Siri/"Hey Siri" or open-source projects like openWakeWord work) or (b) lean
  on Apple's `SFSpeechRecognizer` in a lower-power "on-device only" mode. (a)
  is strongly preferred: continuous cloud/heavier STT for wake-word spotting
  alone is wasteful and adds latency exactly where the user does not want it.
  This process should run as a small Sigil-owned helper (not inside the AOS
  daemon), publishing a single `voice.wake_detected` event onto the daemon bus
  when it fires, and otherwise touching nothing else in the system. This
  keeps the "always listening" surface area small, sandboxed to one process,
  and easy to kill/restart independent of the daemon.
- **Hold-spacebar (>2s):** far cheaper — a `CGEventTap` timing the key-down to
  key-up interval, following the exact pattern already in
  `src/perceive/input-safety-hotkeys.swift`. No ML, no always-on audio. This
  is the trigger to ship first, since it validates the whole downstream
  dictation state machine without needing a wake-word model at all. It also
  gives users a reliable fallback when ambient noise makes wake-word spotting
  unreliable.

Both triggers should emit the *same* `voice.wake_detected` event (with a
`source: "phrase" | "hotkey"` field) so the downstream state machine in
Concept B doesn't need to know which trigger fired.

## Concept B — Half-duplex dictation state machine

A state machine with four states: `IDLE → LISTENING → (SEND | CANCEL) → IDLE`.
Design goal: give the user several redundant ways to close a dictation
session, because voice-only "stop listening" phrases are failure-prone in
noisy environments or in the middle of a spoken sentence.

**Entry into `LISTENING`:** either trigger from Concept A. On entry, publish
`voice.dictation_opened` on the bus — this is the hook Concept C's sound
system reacts to (e.g., playing "I'm listening, Michael!").

**Exit paths, all valid simultaneously (first one to fire wins):**

1. **Watchphrase stop** — user says a stop phrase ("send that" / "cancel
   that"), disambiguated by wording, not just presence of speech.
2. **Release spacebar** (if that's how `LISTENING` was entered) — releasing
   immediately closes and sends. This maps hold-to-talk semantics onto the
   same state machine as the wake-phrase path, so both triggers converge on
   one implementation.
3. **Third input trigger** — e.g., a distinct key chord or a UI affordance in
   the ephemeral menu (Concept D) that's always available while `LISTENING`
   is active, as an explicit "send" button for cases where speech alone is
   unreliable.
4. **Pomodoro-style timeout** — this is the most interesting of the four and
   worth spelling out as its own sub-state:
   - On entering `LISTENING`, start a countdown (e.g., 8–12s, tunable).
   - Any detected speech energy (VAD, not full transcription) resets the
     countdown, so the user isn't cut off mid-sentence.
   - If the countdown reaches zero **while there has been any completed
     utterance**, auto-send what's been captured so far.
   - If the countdown reaches zero **with no speech captured at all** (dead
     air from the moment `LISTENING` opened), auto-cancel instead — the user
     probably triggered by accident or walked away.
   - This "silence resolves the ambiguity" rule is the key design idea: it
     turns an otherwise-annoying fixed timeout into something that
     distinguishes "I said something and then paused" (send) from "nothing
     happened" (cancel), without extra user action.

Each exit path should publish either `voice.dictation_closed_send` or
`voice.dictation_closed_cancel` with a `reason` field (`phrase` / `key_release`
/ `explicit_trigger` / `timeout`) — useful both for the sound-hook system
(Concept C can play a different confirmation sound per reason) and later for
tuning which exit path users actually use in practice.

## Concept C — Sound-hook / subscription config system

This formalizes the currently-unimplemented `feedback.sound` stub into a real
subscription system, and is the natural place to plug in the pluggable-TTS
work from the companion doc.

**Shape:** a small config-driven registry, keyed by the `voice.*` event names
from Concept A/B, where each key maps to a "response" definition:

```json
{
  "voice.dictation_opened": {
    "kind": "tts",
    "backend": "kokoro",
    "pick": "random",
    "responses": [
      "I'm listening, Michael!",
      "Go ahead.",
      "Listening..."
    ]
  },
  "voice.dictation_closed_send": {
    "kind": "system_sound",
    "sound": "Pop"
  },
  "voice.dictation_closed_cancel": {
    "kind": "system_sound",
    "sound": "Basso"
  }
}
```

- `kind: "system_sound"` is the cheap default — this is literally what
  `feedback.sound` was presumably meant to gate, just never wired to
  `NSSound`/`afplay`.
- `kind: "tts"` is where this connects directly to
  `2026-07-08-kokoro-tts-backend-integration.md`: once `aos say` (or the
  underlying `SpeechEngine`) supports a pluggable `KokoroVoiceProvider` (or,
  down the line, a macOS Personal Voice via the accessibility brainstorm doc),
  this hook can call the same synthesis path with a specific `voice://`
  provider URI, so "I'm listening, Michael!" can be spoken in a distinct voice
  from whatever the agent normally uses for `aos say` responses — a clear
  differentiator between "system acknowledging you" and "agent talking to
  you."
- Consumers of this config are Sigil-side (the renderer/companion process
  subscribes to the bus and looks up the response registry), not the daemon —
  consistent with "AOS daemon owns generic routing; Sigil owns product
  behavior." The daemon's job is only to deliver the `voice.*` events; what
  sound or voice line plays in response is 100% app-configurable policy.
- Because it's keyed by event name and not hardcoded, other future
  agents/experiences (not just Sigil) could subscribe to the same `voice.*`
  events and define their own response banks — this is the "hooks
  subscribable to trigger events" idea generalized past just this one app.

## Concept D — Voice-triggered ephemeral menu overlay

This is the smallest lift of the four, because the visual and lifecycle
machinery already exists in `apps/sigil/renderer/radial-menu/`. Two concrete
changes needed:

1. **Add a second activation trigger.** Today `sigil-radial-menu.json`'s
   `openAnimation.trigger` is `avatar-click` only. Add `voice.wake_detected`
   (specifically when it resolves to something like the "Run Command" intent
   from the wake flow) as an alternate trigger source feeding the same
   `menu-activation-runtime.js` state machine. No new visual code needed — the
   `activationTransition` fade/dissolve pipeline is trigger-agnostic already.
2. **Make the fade bidirectional and signal-driven.** Currently
   `radial-activation-transition.js`'s opacity math (`fadeOpacity`,
   `dissolveOpacity`) is driven by a monotonic elapsed-time `progress` value —
   fine for a one-shot open/close animation, but "fades over time if mic hears
   nothing, brightens again if new mic input passes a threshold" needs a
   *live* signal, not a fixed timer. The concrete change is to feed a
   VAD-derived amplitude/confidence value (from the same capture path as
   Concept A) into the existing opacity interpolation instead of (or in
   addition to) the timer-derived `progress`, so the overlay visually "listens
   back" — opacity tracks a decaying-then-refreshed signal rather than a
   single countdown.

Worked example matching the user's flow: user says wake phrase → radial menu
overlay appears (Concept D trigger) with a "Run Command" item highlighted →
user says "watch me" → this is itself a mini instance of the dictation state
machine (Concept B) scoped to just resolving one menu item, which on
`voice.dictation_closed_send` maps the transcribed phrase to a menu action →
menu dispatches `aos see record --whatever` the same way existing radial menu
items already dispatch `aos_command` steps (see `recipes/sigil/start.json` for
the existing pattern of a JSON recipe step invoking an `aos_command`). No
change to the command surface itself — the menu is just another caller of
commands that already exist.

## TCC permissions this introduces

agent-os today requests four permission classes through the broker's
`__permissions prompt` primitive (`src/commands/operator.swift`, enum
`PermissionPromptKind`): **Accessibility** (`AXIsProcessTrustedWithOptions`),
**Screen Recording** / "Screen & System Audio Recording"
(`CGRequestScreenCaptureAccess`), and **Input Monitoring**, which is actually
two native triggers under one System Settings pane —
`CGRequestListenEventAccess` (listen) and `CGRequestPostEventAccess` (post,
used for synthetic CGEvents). None of this touches the microphone.

Everything proposed in this document needs **two additional, currently
unused TCC classes**:

1. **Microphone** (`kTCCServiceMicrophone` / `NSMicrophoneUsageDescription`).
   Required for *any* live audio capture — the always-listening wake helper in
   Concept A, the dictation capture in Concept B, and the live VAD signal
   driving the menu fade in Concept D all need this, even before any
   transcription happens. This is worth stating explicitly because **"Screen
   & System Audio Recording" does not cover this** — that permission
   (`CGRequestScreenCaptureAccess`) governs screen video and *system audio
   output* (what plays through speakers/apps), not the physical microphone
   *input*. The two are commonly conflated because both are audio-adjacent,
   but they are separate TCC services with separate prompts and separate
   entries in System Settings → Privacy & Security.
2. **Speech Recognition** (`kTCCServiceSpeechRecognition` /
   `NSSpeechRecognitionUsageDescription`). A distinct *second* prompt beyond
   Microphone, required only if Concept B's free-form dictation transcription
   leans on Apple's Speech framework (`SFSpeechRecognizer` or the newer
   `SpeechAnalyzer`) rather than a fully custom ASR stack — which is the
   realistic default choice here. It is not needed for the wake-word spotter
   alone if that stays a lightweight local keyword model operating on raw
   audio buffers (per Concept A), since that doesn't call the Speech
   framework at all — only the dictation-transcription step in Concept B
   triggers this prompt. Two more things worth deciding deliberately rather
   than by default: (a) request `requiresOnDeviceRecognition = true` to keep
   transcription local — consistent with the local-first, low-latency
   posture already established in the Kokoro TTS doc — since server-based
   recognition adds a further, separate "send speech data to Apple" consent
   nuance inside the same Speech Recognition flow; (b) on-device recognition
   is not guaranteed available for every language/locale, so this should be
   probed rather than assumed.

Neither addition is a scope surprise: `ARCHITECTURE.md` already names
**Microphone** as one of the four TCC classes the `./aos` broker is described
as managing ("Screen Recording, Accessibility, Input Monitoring, and
Microphone"), alongside voice/communication rows explicitly marked
"STT planned." It's simply unrequested and unused today — no capture code
exists yet (per the audit above), so there's been nothing to trigger the
prompt.

**Placement implication for the Track 2 boundary above:** `docs/adr/0015-aos-tcc-capability-broker-boundary.md`'s
Swift Change Gate lists "a new TCC permission class" as one of the few
*accepted* reasons to touch the broker directly — the same bucket Accessibility,
Screen Recording, and Input Monitoring already live in. That means, unlike the
rest of this feature set, **acquiring and probing Microphone and Speech
Recognition authorization state is legitimately broker-owned**, not Sigil
product behavior: the natural move is two new `PermissionPromptKind` cases
(`microphone`, `speech-recognition`) backed by
`AVCaptureDevice.requestAccess(for: .audio)` and
`SFSpeechRecognizer.requestAuthorization`, following the exact shape of the
four that exist today. Everything downstream of "permission granted" — the
wake-word model, the dictation state machine, the sound hooks, the menu — stays
Track 2 in Sigil, per the ownership split already established above. This is a
clean example of the boundary doing its job: the *privileged fact/action* (is
mic access granted; ask for it) is broker-owned; the *policy* (what to do with
the audio once access is granted) is app-owned.

**Loose ends for whoever picks this up:** no `Info.plist` or `.entitlements`
file currently exists in the repo (confirmed by search) — before either
permission can be requested, usage-description strings need to be added
wherever the shipped binary's plist is generated, and — if the binary is
sandboxed/notarized outside the Mac App Store, consistent with its existing
global `CGEventTap` usage — the corresponding `com.apple.security.device.audio-input`
entitlement needs auditing too. Also worth flagging operationally: Screen
Recording permission is known to reset periodically on modern macOS (monthly,
and after every restart on recent releases) — Microphone and Speech
Recognition don't share that particular quirk and behave more like
Accessibility (persistent until explicitly revoked), but this is worth
verifying against whatever macOS version ships when this is actually built.

## Full-duplex (explicit stretch goal, likely "later or never")

Flagging this honestly rather than over-scoping it: true full-duplex (agent
can be interrupted mid-speech, both sides can talk over each other) requires
real-time echo cancellation — the mic must run continuously while
`SpeechEngine`/`aos say` output is also playing, without the mic picking up
the agent's own voice as new input. Before investing in custom DSP or a
third-party AEC library, the cheap first step is to spike whether
`AVAudioEngine`'s built-in `AVAudioEngine.inputNode` + voice-processing I/O
unit (`setVoiceProcessingEnabled(true)`) is good enough out of the box — Apple
ships this specifically for VoIP-style full-duplex use cases and it may cover
this need with zero custom signal processing. If that spike doesn't hold up
under real usage, half-duplex (Concept B) with a fast open/close cycle is a
perfectly reasonable permanent fallback rather than a stepping stone.

## Where this should actually live (Track 2 placement)

Checked both `skills/` and `recipes/` as candidate homes before writing this:

- `recipes/sigil/` (`start.json`, `start-agent-terminal.json`) is explicitly
  scoped to **operational procedures** — per `recipes/AGENTS.md`, "durable
  architecture belongs in `docs/adr/`, `docs/api/`, or `shared/schemas/`,"
  recipes are not the place for design ideation. Once a concrete trigger
  design is picked, a `recipes/sigil/enable-voice-triggers.json`-style recipe
  would make sense as the *operational* activation step, but not before.
  Instead of the vague "Track 2 recipes" label, the concrete gate here is: a
  recipe should exist only after a design lands as real config/code — the
  first recipe would just be turning the feature on.
- `skills/` is entirely AOS-agent-workflow skills (`aos-desktop`,
  `aos-focus-sessions`, `aos-recipes`, etc.) — not a fit for product design
  ideation either; skills document how an agent operates the system, not how
  Sigil's own features are designed.
- **Conclusion:** this document belongs exactly where it is —
  `docs/proposals/`, alongside the Kokoro TTS backend doc it depends on — as
  the ideation/pre-design record. When a concrete design is chosen, it should
  graduate to `apps/sigil/AGENTS.md` (architecture) and, if a genuinely
  reusable capability is extracted (e.g., a generic "hold-duration hotkey"
  primitive or a generic bus-driven sound-hook registry that other apps could
  use), a short proposal for lifting that specific piece into
  `packages/toolkit` — never the whole feature, per the Platform Dogfood
  Boundary's "extract downward before growing a private subsystem" rule.

## Open questions for the next design pass

1. Wake-word model choice and where the always-listening helper process lives
   (launched by Sigil? by `aos serve`? standalone LaunchAgent?) — this affects
   battery/CPU posture and, per the TCC section above, which process identity
   actually needs to hold the Microphone/Speech Recognition grants (the
   unified `./aos` broker identity, to stay consistent with the "one
   permissioned broker binary" principle in ADR 0015, rather than a separate
   helper binary fragmenting TCC identity).
2. Does the daemon need a new inbound path for *injecting* `voice.*` events
   (from an external Sigil helper) or does `broadcastEvent()` already have an
   external-facing entry point? (`src/daemon/unified.swift:562` is called
   internally 13 times; whether an external process can post onto the bus the
   same way needs confirming before Concept A can be built.)
3. Exact pomodoro timeout durations and whether they should be user-tunable
   per dictation context (a "watch me" one-word menu answer probably wants a
   much shorter timeout than a long freeform dictation).
4. Whether `feedback.sound` should be resurrected as a general daemon-level
   flag at all, or whether sound-hook config should live entirely inside
   Sigil's own config (the wiki-doc-based per-agent config pattern already
   used for `sigil/agents/<id>.md` seems like a strong existing precedent to
   reuse for response-bank config too).
