# toolkit

Reusable WKWebView components built on agent-os primitives — the middle layer between the `aos` unified binary and Track 2 apps. See root `CLAUDE.md` for the full layering picture.

```
aos primitives (perceive/display/act/voice via the AOS daemon)
  -> packages/toolkit (shared components + AosComponent framework)
    -> apps/ (sigil, etc.)
```

## Structure

```
components/
  _base/
    bridge.js       ES module — headsup bridge (esc, initBridge, postToHost)
    base.js         ES module — AosComponent base class (panel chrome, drag, bridge wiring)
    theme.css       Shared dark theme (CSS custom properties, panel/header classes)
  canvas-inspector/ Multi-file component — display/canvas debug tool
    index.html      Entry point (loads theme.css + inspector.js)
    inspector.js    Component logic (extends AosComponent)
    launch.sh       Bootstrap script (creates canvas, sends initial data, relays events)
  cursor-decor.html   Legacy single-file component (Three.js cursor shape)
  inspector-panel.html Legacy single-file component (AX inspector)
  log-console.html    Legacy single-file component (scrolling log)
```

## Content Server

Components are served via the AOS content server over `aos://toolkit/...` URLs. This enables real ES module imports between files.

**Setup:** `aos set content.roots.toolkit packages/toolkit`

**Loading a component:** `aos show create --id my-component --url aos://toolkit/components/my-component/index.html`

## Creating a New Component

1. Create a directory under `components/` (e.g., `components/my-tool/`)
2. Create `index.html` that links `../_base/theme.css` and imports from `../_base/base.js`
3. Create your component JS as an ES module extending `AosComponent`
4. Optionally create a `launch.sh` for bootstrap logic

```js
import { AosComponent, esc } from '../_base/base.js';

class MyTool extends AosComponent {
  constructor() {
    super({ title: 'My Tool', id: 'my-tool' });
  }

  onMessage(msg) {
    // Handle incoming headsup messages
  }

  renderContent() {
    return '<div>Content here</div>';
  }
}

new MyTool().mount(document.getElementById('app'));
```

## Legacy Components

The single-file `.html` components (`cursor-decor`, `inspector-panel`, `log-console`) inline their bridge and theme code. They work via `file://` URLs and don't require the content server. New components should use the base class pattern instead.

## When to put something here vs. in an app

- **Toolkit**: reusable across apps, not opinionated about a specific use case
- **App**: tied to a specific product (e.g., sigil's avatar personality, radial menu config)
