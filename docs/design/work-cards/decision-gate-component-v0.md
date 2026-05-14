# Decision Gate Component V0

## Goal

Build the `DecisionGate` Content component — the interactive panel a user sees
when an agent hits a human-in-the-loop checkpoint. This is a pure toolkit-layer
deliverable: a self-contained panel component that accepts a `GateRequest`,
renders it using the form harness and controls from the previous work slice,
collects the user's response, and writes the result to `window.__gateResult`.

No daemon work. No receptor work. No CLI work. Just the panel.

---

## Read First

- `docs/design/user-signal-surface.md` — full gate design. The sections
  **"Architecture"**, **"Request Schema"**, **"Field Kinds"**, **"Presets"**,
  **"Response Contract"**, and **"Gate Lifecycle State Machine"** are directly
  relevant.
- `packages/toolkit/panel/form.js` — the form harness this component sits on
  top of. Read it in full.
- `packages/toolkit/controls/timer-bar.js` — will be mounted inside the gate
  chrome.
- `packages/toolkit/panel/` — understand `mountPanel`, `Single`, and how
  existing Content components (`components/inspector/`, `components/log-console/`)
  are structured. Match their conventions exactly.
- `packages/toolkit/CLAUDE.md` — layer model. The gate is a Layer 2 Content
  component. It must not reach down into Layer 0 (bridge/canvas).
- `packages/toolkit/controls/defaults.css` — visual token vocabulary. Gate
  styles extend this; they do not invent a parallel system.

---

## What To Build

```
packages/toolkit/components/decision-gate/
  index.js        DecisionGate Content factory
  index.html      Panel entry point (mountPanel shell)
  styles.css      Gate chrome styles
```

---

### `components/decision-gate/index.js`

The Content factory. Exported as `createDecisionGate(container, options)`.

#### Lifecycle

1. Parse the `GateRequest` from `options.request` or from the URL query param
   `?request=<url-encoded-json>` or `?requestB64=<base64-json>`.
2. If the preset is set, expand it to a `fields` array (see **Preset expansion**
   below).
3. Render the gate chrome: header, form, action row, timer bar.
4. Mount the form harness (`createForm`) into the form region.
5. Start the `TimerBar` countdown (if `ui.timer.visible` is true).
6. On **Submit**: validate via `form.isValid()`. If invalid, shake the action
   button and do nothing. If valid, resolve with `form.getValues()`.
7. On **Dismiss** (X button or Escape key): resolve with `null`.
8. On **Timer expiry** (`onExpire` callback from `createTimerBar`): resolve with
   `null`.
9. **Resolve** means: `window.__gateResult = JSON.stringify(value)` where value
   is the answer object or the string `"null"`. Emit a `gate:resolved` DOM
   CustomEvent on `document` with `{ detail: { value } }`.

The component must call `resolve` exactly once. After the first resolve, all
subsequent user interaction is ignored (the receptor will dismiss the canvas
shortly after).

#### Gate Chrome Structure

```html
<div class="aos-gate">
  <div class="aos-gate-header">
    <h2 class="aos-gate-title"><!-- prompt.title --></h2>
    <button class="aos-gate-dismiss" aria-label="Dismiss"><!-- × SVG --></button>
  </div>

  <!-- optional body text -->
  <div class="aos-gate-body"><!-- prompt.body markdown rendered as plain text --></div>

  <!-- form harness mounts here -->
  <div class="aos-gate-form"></div>

  <div class="aos-gate-actions">
    <!-- primary submit button -->
    <button class="aos-button primary aos-gate-submit">Submit</button>
  </div>

  <!-- timer bar mounts here when ui.timer.visible -->
  <div class="aos-gate-timer"></div>
</div>
```

The body element is omitted from the DOM entirely when `prompt.body` is absent
or null. The timer region is omitted when `ui.timer.visible` is false or absent.

#### Preset Expansion

Presets expand to a `fields` array and a submit button label. Implement these
five presets as pure data — a plain object map is fine.

| Preset | Fields | Submit label |
|---|---|---|
| `yes_no_with_escape` | `exclusive_choice` (Yes/No/Something else) + conditional `text` (visible when `other`) | `"Submit"` |
| `approve_deny` | `exclusive_choice` (Approve/Deny) with `danger: true` on Deny option + conditional `text` | `"Submit"` |
| `single_choice` | `exclusive_choice` using `options` from request | `"Select"` |
| `multi_choice` | `multi_choice` using `options` from request | `"Confirm"` |
| `freetext` | `text` with placeholder `"Your response..."` | `"Submit"` |

If `ui.variant` is set, expand the preset. If `ui.fields` is also set,
`ui.fields` takes precedence (preset expansion is ignored). If neither is set,
render a single `freetext` field as the default.

#### Shake Animation

When Submit is pressed and `form.isValid()` returns false, add the class
`.shake` to the `.aos-gate-submit` button for 400ms then remove it. Define the
CSS keyframe in `styles.css`.

#### Keyboard

