# Canvas Inspector — Object Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship consumer-published ephemeral object marks in `canvas-inspector` — minimap dots + indented list rows keyed per parent canvas — per the approved spec at `docs/superpowers/specs/2026-04-18-canvas-inspector-object-marks-design.md`.

**Architecture:** Push pub/sub via existing canvas-subscription mechanism. Daemon fans out `canvas_object.marks` to subscribers. Inspector holds ephemeral per-canvas mark state with TTL, runs a single 100 ms scheduler tick to drive TTL sweep and Tier 3 cadence, and renders via the existing minimap + list pipeline. Tier 1 (consumer-produced data URL) is Sigil's path and ships in Part I. Tier 3 (`icon: "capture"` backed by `aos see`) ships in Part II with a new daemon capture-from-canvas verb.

**Tech Stack:** Swift (daemon fan-out), JavaScript ESM + WKWebView (inspector + Sigil consumer), Node's built-in `node:test` for unit tests, Bash + `./aos show eval` for integration tests.

---

## Plan Structure

- **Part I** (Tasks 1–15): daemon wiring, normalize, reconcile, scheduler, default + `shape` + `icon` rendering, Sigil Tier 1 consumer, integration tests. Shippable on its own.
- **Part II** (Tasks 16–22): daemon capture-from-canvas verb + inspector Tier 3 request pipeline. Builds on Part I. Can ship later.

## File Map

**New files:**
- `packages/toolkit/components/canvas-inspector/marks/normalize.js` — `normalizeMarks`, `sanitizeSvg`, `stableColorForId`.
- `packages/toolkit/components/canvas-inspector/marks/reconcile.js` — `diffAndReconcile`, `bumpEpoch`.
- `packages/toolkit/components/canvas-inspector/marks/scheduler.js` — `createScheduler` (tick lifecycle + TTL sweep + Tier 3 dispatch).
- `packages/toolkit/components/canvas-inspector/marks/render.js` — `renderMarkOnMinimap`, `renderMarkListRow`, `renderDefaultShape`, `renderPrimitiveShape`.
- `packages/toolkit/components/canvas-inspector/marks/controller.js` — `createMarksController` glue that wires message handler, state, scheduler, and render into `CanvasInspector`.
- `tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
- `tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`
- `tests/toolkit/canvas-inspector-marks-scheduler.test.mjs`
- `tests/toolkit/canvas-inspector-marks-render.test.mjs`
- `tests/canvas-inspector-object-marks.sh` — integration shell test (emit + assert state + TTL + clear).
- `tests/toolkit/canvas-inspector-marks-tier3.test.mjs` — Part II only.
- `tests/canvas-inspector-object-marks-tier3.sh` — Part II only.

**Modified files:**
- `src/daemon/unified.swift` — intercept `canvas_object.marks` in canvas-message dispatch; add `forwardCanvasObjectMarks`. Part II: add `see.capture` canvas verb.
- `packages/toolkit/components/canvas-inspector/index.js` — subscribe to `canvas_object.marks`; route messages to `MarksController`; call its render hooks inside the existing `rerender()`.
- `packages/toolkit/components/canvas-inspector/styles.css` — indented mark list rows + mark swatch.
- `apps/sigil/renderer/live-modules/persistent-stage.js` — bake Tier 1 thumbnail, emit marks at ~10 Hz.
- `docs/api/toolkit.md` — document the `canvas_object.marks` emit contract.

**Unchanged but consulted:**
- `packages/toolkit/runtime/bridge.js`, `subscribe.js` — existing emit/subscribe helpers.
- `packages/toolkit/components/canvas-inspector/index.js` — pattern reference for `onMessage` + `rerender`.

---

## Part I — MVP (Tiers 1 & 2, no daemon capture)

### Task 1: Daemon fan-out for `canvas_object.marks`

**Files:**
- Modify: `src/daemon/unified.swift` — add fan-out function and dispatch branch.

**Why first:** Without this, no message ever reaches the inspector and every downstream test fails to exchange data.

- [ ] **Step 1: Read the exact region to modify**

Open `src/daemon/unified.swift`. Find:
1. The canvas-message dispatch block around lines 142–200 where `type` gets switched (ends with the fallthrough that calls `self.broadcastEvent(... "canvas_message" ...)` + `self.forwardCanvasMessageToCanvases(data: data)`).
2. The existing helper `forwardCanvasMessageToCanvases` near line 471.

- [ ] **Step 2: Add the `forwardCanvasObjectMarks` helper**

Immediately after `forwardCanvasMessageToCanvases` (around line 486), paste:

```swift
    /// Fan out `canvas_object.marks` to every canvas subscribed to that
    /// event name. Mirror of forwardCanvasMessageToCanvases. Wraps `data`
    /// in a `{type: "canvas_object.marks", ...}` envelope since live-js
    /// canvas dispatch routes by `msg.type`.
    private func forwardCanvasObjectMarks(data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("canvas_object.marks") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": "canvas_object.marks"]
        for (k, v) in data { msg[k] = v }

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: msg)
        }
    }
```

- [ ] **Step 3: Intercept the event in the canvas-message switch**

In the canvas-message dispatch block (around line 192, the `default: break` before falling through to `broadcastEvent(... "canvas_message" ...)`), add one case before `default`:

```swift
                case "canvas_object.marks":
                    // Fan out to any canvas that subscribed; don't echo back to sender.
                    var markPayload: [String: Any] = [:]
                    if let inner = inner {
                        for (k, v) in inner { markPayload[k] = v }
                    }
                    markPayload["source_id"] = canvasID
                    self.forwardCanvasObjectMarks(data: markPayload)
                    return
```

The `source_id` tag lets the inspector ignore marks that would echo back if it ever became a consumer itself.

- [ ] **Step 4: Rebuild `./aos`**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 5: Smoke-test the fan-out by hand**

Run:
```bash
./aos serve --idle-timeout 5m &
sleep 2
./aos show create --id sink --at 20,20,200,100 \
  --html '<html><body><script>
    window.headsup=window.headsup||{}; window.headsup.receive=(b64)=>{window.__last=JSON.parse(atob(b64))};
  </script></body></html>' >/dev/null
./aos show eval --id sink --js "window.webkit.messageHandlers.headsup.postMessage({type:'subscribe',payload:{events:['canvas_object.marks']}}); 'ok'"
./aos show create --id src --at 240,20,200,100 --html '<html><body><script>
  window.headsup=window.headsup||{};
  setTimeout(()=>{ window.webkit.messageHandlers.headsup.postMessage({ type: "canvas_object.marks", payload: { canvas_id: "src", objects: [{ id: "a", x: 100, y: 200 }] }}); }, 300);
</script></body></html>' >/dev/null
sleep 1
./aos show eval --id sink --js "JSON.stringify(window.__last || null)"
```

Expected: last line prints JSON containing `"type":"canvas_object.marks"` and `"canvas_id":"src"`.

- [ ] **Step 6: Tear down the smoke and commit**

```bash
./aos show remove --id sink
./aos show remove --id src
pkill -f 'aos serve --idle-timeout' || true
git add src/daemon/unified.swift
git commit -m "feat(daemon): fan out canvas_object.marks to subscribed canvases"
```

---

### Task 2: `normalizeMarks` — required `id`, per-snapshot uniqueness, color/size/name defaults

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/normalize.js`
- Test: `tests/toolkit/canvas-inspector-marks-normalize.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/toolkit/canvas-inspector-marks-normalize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMarks,
  stableColorForId,
} from '../../packages/toolkit/components/canvas-inspector/marks/normalize.js';

test('normalizeMarks drops entries without id and warns once per canvas', () => {
  const warnings = [];
  const warn = (...args) => warnings.push(args.join(' '));
  const out = normalizeMarks('avatar-main', [
    { id: 'avatar', x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ], { warn });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'avatar');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /avatar-main/);
});

test('normalizeMarks enforces id uniqueness within a snapshot (first-wins)', () => {
  const warnings = [];
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 1 },
    { id: 'a', x: 99, y: 99 },
    { id: 'b', x: 2, y: 2 },
  ], { warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(o => [o.id, o.x]), [['a', 1], ['b', 2]]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cv.*a/);
});

test('normalizeMarks applies defaults (size=20, name=id) and clamps size', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 3, y: 4, size: 0.1 },
    { id: 'c', x: 5, y: 6, size: 500, name: 'See' },
  ]);
  assert.equal(out[0].size, 20);
  assert.equal(out[0].name, 'a');
  assert.equal(out[1].size, 4);   // clamped to min
  assert.equal(out[2].size, 128); // clamped to max
  assert.equal(out[2].name, 'See');
});

test('stableColorForId returns the same color for the same id', () => {
  const a1 = stableColorForId('a');
  const a2 = stableColorForId('a');
  const b  = stableColorForId('b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^#[0-9a-f]{6}$/i);
});

test('normalizeMarks fills a stable color when none provided, respects explicit', () => {
  const out = normalizeMarks('cv', [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 3, y: 4, color: '#ff00aa' },
  ]);
  assert.equal(out[0].color, stableColorForId('a'));
  assert.equal(out[1].color, '#ff00aa');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `normalize.js`**

```js
// packages/toolkit/components/canvas-inspector/marks/normalize.js
const MIN_SIZE = 4;
const MAX_SIZE = 128;

const warnedMissingIdByCanvas = new Set(); // `${canvas_id}` one-shot warn
const warnedDupByKey = new Set();          // `${canvas_id}:${id}` one-shot warn

export function stableColorForId(id) {
  // djb2 hash → hue → hsl → hex
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  const hue = ((h >>> 0) % 360);
  return hslToHex(hue, 70, 55);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function clampSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 20;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(v)));
}

