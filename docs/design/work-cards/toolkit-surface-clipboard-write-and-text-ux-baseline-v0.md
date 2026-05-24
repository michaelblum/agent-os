# Work Card: Toolkit Surface Clipboard Write And Text UX Baseline V0

**Status:** Near-term roadmap, not yet routed

## Foreman Triage

This card captures the 2026-05-24 side-thread takeaway about AOS surface text
and clipboard behavior.

The work warrants a near-term slice because:

- the daemon currently has native-backed `clipboard.read` for AOS-hosted
  canvases in `src/daemon/unified.swift`, but no matching general
  `clipboard.write` primitive;
- `docs/api/toolkit/runtime.md` documents only clipboard read for user-initiated
  paste flows;
- several surfaces call `navigator.clipboard.writeText()` directly, which is
  not reliable in the AOS WebView permission model;
- at least some surface CSS still disables selection globally with
  `user-select: none`, so selectable text and normal text shortcuts can regress
  surface by surface.

The observed Sigil flash during `./aos ready` does not look like an
architectural leak. Current configuration can warm the status-item persistent
surface at `aos://sigil/renderer/index.html`, so a visible Sigil flash during
readiness checks is plausible. That should remain a separate follow-up: split
passive status inspection from active ready/repair/warm behavior. Do not solve
that in this clipboard/text slice unless source reading finds a tiny docs-only
clarification.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add native-backed text clipboard write support for
  user-initiated AOS surface copy actions and establish a baseline text
  selection/shortcut audit for toolkit and Sigil surfaces.
- Source artifacts:
  - `src/daemon/unified.swift`
  - `docs/api/toolkit/runtime.md`
  - `packages/toolkit/runtime/canvas.js`
  - `tests/toolkit/runtime-canvas.test.mjs`
  - `packages/toolkit/components/surface-inspector/index.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `apps/sigil/studio/js/ui.js`
  - `apps/sigil/chat/index.html`
  - `packages/toolkit/components/agent-terminal/index.html`
  - `packages/toolkit/components/agent-terminal/terminal-controller.js`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/toolkit-surface-clipboard-write-and-text-ux-baseline-v0` from
  `origin/main`. Commit and push that GDI branch when verification passes. Do
  not open a PR, merge, mutate main, mutate GitHub issues/projects, or broaden
  into `./aos ready` command redesign.

## User Baseline To Preserve

AOS surfaces should behave like normal macOS/WebView software unless a specific
surface role requires otherwise:

- selectable surface text copies normally with system shortcuts;
- editable text preserves standard cursor movement and selection shortcuts;
- surfaces with generated values, paths, JSON payloads, share URLs, or command
  snippets have a reliable clickable "copy this" path;
- terminal-specific paste handling remains terminal-scoped and does not become
  a global text UX override.

## Goal

Add a generic daemon/runtime clipboard write path:

```js
window.webkit?.messageHandlers?.headsup?.postMessage({
  type: 'clipboard.write',
  payload: {
    request_id: 'clipboard-write-1',
    text: 'text to copy',
  },
})

// inbound:
// { type: 'canvas.response', request_id: 'clipboard-write-1', status: 'ok' }
```

Then use it as the preferred AOS surface copy path where direct browser
clipboard writes are currently used or where an obvious copy button exists.

## Required Behavior

1. Daemon primitive:

   - Add inbound canvas message `clipboard.write`.
   - Accept plain text only.
   - Require `request_id`; respond to the same canvas with `canvas.response`.
   - On success, write `text` to `NSPasteboard.general` as `.string` and return
     `status="ok"`.
   - On invalid payload, respond with a deterministic error code/message.
   - Keep `clipboard.read` behavior unchanged.

2. Toolkit runtime helper:

   - Add a small JS helper, either in `packages/toolkit/runtime/canvas.js` or a
     narrow adjacent runtime module, that wraps `clipboard.write` with timeout
     and request/response behavior.
   - The helper should be intended for user-initiated click/menu/key actions.
   - Browser `navigator.clipboard.writeText()` may remain as a fallback where
     useful, but AOS-hosted surfaces should prefer the native daemon path.

3. Surface copy paths:

   - Audit obvious direct `navigator.clipboard.writeText()` call sites in
     toolkit and Sigil surfaces.
   - Move the smallest high-value call sites to the runtime helper. Expected
     candidates include Surface Inspector subject/path copy affordances, Sigil
     avatar/share JSON or URL copy affordances, and diagnostics copy buttons.
   - Do not rework unrelated UI or add new large toolbars.

4. Text selection and shortcut audit:

   - Find broad `user-select: none` / `-webkit-user-select: none` rules in
     toolkit and Sigil surfaces.
   - Narrow them to controls, drag handles, chrome, canvases, or 3D scenes where
     selection would be harmful.
   - Ensure user-visible text, transcript/log text, Markdown/HTML preview text,
     and generated snippets remain selectable unless the surface has a specific
     reason not to allow it.
   - Audit global key handlers for `preventDefault()` patterns that intercept
     common text shortcuts. Preserve app-specific commands such as save where
     intended, but do not block native cursor movement, selection, copy, paste,
     or find in editable text.

5. Agent Terminal boundary:

   - Do not undo the accepted Agent Terminal paste and wheel behavior.
   - Do not make terminal text selection/copy worse. xterm-specific selection
     behavior may remain xterm-owned.
   - If the audit finds a terminal-specific copy gap, document it as a follow-up
     unless it is a tiny isolated fix.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/work-cards/agent-terminal-paste-shortcut-live-correction-v0.md`
- `src/daemon/unified.swift`
- `packages/toolkit/runtime/canvas.js`
- `tests/toolkit/runtime-canvas.test.mjs`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/studio/js/ui.js`
- `apps/sigil/chat/index.html`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths src/daemon/unified.swift,docs/api/toolkit/runtime.md,packages/toolkit/runtime/canvas.js,tests/toolkit/runtime-canvas.test.mjs,packages/toolkit/components/surface-inspector/index.js,apps/sigil/renderer/live-modules/main.js,apps/sigil/studio/js/ui.js,apps/sigil/chat/index.html,packages/toolkit/components/agent-terminal/index.html,packages/toolkit/components/agent-terminal/terminal-controller.js
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Verification

Run focused deterministic checks for the changed files. Expected minimum:

```bash
./aos dev build
node --test tests/toolkit/runtime-canvas.test.mjs
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If Sigil renderer behavior changes, also run the relevant Sigil deterministic
tests discovered by `./aos dev recommend`.

If `./aos ready` is green after deterministic checks, run one bounded live smoke
against a throwaway surface or existing low-risk surface:

- click an updated "copy" affordance;
- verify `pbpaste` contains the expected exact text;
- confirm normal selection/copy still works in one selectable text region;
- clean up any smoke canvas created for the test.

## Hard Boundaries

- Do not redesign `./aos ready`, status-item startup, Sigil persistent surface
  configuration, or daemon warmup policy in this slice.
- Do not add broad clipboard read/write access outside AOS-hosted canvas
  request/response flow.
- Do not implement rich clipboard formats, image clipboard, file promises, or
  cross-process clipboard history.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not drive live provider sessions.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route an
  Operator run from inside the GDI round.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact `clipboard.write` request/response shape implemented;
- runtime helper name and behavior;
- surfaces moved to native-backed copy path;
- text selection/key-handler audit summary, including any blockers left as
  follow-up;
- deterministic verification commands and results;
- live smoke result or exact readiness blocker;
- statement confirming the hard boundaries were respected.
