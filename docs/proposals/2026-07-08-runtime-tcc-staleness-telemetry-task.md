# Follow-on task: make the post-rebuild stale-TCC condition self-documenting at run-time

**For:** the local flagship session on `LM-170585.local` (repo `/Users/Michael/Code/agent-os`).
**Branch:** `perplexity-packaged-runtime-infoplist-entitlements-spike` (PR #590).
**This is NOT a packaging task.** Option A (bare in-repo binary + embedded `Info.plist`) is the accepted dev outcome. Do not pursue an `.app` bundle, a signing cert, or enterprise whitelisting — those are release-time concerns, deferred by design.

## The condition (now correctly understood)

The core `aos` binary is intentionally minimal, stable infrastructure — own TCC permissions, run the daemon, little else — so rebuilds are rare by design. But when it *is* rebuilt, TCC still has the **previous** binary registered. The result is the known trap:

- **Passive checks look green.** `aos permissions check --json` reports `accessibility/screen_recording/listen_access/post_access = true` because TCC still holds the stale registration.
- **A live privileged request fails.** The daemon's actual attempt to acquire the event tap / AX access fails against the rebuilt binary.

This is exactly what the spike hit: `aos ready` went `degraded` with `diagnosis=daemon_tcc_grant_stale_or_missing`. That was **not** an Option A failure — it is this expected post-rebuild staleness. The accepted human-in-the-loop remedy is unchanged: detect → stop the turn → tell the user "please reset TCC permissions" → user resets → user confirms → continue.

## Why this is a telemetry problem

The divergence is *already computed* but not *communicated as this specific, understood condition*. In `scripts/lib/aos-readiness.mjs`, `readyDiagnosis(...)` derives `daemon_tcc_grant_stale_or_missing` precisely from the passive-vs-live gap:

```js
if (daemon && ((daemon.permissions.accessibility === false && permissions.accessibility)
    || daemon.inputTap.listenAccess === false
    || daemon.inputTap.postAccess === false)) {
  return 'daemon_tcc_grant_stale_or_missing';
}
```

That `daemon says false while CLI passive says true` branch **is** the passive-green / live-fail signature. The runtime should name it as such and hand back the exact remedy, so neither a human nor a remote agent has to reverse-engineer "checks are green but the live test fails."

## What to fix (telemetry / run-time documentation — no behavior change to permissions themselves)

1. **Name the condition explicitly in the readiness output.** When the passive CLI view says granted but the daemon's live view says denied, surface a first-class, human-readable reason — e.g. `post_rebuild_tcc_stale` (or annotate the existing `daemon_tcc_grant_stale_or_missing` diagnosis) — that literally states: "TCC has a stale registration for a previous binary; passive checks pass but live privileged access fails after a rebuild."
2. **Emit the passive-vs-live disagreement as structured telemetry.** Include both views side by side (CLI passive booleans vs. daemon live booleans, plus the current binary CDHash/mtime if available) so the mismatch is legible in the JSON, not just inferred. Consider recording the binary identity that TCC last saw vs. the one now running.
3. **Attach the accepted remedy inline.** The degraded response should carry the manual-reset next action (reset TCC → regrant → confirm), consistent with the existing `readyNextActions` / `post-permission` flow, so the "stop the turn and ask the user to reset" handling is driven by the telemetry rather than tribal knowledge.
4. **Cover it with a test** in `tests/aos-readiness-composition.test.mjs`: given `daemon.inputTap.listenAccess === false` while CLI passive `listen_access === true`, assert the new named reason + remedy are present in the readiness response.

Relevant files: `scripts/lib/aos-readiness.mjs` (`readyDiagnosis`, `readyPhase`, `readyNextActions`), `scripts/lib/experience-runtime-readiness.mjs` (the "not reporting ready from passive service status" note), `src/shared/input-tap-health.swift` (`input_tap_not_active` / live-tap health), `scripts/aos-ready.mjs`, and `tests/aos-readiness-composition.test.mjs`.

## Out of scope

- No `.app` bundle, no LaunchServices identity work, no signing cert, no notarization, no MDM/whitelisting. Release-time only.
- Do not try to make TCC auto-persist across rebuilds. The manual reset is the accepted flow; this task only makes the run-time telemetry document that clearly.

## Definition of done

- `aos ready --json` (and the daemon health surface) clearly identify the post-rebuild stale-TCC condition by name, expose the passive-vs-live disagreement as structured data, and include the manual-reset remedy.
- New test asserts the passive-green / live-fail case produces the named reason + remedy.
- Push to the branch; note it in PR #590. Keep #590 draft.
