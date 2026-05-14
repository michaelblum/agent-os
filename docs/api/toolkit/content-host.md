# Toolkit Content Host API

Consumer-facing reference for toolkit content authoring and hosting: content roots, import paths, Content factories, ContentHost, the styling boundary, and the minimal standalone template. Runtime bridge details live in [runtime.md](./runtime.md); panel composition lives in [panel-window.md](./panel-window.md).

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