- `Escape` → dismiss (resolve `null`)
- `Enter` on a text field → same as clicking Submit (call the submit handler)
- `Tab` cycles through form fields and action buttons

#### `window.__gateResult` Protocol

This is the signal the LocalCanvas receptor polls for. Write it exactly once:

```js
// User answered
window.__gateResult = JSON.stringify({ decision: 'yes', other_text: null })

// Timeout or dismiss
window.__gateResult = JSON.stringify(null)   // the string "null"
```

Set `window.__gateResult = undefined` on init so the receptor can distinguish
"not yet resolved" from a previously orphaned result.

---

### `components/decision-gate/index.html`

The entry point the LocalCanvas receptor will load.

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

    const params  = new URLSearchParams(location.search);
    let request   = null;
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

### `components/decision-gate/styles.css`

Gate chrome styles. Use `--aos-control-*` tokens from `defaults.css` — do not
hardcode colors.

Required rules:

- `.aos-gate` — the outer surface: `display: flex; flex-direction: column;
  gap: 16px; padding: 20px; background: var(--aos-control-bg-base);
  border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);`
  Min-width 320px, max-width 520px.

- `.aos-gate-header` — `display: flex; align-items: flex-start;
  justify-content: space-between; gap: 12px;`

- `.aos-gate-title` — `font-size: 15px; font-weight: 600; line-height: 1.3;
  color: var(--aos-control-text-primary); margin: 0;`

- `.aos-gate-dismiss` — icon button, `width: 24px; height: 24px; flex-shrink: 0;
  padding: 0; opacity: 0.5;` hover raises to `opacity: 1`. Use the existing
  `.aos-button.ghost` style as base — add size constraint only.

- `.aos-gate-body` — `font-size: 13px; color: var(--aos-control-text-muted);
  line-height: 1.5; white-space: pre-wrap;`

- `.aos-gate-form` — `display: flex; flex-direction: column; gap: 10px;`

- `.aos-gate-actions` — `display: flex; justify-content: flex-end; gap: 8px;
  padding-top: 4px;`

- `.aos-gate-timer` — `padding-top: 4px;`

- `@keyframes gate-shake` — horizontal shake: `0%,100%{transform:translateX(0)}
  20%{transform:translateX(-6px)} 40%{transform:translateX(6px)}
  60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}`

- `.aos-gate-submit.shake` — `animation: gate-shake 0.4s ease;`

- `body` — `margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; background: rgba(0,0,0,0.5);` (the canvas
  background is the backdrop; the panel floats centered)

---

## Tests

`tests/toolkit/decision-gate.test.mjs`

Use the shared `dom-fixture.mjs` already present in `tests/toolkit/`. Use
`node:test` and `node:assert`.

Required cases:

1. **Renders title** — `createDecisionGate` with a minimal request sets
   `.aos-gate-title` text to `prompt.title`.

2. **Body omitted when null** — when `prompt.body` is null or absent, no
   `.aos-gate-body` element is present in the DOM.

3. **Preset expansion: yes_no_with_escape** — renders a button-group with
   three options; the text field is hidden initially.

4. **Conditional field reveals** — after setting the button-group to
   `"other"`, the text field becomes visible.

5. **Submit resolves with values** — with a `freetext` preset, setting the
   text field value and triggering submit sets `window.__gateResult` to a
   JSON string containing the field values.

6. **Dismiss resolves null** — clicking `.aos-gate-dismiss` sets
   `window.__gateResult` to `JSON.stringify(null)`.

7. **Resolve is idempotent** — dismissing after an already-resolved gate does
   not overwrite `window.__gateResult`.

8. **Invalid submit does not resolve** — pressing submit on a form with an
   empty required field does not set `window.__gateResult`.

9. **Timer expiry resolves null** — create a gate with a very short
   `timeout_ms` (e.g. 50ms), advance fake time past expiry, assert
   `window.__gateResult` is set to the null sentinel.

10. **Approve/deny preset** — renders two buttons; Deny option has danger
    styling.

---

## Verification

```bash
# Syntax check
node --check packages/toolkit/components/decision-gate/index.js

# Run new tests
node --test tests/toolkit/decision-gate.test.mjs

# Regression: all prior toolkit tests still pass
node --test \
  tests/toolkit/controls-button.test.mjs \
  tests/toolkit/controls-button-group.test.mjs \
  tests/toolkit/controls-toggle.test.mjs \
  tests/toolkit/controls-text-field.test.mjs \
  tests/toolkit/controls-checkbox-group.test.mjs \
  tests/toolkit/controls-timer-bar.test.mjs \
  tests/toolkit/controls-select.test.mjs \
  tests/toolkit/form.test.mjs \
  tests/toolkit/canvas-inspector.test.mjs

git diff --check
```

Do not run `./aos ready` — no daemon integration in this slice.

---

## Completion Report

Report:

- Files created
- Test results (pass count)
- Any deviation from this spec and why
- Any open question that should feed into the next work card (LocalCanvas
  receptor)
