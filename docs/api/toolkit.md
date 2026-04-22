# Toolkit API

Consumer-facing reference for `packages/toolkit`.

Use this doc when you are:

- building a canvas surface that runs inside `aos`
- composing reusable toolkit content
- reviewing changes to runtime, panel, or content contracts

For broader architecture, see [packages/toolkit/CLAUDE.md](../../packages/toolkit/CLAUDE.md).

## What The Toolkit Is

The toolkit is the reusable web layer for `aos` canvases.

It is split into three layers:

| Layer | Path | Purpose |
| --- | --- | --- |
| Runtime | `packages/toolkit/runtime/` | bridge, subscriptions, canvas mutation helpers, manifest handshake |
| Panel | `packages/toolkit/panel/` | structure and composition primitives (`mountPanel`, `Single`, `Tabs`) |
| Components | `packages/toolkit/components/` | reusable content units and optional stock styles |

## Import / Hosting Model

Toolkit files are normally served through the AOS content server:

```bash
aos set content.roots.toolkit packages/toolkit
```

Then a canvas can load:

```bash
aos show create \
  --id my-panel \
  --at 100,100,320,220 \
  --interactive \
  --url 'aos://toolkit/components/inspector-panel/index.html'
```

Within toolkit HTML, imports typically use relative module paths.

## Stock Components Snapshot

Current reusable toolkit components include:

- `aos://toolkit/components/inspector-panel/index.html` - AX element inspector fed by `aos inspect`
- `aos://toolkit/components/log-console/index.html` - scrolling log console fed by `aos log`
- `aos://toolkit/components/integration-hub/index.html` - provider-neutral chat integration dashboard backed by the local integration broker snapshot API
- `aos://toolkit/components/canvas-inspector/index.html` - canvas lifecycle and minimap inspector with optional live cursor and mouse-event overlays
- `aos://toolkit/components/spatial-telemetry/index.html` - live coordinate tables + event log for display, canvas, cursor, and object-mark debugging
- `aos://toolkit/components/wiki-kb/index.html` - wiki graph browser with force-graph and mind-map views

### Integration Hub

`integration-hub` is the reusable operator surface for chat-driven broker work.

It polls a local broker HTTP endpoint (default `http://127.0.0.1:47231`) and
renders four shared surfaces from the broker snapshot:

- `jobs`
- `workflows`
- `integrations`
- `activity`

The component assumes the snapshot schema documented at:

- [`shared/schemas/integration-broker-snapshot.md`](../../shared/schemas/integration-broker-snapshot.md)

Current behavior:

- shows provider status for Slack and future transports such as Discord
- shows the workflow catalog exposed through chat providers
- shows recent execution history with broker job IDs
- exposes a local simulation console that posts to `POST /api/integrations/simulate`

Consumer override:

- pass `IntegrationHub({ brokerUrl: 'http://127.0.0.1:48200' })` when the
  broker is not on the default port

`wiki-kb` accepts a graph snapshot on `wiki-kb/graph` (and tolerates raw
`wiki/graph` messages for imported-prototype compatibility). Canonical payload:

```json
{
  "nodes": [
    { "id": "alpha", "name": "Alpha", "type": "entity", "description": "..." }
  ],
  "links": [
    { "source": "alpha", "target": "beta" }
  ],
  "raw": {
    "alpha": "# Alpha\n\nMarkdown body"
  },
  "config": {
    "graphView": {
      "controls": { "collapsed": false },
      "defaults": {
        "mode": "local",
        "depth": 2,
        "labelMode": "selection",
        "showIsolated": true,
        "highlightNeighbors": true,
        "activeTypes": ["entity", "concept"]
      }
    }
  }
}
```

Incremental updates go to `wiki-kb/graph/update` and may include:

- `nodes`, `links`, `raw` for upserts
- `removeNodes`, `removeLinks`, `removeRaw` for targeted removals
- `replace`, `replaceLinks`, `clearRaw` for reset-style updates
- `config.graphView` to update graph-view defaults and feature flags