export function normalizeMarks(canvasId, objects, { warn = console.warn } = {}) {
  if (!Array.isArray(objects)) return [];
  const out = [];
  const seen = new Set();
  let sawMissingId = false;
  for (const raw of objects) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
    if (!id) {
      if (!sawMissingId) {
        sawMissingId = true;
        const key = `missing-id:${canvasId}`;
        if (!warnedMissingIdByCanvas.has(key)) {
          warnedMissingIdByCanvas.add(key);
          warn(`[canvas-inspector] mark dropped: missing id in canvas ${canvasId}`);
        } else {
          warn(`[canvas-inspector] mark dropped: missing id in canvas ${canvasId}`);
        }
      }
      continue;
    }
    if (seen.has(id)) {
      const key = `${canvasId}:${id}`;
      if (!warnedDupByKey.has(key)) {
        warnedDupByKey.add(key);
        warn(`[canvas-inspector] duplicate mark id dropped: ${canvasId}:${id}`);
      }
      continue;
    }
    seen.add(id);

    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    out.push({
      id,
      x, y,
      size: clampSize(raw.size ?? 20),
      color: typeof raw.color === 'string' && raw.color.length ? raw.color : stableColorForId(id),
      name: typeof raw.name === 'string' && raw.name.length ? raw.name : id,
      shape: typeof raw.shape === 'string' ? raw.shape : null,
      icon: typeof raw.icon === 'string' ? raw.icon : null,
      icon_region: raw.icon_region && typeof raw.icon_region === 'object' ? {
        x: Number(raw.icon_region.x),
        y: Number(raw.icon_region.y),
        w: Number(raw.icon_region.w),
        h: Number(raw.icon_region.h),
      } : null,
      icon_hz: clampHz(raw.icon_hz),
    });
  }
  return out;
}

function clampHz(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.1, Math.min(10, v));
}

// test-only: reset the one-shot warn memo
export function __resetWarnMemo() {
  warnedMissingIdByCanvas.clear();
  warnedDupByKey.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/normalize.js tests/toolkit/canvas-inspector-marks-normalize.test.mjs
git commit -m "feat(canvas-inspector): normalizeMarks with required id, uniqueness, stable color"
```

---

### Task 3: SVG sanitizer

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/marks/normalize.js` — add `sanitizeSvg`.
- Modify: `tests/toolkit/canvas-inspector-marks-normalize.test.mjs` — add sanitizer tests.

- [ ] **Step 1: Write the failing tests**

Append to the existing test file:

```js
import { sanitizeSvg } from '../../packages/toolkit/components/canvas-inspector/marks/normalize.js';

test('sanitizeSvg strips <script> tags', () => {
  const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<rect/);
});

test('sanitizeSvg strips on* event handlers', () => {
  const out = sanitizeSvg('<svg><rect onload="x()" onclick="y()" fill="red"/></svg>');
  assert.doesNotMatch(out, /onload/i);
  assert.doesNotMatch(out, /onclick/i);
  assert.match(out, /fill="red"/);
});

test('sanitizeSvg strips non-data xlink:href and href', () => {
  const ok = sanitizeSvg('<svg><image href="data:image/png;base64,iVB"/></svg>');
  assert.match(ok, /href="data:image/);
  const bad = sanitizeSvg('<svg><image href="https://evil/x.png"/></svg>');
  assert.doesNotMatch(bad, /https:\/\/evil/);
});

test('sanitizeSvg returns null for non-svg input', () => {
  assert.equal(sanitizeSvg('<div>hi</div>'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
Expected: FAIL — `sanitizeSvg` is not exported.

- [ ] **Step 3: Implement sanitizer**

Append to `packages/toolkit/components/canvas-inspector/marks/normalize.js`:

```js
const UNSAFE_TAG = /<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/>/gi;
const UNSAFE_ATTR = /\s(on[a-z]+|xmlns:xlink)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const HREF_ATTR = /\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;

export function sanitizeSvg(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!/^<svg\b/i.test(trimmed)) return null;
  let out = trimmed
    .replace(UNSAFE_TAG, '')
    .replace(UNSAFE_ATTR, '');
  out = out.replace(HREF_ATTR, (match, attr, _q, dq, sq) => {
    const val = dq ?? sq ?? '';
    if (/^data:/i.test(val)) return match;
    return '';
  });
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/normalize.js tests/toolkit/canvas-inspector-marks-normalize.test.mjs
git commit -m "feat(canvas-inspector): SVG sanitizer for mark shape payloads"
```

---

### Task 4: `diffAndReconcile` — eviction + seeding (Tier 1/2 paths only)

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/reconcile.js`
- Test: `tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/toolkit/canvas-inspector-marks-reconcile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReconciler,
  iconSignature,
} from '../../packages/toolkit/components/canvas-inspector/marks/reconcile.js';

function makeState() {
  return {
    iconCache: new Map(),
    tier3Timers: new Map(),
    captureEpochs: new Map(),
  };
}

test('removed mark evicts both caches and bumps epoch', () => {
  const s = makeState();
  s.iconCache.set('cv:a', { src: 'x', capturedAt: 0, iconSig: 'sig1' });
  s.tier3Timers.set('cv:a', { nextAt: 0, icon_region: null, gen: 5, seq: 2, inflight: false });
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv', [{ id: 'a', icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 } }], []);
  assert.equal(s.iconCache.has('cv:a'), false);
  assert.equal(s.tier3Timers.has('cv:a'), false);
  assert.ok(s.captureEpochs.get('cv:a') > 5);
});

test('new URL-icon mark does not touch tier3Timers', () => {
  const s = makeState();
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv', [], [{ id: 'a', icon: 'data:image/png;base64,AA' }]);
  assert.equal(s.tier3Timers.size, 0);
});

test('changed URL icon evicts iconCache even with no tier3 involvement', () => {
  const s = makeState();
  s.iconCache.set('cv:a', { src: 'x', capturedAt: 0, iconSig: iconSignature({ icon: 'A' }) });
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv',
    [{ id: 'a', icon: 'A' }],
    [{ id: 'a', icon: 'B' }]);
  assert.equal(s.iconCache.has('cv:a'), false);
});

test('same icon signature is a no-op', () => {
  const s = makeState();
  s.iconCache.set('cv:a', { src: 'x', capturedAt: 0, iconSig: iconSignature({ icon: 'A' }) });
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv',
    [{ id: 'a', icon: 'A' }],
    [{ id: 'a', icon: 'A', x: 42, y: 42 }]);  // position changes don't touch iconSig
  assert.equal(s.iconCache.has('cv:a'), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement reconciler (Tier 1/2 paths + stub Tier 3 for later)**

```js
// packages/toolkit/components/canvas-inspector/marks/reconcile.js
export function iconSignature(mark) {
  if (!mark) return 'none';
  if (mark.icon === 'capture') {
    const r = mark.icon_region || {};
    return `cap:${r.x}:${r.y}:${r.w}:${r.h}:${mark.icon_hz ?? 1}`;
  }
  if (typeof mark.icon === 'string') {
    return `url:${mark.icon}`;
  }
  if (typeof mark.shape === 'string') {
    return `shape:${mark.shape}`;
  }
  return 'default';
}

export function createReconciler(state) {
  const { iconCache, tier3Timers, captureEpochs } = state;

  function bumpEpoch(key) {
    const prev = Math.max(captureEpochs.get(key) ?? 0, tier3Timers.get(key)?.gen ?? 0);
    captureEpochs.set(key, prev + 1);
  }

  function keyOf(canvasId, id) { return `${canvasId}:${id}`; }

  function diffAndReconcile(canvasId, prevObjects = [], nextObjects = []) {
    const prevById = new Map((prevObjects || []).map(o => [o.id, o]));
    const nextById = new Map((nextObjects || []).map(o => [o.id, o]));

    // Removed marks
    for (const [id, prev] of prevById) {
      if (nextById.has(id)) continue;
      const key = keyOf(canvasId, id);
      bumpEpoch(key);
      iconCache.delete(key);
      tier3Timers.delete(key);
    }

    // New or changed marks
    for (const [id, next] of nextById) {
      const key = keyOf(canvasId, id);
      const prev = prevById.get(id);
      const nextSig = iconSignature(next);
      const prevSig = prev ? iconSignature(prev) : null;

      if (!prev) {
        if (next.icon === 'capture') {
          const startGen = captureEpochs.get(key) ?? 0;
          tier3Timers.set(key, {
            nextAt: 0,
            icon_region: next.icon_region,
            gen: startGen,
            seq: 0,
            inflight: false,
          });
        }
        continue;
      }

      if (nextSig === prevSig) continue;

      iconCache.delete(key);

      if (next.icon === 'capture') {
        const existing = tier3Timers.get(key);
        if (existing) {
          existing.gen += 1;
          existing.nextAt = 0;
          existing.icon_region = next.icon_region;
        } else {
          const startGen = captureEpochs.get(key) ?? 0;
          tier3Timers.set(key, {
            nextAt: 0,
            icon_region: next.icon_region,
            gen: startGen,
            seq: 0,
            inflight: false,
          });
        }
      } else {
        if (tier3Timers.has(key)) {
          bumpEpoch(key);
          tier3Timers.delete(key);
        }
      }
    }
  }

  function evictCanvas(canvasId) {
    for (const key of [...tier3Timers.keys()]) {
      if (key.startsWith(`${canvasId}:`)) {
        bumpEpoch(key);
        tier3Timers.delete(key);
      }
    }
    for (const key of [...iconCache.keys()]) {
      if (key.startsWith(`${canvasId}:`)) iconCache.delete(key);
    }
  }

  return { diffAndReconcile, bumpEpoch, evictCanvas };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/reconcile.js tests/toolkit/canvas-inspector-marks-reconcile.test.mjs
git commit -m "feat(canvas-inspector): diffAndReconcile with epoch-guarded Tier 3 seeding"
```

---

### Task 5: `diffAndReconcile` — Tier 3 transitions (capture↔URL, region bump, gen++)

**Files:**
- Modify: `tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`

The implementation from Task 4 already covers these paths; this task adds the dedicated tests the spec requires.

- [ ] **Step 1: Write the failing tests**

Append to the reconcile test file:

```js
test('new capture mark seeds tier3Timers at current captureEpochs', () => {
  const s = makeState();
  s.captureEpochs.set('cv:a', 7);
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv', [], [{ id: 'a', icon: 'capture', icon_region: {x:0,y:0,w:10,h:10} }]);
  const t = s.tier3Timers.get('cv:a');
  assert.ok(t);
  assert.equal(t.gen, 7);
  assert.equal(t.seq, 0);
  assert.equal(t.inflight, false);
  assert.equal(t.nextAt, 0);
});

test('changed icon_region on capture mark increments gen and resets nextAt', () => {
  const s = makeState();
  s.tier3Timers.set('cv:a', { nextAt: 1000, icon_region: {x:0,y:0,w:10,h:10}, gen: 3, seq: 5, inflight: true });
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv',
    [{ id: 'a', icon: 'capture', icon_region: {x:0,y:0,w:10,h:10} }],
    [{ id: 'a', icon: 'capture', icon_region: {x:50,y:0,w:10,h:10} }]);
  const t = s.tier3Timers.get('cv:a');
  assert.equal(t.gen, 4);
  assert.equal(t.nextAt, 0);
  assert.equal(t.icon_region.x, 50);
  assert.equal(t.seq, 5);        // seq preserved
  assert.equal(t.inflight, true); // inflight preserved
});

test('transition from capture to url bumps epoch and deletes timer entry', () => {
  const s = makeState();
  s.tier3Timers.set('cv:a', { nextAt: 0, icon_region: {x:0,y:0,w:10,h:10}, gen: 2, seq: 0, inflight: false });
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv',
    [{ id: 'a', icon: 'capture', icon_region: {x:0,y:0,w:10,h:10} }],
    [{ id: 'a', icon: 'data:image/png;base64,AA' }]);
  assert.equal(s.tier3Timers.has('cv:a'), false);
  assert.ok(s.captureEpochs.get('cv:a') > 2);
});

