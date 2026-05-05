# Canvas Runtime + Toolkit Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `packages/toolkit/_base/` from a monolithic `AosComponent` class into a layered foundation: **canvas runtime** (Layer 1a — universal in-canvas helpers) and **panel primitives** (Layer 1b — chrome, content contract, router, layouts). Migrate the three existing toolkit components to consume the new foundation. Ship a working `Tabs` layout end-to-end demo. Retire `AosComponent`.

**Architecture:** Strangler-fig migration. Build new layers alongside the old one; migrate consumers one at a time; delete the old when nothing imports it. Each task is a single commit with smoke verification. No automated test runner exists for the toolkit's WKWebView components — verification is "launch the canvas + exercise primary function + grep daemon log for JS errors," consistent with the project's established pattern (see `apps/sigil/tests/`).

**Tech Stack:** Plain ES modules (no bundler), WKWebView in macOS canvases, served via the AOS content server at `aos://toolkit/...`. One Swift change to the daemon for `canvas_lifecycle` fan-out to subscribed canvases. Build commands: `bash build.sh` for the daemon; toolkit code is no-build.

**Spec:** `docs/superpowers/specs/2026-04-14-canvas-runtime-and-toolkit-primitives-design.md`

---

## Pre-flight

Before starting, ensure:

- `aos` daemon is built and running. From repo root: `bash build.sh && ./aos serve` (or rely on launchd if installed).
- Content server has the toolkit root registered: `./aos set content.roots.toolkit packages/toolkit` (idempotent).
- Verify the daemon is reachable: `./aos doctor --json | grep daemon_running` should report `true`.

---

## Task 1: Add `canvas_lifecycle` fan-out to subscribed canvases (Layer 0 enhancement)

**Why:** Today's daemon broadcasts `canvas_lifecycle` events to NDJSON socket subscribers (`aos show listen`), but **not** to canvases that subscribe via the in-canvas `subscribe` mechanism. The toolkit's `canvas-inspector` component needs lifecycle events to render its live canvas list. Without this, the migration in Task 4 can't drop its `launch.sh` event-relay subprocess.

This task adds a `fanOutCanvasLifecycle` function mirroring the existing `fanOutWikiPageChanged` (`src/daemon/unified.swift:364-385`).

**Files:**
- Modify: `src/daemon/unified.swift` — add `fanOutCanvasLifecycle`, call from existing broadcast site at line 202.

- [ ] **Step 1: Read the existing wiki fan-out function for the pattern**

Read `src/daemon/unified.swift:364-385` to see how `fanOutWikiPageChanged` is structured. Note the shape:
- Iterate `canvasEventSubscriptions`, filter by event name.
- For each target canvas, base64-encode `{type, payload}` and `evalAsync` `headsup.receive("<b64>")`.

- [ ] **Step 2: Locate the existing broadcast site**

Read `src/daemon/unified.swift:200-205`. The line `self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)` is where lifecycle events go to NDJSON subscribers. The new in-canvas fan-out goes alongside this call.

- [ ] **Step 3: Add `fanOutCanvasLifecycle` function**

In `src/daemon/unified.swift`, add this function alongside `fanOutWikiPageChanged` (around line 385):

```swift
    /// Fan out a canvas_lifecycle event to every canvas that has subscribed
    /// to the `canvas_lifecycle` channel. Mirror of fanOutWikiPageChanged.
    /// Used by toolkit components (canvas-inspector) that need live awareness
    /// of canvas create/update/remove events.
    func fanOutCanvasLifecycle(_ data: [String: Any]) {
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("canvas_lifecycle") }
            .map { $0.key }
        guard !targets.isEmpty else { return }

        let msg: [String: Any] = ["type": "canvas_lifecycle", "payload": data]
        guard let json = try? JSONSerialization.data(withJSONObject: msg),
              let jsonStr = String(data: json, encoding: .utf8) else { return }
        let b64 = Data(jsonStr.utf8).base64EncodedString()
        let js = "window.headsup.receive(\"\(b64)\")"

        for canvasID in targets {
            canvasManager.evalAsync(canvasID: canvasID, js: js)
        }
    }
```

- [ ] **Step 4: Wire it into the broadcast site**

In `src/daemon/unified.swift`, find the line:

```swift
self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
```

Add a call to the new function immediately after it:

```swift
self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
self.fanOutCanvasLifecycle(data)
```

- [ ] **Step 5: Build the daemon**

Run from repo root:

```bash
bash build.sh
```

Expected: `Build succeeded` and `./aos` updated. Build time ~30s.

- [ ] **Step 6: Restart the daemon**

```bash
./aos service restart
sleep 1
./aos doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('daemon_running:', d['runtime']['daemon_running'])"
```

Expected: `daemon_running: True`

- [ ] **Step 7: Smoke-verify the fan-out works**

Create a quick test page and launch it. Run from repo root:

```bash
mkdir -p /tmp/aos-task1-smoke
cat > /tmp/aos-task1-smoke/index.html <<'HTML'
<!doctype html>
<html><body style="background:#222;color:#fff;font-family:monospace;padding:8px">
<div id="log">subscribing...</div>
<script>
const log = document.getElementById('log')
const lines = []
window.headsup = {
  receive(b64) {
    try {
      const msg = JSON.parse(atob(b64))
      lines.push(JSON.stringify(msg))
      log.textContent = lines.join('\n')
    } catch(e) { lines.push('decode-error: ' + e.message); log.textContent = lines.join('\n') }
  }
}
window.webkit.messageHandlers.headsup.postMessage({type: 'subscribe', payload: {events: ['canvas_lifecycle']}})
log.textContent = 'subscribed; waiting for events'
</script>
</body></html>
HTML

./aos show create --id task1-smoke --at 100,100,400,200 --interactive --html "$(cat /tmp/aos-task1-smoke/index.html)"
sleep 1

# Trigger a lifecycle event by creating + removing another canvas
./aos show create --id task1-trigger --at 600,100,200,100 --html '<div style="background:#444;color:#fff;padding:8px">trigger</div>'
sleep 1
./aos show remove --id task1-trigger
sleep 1
```

Then visually inspect the `task1-smoke` canvas. Expected: it shows at least two messages — one for `task1-trigger` create, one for remove. If empty, the fan-out is broken.

Cleanup: `./aos show remove --id task1-smoke && rm -rf /tmp/aos-task1-smoke`

- [ ] **Step 8: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "$(cat <<'EOF'
feat(daemon): fan out canvas_lifecycle events to subscribed canvases

Mirrors fanOutWikiPageChanged. Enables toolkit components (canvas-inspector)
to track canvas create/update/remove via in-canvas subscribe instead of an
external launch.sh event-relay subprocess.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build Layer 1a — Canvas runtime (universal in-canvas helpers)

**Why:** Centralize the bridge plumbing every WKWebView surface reimplements today. Pure-function module, no class hierarchy. Splits responsibilities into focused files (~30-80 lines each) so an agent can hold any one in context.

**Files:**
- Create: `packages/toolkit/runtime/bridge.js` — `wireBridge`, `emit`, `esc`
- Create: `packages/toolkit/runtime/subscribe.js` — `subscribe`, `unsubscribe`
- Create: `packages/toolkit/runtime/canvas.js` — `spawnChild`, `mutateSelf`, `removeSelf`, `setInteractive`
- Create: `packages/toolkit/runtime/manifest.js` — `declareManifest`, `emitReady`, `onReady`
- Create: `packages/toolkit/runtime/index.js` — re-exports
- Create: `packages/toolkit/runtime/_smoke/index.html` — smoke harness

