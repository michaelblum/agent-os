# Decision Gate Component V0

## Goal

Build the `DecisionGate` Content component — the interactive panel a user sees
when an agent hits a human-in-the-loop checkpoint. This is a pure toolkit-layer
deliverable: a self-contained panel component that accepts a `GateRequest`,
renders it using the form harness and controls from the previous work slice,
collects the user's response, and writes the result to `window.__gateResult`.

Also build `createPanelWindowButton` — a panel-layer button wrapper that
covers the async in-flight, pressed-state, and window-control-variant
semantics used by close/minimize/maximize in `chrome.js`. This refactors the
three hand-rolled window buttons in the chrome to use the new control.

No daemon work. No receptor work. No CLI work.

---

## Read First

- `docs/design/user-signal-surface.md` — full gate design. The sections
  **"Architecture"**, **"Request Schema"**, **"Field Kinds"**, **"Presets"**,
  **"Response Contract"**, and **"Gate Lifecycle State Machine"** are directly
  relevant.
- `docs/design/notes/chrome-controls-audit.md` — audit that identified the
  window button gap. Read the findings table.
- `packages/toolkit/panel/chrome.js` lines ~98–157 — the three hand-rolled
  window buttons (maximize, minimize, close) you are replacing.
- `packages/toolkit/panel/form.js` — the form harness this component sits on
  top of. Read it in full.
- `packages/toolkit/controls/timer-bar.js` — will be mounted inside the gate
  chrome.
- `packages/toolkit/controls/button.js` — `createPanelWindowButton` wraps
  this. Read it.
- `packages/toolkit/panel/` — understand `mountPanel`, `Single`, and how
  existing Content components are structured. Match their conventions.
- `packages/toolkit/CLAUDE.md` — layer model. The gate is a Layer 2 Content
  component. `createPanelWindowButton` is a Layer 1b panel-layer helper.
  Neither may reach down into Layer 0 (bridge/canvas).
- `packages/toolkit/controls/defaults.css` — visual token vocabulary. All
  new styles extend this.

---

## What To Build

```
packages/toolkit/panel/
  panel-window-button.js      createPanelWindowButton — new panel-layer control

packages/toolkit/components/decision-gate/
  index.js                    DecisionGate Content factory
  index.html                  Panel entry point (mountPanel shell)
  styles.css                  Gate chrome styles
```

Plus: refactor the three hand-rolled window buttons in `chrome.js` to use
`createPanelWindowButton`.

---

## Part 1 — `panel/panel-window-button.js`

A panel-layer wrapper for window-control buttons (close, minimize, maximize).
Lives in `panel/` because its contract is panel-window-specific, not a
generic app control.

### Factory

```js
createPanelWindowButton(options) → { el, setPressed, setInFlight, setDisabled, setLabel, on, destroy }
```

### Options

```js
{
  variant,      // 'close' | 'minimize' | 'maximize' — drives CSS class
  label,        // string — aria-label and visible label text
  pressed,      // boolean — initial aria-pressed state (maximize only)
  disabled,     // boolean — initial disabled state
  onClick,      // async () => void — called on click; in-flight state managed automatically
}
```

### Behaviour

- Renders a `<button class="aos-window-button aos-window-{variant}">` — same
  classes as the current hand-rolled buttons so CSS is unchanged.
- `onClick` is an async handler. When clicked:
  1. Set `disabled = true` and add `data-in-flight` attribute.
  2. Await `onClick()`.
  3. Remove `data-in-flight` and restore `disabled = false` (unless
     `setDisabled(true)` was called explicitly during the handler).
- `setPressed(bool)` — sets `aria-pressed` and the `.pressed` CSS class.
  Used by maximize to reflect window state.
- `setInFlight(bool)` — manually drive the in-flight state when the async
  auto-management is insufficient.
- `setDisabled(bool)` — explicitly lock/unlock the button independent of
  in-flight state.
- `setLabel(str)` — updates `aria-label`, `title`, and visible label text.
- `on('click', cb)` — alternative to `onClick` option; same async contract.
- `destroy()` — removes listeners.

### `chrome.js` refactor

Replace the three hand-rolled button blocks (~lines 98–157) with
`createPanelWindowButton` calls. The rendered HTML and CSS classes must be
identical to what exists today — this is a behaviour refactor, not a visual
change. Run the existing chrome smoke tests after the refactor to confirm no
regression.

If `panel/index.js` exports panel-layer helpers, add
`createPanelWindowButton` to its exports.

---

## Part 2 — `components/decision-gate/index.js`

The Content factory. Exported as `createDecisionGate(container, options)`.

### Lifecycle

1. Parse the `GateRequest` from `options.request` or from the URL query param
   `?request=<url-encoded-json>` or `?requestB64=<base64-json>`.
