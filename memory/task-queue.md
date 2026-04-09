# Task Queue

## Active
(none)

## Queued
- **StatusItemManager ↔ Sigil coordination**: Menu bar toggle creates/removes avatar canvas independently of Sigil. Need to reconcile so Sigil detects externally-created canvas or the toggle starts/stops Sigil.
- **Radial menu reimplementation**: Port radial menu from old avatar.html to celestial live renderer. Concepts and logic preserved in old file.
- **Studio WKWebView bundling**: Low priority — content server mostly solves this.
## Done

### chat-integration (2026-04-08)
Chat canvas bidirectional messaging.

- Unlocked free-form input (always enabled, not gated on AskUserQuestion)
- Split emit into `response` (tool use answer) and `user_message` (unprompted input)
- Added stop button with `stop` emit for agent interruption
- Documented chat canvas protocol in `apps/sigil/CLAUDE.md`

### post-merge-cleanup (2026-04-08)
Remove side-eye remnants after merge into aos.

**Commits:** `b5f7d51` → `7c42a7b` (2 commits)

- Migrated `zones.json` from `~/.config/side-eye/` to mode-scoped `~/.config/aos/{mode}/zones.json` with auto-migration on first load
- Added `~/.config/side-eye/` removal to `aos reset`
- Removed 12 stale side-eye references across 7 source files (comments, help text, MARK labels)
- 4 remaining `side-eye` references are functional (migration path + reset cleanup)

### packaging (2026-04-08)
`package.sh` — self-contained AOS.app bundling.

**Commits:** `c4229de` → `3fa2a98` (2 commits)

- `package.sh` builds both binaries (aos + avatar-sub), assembles `.app` bundle with web assets (42 files: sigil renderer/studio/chat + toolkit components), writes Info.plist, ad-hoc codesigns (inside-out), installs to `~/Applications/AOS.app`
- Trap cleanup on failure, rsync prune empty dirs, daemon stop before replace
- Sentinel check + codesign verified passing

### sdk-tests-and-settings (2026-04-08)
SDK proxy tests, settings panel wiring, display behavior tests.

**Commits:** `9796c98` → `e8b6b92` (2 commits)

**Tests:**
- 15 proxy unit tests: normalizeWindow (6 cases), overlay positioning (3), clickElement error paths (5), waitFor timeout (1)
- `test-display-behaviors` saved script: 8 integration tests (canvas CRUD, duplicate rejection, showOverlay idempotency, updateOverlay speed, near positioning)
- Total: 53 passing gateway tests

**Settings panel wired:**
- Swift: `get_config` / `set_config` IPC handlers in canvas onMessage (safe — uses loadConfig/saveConfig, not exitError)
- JS: studio loads config on open, sends changes on toggle. Voice + Visual Feedback controls live.
- Requires daemon restart to pick up new binary.

**Gateway infra:** dist watcher changed from auto-exit to log-only (was killing MCP during test builds)

### sdk-layer-3-and-proxy-fixes (2026-04-08)
Layer 3 saved workflows, proxy normalization, and updateOverlay.

**Commits:** `8061d61` → `9796c98` (1 commit)

**Scripts saved to registry (4 total):**
- `whats-on-screen` — perceive + format + post to coordination (274ms)
- `show-and-clean-up` — overlay lifecycle: create → work → updateOverlay → auto-dismiss (5.4s)
- `self-check` — (existing) runtime health check
- `list-windows` — (existing) window enumeration

**Proxy fixes:**
- Normalized raw CLI data to match SDK types (window.app_name → app, window.bounds → frame)
- perceive() reduced from 4 CLI calls to 1
- showOverlay handles DUPLICATE_ID idempotently (remove + retry)
- findWindow/showOverlay positioning fixed (was accessing wrong properties)

**New SDK method:** `updateOverlay(id, { content, style, ttl })` — 288ms vs 3-8s for remove+recreate

**Gateway infra:** dist/ watcher auto-exits on rebuild so Claude Code restarts with new code

### sdk-layer-1-2-and-infra (2026-04-08)
SDK expansion, project hooks, and codebase cleanup.

**Commits:** `18eb160` → `6dbd4e6` (9 commits)

**SDK (4 → 21 methods):**
- Layer 1: getCursor, capture, getDisplays, type, createCanvas, removeCanvas, evalCanvas, updateCanvas, listCanvases, doctor, getConfig, setConfig
- Layer 2: perceive, findWindow, clickElement, waitFor, showOverlay
- Self-check script saved to registry and tested end-to-end
- Philosophy doc + first-scripts design sketches at `docs/sdk-philosophy.md`, `docs/sdk-first-scripts.md`

**Project hooks (.claude/settings.json):**
- SessionStart: task queue + aos doctor + git state injected into every session
- SessionStart: git health warnings (unpushed commits, stale worktrees, suspect untracked files)
- PreToolUse: blocks destructive bash commands, blocks committing secrets/large files/artifacts

**Cleanup:**
- Deleted packages/heads-up/ (absorbed into unified binary)
- Updated 6 CLAUDE.md files + ARCHITECTURE.md to remove stale heads-up references
- Removed sspeak artifacts (command, hook, codex dir)
- Updated 2 memory files (gateway test count, studio runtime model)
- Pruned stale worktrees, gitignored workspace files
- Unloaded installed-mode daemon (avoid confusion with repo-mode)
- Ran `aos permissions setup --once` for repo mode

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