- [ ] **Step 1: Create `bridge.js`**

`packages/toolkit/runtime/bridge.js`:

```js
// bridge.js — wire the WKWebView ↔ daemon channel.
//
// Every surface in a canvas calls wireBridge() once at boot to install a
// router for incoming messages. emit() sends messages back to the daemon.
// esc() is the universal HTML-escape helper used by chrome and contents.

const handlers = []

export function wireBridge(handler) {
  if (typeof handler === 'function') handlers.push(handler)
  if (window.headsup && window.headsup.receive) return  // already wired
  window.headsup = window.headsup || {}
  window.headsup.receive = function (b64) {
    let msg
    try {
      msg = JSON.parse(atob(b64))
    } catch (e) {
      console.error('[runtime] bridge decode error', e)
      return
    }
    for (const h of handlers) {
      try { h(msg) } catch (e) { console.error('[runtime] handler error', e) }
    }
  }
}

export function emit(type, payload) {
  const body = payload === undefined ? { type } : { type, payload }
  window.webkit?.messageHandlers?.headsup?.postMessage(body)
}

export function esc(s) {
  if (s === null || s === undefined) return ''
  const d = document.createElement('div')
  d.textContent = String(s)
  return d.innerHTML
}
```

- [ ] **Step 2: Create `subscribe.js`**

`packages/toolkit/runtime/subscribe.js`:

```js
// subscribe.js — subscribe / unsubscribe to daemon event streams.
//
// Wraps the daemon's {type:'subscribe', payload:{events:[...]}} convention.
// Per-event handlers are attached via wireBridge — this just manages the
// daemon-side subscription set.

import { emit } from './bridge.js'

export function subscribe(events) {
  const list = Array.isArray(events) ? events : [events]
  emit('subscribe', { events: list })
}

export function unsubscribe(events) {
  const list = Array.isArray(events) ? events : [events]
  emit('unsubscribe', { events: list })
}
```

- [ ] **Step 3: Create `canvas.js`**

`packages/toolkit/runtime/canvas.js`:

```js
// canvas.js — JS-side ergonomics over the canvas mutation API.
//
// spawnChild and removeSelf use request_id round-trips for ack; mutateSelf
// is fire-and-forget (matches daemon semantics from the 2026-04-11 spec).

import { emit, wireBridge } from './bridge.js'

const pending = new Map()  // request_id → { resolve, reject, timer }
let routerInstalled = false

function installResponseRouter() {
  if (routerInstalled) return
  routerInstalled = true
  wireBridge((msg) => {
    if (msg?.type !== 'canvas.response') return
    const rid = msg.request_id
    const entry = pending.get(rid)
    if (!entry) return
    pending.delete(rid)
    clearTimeout(entry.timer)
    if (msg.status === 'ok') entry.resolve({ id: msg.id })
    else entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`))
  })
}

function nextRequestId() {
  return 'r-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

function rpc(type, payload, timeoutMs = 5000) {
  installResponseRouter()
  const request_id = nextRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      reject(new Error(`TIMEOUT: ${type} (${timeoutMs}ms)`))
    }, timeoutMs)
    pending.set(request_id, { resolve, reject, timer })
    emit(type, { ...payload, request_id })
  })
}

export function spawnChild(opts) {
  // opts: { id, url, at: [x,y,w,h], interactive?: bool }
  return rpc('canvas.create', opts)
}

export function mutateSelf(opts) {
  // opts: { frame?: [x,y,w,h], interactive?: bool }
  // fire-and-forget; daemon logs errors
  emit('canvas.update', opts)
}

export function removeSelf(opts = {}) {
  // opts: { orphan_children?: bool }
  return rpc('canvas.remove', opts)
}

export function setInteractive(interactive) {
  mutateSelf({ interactive: !!interactive })
}
```

- [ ] **Step 4: Create `manifest.js`**

`packages/toolkit/runtime/manifest.js`:

```js
// manifest.js — declare what this canvas is and lifecycle handshake.
//
// declareManifest attaches {name, accepts, emits, ...} to window.headsup so
// future tooling (orchestrators, launchers) can discover canvas capabilities.
// emitReady signals the daemon the canvas is loaded — used by --focus and
// other one-shot post-load actions.

import { emit, wireBridge } from './bridge.js'

export function declareManifest(manifest) {
  window.headsup = window.headsup || {}
  window.headsup.manifest = manifest
}

export function emitReady() {
  emit('ready', window.headsup?.manifest)
}

export function onReady(handler) {
  // Convenience: wire bridge + dispatch ready handler when daemon sends it back.
  // Most consumers won't need this; included for symmetry with emitReady.
  wireBridge((msg) => {
    if (msg?.type === 'ready' && typeof handler === 'function') handler(msg)
  })
}
```

- [ ] **Step 5: Create `index.js`**

`packages/toolkit/runtime/index.js`:

```js
// runtime/index.js — re-exports for convenient importing.
//
// Consumers can import everything from one path:
//   import { wireBridge, emit, subscribe, spawnChild, declareManifest }
//     from 'aos://toolkit/runtime/index.js'
// or import from individual modules for tighter dependencies.

