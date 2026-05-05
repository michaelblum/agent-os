@../../AGENTS.md

# toolkit

Reusable WKWebView components built on agent-os primitives — the middle layer between the `aos` unified binary and Track 2 apps. See root `AGENTS.md` for the full layering picture.

Consumer-facing reference: [docs/api/toolkit.md](../../docs/api/toolkit.md)

## Layered model

```
aos daemon (Layer 0)           canvas.create/update/remove, subscribe streams, eval, content server
  └─ runtime/ (Layer 1a)       in-canvas helpers: bridge, subscribe, canvas mutation, manifest
       ├─ controls/            reusable app-control behavior for WKWebView surfaces
       ├─ panel/ (Layer 1b)    panel-shaped scaffolding: chrome, router, layouts (Single, SplitPane, Tabs)
       ├─ workbench/           subject descriptors and reusable workbench contracts
       │    └─ components/     reusable Content units consumed by panel layouts
       └─ apps/ (Layer 3)      presence surfaces use 1a directly; panels use 1a + 1b + 2
```

Every WKWebView surface (panel or presence) imports from `runtime/`. Surfaces
that need reusable app-control behavior import from `controls/`. Surfaces that
want chrome + content also import from `panel/`.

## Structure

```
runtime/                Layer 1a — universal canvas runtime
  bridge.js               wireBridge, emit, esc
  canvas-stats.js         lazy stats.js controller backing per-canvas window.aosStats
  subscribe.js            subscribe, unsubscribe to daemon streams
  canvas.js               spawnChild, mutateSelf, removeSelf, setInteractive, evalCanvas
  manifest.js             declareManifest, emitReady, emitLifecycleComplete, onReady
  index.js                re-exports
  _smoke/                 smoke harness
  vendor/                 vendored third-party runtime modules and licenses

controls/               Layer 1a — reusable app-control behavior for WKWebView surfaces
  number-field.js         focused wheel/key stepping for numeric fields
  index.js                re-exports

panel/                  Layer 1b — panel primitives
  chrome.js               mountChrome — pure DOM scaffold + drag/resize lifecycle + absolute drag updates, final drag clamp, resize frame updates, and optional maximize/restore state
  defaults.css            optional stock panel visuals (opt-in)
  router.js               createRouter — manifest-prefix dispatch
  layouts/
    single.js             Single(Content)
    split-pane.js         SplitPane(start, end) + createSplitPane DOM controller
    tabs.js               Tabs([Content...])
  mount.js                mountPanel orchestrator
  index.js                re-exports + Content typedef
  _smoke/                 smoke harness

workbench/              Layer 1c — workbench contracts
  subject.js              shared aos.workbench.subject descriptor helpers
  wiki-subject.js         wiki page → workbench subject projection helpers
  index.js                re-exports

components/             Layer 2 — reusable Content units
  _base/                  shared theme.css tokens/reset (legacy AosComponent retired)
  canvas-inspector/       live canvas list + lifecycle subscription
    styles.css              canonical component styles (link, don't copy)
  spatial-telemetry/      live coordinate grid + event log for display/canvas/mark debugging
    styles.css              canonical component styles (link, don't copy)
  render-performance/     live framerate + coarse renderer telemetry panel
    styles.css              canonical component styles (link, don't copy)
  inspector-panel/        AX-element inspector (driven by `aos inspect`)
    styles.css              canonical component styles (link, don't copy)
  log-console/            scrolling timestamped log (driven by `aos log push`)
    styles.css              canonical component styles (link, don't copy)
  wiki-kb/                wiki graph browser with graph + mind-map views
    styles.css              canonical component styles (link, don't copy)
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

2. Create `components/<name>/styles.css` with the component's visual styles. Use
   tokens from `theme.css` (e.g. `var(--text-muted)`) — never hardcode a parallel
   token system. This file is the canonical source; host pages `<link>` it.

3. Create `components/<name>/index.html` mounting via `mountPanel`:

```html
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="../_base/theme.css">
  <link rel="stylesheet" href="../../panel/defaults.css">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'
import MyContent from './index.js'
mountPanel({ title: 'My Content', layout: Single(MyContent) })
</script>
</body>
</html>
```

4. (Optional) Create `launch.sh` if the component needs bootstrap data.

## When to put something here vs. in an app

- **Toolkit (Layer 1/2)**: reusable across apps, not opinionated about a specific use case.
- **App (Layer 3)**: tied to a specific product (e.g., Sigil's avatar personality, agent doc schema). Lives in `apps/<name>/` and consumes Layer 1a (and optionally 1b/2).

## Styling Boundary

- `components/_base/theme.css` provides shared tokens/reset utilities.
- `panel/defaults.css` is the stock look for panel chrome (structure, header, tabs,
  scrollbar). Apps may override via cascade.
- Each component owns a `styles.css` with its visual presentation. Host pages
  `<link>` the stylesheets for the components they use — never duplicate the CSS
  inline. Consumers override via cascade (load after the component stylesheet).
- `panel/` JS provides structure and behavior only.
