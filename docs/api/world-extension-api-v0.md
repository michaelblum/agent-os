# World Extension API — v0

**Status:** Experimental — Phase 2 One-World substrate.
**Stable path:** `docs/api/world-extension-api-v0.md`
**Entry module:** `apps/sigil/world/world-extension-api.js`
**Sample widget:** `apps/sigil/world/sample-widget/status-tile.js`
**Phase context:** `docs/dev/reports/aos-one-world-phase2-sub-task1-scheduler-v0.md`

This document specifies the extension API that a third-party widget or panel
must build against when running inside a co-located World document. It defines
what the API exposes, what theming hooks exist, and what "reaching into
internals" means — the boundary a third-party author must not cross.

---

## 1. Purpose

The World extension API is the public surface for code that extends the AOS
World from outside the renderer and daemon layers. A third-party widget — one
that does not have privileged access to the renderer, runtime, or daemon — can
mount into a World anchor, respond to frame ticks, bind to reactive signals,
and apply custom theming using only this API.

"Third-party-shaped" in this context means: **the code has no direct imports
from renderer internals or runtime internals** (see §5). The widget does not
need to understand the avatar renderer, the daemon IPC protocol, or the
WKWebView bridge to function.

---

## 2. API Surface

The entry module is `apps/sigil/world/world-extension-api.js`. Every symbol
a third-party widget needs is exported from this single module.

### 2.1 Signal primitives

```js
import {
    createSignal,
    createComputed,
    createEffect,
} from '../world-extension-api.js';
```

**`createSignal(initial)`** — creates a writable signal.
- `signal.get()` — returns the current value
- `signal.set(value)` — writes a new value; notifies subscribers if the value
  changed (identity check via `Object.is`)
- `signal.subscribe(fn)` — returns an unsubscribe function; `fn(value)` is
  called synchronously when the signal changes

**`createComputed(compute)`** — creates a derived (read-only) signal.
- Re-evaluates `compute()` lazily when any signal accessed inside changes.
- `computed.get()` — returns the current value (recomputes if dirty)
- `computed.subscribe(fn)` — notifies on each recomputation

**`createEffect(fn)`** — runs an effect and re-runs when signals accessed
inside change. The effect body may return a cleanup function.
- Returns `dispose()` — call to permanently stop the effect.

### 2.2 Mount point

```js
import { mountWidget } from '../world-extension-api.js';
```

**`mountWidget(host, factory, options?)`** — mounts a widget into a World
anchor element. Returns a `WidgetHandle`.

Parameters:
- `host: Element` — the DOM element to mount into (owned by the World document)
- `factory: WidgetFactory` — see §2.3
- `options.scheduler` — optional reference to the World's shared RAF scheduler.
  Pass `null` for standalone/test mode; provide the scheduler for frame ticks.
- `options.id` — optional contributor name (falls back to `factory.name`)

**`WidgetHandle`:**
| Property | Type | Description |
|---|---|---|
| `mountNode` | `Element` | isolated DOM element the widget renders into |
| `requestStructural()` | `() => void` | signal that avatar geometry changed this frame |
| `scheduleFrame()` | `() => void` | request a non-structural frame tick |
| `destroy()` | `() => void` | unmount and release all resources |

### 2.3 Widget factory contract

A widget factory is a plain object with these properties:

```js
{
    name: 'my-widget',           // string, used as RAF contributor name

    mount(handle) {              // WidgetHandle → optional cleanup fn
        // build DOM, subscribe to signals, attach event listeners
        return function cleanup() { /* tear down */ };
    },

    onFrame(ctx) {               // optional; called by the World RAF scheduler
        // ctx.structural: boolean — true if any contributor requested structural
        // ctx.contributors: string[] — contributor names active this frame
    },
}
```

The `mount` function receives the `WidgetHandle` and may return a cleanup
function. The cleanup is called when `handle.destroy()` is invoked.

### 2.4 Theming

```js
import { applyTheme, readToken } from '../world-extension-api.js';
```