test('transition from url to capture seeds new timer at captureEpochs', () => {
  const s = makeState();
  s.captureEpochs.set('cv:a', 9);
  const { diffAndReconcile } = createReconciler(s);
  diffAndReconcile('cv',
    [{ id: 'a', icon: 'data:image/png;base64,AA' }],
    [{ id: 'a', icon: 'capture', icon_region: {x:0,y:0,w:10,h:10} }]);
  const t = s.tier3Timers.get('cv:a');
  assert.equal(t.gen, 9);
});
```

- [ ] **Step 2: Run the test to verify they pass**

Run: `node --test tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`
Expected: PASS. (Implementation from Task 4 already covers these transitions.)

If any fail, fix the reconciler in-place to match behavior, then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/toolkit/canvas-inspector-marks-reconcile.test.mjs
git commit -m "test(canvas-inspector): Tier 3 transition rules for diffAndReconcile"
```

---

### Task 6: Scheduler — tick lifecycle + TTL sweep (Tier 3 dispatch stub for now)

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/scheduler.js`
- Test: `tests/toolkit/canvas-inspector-marks-scheduler.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/toolkit/canvas-inspector-marks-scheduler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../packages/toolkit/components/canvas-inspector/marks/scheduler.js';

function makeCtx() {
  const state = {
    marksByCanvas: new Map(),
    tier3Timers: new Map(),
    iconCache: new Map(),
    captureEpochs: new Map(),
  };
  const timers = [];
  let now = 0;
  const clock = {
    now: () => now,
    advance: (ms) => { now += ms; runDue(); },
    setInterval: (fn, ms) => { const h = { fn, ms, nextFire: now + ms, cleared: false }; timers.push(h); return h; },
    clearInterval: (h) => { h.cleared = true; },
  };
  function runDue() {
    for (const h of timers) {
      while (!h.cleared && h.nextFire <= now) { h.fn(); h.nextFire += h.ms; }
    }
  }
  const calls = { rerender: 0, captures: [] };
  return {
    state, clock, calls,
    scheduler: createScheduler(state, {
      clock,
      rerender: () => { calls.rerender++; },
      issueCapture: (key, timer, mark) => { calls.captures.push({ key, gen: timer.gen, seq: timer.seq }); },
      onMarksRemoved: (canvasId) => { /* will test via state mutation */ },
    }),
  };
}

test('ensureTick does nothing when no marks exist', () => {
  const { scheduler, clock } = makeCtx();
  scheduler.ensureTick();
  assert.equal(scheduler.isTicking(), false);
});

test('ensureTick + marks starts a 100ms interval', () => {
  const { scheduler, state } = makeCtx();
  state.marksByCanvas.set('cv', { objects: [{ id: 'a', x: 1, y: 2 }], expiresAt: 10_000 });
  scheduler.ensureTick();
  assert.equal(scheduler.isTicking(), true);
});

test('TTL sweep drops expired entries and tears down tick', () => {
  const { scheduler, state, clock } = makeCtx();
  state.marksByCanvas.set('cv', { objects: [{ id: 'a', x: 1, y: 2 }], expiresAt: 500 });
  scheduler.ensureTick();
  clock.advance(450);
  assert.equal(state.marksByCanvas.has('cv'), true);
  clock.advance(100); // now=550 > 500
  assert.equal(state.marksByCanvas.has('cv'), false);
  assert.equal(scheduler.isTicking(), false);
});

