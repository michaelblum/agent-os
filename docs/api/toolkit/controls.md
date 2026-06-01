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
  createColorField,
  createSelect,
  createSlider,
  createTextField,
  createTextarea,
  createTimerBar,
  createToggle,
  createAccordion,
  createCollapsible,
  createDialog,
  createMenu,
  createPopover,
  createSplitter,
  createTooltip,
  renderTextareaHtml,
  wireNumberFieldControls,
} from 'aos://toolkit/controls/index.js'
```

## Factories

Each V0 factory takes a config object and returns a small controller object with
an `el` plus value, subscription, and cleanup methods appropriate to the
control.

| Factory | Purpose | Core methods |
| --- | --- | --- |
| `createButton({ label, variant, disabled, onClick })` | single pressable button with `primary`, `secondary`, `danger`, or `ghost` styling | `setLabel`, `setDisabled`, `getUxTreeFragment(options = {})`, `on('click')`, `destroy` |
| `createButtonGroup({ options, value, onChange })` | exclusive choice button row using `.aos-segmented` | `getValue`, `setValue`, `getUxTreeFragment(options = {})`, `on('change')`, `destroy` |
| `createToggle({ label, checked, onChange })` | boolean switch backed by an accessible hidden checkbox | `getValue`, `setValue`, `getUxTreeFragment(options = {})`, `on('change')`, `destroy` |
| `createTextField({ value, placeholder, label, maxLength, validate, onChange, onCommit })` | single-line text input with inline error state | `getValue`, `setValue`, `setError`, `on('change')`, `on('commit')`, `destroy` |
| `createTextarea({ value, placeholder, rows, maxLength, spellcheck, readOnly, onChange, onCommit })` | native multi-line text area using shared textarea styling | `getValue`, `setValue`, `setReadOnly`, `on('change')`, `on('commit')`, `destroy` |
| `createCheckboxGroup({ options, value, onChange })` | multi-choice checkbox column with select-all when there are at least three options | `getValue`, `setValue`, `on('change')`, `destroy` |
| `createSelect({ options, value, label, onChange })` | Zag-backed single-value listbox select | `getValue`, `setValue`, `setOptions`, `setDisabled`, `on('change')`, `destroy` |
| `createSlider({ value, min, max, step, unit, label, onChange })` | Zag-backed numeric slider with single-thumb scalar values and array-shaped multi-thumb values | `getValue`, `getValues`, `setValue`, `setDisabled`, `on('change')`, `on('commit')`, `destroy` |
| `createColorField({ value, label, onChange })` | native hex color input | `getValue`, `setValue`, `setDisabled`, `on('change')`, `destroy` |
| `createTimerBar({ totalMs, direction, display, flashThresholdMs, flashIntervalMs, onExpire })` | cosmetic count-down/count-up timer with digital or pie display | `start`, `pause`, `resume`, `reset`, `getRemainingMs`, `destroy` |

`createButton()`, `createToggle()`, and `createButtonGroup()` expose
`getUxTreeFragment(options = {})` for read-only UX tree fragment discovery from
the live control object. The fragment is inspection data only; it does not
execute commands, persist bindings, or expose editable binding state.
Factory-created toggles honor `disabled` on the underlying checkbox.
Factory-created button groups honor option-level `disabled` on the live option
buttons; disabled options are skipped by pointer and arrow-key selection and
reported as disabled in factory-returned UX tree fragments.

## Zag Primitives

Phase 1 Zag controls are reusable primitive bindings over
`packages/toolkit/adapters/zag/`. Consumers should import these factories from
`controls/index.js` instead of importing Zag packages directly. The adapters own
Zag machine setup and ARIA/focus/keyboard/pointer props; the controls layer owns
generic DOM scaffolding, lifecycle shape, events, and stock theme classes.

Each primitive can render minimal semantic markup when no `root` is supplied, or
bind existing semantic markup when `root` is supplied. Existing markup uses the
same neutral data part attributes as the adapters, such as
`data-aos-collapsible-trigger`, `data-aos-accordion-item`, and
`data-aos-menu-item`. The common lifecycle is `mount(root?)`, `update(next)`,
`connect()`, and `destroy()`. Open-state primitives also expose `open()` and
`close()`. Change/select notifications are emitted as normal bubbling DOM
events on `el` and through `on(...)` subscriptions where useful.

| Factory | Parts | Notes |
| --- | --- | --- |
| `createCollapsible(config)` | root, trigger, content | supports controlled/uncontrolled `open` through Zag, disabled trigger state, `open()`, `close()`, and `on('change')` |
| `createAccordion(config)` | root, item, item trigger, item content | supports `value`, `defaultValue`, `multiple`, and item value derivation from `data-value`, `data-id`, or `id` |
| `createSplitter(config)` | root, panel, resize trigger | supports horizontal/vertical Zag orientation and panel size config without embedding a product layout |
| `createPopover(config)` | trigger, positioner, content, title, description, close trigger | keeps dismiss and focus behavior Zag-owned; positioning options pass through generically |
| `createDialog(config)` | trigger, backdrop, positioner, content, title, description, close trigger | keeps modal focus management Zag-owned; content remains consumer supplied |
| `createMenu(config)` | trigger, content, item | uses neutral item selectors by default (`data-value` and `data-aos-menu-item`); consumers can supply product-owned selectors and value mapping |
| `createTooltip(config)` | trigger, positioner, content | passes delay, open, disabled, and positioning options through to Zag |

Stock generated triggers and item controls use at least 44px minimum hit targets
in `defaults.css`. Consumers that provide their own visible triggers should keep
the same minimum actionable size. These primitives are generic toolkit
foundation; Subject Browser, Sigil, wiki, radial-menu, and work-record product
behavior belongs in consumers that compose them.

`wireNumberFieldControls(root, options)` remains the numeric field enhancement
for existing semantic `<input type="number">` markup. It owns wheel and arrow-key
stepping and returns `{ dispose() }`.

## Styling

`renderTextareaHtml(config)` is the string-rendering companion for surfaces that
render HTML templates before wiring controls; it accepts the same static
textarea attributes and escapes values before placing them in markup.

Stock visual classes live in `packages/toolkit/controls/defaults.css`. Consumers
may use the classes directly or override the shared `--aos-control-*` tokens by
cascade. V0 controls use `.aos-button`, `.aos-segmented`, `.aos-toggle-switch`,
`.aos-text-input`, `.aos-textarea`, `.aos-checkbox`, `.aos-select`,
`.aos-slider`, `.aos-color-field`, `.aos-timer-bar`, `.aos-field-error`, and
primitive classes such as
`.aos-collapsible`, `.aos-accordion`, `.aos-splitter`, `.aos-popover`,
`.aos-dialog`, `.aos-menu`, and `.aos-tooltip`.

## Form Harness

Panel-level schema rendering lives in
[panel/window form harness](./panel-window.md#createformcontainer-fields-options).
Use `createForm()` when a panel has field definitions such as
`exclusive_choice`, `radio_group`, `multi_choice`, `boolean`, `checkbox`,
`text`, `textarea`, `number`, `slider`, `color`, or `select`.
