# Toolkit Component Model + Canvas Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline copy-paste of shared theme/bridge code with a proper ES module base class served via the content server, then build a canvas inspector as the first component on the new base.

**Architecture:** Register `packages/toolkit` as a content root (`aos://toolkit/...`). Convert `_base/` into importable ES modules: `theme.css` via `<link>`, `bridge.js` as an ES module exporting an `AosComponent` base class. Components become multi-file directories with an `index.html` that imports the shared base. The canvas inspector subscribes to `canvas_lifecycle` events and displays a spatial minimap + canvas list.

**Tech Stack:** Vanilla HTML/CSS/JS (ES modules), AOS content server (`aos://`), AOS daemon events (`canvas_lifecycle`), `aos show create --url`

---

### Task 1: Register toolkit content root

**Files:**
- Modify: daemon config via `aos set` CLI

- [ ] **Step 1: Register the content root**

```bash
./aos set content.roots.toolkit packages/toolkit
```

- [ ] **Step 2: Verify it's live**

```bash
curl -s http://127.0.0.1:$(./aos content status --json | grep -o '"port" : [0-9]*' | grep -o '[0-9]*')/toolkit/components/_base/theme.css | head -5
```

Expected: the first 5 lines of `theme.css` served over HTTP.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(toolkit): register toolkit content root on daemon"
```

Note: `aos set` writes to `~/.config/aos/repo/config.json` which is local state, not committed. This step is a runtime config change — no file changes to commit. Skip the commit if nothing changed in the repo.

---

### Task 2: Convert `_base/` into importable ES modules

**Files:**
- Modify: `packages/toolkit/components/_base/bridge.js`
- Create: `packages/toolkit/components/_base/base.js` (new AosComponent class)
- Keep: `packages/toolkit/components/_base/theme.css` (unchanged — already importable via `<link>`)

- [ ] **Step 1: Refactor bridge.js into an ES module**

Replace the contents of `packages/toolkit/components/_base/bridge.js` with:

```js
// bridge.js — WKWebView ↔ component bridge (ES module)
//
// Provides:
//   - esc(s): HTML-safe string escaping
//   - initBridge(handler): wire headsup.receive → handler(msg)
//   - postToHost(payload): send message to daemon via messageHandler

export function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function initBridge(handler) {
  if (window.webkit?.messageHandlers?.headsup) {
    window.headsup = {
      receive(b64) {
        try {
          const msg = JSON.parse(atob(b64));
          if (typeof handler === 'function') handler(msg);
        } catch (e) {
          console.error('bridge: decode error', e);
        }
      }
    };
  }
}

export function postToHost(payload) {
  window.webkit?.messageHandlers?.headsup?.postMessage(payload);
}
```

- [ ] **Step 2: Create base.js — the AosComponent base class**

Create `packages/toolkit/components/_base/base.js`:

```js
// base.js — AosComponent base class (ES module)
//
// Provides shared plumbing for toolkit components:
//   - Bridge wiring (headsup.receive → onMessage)
//   - Panel chrome (header bar with title, drag handle)
//   - Drag support (mousedown on header → move canvas via eval)
//   - Minimize toggle
//
// Usage:
//   import { AosComponent } from '../_base/base.js';
//   class MyComponent extends AosComponent {
//     constructor() { super({ title: 'My Tool', id: 'my-tool' }); }
//     onMessage(msg) { /* handle incoming messages */ }
//     renderContent() { return '<div>body here</div>'; }
//   }
//   new MyComponent().mount();

import { esc, initBridge, postToHost } from './bridge.js';

export { esc, postToHost };

export class AosComponent {
  constructor({ title = 'AOS', id = 'aos-component' } = {}) {
    this.title = title;
    this.id = id;
    this._minimized = false;
  }

  // Override in subclass — called for each headsup message
  onMessage(msg) {}

  // Override in subclass — return inner HTML for the content area
  renderContent() { return ''; }

  // Mount the component into the DOM
  mount(container = document.body) {
    container.innerHTML = '';

    // Panel wrapper
    const panel = document.createElement('div');
    panel.className = 'aos-panel';
    panel.id = this.id;
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    // Header
    const header = document.createElement('div');
    header.className = 'aos-header aos-drag-handle';
    header.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--border-subtle);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none;';
    header.innerHTML = `<span class="aos-title">${esc(this.title)}</span><span class="aos-controls"></span>`;
    panel.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'aos-content';
    content.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
    content.innerHTML = this.renderContent();
    panel.appendChild(content);