export { wireBridge, emit, esc } from './bridge.js'
export { subscribe, unsubscribe } from './subscribe.js'
export { spawnChild, mutateSelf, removeSelf, setInteractive } from './canvas.js'
export { declareManifest, emitReady, onReady } from './manifest.js'
```

- [ ] **Step 6: Create the smoke harness**

`packages/toolkit/runtime/_smoke/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 8px; background: #111; color: #ddd;
                 font-family: ui-monospace, monospace; font-size: 12px; }
    .ok { color: #4ade80; } .err { color: #f87171; }
    pre { white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
<h3>runtime smoke</h3>
<pre id="log"></pre>
<script type="module">
import { wireBridge, emit, esc, subscribe, mutateSelf, declareManifest, emitReady }
  from '../index.js'

const log = document.getElementById('log')
const lines = []
function say(line, ok = true) {
  lines.push(`<span class="${ok ? 'ok' : 'err'}">${esc(line)}</span>`)
  log.innerHTML = lines.join('\n')
}

declareManifest({ name: 'runtime-smoke', accepts: ['ping'], emits: ['ready', 'pong'] })
say('manifest declared: ' + JSON.stringify(window.headsup.manifest))

wireBridge((msg) => {
  say('received: ' + JSON.stringify(msg))
  if (msg.type === 'ping') emit('pong', { echo: msg.payload })
})
say('bridge wired')

subscribe(['display_geometry'])
say('subscribed to display_geometry (expect a snapshot any moment)')

emitReady()
say('emitted ready')

setTimeout(() => mutateSelf({ frame: [100, 100, 480, 320] }), 500)
say('queued self-resize (480x320) at +500ms')
</script>
</body>
</html>
```

- [ ] **Step 7: Smoke-verify Layer 1a**

Launch the smoke harness:

```bash
./aos show create --id runtime-smoke \
  --at 200,200,520,360 \
  --interactive \
  --url 'aos://toolkit/runtime/_smoke/index.html'
```

Wait 2 seconds, then visually inspect:
1. The "manifest declared" line shows the manifest object.
2. A "received: {...display_geometry...}" line appears (proves subscribe + bridge wiring).
3. The window resizes itself at +500ms (proves mutateSelf).

Cleanup: `./aos show remove --id runtime-smoke`

If the canvas shows JS errors instead, check the console via Safari's Develop → Agent-OS menu (WKWebView remote inspector). Common failure: import path wrong. The content server expects `aos://toolkit/runtime/_smoke/index.html` to map to `packages/toolkit/runtime/_smoke/index.html` — verify with `./aos content status --json`.

- [ ] **Step 8: Commit**

```bash
git add packages/toolkit/runtime
git commit -m "$(cat <<'EOF'
feat(toolkit): add Layer 1a canvas runtime helpers

Composable in-canvas helpers (bridge, subscribe, canvas mutation, manifest)
that wrap the daemon's wire convention. Pure-function modules, no class
hierarchy. Smoke harness at runtime/_smoke/.

Lays foundation for Layer 1b panel primitives and per-component migrations.
AosComponent unchanged in this commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build Layer 1b — Panel primitives (chrome, router, Single layout, mountPanel)

**Why:** Build the panel-shaped scaffolding that consumes Layer 1a. Provides chrome (header + drag), the channel router (manifest-prefix dispatch), the Single layout (one content per panel), and `mountPanel` as the entry point.

**Files:**
- Create: `packages/toolkit/panel/chrome.js` — `mountChrome`
- Create: `packages/toolkit/panel/router.js` — `createRouter`
- Create: `packages/toolkit/panel/layouts/single.js` — `Single`
- Create: `packages/toolkit/panel/mount.js` — `mountPanel`
- Create: `packages/toolkit/panel/index.js` — re-exports + Content typedef
- Create: `packages/toolkit/panel/_smoke/index.html` — smoke harness

- [ ] **Step 1: Create `chrome.js`**

`packages/toolkit/panel/chrome.js`:

```js
// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports drag deltas via the runtime's mutateSelf.

import { mutateSelf } from '../runtime/canvas.js'
import { esc } from '../runtime/bridge.js'

export function mountChrome(container, { title = 'AOS', draggable = true } = {}) {
  container.innerHTML = ''
  container.style.cssText = 'margin:0;height:100vh;display:flex;flex-direction:column;'

  const panel = document.createElement('div')
  panel.className = 'aos-panel'
  panel.style.cssText = 'flex:1;display:flex;flex-direction:column;background:#1a1a1a;color:#ddd;font-family:ui-monospace,monospace;font-size:12px;border-radius:6px;overflow:hidden;'

  const header = document.createElement('div')
  header.className = 'aos-header'
  header.style.cssText = 'padding:6px 10px;border-bottom:1px solid #333;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;cursor:' + (draggable ? 'grab' : 'default') + ';user-select:none;background:#222;'
  header.innerHTML = `<span class="aos-title">${esc(title)}</span><span class="aos-controls"></span>`

  const content = document.createElement('div')
  content.className = 'aos-content'
  content.style.cssText = 'flex:1;overflow:auto;'

  panel.appendChild(header)
  panel.appendChild(content)
  container.appendChild(panel)

  if (draggable) wireDrag(header)

  return {
    panelEl: panel,
    headerEl: header,
    contentEl: content,
    setTitle(text) { header.querySelector('.aos-title').textContent = text },
    setControls(html) { header.querySelector('.aos-controls').innerHTML = html },
  }
}

function wireDrag(header) {
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.aos-controls')) return
    let lastX = e.screenX, lastY = e.screenY
    header.style.cursor = 'grabbing'
    const onMove = (ev) => {
      const dx = ev.screenX - lastX
      const dy = ev.screenY - lastY
      lastX = ev.screenX; lastY = ev.screenY
      // Use the legacy relative move type — daemon supports both move_abs and move.
      window.webkit?.messageHandlers?.headsup?.postMessage({ type: 'move', dx, dy })
    }
    const onUp = () => {
      header.style.cursor = 'grab'
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}
```

- [ ] **Step 2: Create `router.js`**

`packages/toolkit/panel/router.js`:

```js
// router.js — manifest-prefix message dispatch.
//
// Hosts (Single, Tabs, etc.) install a router that maps incoming message types
// to the right content. Type prefix matches manifest.channelPrefix; on match,
// the prefix is stripped and the remainder is delivered to content.onMessage.
//
// Messages with no recognized prefix fall through to a fallback handler
// (default: drop with a warning).

export function createRouter({ contents, hostByContent }) {
  // contents: array of Content objects
  // hostByContent: Map<Content, ContentHost>

  const byPrefix = new Map()
  for (const c of contents) {
    const prefix = c.manifest?.channelPrefix
    if (prefix) byPrefix.set(prefix, c)
  }

  return function route(msg) {
    if (!msg || typeof msg.type !== 'string') return
    const slash = msg.type.indexOf('/')
    if (slash > 0) {
      const prefix = msg.type.slice(0, slash)
      const rest = msg.type.slice(slash + 1)
      const content = byPrefix.get(prefix)
      if (content && typeof content.onMessage === 'function') {
        content.onMessage({ type: rest, payload: msg.payload }, hostByContent.get(content))
        return
      }
    }
    // No prefix or no match — broadcast to every content that has onMessage.
    // Contents can choose to ignore unknown types.
    for (const c of contents) {
      if (typeof c.onMessage === 'function') {
        c.onMessage(msg, hostByContent.get(c))
      }
    }
  }
}
```

- [ ] **Step 3: Create `layouts/single.js`**

`packages/toolkit/panel/layouts/single.js`:

```js
// single.js — one content, full panel body.
//
// Single(factory) returns a layout instance. mountPanel calls layout.mount(host)
// to instantiate and attach the content.

export function Single(factory) {
  return {
    kind: 'single',
    factory,
    instantiate() {
      // factory may be a function (call it) or already a Content object (use as-is).
      return typeof factory === 'function' ? factory() : factory
    },
  }
}
```

- [ ] **Step 4: Create `mount.js`**

`packages/toolkit/panel/mount.js`:

```js
// mount.js — entry point that orchestrates chrome + content + bridge wiring.
//
// Consumers call mountPanel({ title, layout: Single(Content) }) once at boot.

import { mountChrome } from './chrome.js'
import { wireBridge, emit } from '../runtime/bridge.js'
import { subscribe } from '../runtime/subscribe.js'
import { spawnChild } from '../runtime/canvas.js'
import { declareManifest, emitReady } from '../runtime/manifest.js'
import { createRouter } from './router.js'

export function mountPanel({ title = 'AOS', layout, draggable = true, container = document.body } = {}) {
  if (!layout) throw new Error('mountPanel: layout is required')

  const chrome = mountChrome(container, { title, draggable })

  if (layout.kind === 'single') {
    const content = layout.instantiate()
    mountSingle(chrome, content)
  } else if (layout.kind === 'tabs') {
    layout.mount(chrome)
  } else {
    throw new Error(`mountPanel: unknown layout kind '${layout.kind}'`)
  }

  return chrome
}

function mountSingle(chrome, content) {
  const host = makeHost(chrome.contentEl, content)
  if (content.manifest) declareManifest(content.manifest)

  const router = createRouter({
    contents: [content],
    hostByContent: new Map([[content, host]]),
  })
  wireBridge(router)

  // Auto-subscribe to streams declared in manifest.requires
  const requires = content.manifest?.requires || []
  if (requires.length > 0) subscribe(requires)

  // Render
  const rendered = content.render(host)
  chrome.contentEl.innerHTML = ''
  if (rendered instanceof Node) chrome.contentEl.appendChild(rendered)
  else if (typeof rendered === 'string') chrome.contentEl.innerHTML = rendered

  emitReady()
}

function makeHost(contentEl, content) {
  return {
    contentEl,
    emit(type, payload) {
      const prefix = content.manifest?.channelPrefix
      const fullType = prefix ? `${prefix}/${type}` : type
      emit(fullType, payload)
    },
    subscribe(events) { subscribe(events) },
    spawnChild(opts) { return spawnChild(opts) },
  }
}
```

- [ ] **Step 5: Create `index.js`**

`packages/toolkit/panel/index.js`:

```js
// panel/index.js — public surface.
//
// Content contract (JSDoc typedef for editor support):
//
// @typedef {Object} Manifest
// @property {string} name                              Required. Unique per canvas.
// @property {string[]} [accepts]                       Inbound message types this content handles.
// @property {string[]} [emits]                         Outbound message types this content sends.
// @property {string} [title]                           Human-readable label (used as tab title).
// @property {{w:number,h:number}} [defaultSize]        Used by tear-off / standalone hosts.
// @property {string} [channelPrefix]                   Used by the channel router.
// @property {string} [icon]                            Used by launchers / tab strips.
// @property {string[]} [requires]                      Daemon event streams to auto-subscribe.
//
// @typedef {Object} Content
// @property {Manifest} [manifest]
// @property {(host: ContentHost) => Node|string} render
// @property {(msg: object, host: ContentHost) => void} [onMessage]
// @property {() => unknown} [serialize]
// @property {(state: unknown, host: ContentHost) => void} [restore]

export { mountPanel } from './mount.js'
export { mountChrome } from './chrome.js'
export { Single } from './layouts/single.js'
```

- [ ] **Step 6: Create the smoke harness**

`packages/toolkit/panel/_smoke/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: transparent; font-family: ui-monospace, monospace; font-size: 12px; color: #ddd; }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../index.js'
import { esc } from '../../runtime/bridge.js'

function HelloContent() {
  let contentEl = null
  let pingCount = 0
  return {
    manifest: { name: 'hello', accepts: ['ping'], emits: ['pong'], channelPrefix: 'hello' },
    render(host) {
      contentEl = document.createElement('div')
      contentEl.style.cssText = 'padding:12px;line-height:1.6;'
      contentEl.innerHTML = `
        <div>panel/_smoke — hello content</div>
        <div>pings received: <span id="cnt">0</span></div>
        <div>send a ping:
          <code style="background:#333;padding:2px 6px;border-radius:3px;">
            ./aos show eval --id panel-smoke --js 'window.headsup.receive(btoa(JSON.stringify({type:"hello/ping",payload:{n:42}})))'
          </code>
        </div>
      `
      return contentEl
    },
    onMessage(msg, host) {
      if (msg.type === 'ping') {
        pingCount++
        contentEl.querySelector('#cnt').textContent = pingCount
        host.emit('pong', { count: pingCount })
      }
    },
  }
}

mountPanel({ title: 'panel/_smoke', layout: Single(HelloContent) })
</script>
</body>
</html>
```

- [ ] **Step 7: Smoke-verify Layer 1b**

Launch the smoke harness:

```bash
./aos show create --id panel-smoke \
  --at 200,200,480,200 \
  --interactive \
  --url 'aos://toolkit/panel/_smoke/index.html'
```

Visual checks:
1. A panel appears with title "panel/_smoke" in the header.
2. The header is draggable (grab it, move it).
3. The body shows "pings received: 0" and the eval command.

Then send a ping:

```bash
./aos show eval --id panel-smoke --js 'window.headsup.receive(btoa(JSON.stringify({type:"hello/ping",payload:{n:42}})))'
```

Expected: the panel's "pings received" counter increments to 1. Run again → 2. This proves the router strips the `hello/` prefix and delivers `{type:'ping'}` to the content.

Cleanup: `./aos show remove --id panel-smoke`

- [ ] **Step 8: Commit**

```bash
git add packages/toolkit/panel
git commit -m "$(cat <<'EOF'
feat(toolkit): add Layer 1b panel primitives

mountPanel + mountChrome + Single layout + manifest-prefix channel router.
Built on Layer 1a runtime helpers. Smoke harness at panel/_smoke/.

Lays groundwork for Step 2 component migrations and the future Tabs layout.
AosComponent unchanged in this commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate `canvas-inspector` to Layer 1a + 1b (pilot)

**Why:** First real consumer of the new foundation. Canvas-inspector is the most complex of the three (subscribes to lifecycle events, spawns no children but lists them) — if it migrates cleanly, the other two will be easy. This validates the Content + Single + router pattern end-to-end and proves the Layer 0 `canvas_lifecycle` fan-out from Task 1 works.

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/index.js` — Content factory
- Modify: `packages/toolkit/components/canvas-inspector/index.html` — call `mountPanel`
- Modify: `packages/toolkit/components/canvas-inspector/launch.sh` — drop event-relay subprocess
- Delete: `packages/toolkit/components/canvas-inspector/inspector.js` — replaced by `index.js`

- [ ] **Step 1: Read the current implementation**

Read `packages/toolkit/components/canvas-inspector/inspector.js` to understand what the inspector renders and which messages it handles. The new Content needs to preserve all its behavior — list canvases, react to `canvas_lifecycle` events, render whatever spatial visualization it currently provides.

- [ ] **Step 2: Read the current `index.html`**

Read `packages/toolkit/components/canvas-inspector/index.html` to see what it imports and how it bootstraps. The new file replaces the `extends AosComponent` boot with a `mountPanel` call.

- [ ] **Step 3: Create `index.js` (Content factory)**

`packages/toolkit/components/canvas-inspector/index.js`:

This is a port — preserve all rendering and message-handling logic from `inspector.js`. Replace the class with a factory function that returns a Content object. The `render(host)` method does what `mount()` did minus chrome (chrome is now Layer 1b's job). The `onMessage(msg, host)` method handles `bootstrap` and `canvas_lifecycle`. State (the canvas list, displays, DOM refs) lives in closure variables.

Skeleton (port the actual rendering logic from `inspector.js`):

```js
// canvas-inspector — Content factory for the toolkit's canvas debug panel.
//
// Renders the live list of canvases the daemon knows about and reacts to
// canvas_lifecycle events to stay current. Subscribes to canvas_lifecycle
// via the host (the panel's auto-subscribe on manifest.requires).

import { esc } from '../../runtime/bridge.js'

export default function CanvasInspector() {
  let contentEl = null
  let canvases = []
  let displays = []

  function rerender() {
    if (!contentEl) return
    // PORT THE EXISTING RENDER LOGIC FROM inspector.js HERE.
    // Use `canvases` and `displays` arrays as the source of truth.
    // Output goes into contentEl.innerHTML or via DOM manipulation.
  }

  return {
    manifest: {
      name: 'canvas-inspector',
      title: 'Canvas Inspector',
      accepts: ['bootstrap', 'canvas_lifecycle'],
      emits: [],
      channelPrefix: 'canvas-inspector',
      requires: ['canvas_lifecycle'],
      defaultSize: { w: 320, h: 480 },
    },

    render(host) {
      contentEl = document.createElement('div')
      contentEl.className = 'canvas-inspector-body'
      contentEl.style.cssText = 'padding:8px;height:100%;box-sizing:border-box;'
      // Initial render with empty data — bootstrap will populate.
      rerender()
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'bootstrap') {
        canvases = msg.payload?.canvases || msg.canvases || []
        displays = msg.payload?.displays || msg.displays || []
        rerender()
        return
      }
      if (msg.type === 'canvas_lifecycle') {
        // Apply lifecycle delta to local canvas list.
        const data = msg.payload || msg.data || msg
        const action = data.action
        const id = data.id
        if (action === 'created') {
          canvases.push({ id, at: data.at, scope: data.scope || 'global', interactive: data.interactive ?? false })
        } else if (action === 'removed') {
          canvases = canvases.filter(c => c.id !== id)
        } else if (action === 'updated') {
          const i = canvases.findIndex(c => c.id === id)
          if (i >= 0) canvases[i] = { ...canvases[i], at: data.at }
        }
        rerender()
      }
    },
  }
}
```

**Important:** the `rerender()` function body must be ported from the existing `inspector.js`. Do not leave it as a placeholder. If `inspector.js` does anything beyond list rendering (e.g., spatial minimap), port that too.

- [ ] **Step 4: Update `index.html` to use `mountPanel`**

Replace `packages/toolkit/components/canvas-inspector/index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: transparent; font-family: ui-monospace, monospace; font-size: 12px; color: #ddd; }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'
import CanvasInspector from './index.js'

mountPanel({ title: 'Canvas Inspector', layout: Single(CanvasInspector) })

// Bootstrap is now sent by launch.sh after canvas creation, via aos show eval.
// canvas_lifecycle events arrive automatically via the manifest.requires subscription.
</script>
</body>
</html>
```

- [ ] **Step 5: Simplify `launch.sh` (drop the event-relay subprocess)**

Replace `packages/toolkit/components/canvas-inspector/launch.sh` with:

```bash
#!/bin/bash
# launch.sh — Create the canvas inspector and seed it with initial state.
# Live updates flow via in-canvas subscribe('canvas_lifecycle'); no external
# subprocess needed.

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="canvas-inspector"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

# Position bottom-right of main display
DISPLAY_JSON=$($AOS graph displays --json 2>/dev/null || echo '{"displays":[]}')
MAIN_W=$(echo "$DISPLAY_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ds=d.get('displays',d) if isinstance(d,dict) else d
m=[x for x in ds if x.get('is_main')][0]
print(int(m['bounds']['w']))
" 2>/dev/null || echo 1920)
MAIN_H=$(echo "$DISPLAY_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ds=d.get('displays',d) if isinstance(d,dict) else d
m=[x for x in ds if x.get('is_main')][0]
print(int(m['bounds']['h']))
" 2>/dev/null || echo 1080)

PANEL_W=320
PANEL_H=480
X=$((MAIN_W - PANEL_W - 20))
Y=$((MAIN_H - PANEL_H - 60))

$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --url 'aos://toolkit/components/canvas-inspector/index.html'

# Wait for the page to wire its bridge
sleep 0.5

# Seed initial canvas list + display info
CANVAS_JSON=$($AOS show list --json 2>/dev/null || echo '{"canvases":[]}')

TMPDIR_BS=$(mktemp -d)
echo "$CANVAS_JSON" > "$TMPDIR_BS/canvases.json"
echo "$DISPLAY_JSON" > "$TMPDIR_BS/displays.json"

BOOTSTRAP_B64=$(python3 - "$TMPDIR_BS" <<'PYEOF'
import json, sys, base64, os
tmpdir = sys.argv[1]
with open(os.path.join(tmpdir, 'canvases.json')) as f:
    canvases = json.load(f).get('canvases', [])
with open(os.path.join(tmpdir, 'displays.json')) as f:
    raw = json.load(f)
    displays = raw.get('displays', raw) if isinstance(raw, dict) else raw
msg = {'type': 'canvas-inspector/bootstrap', 'payload': {'canvases': canvases, 'displays': displays}}
print(base64.b64encode(json.dumps(msg).encode()).decode())
PYEOF
)
rm -rf "$TMPDIR_BS"

if [ -n "$BOOTSTRAP_B64" ]; then
  $AOS show eval --id "$CANVAS_ID" --js "window.headsup.receive(\"$BOOTSTRAP_B64\")"
fi

echo "Canvas inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Live lifecycle updates flow via in-canvas subscribe — no subprocess needed."
```

Note the change to the bootstrap message type: now `canvas-inspector/bootstrap` (with the channelPrefix), so the router delivers it as `{type:'bootstrap'}` to the content.

- [ ] **Step 6: Delete the old `inspector.js`**

```bash
git rm packages/toolkit/components/canvas-inspector/inspector.js
```

- [ ] **Step 7: Smoke-verify**

Launch the migrated component:

```bash
bash packages/toolkit/components/canvas-inspector/launch.sh
```

Visual checks:
1. Panel appears bottom-right of main display.
2. Header reads "Canvas Inspector" and is draggable.
3. The body lists currently-active canvases (at minimum, the canvas-inspector itself).

Then exercise lifecycle:

```bash
# Create another canvas; the inspector should add it to the list within ~1s.
./aos show create --id smoke-test-1 --at 100,100,200,100 --html '<div style="background:#444;color:#fff;padding:8px">smoke 1</div>'
sleep 1
./aos show create --id smoke-test-2 --at 320,100,200,100 --html '<div style="background:#444;color:#fff;padding:8px">smoke 2</div>'
sleep 1
./aos show remove --id smoke-test-1
sleep 1
./aos show remove --id smoke-test-2
```

Expected: the inspector's list updates live as each canvas appears and disappears. If updates don't appear, verify Task 1's fan-out is in the running daemon (`./aos doctor --json | grep git_commit` should be a SHA at or after Task 1's commit).

Cleanup: `./aos show remove --id canvas-inspector`

Daemon log check: `tail -50 ~/.config/aos/repo/daemon.log | grep -i error` should produce no JS errors related to the inspector.

- [ ] **Step 8: Commit**

```bash
git add packages/toolkit/components/canvas-inspector
git commit -m "$(cat <<'EOF'
refactor(toolkit): migrate canvas-inspector to Layer 1a+1b foundation

Replaces extends AosComponent with a Content factory consumed by Single layout.
launch.sh drops the external aos show listen event-relay subprocess in favor
of in-canvas subscribe('canvas_lifecycle'). Fewer moving parts; live updates
still work.

Pilot for the Layer 1a+1b pattern. Same shape will apply to inspector-panel
and log-console in the next two commits.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migrate `inspector-panel` to Layer 1a + 1b

**Why:** Second migration. Inspector-panel is simpler than canvas-inspector (no live event subscription) — primarily a one-shot AX-element display surface fed by `aos inspect` evals. Validates the Content + Single pattern for a passive consumer.

**Files:**
- Create: `packages/toolkit/components/inspector-panel/index.js` — Content factory
- Modify: `packages/toolkit/components/inspector-panel/index.html` — call `mountPanel`
- Delete: `packages/toolkit/components/inspector-panel/inspector-panel.js` — replaced by `index.js`

- [ ] **Step 1: Read the current implementation**

Read `packages/toolkit/components/inspector-panel/inspector-panel.js` to capture: which messages it handles, what its initial state is, what it renders.

- [ ] **Step 2: Read the current `index.html`**

Read `packages/toolkit/components/inspector-panel/index.html` for any inline CSS or boot details to preserve.

- [ ] **Step 3: Create `index.js` (Content factory)**

`packages/toolkit/components/inspector-panel/index.js` — port the existing rendering logic into a Content factory. Skeleton:

```js
// inspector-panel — Content factory for AX-element inspector overlay.
//
// Receives element data via inspect/<message-type> messages from `aos inspect`
// and renders the live AX tree under cursor.

import { esc } from '../../runtime/bridge.js'

export default function InspectorPanel() {
  let contentEl = null
  let currentElement = null

  function rerender() {
    if (!contentEl) return
    // PORT THE EXISTING RENDER LOGIC FROM inspector-panel.js HERE.
    // Use `currentElement` as the source of truth.
  }

  return {
    manifest: {
      name: 'inspector-panel',
      title: 'AX Inspector',
      accepts: ['element', 'clear'],
      emits: [],
      channelPrefix: 'inspector',
      defaultSize: { w: 320, h: 480 },
    },

    render(host) {
      contentEl = document.createElement('div')
      contentEl.className = 'inspector-panel-body'
      contentEl.style.cssText = 'padding:8px;height:100%;box-sizing:border-box;'
      rerender()
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'element') {
        currentElement = msg.payload || msg
        rerender()
      } else if (msg.type === 'clear') {
        currentElement = null
        rerender()
      }
      // PORT ANY ADDITIONAL MESSAGE TYPES FROM inspector-panel.js HERE.
    },
  }
}
```

**Important:** message types in the existing `inspector-panel.js` may not match the example above. Inspect and adapt — the original message names from `aos inspect` should keep working (the channel router will deliver `inspector/<oldName>` as `{type:'<oldName>'}`).

- [ ] **Step 4: Update `index.html`**

Replace `packages/toolkit/components/inspector-panel/index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: transparent; font-family: ui-monospace, monospace; font-size: 12px; color: #ddd; }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'
import InspectorPanel from './index.js'

mountPanel({ title: 'AX Inspector', layout: Single(InspectorPanel) })
</script>
</body>
</html>
```

- [ ] **Step 5: Update `aos inspect` callers if message type changed**

Search for any code that pushes messages into the inspector-panel canvas and update the message types to use the `inspector/` prefix:

```bash
grep -rn 'inspector-panel\|inspect.*headsup\.receive\|--id inspector' src/ apps/ 2>/dev/null
```

If `src/commands/inspect.swift` (or similar) sends raw `{type:'element', ...}` messages, change them to `{type:'inspector/element', ...}` so the channel router strips the prefix. If no callers exist (the panel is not currently driven from anywhere), skip this step.

- [ ] **Step 6: Delete the old file**

```bash
git rm packages/toolkit/components/inspector-panel/inspector-panel.js
```

- [ ] **Step 7: Smoke-verify**

Launch:

```bash
./aos inspect &
INSPECT_PID=$!
sleep 2
```

Visual checks:
1. Inspector overlay appears.
2. Header reads "AX Inspector" and is draggable.
3. Hovering different windows updates the displayed AX element.

Stop: `kill $INSPECT_PID`

Cleanup: `./aos show remove --id inspector-panel 2>/dev/null || true`

If the displayed element doesn't update on hover, message type prefixing was missed in Step 5 — re-check.

- [ ] **Step 8: Commit**

```bash
git add packages/toolkit/components/inspector-panel src/
git commit -m "$(cat <<'EOF'
refactor(toolkit): migrate inspector-panel to Layer 1a+1b foundation

Same pattern as canvas-inspector: Content factory + Single layout + manifest
channel prefix. aos inspect callers updated to use the inspector/ prefix in
outbound message types.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate `log-console` to Layer 1a + 1b

**Why:** Third and last migration of the existing toolkit components. Log-console is the simplest — pure append-on-message. Last validation that `Single(Content)` works for the trivial case before we build `Tabs`.

**Files:**
- Create: `packages/toolkit/components/log-console/index.js` — Content factory
- Modify: `packages/toolkit/components/log-console/index.html` — call `mountPanel`
- Delete: `packages/toolkit/components/log-console/log-console.js` — replaced by `index.js`

- [ ] **Step 1: Read the current implementation**

Read `packages/toolkit/components/log-console/log-console.js` and `index.html`.

- [ ] **Step 2: Create `index.js` (Content factory)**

`packages/toolkit/components/log-console/index.js`:

```js
// log-console — Content factory for the scrolling timestamped log panel.
//
// Receives lines via log/append messages from `aos log push` and renders them
// in a scrolling viewport. Implements serialize/restore so log state survives
// a future tear-off.

import { esc } from '../../runtime/bridge.js'

const MAX_LINES = 1000

export default function LogConsole() {
  let contentEl = null
  let lines = []

  function appendLine(text, ts) {
    lines.push({ text: String(text), ts: ts || Date.now() })
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES)
    if (!contentEl) return
    const div = document.createElement('div')
    div.className = 'log-line'
    div.style.cssText = 'padding:2px 8px;border-bottom:1px solid #222;white-space:pre-wrap;word-break:break-all;'
    const tsStr = new Date(ts || Date.now()).toLocaleTimeString('en-US', { hour12: false })
    div.innerHTML = `<span style="color:#888;">${esc(tsStr)}</span>  ${esc(text)}`
    contentEl.appendChild(div)
    contentEl.scrollTop = contentEl.scrollHeight
  }

  function rerender() {
    if (!contentEl) return
    contentEl.innerHTML = ''
    for (const { text, ts } of lines) {
      const div = document.createElement('div')
      div.className = 'log-line'
      div.style.cssText = 'padding:2px 8px;border-bottom:1px solid #222;white-space:pre-wrap;word-break:break-all;'
      const tsStr = new Date(ts).toLocaleTimeString('en-US', { hour12: false })
      div.innerHTML = `<span style="color:#888;">${esc(tsStr)}</span>  ${esc(text)}`
      contentEl.appendChild(div)
    }
    contentEl.scrollTop = contentEl.scrollHeight
  }

  return {
    manifest: {
      name: 'log-console',
      title: 'Log',
      accepts: ['append', 'clear'],
      emits: [],
      channelPrefix: 'log',
      defaultSize: { w: 600, h: 400 },
    },

    render(host) {
      contentEl = document.createElement('div')
      contentEl.className = 'log-console-body'
      contentEl.style.cssText = 'height:100%;overflow-y:auto;font-size:11px;'
      rerender()
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'append') {
        const p = msg.payload || msg
        appendLine(p.text || p, p.ts)
      } else if (msg.type === 'clear') {
        lines = []
        rerender()
      }
    },

    serialize() {
      return { lines: [...lines] }
    },

    restore(state) {
      lines = Array.isArray(state?.lines) ? [...state.lines] : []
      rerender()
    },
  }
}
```

**Important:** if the existing `log-console.js` has different line formatting, message types, or features (filtering, search, color), port them. The skeleton above covers the basic append/clear contract.

- [ ] **Step 3: Update `index.html`**

Replace `packages/toolkit/components/log-console/index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: transparent; font-family: ui-monospace, monospace; font-size: 11px; color: #ddd; }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'
import LogConsole from './index.js'

mountPanel({ title: 'Log', layout: Single(LogConsole) })
</script>
</body>
</html>
```

- [ ] **Step 4: Update `aos log push` callers**

Search for code that pushes lines into the log canvas:

```bash
grep -rn 'log-console\|log push\|log.*headsup\.receive' src/ 2>/dev/null
```

Update message types from `{type:'append', ...}` to `{type:'log/append', ...}` so the router strips the prefix. If `src/commands/log.swift` (or similar) builds the eval string, that's where to change it.

- [ ] **Step 5: Delete the old file**

```bash
git rm packages/toolkit/components/log-console/log-console.js
```

- [ ] **Step 6: Smoke-verify**

Launch:

```bash
echo "first line from smoke" | ./aos log &
LOG_PID=$!
sleep 2
echo "second line" | ./aos log push
echo "third line" | ./aos log push
sleep 1
```

Visual checks:
1. Log panel appears.
2. Header reads "Log", draggable.
3. Three lines visible with timestamps in the format `HH:MM:SS  text`.

Stop: `kill $LOG_PID 2>/dev/null; ./aos show remove --id log-console 2>/dev/null || true`

- [ ] **Step 7: Commit**

```bash
git add packages/toolkit/components/log-console src/
git commit -m "$(cat <<'EOF'
refactor(toolkit): migrate log-console to Layer 1a+1b foundation

Same pattern as inspector-panel: Content factory + Single layout + manifest
channel prefix. Adds serialize/restore so log lines survive a future tear-off.
aos log push callers updated to use the log/ prefix.

Three of three toolkit components migrated. AosComponent retirement next.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build `Tabs` layout + tabs-demo

**Why:** Now that three Content units are proven against `Single`, build `Tabs` and validate composition by mounting all three in one panel. This is the foundation for the future Sigil workstation and tear-off work.

**Files:**
- Create: `packages/toolkit/panel/layouts/tabs.js` — `Tabs` layout
- Modify: `packages/toolkit/panel/index.js` — re-export `Tabs`
- Create: `packages/toolkit/components/_dev/tabs-demo/index.html` — demo with all three components

- [ ] **Step 1: Create `tabs.js`**

`packages/toolkit/panel/layouts/tabs.js`:

```js
// tabs.js — multiple contents, one visible at a time, tab strip in header.
//
// Tabs(factories) returns a layout instance. mountPanel detects layout.kind
// and calls layout.mount(chrome) to set up the tab strip + content slots.

import { wireBridge, emit, esc } from '../../runtime/bridge.js'
import { subscribe } from '../../runtime/subscribe.js'
import { spawnChild } from '../../runtime/canvas.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { createRouter } from '../router.js'

export function Tabs(factories) {
  if (!Array.isArray(factories) || factories.length === 0) {
    throw new Error('Tabs: requires a non-empty array of content factories')
  }

  return {
    kind: 'tabs',
    factories,
    mount(chrome) {
      // Instantiate all contents up front (they live for the panel's lifetime).
      const contents = factories.map(f => typeof f === 'function' ? f() : f)
      const hostByContent = new Map()
      const elByContent = new Map()
      let activeIdx = 0

      // Build tab strip in the header's controls slot.
      const tabStrip = document.createElement('div')
      tabStrip.className = 'aos-tabs'
      tabStrip.style.cssText = 'display:flex;gap:4px;'
      chrome.headerEl.querySelector('.aos-controls').appendChild(tabStrip)

      const tabButtons = contents.map((c, i) => {
        const label = c.manifest?.title || c.manifest?.name || `tab ${i + 1}`
        const btn = document.createElement('button')
        btn.className = 'aos-tab'
        btn.textContent = label
        btn.style.cssText = 'background:#333;color:#ddd;border:1px solid #444;border-radius:3px;padding:2px 8px;font-family:inherit;font-size:11px;cursor:pointer;'
        btn.addEventListener('click', () => activate(i))
        tabStrip.appendChild(btn)
        return btn
      })

      // Build content slots (one wrapper per content, hidden when not active).
      contents.forEach((c, i) => {
        const slot = document.createElement('div')
        slot.className = 'aos-tab-content'
        slot.style.cssText = 'display:none;height:100%;'
        chrome.contentEl.appendChild(slot)
        elByContent.set(c, slot)

        const host = makeHost(slot, c)
        hostByContent.set(c, host)

        const rendered = c.render(host)
        if (rendered instanceof Node) slot.appendChild(rendered)
        else if (typeof rendered === 'string') slot.innerHTML = rendered

        // Auto-subscribe to streams in manifest.requires
        const requires = c.manifest?.requires || []
        if (requires.length > 0) subscribe(requires)
      })

      // Manifest at the panel level: union of constituent manifests.
      declareManifest({
        name: chrome.headerEl.querySelector('.aos-title').textContent || 'tabs-panel',
        accepts: contents.flatMap(c => (c.manifest?.accepts || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        emits: contents.flatMap(c => (c.manifest?.emits || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        contents: contents.map(c => ({ name: c.manifest?.name, prefix: c.manifest?.channelPrefix })),
      })

      // Router: dispatch by manifest prefix
      const router = createRouter({ contents, hostByContent })
      wireBridge(router)

      function activate(idx) {
        activeIdx = idx
        contents.forEach((c, i) => {
          elByContent.get(c).style.display = i === idx ? 'block' : 'none'
          tabButtons[i].style.background = i === idx ? '#555' : '#333'
        })
      }

      activate(0)
      emitReady()
    },
  }
}

function makeHost(slotEl, content) {
  return {
    contentEl: slotEl,
    emit(type, payload) {
      const prefix = content.manifest?.channelPrefix
      const fullType = prefix ? `${prefix}/${type}` : type
      emit(fullType, payload)
    },
    subscribe(events) { subscribe(events) },
    spawnChild(opts) { return spawnChild(opts) },
  }
}
```

- [ ] **Step 2: Update `panel/index.js` to re-export `Tabs`**

In `packages/toolkit/panel/index.js`, add the import and export. The full file becomes:

```js
// panel/index.js — public surface.
//
// Content contract (JSDoc typedef for editor support):
// (same as before — keep the existing typedef)

export { mountPanel } from './mount.js'
export { mountChrome } from './chrome.js'
export { Single } from './layouts/single.js'
export { Tabs } from './layouts/tabs.js'
```

- [ ] **Step 3: Create the tabs demo**

`packages/toolkit/components/_dev/tabs-demo/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: transparent; font-family: ui-monospace, monospace; font-size: 12px; color: #ddd; }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Tabs } from '../../../panel/index.js'
import CanvasInspector from '../../canvas-inspector/index.js'
import InspectorPanel from '../../inspector-panel/index.js'
import LogConsole from '../../log-console/index.js'

mountPanel({
  title: 'Toolkit Workstation',
  layout: Tabs([CanvasInspector, InspectorPanel, LogConsole]),
})
</script>
</body>
</html>
```

- [ ] **Step 4: Smoke-verify Tabs**

Launch:

```bash
./aos show create --id tabs-demo \
  --at 200,200,720,520 \
  --interactive \
  --url 'aos://toolkit/components/_dev/tabs-demo/index.html'
```

Visual checks:
1. Panel appears with title "Toolkit Workstation".
2. Three tab buttons in the header: "Canvas Inspector", "AX Inspector", "Log".
3. Clicking each tab swaps the content area.
4. Active tab button has a distinct background (`#555`).

Then exercise each tab:

```bash
# Canvas Inspector tab — should react to lifecycle events
./aos show create --id tabs-trigger --at 100,100,200,100 --html '<div style="background:#444;color:#fff;padding:8px">trigger</div>'
sleep 1
./aos show remove --id tabs-trigger
sleep 1

# Log tab — push some lines
echo "test line A" | ./aos log push
echo "test line B" | ./aos log push

# AX Inspector tab — hover other windows; expect element data to update
# (manual check; no shell trigger)
```

Click each tab to verify:
- Canvas Inspector shows the lifecycle activity.
- Log shows the pushed lines.
- AX Inspector shows the latest hovered element.

If switching tabs causes one tab's state to disappear, the contents are being re-rendered instead of hidden — check `tabs.js` `activate()` only changes `display`, doesn't `innerHTML = ''`.

Cleanup: `./aos show remove --id tabs-demo`

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/panel/layouts/tabs.js packages/toolkit/panel/index.js packages/toolkit/components/_dev/tabs-demo
git commit -m "$(cat <<'EOF'
feat(toolkit): add Tabs layout + tabs-demo

Tabs([factories]) hosts multiple Content units in one canvas with a tab strip
in the header. Each content gets its own slot (hidden when inactive — state
preserved across switches). Manifest channel prefixes route incoming messages
to the right content.

tabs-demo composes the three migrated components in one workstation panel.
End-to-end validation of Layer 1a+1b composition.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Retire `AosComponent` and update toolkit docs

**Why:** All three toolkit components have migrated. `AosComponent` has zero remaining consumers. Delete it and update `packages/toolkit/CLAUDE.md` to reflect the new layered model.

**Files:**
- Delete: `packages/toolkit/components/_base/base.js`
- Modify: `packages/toolkit/components/_base/bridge.js` (or delete — Layer 1a supersedes)
- Keep: `packages/toolkit/components/_base/theme.css` (still used)
- Modify: `packages/toolkit/CLAUDE.md` — document Layer 1a/1b model

- [ ] **Step 1: Verify zero remaining consumers**

```bash
grep -rn 'AosComponent\|_base/base\|_base/bridge' packages/ apps/ src/ 2>/dev/null | grep -v 'CLAUDE\.md\|docs/superpowers/\|\.swift'
```

Expected: no hits. If any surface, migrate them or surface as a follow-up before continuing.

- [ ] **Step 2: Delete `base.js`**

```bash
git rm packages/toolkit/components/_base/base.js
```

- [ ] **Step 3: Decide on `bridge.js`**

Layer 1a's `runtime/bridge.js` supersedes `_base/bridge.js`. Two options:

- **Option A (cleaner):** `git rm packages/toolkit/components/_base/bridge.js`. Any future consumer imports from `runtime/bridge.js` directly.
- **Option B (transitional):** Replace `_base/bridge.js` with a one-line re-export: `export * from '../../runtime/bridge.js'`. Keeps existing import paths working if any were missed.

Recommend Option A — Step 1's grep proved no consumers exist. Avoid the dead re-export.

```bash
git rm packages/toolkit/components/_base/bridge.js
```

- [ ] **Step 4: Update `packages/toolkit/CLAUDE.md`**

Replace the file with:

```markdown
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
```

- [ ] **Step 5: Smoke-verify nothing broke**

Re-run the smoke from Tasks 4, 5, 6, 7 in sequence:

```bash
# Each component standalone
bash packages/toolkit/components/canvas-inspector/launch.sh &
sleep 2
./aos show remove --id canvas-inspector

./aos inspect &
sleep 2
kill %1 2>/dev/null
./aos show remove --id inspector-panel 2>/dev/null

echo "test" | ./aos log &
sleep 1
./aos show remove --id log-console 2>/dev/null
kill %1 2>/dev/null

# Tabs demo
./aos show create --id tabs-demo \
  --at 200,200,720,520 --interactive \
  --url 'aos://toolkit/components/_dev/tabs-demo/index.html'
sleep 2
./aos show remove --id tabs-demo
```

Expected: no JS errors in `~/.config/aos/repo/daemon.log`, all four launches produce visible canvases.

- [ ] **Step 6: Commit**

```bash
git add packages/toolkit
git commit -m "$(cat <<'EOF'
refactor(toolkit): retire AosComponent; document Layer 1a/1b model

All three toolkit components migrated to Layer 1a+1b. AosComponent and the
old _base/bridge.js have zero consumers and are deleted. theme.css remains.

CLAUDE.md updated to describe the layered model: runtime/ (Layer 1a),
panel/ (Layer 1b), components/ (Layer 2), apps/ (Layer 3).

Closes the canvas-runtime-and-toolkit-primitives migration arc. Future work
(Sigil control panel — Step 4 of the spec, renderer/hit-area/chat/studio
migrations — Step 5, Tear-off + Floating layout — Step 6) is separate-session
work coordinated with surface owners.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (executor: skip — for plan author)

**Spec coverage:**
- ✅ Step 0 (Layer 1a) → Task 2
- ✅ Step 1 (Layer 1b) → Task 3
- ✅ Step 2 (migrate three components) → Tasks 4, 5, 6
- ✅ Step 3 (Tabs + dev demo) → Task 7
- ✅ Open question #1 (canvas_lifecycle allowlist) → Task 1
- ✅ AosComponent retirement (spec §Compatibility) → Task 8
- ✅ Cross-state guards (renderer-strangler flag) → noted in spec; not relevant at toolkit-only scope
- ✅ Parent-child cascade convention (renderer-strangler flag) → tear-off is Step 6, deferred

**Scope boundary verified:**
- Step 4 (Sigil control panel) — explicitly deferred to separate session.
- Step 5 (renderer/hit-area/chat/studio Layer 1a migration) — explicitly deferred.
- Step 6 (Tear-off + Floating) — explicitly deferred to separate spec.

**Type/name consistency:**
- `wireBridge`, `emit`, `esc`, `subscribe`, `unsubscribe`, `spawnChild`, `mutateSelf`, `removeSelf`, `setInteractive`, `declareManifest`, `emitReady`, `onReady` — used consistently across Tasks 2–7.
- `mountPanel`, `mountChrome`, `Single`, `Tabs`, `createRouter` — consistent.
- `manifest.channelPrefix`, `manifest.requires`, `manifest.title`, `manifest.defaultSize` — used consistently in components and routers.
- Content contract: `render(host)`, `onMessage(msg, host)`, `serialize()`, `restore(state)` — consistent across all three component migrations.

**No placeholders:**
- Tasks 4, 5, 6 contain `// PORT THE EXISTING RENDER LOGIC FROM <file>.js HERE` markers. These are intentional — the existing components have rendering logic that must be preserved verbatim from the current files; the executor reads the original (Step 1 of each task) and ports it. This is not a "TBD" — it's a directed transcription with the destination shape fully specified.
- All other steps contain complete code or exact commands.
