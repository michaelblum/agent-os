# Toolkit Panel And Window API

Consumer-facing reference for the default opt-in AOS panel/windowing layer: panel chrome, placement, drag, resize, minimize, maximize, restore, StageAffordance, and stock panel layouts. Runtime bridge primitives live in [runtime.md](./runtime.md).

For interaction mechanism selection, use the canonical
[surface interaction decision tree](../../recipes/aos-surface-interaction-decision-tree.md)
(`docs/guides/aos-surface-interaction-decision-tree.md`).

## StageAffordance

`packages/toolkit/panel/stage-affordance.js` provides the panel-layer
`createStageAffordance` helper for binding passive stage layers to daemon input
regions. It is built on `createResourceScope`, so the helper owns setup and
idempotent cleanup of the stage layer, input regions, bridge event matcher, and
lifecycle subscription while exposing the underlying `resourceScope` state for
future inspector surfaces. Its direct state exposes layer ids, region ids, owner
canvas id, source canvas id, target stage canvas id, mode, active state, and
cleanup status. Use this for lightweight DesktopWorld affordances such as
minimized chips instead of creating a full interactive WebView when the visual
is passive. Lifecycle subscriptions are canvas-wide in the current daemon
model, so StageAffordance cleanup retains shared lifecycle subscriptions by
default and reports `cleanupStatus.subscriptionRetained`. Only pass
`unsubscribeOnCleanup: true` for an affordance that exclusively owns its
subscription in that canvas.

StageAffordance stamps the passive stage layer metadata with
`toolkit_affordance_id`, `resource_scope_id`, `owner_canvas_id`,
`source_canvas_id`, `target_canvas_id`, and `stage_affordance_mode`. Each input
region already carries the same `toolkit_affordance_id`. Surface Inspector uses
that shared metadata to group passive visuals and daemon hit regions under the
owning canvas and to flag missing owners or incomplete cleanup.

## Panel API

Public entrypoint:

```js
import {
  createForm,
  createDragDropController,
  createDragController,
  createPanelWindowController,
  createResizeController,
  createSplitPane,
  createMaximizeController,
  dragFrameFromPointer,
  mountPanel,
  mountChrome,
  resizeFrame,
  Single,
  SplitPane,
  Tabs,
  wireDrag,
  wireResize,
} from 'aos://toolkit/panel/index.js'
```

### `createForm(container, fields, options?)`

Renders a schema-driven form into a panel container and returns a controller:
`{ el, getValues, isValid, setValues, setDisabled, getField, focus, on, destroy }`.

`fields` is the reusable panel field vocabulary used by the gate request schema
and by compact data-editor surfaces. A field item may also be a section:

```js
{
  kind: 'section',
  id: 'appearance',
  label: 'Appearance',
  fields: [
    { id: 'face', kind: 'color', value: '#4488ff', state_path: 'colors.face.0' },
    { id: 'opacity', kind: 'slider', value: 0.7, min: 0, max: 1, step: 0.05 },
  ],
}
```

Section children may be supplied as `fields` or `controls`; `controls` is useful
when the form renders a workbench/editor projection view model.

| Field kind | Control |
| --- | --- |
| `exclusive_choice` | `createButtonGroup` |
| `radio_group` | `createButtonGroup` |
| `multi_choice` | `createCheckboxGroup` |
| `boolean` | `createToggle` |
| `checkbox` | `createToggle` |
| `text` | `createTextField` |
| `textarea` | `createTextarea` |
| `number` | semantic number input enhanced by `wireNumberFieldControls` |
| `slider` | `createSlider` |
| `color` / `color_control` | `createColorField` |
| `select` | `createSelect` |

Fields render inside `.aos-form-field` wrappers within an `.aos-form` root. A
field with `visible_when: { field, equals }` is hidden until the referenced
visible or hidden field value equals the requested value. Hidden fields are
excluded from `getValues()` and `isValid()`. Visible fields are required unless
`optional: true` is present.

Section items render as `.aos-form-section` with an optional title,
description, and `.aos-form-section-fields` child. Field wrappers stamp stable
metadata for editor bindings when present either at the field top level or under
`field.binding`: `data-aos-field-id`, `data-aos-field-kind`,
`data-state-path`, `data-route`, `data-object-ids`, `data-group-key`,
`data-facet-key`, and `data-descriptor-id`. The form harness does not own
persistence or command routing; consumers translate changed values into their
domain patch messages.

