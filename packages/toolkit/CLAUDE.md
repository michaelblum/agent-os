# toolkit

Reusable components built on agent-os primitives. The middle layer between Track 1 packages and Track 2 apps.

```
agent-os primitives (side-eye, display (via AOS daemon), hand-off)
  -> toolkit (shared components, patterns)
    -> apps (sigil, etc.)
```

## Structure

```
components/
  _base/          Shared bridge JS and theme CSS — inline into component HTML files
  *.html          Self-contained HTML components for aos canvases
```

## Components

Components are self-contained HTML files designed for `aos show create --url file://...`. They use the `headsup.receive()` bridge for configuration and communicate state via the manifest/messaging protocol.

| Component | What it does |
|-----------|-------------|
| `cursor-decor.html` | Three.js shape that follows cursor position, configurable geometry and color |
| `inspector-panel.html` | AX element metadata display — role, title, label, value, bounds, context path |
| `log-console.html` | Scrolling timestamped log with severity levels (info, warn, error, debug) |

## Shared Component Assets

`components/_base/` contains the source-of-truth for shared JavaScript and CSS used by all canvas components:

| File | What it provides |
|------|-----------------|
| `bridge.js` | `headsup.receive()` bridge, `esc()` helper, `onHeadsupMessage()` dispatch |
| `theme.css` | Transparent background, dark theme CSS custom properties, typography, scrollbar |

Components inline these assets directly (WKWebView `file://` loading doesn't support relative imports with the current canvas implementation). When creating a new component, copy the bridge and theme blocks from an existing component or from `_base/`.

## When to put something here vs. in an app

- **Toolkit**: reusable across apps, not opinionated about a specific use case
- **App**: tied to a specific product (e.g., sigil's avatar personality, radial menu config)
