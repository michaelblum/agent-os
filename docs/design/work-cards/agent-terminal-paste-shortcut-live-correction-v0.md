# Agent Terminal Paste Shortcut Live Correction V0

## Recipient

Implementer

## Transfer Kind

Correction round

## Tracker

Correction after accepting `implementer/agent-terminal-input-ux-parity-v0`.

Accepted commit on `main`:

- `b24923ebb33bf29bb042eb1f9a5cf9da6fdc5117`
- `fix(agent-terminal): handle paste and wheel input`

Foreman ran a live headed smoke on 2026-05-24 against a throwaway generic Agent
Terminal canvas and found that right-click paste and wheel behavior improved,
but keyboard shortcut paste still does not work in the live WebView.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider session, transcript state, or prior live proof state. Read and
rediscover before editing.

## Goal

Correct Agent Terminal shortcut paste behavior after the live WebView smoke
showed that the current key-handler path can suppress native paste without
successfully reading clipboard text.

Keep the already-working right-click paste and wheel scrollback behavior.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `b24923ebb33bf29bb042eb1f9a5cf9da6fdc5117` or later with this work card
- output_branch: `implementer/agent-terminal-paste-shortcut-live-correction-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/agent-terminal-input-ux-parity-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/terminal-controller.js`
- `tests/renderer/agent-terminal-terminal-controller.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`

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

## Live Evidence From Foreman

Foreman opened a separate smoke terminal, not a provider session:

```bash
PORT=17764 \
CANVAS_ID=aos-agent-terminal-input-smoke \
SESSION=input-ux-smoke \
BRIDGE_SESSION=aos-agent-bridge-input-smoke \
AGENT_COMMAND='bash --noprofile --norc' \
  packages/toolkit/components/agent-terminal/launch.sh --restart
```

Then Foreman populated scrollback through the bridge:

```bash
curl -fsS -H 'content-type: application/json' \
  -d '{"session":"input-ux-smoke","text":"yes scroll-smoke | head -80"}' \
  http://127.0.0.1:17764/input
```

Observed live behavior:

- `Ctrl+V` through `./aos do key ctrl+v` did not paste
  `paste-smoke-token`; the PTY snapshot showed raw prompt text `iokjh b`.
- `Cmd+V` through `./aos do key cmd+v` also did not paste
  `paste-smoke-token`; the snapshot still lacked the token.
- right-click terminal menu paste did work; the snapshot showed
  `right-menu-paste-token` at the bash prompt.
- mouse wheel over the terminal did not add new escape text to the PTY snapshot.

Working hypothesis to verify, not blindly assume:

- `createTerminalInputPolicy.handleKeyEvent()` prevents the paste shortcut
  default and then relies on `navigator.clipboard.readText()`.
- In the AOS WebView, clipboard read can be denied or unavailable for keyboard
  shortcut handling, so the handler may suppress the native DOM paste path and
  produce no paste.
- `Ctrl+V` may also arrive with a keyboard-event shape that does not match the
  current `event.key === 'v'` assumption under live CGEvent/WebView delivery.

## Required Behavior

1. Keyboard paste shortcuts must work in the live Agent Terminal WebView.

   - `Cmd+V` must paste clipboard text into the PTY once.
   - `Ctrl+V` should paste clipboard text when the platform delivers it as a
     paste shortcut. If clipboard access is unavailable, do not forward raw
     control characters or layout-dependent garbage into the PTY.
   - Do not break native DOM paste events.
   - Do not double-send paste text when both a key event and a paste event fire.

2. Do not regress the accepted behavior from
   `agent-terminal-input-ux-parity-v0`.

   - right-click terminal-scoped Paste menu keeps working;
   - wheel input over normal terminal output scrolls scrollback and does not
     inject `^[[A`, `^[OA`, `^[[B`, or similar raw text into the compose;
   - active xterm mouse tracking remains handled according to the accepted
     policy unless live evidence proves that policy is the cause of prompt
     corruption.

3. Keep backend and bridge behavior unchanged.

   - Do not change `bridge-server.mjs`, `terminal-session-manager.mjs`,
     `provider-session-routes.mjs`, `bridge-observation-routes.mjs`, or
     `pty-proxy.py`.
   - Ordinary non-paste `terminal.onData(...)` input still forwards through
     `terminalController.forwardInput(data)`.

## Suggested Implementation Areas

- `packages/toolkit/components/agent-terminal/terminal-controller.js`
  - Reconsider whether `Meta+V` should be intercepted at keydown at all.
  - If a shortcut handler attempts async clipboard read, ensure denied clipboard
    access does not block the native paste event path.
  - Add tests for clipboard read rejection/unavailability and for the chosen
    fallback behavior.
- `packages/toolkit/components/agent-terminal/index.html`
  - Adjust mounting only if the terminal element/textarea needs the paste event
    listener in a different place.
- `tests/renderer/agent-terminal-terminal-controller.test.mjs`
  - Add coverage that failed clipboard reads do not swallow native paste.
  - Add coverage that the Ctrl+V fallback does not forward raw input when paste
    cannot be performed.

## Hard Boundaries

- Do not launch Codex, Claude Code, Gemini, or a real provider session for
  required evidence.
- Do not read provider transcript bodies.
- Do not change AFK launch, AFK scheduler, provider catalog, provider transcript,
  session inspector server, live provider store, bridge server routes, terminal
  manager, or pty proxy behavior.
- Do not undo the accepted right-click Paste menu or wheel handling unless you
  have direct evidence that the accepted implementation caused the shortcut
  failure.

## Verification

Run deterministic checks:

```bash
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

Then run a bounded live smoke if `./aos ready` reports ready:

1. Launch a throwaway generic Agent Terminal with a plain bash command, using a
   non-default canvas id/session/port.
2. Set clipboard text with `pbcopy`.
3. Focus the terminal and verify `Cmd+V` paste lands in the PTY snapshot.
4. Verify `Ctrl+V` either pastes or does not inject raw prompt garbage.
5. Verify right-click Paste still lands in the PTY snapshot.
6. Verify mouse wheel does not inject escape text into the PTY snapshot.

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
- the root cause of the shortcut paste failure;
- how `Cmd+V`, `Ctrl+V`, DOM paste, and right-click paste behave after the fix;
- whether wheel behavior changed;
- deterministic verification commands and pass/fail results;
- live smoke commands and pass/fail results, or exact readiness blocker;
- local-only state, including smoke canvas/session/port and dirty files;
- remaining follow-up recommendation.
