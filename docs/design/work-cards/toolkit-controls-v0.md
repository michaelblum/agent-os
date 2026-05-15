# Toolkit Controls V0

## Goal

Build the complete Layer 1a control vocabulary for AOS toolkit panels and the
Layer 1b form harness that sits above them. These are the foundational pieces
the DecisionGate component (and every future interactive panel) will build on.

---

## Read First

- `docs/design/user-signal-surface.md` — the gate design doc. The Controls and
  Form Harness sections (§ "Toolkit Work Required") are your spec. Read them
  carefully before writing a line of code.
- `packages/toolkit/controls/number-field.js` — the existing control. Match its
  discipline: pure behavior module, no DOM markup ownership, normal DOM events,
  no framework.
- `packages/toolkit/controls/defaults.css` — the existing visual token
  vocabulary. You will extend it, not replace it.
- `packages/toolkit/controls/AGENTS.md` — the controls package mandate.
- `packages/toolkit/CLAUDE.md` — the toolkit layer model.
- `packages/toolkit/panel/` — familiarise yourself with the panel chrome layer
  before writing `form.js`. Understand what `Single`, `SplitPane`, and the
  panel router do.

---

## Context

`controls/` currently has exactly one control: `number-field.js`. It is a
behavior wire-up module — it does not own HTML, it attaches to semantic markup
and dispatches standard DOM events. `defaults.css` already defines the visual
class vocabulary (`.aos-button`, `.aos-segmented`, `.aos-text-input`,
`.aos-toggle`, `.aos-checkbox`, `.aos-list`, `.aos-list-row`, etc.). Both files
represent deliberate, settled conventions.

**Everything is greenfield.** The prior agents who authored `defaults.css` made
reasonable visual choices. You are free to extend that CSS vocabulary, rename
awkward classes, or collapse them — but do not gratuitously diverge from the
established dark-panel token system (`--aos-control-*` variables, the
`rgba(122, 241, 255, …)` cyan accent system, the `rgba(4, 14, 18, …)` surface
palette).

---

## What To Build

### Layer 1a — Controls (`packages/toolkit/controls/`)

Each control is a focused behavior module. Pattern: export a factory function
that takes a config object and returns `{ el, getValue, setValue, on, destroy }`.
No framework. No product assumptions. Styled via `defaults.css` tokens.

#### `button.js`

Single pressable button.

- Factory: `createButton({ label, variant, disabled, onClick })`
- Variants: `primary`, `secondary`, `danger`, `ghost`
- Handles `disabled` state visually and in DOM (`aria-disabled` or `disabled`
  attribute on the underlying `<button>`)
- Active/focus feedback via CSS (`:active`, `:focus-visible`)
- Returns `{ el, setLabel, setDisabled, on('click', cb), destroy }`
- CSS class: `.aos-button` with variant modifier classes `.primary`, `.danger`,
  `.ghost` — extend `defaults.css` with the `danger` and `ghost` variants if
  they are not already present

#### `button-group.js`

Exclusive-choice control — one option selected at a time.

- Factory: `createButtonGroup({ options, value, onChange })`
  - `options`: `Array<{ value, label, danger? }>`
  - `value`: initial selected value or `null`
- Renders as `.aos-segmented` row (CSS already defined in `defaults.css`)
- Keyboard navigation: arrow keys cycle selection within the group
- ARIA: `role="group"`, each button `aria-pressed` or equivalent
- Returns `{ el, getValue, setValue, on('change', cb), destroy }`
- A `danger: true` option gets `.danger` styling on that button

#### `toggle.js`

Boolean toggle / checkbox.

- Factory: `createToggle({ label, checked, onChange })`
- Renders a custom visual switch (not a raw `<input type="checkbox">` —
  implement a CSS-driven pill toggle using a hidden checkbox for accessibility)
- Checked state updates via `setValue(bool)` and emits `change`
- Label is optional; when present it sits inline with the toggle
- Returns `{ el, getValue, setValue, on('change', cb), destroy }`
- CSS: add `.aos-toggle-switch` to `defaults.css` — pill shape, transitions
  between checked/unchecked, uses the cyan accent for the active state

#### `text-field.js`

Single-line text input.

- Factory: `createTextField({ value, placeholder, label, maxLength, onChange, onCommit })`
- `onChange` fires on every `input` event; `onCommit` fires on `blur` and `Enter`
- Validation: optional `validate(value) → string | null` config — if non-null
  string is returned, show it as an inline error state on the field
- Returns `{ el, getValue, setValue, setError, on('change', cb), on('commit', cb), destroy }`
- CSS class: `.aos-text-input` (already in `defaults.css`)
- Add an error state variant: `.aos-text-input.error` with red border and
  `.aos-field-error` for the error message element

#### `checkbox-group.js`

Multi-choice control — zero or more options selected.

- Factory: `createCheckboxGroup({ options, value, onChange })`
  - `options`: `Array<{ value, label }>`
  - `value`: `string[]` of initially selected values
- Renders a column of labelled checkboxes using `.aos-checkbox` rows
- Optional `selectAll` mode: when `options.length >= 3`, show a "Select all"
  header checkbox that sets the indeterminate state correctly