    container.appendChild(panel);

    this._panel = panel;
    this._header = header;
    this._content = content;

    // Wire bridge
    initBridge((msg) => this.onMessage(msg));

    // Wire drag
    this._initDrag(header);
  }

  // Update the content area
  setContent(html) {
    if (this._content) this._content.innerHTML = html;
  }

  // Update header title
  setTitle(text) {
    const el = this._header?.querySelector('.aos-title');
    if (el) el.textContent = text;
  }

  // Drag implementation — posts position delta to host
  _initDrag(handle) {
    let startX, startY;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.aos-controls')) return;
      startX = e.screenX;
      startY = e.screenY;
      handle.style.cursor = 'grabbing';

      const onMove = (e) => {
        const dx = e.screenX - startX;
        const dy = e.screenY - startY;
        startX = e.screenX;
        startY = e.screenY;
        postToHost({ action: 'move_delta', dx, dy });
      };

      const onUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
```

- [ ] **Step 3: Verify modules load over content server**

Create a quick smoke-test HTML file at `packages/toolkit/components/_base/test.html`:

```html
<!DOCTYPE html>
<html><head>
<script type="module">
  import { esc, AosComponent } from './base.js';
  document.title = 'bridge-ok';
  document.body.textContent = `esc works: ${esc('<b>test</b>')} | AosComponent: ${typeof AosComponent}`;
</script>
</head><body>loading...</body></html>
```

Then load it:

```bash
./aos show create --id base-test --at 100,100,400,100 --interactive --url aos://toolkit/components/_base/test.html
```

Expected: a canvas appears showing `esc works: &lt;b&gt;test&lt;/b&gt; | AosComponent: function`.

- [ ] **Step 4: Clean up smoke test**

```bash
./aos show remove --id base-test
rm packages/toolkit/components/_base/test.html
```

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/_base/bridge.js packages/toolkit/components/_base/base.js
git commit -m "feat(toolkit): ES module base class with bridge, drag, panel chrome"
```

---

### Task 3: Build the canvas inspector component

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/index.html`
- Create: `packages/toolkit/components/canvas-inspector/inspector.js`

The canvas inspector is a panel that shows:
1. A spatial minimap of all displays with canvas rectangles drawn on it
2. A canvas list with per-canvas controls (hide/show, tint, info)

It bootstraps by fetching data from the daemon via `aos show list --json` and `aos graph displays --json`, then subscribes to `canvas_lifecycle` events for live updates.

**Important context:**
- `aos show list --json` returns `{ status, canvases: [{ id, at: [x,y,w,h], interactive, scope, ttl, ... }] }`
- `aos graph displays --json` returns `[{ id, cgID, width, height, scale_factor, bounds: {x,y,w,h}, is_main }]`
- `canvas_lifecycle` events arrive as headsup messages: `{ service: "display", event: "canvas_lifecycle", data: { canvas_id, action, at } }`
- The inspector itself is a canvas — it will appear in its own list. Filter it out by its own ID (`canvas-inspector`).

- [ ] **Step 1: Create index.html**

Create `packages/toolkit/components/canvas-inspector/index.html`:

```html
<!DOCTYPE html>
<html style="background:transparent">
<head>
<link rel="stylesheet" href="../_base/theme.css">
<style>
  /* Minimap */
  .minimap {
    position: relative;
    margin: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: rgba(10, 10, 20, 0.5);
    overflow: hidden;
  }
  .minimap-display {
    position: absolute;
    border: 1px solid rgba(100, 100, 140, 0.3);
    border-radius: 2px;
    background: rgba(30, 30, 50, 0.4);
  }
  .minimap-display-label {
    position: absolute;
    bottom: 2px;
    right: 4px;
    font-size: 8px;
    color: var(--text-muted);
  }
  .minimap-canvas {
    position: absolute;
    border: 1px solid var(--accent-blue);
    border-radius: 1px;
    background: rgba(138, 180, 255, 0.15);
    cursor: pointer;
    transition: background 0.15s;
  }
  .minimap-canvas:hover {
    background: rgba(138, 180, 255, 0.3);
  }
  .minimap-canvas.self {
    border-color: var(--accent-purple);
    background: rgba(80, 120, 255, 0.1);
    pointer-events: none;
  }
  .minimap-canvas.tinted {
    opacity: 0.85;
  }

  /* Canvas list */
  .canvas-list {
    padding: 0 8px 8px;
  }
  .canvas-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: var(--font-size-small);
    line-height: 1.6;
  }
  .canvas-item:hover {
    background: var(--bg-hover);
  }
  .canvas-item.self {
    opacity: 0.5;
  }
  .canvas-id {
    color: var(--accent-blue);
    font-weight: 600;
    flex-shrink: 0;
  }
  .canvas-dims {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .canvas-flags {
    margin-left: auto;
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .flag {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 2px;
    background: rgba(60, 60, 90, 0.3);
    color: var(--text-secondary);
  }
  .flag.interactive {
    color: var(--accent-yellow);
    background: rgba(221, 170, 102, 0.15);
  }
  .flag.scoped {
    color: var(--accent-green);
  }

  .btn {
    background: none;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 9px;
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn.active {
    background: rgba(138, 180, 255, 0.2);
    color: var(--accent-blue);
    border-color: var(--accent-blue);
  }

  .empty-state {
    color: var(--text-muted);
    text-align: center;
    padding: 16px;
    font-style: italic;
  }

  .status-bar {
    padding: 4px 10px;
    font-size: 8px;
    color: var(--text-header);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
<div id="app"></div>
<script type="module" src="./inspector.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create inspector.js**

Create `packages/toolkit/components/canvas-inspector/inspector.js`:

```js
// inspector.js — Canvas inspector component
//
// Shows a spatial minimap of displays with canvas overlays,
// plus a canvas list with per-canvas controls.

import { AosComponent, esc, postToHost } from '../_base/base.js';

const SELF_ID = 'canvas-inspector';
const TINT_COLORS = [
  'rgba(255,80,80,0.25)',   // red
  'rgba(80,180,255,0.25)',  // blue
  'rgba(80,255,120,0.25)',  // green
  'rgba(255,200,60,0.25)',  // yellow
  'rgba(200,80,255,0.25)',  // purple
  'rgba(255,140,60,0.25)',  // orange
];

class CanvasInspector extends AosComponent {
  constructor() {
    super({ title: 'Canvas Inspector', id: SELF_ID });
    this.displays = [];
    this.canvases = [];
    this.tintedIds = new Set();
    this._tintMap = {};  // canvasId -> color
    this._tintIdx = 0;
    this._eventCount = 0;
  }

  onMessage(msg) {
    // canvas_lifecycle events arrive from daemon subscription
    if (msg.event === 'canvas_lifecycle' || msg.type === 'canvas_lifecycle') {
      const data = msg.data || msg;
      this._eventCount++;
      this._handleLifecycle(data);
    }
    // Bootstrap data from eval
    if (msg.type === 'bootstrap') {
      if (msg.displays) this.displays = msg.displays;
      if (msg.canvases) this.canvases = msg.canvases;
      this._render();
    }
  }

  _handleLifecycle(data) {
    const { canvas_id, action, at } = data;
    if (action === 'created' || action === 'updated') {
      const existing = this.canvases.find(c => c.id === canvas_id);
      if (existing) {
        if (at) existing.at = at;
      } else {
        this.canvases.push({ id: canvas_id, at: at || [0, 0, 0, 0], interactive: false });
      }
    } else if (action === 'removed') {
      this.canvases = this.canvases.filter(c => c.id !== canvas_id);
      this.tintedIds.delete(canvas_id);
    }
    this._render();
  }

  renderContent() {
    return '<div class="empty-state">Loading canvas data...</div>';
  }

  _render() {
    const filteredCanvases = this.canvases.filter(c => c.id !== SELF_ID);

    let html = '';
    html += this._renderMinimap(filteredCanvases);
    html += this._renderList(filteredCanvases);

    this.setContent(html);
    this.setTitle(`Canvas Inspector (${filteredCanvases.length})`);
    this._bindListEvents();

    // Update status bar
    const statusBar = document.querySelector('.status-bar');
    if (statusBar) {
      statusBar.querySelector('.event-count').textContent = `${this._eventCount} events`;
    }
  }

  _renderMinimap(canvases) {
    if (this.displays.length === 0) return '';

    // Calculate bounding box of all displays
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of this.displays) {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.w);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.h);
    }
    const totalW = maxX - minX;
    const totalH = maxY - minY;

    // Scale to fit in minimap (max 280px wide, proportional height)
    const mapW = 280;
    const scale = mapW / totalW;
    const mapH = Math.round(totalH * scale);

    let html = `<div class="minimap" style="width:${mapW}px;height:${mapH}px">`;

    // Draw displays
    for (const d of this.displays) {
      const x = Math.round((d.bounds.x - minX) * scale);
      const y = Math.round((d.bounds.y - minY) * scale);
      const w = Math.round(d.bounds.w * scale);
      const h = Math.round(d.bounds.h * scale);
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`;
      html += `<span class="minimap-display-label">${d.is_main ? '★ ' : ''}${d.width}×${d.height}</span>`;
      html += `</div>`;
    }

    // Draw canvases
    for (const c of canvases) {
      if (!c.at || c.at.length < 4) continue;
      const [cx, cy, cw, ch] = c.at;
      const x = Math.round((cx - minX) * scale);
      const y = Math.round((cy - minY) * scale);
      const w = Math.max(2, Math.round(cw * scale));
      const h = Math.max(2, Math.round(ch * scale));
      const tint = this._tintMap[c.id];
      const tintStyle = tint ? `background:${tint};` : '';
      const cls = c.id === SELF_ID ? 'minimap-canvas self' : (tint ? 'minimap-canvas tinted' : 'minimap-canvas');
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${tintStyle}" title="${esc(c.id)}"></div>`;
    }

    html += `</div>`;
    return html;
  }

  _renderList(canvases) {
    if (canvases.length === 0) {
      return '<div class="empty-state">No canvases active</div>';
    }

    let html = '<div class="canvas-list">';
    for (const c of canvases) {
      const isSelf = c.id === SELF_ID;
      const cls = isSelf ? 'canvas-item self' : 'canvas-item';
      const [x, y, w, h] = c.at || [0, 0, 0, 0];
      const dims = `${Math.round(w)}×${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`;
      const isTinted = this.tintedIds.has(c.id);

      html += `<div class="${cls}" data-id="${esc(c.id)}">`;
      html += `<span class="canvas-id">${esc(c.id)}</span>`;
      html += `<span class="canvas-dims">${dims}</span>`;
      html += `<span class="canvas-flags">`;
      if (c.interactive) html += `<span class="flag interactive">int</span>`;
      if (c.scope === 'connection') html += `<span class="flag scoped">conn</span>`;
      if (c.ttl != null) html += `<span class="flag">ttl:${Math.round(c.ttl)}s</span>`;
      if (!isSelf) {
        html += `<button class="btn tint-btn${isTinted ? ' active' : ''}" data-id="${esc(c.id)}">tint</button>`;
        html += `<button class="btn remove-btn" data-id="${esc(c.id)}">✕</button>`;
      }
      html += `</span>`;
      html += `</div>`;
    }
    html += '</div>';

    html += `<div class="status-bar"><span class="event-count">${this._eventCount} events</span><span>live</span></div>`;
    return html;
  }

  _bindListEvents() {
    // Tint buttons
    for (const btn of document.querySelectorAll('.tint-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (this.tintedIds.has(id)) {
          this.tintedIds.delete(id);
          delete this._tintMap[id];
        } else {
          this.tintedIds.add(id);
          this._tintMap[id] = TINT_COLORS[this._tintIdx % TINT_COLORS.length];
          this._tintIdx++;
          // Eval tint on the actual canvas
          postToHost({ action: 'eval_canvas', target: id, js: `document.body.style.background='${this._tintMap[id]}'` });
        }
        this._render();
      });
    }

    // Remove buttons
    for (const btn of document.querySelectorAll('.remove-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        postToHost({ action: 'remove_canvas', target: id });
      });
    }
  }
}

