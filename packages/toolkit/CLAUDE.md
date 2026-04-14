# toolkit

Reusable WKWebView components built on agent-os primitives — the middle layer between the `aos` unified binary and Track 2 apps. See root `CLAUDE.md` for the full layering picture.

## Layered model

```
aos daemon (Layer 0)         canvas.create/update/remove, subscribe streams, eval, content server
  └─ runtime/ (Layer 1a)     in-canvas helpers: bridge, subscribe, canvas mutation, manifest
       ├─ panel/ (Layer 1b)  panel-shaped scaffolding: chrome, router, layouts (Single, Tabs)
       │    └─ components/   reusable Content units consumed by panel layouts
       └─ apps/ (Layer 3)    presence surfaces use 1a directly; panels use 1a + 1b + 2
```

Every WKWebView surface (panel or presence) imports from `runtime/`. Surfaces that want chrome + content also import from `panel/`.

## Structure

```
runtime/                Layer 1a — universal canvas runtime
  bridge.js               wireBridge, emit, esc
  subscribe.js            subscribe, unsubscribe to daemon streams
  canvas.js               spawnChild, mutateSelf, removeSelf, setInteractive
  manifest.js             declareManifest, emitReady, onReady
  index.js                re-exports
  _smoke/                 smoke harness

panel/                  Layer 1b — panel primitives
  chrome.js               mountChrome — pure DOM scaffold
  router.js               createRouter — manifest-prefix dispatch
  layouts/
    single.js             Single(Content)
    tabs.js               Tabs([Content...])
  mount.js                mountPanel orchestrator
  index.js                re-exports + Content typedef
  _smoke/                 smoke harness

components/             Layer 2 — reusable Content units
  _base/                  shared theme.css (legacy AosComponent retired)
  canvas-inspector/       live canvas list + lifecycle subscription
  inspector-panel/        AX-element inspector (driven by `aos inspect`)
  log-console/            scrolling timestamped log (driven by `aos log push`)
  _dev/                   developer demos
    tabs-demo/            all three components in one Tabs panel
```

## Content Server

Components are served via the AOS content server over `aos://toolkit/...` URLs.

**Setup:** `aos set content.roots.toolkit packages/toolkit`

**Loading a component standalone:** `aos show create --id <id> --url aos://toolkit/components/<name>/index.html`

## Creating a New Component

1. Create `components/<name>/index.js` exporting a default Content factory:

```js
import { esc } from '../../runtime/bridge.js'

export default function MyContent() {
  let contentEl = null
  let state = { /* private */ }
  return {
    manifest: {
      name: 'my-content',
      title: 'My Content',
      channelPrefix: 'my',
      accepts: ['ping'],
      emits: ['pong'],
      defaultSize: { w: 320, h: 200 },
    },
    render(host) {
      contentEl = document.createElement('div')
      contentEl.textContent = 'hello'
      return contentEl
    },
    onMessage(msg, host) {
      if (msg.type === 'ping') host.emit('pong')
    },
  }
}
```

2. Create `components/<name>/index.html` mounting via `mountPanel`:

```html
<!doctype html>
<html><body><script type="module">
import { mountPanel, Single } from '../../panel/index.js'
import MyContent from './index.js'
mountPanel({ title: 'My Content', layout: Single(MyContent) })
</script></body></html>
```

3. (Optional) Create `launch.sh` if the component needs bootstrap data.

## When to put something here vs. in an app

- **Toolkit (Layer 1/2)**: reusable across apps, not opinionated about a specific use case.
- **App (Layer 3)**: tied to a specific product (e.g., Sigil's avatar personality, agent doc schema). Lives in `apps/<name>/` and consumes Layer 1a (and optionally 1b/2).