- Returns `{ el, getValue, setValue, on('change', cb), destroy }`

#### `select.js`

Single-value dropdown (native `<select>`).

- Factory: `createSelect({ options, value, label, onChange })`
  - `options`: `Array<{ value, label, disabled? }>`
- Returns `{ el, getValue, setValue, on('change', cb), destroy }`
- CSS class: `.aos-select` (already in `defaults.css`)

#### `timer-bar.js`

Depleting visual timer — used by the gate chrome but reusable anywhere a
countdown or count-up display is needed.

- Factory: `createTimerBar({ totalMs, direction, display, flashThresholdMs, flashIntervalMs, onExpire })`
  - `direction`: `'countDown'` | `'countUp'`
  - `display`: `'digital'` | `'pie'`
  - `flashThresholdMs`: when remaining time drops below this, the bar enters
    flash state (CSS class toggle, the CSS defines the animation)
  - `onExpire`: callback fired when the timer reaches zero (countDown) or
    `totalMs` (countUp)
- Methods: `start()`, `pause()`, `resume()`, `reset()`, `destroy()`
- Returns `{ el, start, pause, resume, reset, getRemainingMs, destroy }`
- The timer is driven by `requestAnimationFrame` internally — not `setInterval`.
  It is a cosmetic display only; the authoritative deadline lives in the daemon.
- **Digital display**: shows `MM:SS` or `SS.d` depending on remaining time;
  styled monospace using the existing `--font-mono` token
- **Pie display**: SVG circle with a `stroke-dashoffset` sweep animation;
  transitions smoothly, not in discrete steps
- CSS: add `.aos-timer-bar`, `.aos-timer-bar.flash`, `.aos-timer-digital`,
  `.aos-timer-pie` to `defaults.css`

#### `controls/index.js`

Re-export all controls as named exports. Update the existing `index.js`.

```js
export { createButton }        from './button.js'
export { createButtonGroup }   from './button-group.js'
export { createToggle }        from './toggle.js'
export { createTextField }     from './text-field.js'
export { createCheckboxGroup } from './checkbox-group.js'
export { createSelect }        from './select.js'
export { createTimerBar }      from './timer-bar.js'
// number-field exports remain unchanged
export * from './number-field.js'
```

---

### Layer 1b — Form Harness (`packages/toolkit/panel/form.js`)

The form harness sits between raw controls and a Content component. It
consumes a `fields[]` array (as defined in `aos.gate.request.v1`) and renders
the appropriate control for each field, tracks state, enforces `visible_when`
conditions reactively, and exposes a clean API.

```
panel/
  form.js
```

**Interface:**

```js
// Create a form bound to a container element
const form = createForm(container, fields, options)

form.getValues()        // → plain object, keyed by field id
form.isValid()          // → boolean
form.setValues(obj)     // bulk-set field values
form.focus()            // focus the first interactive field
form.on('change', cb)   // fires after any field change with current values
form.destroy()          // tear down all controls and listeners
```

**`fields` schema** (from `user-signal-surface.md`):

```json
[
  {
    "id": "decision",
    "kind": "exclusive_choice",
    "style": "buttons",
    "options": [{ "value": "yes", "label": "Yes" }, { "value": "no", "label": "No" }]
  },
  {
    "id": "other_text",
    "kind": "text",
    "placeholder": "Something else...",
    "visible_when": { "field": "decision", "equals": "other" }
  }
]
```

**`visible_when` evaluation:**

- Evaluate after every `change` event on any field
- A field is visible if it has no `visible_when` condition, or if the referenced
  field's current value equals the specified value
- Hidden fields are `display: none` and their values are excluded from
  `getValues()` and from `isValid()` evaluation
- Re-evaluate all conditions on every change (cheap, correct, no dependency
  graph needed for v1)

**Field kind → control mapping:**

| Kind | Control |
|---|---|
| `exclusive_choice` with `style: "buttons"` | `createButtonGroup` |
| `exclusive_choice` with any other style | `createButtonGroup` (default) |
| `multi_choice` | `createCheckboxGroup` |
| `boolean` | `createToggle` |
| `text` | `createTextField` |
| `number` | `wireNumberFieldControls` (existing) |
| `select` | `createSelect` |

**Labels:** if a field has a `label` property, render an `.aos-control-label`
above the control. If absent, render no label element.

**Validation:** `isValid()` returns `true` if all visible required fields are
non-empty and all visible fields with a `validate` function pass. For v1,
`required` is inferred from the presence of the field (all fields are considered
required unless `optional: true` is present in the field definition).

---

## CSS Extensions to `defaults.css`

All new visual classes belong in `controls/defaults.css`. Add at the end of the
file; do not restructure existing rules. Required additions:

- `.aos-button.danger` — red-tinted border and background (use warning/error
  palette: `rgba(255, 80, 80, …)` family, similar intensity to the cyan primary)
- `.aos-button.ghost` — transparent background, no border, text color only;
  hover shows a subtle surface
- `.aos-toggle-switch` — pill-shaped toggle using a hidden `<input type="checkbox">`:
  the track is `~32×18px`, thumb slides with CSS transition, cyan accent when
  checked
