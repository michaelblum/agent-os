# Task Queue

## Active
(none)

## Queued
- **side-eye decision**: Absorb into aos (true single binary) or keep as bundled sub-binary? Blocks packaging fixes.
- **Packaging gaps**: Bundle side-eye + toolkit HTML into AOS.app so installed-mode commands are self-contained.
- **StatusItemManager ↔ Sigil coordination**: Menu bar toggle creates/removes avatar canvas independently of Sigil. Need to reconcile so Sigil detects externally-created canvas or the toggle starts/stops Sigil.
- **Radial menu reimplementation**: Port radial menu from old avatar.html to celestial live renderer. Concepts and logic preserved in old file.
- **Studio WKWebView bundling**: Studio mode uses ES modules — needs same single-file bundling as live if it ever runs inside a canvas instead of a browser.

## Done

### shared-ipc-runtime-testing (2026-04-05)
Runtime verification of shared IPC library migration (15 commits, `3310f0c` → `9028c3b`).

**Results:**
- `aos serve` — PASS: daemon starts, socket at `~/.config/aos/repo/sock`
- `aos log` (stream) — PASS: reads stdin, connection-scoped canvas, cleanup on EOF
- `aos log push` / `aos log clear` — PASS: one-shot commands return ok
- `aos inspect` — PASS: connection-scoped canvas, event loop, cleanup on kill
- `avatar-sub` (Sigil) — PASS after fix: envelope schema mismatch in `onMessage` handler

**Bug fixed:** avatar-sub `onMessage` still parsed old `heads-up serve` relay format (`{"type":"channel",...}`). Updated to parse `aos serve` envelope format (`decodeEnvelope()` → match on `envelope.event`). File: `apps/sigil/avatar-sub.swift`.

**Not verified:** 60fps animation latency regression (requires sustained visual testing). The `sendAndReceive` drain pattern in animation loops compiled and connected; no stalls observed during possess-cursor behavior test.

### realign-and-cleanup (2026-04-06)
Re-orientation, code audit, animation fix, DRY cleanup, and launchd label isolation.

**Commits:** `78b2789` → `84acfdb` (4 commits)

**Fixed:**
- Animation jank: replaced blocking `sendAndReceive` with `sendOnly` + `drainResponses()` in 60fps loops
- `stopAOSService` missing mode parameter — restart with `--mode installed` stopped the wrong service
- Launchd labels split by mode (`com.agent-os.aos.repo`/`.installed`) — prevents cross-mode interference
- `DaemonClient.connect()` deduplicated → uses shared `connectSocket()`
- Permission dialog logic deduplicated (70 lines → shared `requestPermissionWithDialog()`)
- Launchctl helpers extracted (bootstrap/kickstart/bootout)
- Ported `StatusItemManager` from standalone heads-up to unified daemon
- Legacy `com.agent-os.heads-up` added to cleanup labels

**Docs updated:** CLAUDE.md (root, src, sigil) aligned to runtime model.

**Known gaps:** side-eye not bundled in AOS.app, toolkit HTML not staged, StatusItemManager and Sigil not coordinated.

### celestial-graft (2026-04-07)
Grafted celestial legacy (now `renderer/` + `studio/`) into Sigil. Replaced small moving NSWindow avatar with full-screen transparent canvases running celestial's Three.js renderer.

**Commits:** `91f5951` → `fba4cd1` (7 commits)

**What changed:**
- Copied celestial legacy (now `renderer/` + `studio/`) JS/CSS/HTML into `apps/sigil/celestial/` (shared modules, studio, live)
- Live renderer bundled into single HTML for WKWebView compatibility (ES modules blocked by file:// CORS)
- Swift animation layer rewired: `sendAvatarUpdate()` sends scene-position IPC instead of window-position
- Full-screen canvas creation per display at startup, multi-display handoff on boundary crossing
- Dock/undock behaviors updated: show/hide instead of create/destroy canvases
- All old small-window canvas patterns removed from radial menu, dock, undock paths
- Ghost trails verified working across full-screen canvas
- Config `toggle_url` updated to new live renderer, `toggle_at` to full display bounds

**Known gaps:** Radial menu not yet reimplemented on celestial renderer. Studio mode needs bundling if used in WKWebView. `state.idleSpinSpeed` eval calls in dock behavior reference old JS model.
