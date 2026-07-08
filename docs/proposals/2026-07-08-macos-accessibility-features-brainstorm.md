# macOS Accessibility features worth a closer look for agent-os

Author: Perplexity Computer (collaborator pass), for @michaelblum
Date: 2026-07-08
Status: Brainstorm / discussion starter — not a design doc, not scoped, no implementation implied

## Why this doc exists

While poking around System Settings → Accessibility, several built-in macOS features stood out as
plausibly relevant to agent-os's daemon/agent split (element resolution, TTS, input, and feedback
all live in the daemon; the agent decides what/why). This is intentionally a shallow pass — one
link, one summary, one hot-take each — meant to seed a discussion about which of these (if any) are
worth a real design spec later. Nothing here has been prototyped or verified against the codebase
yet.

## The features

### 1. VoiceOver
[support.apple.com/guide/mac-help/MH40578](https://support.apple.com/guide/mac-help/MH40578/26/mac/26.5.1)

**Summary:** macOS's built-in screen reader. Settings here control turning VoiceOver on/off,
opening VoiceOver Utility, and running the tutorial.

**Hot take:** VoiceOver's whole reason for existing is walking the same Accessibility (AX) API tree
that agent-os's daemon already uses for element resolution. That means Apple has spent two decades
hardening exactly the kind of "what's on screen and how do I address it" problem the daemon solves
today. Worth a look at whether VoiceOver's *rotor* concept (jump by headings/links/form
controls/tables) or its verbosity/hint settings suggest a richer perception model than what agent-os
currently exposes — not to replace the daemon's own AX walking, but to steal UX vocabulary and
possibly rotor-style navigation primitives for `aos see`/perception commands.

### 2. Read & Speak
[support.apple.com/guide/mac-help/SPCH638](https://support.apple.com/guide/mac-help/SPCH638/26/mac/26.5.1)

**Summary:** System-wide settings for the voice macOS uses to read text aloud — select the system
voice, enable "speak selected text," speak announcements, typing feedback, etc.

**Hot take:** This is literally the same voice catalog `SystemVoiceProvider` already enumerates via
`NSSpeechSynthesizer.availableVoices` (see the Kokoro TTS backend proposal earlier in this PR) — so
no new integration surface here, but it's a good reminder that "speak announcements"/"speak
selected text" are System-level hooks a user might already have configured, and agent-os's own
`voice.announce_actions` config should probably not fight with or double-announce alongside these
if both are enabled on the same machine. Also: this is the settings pane that controls the
system-wide default voice `SpeechEngine.resolvedDefaultVoiceID` falls back to when config doesn't
pin one — worth documenting that dependency explicitly somewhere.

### 3. Captions
[support.apple.com/guide/mac-help/MH43180](https://support.apple.com/guide/mac-help/MH43180/26/mac/26.5.1)

**Summary:** Controls how subtitles/closed captions are styled system-wide (size, font, background,
edge style) for media that already ships captions.

**Hot take:** Lowest-relevance item on this list since it's purely a styling layer for existing
caption tracks, not a capture/generation feature. Only interesting if agent-os ever renders its own
on-canvas captions of TTS output (e.g. for muted/headless sessions) and wants to inherit the user's
existing caption style preferences instead of inventing a new style system.

### 4. Live Captions
[support.apple.com/guide/mac-help/MCHLA0B36DB8](https://support.apple.com/guide/mac-help/MCHLA0B36DB8/26/mac/26.5.1)

**Summary:** System-wide, on-device real-time speech-to-text captioning of any audio playing on the
Mac (and of the mic in FaceTime), with adjustable caption styling and language.

**Hot take:** This is the most interesting one for symmetry with the Kokoro TTS work. `aos listen`
presumably needs an ASR backend the same way `aos say` needs a TTS backend — if Live Captions'
on-device recognizer is reachable at all programmatically (unclear — likely private API / no public
hook today, would need real investigation), it could be a zero-install, Apple-native alternative to
running Whisper locally for short-utterance capture, mirroring the "system vs. local model backend"
split we just designed for voice output. Even if it's not directly callable, it's a strong signal
that Apple already ships a fast on-device ASR model on this hardware class, which is useful context
for `aos listen` backend decisions later.

### 5. Voice Control
[support.apple.com/guide/mac-help/SPC002](https://support.apple.com/guide/mac-help/SPC002/26/mac/26.5.1)

**Summary:** Full hands-free control of the Mac by voice — built-in commands plus a custom
vocabulary/command grammar the user can define ("when I say X, do Y").

**Hot take:** Probably the single most agent-os-relevant item here. Voice Control already ships a
mature "voice → OS action" command grammar and dictation engine as a first-class OS citizen. Two
angles worth exploring later: (a) could custom Voice Control commands be defined to invoke `aos`
verbs directly, giving agent-os a zero-effort voice front-end without building its own wake-word/ASR
pipeline; and (b) is there any signal/telemetry from Voice Control being active that the daemon
should be aware of (e.g. don't fight the user for control of dictation focus, or coordinate the
`--voice-slot` cancel-key behavior with Voice Control's own listening state). This feels like the
highest-leverage, lowest-effort item to spend real design time on next.

### 6. Personal Voice
[support.apple.com/guide/mac-help/MCHL4B5F02EC](https://support.apple.com/guide/mac-help/MCHL4B5F02EC/26/mac/26.5.1)

**Summary:** On-device voice cloning built into macOS — records a set of phrases from the user and
produces a synthesized voice that sounds like them, usable via Live Speech and by allowed
third-party apps (e.g. AAC apps).

**Hot take:** This lands directly on top of the pluggable-backend design from the earlier PR
discussion. If Personal Voice is reachable through a documented API (needs verification — this is
exactly the kind of thing that should get a real investigation pass, not just a hot take), it would
be a *fourth* natural `VoiceProvider` candidate alongside `system`/`kokoro`/future
`qwen`/`chatterbox`: fully on-device, zero Python dependency, zero model management, and it
literally sounds like the user — which is a very different value proposition than
Kokoro/Qwen/Chatterbox's "high-quality but generic" voices. Personal Voice being Apple's own
accessibility feature for AAC use cases also suggests it's designed for exactly the "agent speaks on
my behalf" pattern agent-os cares about.

### 7. Accessibility Shortcuts panel settings
[support.apple.com/guide/mac-help/MCHLA7804B65](https://support.apple.com/guide/mac-help/MCHLA7804B65/26/mac/26.5.1)

**Summary:** Configures which accessibility features appear in the quick-toggle Accessibility
Shortcuts panel (triggerable via keyboard shortcut/Touch Bar/Control Strip) so users can flip
features on/off fast.

**Hot take:** Least directly applicable, but it's a reminder that macOS already has a
system-sanctioned "fast toggle panel + global hotkey" pattern for accessibility state, which is
conceptually similar to agent-os's own `hotkeys.cancel_speech` config and status-item toggles. Not
an integration point so much as a UX pattern worth being aware of — if agent-os grows more
toggleable runtime features (voice backend switching, feedback modes, etc.), this panel's
interaction model is a reasonable one to imitate rather than reinvent.

## Suggested next step

Pick one or two of these (Voice Control and Personal Voice look like the strongest candidates) and
scope a real investigation into whether/how they're reachable from a native macOS app — public
Speech framework APIs, private APIs, or "not accessible outside System Settings at all" — before
committing to any design work.