### `mountChrome(container, options?)`

Builds the panel shell without mounting content or wiring messages.

```js
const chrome = mountChrome(document.body, {
  title: 'My Panel',
  draggable: true,
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | header title |
| `draggable` | `boolean` | whether header drag uses the shared toolkit drag/drop movement path |
| `drag` | `object` | optional drag/drop controller settings; stock chrome clamps final placement by default |
| `close` | `boolean` | whether to show the stock close control, default `true` |
| `minimize` | `boolean` | whether to show the stock minimize control, default `true` |
| `maximize` | `boolean` | whether to show the stock maximize/restore control, default `false` |
| `resizable` | `boolean` | whether to add stock edge/corner resize handles, default `false` |
| `resize` | `object` | optional resize controller settings such as min/max width and height |
| `onClose` | `function` | optional close override |
| `onMinimize` | `function` | optional minimize override |
| `onMaximize` | `function` | optional maximize/restore override; receives the maximize controller |

Returns an object with:

| Field / method | Meaning |
| --- | --- |
| `panelEl` | outer panel element |
| `headerEl` | header element |
| `titleEl` | title slot element |
| `controlsEl` | controls slot element |
| `customControlsEl` | app controls slot element |
| `windowControlsEl` | stock lifecycle controls slot element |
| `contentEl` | content mount element |
| `panelWindowController` | canonical panel/window policy controller used by stock chrome |
| `maximizeController` | controller when `maximize: true`, otherwise `null` |
| `dragController` | controller when `draggable: true`, otherwise `null` |
| `resizeController` | controller wrapper when `resizable: true`, otherwise `null` |
| `setTitle(text)` | update the title slot |
| `setControls(html)` | replace controls slot contents with HTML |

Notes:

- `mountChrome()` adds the `aos-panel-root` class to the mount container
- the returned slot refs are the behavioral contract; consumers should not rely on querying `.aos-*` classes for runtime behavior
- when draggable, the stock header delegates to the shared toolkit drag/drop
  controller, which drives window movement through native-coordinate absolute
  updates and settles final placement through the panel placement contract
- stock chrome clamps final drag placement to the current display work area so
  titlebars and window controls remain reachable
- when maximize is enabled, the stock controller stores the current canvas frame,
  updates the canvas to the current display work area, and restores the stored
  frame on the next toggle
- stock minimize renders the chip as a shared DesktopWorld stage layer with
  daemon input regions when those primitives are available. The toolkit owns
  restore/close policy; the daemon only routes the region event. If stage or
  input-region setup fails, the controller falls back to the transitional
  `packages/toolkit/panel/minimized-chip.html` WebView chip and records
  `mode: "fallback_webview"` in controller state.
- stock minimize treats stage setup as materialized only after stage ensure
  reports a truthful ready status, the layer upsert has been sent, and input
  regions have registered. Mounted stock panels expose
  `window.__aosPanelWindowController.getState().minimize` for narrow live
  diagnostics, including `stageEnsureStatus`, `stageLayerUpsertSent`,
  `registeredRegionIds`, `fallbackChipCreated`, and `fallbackChipResumed`.
- when resize is enabled, stock handles emit `resize_start` / `resize_end`,
  resize through `canvas.update`, and use the same frame/work-area helpers as
  maximize/restore

### `createPanelWindowController(options?)`

Creates the canonical public toolkit policy path for ordinary AOS
panel/window behavior. `mountChrome()` uses this controller internally, and
custom panel-shaped surfaces should use it instead of implementing private
panel movement, minimize, maximize, resize, or close messages.

The controller composes the lower-level toolkit primitives with one shared
placement policy:

- panel frames are native global CG coordinates;
- `getWorkArea` defaults to the display owning the panel frame top-left;
- drag-end clamping can use `getDragWorkArea`, whose stock path lets the
  release/cursor display win over seam-adjacent top-left inference;
- drag, resize, maximize/restore, chip placement, and minimized restore use
  the same placement helpers;
- minimize defaults to a passive stage chip plus daemon input regions, with the
  explicit WebView chip retained as fallback.

```js
const windowPolicy = createPanelWindowController({
  drag: { clampOnEnd: true },
  resize: { minWidth: 760, minHeight: 520 },
  maximize: true,
  minimize: true,
})