**`applyTheme(rootElement, tokens)`** — applies CSS custom property overrides
to a root element. Keys may be `--aos-*` token names (to override global AOS
theme values within the widget's subtree) or custom `--widget-*` names.

```js
applyTheme(myRoot, {
    '--aos-panel-bg': 'rgba(28, 18, 6, 0.95)',
    '--widget-accent': '#ff9500',
});
```

**`readToken(element, name)`** — reads the resolved value of a CSS custom
property. Useful for reading inherited AOS tokens from within a widget.

```js
const radius = readToken(myRoot, '--aos-panel-radius');
```

The AOS canonical token names are defined in
`packages/toolkit/components/_base/theme.css` (served via the AOS content
server as `/toolkit/components/_base/theme.css`). Stable `--aos-*` tokens that
third-party widgets may consume:

| Token | Type | Description |
|---|---|---|
| `--aos-font-ui` | font-family | System UI font stack |
| `--aos-font-mono` | font-family | Monospace stack |
| `--aos-type-body` | font shorthand | 12px body text |
| `--aos-type-caption` | font shorthand | 10px caption |
| `--aos-type-label` | font shorthand | 10px monospace label |
| `--aos-panel-bg` | color | Panel background |
| `--aos-panel-border` | color | Panel border color |
| `--aos-panel-radius` | length | Panel border radius |
| `--aos-panel-shadow` | shadow | Panel drop shadow |
| `--aos-control-height` | length | Standard control height |
| `--aos-control-radius` | length | Control border radius |
| `--aos-focus-ring` | border | Keyboard focus ring |

Widgets may override any `--aos-*` token on their root element via `applyTheme`.
The override is scoped to the widget's subtree and does not affect sibling
widgets or the World document.

---

## 3. Signal Store Decision

Phase 1's `avatar-signal-store.js` is throwaway (pure pub/sub, no reactive
primitives). Phase 2 evaluated two options:

