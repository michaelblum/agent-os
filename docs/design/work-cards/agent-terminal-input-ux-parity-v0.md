# Agent Terminal Input UX Parity V0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Tracker

User-reported Agent Terminal input defect on 2026-05-24 after the live Codex
proof:

- `Ctrl+V` paste does not enter clipboard text into the Agent Terminal compose.
- right-click context menu paste does not work in the terminal pane.
- mouse-wheel scrolling while the compose is focused inserts visible terminal
  escape text such as `^[[A`, `^[OA`, and `^[[B` into the compose instead of
  scrolling terminal output.

The current Agent Terminal is a WebView/xterm.js surface connected to a PTY over
WebSocket. It is not a native Terminal.app/iTerm window, so expected terminal
input behavior must be wired explicitly in the toolkit component.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider session, transcript state, or prior live proof state. Read and
rediscover before editing.

## Goal

Make the Agent Terminal terminal pane handle paste and mouse-wheel input in a
human-expected way while preserving the PTY/WebSocket bridge contract and real
TUI mouse-input support where it is intentionally active.

This is a focused frontend/controller UX correction. Do not broaden into bridge
server behavior, provider catalogs, AFK orchestration, live provider runs, or
terminal lifecycle changes.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `4e2c829035c82ba05ff6d1483f0cdb589ca9ccd0` or later with this work card
- output_branch: `implementer/agent-terminal-input-ux-parity-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/terminal-controller.js`
- `tests/renderer/agent-terminal-terminal-controller.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-bridge-client.test.mjs`
- `docs/design/work-cards/toolkit-agent-terminal-terminal-controller-v0.md`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos dev recommend --json --files \
  packages/toolkit/components/agent-terminal/index.html \
  packages/toolkit/components/agent-terminal/terminal-controller.js \
  tests/renderer/agent-terminal-terminal-controller.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs
```

This slice is deterministic. Live AOS is useful only as optional final smoke
evidence after deterministic tests pass.

## Existing Code To Inspect

- `packages/toolkit/components/agent-terminal/index.html` currently creates the
  xterm instance and wires `terminal.onData((data) => {
  terminalController.forwardInput(data); })`.
- `packages/toolkit/components/agent-terminal/terminal-controller.js` currently
  owns xterm defaults, attach/detach handling, resize frames, launch status, and
  raw input forwarding.
- `tests/renderer/agent-terminal-terminal-controller.test.mjs` currently proves
  defaults and raw input forwarding but has no paste, context-menu, or wheel
  behavior coverage.
- xterm public APIs available in the vendored typings include
  `terminal.paste(data)`, `terminal.attachCustomKeyEventHandler(...)`,
  `terminal.attachCustomWheelEventHandler(...)`, and
  `terminal.modes.mouseTrackingMode`.

## Required Behavior

1. Paste works when the terminal pane is focused.

   - Host paste shortcuts should enter clipboard text into the PTY exactly
     once. On macOS this must include `Meta+V`; when the WebView/browser
     delivers `Ctrl+V` as paste, support that path too.
   - Native DOM `paste` events over the terminal must be handled.
   - Prefer `terminal.paste(text)` when available so xterm preserves bracketed
     paste behavior. Use a narrow fallback only if needed for testability or
     unsupported terminal fakes.
   - Do not double-send paste text when both a key event and a paste event fire.

2. A user-visible right-click paste path exists in the terminal pane.

   - If the platform's native WebView context menu can expose Paste reliably,
     wire to it and prove the event path deterministically.
   - If not, add a minimal toolkit-owned context menu or paste affordance scoped
     to the terminal pane. It should read the clipboard only from a user gesture
     and should fail quietly if the platform denies clipboard read access.
   - Do not make the sessions rail or inspector consume terminal paste events.

3. Mouse wheel defaults to scrollback behavior instead of raw compose input.

   - Wheel input over the terminal should scroll terminal output/scrollback by
     default and must not inject visible escape sequences such as `^[[A`,
     `^[OA`, or `^[[B` into the PTY compose in normal terminal/log-review use.
   - Use xterm's public wheel hook or a similarly narrow terminal-pane event
     handler to make the policy explicit.
   - Preserve deliberate application mouse support when xterm reports an active
     mouse tracking mode through `terminal.modes.mouseTrackingMode !== 'none'`.
     If implementation must choose between full TUI mouse fidelity and avoiding
     raw escape injection, prefer avoiding raw compose corruption for this V0 and
     report the tradeoff clearly.

4. Keep the bridge and backend contract unchanged.

   - Ordinary typing and non-paste terminal data still flow through
     `terminalController.forwardInput(data)` only while the WebSocket is open.
   - Resize, attach/detach, launch, provider session rail, inspector, bridge
     server routes, and terminal manager behavior remain unchanged.

## Suggested Implementation Areas

- Add small helper functions in
  `packages/toolkit/components/agent-terminal/terminal-controller.js`, for
  example:
  - terminal paste dispatch that uses `terminal.paste(text)`;
  - key/paste event handling registration;
  - wheel handling policy that can be unit-tested with fake terminal objects.
- Keep DOM-specific mounting in `index.html` when it needs real elements.
- Add a small scoped context-menu element in `index.html` only if xterm/native
  handling cannot satisfy right-click paste.
- Update `tests/renderer/agent-terminal-terminal-controller.test.mjs` with fake
  terminal event hooks rather than launching AOS or a WebView.
- Update `tests/renderer/agent-terminal-chrome.test.mjs` only for static
  assertions that `index.html` consumes the new helper/mount path.

## Hard Boundaries

- Do not change `bridge-server.mjs`, `terminal-session-manager.mjs`,
  `provider-session-routes.mjs`, `bridge-observation-routes.mjs`, or
  `pty-proxy.py`.
- Do not change AFK launch, AFK scheduler, provider catalog, provider transcript,
  session inspector server, or live provider store behavior.
- Do not launch Codex, Claude Code, Gemini, tmux, or live provider sessions for
  required evidence.
- Do not read provider transcript bodies.
- Do not add broad keyboard remapping outside the Agent Terminal pane.
- Do not remove raw `onData` forwarding for ordinary terminal input.

## Verification

Run:

```bash
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

Optional live smoke, only after deterministic tests pass and only if
`./aos ready` reports ready:

1. Launch or reuse an Agent Terminal surface with no sensitive provider
   transcript content.
2. Click the terminal pane and verify paste enters text once.
3. Verify right-click paste works or reports the exact platform denial.
4. Wheel over terminal output and confirm no `^[[A`, `^[OA`, or `^[[B` text is
   inserted into the compose.

If live readiness is blocked by repo-mode TCC/input-tap permissions, run:

```bash
the manual TCC blocker report path
```

Then stop with a `manual_intervention` report instead of retrying live checks. After
the human returns, run `./aos ready --post-permission`.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- how paste is handled, including shortcut, DOM paste event, and right-click
  path;
- how wheel input is handled and whether active TUI mouse tracking is preserved;
- confirmation that ordinary typing/input forwarding and bridge backend behavior
  remain unchanged;
- verification commands and pass/fail results;
- optional live smoke result or skipped reason;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation, especially if full TUI mouse parity needs
  a separate slice.
