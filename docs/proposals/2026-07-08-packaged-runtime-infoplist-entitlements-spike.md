# Packaged-Runtime `Info.plist` / `.entitlements` Spike

- **Status:** Spike (analysis + scoped experiment) — no runtime behavior change intended
- **Date:** 2026-07-08
- **Decision trail:** unblocks the second item in the blocker table after `LICENSE` (commit `43365d5`, PR #589). LICENSE ✅ → **Info.plist/.entitlements 🔴 (this spike)**.
- **Related:** PR #589 (`perplexity-voice-io-proposals`) — local TTS (`aos say`) + dictation (`aos listen`) + voice-trigger direction, which is what *adds* the microphone / speech-recognition permission surfaces this spike must anticipate.

## Summary

Today `aos` ships as a **bare, ad-hoc-signed Mach-O executable**, not an app bundle. `build.sh` compiles every `src/**/*.swift` with a single `swiftc -parse-as-library -o ./aos` invocation and signs it with `codesign --force --sign - --identifier com.agentos.repo-aos` — there is **no `Info.plist`, no `.entitlements`, no bundle, and no stable code-signing identity**. As a result:

- Every rebuild produces a binary with a *new* ad-hoc signature, so macOS treats it as a new app and **silently drops previously-granted TCC permissions**. `build.sh` already ships an explicit `play_rebuild_alert()` warning the user to "manually reset/regrant needed macOS TCC permissions before TCC-backed proof." This is the core pain this spike targets.
- The runtime already depends on **three TCC-gated surfaces** (Accessibility, Screen Recording, Input Monitoring), enforced via `ensureInteractivePreflight(...)` in `src/main.swift` and surfaced by the `__permissions` broker (`accessibility`, `screen_recording`, `listen_access`, `post_access`).
- PR #589's dictation direction (`aos listen` as mic capture) and any local-model TTS will introduce **two more surfaces** — Microphone and Speech Recognition — which require `Info.plist` usage-description strings or the process will be **hard-killed by the OS** on first API touch, not merely denied.

This spike is to **prove out a packaged runtime with a stable signing identity, an `Info.plist`, and an `.entitlements` file** that (a) makes TCC grants survive rebuilds, and (b) pre-declares the usage-description strings the voice-I/O roadmap needs. It is deliberately **additive and reversible**: the goal is a working experiment branch and a go/no-go recommendation, not a merged packaging pipeline.

## Non-goals

- No change to the `aos` CLI contract, command manifests, or any `src/**` runtime logic.
- Not shipping notarization / Developer ID distribution — that is explicitly a *follow-on* once the bundle shape and entitlement set are proven (see Open Questions).
- Not implementing the Kokoro/dictation features themselves — this spike only prepares the permission substrate they will land on.
- No CI/release-automation work; the spike may hand-run `build.sh --release`.

## Current-state findings (grounded in the tree at `main` @ `43365d5`)

### Build & signing

- `build.sh` → `swiftc … -o "$REPO_ROOT/aos"` produces a top-level executable (git-ignored via `/aos`). Modes: `--release` (`-O`) vs default dev (`-Onone`). Links `-lsqlite3`.
- Signing is **ad-hoc**: `codesign --force --sign - --identifier com.agentos.repo-aos`. No `--entitlements` flag, no keychain identity, no `--options runtime` (hardened runtime).
- `signature_valid()` only checks `codesign --verify`; there is no entitlement or identity assertion.
- `play_rebuild_alert()` fires on every rebuild specifically because TCC bindings break — direct evidence of the problem.

### Permission surfaces actually used today

| Surface | TCC service | Where in code | `__permissions` key |
| --- | --- | --- | --- |
| Accessibility | `kTCCServiceAccessibility` | `AXIsProcessTrusted()` / `AXIsProcessTrustedWithOptions()` in `src/perceive/daemon.swift`, `src/perceive/capture-pipeline.swift` | `accessibility` |
| Screen Recording | `kTCCServiceScreenCapture` | `CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()` + `SCShareableContent` in `src/perceive/capture-pipeline.swift` | `screen_recording` |
| Input Monitoring (listen) | `kTCCServiceListenEvent` | `CGEvent.tapCreate(...)` listen-only tap in `src/perceive/daemon.swift`, `src/daemon/unified.swift`, `src/voice/say.swift` | `listen_access` |
| Input posting (post) | (paired with Accessibility for synthetic events) | `CGEvent` posting in `src/act/actions.swift` | `post_access` |

`ensureInteractivePreflight(...)` in `src/main.swift` already gates `aos do …`, `aos see …` on these. The preflight/broker machinery is the natural consumer of a stable identity.

### Permission surfaces the voice-I/O roadmap (#589) will add

| Surface | TCC service | Required `Info.plist` key | Triggered by |
| --- | --- | --- | --- |
| Microphone | `kTCCServiceMicrophone` | `NSMicrophoneUsageDescription` | `aos listen` dictation (mic capture — *not* today's channel reader) |
| Speech Recognition | `kTCCServiceSpeechRecognition` | `NSSpeechRecognitionUsageDescription` | on-device / `SFSpeechRecognizer`-style transcription, if used |

> Note: today's `aos listen` (`manifests/commands/source/aos/12-listen.json`) is a **message-channel reader** and touches **no** audio/mic API. Mic + speech-recognition are strictly *future* surfaces the packaging must pre-declare so the dictation feature doesn't get OS-killed on first run.

### `aos say` today

`src/voice/say.swift` + `src/voice/engine.swift` use `NSSpeechSynthesizer` (system TTS) — this needs **no** entitlement. A local-model TTS (Kokoro) runs as compute in-process/subprocess and also needs no *new* TCC surface, but does need audio *output*, which is unrestricted. So the TTS side of #589 is entitlement-neutral; the **dictation side is what forces the `Info.plist`**.

## Proposed spike work (the experiment)

1. **Introduce a minimal `Info.plist`** (checked into the repo, e.g. `packaging/Info.plist`) with at least:
   - `CFBundleIdentifier` = `com.agentos.repo-aos` (reuse the existing ad-hoc identifier so TCC continuity is preserved).
   - `CFBundleExecutable`, `CFBundleName`, `CFBundleShortVersionString`, `CFBundleVersion`.
   - `LSMinimumSystemVersion` (target M1 Pro / macOS 26.5.1 baseline from #589's hardware review).
   - Usage-description strings for the surfaces we already touch and will touch: `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` (pre-declared even if unused this pass), and — if macOS attributes AX/Screen-Recording prompts to the plist — appropriate rationale strings.
2. **Introduce a minimal `.entitlements`** (e.g. `packaging/aos.entitlements`). Start from the *empty/minimal* set and add only what the runtime provably needs. Candidate keys to evaluate:
   - `com.apple.security.device.audio-input` (mic, for dictation).
   - `com.apple.security.automation.apple-events` (only if any AppleScript/AE path is used — audit first).
   - Decide explicitly whether to adopt the **Hardened Runtime** (`codesign --options runtime`) now or defer; hardened runtime interacts with entitlements and with loading local model binaries/dylibs (Kokoro).
3. **Decide the packaging shape.** Two options to prototype and compare:
   - **(A) Embed `Info.plist` in the bare executable** via `-Xlinker -sectcreate __TEXT __info_plist packaging/Info.plist` in `build.sh`. Keeps the single-file `./aos` shape — lowest disruption.
   - **(B) Produce a real `.app` bundle** (`aos.app/Contents/{MacOS/aos, Info.plist}`) as a `--release`/packaged output. More faithful to distribution but changes the artifact shape and invocation.
   - **Recommendation to validate:** try (A) first — it may be enough to (i) give the process a real `Info.plist` for usage strings and (ii) pin identity — while keeping `./aos` as-is for dev.
4. **Move signing to a stable identity.** Prototype signing with `--entitlements packaging/aos.entitlements` and evaluate whether ad-hoc (`--sign -`) with a *fixed identifier + embedded plist* is enough to make TCC grants survive rebuilds, or whether a self-signed / Developer ID cert is required. This is the **central hypothesis to test**.
5. **Wire it into `build.sh` behind a flag** (e.g. `--package` or gated on `--release`) so dev builds stay fast and unchanged.
6. **Update the `__permissions` / preflight narrative** only if the packaged identity changes what the broker should report (likely a docs/notes change, not logic).

## Spike checklist (acceptance / exit criteria)

Investigation:
- [ ] Confirm the exact TCC services each current API maps to, and whether AX / Screen-Recording prompts are attributed to `CFBundleIdentifier` vs. the raw binary path on the target macOS (26.5.x).
- [ ] Audit `src/**` for any Apple Events / AppleScript usage to decide if `com.apple.security.automation.apple-events` is needed.
- [ ] Determine whether the current ad-hoc identifier already gives stable TCC identity, or whether every rebuild's re-sign is what breaks grants.

Experiment:
- [ ] Add `packaging/Info.plist` with bundle id `com.agentos.repo-aos` + usage strings (`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`).
- [ ] Add `packaging/aos.entitlements` with the minimal proven set.
- [ ] Prototype packaging **option (A)** (embedded `__info_plist` section) in a `build.sh` flag; capture whether `codesign -d --entitlements -` and `mdls`/`otool -s __TEXT __info_plist` show the embedded plist.
- [ ] Prototype packaging **option (B)** (`.app` bundle) far enough to compare, or record why (A) suffices.
- [ ] Sign with `--entitlements` (+ decide on `--options runtime`) and verify with `codesign --verify --deep --strict` and `codesign -d --entitlements :-`.

Proof (the payoff test):
- [ ] **TCC-persistence test:** grant Accessibility + Screen Recording + Input Monitoring once, rebuild via the packaged path, and confirm grants **survive** (no re-prompt, `aos permissions check` stays `ready_for_testing`). This is the go/no-go signal.
- [ ] **Usage-string test:** trigger a mic/speech-recognition code path (or a throwaway probe) and confirm the OS shows the declared rationale string instead of hard-killing the process for a missing `Info.plist` key.
- [ ] Confirm dev build (`build.sh` with no packaging flag) is **unchanged** in speed and output.
- [ ] Confirm `play_rebuild_alert()` can be safely quieted once grants persist (or document why it must stay).

Deliverables:
- [ ] Recommendation: option (A) vs (B), ad-hoc-stable-identity vs self-signed vs Developer ID, hardened-runtime yes/no.
- [ ] File-level change list for the follow-on implementation PR.
- [ ] Explicit list of anything deferred to notarization/distribution.

## Concrete file-level change list (for the follow-on impl PR)

- `packaging/Info.plist` — new.
- `packaging/aos.entitlements` — new.
- `build.sh` — add packaging flag; thread `--entitlements` (and optionally embedded `__info_plist` / `.app` assembly) into the sign step; keep dev path untouched.
- `.gitignore` — ignore any packaged output dir (e.g. `/aos.app`, `dist/`) if option (B) is used (`dist/` already ignored).
- `scripts/aos-permissions.mjs` / readiness notes — docs-level update only if the identity story changes broker output.
- `docs/` — record the go/no-go decision (mirroring the #589 → LICENSE decision-trail pattern).

## Open questions / risks

- Does ad-hoc signing with a **fixed identifier + embedded plist** actually persist TCC grants across rebuilds, or does macOS key TCC on the full cdhash (which changes every build)? If the latter, a **stable self-signed cert in the login keychain** may be the minimum viable identity — that's the key risk to resolve early.
- Hardened Runtime + loading a local Kokoro model (dylib / mmap'd weights / subprocess) may require `com.apple.security.cs.*` entitlements (e.g. `disable-library-validation`) — evaluate before committing to hardened runtime.
- `.app` bundle (option B) changes how the daemon/service (`aos service`, LaunchAgent path in `scripts/aos-service.mjs`) locates and relaunches the executable — must be checked before adopting B.
- Notarization is out of scope but the entitlement/identity choices here should not paint us into a corner for it.

## Suggested branch

`perplexity-packaged-runtime-infoplist-entitlements-spike` (mirrors the `perplexity-…` proposal-branch convention used by #589).
