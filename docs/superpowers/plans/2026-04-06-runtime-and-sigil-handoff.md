# Runtime And Sigil Handoff

**Date:** 2026-04-06  
**Purpose:** fast handoff for the next session after stable runtime packaging/signing work

## Status

This document is now historical context, not the current primary orientation brief.

Use [claude_realign_brief_2026-04-06.md](/Users/Michael/Code/agent-os/memory/scratchpad/claude_realign_brief_2026-04-06.md) as the current entry point for Claude re-orientation.

The main blocker described later in this document was resolved in follow-on work:

- installed/runtime mode separation was made explicit
- runtime state was split by mode instead of sharing one bucket
- installed launch-agent targets and log paths were realigned
- permission onboarding now records a runtime-specific marker
- installed `aos permissions preflight --json` now reports `ready_for_testing: true`
- installed `aos doctor --json` now reports `status: ok`

Read this document for chronology and original debugging context, not as the latest statement of repo/runtime status.

## Current Verified State

### Stable AOS Runtime

- `AOS.app` is installed at:
  - `/Users/Michael/Applications/AOS.app`
- Bundle ID:
  - `com.agent-os.aos`
- Runtime signing is now real Apple Development signing, not ad hoc.
- Verified signer:
  - `Apple Development: michaelb@symphonytalent.com (X43VG96N64)`
- Verified team identifier:
  - `4J2A2L5VT5`

### Live Status At Handoff

Originally verified with:

```bash
./aos runtime status --json
./aos service status --json
```

Earlier observed state:

```json
{
  "build_version": "2026.04.06.022719",
  "bundle_id": "com.agent-os.aos",
  "installed": true,
  "notes": [],
  "path": "/Users/Michael/Applications/AOS.app",
  "signed": true,
  "signing_identity": "Apple Development: michaelb@symphonytalent.com (X43VG96N64)",
  "status": "ok",
  "team_identifier": "4J2A2L5VT5",
  "version": "0.1.0"
}
```

```json
{
  "binary_path": "/Users/Michael/Applications/AOS.app/Contents/MacOS/aos",
  "installed": true,
  "launchd_label": "com.agent-os.aos",
  "log_path": "/Users/Michael/.config/aos/daemon.log",
  "notes": [],
  "pid": 1244,
  "plist_path": "/Users/Michael/Library/LaunchAgents/com.agent-os.aos.plist",
  "running": true,
  "status": "ok"
}
```

## Updated State After Packaged Sigil Cutover

- `AOS.app` is still installed at:
  - `/Users/Michael/Applications/AOS.app`
- Current packaged runtime build:
  - `2026.04.06.043038`
- `launchctl print gui/$(id -u)/com.agent-os.aos` shows:
  - `program = /Users/Michael/Applications/AOS.app/Contents/MacOS/aos`
- `launchctl print gui/$(id -u)/com.agent-os.sigil` shows:
  - `program = /Users/Michael/Applications/AOS.app/Contents/MacOS/avatar-sub`
  - `working directory = /Users/Michael/Applications/AOS.app/Contents/Resources/agent-os/apps/sigil`
- The earlier raw repo-local Sigil / `OS_REASON_ENDPOINTSECURITY` issue is fixed.

## New Work Landed

### Permission Setup Flow

`aos` now has an interactive packaged-runtime setup flow:

- `aos permissions setup`
- `aos permissions setup --json`

Implementation is in:

- `src/commands/operator.swift`
- `src/main.swift`

Behavior:

- prompts for Accessibility and Screen Recording in sequence
- writes a marker file at:
  - `~/.config/aos/permissions-onboarding.json`
- kickstarts:
  - `com.agent-os.aos`
  - `com.agent-os.sigil`

### Sigil Local Interaction Fallback

Sigil now has a canvas-local fallback path so direct interactions do not rely entirely on daemon `input_event`s:

- transparent interactive avatar hit target:
  - `apps/sigil/avatar-hit-target.html`
- local avatar event handling:
  - `apps/sigil/avatar-sub.swift`
- packaged resource lookup / bundled-runtime support:
  - `apps/sigil/avatar-ipc.swift`
- chat dot emits local avatar toggle:
  - `tools/dogfood/chat.html`
- dock/undock keeps the hit target in sync:
  - `apps/sigil/avatar-behaviors.swift`