2. If the preset is set, expand it to a `fields` array (see **Preset
   expansion** below).
3. Render the gate chrome: header, form, action row, timer bar.
4. Mount the form harness (`createForm`) into the form region.
5. Start the `TimerBar` countdown (if `ui.timer.visible` is true).
6. On **Submit**: validate via `form.isValid()`. If invalid, shake the action
   button and do nothing. If valid, resolve with `form.getValues()`.
7. On **Dismiss** (X button or Escape key): resolve with `null`.
8. On **Timer expiry** (`onExpire` callback from `createTimerBar`): resolve
   with `null`.
9. **Resolve** means: `window.__gateResult = JSON.stringify(value)` where
   value is the answer object or the string `"null"`. Emit a `gate:resolved`
   DOM CustomEvent on `document` with `{ detail: { value } }`.

The component must call `resolve` exactly once. After the first resolve, all
subsequent user interaction is ignored.

### Gate Chrome Structure

```html
<div class="aos-gate">
  <div class="aos-gate-header">
    <h2 class="aos-gate-title"><!-- prompt.title --></h2>
    <button class="aos-gate-dismiss" aria-label="Dismiss"><!-- × SVG --></button>
  </div>

  <!-- optional — omit entirely when prompt.body is absent/null -->
  <div class="aos-gate-body"><!-- prompt.body as plain text --></div>

  <!-- form harness mounts here -->
  <div class="aos-gate-form"></div>

  <div class="aos-gate-actions">
    <button class="aos-button primary aos-gate-submit">Submit</button>
  </div>

  <!-- omit entirely when ui.timer.visible is false/absent -->
  <div class="aos-gate-timer"></div>
</div>
```

### Preset Expansion

| Preset | Fields | Submit label |
|---|---|---|
| `yes_no_with_escape` | `exclusive_choice` (Yes / No / Something else) + conditional `text` visible when `"other"` | `"Submit"` |
| `approve_deny` | `exclusive_choice` (Approve / Deny with `danger:true`) + conditional `text` | `"Submit"` |
| `single_choice` | `exclusive_choice` using `options` from request | `"Select"` |
| `multi_choice` | `multi_choice` using `options` from request | `"Confirm"` |
| `freetext` | `text` with placeholder `"Your response..."` | `"Submit"` |

If `ui.variant` is set, expand the preset. If `ui.fields` is also set,
`ui.fields` takes precedence. If neither is set, default to `freetext`.

### Shake Animation

When Submit is pressed and `form.isValid()` is false, add `.shake` to
`.aos-gate-submit` for 400ms then remove it. Keyframe defined in `styles.css`.

### Keyboard

- `Escape` → dismiss (resolve `null`)
- `Enter` inside a text field → trigger submit handler
- `Tab` cycles through fields and action buttons

### `window.__gateResult` Protocol

```js
// Init — receptor distinguishes "not yet" from orphaned result
window.__gateResult = undefined

// User answered
window.__gateResult = JSON.stringify({ decision: 'yes', other_text: null })

// Timeout or dismiss
window.__gateResult = JSON.stringify(null)   // the string "null"
```

---

## Part 3 — `components/decision-gate/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Decision Gate</title>
  <link rel="stylesheet" href="../../controls/defaults.css">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="gate-root"></div>
  <script type="module">
    import { createDecisionGate } from './index.js';

    window.__gateResult = undefined;

    const params = new URLSearchParams(location.search);
    let request  = null;
    try {
      if (params.has('requestB64')) {
        request = JSON.parse(atob(params.get('requestB64')));
      } else if (params.has('request')) {
        request = JSON.parse(decodeURIComponent(params.get('request')));
      }
    } catch (e) {
      window.__gateResult = JSON.stringify(null);
    }

    if (request) {
      createDecisionGate(document.getElementById('gate-root'), { request });
    } else if (window.__gateResult === undefined) {
      window.__gateResult = JSON.stringify(null);
    }
  </script>