test('teardownTick explicitly stops the interval', () => {
  const { scheduler, state } = makeCtx();
  state.marksByCanvas.set('cv', { objects: [{ id: 'a', x: 1, y: 2 }], expiresAt: 10_000 });
  scheduler.ensureTick();
  assert.equal(scheduler.isTicking(), true);
  scheduler.teardownTick();
  assert.equal(scheduler.isTicking(), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-scheduler.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement scheduler**

```js
// packages/toolkit/components/canvas-inspector/marks/scheduler.js
export function createScheduler(state, { clock, rerender, issueCapture, onMarksRemoved }) {
  const TICK_MS = 100;
  let handle = null;

  function isTicking() { return handle !== null; }

  function ensureTick() {
    if (handle) return;
    if (state.marksByCanvas.size === 0) return;
    handle = clock.setInterval(tick, TICK_MS);
  }

  function teardownTick() {
    if (!handle) return;
    clock.clearInterval(handle);
    handle = null;
  }

  function evictCanvasKeys(canvasId) {
    for (const key of [...state.tier3Timers.keys()]) {
      if (key.startsWith(`${canvasId}:`)) {
        const prev = Math.max(state.captureEpochs.get(key) ?? 0, state.tier3Timers.get(key).gen);
        state.captureEpochs.set(key, prev + 1);
        state.tier3Timers.delete(key);
      }
    }
    for (const key of [...state.iconCache.keys()]) {
      if (key.startsWith(`${canvasId}:`)) state.iconCache.delete(key);
    }
  }

  function tick() {
    const now = clock.now();
    let changed = false;

    // 1. TTL sweep
    for (const [canvasId, entry] of [...state.marksByCanvas]) {
      if (entry.expiresAt < now) {
        state.marksByCanvas.delete(canvasId);
        evictCanvasKeys(canvasId);
        if (onMarksRemoved) onMarksRemoved(canvasId);
        changed = true;
      }
    }

    // 2. Tier 3 schedule (see Task 17 for full implementation; placeholder)
    for (const [canvasId, entry] of state.marksByCanvas) {
      for (const mark of entry.objects) {
        if (mark.icon !== 'capture') continue;
        const key = `${canvasId}:${mark.id}`;
        const t = state.tier3Timers.get(key);
        if (!t) continue;
        if (t.inflight) continue;
        if (now < t.nextAt) continue;
        t.seq += 1;
        t.inflight = true;
        issueCapture(key, t, mark);
        const period = 1000 / (mark.icon_hz ?? 1);
        t.nextAt = now + period;
        changed = true;
      }
    }

    if (state.marksByCanvas.size === 0) teardownTick();
    if (changed) rerender();
  }

  return { ensureTick, teardownTick, isTicking, tick };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-scheduler.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/scheduler.js tests/toolkit/canvas-inspector-marks-scheduler.test.mjs
git commit -m "feat(canvas-inspector): scheduler tick with TTL sweep + tick lifecycle"
```

---

### Task 7: Mark renderers — default shape, primitive shapes, icon `<img>`, sanitized SVG

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/render.js`
- Test: `tests/toolkit/canvas-inspector-marks-render.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/toolkit/canvas-inspector-marks-render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMarkVisual,
  DEFAULT_SHAPE_SVG,
} from '../../packages/toolkit/components/canvas-inspector/marks/render.js';

test('default visual includes circle+square+crosshair template', () => {
  const html = renderMarkVisual({ id: 'a', color: '#ff0', size: 20 });
  assert.match(html, /<svg/);
  assert.match(html, /<rect/);
  assert.match(html, /<circle/);
  assert.match(html, /<line/);
  assert.match(html, /#ff0/);
});

test('primitive shape=circle renders a single circle', () => {
  const html = renderMarkVisual({ id: 'a', color: '#f0f', size: 24, shape: 'circle' });
  assert.match(html, /<svg[^>]*width="24"/);
  assert.match(html, /<circle/);
});

test('icon URL renders an <img>', () => {
  const html = renderMarkVisual({ id: 'a', color: '#000', size: 20, icon: 'data:image/png;base64,AA' });
  assert.match(html, /<img/);
  assert.match(html, /data:image\/png/);
});

test('capture icon with cached src renders cached data URL', () => {
  const html = renderMarkVisual(
    { id: 'a', color: '#000', size: 20, icon: 'capture', icon_region: {x:0,y:0,w:1,h:1} },
    { cachedSrc: 'data:image/jpeg;base64,ZZ' }
  );
  assert.match(html, /<img/);
  assert.match(html, /base64,ZZ/);
});

test('capture icon without cache falls through to default', () => {
  const html = renderMarkVisual(
    { id: 'a', color: '#000', size: 20, icon: 'capture', icon_region: {x:0,y:0,w:1,h:1} },
    { cachedSrc: null }
  );
  assert.match(html, /<circle/);
  assert.doesNotMatch(html, /<img/);
});

test('raw SVG shape is sanitized then embedded', () => {
  const html = renderMarkVisual({ id: 'a', color: '#000', size: 20, shape: '<svg><script>x</script><rect fill="red"/></svg>' });
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /<rect[^>]*fill="red"/);
});

test('invalid SVG falls through to default', () => {
  const html = renderMarkVisual({ id: 'a', color: '#000', size: 20, shape: '<div>nope</div>' });
  assert.match(html, /<circle/);
});

test('DEFAULT_SHAPE_SVG is a template with color + size slots', () => {
  assert.match(DEFAULT_SHAPE_SVG, /\{\{size\}\}/);
  assert.match(DEFAULT_SHAPE_SVG, /\{\{color\}\}/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement renderers**

```js
// packages/toolkit/components/canvas-inspector/marks/render.js
import { sanitizeSvg } from './normalize.js';

export const DEFAULT_SHAPE_SVG = `
<svg width="{{size}}" height="{{size}}" viewBox="0 0 {{size}} {{size}}" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="{{innerSize}}" height="{{innerSize}}" fill="none" stroke="{{color}}" stroke-width="2"/>
  <circle cx="{{half}}" cy="{{half}}" r="{{radius}}" fill="none" stroke="{{color}}" stroke-width="2"/>
  <line x1="1" y1="1" x2="{{almostSize}}" y2="{{almostSize}}" stroke="{{color}}" stroke-width="1"/>
  <line x1="{{almostSize}}" y1="1" x2="1" y2="{{almostSize}}" stroke="{{color}}" stroke-width="1"/>
</svg>
`.trim();

function renderDefault(size, color) {
  const innerSize = size - 2;
  const half = size / 2;
  const radius = (size - 4) / 2;
  const almostSize = size - 1;
  return DEFAULT_SHAPE_SVG
    .replaceAll('{{size}}', String(size))
    .replaceAll('{{innerSize}}', String(innerSize))
    .replaceAll('{{half}}', String(half))
    .replaceAll('{{radius}}', String(radius))
    .replaceAll('{{almostSize}}', String(almostSize))
    .replaceAll('{{color}}', color);
}

function renderPrimitive(name, size, color) {
  const half = size / 2;
  const r = (size - 4) / 2;
  switch (name) {
    case 'circle':
      return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half}" cy="${half}" r="${r}" fill="${color}"/></svg>`;
    case 'square':
      return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="${size-4}" height="${size-4}" fill="${color}"/></svg>`;
    case 'diamond':
      return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><polygon points="${half},2 ${size-2},${half} ${half},${size-2} 2,${half}" fill="${color}"/></svg>`;
    case 'triangle':
      return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><polygon points="${half},2 ${size-2},${size-2} 2,${size-2}" fill="${color}"/></svg>`;
    default:
      return null;
  }
}

const PRIMITIVES = new Set(['circle', 'square', 'diamond', 'triangle']);

export function renderMarkVisual(mark, { cachedSrc = null } = {}) {
  const size = mark.size;
  const color = mark.color;

  // Icon: URL
  if (typeof mark.icon === 'string' && mark.icon !== 'capture') {
    return `<img src="${escapeAttr(mark.icon)}" width="${size}" height="${size}" style="object-fit:contain" alt="">`;
  }

  // Icon: capture + cache hit
  if (mark.icon === 'capture' && cachedSrc) {
    return `<img src="${escapeAttr(cachedSrc)}" width="${size}" height="${size}" style="object-fit:contain" alt="">`;
  }

  // Shape: primitive
  if (typeof mark.shape === 'string' && PRIMITIVES.has(mark.shape)) {
    return renderPrimitive(mark.shape, size, color);
  }

  // Shape: raw SVG
  if (typeof mark.shape === 'string' && /^\s*<svg\b/i.test(mark.shape)) {
    const sanitized = sanitizeSvg(mark.shape);
    if (sanitized) return sanitized;
  }

  // Default
  return renderDefault(size, color);
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/render.js tests/toolkit/canvas-inspector-marks-render.test.mjs
git commit -m "feat(canvas-inspector): mark visual renderer (default, primitives, SVG, icon)"
```

---

### Task 8: Minimap mark layout helper

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/marks/render.js` — add `renderMinimapMarks`.
- Modify: `tests/toolkit/canvas-inspector-marks-render.test.mjs` — add layout tests.

- [ ] **Step 1: Write the failing tests**

Append to `tests/toolkit/canvas-inspector-marks-render.test.mjs`:

```js
import { renderMinimapMarks } from '../../packages/toolkit/components/canvas-inspector/marks/render.js';

test('renderMinimapMarks projects x,y through layout and centers size', () => {
  const fakeLayout = {
    inset: 2,
    minX: 0,
    minY: 0,
    scale: 0.1,
  };
  const marks = [{ id: 'a', x: 100, y: 200, size: 20, color: '#f00' }];
  const html = renderMinimapMarks(fakeLayout, [['cv', marks]], {});
  // center = (2 + 100*0.1, 2 + 200*0.1) = (12, 22)
  // mark box top-left = center - size/2 = (2, 12)
  assert.match(html, /left:2px/);
  assert.match(html, /top:12px/);
  assert.match(html, /width:20px/);
  assert.match(html, /height:20px/);
});

test('renderMinimapMarks skips marks with invalid coords', () => {
  const fakeLayout = { inset: 2, minX: 0, minY: 0, scale: 0.1 };
  const marks = [{ id: 'a', x: NaN, y: 200, size: 20, color: '#f00' }];
  const html = renderMinimapMarks(fakeLayout, [['cv', marks]], {});
  assert.equal(html, '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: FAIL — `renderMinimapMarks` not exported.

- [ ] **Step 3: Implement `renderMinimapMarks`**

Append to `render.js`:

```js
export function renderMinimapMarks(layout, canvasMarkEntries, iconCacheByKey) {
  if (!layout) return '';
  let html = '';
  for (const [canvasId, marks] of canvasMarkEntries) {
    for (const mark of marks) {
      if (!Number.isFinite(mark.x) || !Number.isFinite(mark.y)) continue;
      const cx = layout.inset + Math.round((mark.x - layout.minX) * layout.scale);
      const cy = layout.inset + Math.round((mark.y - layout.minY) * layout.scale);
      const half = Math.round(mark.size / 2);
      const cachedSrc = iconCacheByKey.get(`${canvasId}:${mark.id}`)?.src ?? null;
      const visual = renderMarkVisual(mark, { cachedSrc });
      html += `<div class="minimap-mark" style="position:absolute;left:${cx - half}px;top:${cy - half}px;width:${mark.size}px;height:${mark.size}px;pointer-events:none" data-canvas-id="${escapeAttr(canvasId)}" data-mark-id="${escapeAttr(mark.id)}">${visual}</div>`;
    }
  }
  return html;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/render.js tests/toolkit/canvas-inspector-marks-render.test.mjs
git commit -m "feat(canvas-inspector): minimap mark placement helper"
```

---

### Task 9: List row renderer for marks (indented under parent canvas)

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/marks/render.js` — add `renderMarkListRows`.
- Modify: `tests/toolkit/canvas-inspector-marks-render.test.mjs` — add list-row tests.

- [ ] **Step 1: Write the failing test**

Append to the render test file:

```js
import { renderMarkListRows } from '../../packages/toolkit/components/canvas-inspector/marks/render.js';

test('renderMarkListRows indents under parent with name + coords', () => {
  const marks = [{ id: 'avatar', name: 'Avatar', x: 942, y: 540, size: 20, color: '#f0f' }];
  const html = renderMarkListRows('avatar-main', marks, new Map());
  assert.match(html, /canvas-mark-row/);
  assert.match(html, /data-canvas-id="avatar-main"/);
  assert.match(html, /data-mark-id="avatar"/);
  assert.match(html, /Avatar/);
  assert.match(html, /942, 540/);
  assert.match(html, /padding-left:16px/);
});

test('renderMarkListRows returns empty for no marks', () => {
  assert.equal(renderMarkListRows('avatar-main', [], new Map()), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `renderMarkListRows`**

Append to `render.js`:

```js
export function renderMarkListRows(canvasId, marks, iconCacheByKey) {
  if (!marks || marks.length === 0) return '';
  let html = '';
  for (const mark of marks) {
    const cachedSrc = iconCacheByKey.get(`${canvasId}:${mark.id}`)?.src ?? null;
    const swatch = renderMarkVisual({ ...mark, size: 12 }, { cachedSrc });
    const coords = Number.isFinite(mark.x) && Number.isFinite(mark.y)
      ? `${Math.round(mark.x)}, ${Math.round(mark.y)}`
      : '\u2014';
    html += `<div class="canvas-mark-row" style="padding-left:16px" data-canvas-id="${escapeAttr(canvasId)}" data-mark-id="${escapeAttr(mark.id)}">`;
    html += `<span class="mark-swatch" style="display:inline-block;width:12px;height:12px;vertical-align:middle">${swatch}</span>`;
    html += `<span class="mark-name">${escapeAttr(mark.name)}</span>`;
    html += `<span class="mark-coords">${escapeAttr(coords)}</span>`;
    html += `</div>`;
  }
  return html;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/render.js tests/toolkit/canvas-inspector-marks-render.test.mjs
git commit -m "feat(canvas-inspector): list row renderer for indented marks"
```

---

### Task 10: Marks controller — wires state, normalize, reconcile, scheduler, render

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/controller.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/toolkit/canvas-inspector-marks-controller.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarksController } from '../../packages/toolkit/components/canvas-inspector/marks/controller.js';

function makeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
      for (const h of timers) while (!h.cleared && h.nextFire <= now) { h.fn(); h.nextFire += h.ms; }
    },
    setInterval: (fn, ms) => { const h = { fn, ms, nextFire: now + ms, cleared: false }; timers.push(h); return h; },
    clearInterval: (h) => { h.cleared = true; },
  };
}

test('handleMessage accepts a mark snapshot and rerenders', () => {
  const clock = makeClock();
  let rerendered = 0;
  const c = createMarksController({ clock, rerender: () => rerendered++ });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 1, y: 2 }] }
  });
  assert.equal(c.getMarks('cv').length, 1);
  assert.ok(rerendered >= 1);
});

test('empty objects clears and tears down tick', () => {
  const clock = makeClock();
  const c = createMarksController({ clock, rerender: () => {} });
  c.handleMessage({ type: 'canvas_object.marks', payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 1, y: 2 }] } });
  assert.equal(c.isTicking(), true);
  c.handleMessage({ type: 'canvas_object.marks', payload: { canvas_id: 'cv', objects: [] } });
  assert.equal(c.getMarks('cv').length, 0);
  assert.equal(c.isTicking(), false);
});

