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
  move,
  declareManifest,
  emitReady,
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
  `display_geometry` and `canvas_lifecycle`.

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

### `move(dx, dy)`

Relative move helper for the current canvas.

Used by the stock draggable header; intended for live drag behavior rather than absolute positioning.

### `declareManifest(manifest)`

Declares the canvas manifest on `window.headsup.manifest`.

### `emitReady()`

Signals that the canvas is loaded and ready for host-side post-load actions.

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
| `draggable` | `boolean` | whether header drag emits relative move events |

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
| `draggable` | `boolean` | whether header drag emits relative move events |
| `container` | `HTMLElement` | mount target, default `document.body` |

### `Single(factoryOrContent)`

Wraps one content unit.

### `Tabs(factoriesOrContents)`

Wraps multiple content units and shows one at a time.

Important boundary:

- `Tabs` provides structure and activation behavior
- `Tabs` does **not** define a canonical visual design
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
