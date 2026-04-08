# Task Queue

## Active
(none)

## Queued
- **Chat surface integration**: Chat canvas (`apps/sigil/chat/`) is wired to studio "Open Chat" button via daemon IPC. Next: connect to actual Claude API or agent session for real conversations. The chat.html supports full message rendering (markdown, tool cards, thinking blocks) but needs a backend.
- **Settings panel**: Stub UI in Avatar panel. Next: read config from daemon on load, write changes back via `aos set` commands. Needs daemon support for config read via IPC.
- **Test suite for display behaviors**: Canvas close handler, click-through levels (.floating vs .statusBar), single menu bar icon per mode. Currently only manual verification.
- **side-eye decision**: Absorb into aos (true single binary) or keep as bundled sub-binary? Blocks packaging fixes.
- **Packaging gaps**: Bundle side-eye + toolkit HTML into AOS.app so installed-mode commands are self-contained.
- **StatusItemManager ↔ Sigil coordination**: Menu bar toggle creates/removes avatar canvas independently of Sigil. Need to reconcile so Sigil detects externally-created canvas or the toggle starts/stops Sigil.
- **Radial menu reimplementation**: Port radial menu from old avatar.html to celestial live renderer. Concepts and logic preserved in old file.
- **Studio WKWebView bundling**: Studio mode uses ES modules — needs same single-file bundling as live if it ever runs inside a canvas instead of a browser.

## Done

### stabilize-and-wire-ui (2026-04-08)
Runtime stabilization, studio cleanup, and chat surface wiring.

**Commits:** `69425e6` → `bfa0565` (3 commits)

**Fixed:**
- Killed duplicate repo-mode `aos serve` processes (cause of two menu bar icons)
- Installed repo-mode launch agent via `aos service install --mode repo`
- Canvas close handler catches `{action: "close"}` from JS — studio X button and ESC now work
- Interactive canvases use `.floating` level; overlays use `.statusBar` (proper click-through)
- `NSApp.setActivationPolicy(.accessory)` for key window ownership

**Studio cleanup:**
- Removed dead imports (pathing, swarm, grid3d) from ui.js
- Removed dead context menu proxy bindings (swarm, path, grid, ortho, fov)
- Removed dead randomization for removed controls
- Confirmed HTML reorganization (Tasks 1-7) was already done in prior session

**New:**
- Chat surface copied to `apps/sigil/chat/index.html` (served via content server)
- "Open Chat" button in Avatar panel creates chat canvas via daemon IPC
- Settings stub in Avatar panel (voice, visual feedback toggles)
- "Surfaces" section in Avatar panel for launching companion canvases

**Gateway status:** Running via MCP (`.mcp.json` → `dist/index.js`). 10 tools, tests passing, SDK complete.

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