**Option A — tiny standalone signals library** (e.g. `@preact/signals-core`,
Solid's `createSignal`): best fit for ADR-0012's guidance to prefer a standalone
lib over hand-rolling reactivity. However, no suitable lib exists in the repo's
`node_modules` (only `@zag-js` state machines and `proxy-compare`), and
WKWebView surfaces use relative ES module imports without an import map or
bundler step. Adding a vendored ESM snapshot would require a maintenance
commitment not yet made.

**Option B — minimal hand-rolled reactive primitives**: implemented in
`world-extension-api.js`. Approximately 120 lines covering `createSignal`,
`createComputed`, and `createEffect`. Not a framework: no scheduler, no
concurrent rendering, no component model, no virtual DOM.

**Decision: Option B.** ADR-0012's warning targets bespoke reactive *frameworks*,
not small utility implementations. The implementation is in the same class as
a pub/sub utility — bounded, auditable, dependency-free.

**Revisit when:** a vetted ESM signals library is added to the repo's approved
dependency list. The signal API surface (`createSignal`, `createComputed`,
`createEffect`) would remain unchanged; only the implementation would be
swapped.

---

## 4. Scene Model

The scene model in this context is the **mounting contract** for light surfaces.
It is not a GPU object graph (Phase 5).

A widget has three resources:
1. **Mount node** — an isolated `<div>` element inside the World anchor.
   The widget owns its subtree; it does not read or write outside it.
2. **RAF contributor slot** — a named slot in the World's shared RAF scheduler.
   Acquired automatically by `mountWidget` when a scheduler is provided.
3. **Lifecycle** — `mount()` initializes, `destroy()` releases both resources.

The minimal resource pool for light surfaces is:
- Each widget gets one DOM subtree node (isolated; no shared DOM state).
- Each widget registers as one RAF contributor (unregistered on destroy).
- No GPU objects, no canvas contexts, no shared render state.

---

## 5. Internal Boundary

A third-party widget MUST NOT import or access:

### Forbidden imports
- `apps/sigil/renderer/live-modules/**` — all renderer live modules:
  `main.js`, `render-loop.js`, `host-runtime.js`, `scene.js`, `webgl-renderer.js`,
  `world-raf-scheduler.js`, `surface-transport-probe.js`, `input-regions.js`,
  `desktop-world-surface-runtime.js`, and all others in that directory.
- `apps/sigil/avatar-editor/**` — avatar editor internals (signal store,
  co-located panel prototype, compact surface).
- `apps/sigil/avatar-controls/**` — avatar control descriptors and sessions.
- `packages/toolkit/**` — toolkit internals (panel chrome, controls,
  runtime bridge). A widget MAY import `theme.css` via a stylesheet link,
  but MUST NOT import JS modules from the toolkit.

### Forbidden globals
- `window.__sigil*` — debug namespaces owned by the renderer.
- `window.__aosCanvasId`, `window.headsup`, `window.__aosHost` — WKWebView
  bridge state owned by the daemon/toolkit boundary.
- `window.webkit.messageHandlers.headsup` — the daemon bridge message handler.

### Forbidden DOM mutations
- Do not read or mutate DOM elements outside the widget's `mountNode` subtree.
- Do not query `document.body` or `document.documentElement` for renderer-owned
  elements (e.g. elements with `data-sigil-*` or `data-aos-renderer-*` attributes).

### Why this boundary
The daemon is the sole privileged broker (ADR-0015). The renderer and toolkit
own their internal state. A widget that reaches past this boundary becomes
coupled to implementation details that are not part of the public contract and
may break across World substrate versions.

---

## 6. Reviewer Confirmation

### 6.1 Static import-boundary check (gate 3)

The test at `tests/renderer/sigil-one-world-extension-api.test.mjs` performs
static import analysis on `status-tile.js` and asserts that:

1. Every import resolves to `../world-extension-api.js` (normalized).
2. No import matches any forbidden internal path pattern.
3. The test is reproducible by any reviewer:
   ```bash
   node --test tests/renderer/sigil-one-world-extension-api.test.mjs
   ```

A human reviewer can also confirm by reading `status-tile.js` directly:
the single `import { ... } from '../world-extension-api.js'` statement at the
top is the entire dependency graph of the sample widget.

### 6.2 Live browser verification (gate 2)

To confirm the widget runs in a co-located World document with the AOS runtime:

```bash
# Serve the widget from the AOS content server
./aos show create --id status-tile-sample \
  --url "http://127.0.0.1:<port>/sigil/world/sample-widget/status-tile.html" \
  --at 100,100,380,260 --interactive

# Verify widget mounted
./aos show eval --id status-tile-sample \
  --js "document.querySelector('[data-world-widget]').getAttribute('data-world-widget')"
# → "status-tile"

# Verify custom theme token applied
./aos show eval --id status-tile-sample \
  --js "getComputedStyle(document.querySelector('.status-tile')).getPropertyValue('--widget-accent').trim()"
# → "#ff9500"

# Verify reactive signal chain: click increments count AND updates computed status
./aos show eval --id status-tile-sample \
  --js "document.querySelector('[data-tile-btn]').click(); document.querySelector('[data-tile-count]').textContent + ' | ' + document.querySelector('[data-tile-status]').textContent"
# → "1 | warming"
```

The `<port>` is the AOS content server port — run `./aos content status --json`
to retrieve it. The `sigil` content root maps to `apps/sigil/`.

---

## 7. What is NOT in this API

The following are explicitly out of scope for v0:

- **GPU / visual-object resources** — deferred beyond this v0 API
- **Focus-group management** — backlog (Tab-loop trap, per-panel focus memory)
- **Daemon event subscriptions** — widgets do not subscribe to daemon streams
  directly; the World document receives events and distributes them in-heap
- **Multiple World instances / cross-display** — Phase 3+ concerns
- **Sandbox escape hatch for untrusted code** — backlog (isolated iframe/WKWebView
  escape for genuinely untrusted third-party code; mentioned in the architecture
  proposal §7 but not part of this API v0)

---

## 8. Versioning

This is **v0**: experimental, subject to change between Phase 2 and Phase 3.
When the substrate stabilizes (Phase 3 first-party migration), this document
will be updated to `v1` with a stability guarantee. Until then, treat the API
as internal infrastructure for the One-World workstream.