</body>
</html>
```

---

## Part 4 — `components/decision-gate/styles.css`

Use `--aos-control-*` tokens. Do not hardcode colors.

- `.aos-gate` — outer surface: flex column, `gap: 16px`, `padding: 20px`,
  `background: var(--aos-control-bg-base)`, `border-radius: 8px`,
  `box-shadow: 0 8px 32px rgba(0,0,0,0.4)`. Min-width 320px, max-width 520px.
- `.aos-gate-header` — flex row, `align-items: flex-start`,
  `justify-content: space-between`, `gap: 12px`.
- `.aos-gate-title` — `font-size: 15px; font-weight: 600; line-height: 1.3;
  color: var(--aos-control-text-primary); margin: 0`.
- `.aos-gate-dismiss` — ghost icon button, `width: 24px; height: 24px;
  flex-shrink: 0; padding: 0; opacity: 0.5`. Hover → `opacity: 1`.
  Extends `.aos-button.ghost` — size constraint only.
- `.aos-gate-body` — `font-size: 13px; color: var(--aos-control-text-muted);
  line-height: 1.5; white-space: pre-wrap`.
- `.aos-gate-form` — flex column, `gap: 10px`.
- `.aos-gate-actions` — flex row, `justify-content: flex-end`, `gap: 8px`,
  `padding-top: 4px`.
- `.aos-gate-timer` — `padding-top: 4px`.
- `@keyframes gate-shake` — `0%,100%{transform:translateX(0)}
  20%{transform:translateX(-6px)} 40%{transform:translateX(6px)}
  60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}`
- `.aos-gate-submit.shake` — `animation: gate-shake 0.4s ease`.
- `body` — `margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; background: rgba(0,0,0,0.5)`.

---

## Tests

### `tests/toolkit/panel-window-button.test.mjs`

1. Returns `{ el, setPressed, setInFlight, setDisabled, setLabel, on, destroy }`.
2. `el` is a `<button>` with class `aos-window-button` and `aos-window-{variant}`.
3. `setPressed(true)` sets `aria-pressed="true"` and `.pressed` class;
   `setPressed(false)` removes both.
4. `setDisabled(true)` sets `disabled`; `setDisabled(false)` clears it.
5. `setLabel('foo')` updates `aria-label`, `title`, and text content.
6. Clicking the button when an async `onClick` is provided: button gains
   `data-in-flight` during the async call and loses it after resolution.
7. `destroy()` removes listeners without throwing.

### `tests/toolkit/decision-gate.test.mjs`

1. **Renders title** — `.aos-gate-title` text matches `prompt.title`.
2. **Body omitted when null** — no `.aos-gate-body` in DOM when absent.
3. **Preset: yes_no_with_escape** — button-group with three options; text
   field hidden initially.
4. **Conditional reveal** — setting button-group to `"other"` shows text
   field.
5. **Submit resolves** — freetext preset, set value, trigger submit →
   `window.__gateResult` is a JSON string of field values.
6. **Dismiss resolves null** — clicking `.aos-gate-dismiss` →
   `window.__gateResult === JSON.stringify(null)`.
7. **Idempotent resolve** — dismiss after resolved gate does not overwrite
   result.
8. **Invalid submit does not resolve** — empty required field, submit pressed
   → `window.__gateResult` remains `undefined`.
9. **Timer expiry resolves null** — short `timeout_ms`, advance fake time →
   result set to null sentinel.
10. **Approve/deny preset** — Deny option carries danger styling.

---

## Verification

```bash
# Syntax check
node --check packages/toolkit/panel/panel-window-button.js
node --check packages/toolkit/components/decision-gate/index.js

# New tests
node --test \
  tests/toolkit/panel-window-button.test.mjs \
  tests/toolkit/decision-gate.test.mjs

# Full toolkit regression
node --test \
  tests/toolkit/controls-button.test.mjs \
  tests/toolkit/controls-button-group.test.mjs \
  tests/toolkit/controls-toggle.test.mjs \
  tests/toolkit/controls-text-field.test.mjs \
  tests/toolkit/controls-checkbox-group.test.mjs \
  tests/toolkit/controls-timer-bar.test.mjs \
  tests/toolkit/controls-select.test.mjs \
  tests/toolkit/form.test.mjs \
  tests/toolkit/surface-inspector.test.mjs

git diff --check
```

Do not run `./aos ready` — no daemon integration in this slice.

---

## Git

Follow the active workflow profile in `docs/dev/active-profile.json` and
`docs/dev/workflow-profiles.json`. This work is small and incremental, but do
not assume direct-to-main behavior unless the active profile or Foreman dispatch
explicitly allows it.

- Make **one commit per logical unit**: `panel-window-button.js` + its test,
  the `chrome.js` refactor, and the decision-gate component + its tests may
  each be their own commit or combined if the diff is clean. Use judgment —
  prefer atomic commits over one giant squash.
- Commit message format: `<type>(<scope>): <short description>`
  - `feat(toolkit): add createPanelWindowButton panel-layer control`
  - `refactor(toolkit): use createPanelWindowButton in chrome.js`
  - `feat(toolkit): add decision-gate component`
- Do **not** add `Co-Authored-By`, `Generated with`, or any AI attribution
  trailer to commit messages.
- After all commits: `git push origin main`.
- Confirm the push succeeded and include the final commit SHA(s) in the
  Completion Report.

---

## Completion Report

Report:

- Files created or modified
- Test results (pass count per file)
- Final commit SHA(s) and confirmation that `origin/main` is up to date
- Any deviation from this spec and why
- Any open question for the next work card (LocalCanvas receptor)