- packaged runtime now bundles the hit-target resource:
  - `scripts/package-aos-runtime`

## Historical Blocker

The system is now in a contradictory runtime state after install and the guided permission flow:

1. `aos permissions setup --json` returned success from inside packaged `AOS.app`:
   - `accessibility: true`
   - `screen_recording: true`
   - services restarted

2. But a fresh CLI check immediately afterward still reports both as false:

```json
{
  "permissions": {
    "accessibility": false,
    "screen_recording": false
  },
  "status": "degraded"
}
```

3. `launchctl` shows `com.agent-os.aos` running from packaged `AOS.app`, but:
   - `aos doctor --json` still reports:
     - daemon not running
     - socket unreachable
   - `apps/sigil/sigilctl state` still reports:
     - avatar canvas is not present
   - `~/.config/aos/sigil.log` shows repeated:
     - `event-stream: connection lost, reconnecting...`
     - `event-stream: daemon unavailable, retrying ...`

At the time of this handoff, the remaining blocker appeared to be:

- permission identity reporting inconsistency between the interactive setup flow and fresh CLI invocations
- packaged `aos serve` runtime/socket instability after restart

## Native Runtime Surface Added

`aos` now has a native runtime control surface:

- `aos runtime status --json`
- `aos runtime path`
- `aos runtime install [--json]`
- `aos runtime sign`

Relevant implementation:

- `src/commands/runtime.swift`
- `src/main.swift`
- `scripts/install-aos-runtime`
- `scripts/package-aos-runtime`
- `scripts/sign-aos-runtime`
- `scripts/aos-runtime-status`

## Important Debugging Outcome

The earlier signing failure was **not** a packaging bug.

Root causes found and resolved:

1. The old self-signed cert `MBSelfSignedCodeCert` was expired.
2. The Apple Development cert initially showed as untrusted because the WWDR chain was not recognized.
3. `codesign` also needed explicit keychain access approval to the Apple Development private key.
4. After WWDR trust was present and key access was granted with **Always Allow**, `codesign` could use the Apple Development cert successfully.

## What The Next Session Should Do

### Primary Target

Debug the packaged runtime identity/runtime-health inconsistency before further UX work.

### Recommended Next Slice

1. Reproduce the contradiction between:
   - `aos permissions setup --json`
   - fresh `aos permissions check --json`

2. Determine whether direct CLI execution of `/Users/Michael/Applications/AOS.app/Contents/MacOS/aos` is being evaluated under a different TCC identity than the interactive packaged app flow.

3. Debug why packaged `aos serve` is alive under launchd but the socket is not staying reachable:
   - `aos doctor --json`
   - `aos show list`
   - `launchctl print gui/$(id -u)/com.agent-os.aos`
   - `tail -n 200 ~/.config/aos/daemon.log`

4. Once the packaged daemon is stable, re-check Sigil:
   - `apps/sigil/sigilctl status`
   - `apps/sigil/sigilctl state`
   - `tail -n 200 ~/.config/aos/sigil.log`

5. Only after that, verify the local interaction fallback behavior:
   - avatar click / drag via `avatar-hit-target.html`
   - chat dot dock / undock via `avatar_toggle`

### Secondary Cleanup

- `scripts/aos-runtime-status` was fixed to report the actual Apple Development signer.
- `aos service install`/`start` wrappers still have some UX rough edges from earlier review history; functionality is currently correct, but command ergonomics may still deserve a cleanup pass later.

## Working Tree Caveat

This repo is still in a dirty state with many modified/untracked files. Do **not** assume a clean branch boundary.

Before large follow-on work, the next session should explicitly inspect:

```bash
git status --short
```

and decide whether to:

- continue in place
- isolate work on a branch
- or checkpoint current changes first

## Superseded New-Session Prompt

```text
Read docs/superpowers/plans/2026-04-06-runtime-and-sigil-handoff.md first, then inspect git status and debug the packaged AOS.app runtime inconsistency: `aos permissions setup --json` reports permissions granted, but fresh `aos permissions check --json` and `aos doctor --json` still report missing permissions and an unreachable daemon socket, which is keeping Sigil disconnected.
```

That prompt is no longer current because the runtime inconsistency it describes was resolved later.
