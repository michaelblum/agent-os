@../../AGENTS.md

# toolkit Local Contract

`packages/toolkit/` is the reusable WKWebView component layer between AOS
primitives and Track 2 apps. It should stay reusable and app-agnostic.

Consumer-facing toolkit APIs belong in
[`docs/api/toolkit.md`](../../docs/api/toolkit.md). Keep this file focused on
local ownership and placement rules.

## Layer Model

```text
aos daemon (Layer 0)         canvas.create/update/remove, streams, eval, content server
  -> runtime/ (Layer 1a)     bridge, subscribe, canvas mutation, manifest helpers
     -> panel/ (Layer 1b)    chrome, router, layouts, panel mounting
        -> components/       reusable content units consumed by panels/apps
```

Every WKWebView surface imports from `runtime/`. Surfaces that want stock
chrome, routing, and layouts import from `panel/`.

## Structure

```text
runtime/                universal canvas runtime
panel/                  panel primitives and layouts
components/             reusable content units
components/_base/       shared theme tokens/reset
components/_dev/        non-canonical developer demos
```

Treat `_dev` demos as examples only. Do not use them as canonical app or test
contracts.

## Placement Rules

- Put reusable, app-agnostic WKWebView runtime behavior in `runtime/`.
- Put reusable panel shell behavior in `panel/`.
- Put reusable content units in `components/`.
- Keep product-specific behavior in `apps/<name>/` unless it clearly benefits
  multiple apps.
- Do not make `packages/gateway/` or `packages/host/` depend on toolkit as a
  middle layer; they are peer consumers of AOS primitives.

## Styling Boundary

- `components/_base/theme.css` provides shared tokens/reset utilities.
- `panel/defaults.css` is the stock look for panel chrome.
- Each component owns a `styles.css` with its visual presentation.
- Host pages link component stylesheets; do not duplicate component CSS inline.
- Consumers override via cascade by loading after component stylesheets.
- `panel/` JavaScript provides structure and behavior, not component visuals.

## Accessibility And Semantics

Toolkit surfaces should expose normal macOS-style accessibility semantics and
AOS metadata for actionable controls. Canvas/WebGL controls need semantic
companions when they are actionable or stateful.

Follow [`docs/recipes/aos-app-accessibility-surfaces.md`](../../docs/recipes/aos-app-accessibility-surfaces.md)
for app and toolkit accessibility contracts.

## Verification

For pure toolkit JavaScript, prefer focused Node tests. For surfaces projected
through `aos://toolkit/...`, configure the content root and use AOS show/wait
checks only when runtime behavior depends on the daemon or WKWebView:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos show create --id <id> --url aos://toolkit/components/<name>/index.html
./aos show wait --id <id> --manifest <manifest-name>
```