Additional semantic intents:

- `wiki-kb/reveal` with `{ id | path | name, view?, openSidebar?, focus? }`
- `wiki-kb/clear-selection`
- `wiki-kb/set-view` with `{ view }`

Current emitted semantic event:

- `wiki-kb/selection` with `{ id, path, name, type, tags, plugin }` or `null`

`config.graphView` is intentionally generic rather than app-specific. Current
consumer-facing fields:

- `controls.enabled` / `controls.collapsed`
- `features.search`, `features.types`, `features.tags`, `features.scope`, `features.depth`, `features.labels`, `features.isolated`, `features.neighbors`, `features.path`, `features.freeze`, `features.focus`, `features.fit`, `features.reset`, `features.legend`
- `defaults.mode` (`global` or `local`)
- `defaults.depth`
- `defaults.labelMode` (`all`, `selection`, or `hover`)
- `defaults.showIsolated`
- `defaults.highlightNeighbors`
- `defaults.frozen`
- `defaults.activeTypes`
- `defaults.activeTags`
- `defaults.searchQuery`
- `defaults.tagMatchMode` (`any` or `all`)
- `limits.minDepth` / `limits.maxDepth`

When enabled, the graph controls can also expose:

- configurable label density (`all`, `selection`, `hover`)
- one-hop neighbor highlighting around the current selection or hover target
- shortest-path highlighting between a saved path start and the current selection
- selection focus actions that fit the selected node plus its current highlight context

### Canvas Inspector — Object Marks