windowPolicy.wireDrag(titlebarEl, controlsEl)
windowPolicy.wireResize(shellEl)
```

Returns `{ dragController, resizeController, maximizeController,
minimizeController, close, minimize, maximize, restore, toggleMaximize,
wireDrag, wireResize, getState }`. Lower-level exports remain available for
specialized surfaces, but this controller is the public default for
window-shaped panels.

### `mountPanel(options)`

Creates a panel shell and mounts a layout.

```js
mountPanel({
  title: 'My Panel',
  layout: Single(MyContent),
  draggable: true,
  container: document.body,
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | header title |
| `layout` | layout object | required |
| `draggable` | `boolean` | whether the mounted stock header uses the shared toolkit drag/drop movement path |
| `drag` | `object` | optional drag controller settings |
| `close` | `boolean` | whether to show the stock close control, default `true` |
| `minimize` | `boolean` | whether to show the stock minimize control, default `true` |
| `maximize` | `boolean` | whether to show the stock maximize/restore control, default `false` |
| `resizable` | `boolean` | whether to add stock edge/corner resize handles, default `false` |
| `resize` | `object` | optional resize controller settings |
| `container` | `HTMLElement` | mount target, default `document.body` |

### `createMinimizeController(options?)`

Creates the toolkit-owned minimize state used by stock panel chrome. The
default path computes a chip frame, upserts a passive `kind: "chip"` layer on
the shared DesktopWorld stage, registers explicit native input regions, and
then suspends the source canvas.

Region ids are derived from the chip id:

| Region | Id suffix | Policy |
| --- | --- | --- |
| restore | `:restore` | left/body restore affordance, `semantic_label: "restore"`, `consume_policy: "captured"` |
| close | `:close` | right close affordance, `semantic_label: "close"`, `consume_policy: "down_only"` |
| body/drag | `:body` | full chip body, `semantic_label: "drag"`, `consume_policy: "captured"` |

The source canvas remains the owner for these regions and each region sets
`remove_on_owner_suspend: false` so the chip can survive the source suspend.
Click-like body/restore gestures resume the source and remove the stage layer
plus all regions; mousedown alone does not restore. Body/restore drags that
cross the movement threshold move the stage chip instead, updating both the
DesktopWorld layer and native input regions. Close removes the chip
layer/regions and removes the source. Owner removal also cleans the layer.

`minimize()` must be atomic from the caller's perspective: if it returns
`status: "success"` and suspends the source, either the stage path has recorded
a truthful `stageEnsureStatus.ok`, `stageLayerUpsertSent: true`, and registered
region ids, or the fallback path has created and resumed an `aos-chip-*`
WebView with `mode: "fallback_webview"`. Fallback create failure leaves the
source active. Fallback resume failure removes the fallback chip and resumes the
source.

Default `createPanelWindowController()` instances start a shared DesktopWorld
stage prewarm when stage chips are enabled, so the first minimize click can
reuse the in-flight or ready stage instead of doing the cold create/wait work
inside the click path. `createMinimizeController().prewarmStage()` exposes that
same narrow hook for custom panel shells; pass `{ retry: true }` to retry after
an earlier failed prewarm.

`getState().timing` exposes compact monotonic diagnostics for the most recent
minimize attempt: handler start, stage ensure start/end/status duration, stage
layer upsert send time, input region registration start/end/count, source
suspend start/end, fallback create/resume timings when used, and total elapsed
time.

### `createDragDropController(options?)`

Creates the first-class toolkit drag/drop movement state used by stock panel
chrome and custom workbench titlebars.

```js
const controller = createDragDropController({ clampOnEnd: true })
```

By default the controller sends absolute drag updates through `move_abs` with
`canvas_geometry` metadata (`cause: "placement.drag"`, `change: "origin"`, and
a stable drag `transaction_id`). When
`clampOnEnd` is true, it reads the current window frame at drag completion,
clamps it to the current display work area, and writes the corrected frame
through `canvas.update` only when the panel would otherwise be stranded. Resize,
maximize, and restore writes also pass geometry metadata so subscribers can
separate frame invalidation from structural `canvas_lifecycle` changes.

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `move` | `function` | absolute drag writer, default `move_abs` |
| `getFrame` | `function` | current `[x, y, width, height]`, default current window frame |
| `getWorkArea` | `function` | current display work area, default `window.screen.avail*` |
| `updateFrame` | `function` | frame writer for final clamp, default `canvas.update` |
| `clampOnEnd` | `boolean` | whether to clamp final drag placement, default `false` |
| `minVisibleWidth` / `minVisibleHeight` | `number` | visible affordance retained when clamping oversized frames |
| `onStateChange` | `function` | receives drag state snapshots |

`createDragController(options?)` remains an alias for panel-shaped movement
callers that already import that name; new panel and node movement code should
prefer `createDragDropController()`.

`dragFrameFromPointer(pointer, offsetX, offsetY, frame?)` is the pure geometry
helper for tests and custom hosts.

`wireDrag(headerEl, controlsEl, options?)` wires primary-button titlebar dragging
to a DOM element. It ignores events originating inside `controlsEl`, delegates
movement to the drag/drop controller, returns that controller, and accepts
`onStart` / `onEnd` hooks for custom surfaces such as workbenches that need to
restore from maximized state before moving.

Stock `mountChrome()` headers are also semantic drag targets. The header carries
`data-aos-ref="<canvas-or-panel-surface>:drag-handle"`,
`data-semantic-target-id="drag-handle"`, `data-aos-action="panel_drag"`,
`data-aos-actions="drag"`, and an accessible drag label. Agents should use the
reported `semantic_targets[].provenance.do_target` with
`aos do drag canvas:<canvas-id>/<drag-handle-ref> --by <dx>,<dy>` instead of
choosing header pixels.

### `createMaximizeController(options?)`

Creates the toolkit-owned maximize/restore state used by stock panel chrome and
by custom workbench titlebars that need the same behavior.

```js
const controller = createMaximizeController()
controller.maximize()
controller.restore()
controller.toggle()
```

By default the controller reads `window.screenX/screenY` and
`window.innerWidth/innerHeight` for the restore frame, reads
`window.screen.avail*` for the current display work area, and updates the
calling canvas through `canvas.update`. If the browser does not expose a display
origin, the helper keeps the current window origin as the safest fallback. Tests
and custom hosts can override `getFrame`, `getWorkArea`, `updateFrame`, and
`onStateChange`.

The controller state is:

```js
{
  maximized: true,
  restoreFrame: [x, y, width, height]
}
```

### `createResizeController(options?)`

Creates the toolkit-owned edge/corner resize state used by stock panel chrome.

```js
const controller = createResizeController({
  minWidth: 320,
  minHeight: 220,
})
controller.resize('se', 24, 16)
```

Supported edges are `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, and `sw`. The helper
also accepts common words such as `top`, `left`, and `bottom-right`.

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `getFrame` | `function` | current `[x, y, width, height]`, default current window frame |
| `getWorkArea` | `function` | current display work area, default `window.screen.avail*` |
| `updateFrame` | `function` | frame writer, default `canvas.update` |
| `minWidth` / `minHeight` | `number` | minimum surface size |
| `maxWidth` / `maxHeight` | `number` | optional maximum surface size |
| `onStateChange` | `function` | receives resize state snapshots |

`resizeFrame(frame, edge, dx, dy, constraints?)` is the pure geometry helper
behind the controller. It preserves the opposite edge for north/west resizes,
enforces min/max dimensions, and clamps to the supplied work area so panel
chrome remains reachable.

`wireResize(panelEl, options?)` appends stock edge/corner handles to a custom
panel or workbench shell and returns `{ controller, handles }`. `mountChrome`
uses this internally when `resizable: true`.

### `Single(factoryOrContent)`

Wraps one content unit.

### `createSplitPane(options?)`

Builds or wires a two-pane DOM layout with a draggable accessible separator.
This helper is for custom workbench shells that already own their HTML.

```js
const split = createSplitPane({
  root: document.querySelector('.workbench-main'),
  startPane: document.querySelector('.preview-pane'),
  endPane: document.querySelector('.controls-pane'),
  orientation: 'horizontal',
  initialRatio: 0.58,
  minStart: 360,
  minEnd: 320,
  storageKey: 'my-workbench.split',
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `root` | `HTMLElement` | existing root to wire; created when omitted |
| `startPane` / `endPane` | `HTMLElement` | existing panes to wire; created when omitted |
| `divider` | `HTMLElement` | existing separator; created when omitted |
| `orientation` | `'horizontal' \| 'vertical'` | left-right or top-bottom split, default `horizontal` |
| `initialRatio` | `number` | start pane ratio before restore, default `0.5` |
| `restoreState` | `object \| number` | explicit restored state or ratio; objects may include `closedPane` |
| `storageKey` | `string` | optional localStorage-backed ratio and closed-pane persistence |
| `minStart` / `minEnd` | `number` | minimum start/end pane size in pixels |
| `maxStart` / `maxEnd` | `number` | optional maximum start/end pane size in pixels |
| `keyboardStep` | `number` | arrow-key resize step in pixels |
| `ariaLabel` | `string` | accessible separator label |
| `onChange` | `function` | called with `{ orientation, ratio, startSize, endSize, availableSize, closedPane }` |

The returned controller exposes:

| Field / method | Meaning |
| --- | --- |
| `root`, `startPane`, `endPane`, `divider` | wired DOM nodes |
| `getState()` | current normalized split state |
| `setRatio(ratio, options?)` | update by ratio |
| `setStartSize(px, options?)` | update by start pane pixels |
| `closePane('start' \| 'end')` | close one pane and let the other fill the split root |
| `openPane('start' \| 'end')` | reopen a closed pane and restore the last ratio |
| `togglePane('start' \| 'end')` | close/open one pane |
| `isPaneOpen('start' \| 'end')` | return whether a pane is currently open |
| `destroy()` | remove controller event listeners |

The separator uses `role="separator"`, `aria-orientation`, `aria-valuenow`,
and pointer/keyboard semantics. Apps should treat `.aos-split-pane*` classes as
styling hooks and the controller state as the behavior contract.

### `SplitPane(startFactoryOrContent, endFactoryOrContent, options?)`

Wraps two content units in a toolkit split-pane layout for `mountPanel`.

```js
mountPanel({
  title: 'Workbench',
  layout: SplitPane(PreviewContent, ControlsContent, {
    initialRatio: 0.6,
    minStart: 320,
    minEnd: 280,
  }),
})
```

`SplitPane` accepts the same geometry options as `createSplitPane`. It emits
`split-pane/resized` and declares a panel manifest with the two pane contents.
Individual content units are routed by their existing `manifest.channelPrefix`.

### `Tabs(factoriesOrContents, options?)`

Wraps multiple content units and shows one at a time.

```js
Tabs([
  AlphaContent,
  BetaContent,
], {
  onActivate(info, host) {
    console.log(info.index, info.title)
  },
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `onActivate` | `function` | optional callback invoked when the active tab changes, including the initial `0` activation |

Activation callback info:

| Field | Meaning |
| --- | --- |
| `index` | active tab index |
| `title` | resolved tab label (`manifest.title`, then `manifest.name`) |
| `manifest` | active content manifest or `null` |

Important boundary:

- `Tabs` provides structure and activation behavior
- `Tabs` uses the browser-safe `createAosZagTabs` adapter for tab ARIA,
  keyboard focus, and trigger/content state
- `Tabs` may notify consumers when activation changes through `onActivate(info, host)`
- `Tabs` supplies a stock tabbed panel structure in `panel/defaults.css`; apps
  may theme it through the `.aos-*` hooks and shared custom properties

Panel-level control/event surface:

- `tabs/activate` with `{ index }`, `{ name }`, or `{ title }`
- `tabs/activated` emitted when activation changes with `{ index, title, name }`
- the returned layout object also exposes `activate(payload)` for same-canvas programmatic activation
- consumers may theme `.aos-tab-shell`, `.aos-tabs`, `.aos-tab`,
  `.aos-tab.active`, `.aos-tab-panels`, and `.aos-tab-content`
- `.aos-tabs[data-density="compact"]` is the stock compact tab strip for nested
  panes and utility panels, and `.aos-tabs[data-layout="equal"]` distributes
  triggers evenly when equal-width tabs are needed
- `Tabs` mounts its strip inside `chrome.contentEl` so selected tabs are
  contiguous with their tabpanel body instead of floating in the titlebar
- active tab state is exposed via `.active`, `data-active`, `aria-selected`, and the `hidden` attribute on tab panels