test('onCanvasRemoved evicts canvas marks', () => {
  const clock = makeClock();
  const c = createMarksController({ clock, rerender: () => {} });
  c.handleMessage({ type: 'canvas_object.marks', payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 1, y: 2 }] } });
  c.onCanvasRemoved('cv');
  assert.equal(c.getMarks('cv').length, 0);
  assert.equal(c.isTicking(), false);
});

test('TTL drops marks after 10s', () => {
  const clock = makeClock();
  const c = createMarksController({ clock, rerender: () => {} });
  c.handleMessage({ type: 'canvas_object.marks', payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 1, y: 2 }] } });
  clock.advance(9_900);
  assert.equal(c.getMarks('cv').length, 1);
  clock.advance(200);
  assert.equal(c.getMarks('cv').length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-controller.test.mjs`
Expected: FAIL — controller missing.

- [ ] **Step 3: Implement the controller**

```js
// packages/toolkit/components/canvas-inspector/marks/controller.js
import { normalizeMarks } from './normalize.js';
import { createReconciler, iconSignature } from './reconcile.js';
import { createScheduler } from './scheduler.js';
import { renderMinimapMarks, renderMarkListRows } from './render.js';

const TTL_MS = 10_000;

const defaultClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

export function createMarksController({
  clock = defaultClock,
  rerender = () => {},
  issueCapture = (_key, _timer, _mark) => {},
} = {}) {
  const state = {
    marksByCanvas: new Map(),
    iconCache: new Map(),
    tier3Timers: new Map(),
    captureEpochs: new Map(),
  };
  const reconciler = createReconciler(state);
  const scheduler = createScheduler(state, {
    clock,
    rerender,
    issueCapture,
  });

  function handleMessage(msg) {
    if (!msg || msg.type !== 'canvas_object.marks') return false;
    const payload = msg.payload || msg;
    const canvasId = payload.canvas_id;
    if (typeof canvasId !== 'string' || canvasId.length === 0) return false;
    const prev = state.marksByCanvas.get(canvasId);
    const normalized = normalizeMarks(canvasId, payload.objects);
    reconciler.diffAndReconcile(canvasId, prev?.objects || [], normalized);

    if (normalized.length === 0) {
      state.marksByCanvas.delete(canvasId);
      if (state.marksByCanvas.size === 0) scheduler.teardownTick();
    } else {
      state.marksByCanvas.set(canvasId, {
        objects: normalized,
        expiresAt: clock.now() + TTL_MS,
      });
      scheduler.ensureTick();
    }
    rerender();
    return true;
  }

  function onCanvasRemoved(canvasId) {
    if (!state.marksByCanvas.has(canvasId)) {
      reconciler.evictCanvas(canvasId);
      return;
    }
    state.marksByCanvas.delete(canvasId);
    reconciler.evictCanvas(canvasId);
    if (state.marksByCanvas.size === 0) scheduler.teardownTick();
    rerender();
  }

  function getMarks(canvasId) {
    return state.marksByCanvas.get(canvasId)?.objects ?? [];
  }

  function allMarks() {
    const out = [];
    for (const [canvasId, entry] of state.marksByCanvas) out.push([canvasId, entry.objects]);
    return out;
  }

  function minimapHtml(layout) {
    return renderMinimapMarks(layout, allMarks(), state.iconCache);
  }

  function listRowsFor(canvasId) {
    return renderMarkListRows(canvasId, getMarks(canvasId), state.iconCache);
  }

  return {
    handleMessage,
    onCanvasRemoved,
    getMarks,
    allMarks,
    minimapHtml,
    listRowsFor,
    isTicking: () => scheduler.isTicking(),
    _state: state,  // exposed for debugging
    _scheduler: scheduler,
    _reconciler: reconciler,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-controller.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/controller.js tests/toolkit/canvas-inspector-marks-controller.test.mjs
git commit -m "feat(canvas-inspector): marks controller binding state, reconcile, scheduler, render"
```

---

### Task 11: Wire `MarksController` into `CanvasInspector`

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/index.js`

- [ ] **Step 1: Read the current `CanvasInspector` default export (lines 168–398)**

Note the `manifest.requires`, `onMessage`, `rerender`, `renderMinimap`, `renderList`, and `applyLifecycle` definitions.

- [ ] **Step 2: Edit `packages/toolkit/components/canvas-inspector/index.js`**

Near the top of the file:

```js
import { createMarksController } from './marks/controller.js'
```

In the `CanvasInspector` factory, after the existing `let lastTintError = null`, add:

```js
  const marks = createMarksController({
    rerender: () => rerender(),
  })
```

Update the manifest `requires` list to include the new event:

```js
    manifest: {
      name: 'canvas-inspector',
      title: 'Canvas Inspector',
      accepts: ['bootstrap', 'canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      emits: [],
      channelPrefix: 'canvas-inspector',
      requires: ['canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      defaultSize: { w: 320, h: 480 },
    },
```

In `onMessage`, after the existing `canvas_lifecycle` branch, add:

```js
      if (msg.type === 'canvas_object.marks') {
        marks.handleMessage(msg)
        return
      }
```

In `applyLifecycle`, on the `removed` branch, add a call:

```js
    } else if (action === 'removed') {
      canvases = canvases.filter(c => c.id !== canvas_id)
      tintedIds.delete(canvas_id)
      tintMap.delete(canvas_id)
      marks.onCanvasRemoved(canvas_id)
    }
```

In `renderMinimap`, after the canvases pass (after the `for (const { canvas: c, x, y, w, h, isSelf } of layout.canvases)` loop ends), add:

```js
    html += marks.minimapHtml(layout)
```

In `renderList` (replace the function body with this version that injects mark rows per canvas):

```js
  function renderList(list) {
    const resolvedList = resolveCanvasFrames(list)
    if (resolvedList.length === 0) {
      return '<div class="empty-state">No canvases active</div>'
    }
    let html = '<div class="canvas-list">'
    for (const c of resolvedList) {
      const cls = c.id === SELF_ID ? 'canvas-item self' : 'canvas-item'
      const [x, y, w, h] = c.atResolved || c.at || [0, 0, 0, 0]
      const dims = `${Math.round(w)}\u00d7${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`
      html += `<div class="${cls}" data-id="${esc(c.id)}">`
      html += `<span class="canvas-id">${esc(c.id)}</span>`
      html += `<span class="canvas-dims">${dims}</span>`
      html += `<span class="canvas-flags">`
      if (c.interactive) html += `<span class="flag interactive">int</span>`
      if (c.scope === 'connection') html += `<span class="flag scoped">conn</span>`
      if (c.ttl != null) html += `<span class="flag">ttl:${Math.round(c.ttl)}s</span>`
      const tintClass = tintedIds.has(c.id) ? 'btn tint-btn active' : 'btn tint-btn'
      html += `<button class="${tintClass}" data-id="${esc(c.id)}">tint</button>`
      html += `<button class="btn remove-btn" data-id="${esc(c.id)}">\u2715</button>`
      html += `</span>`
      html += `</div>`
      html += marks.listRowsFor(c.id)
    }
    html += '</div>'
    return html
  }
```

In `syncDebugState`, expose marks state:

```js
  function syncDebugState() {
    window.__canvasInspectorState = {
      displays,
      canvases,
      eventCount,
      tintedIds: [...tintedIds],
      tintMap: Object.fromEntries(tintMap),
      cursor,
      lastTintError,
      marksByCanvas: Object.fromEntries(
        [...marks._state.marksByCanvas].map(([k, v]) => [k, v.objects])
      ),
    }
  }
```

- [ ] **Step 3: Sanity-check with existing unit tests**

Run: `node --test tests/toolkit/canvas-inspector.test.mjs tests/toolkit/canvas-inspector-marks-*.test.mjs`
Expected: all PASS. The existing inspector tests don't exercise `CanvasInspector()` directly (they hit helper exports), so they should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/index.js
git commit -m "feat(canvas-inspector): wire MarksController into subscribe + render pipeline"
```

---

### Task 12: Inspector CSS for indented mark rows

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/styles.css`

- [ ] **Step 1: Inspect the current styles file**

Read the file briefly to match existing token usage and avoid duplicating variables.

- [ ] **Step 2: Append mark styles**

Append to `packages/toolkit/components/canvas-inspector/styles.css`:

```css
.canvas-mark-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 6px 2px 16px;
  color: var(--text-muted, #888);
}
.canvas-mark-row .mark-swatch {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
}
.canvas-mark-row .mark-swatch svg,
.canvas-mark-row .mark-swatch img {
  display: block;
  width: 12px;
  height: 12px;
}
.canvas-mark-row .mark-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-mark-row .mark-coords {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.minimap-mark {
  pointer-events: none;
}
.minimap-mark svg,
.minimap-mark img {
  display: block;
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/styles.css
git commit -m "feat(canvas-inspector): styles for indented mark rows + minimap marks"
```

---

### Task 13: Sigil consumer — Tier 1 thumbnail bake + emit

**Files:**
- Modify: `apps/sigil/renderer/live-modules/persistent-stage.js`

- [ ] **Step 1: Read the current animate/emit surface**

Locate (approximately):
- Where the render loop lives (`animate()`, currently around `persistent-stage.js:603`).
- Where `host.post('sigil.stage.state', ...)` is emitted (`emitStageState`, around `persistent-stage.js:253`).
- `state.renderer.domElement` (the Three.js canvas).

- [ ] **Step 2: Add thumbnail + marks emit helpers**

At module scope (after the existing `liveJs` declaration, before `init()`):

```js
const thumbCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (thumbCanvas) { thumbCanvas.width = 20; thumbCanvas.height = 20; }
const thumbCtx = thumbCanvas?.getContext?.('2d') ?? null;
let thumbDataUrl = null;
let lastThumbBakedAt = 0;
let lastMarkEmitAt = 0;
const THUMB_INTERVAL_MS = 1000;
const MARK_EMIT_INTERVAL_MS = 100;

function bakeAvatarThumbnail() {
  if (!thumbCtx || !state.renderer?.domElement) return;
  const src = state.renderer.domElement;
  // src is the full-union GPU framebuffer. Convert desktop avatarPos to
  // canvas-local CSS pixels by subtracting the union window origin.
  const windowOriginX = liveJs.globalBounds.minX ?? 0;
  const windowOriginY = liveJs.globalBounds.minY ?? 0;
  const cssX = liveJs.avatarPos.x - windowOriginX;
  const cssY = liveJs.avatarPos.y - windowOriginY;
  const dpr = window.devicePixelRatio || 1;
  const r = (state.avatarHitRadius ?? 40) * 1.5;
  const sx = Math.max(0, Math.round((cssX - r) * dpr));
  const sy = Math.max(0, Math.round((cssY - r) * dpr));
  const sw = Math.round(r * 2 * dpr);
  const sh = Math.round(r * 2 * dpr);
  if (sw <= 0 || sh <= 0) return;
  thumbCtx.clearRect(0, 0, 20, 20);
  try {
    thumbCtx.drawImage(src, sx, sy, sw, sh, 0, 0, 20, 20);
    thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.3);
    lastThumbBakedAt = performance.now();
  } catch (error) {
    console.warn('[sigil-stage] thumbnail bake failed:', error);
    thumbDataUrl = null;
  }
}

function emitAvatarMark() {
  if (!liveJs.avatarPos.valid || !liveJs.visible) return;
  const now = performance.now();
  if (now - lastMarkEmitAt < MARK_EMIT_INTERVAL_MS) return;
  if (!thumbDataUrl || now - lastThumbBakedAt > THUMB_INTERVAL_MS) bakeAvatarThumbnail();
  lastMarkEmitAt = now;
  host.post('canvas_object.marks', {
    canvas_id: 'avatar-main',
    objects: [{
      id: `sigil.${liveJs.avatarId}`,
      name: liveJs.avatarName || 'Avatar',
      x: Math.round(liveJs.avatarPos.x),
      y: Math.round(liveJs.avatarPos.y),
      size: 20,
      icon: thumbDataUrl || undefined,
    }],
  });
}
```

In the `animate()` function, right after the line `state.renderer.render(state.scene, state.camera);` (near the end, before `scheduleRenderFrame()`), insert:

```js
    if (liveJs.avatarPos.valid && liveJs.visible) emitAvatarMark();
```

- [ ] **Step 3: Manual smoke**

```bash
./aos clean >/dev/null || true
bash build.sh
./aos serve --idle-timeout 10m &
sleep 2
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --track union >/dev/null
bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
# Make the avatar visible:
./aos show post --id avatar-main --event '{"type":"status_item.toggle","target_state":"visible"}' >/dev/null
sleep 3
./aos show eval --id canvas-inspector --js 'JSON.stringify(Object.keys(window.__canvasInspectorState.marksByCanvas))'
```
Expected: output includes `"avatar-main"`.

Tear down:
```bash
./aos show remove --id avatar-main --id canvas-inspector
pkill -f 'aos serve --idle-timeout' || true
```

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/renderer/live-modules/persistent-stage.js
git commit -m "feat(sigil): Tier 1 thumbnail bake + canvas_object.marks emit at 10 Hz"
```

---

### Task 14: Integration shell test (Part I)

**Files:**
- Create: `tests/canvas-inspector-object-marks.sh`

- [ ] **Step 1: Write the test**

```bash
#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-marks"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: daemon not ready"; exit 1; }

CONSUMER_ID="marks-consumer"
INSPECTOR_ID="canvas-inspector"

./aos show create --id "$CONSUMER_ID" --at 40,40,320,120 \
  --html '<!doctype html><html><body><script>
    window.headsup = window.headsup || {};
    function post(body) { window.webkit.messageHandlers.headsup.postMessage(body); }
    window.__sendMarks = function(objects) {
      post({ type: "canvas_object.marks", payload: { canvas_id: "'"$CONSUMER_ID"'", objects } });
    };
  </script></body></html>' >/dev/null

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
./aos show wait --id "$INSPECTOR_ID" --manifest canvas-inspector --timeout 5s >/dev/null

# Emit one mark
./aos show eval --id "$CONSUMER_ID" --js '__sendMarks([{ id: "alpha", x: 100, y: 200 }]); "ok"' >/dev/null

# Assert appears in inspector state
deadline=$((SECONDS + 5))
while (( SECONDS < deadline )); do
  if ./aos show eval --id "$INSPECTOR_ID" --js 'JSON.stringify(window.__canvasInspectorState.marksByCanvas["'"$CONSUMER_ID"'"] || [])' | grep -q '"alpha"'; then
    break
  fi
  sleep 0.2
done
./aos show eval --id "$INSPECTOR_ID" --js 'JSON.stringify(window.__canvasInspectorState.marksByCanvas["'"$CONSUMER_ID"'"] || [])' | grep -q '"alpha"' \
  || { echo "FAIL: alpha mark did not reach inspector"; exit 1; }

# Assert DOM row + minimap box rendered
./aos show eval --id "$INSPECTOR_ID" --js '!!document.querySelector(".canvas-mark-row[data-mark-id=\"alpha\"]") && !!document.querySelector(".minimap-mark[data-mark-id=\"alpha\"]")' | grep -q true \
  || { echo "FAIL: mark DOM not rendered"; exit 1; }

# Clear via empty objects
./aos show eval --id "$CONSUMER_ID" --js '__sendMarks([]); "ok"' >/dev/null
deadline=$((SECONDS + 3))
while (( SECONDS < deadline )); do
  if ./aos show eval --id "$INSPECTOR_ID" --js '!!window.__canvasInspectorState.marksByCanvas["'"$CONSUMER_ID"'"]' | grep -q false; then
    break
  fi
  sleep 0.2
done
./aos show eval --id "$INSPECTOR_ID" --js '!!window.__canvasInspectorState.marksByCanvas["'"$CONSUMER_ID"'"]' | grep -q false \
  || { echo "FAIL: empty objects[] did not clear marks"; exit 1; }

echo "PASS: canvas-inspector object marks (Part I)"
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x tests/canvas-inspector-object-marks.sh
bash tests/canvas-inspector-object-marks.sh
```
Expected: `PASS: canvas-inspector object marks (Part I)`.

- [ ] **Step 3: Commit**

```bash
git add tests/canvas-inspector-object-marks.sh
git commit -m "test: integration shell test for canvas_object.marks end-to-end (Part I)"
```

---

### Task 15: Consumer documentation

**Files:**
- Modify: `docs/api/toolkit.md`

- [ ] **Step 1: Add `canvas_object.marks` section**

Append to `docs/api/toolkit.md`:

```markdown
## Canvas Inspector — object marks

Consumers can publish ephemeral "object marks" that `canvas-inspector` renders on its minimap and in an indented list row under the parent canvas.

**Event:**

```js
host.post('canvas_object.marks', {
  canvas_id: '<parent canvas id>',
  objects: [
    {
      id: 'avatar',           // REQUIRED, stable per object
      x: 942,                 // desktop CG points
      y: 540,
      size: 20,               // optional, minimap px (default 20, 4-128)
      color: '#ff66cc',       // optional (default: stable random per id)
      name: 'Avatar',         // optional (default: id)
      shape: 'circle',        // optional primitive OR raw <svg>…</svg>
      icon: 'data:image/...', // optional URL (data:, aos://, or http(s)://)
                              // OR 'capture' for Tier 3
      icon_region: { x, y, w, h }, // required when icon === 'capture'
      icon_hz: 1,             // optional capture cadence (0.1-10)
    },
  ],
});
```

**Semantics:**

- Full-snapshot replace. Every emit is authoritative for that `canvas_id`.
- Emit `objects: []` to clear marks for that canvas.
- Emit at ~1 Hz minimum to keep marks alive; 10 Hz for moving objects. Idle TTL is 10s.
- `id` must be stable across emits and unique within a snapshot.
- Inspector chooses the visual in precedence: `icon` > `shape` > default (2px circle-in-square + crosshair, colored by `color`).

**Tier 1 (recommended) — consumer-produced thumbnail:**

```js
// In your render loop, throttled to ~1 Hz:
const thumb = document.createElement('canvas');
thumb.width = 20; thumb.height = 20;
thumb.getContext('2d').drawImage(
  myRenderer.domElement, sx, sy, sw, sh, 0, 0, 20, 20
);
myThumbUrl = thumb.toDataURL('image/jpeg', 0.3);
// Emit with icon: myThumbUrl — same string re-used between bakes is cached.
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/api/toolkit.md
git commit -m "docs(api): canvas_object.marks consumer contract"
```

**Part I complete.** Ship target: Sigil avatar appears on inspector minimap + list, thumbnail reflects current geometry/color, marks clear on empty emit or after 10s idle.

---

## Part II — Tier 3 capture path

Part II is optional for Part I ship. It adds a daemon canvas-to-capture verb and the inspector Tier 3 request pipeline so non-web consumers can get live desktop thumbnails.

### Task 16: Daemon verb — `see.capture` from canvas context

**Files:**
- Modify: `src/daemon/unified.swift`
- Modify: `tests/daemon-ipc-see.sh` (existing) or create new

**Goal:** A canvas can `postMessage({type:'see.capture', payload: {region:{x,y,w,h}, format:'jpg', quality:'low', request_id:'<uuid>'}})` and receive back a message `{type:'see.capture.reply', payload:{request_id, base64, error}}`.

- [ ] **Step 1: Identify the existing capture entry point**

Grep for where `aos see capture` handles `--region --base64 --format --quality`:
```bash
grep -rn 'captureRegion\|captureCanvas\|captureImpl' src/perceive src/commands 2>/dev/null | head
```

Read the underlying Swift function that takes a region + format + quality and returns a base64 string (in `src/perceive/` or `src/commands/see.swift`). Identify its public entry point.

- [ ] **Step 2: Add the canvas-dispatch branch in `unified.swift`**

In the canvas-message switch block, before the `canvas_object.marks` branch added in Task 1, add:

```swift
                case "see.capture":
                    self.handleCanvasCaptureRequest(callerID: canvasID, payload: inner ?? [:])
                    return
```

- [ ] **Step 3: Implement `handleCanvasCaptureRequest`**

After `forwardCanvasObjectMarks`, add:

```swift
    private func handleCanvasCaptureRequest(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String ?? ""
        let region = payload["region"] as? [String: Any] ?? [:]
        let format = payload["format"] as? String ?? "jpg"
        let quality = payload["quality"] as? String ?? "low"

        guard
            let x = (region["x"] as? NSNumber)?.doubleValue,
            let y = (region["y"] as? NSNumber)?.doubleValue,
            let w = (region["w"] as? NSNumber)?.doubleValue,
            let h = (region["h"] as? NSNumber)?.doubleValue
        else {
            sendCaptureReply(to: callerID, requestID: requestID, base64: nil, error: "invalid_region")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            // CALL the existing see-capture helper with (x, y, w, h, format, quality)
            // and obtain a base64 string. Adapt the exact symbol name to match
            // the current see command's implementation discovered in Step 1.
            let result = SeeCapture.captureRegionBase64(x: x, y: y, w: w, h: h, format: format, quality: quality)
            DispatchQueue.main.async {
                self.sendCaptureReply(to: callerID, requestID: requestID, base64: result.base64, error: result.error)
            }
        }
    }

    private func sendCaptureReply(to canvasID: String, requestID: String, base64: String?, error: String?) {
        var payload: [String: Any] = ["type": "see.capture.reply", "request_id": requestID]
        if let b64 = base64 { payload["base64"] = b64 }
        if let err = error { payload["error"] = err }
        canvasManager.postMessageAsync(canvasID: canvasID, payload: payload)
    }
```

**Adapter note:** `SeeCapture.captureRegionBase64` is a stand-in for whatever the real helper is named. In Step 1 you identified the actual function. Wrap it in a small bridge function inside `src/perceive/` that returns `(base64: String?, error: String?)`.

- [ ] **Step 4: Rebuild and smoke**

```bash
bash build.sh
./aos serve --idle-timeout 5m &
sleep 2
./aos show create --id probe --at 0,0,400,200 --html '<html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = (b64) => { window.__reply = JSON.parse(atob(b64)); };
setTimeout(() => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "see.capture",
    payload: { region: { x: 0, y: 0, w: 40, h: 40 }, format: "jpg", quality: "low", request_id: "t1" }
  });
}, 300);
</script></body></html>' >/dev/null
sleep 2
./aos show eval --id probe --js 'JSON.stringify(window.__reply && { rid: window.__reply.request_id, hasBase: !!window.__reply.base64 })'
```
Expected: `{"rid":"t1","hasBase":true}`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift src/perceive/
git commit -m "feat(daemon): see.capture verb for canvas-originated region captures"
```

---

### Task 17: Scheduler Tier 3 dispatch — real `issueCapture`

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/marks/controller.js`
- Create: `packages/toolkit/components/canvas-inspector/marks/capture-client.js`
- Test: `tests/toolkit/canvas-inspector-marks-tier3.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/toolkit/canvas-inspector-marks-tier3.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarksController } from '../../packages/toolkit/components/canvas-inspector/marks/controller.js';

function makeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    advance: (ms) => { now += ms; for (const h of timers) while (!h.cleared && h.nextFire <= now) { h.fn(); h.nextFire += h.ms; } },
    setInterval: (fn, ms) => { const h = { fn, ms, nextFire: now + ms, cleared: false }; timers.push(h); return h; },
    clearInterval: (h) => { h.cleared = true; },
  };
}

test('tier 3 mark triggers issueCapture on next tick with seq=1, inflight=true', () => {
  const clock = makeClock();
  const issued = [];
  const c = createMarksController({
    clock,
    rerender: () => {},
    issueCapture: (key, timer, mark) => issued.push({ key, gen: timer.gen, seq: timer.seq, inflight: timer.inflight }),
  });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  clock.advance(120); // first tick at 100ms
  assert.equal(issued.length, 1);
  assert.equal(issued[0].seq, 1);
  assert.equal(issued[0].inflight, true);
});

test('inflight prevents second capture even if nextAt elapsed', () => {
  const clock = makeClock();
  const issued = [];
  const c = createMarksController({
    clock,
    rerender: () => {},
    issueCapture: (key, timer, mark) => issued.push(timer.seq),
  });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  clock.advance(120);  // issues seq=1
  clock.advance(200);  // would issue again but inflight true
  assert.deepEqual(issued, [1]);
});

test('commitCapture accepts response and clears inflight', () => {
  const clock = makeClock();
  let inflightAtIssue = null;
  const c = createMarksController({
    clock,
    rerender: () => {},
    issueCapture: (key, timer, mark) => { inflightAtIssue = timer.inflight; },
  });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  clock.advance(120);
  assert.equal(inflightAtIssue, true);
  const t = c._state.tier3Timers.get('cv:a');
  c.commitCapture('cv:a', { gen: t.gen, seq: t.seq, iconSig: 'cap:0:0:10:10:10', base64: 'ZZ', error: null });
  assert.equal(c._state.iconCache.get('cv:a')?.src, 'data:image/jpeg;base64,ZZ');
  assert.equal(c._state.tier3Timers.get('cv:a').inflight, false);
});

test('stale gen response is rejected but still clears inflight', () => {
  const clock = makeClock();
  const c = createMarksController({ clock, rerender: () => {}, issueCapture: () => {} });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  clock.advance(120);
  const t = c._state.tier3Timers.get('cv:a');
  c.commitCapture('cv:a', { gen: t.gen - 1, seq: t.seq, iconSig: 'cap:0:0:10:10:10', base64: 'OLD' });
  assert.equal(c._state.iconCache.has('cv:a'), false);
  assert.equal(c._state.tier3Timers.get('cv:a').inflight, false);
});

test('remove+readd+stale-reply does not repopulate (captureEpochs guard)', () => {
  const clock = makeClock();
  const c = createMarksController({ clock, rerender: () => {}, issueCapture: () => {} });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  clock.advance(120);
  const inflightTimer = c._state.tier3Timers.get('cv:a');
  const staleGen = inflightTimer.gen;
  const staleSeq = inflightTimer.seq;
  // Remove mark
  c.handleMessage({ type: 'canvas_object.marks', payload: { canvas_id: 'cv', objects: [] } });
  // Re-add same id + same region (same iconSig)
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: { x:0,y:0,w:10,h:10 }, icon_hz: 10 }] },
  });
  // Old response arrives
  c.commitCapture('cv:a', { gen: staleGen, seq: staleSeq, iconSig: 'cap:0:0:10:10:10', base64: 'STALE' });
  assert.equal(c._state.iconCache.has('cv:a'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector-marks-tier3.test.mjs`
Expected: FAIL — `commitCapture` not exposed.

- [ ] **Step 3: Implement `commitCapture` in controller**

Edit `packages/toolkit/components/canvas-inspector/marks/controller.js`. Inside `createMarksController`, after `onCanvasRemoved`, add:

```js
  function commitCapture(key, response) {
    const timer = state.tier3Timers.get(key);
    if (!timer) return;  // entry evicted; no inflight to clear
    const [canvasId, id] = splitKey(key);
    const mark = state.marksByCanvas.get(canvasId)?.objects?.find(m => m.id === id) ?? null;

    let accepted = false;
    if (mark && response && !response.error) {
      const currentSig = iconSignature(mark);
      if (
        currentSig === response.iconSig &&
        timer.gen === response.gen &&
        timer.seq === response.seq &&
        typeof response.base64 === 'string'
      ) {
        state.iconCache.set(key, {
          src: `data:image/jpeg;base64,${response.base64}`,
          capturedAt: clock.now(),
          iconSig: currentSig,
        });
        accepted = true;
      }
    }
    timer.inflight = false;
    if (accepted) rerender();
  }

  function splitKey(key) {
    const idx = key.indexOf(':');
    return [key.slice(0, idx), key.slice(idx + 1)];
  }
```

Make sure `iconSignature` is imported at the top of the file — if not, add:

```js
import { iconSignature } from './reconcile.js';
```

Add `commitCapture` to the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector-marks-tier3.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/controller.js tests/toolkit/canvas-inspector-marks-tier3.test.mjs
git commit -m "feat(canvas-inspector): Tier 3 commitCapture with stale-response guard"
```

---

### Task 18: Capture client — real `issueCapture` over the daemon bridge

**Files:**
- Create: `packages/toolkit/components/canvas-inspector/marks/capture-client.js`
- Modify: `packages/toolkit/components/canvas-inspector/index.js`

- [ ] **Step 1: Write the capture client**

```js
// packages/toolkit/components/canvas-inspector/marks/capture-client.js
import { emit } from '../../../runtime/bridge.js';

export function createCaptureClient({ onCommit }) {
  const pending = new Map(); // request_id -> { key, gen, seq, iconSig }
  let counter = 0;

  function issue(key, timer, mark) {
    counter += 1;
    const rid = `cap-${counter}-${Math.random().toString(36).slice(2, 8)}`;
    const { iconSignature } = require('./reconcile.js');
    const iconSig = iconSignature(mark);
    pending.set(rid, { key, gen: timer.gen, seq: timer.seq, iconSig });
    emit('see.capture', {
      request_id: rid,
      region: mark.icon_region,
      format: 'jpg',
      quality: 'low',
    });
  }

  function onReply(msg) {
    if (!msg || msg.type !== 'see.capture.reply') return false;
    const payload = msg.payload || msg;
    const rid = payload.request_id;
    const meta = pending.get(rid);
    if (!meta) return true; // unknown rid — drop
    pending.delete(rid);
    onCommit(meta.key, {
      gen: meta.gen,
      seq: meta.seq,
      iconSig: meta.iconSig,
      base64: payload.base64 ?? null,
      error: payload.error ?? null,
    });
    return true;
  }

  return { issue, onReply };
}
```

Note: the `require('./reconcile.js')` above uses a lazy import pattern — since the runtime is ESM, change to an ESM import at top instead:

```js
import { iconSignature } from './reconcile.js';
```

And drop the in-function `require`.

- [ ] **Step 2: Wire the capture client into `CanvasInspector`**

Edit `packages/toolkit/components/canvas-inspector/index.js`:

Import at top:
```js
import { createCaptureClient } from './marks/capture-client.js'
```

Inside the `CanvasInspector` factory, **before** `const marks = createMarksController(...)`, add:

```js
  let marks = null
  const capture = createCaptureClient({
    onCommit: (key, response) => marks?.commitCapture(key, response),
  })
```

Then when creating the controller:

```js
  marks = createMarksController({
    rerender: () => rerender(),
    issueCapture: capture.issue,
  })
```

In `onMessage`, add a branch for capture replies (before the `canvas_object.marks` branch):

```js
      if (msg.type === 'see.capture.reply') {
        capture.onReply(msg)
        return
      }
```

- [ ] **Step 3: Smoke via integration test**

No new unit test — the controller tests already exercise `commitCapture`. Exercise the wiring via the new integration test in Task 19.

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/marks/capture-client.js packages/toolkit/components/canvas-inspector/index.js
git commit -m "feat(canvas-inspector): capture client wiring Tier 3 over daemon see.capture"
```

---

### Task 19: Integration shell test for Tier 3

**Files:**
- Create: `tests/canvas-inspector-object-marks-tier3.sh`

- [ ] **Step 1: Write the test**

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-marks-tier3"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

# Screen recording required
if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  echo "SKIP: requires screen recording"
  exit 0
fi

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: daemon not ready"; exit 1; }

CONSUMER_ID="marks-tier3-consumer"
INSPECTOR_ID="canvas-inspector"

./aos show create --id "$CONSUMER_ID" --at 40,40,320,120 \
  --html '<!doctype html><html><body style="background:#f0f"><script>
    window.headsup = window.headsup || {};
    window.webkit.messageHandlers.headsup.postMessage({
      type: "canvas_object.marks",
      payload: { canvas_id: "'"$CONSUMER_ID"'", objects: [{ id: "t3", x: 200, y: 80, icon: "capture", icon_region: { x: 40, y: 40, w: 80, h: 80 }, icon_hz: 2 }] }
    });
  </script></body></html>' >/dev/null

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
./aos show wait --id "$INSPECTOR_ID" --manifest canvas-inspector --timeout 5s >/dev/null

# Wait up to 4s for a cached src to appear for cv:t3
deadline=$((SECONDS + 4))
while (( SECONDS < deadline )); do
  if ./aos show eval --id "$INSPECTOR_ID" --js "
    (() => {
      const s = window.__canvasInspectorState;
      return !!(s && s.marksByCanvas && s.marksByCanvas['$CONSUMER_ID']);
    })()
  " | grep -q true; then
    break
  fi
  sleep 0.2
done

# Validate that a thumbnail img shows up on the minimap for the capture mark
./aos show eval --id "$INSPECTOR_ID" --js '
  (() => {
    const el = document.querySelector(".minimap-mark[data-mark-id=\"t3\"] img");
    return !!el && el.src.startsWith("data:image/jpeg;base64,");
  })()
' | grep -q true \
  || { echo "FAIL: Tier 3 thumbnail img did not render on minimap"; exit 1; }

echo "PASS: canvas-inspector object marks (Tier 3)"
```

- [ ] **Step 2: Run it**

```bash
chmod +x tests/canvas-inspector-object-marks-tier3.sh
bash tests/canvas-inspector-object-marks-tier3.sh
```
Expected: `PASS` (or `SKIP` if no screen recording permission).

- [ ] **Step 3: Commit**

```bash
git add tests/canvas-inspector-object-marks-tier3.sh
git commit -m "test: integration shell test for Tier 3 capture pipeline"
```

---

### Task 20: Sanity test — one-in-flight invariant under long captures

**Files:**
- Modify: `tests/toolkit/canvas-inspector-marks-tier3.test.mjs`

- [ ] **Step 1: Add a test that simulates a long capture**

Append to the test file:

```js
test('one-in-flight invariant: scheduler does not issue second capture while first is outstanding', () => {
  const clock = makeClock();
  const issued = [];
  const c = createMarksController({
    clock,
    rerender: () => {},
    issueCapture: (key, timer, mark) => { issued.push(timer.seq); },  // never commit -> inflight stays true
  });
  c.handleMessage({
    type: 'canvas_object.marks',
    payload: { canvas_id: 'cv', objects: [{ id: 'a', x: 0, y: 0, icon: 'capture', icon_region: {x:0,y:0,w:10,h:10}, icon_hz: 10 }] },
  });
  clock.advance(1000);  // 10 ticks, but only 1 capture should issue because inflight stays true
  assert.deepEqual(issued, [1]);
});
```

- [ ] **Step 2: Run**

Run: `node --test tests/toolkit/canvas-inspector-marks-tier3.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/toolkit/canvas-inspector-marks-tier3.test.mjs
git commit -m "test(canvas-inspector): one-in-flight invariant under simulated long capture"
```

---

### Task 21: Tier 3 docs

**Files:**
- Modify: `docs/api/toolkit.md`

- [ ] **Step 1: Append Tier 3 subsection**

Append to the `Canvas Inspector — object marks` section:

```markdown
**Tier 3 — `icon: "capture"` backed by `aos see`:**

For non-web consumers or desktop regions you do not render:

```js
host.post('canvas_object.marks', {
  canvas_id: 'my-canvas',
  objects: [{
    id: 'win-123',
    x: 800, y: 600,
    icon: 'capture',
    icon_region: { x: 760, y: 560, w: 80, h: 80 },
    icon_hz: 1,  // captures per second, [0.1, 10]
  }],
});
```

Inspector issues a capture via the daemon's `see.capture` verb on each tick where `now >= nextAt && !inflight`. The one-in-flight invariant + `(iconSig, gen, seq)` response guard + persistent `captureEpochs` make the pipeline stale-response-safe across region changes, remove/re-add, and overlapping long captures. See the spec for the full state machine.
```

- [ ] **Step 2: Commit**

```bash
git add docs/api/toolkit.md
git commit -m "docs(api): Tier 3 capture mode for canvas_object.marks"
```

---

### Task 22: Close #80 / update issue state

**Files:** none (gh command only)

- [ ] **Step 1: Run the full test suite**

```bash
node --test tests/toolkit/canvas-inspector-marks-*.test.mjs tests/toolkit/canvas-inspector.test.mjs
bash tests/canvas-inspector-object-marks.sh
bash tests/canvas-inspector-object-marks-tier3.sh    # may SKIP without screen recording
```
Expected: all PASS (or the Tier 3 shell test SKIPs).

- [ ] **Step 2: Comment on #80 and close when ready**

```bash
gh issue comment 80 --body "Both parts landed. Part I: daemon fan-out, normalize, reconcile, scheduler, default/shape/icon rendering, Sigil Tier 1 consumer, integration test passing. Part II: see.capture daemon verb, Tier 3 inspector request pipeline, stale-response guards, one-in-flight invariant, recreate-race guard, all unit tests + shell test passing."
gh issue close 80
```

---

## Self-Review Pass

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Wire contract (`canvas_object.marks`, full-snapshot) | Task 1 (daemon), Task 10 (controller) |
| `id` required + per-snapshot uniqueness | Task 2 |
| Lifecycle TTL 10s, parent removal, re-emit resets | Task 6 (TTL sweep), Task 10 (controller), Task 11 (wire `onCanvasRemoved`) |
| Default shape (circle-in-square + x-crosshair) | Task 7 |
| Primitive shapes | Task 7 |
| Raw SVG + sanitizer | Tasks 3 + 7 |
| Icon URL (Tier 1/2) | Task 7 |
| Tier 3 `icon: "capture"` | Tasks 16–20 |
| `(iconSig, gen, seq)` response guard | Task 17 |
| One-in-flight invariant | Tasks 6 (stub) + 17 + 20 |
| `captureEpochs` recreate-race guard | Task 4 (reconcile) + Task 17 (test) |
| Empty `objects: []` clears outright | Task 10 |
| Scheduler tick lifecycle (ensure/teardown) | Task 6 |
| Minimap render | Task 8 + Task 11 |
| Indented list rows | Task 9 + Task 11 |
| Sigil Tier 1 consumer | Task 13 |
| Integration tests (emit + state + clear + TTL) | Task 14 + Task 19 |
| Consumer docs | Tasks 15 + 21 |

**Placeholder scan:** no TBD, TODO, or "similar to Task N" shortcuts — each code step contains runnable code.

**Type consistency:** `createMarksController` exposes `handleMessage`, `onCanvasRemoved`, `commitCapture`, `getMarks`, `allMarks`, `minimapHtml`, `listRowsFor`, `isTicking`, `_state`, `_scheduler`, `_reconciler`. All call sites in Task 11 and 18 use these exact names. Scheduler exports `ensureTick`, `teardownTick`, `isTicking`, `tick`. Reconciler exports `diffAndReconcile`, `bumpEpoch`, `evictCanvas`.

**Known caveat for Task 16:** the exact Swift symbol for the existing region-capture helper may differ from the placeholder `SeeCapture.captureRegionBase64`. Step 1 of Task 16 says explicitly to locate the real symbol; the wrapper in Step 3 is adapted accordingly. This is a research step, not a placeholder — the plan directs the engineer to identify the symbol before writing the call site.