Consumer canvases can publish ephemeral "object marks" that the
`canvas-inspector` renders on its minimap and in the tree list beneath the
parent canvas. Marks represent sub-canvas objects whose position you want to
surface (e.g. Sigil's avatar, a hit-test target, a highlighted widget).

**Wire contract** — a `canvas_object.marks` event with a full-snapshot
replace payload:

```json
{
  "type": "canvas_object.marks",
  "payload": {
    "canvas_id": "avatar-main",
    "objects": [
      {
        "id": "avatar",
        "x": 942,
        "y": 540,
        "name": "Avatar",
        "color": "#ff66cc",
        "w": 20,
        "h": 20,
        "rect": true,
        "ellipse": true,
        "cross": true
      }
    ]
  }
}
```

Required fields: `id`, `x`, `y`. `x` and `y` are in desktop CG coordinates,
the same space as `canvas.at`. Optional fields:

- `name` — display label (defaults to `id`)
- `color` — stroke color for the marker (defaults to a stable hash of `id`)
- `w`, `h` — marker-local logical units in minimap pixels (default `20`,
  clamped to `[4, 128]`). Stable visual size regardless of display DPI.
- `rect`, `ellipse`, `cross` — boolean primitive toggles (default `true`
  each). The default marker is a `20 × 20` square outline with an inscribed
  ellipse and a corner-to-corner `X`. Any combination is valid; set a
  primitive to `false` to omit that layer.

Snapshot semantics:

- Each emit fully replaces the mark list for `canvas_id`. Omit a previously
  published mark and it disappears on the next emit.
- `"objects": []` drops the canvas entry outright.
- An entry is also evicted when the parent canvas emits
  `canvas_lifecycle action: "removed"`.
- If a canvas stops emitting, its entry expires after a 10 s TTL.

Emit patterns:

- **Event-driven** — post on position/visibility changes. The inspector
  applies snapshots idempotently, so duplicate emits are cheap.
- **Low-rate heartbeat (optional)** — if you want marks to survive a long
  idle period for late-joining inspectors, emit every ~5 s while visible.
  Avoid an always-on high-rate heartbeat.

Subscribe side is handled for you — the canvas-inspector subscribes to
`canvas_object.marks` via its manifest. Any canvas that subscribes will
receive the daemon's fan-out.

The inspector's minimap cursor is operator-toggleable and starts hidden by
default. Turning it on subscribes to `input_event` on demand and requests a
snapshot so the current cursor dot appears immediately instead of waiting for
the next mouse move.

The inspector also exposes a separate `mouse events` toggle directly beneath
`minimap cursor`. It shares the same on-demand `input_event` subscription but
renders gesture overlays instead of the live cursor dot: left-button hold and
drag origin markers, drag lines, release collapse/fade, left-click expanding
circle pulses, `Esc` cancel collapse back to origin, and right-click expanding
square pulses.

The inspector also supports a daemon-owned global export hotkey:
`ctrl+opt+c`. When `canvas-inspector` exists, that combo captures a
point-in-time see bundle without relying on mouse interaction. The daemon
writes a temp bundle directory containing:

- `capture.png` — a `see capture --region <inspector-at-trigger> --perception` image
- `capture.json` — the capture response metadata
- `inspector-state.json` — the surface's live JS/debug snapshot
- `display-geometry.json` — the daemon display snapshot at export time
- `canvas-list.json` — the daemon canvas list at export time
- `bundle.json` — manifest/status for the bundle

The bundle directory path is copied to the system clipboard, and the inspector
status bar reflects pending/success/error state for the export.

That export is configured under the daemon-owned `see` subtree rather than in
Sigil or toolkit-local settings:

```bash
aos config get see.canvas_inspector_bundle --json
aos config set see.canvas_inspector_bundle.hotkey cmd+shift+x
aos config set see.canvas_inspector_bundle.include.canvas_list false
aos config set see.canvas_inspector_bundle.include.xray true
```

Supported include toggles today:

- `capture_image`
- `capture_metadata`
- `inspector_state`
- `display_geometry`
- `canvas_list`
- `xray`

`xray` writes an additional `xray.json` artifact containing the AX-derived
element list from `aos see capture --xray`. This config shape is intentionally
under `see` so future `see` bundle/record presets can grow beside the current
inspector export path instead of being trapped in inspector-only settings.

### Spatial Telemetry

`spatial-telemetry` is the permanent coordinate-debug surface for multi-display
work. It keeps all of these live streams subscribed all the time:

- `display_geometry`
- `canvas_lifecycle`
- `input_event`
- `canvas_object.marks`

It renders live tables for:

- union bounds
- per-display bounds + visible bounds
- canvas rects in global, union-local, and per-display-local coordinates
- mark points in global, union-local, canvas-local, and per-display-local coordinates
- cursor position in global, union-local, and per-display-local coordinates
- a rolling event log so geometry changes can be correlated with the raw event stream

Default launcher:

```bash
bash packages/toolkit/components/spatial-telemetry/launch.sh
```

Standard display-debug battery:

```bash
bash tests/display-debug-battery.sh
```

Machine-readable state is exposed for agents via:

```bash
./aos show eval --id spatial-telemetry \
  --js 'JSON.stringify(window.__spatialTelemetryState?.snapshot)'
```

## Runtime API

Convenience re-export:

```js
import {
  wireBridge,
  emit,
  esc,
  subscribe,
  unsubscribe,
  spawnChild,
  mutateSelf,
  removeSelf,
  setInteractive,
  evalCanvas,
  move,
  declareManifest,
  emitReady,
  emitLifecycleComplete,
  onReady,
} from 'aos://toolkit/runtime/index.js'
```

### `wireBridge(handler)`

Installs an inbound message handler for daemon-to-canvas messages.

```js
wireBridge((msg) => {
  if (msg.type === 'hello') console.log(msg.payload)
})
```

Notes:

- safe to call more than once
- each handler is retained and invoked for every inbound message
- inbound messages arrive through `window.headsup.receive(base64Json)`

### `emit(type, payload?)`

Sends a message from the canvas back to the daemon / host bridge.

```js
emit('log/append', { text: 'hello', level: 'info' })
```

### `esc(value)`

HTML-escape helper for rendering untrusted text into `innerHTML`.

### `subscribe(events, options?)` / `unsubscribe(events)`

Manage daemon event subscriptions.

```js
subscribe(['canvas_lifecycle', 'display_geometry'], { snapshot: true })
unsubscribe('display_geometry')
```

Options:

- `snapshot: true` asks the daemon to replay the current state for supported
  streams immediately after subscribing. Today that includes
  `display_geometry`, `canvas_lifecycle`, and `input_event` (replayed as the
  current cursor position).
- `canvas_lifecycle` snapshots and live updates now share one rich payload
  shape: top-level compatibility fields (`canvas_id`, `action`, `at`) plus
  metadata such as `parent`, `track`, `interactive`, `scope`, and a nested
  `canvas` object mirroring `aos show list`.

### `spawnChild(opts)`

Creates a child canvas and returns a promise that resolves after the daemon ack.

```js
await spawnChild({
  id: 'child',
  url: 'aos://toolkit/components/log-console/index.html',
  at: [100, 100, 320, 240],
  interactive: true,
})
```

### `mutateSelf(opts)`

Fire-and-forget update for the current canvas.

```js
mutateSelf({ interactive: true })
```

### `removeSelf(opts?)`

Removes the current canvas and resolves after daemon ack.

### `setInteractive(boolean)`

Convenience wrapper over `mutateSelf({ interactive })`.

### `evalCanvas(id, js, options?)`

Evaluates JavaScript inside another canvas and resolves with the daemon's eval result string.

```js
await evalCanvas('avatar-main', 'document.title')
```

Options:

- `timeoutMs`: override the default 5000ms request timeout

### `move(dx, dy)`

Relative move helper for the current canvas.

Used by the stock draggable header; intended for live drag behavior rather than absolute positioning.

### `declareManifest(manifest)`

Declares the canvas manifest on `window.headsup.manifest`.

### `emitReady()`

Signals that the canvas is loaded and ready for host-side post-load actions.

### `emitLifecycleComplete(action, payload?)`

Acknowledges that a renderer-managed lifecycle transition actually finished.

```js
emitLifecycleComplete('resume')
emitLifecycleComplete('exit', { reason: 'animation_done' })
```

Use this for transition acks such as `resume`, `enter`, or `exit` when the
daemon should wait on real renderer completion instead of a guessed delay.

### `onReady(handler)`

Convenience hook for inbound `ready` events.

## Panel API

Public entrypoint:

```js
import { mountPanel, mountChrome, Single, Tabs } from 'aos://toolkit/panel/index.js'
```

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
| `draggable` | `boolean` | whether header drag emits absolute move updates plus `drag_start` / `drag_end` lifecycle messages |

Returns an object with:

| Field / method | Meaning |
| --- | --- |
| `panelEl` | outer panel element |
| `headerEl` | header element |
| `titleEl` | title slot element |
| `controlsEl` | controls slot element |
| `contentEl` | content mount element |
| `setTitle(text)` | update the title slot |
| `setControls(html)` | replace controls slot contents with HTML |

Notes:

- `mountChrome()` adds the `aos-panel-root` class to the mount container
- the returned slot refs are the behavioral contract; consumers should not rely on querying `.aos-*` classes for runtime behavior
- when draggable, the stock header emits `drag_start` once on primary-button
  pointerdown, drives window movement through absolute drag updates, then emits
  `drag_end` on pointerup / cancel / lost capture

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
| `draggable` | `boolean` | whether the mounted stock header emits absolute drag updates plus `drag_start` / `drag_end` lifecycle messages |
| `container` | `HTMLElement` | mount target, default `document.body` |

### `Single(factoryOrContent)`

Wraps one content unit.

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
- `Tabs` may notify consumers when activation changes through `onActivate(info, host)`
- `Tabs` does **not** define a canonical visual design

Panel-level control/event surface:

- `tabs/activate` with `{ index }`, `{ name }`, or `{ title }`
- `tabs/activated` emitted when activation changes with `{ index, title, name }`
- the returned layout object also exposes `activate(payload)` for same-canvas programmatic activation
- consumers own the CSS for `.aos-tabs`, `.aos-tab`, `.aos-tab.active`, and `.aos-tab-content`
- `Tabs` mounts its strip into `chrome.controlsEl`; consumers should treat slot refs as the behavioral API and `.aos-*` classes as styling hooks
- active tab state is exposed via `.active`, `data-active`, `aria-selected`, and the `hidden` attribute on tab panels

## Content Contract

Content units are plain objects with a small lifecycle surface.

```js
export default function MyContent() {
  let contentEl = null

  return {
    manifest: {
      name: 'my-content',
      title: 'My Content',
      accepts: ['ping'],
      emits: ['pong'],
      channelPrefix: 'my',
      defaultSize: { w: 320, h: 200 },
      requires: ['canvas_lifecycle'],
    },

    render(host) {
      contentEl = document.createElement('div')
      contentEl.textContent = 'hello'
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'ping') host.emit('pong', { ok: true })
    },

    serialize() {
      return { text: contentEl?.textContent || '' }
    },

    restore(state) {
      if (contentEl && state?.text) contentEl.textContent = state.text
    },
  }
}
```

### `manifest`

Current consumer-facing fields:

| Field | Meaning |
| --- | --- |
| `name` | required unique content/canvas name |
| `title` | human-readable title, including tab label in `Tabs` |
| `accepts` | inbound message types this content handles |
| `emits` | outbound message types this content may emit |
| `channelPrefix` | routing prefix used by the panel router |
| `defaultSize` | preferred standalone size |
| `icon` | optional launcher/tab icon metadata |
| `requires` | daemon event streams to auto-subscribe |

### `render(host)`

Returns either:

- a `Node`
- an HTML `string`

### `onMessage(msg, host)`

Receives routed messages.

Routing rule:

- if a message type is prefixed with `channelPrefix/`, the router strips the prefix and delivers the remainder
- unmatched messages are broadcast to all contents that implement `onMessage`

### `serialize()` / `restore(state, host)`

Optional hooks for state transfer or future tear-off / redock flows.

## `ContentHost` Contract

Contents receive a host object from the panel layout.

Current host surface:

| Method / field | Meaning |
| --- | --- |
| `contentEl` | the content mount element |
| `setTitle(text)` | change panel title in `Single`; no-op in `Tabs` |
| `emit(type, payload?)` | emit a message, auto-prefixed by `channelPrefix` when present |
| `subscribe(events)` | subscribe to daemon streams |
| `spawnChild(opts)` | create a child canvas |
| `evalCanvas(id, js)` | run JS in another canvas |

## Styling Boundary

This is intentional and should be preserved.

- `panel/` JavaScript is structure and behavior, not canonical visual design.
- `components/_base/theme.css` provides shared tokens and minimal reset utilities only.
- `panel/defaults.css` is an optional stock layout/look baseline for standalone toolkit panels.
- apps, demos, and product surfaces may replace `panel/defaults.css` entirely.
- if you omit `panel/defaults.css`, you own the layout CSS for `aos-panel-root`, `aos-panel`, header/content slots, and any tab treatment
- stock typography, overflow, and scrollbar treatment belong in `panel/defaults.css` or consumer CSS, not in panel behavior code or content internals
- content-specific styling should target content-owned classes, not shell classes such as `.aos-content`

## Minimal Standalone Template

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="../_base/theme.css">
  <link rel="stylesheet" href="../../panel/defaults.css">
  <style>
    .body {
      padding: 12px;
    }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'

function Hello() {
  return {
    manifest: { name: 'hello', title: 'Hello' },
    render() {
      const el = document.createElement('div')
      el.className = 'body'
      el.textContent = 'hello'
      return el
    },
  }
}

mountPanel({ title: 'Hello', layout: Single(Hello) })
</script>
</body>
</html>
```

## Guidance For Maintainers

- update this doc when exported runtime/panel functions change
- update this doc when the content or host contract changes
- do not document `_dev/` demos as canon APIs