// Boot
const inspector = new CanvasInspector();
inspector.mount(document.getElementById('app'));
```

- [ ] **Step 3: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/
git commit -m "feat(toolkit): canvas inspector component — minimap + canvas list with live events"
```

---

### Task 4: Create the bootstrap script

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/launch.sh`

The inspector needs initial data that can't come from headsup messages alone (it needs to call CLI commands). A small launch script creates the canvas and sends bootstrap data.

- [ ] **Step 1: Create launch.sh**

Create `packages/toolkit/components/canvas-inspector/launch.sh`:

```bash
#!/bin/bash
# launch.sh — Create the canvas inspector and bootstrap it with display/canvas data
#
# Usage: bash packages/toolkit/components/canvas-inspector/launch.sh

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="canvas-inspector"

# Remove existing instance if any
$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

# Get display info for positioning — place on main display, bottom-right
DISPLAY_JSON=$($AOS graph displays --json 2>/dev/null)
MAIN_W=$(echo "$DISPLAY_JSON" | python3 -c "import sys,json; ds=json.load(sys.stdin); m=[d for d in ds if d['is_main']][0]; print(int(m['bounds']['w']))" 2>/dev/null || echo 1920)
MAIN_H=$(echo "$DISPLAY_JSON" | python3 -c "import sys,json; ds=json.load(sys.stdin); m=[d for d in ds if d['is_main']][0]; print(int(m['bounds']['h']))" 2>/dev/null || echo 1080)

