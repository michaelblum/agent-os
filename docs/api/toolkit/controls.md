# Toolkit Controls API

Consumer-facing reference for reusable `packages/toolkit/controls/` behavior.
Controls are plain DOM modules for WKWebView surfaces. They create or enhance
semantic controls, dispatch normal DOM events, use `controls/defaults.css` for
stock styling, and avoid app-specific state.

Public entrypoint:

```js
import {
  createButton,
  createButtonGroup,
  createCheckboxGroup,
  createSelect,
  createTextField,
  createTimerBar,
  createToggle,
  wireNumberFieldControls,
} from 'aos://toolkit/controls/index.js'
```

## Factories

Each V0 factory takes a config object and returns a small controller object with
an `el` plus value, subscription, and cleanup methods appropriate to the
control.

| Factory | Purpose | Core methods |
| --- | --- | --- |
| `createButton({ label, variant, disabled, onClick })` | single pressable button with `primary`, `secondary`, `danger`, or `ghost` styling | `setLabel`, `setDisabled`, `on('click')`, `destroy` |
| `createButtonGroup({ options, value, onChange })` | exclusive choice button row using `.aos-segmented` | `getValue`, `setValue`, `on('change')`, `destroy` |
| `createToggle({ label, checked, onChange })` | boolean switch backed by an accessible hidden checkbox | `getValue`, `setValue`, `on('change')`, `destroy` |
| `createTextField({ value, placeholder, label, maxLength, validate, onChange, onCommit })` | single-line text input with inline error state | `getValue`, `setValue`, `setError`, `on('change')`, `on('commit')`, `destroy` |
| `createCheckboxGroup({ options, value, onChange })` | multi-choice checkbox column with select-all when there are at least three options | `getValue`, `setValue`, `on('change')`, `destroy` |
| `createSelect({ options, value, label, onChange })` | native single-value select | `getValue`, `setValue`, `on('change')`, `destroy` |
| `createTimerBar({ totalMs, direction, display, flashThresholdMs, flashIntervalMs, onExpire })` | cosmetic count-down/count-up timer with digital or pie display | `start`, `pause`, `resume`, `reset`, `getRemainingMs`, `destroy` |

`wireNumberFieldControls(root, options)` remains the numeric field enhancement
for existing semantic `<input type="number">` markup. It owns wheel and arrow-key
stepping and returns `{ dispose() }`.

## Styling

Stock visual classes live in `packages/toolkit/controls/defaults.css`. Consumers
may use the classes directly or override the shared `--aos-control-*` tokens by
cascade. V0 controls use `.aos-button`, `.aos-segmented`, `.aos-toggle-switch`,
`.aos-text-input`, `.aos-checkbox`, `.aos-select`, `.aos-timer-bar`, and
`.aos-field-error`.

## Form Harness

Panel-level schema rendering lives in
[panel/window form harness](./panel-window.md#createformcontainer-fields-options).
Use `createForm()` when a panel has field definitions such as
`exclusive_choice`, `multi_choice`, `boolean`, `text`, `number`, or `select`.