- `.aos-text-input.error` — border color shifts to the error palette; no
  background change
- `.aos-field-error` — small inline error message below the control, red/orange
  text, `--aos-type-label` size
- `.aos-timer-bar` — container, flex layout
- `.aos-timer-digital` — monospace countdown display, right-aligned,
  `--font-mono`
- `.aos-timer-pie` — SVG circle container with `stroke-dashoffset` sweep
- `.aos-timer-bar.flash` — defines a CSS keyframe animation that pulses opacity
  or color; the JS toggles this class when below `flashThresholdMs`
- `.aos-form` — outer form wrapper, `display: grid; gap: 10px`
- `.aos-form-field` — per-field wrapper, `display: grid; gap: 4px`
- `.aos-form-field.hidden` — `display: none`

---

## Tests

All tests live in `tests/toolkit/`. Use Node's built-in test runner
(`node:test` + `node:assert`). Do not add test framework dependencies.

Before writing tests, check whether `tests/toolkit/` has a `setup.js` or
similar shared DOM stub. If a minimal DOM environment is needed for tests that
exercise `el` construction, use a lightweight approach consistent with how
`surface-inspector.test.mjs` handles it — look at that file first.

### `tests/toolkit/controls-button.test.mjs`

- `createButton` returns `{ el, setLabel, setDisabled, on, destroy }`
- `el` is a `<button>` element
- variant classes are applied on construction
- `setDisabled(true)` sets `disabled` attribute; `setDisabled(false)` removes it
- click handler registered via `on('click', cb)` fires on click
- `destroy()` removes event listeners (no throw on subsequent calls)

### `tests/toolkit/controls-button-group.test.mjs`

- `createButtonGroup` returns correct shape
- initial `value` is reflected in `aria-pressed` state
- `setValue` updates the selected button and fires `change`
- arrow key navigation cycles through options
- `getValue()` returns the currently selected value

### `tests/toolkit/controls-toggle.test.mjs`

- `createToggle` returns correct shape
- `getValue()` matches initial `checked` config
- `setValue(true)` / `setValue(false)` updates checked state
- `on('change', cb)` fires when the underlying input changes

### `tests/toolkit/controls-text-field.test.mjs`

- `createTextField` returns correct shape
- `getValue()` returns current value
- `setValue('foo')` updates the input and reflects in `getValue()`
- `setError('msg')` adds error class and renders message; `setError(null)` clears
- `onCommit` fires on Enter key and blur

### `tests/toolkit/controls-checkbox-group.test.mjs`

- `createCheckboxGroup` returns correct shape
- `getValue()` returns `string[]`
- `setValue(['a', 'b'])` checks the correct boxes
- `on('change', cb)` fires with updated array when a checkbox is toggled
- select-all checkbox sets all options when checked

### `tests/toolkit/controls-timer-bar.test.mjs`

Since `requestAnimationFrame` is not available in Node, mock it. Verify:

- `createTimerBar` returns `{ el, start, pause, resume, reset, getRemainingMs, destroy }`
- `getRemainingMs()` decrements after each rAF tick (drive with fake time)
- `getRemainingMs()` is clamped to 0
- `onExpire` fires exactly once when timer reaches 0
- `pause()` stops decrement; `resume()` continues from paused position
- `reset()` restores `totalMs` and stops the timer

### `tests/toolkit/form.test.mjs`

- `createForm` renders one `.aos-form-field` per field
- `getValues()` returns an object keyed by field id
- a field with `visible_when` starts hidden if condition is unmet
- changing a field value that triggers `visible_when` makes the dependent field
  appear
- hidden fields are excluded from `getValues()`
- `isValid()` returns `false` when a required visible field is empty
- `on('change', cb)` fires after each field change with the current values object
- `destroy()` cleans up without throwing

---

## Verification

```bash
# Syntax check all new files
node --check packages/toolkit/controls/button.js
node --check packages/toolkit/controls/button-group.js
node --check packages/toolkit/controls/toggle.js
node --check packages/toolkit/controls/text-field.js
node --check packages/toolkit/controls/checkbox-group.js
node --check packages/toolkit/controls/select.js
node --check packages/toolkit/controls/timer-bar.js
node --check packages/toolkit/controls/index.js
node --check packages/toolkit/panel/form.js

# Run all new tests
node --test \
  tests/toolkit/controls-button.test.mjs \
  tests/toolkit/controls-button-group.test.mjs \
  tests/toolkit/controls-toggle.test.mjs \
  tests/toolkit/controls-text-field.test.mjs \
  tests/toolkit/controls-checkbox-group.test.mjs \
  tests/toolkit/controls-timer-bar.test.mjs \
  tests/toolkit/form.test.mjs

# Confirm existing tests still pass
node --test tests/toolkit/surface-inspector.test.mjs

git diff --check
```

Do not run `./aos ready` for this slice — this work is pure toolkit JS with no
daemon or app integration.

---

## Completion Report

Report:

- files created or modified
- test results (pass counts per file)
- any field kind or CSS token decision that diverged from this spec and why
- anything left unimplemented with a short reason