# Panel dimensions
PANEL_W=320
PANEL_H=480
X=$((MAIN_W - PANEL_W - 20))
Y=$((MAIN_H - PANEL_H - 60))

# Create the canvas
$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --url "aos://toolkit/components/canvas-inspector/index.html"

# Wait for page to load
sleep 0.5

# Bootstrap with current state
CANVASES=$($AOS show list --json 2>/dev/null || echo '{"canvases":[]}')
DISPLAYS=$($AOS graph displays --json 2>/dev/null || echo '[]')

# Build bootstrap message and send via eval
BOOTSTRAP=$(python3 -c "
import json, sys
canvases = json.loads('''$CANVASES''').get('canvases', [])
displays = json.loads('''$DISPLAYS''')
msg = json.dumps({'type': 'bootstrap', 'canvases': canvases, 'displays': displays})
# Eval JS that calls onMessage on the component
print(f'if(window.headsup){{window.headsup.receive(btoa(JSON.stringify({msg})))}}')" 2>/dev/null)

if [ -n "$BOOTSTRAP" ]; then
  $AOS show eval --id "$CANVAS_ID" --js "$BOOTSTRAP"
fi

echo "Canvas inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Live events require: aos show listen (in another terminal to keep subscription active)"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x packages/toolkit/components/canvas-inspector/launch.sh
```

- [ ] **Step 3: Test the launch script**

```bash
bash packages/toolkit/components/canvas-inspector/launch.sh
```

Expected: Canvas inspector panel appears at bottom-right of main display, showing the minimap with display outlines and any active canvas rectangles.

- [ ] **Step 4: Verify live events work**

In a separate terminal, create and remove a test canvas:

```bash
./aos show create --id test-tint --at 200,200,100,100 --html "<div style='background:red;width:100%;height:100%'></div>"
sleep 2
./aos show remove --id test-tint
```

Expected: The inspector minimap and list update in real-time when the test canvas appears and disappears.

- [ ] **Step 5: Clean up test canvas and commit**

```bash
./aos show remove --id canvas-inspector
git add packages/toolkit/components/canvas-inspector/
git commit -m "feat(toolkit): canvas inspector launch script with bootstrap"
```

---

### Task 5: Update docs and migrate existing components notice

**Files:**
- Modify: `packages/toolkit/CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Replace the entire contents of `packages/toolkit/CLAUDE.md` with:

```markdown
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
  _base/
    bridge.js       ES module — headsup bridge (esc, initBridge, postToHost)
    base.js         ES module — AosComponent base class (panel chrome, drag, bridge wiring)
    theme.css       Shared dark theme (CSS custom properties, panel/header classes)
  canvas-inspector/ Multi-file component — display/canvas debug tool
    index.html      Entry point (loads theme.css + inspector.js)
    inspector.js    Component logic (extends AosComponent)
    launch.sh       Bootstrap script (creates canvas, sends initial data)
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/toolkit/CLAUDE.md
git commit -m "docs(toolkit): update CLAUDE.md for ES module base class and canvas inspector"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Verify content root is registered**

```bash
./aos content status --json
```

Expected: `roots` object includes `"toolkit": ".../packages/toolkit"`.

- [ ] **Step 2: Verify base modules load**

```bash
curl -s http://127.0.0.1:$(./aos content status --json | python3 -c "import sys,json;print(json.load(sys.stdin)['port'])")/toolkit/components/_base/base.js | head -3
```

Expected: first 3 lines of `base.js`.

- [ ] **Step 3: Launch canvas inspector and verify**

```bash
bash packages/toolkit/components/canvas-inspector/launch.sh
```

Expected: Inspector panel appears showing minimap with display geometry and list of active canvases.

- [ ] **Step 4: Test canvas lifecycle**

```bash
./aos show create --id verify-lifecycle --at 50,50,200,200 --html "<div style='padding:20px'>test</div>"
```

Check inspector updates. Then:

```bash
./aos show remove --id verify-lifecycle
./aos show remove --id canvas-inspector
```

- [ ] **Step 5: Run final git status check**

```bash
git log --oneline -5
git status
```

Verify all commits are clean and no untracked files remain in `packages/toolkit/`.
