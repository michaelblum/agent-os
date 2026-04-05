# toolkit

Reusable components built on agent-os primitives. The middle layer between Track 1 packages and Track 2 apps.

```
agent-os primitives (side-eye, heads-up, hand-off)
  -> toolkit (shared components, patterns)
    -> apps (sigil, etc.)
```

## Structure

```
components/     HTML/CSS/JS templates loaded into heads-up canvases
patterns/       Reusable code patterns (IPC helpers, state machines, etc.)
```

## Components

Components are self-contained HTML files designed for `heads-up create --url file://...`. They use the `headsup.receive()` bridge for configuration and communicate state via the manifest/messaging protocol.

| Component | What it does |
|-----------|-------------|
| `cursor-decor.html` | Three.js shape that follows cursor position, configurable geometry and color |

## When to put something here vs. in an app

- **Toolkit**: reusable across apps, not opinionated about a specific use case
- **App**: tied to a specific product (e.g., sigil's avatar personality, radial menu config)
