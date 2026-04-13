# Sigil — birthplace + lastPosition refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `instance.home` with `instance.birthplace` (first-spawn only) and add a daemon-side in-memory `lastPosition` map updated on IDLE, so the avatar remembers where the user drops it for the daemon's lifetime.

**Architecture:** Renderer owns position semantics; daemon is a passive per-agent KV store exposed over the existing canvas IPC bridge. Schema on the wiki doc is a pure rename (same fields), migrated once on first load. No disk persistence, no new pub/sub channel.

**Tech Stack:** Swift (daemon), JavaScript ES modules (renderer + agent-loader), node:test for unit tests, `aos show eval` for integration smoke.

**Spec:** `docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md` (HEAD `d10343d`).

---

## File map

**Renamed:**
- `apps/sigil/renderer/home-resolver.js` → `apps/sigil/renderer/birthplace-resolver.js`
- `apps/sigil/tests/home-resolver-test.html` → `apps/sigil/tests/birthplace-resolver-test.html`

**Modified:**
- `apps/sigil/renderer/agent-loader.js` — rename `MINIMAL_DEFAULT.instance.home` → `.birthplace`; add migration logic to `loadAgent`.
- `apps/sigil/renderer/index.html` — update imports, rename call site, add `resolvePosition()` in boot, add lastPosition post on IDLE transition.
- `apps/sigil/seed/wiki/sigil/agents/default.md` — rename `home` → `birthplace` in the JSON block.
- `src/daemon/unified.swift` — add `lastPositions` map + dispatch cases for `agent.lastPosition.get` / `agent.lastPosition.set`.

**Created:**
- `tests/renderer/birthplace-resolver.test.mjs` — node:test suite for the resolver.
- `tests/renderer/agent-loader.test.mjs` — node:test suite for `parseAgentDoc` + migration branches.
- `apps/sigil/tests/birthplace-acceptance.md` — integration acceptance evidence.

---

## Task 1: Rename home-resolver → birthplace-resolver (symbols + imports + HTML test)

**Files:**
- Rename: `apps/sigil/renderer/home-resolver.js` → `apps/sigil/renderer/birthplace-resolver.js`
- Rename: `apps/sigil/tests/home-resolver-test.html` → `apps/sigil/tests/birthplace-resolver-test.html`
- Modify: `apps/sigil/renderer/birthplace-resolver.js` (rename export + param names + comments)
- Modify: `apps/sigil/tests/birthplace-resolver-test.html` (update import path + symbol name)
- Modify: `apps/sigil/renderer/index.html:3249-3260` (module import block) and `:3422` (call site)

This task does a pure symbol rename. No behavioral change. The existing HTML test continues to pass after rename.

- [ ] **Step 1: git-mv both files**

```bash
cd /Users/Michael/Code/agent-os
git mv apps/sigil/renderer/home-resolver.js apps/sigil/renderer/birthplace-resolver.js
git mv apps/sigil/tests/home-resolver-test.html apps/sigil/tests/birthplace-resolver-test.html
```

- [ ] **Step 2: Rename the exported function and update comments inside `birthplace-resolver.js`**

Replace the file contents with:

```javascript
// Birthplace position resolver for Sigil agents.
//
// Maps an agent's `instance.birthplace` descriptor + the current display
// geometry to an absolute global-canvas (x, y) point. Consulted at first
// spawn only; subsequent spawns use the daemon-side lastPosition map.
//
// Inputs:
//   birthplace: one of
//     - { anchor: 'coords', coords: { x, y } }                   // absolute point
//     - { anchor: 'nonant', nonant: <cell>, display: <uuid|'main'> }
//   displays: AOS display_geometry array; each entry has
//             { uuid, is_main, visible_bounds: { x, y, w, h }, ... }
//
// Nonant grid: 3x3 cells on the visible-bounds rect; cell centers at
// (1/6, 3/6, 5/6) along each axis.
//
// Fallbacks (robust by design — never throws for bad input):
//   - unknown display UUID           → main display
//   - unknown nonant cell            → 'bottom-right'
//   - no displays / empty array      → { x: 0, y: 0 }

const NONANT_CELLS = {
  'top-left':      [1/6, 1/6],
  'top-center':    [3/6, 1/6],
  'top-right':     [5/6, 1/6],
  'middle-left':   [1/6, 3/6],
  'middle-center': [3/6, 3/6],
  'middle-right':  [5/6, 3/6],
  'bottom-left':   [1/6, 5/6],
  'bottom-center': [3/6, 5/6],
  'bottom-right':  [5/6, 5/6],
};

export function resolveBirthplace(birthplace, displays) {
  const mainDisplay = displays.find(d => d.is_main) ?? displays[0];
  if (!mainDisplay) return { x: 0, y: 0 };

  if (birthplace.anchor === 'coords' && birthplace.coords) {
    return { x: birthplace.coords.x, y: birthplace.coords.y };
  }

  // Anchor to display — resolve by UUID or 'main'
  const target = birthplace.display === 'main'
    ? mainDisplay
    : (displays.find(d => d.uuid === birthplace.display) ?? mainDisplay);

  const vb = target.visible_bounds;
  const cell = NONANT_CELLS[birthplace.nonant ?? 'bottom-right'] ?? NONANT_CELLS['bottom-right'];
  return { x: vb.x + vb.w * cell[0], y: vb.y + vb.h * cell[1] };
}
```

- [ ] **Step 3: Update the HTML test file import + symbol**

In `apps/sigil/tests/birthplace-resolver-test.html`, find the line:

```html
import { resolveHome } from '../renderer/home-resolver.js';
```

Replace with:

```html
import { resolveBirthplace } from '../renderer/birthplace-resolver.js';
```

Then find-and-replace every call to `resolveHome(` with `resolveBirthplace(` in the same file. Also rename the test case parameter names from `home` to `birthplace` (e.g., `const home = { anchor: 'nonant', ... }` → `const birthplace = { anchor: 'nonant', ... }`).

- [ ] **Step 4: Update the renderer boot block — import + call site**

In `apps/sigil/renderer/index.html`, locate the module import block around line 3249–3260 and find:

```javascript
import { resolveHome } from './home-resolver.js';
```

Replace with:

```javascript
import { resolveBirthplace } from './birthplace-resolver.js';
```

Then locate the call site near line 3422:

```javascript
const home = resolveHome(agent.instance.home, displays);
```

Replace with (note: the `?? agent.instance.home` is a temporary compat bridge that keeps bisectability — it's removed when Task 6 rewrites this whole block to use `resolvePosition()`):

```javascript
// Temporary bridge: after Task 4 lands, loadAgent always returns agent
// objects with `instance.birthplace` populated, so the fallback becomes
// dead code. Task 6 rewrites this block to call resolvePosition().
const home = resolveBirthplace(agent.instance.birthplace ?? agent.instance.home, displays);
```

**Note:** the `?? agent.instance.home` compat bridge is what keeps the live avatar running between this commit and Task 4 (migration logic). Without it, any wiki doc still carrying `home` would cause `resolveBirthplace(undefined, …)` to throw on `birthplace.anchor`. The bridge is removed in Task 6.

- [ ] **Step 5: Verify the existing HTML test still passes**

Open the renamed test via the live daemon:

```bash
./aos show create --id rt-test --url 'aos://sigil/tests/birthplace-resolver-test.html' --interactive --at 100,100,640,400
sleep 1
./aos show eval --id rt-test --js 'document.title'
./aos show remove --id rt-test
```

Expected: `"PASS"`

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/renderer/birthplace-resolver.js \
        apps/sigil/tests/birthplace-resolver-test.html \
        apps/sigil/renderer/index.html
git commit -m "refactor(sigil): rename home-resolver → birthplace-resolver

Pure symbol rename per spec §schema. Module, HTML test, and renderer boot
call site updated in lockstep. MINIMAL_DEFAULT / migration / daemon wiring
land in subsequent commits.

Spec: docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md"
```

---

## Task 2: Add node-test suite for birthplace-resolver

**Files:**
- Create: `tests/renderer/birthplace-resolver.test.mjs`

The spec's testing section requires node:test coverage for the resolver (HTML-based tests are slower and don't run in CI cleanly). This is net-new.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/birthplace-resolver.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBirthplace } from '../../apps/sigil/renderer/birthplace-resolver.js';

const mainDisplay = {
  uuid: 'main-uuid',
  is_main: true,
  visible_bounds: { x: 0, y: 0, w: 1000, h: 800 },
};
const extDisplay = {
  uuid: 'ext-uuid',
  is_main: false,
  visible_bounds: { x: -1920, y: 0, w: 1920, h: 1080 },
};

test('anchor=coords returns the coords verbatim', () => {
  const out = resolveBirthplace(
    { anchor: 'coords', coords: { x: 123, y: 456 } },
    [mainDisplay]
  );
  assert.deepEqual(out, { x: 123, y: 456 });
});

test('anchor=nonant bottom-right on main display', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    [mainDisplay]
  );
  // 5/6 of (0..1000) = 833.33..; 5/6 of (0..800) = 666.66..
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 5/6) < 0.01);
});

test('anchor=nonant middle-center on external display (negative origin)', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'middle-center', display: 'ext-uuid' },
    [mainDisplay, extDisplay]
  );
  // center of (-1920..0, 0..1080) → (-960, 540)
  assert.ok(Math.abs(out.x - (-960)) < 0.01);
  assert.ok(Math.abs(out.y - 540) < 0.01);
});

test('unknown display UUID falls back to main', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'top-left', display: 'bogus-uuid' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 1/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 1/6) < 0.01);
});

test('unknown nonant cell falls back to bottom-right', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'nonsense', display: 'main' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 5/6) < 0.01);
});

test('empty displays array returns {0, 0}', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'top-left', display: 'main' },
    []
  );
  assert.deepEqual(out, { x: 0, y: 0 });
});

test('missing nonant field defaults to bottom-right', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', display: 'main' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
});
```

- [ ] **Step 2: Run it to confirm it passes (not fails — this is verifying the Task 1 rename)**

Run:

```bash
node --test tests/renderer/birthplace-resolver.test.mjs
```

Expected: 7 tests pass.

If tests fail because the module import fails, Task 1 missed a symbol rename — revisit and fix.

- [ ] **Step 3: Commit**

```bash
git add tests/renderer/birthplace-resolver.test.mjs
git commit -m "test(sigil): node-test suite for birthplace-resolver

Covers anchor=coords, anchor=nonant on main and external displays with
negative-coordinate origins, unknown UUID/cell fallbacks, empty displays,
and missing-field defaults. Replaces the HTML-based live-WKWebView test
as the primary regression suite (HTML test retained as a smoke surface)."
```

---

## Task 3: Update MINIMAL_DEFAULT + seed doc (rename `home` → `birthplace`)

**Files:**
- Modify: `apps/sigil/renderer/agent-loader.js:27` (single line inside `MINIMAL_DEFAULT.instance`)
- Modify: `apps/sigil/seed/wiki/sigil/agents/default.md:38` (single JSON line)

- [ ] **Step 1: Update MINIMAL_DEFAULT**

In `apps/sigil/renderer/agent-loader.js`, find:

```javascript
  instance: {
    home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    size: 300,
  },
```

Replace with:

```javascript
  instance: {
    birthplace: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    size: 300,
  },
```

- [ ] **Step 2: Update seed doc**

In `apps/sigil/seed/wiki/sigil/agents/default.md`, find:

```json
  "instance": {
    "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
    "size": 300
  }
```

Replace with:

```json
  "instance": {
    "birthplace": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
    "size": 300
  }
```

- [ ] **Step 3: Verify MINIMAL_DEFAULT parses through the loader**

Run:

```bash
node --input-type=module -e "import('./apps/sigil/renderer/agent-loader.js').then(m => console.log(JSON.stringify(m.MINIMAL_DEFAULT.instance, null, 2)))"
```

Expected output includes:

```
"birthplace": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" }
```

And does NOT include `"home":`.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/renderer/agent-loader.js apps/sigil/seed/wiki/sigil/agents/default.md
git commit -m "refactor(sigil): MINIMAL_DEFAULT + seed doc use birthplace

Renames instance.home → instance.birthplace in both the fallback object
and the default agent seed. Live wiki docs still holding 'home' continue
to work via the migration path landing in the next commit."
```

---

## Task 4: Add migration logic to `loadAgent`

**Files:**
- Modify: `apps/sigil/renderer/agent-loader.js` (extend `loadAgent`; `parseAgentDoc` stays pure)
- Create: `tests/renderer/agent-loader.test.mjs` (new suite — migration behavior on loadAgent is stubbed-fetch territory)

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/agent-loader.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentDoc, MINIMAL_DEFAULT } from '../../apps/sigil/renderer/agent-loader.js';

const FM = `---
type: agent
id: test
name: Test
---
`;

function docWith(instance) {
  return `${FM}\n\n\`\`\`json\n${JSON.stringify({
    version: 1,
    appearance: MINIMAL_DEFAULT.appearance,
    minds: MINIMAL_DEFAULT.minds,
    instance,
  }, null, 2)}\n\`\`\`\n`;
}

test('parseAgentDoc: birthplace-only passes through', () => {
  const md = docWith({ birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const out = parseAgentDoc(md);
  assert.equal(out.instance.birthplace.nonant, 'top-left');
  assert.equal(out.instance.home, undefined);
});

test('parseAgentDoc: home-only passes through untouched (migration happens in loadAgent, not here)', () => {
  const md = docWith({ home: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const out = parseAgentDoc(md);
  // parseAgentDoc is pure; it does not rewrite.
  assert.equal(out.instance.home.nonant, 'top-left');
  assert.equal(out.instance.birthplace, undefined);
});

test('parseAgentDoc: malformed json falls back to MINIMAL_DEFAULT', () => {
  const md = `${FM}\n\n\`\`\`json\n{ not valid\n\`\`\`\n`;
  const out = parseAgentDoc(md);
  assert.equal(out.instance.birthplace.nonant, 'bottom-right');
});

// loadAgent migration tests — stub global fetch
import { loadAgent } from '../../apps/sigil/renderer/agent-loader.js';

function stubFetch(responses) {
  // responses: Map<url, { status, text, onPut?: (body) => void }>
  const calls = { get: [], put: [] };
  globalThis.fetch = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const entry = responses.get(url);
    if (!entry) throw new Error(`unstubbed url: ${method} ${url}`);
    if (method === 'GET') {
      calls.get.push(url);
      return { ok: entry.status === 200, status: entry.status, text: async () => entry.text };
    }
    if (method === 'PUT') {
      calls.put.push({ url, body: init.body });
      if (entry.onPut) entry.onPut(init.body);
      return { ok: true, status: 200, text: async () => '' };
    }
    throw new Error(`unsupported method: ${method}`);
  };
  return calls;
}

test('loadAgent: birthplace-only → no PUT', async () => {
  const md = docWith({ birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const calls = stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 200, text: md }]]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(out.instance.birthplace.nonant, 'top-left');
  assert.equal(calls.put.length, 0, 'no PUT expected');
});

test('loadAgent: home-only → PUT with home rewritten to birthplace', async () => {
  const md = docWith({ home: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  let putBody = null;
  const calls = stubFetch(new Map([
    ['/wiki/sigil/agents/test.md', { status: 200, text: md, onPut: (b) => { putBody = b; } }],
  ]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(calls.put.length, 1, 'expected one PUT');
  assert.ok(putBody.includes('"birthplace"'), 'PUT body contains birthplace');
  assert.ok(!putBody.includes('"home"'), 'PUT body has no home key');
  assert.equal(out.instance.birthplace.nonant, 'top-left', 'returned agent uses birthplace');
  assert.equal(out.instance.home, undefined);
});

test('loadAgent: both present → birthplace wins, no PUT, advisory logged', async () => {
  const md = docWith({
    birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' },
    home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    size: 200,
  });
  const calls = stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 200, text: md }]]));
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const out = await loadAgent('sigil/agents/test');
    assert.equal(out.instance.birthplace.nonant, 'top-left');
    assert.equal(calls.put.length, 0, 'no PUT on both-present');
    assert.ok(warnings.some(w => /orphaned|both/i.test(w)), 'advisory warn logged');
  } finally {
    console.warn = origWarn;
  }
});

test('loadAgent: fetch fails → MINIMAL_DEFAULT with birthplace', async () => {
  stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 404, text: '' }]]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(out.instance.birthplace.nonant, 'bottom-right');
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
node --test tests/renderer/agent-loader.test.mjs
```

Expected: `parseAgentDoc` tests pass (those test pure behavior already working). `loadAgent: home-only → PUT...` and `loadAgent: both present → advisory...` fail — no migration logic yet.

- [ ] **Step 3: Implement the migration in `loadAgent`**

Replace the existing `loadAgent` function at the bottom of `apps/sigil/renderer/agent-loader.js` with:

```javascript
export async function loadAgent(wikiPath) {
  try {
    const url = `/wiki/${wikiPath}.md`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const agent = parseAgentDoc(text);

    // Migration: if the doc has `home` but not `birthplace`, rewrite on disk
    // and upgrade the in-memory agent. If both are present, `birthplace` wins
    // and `home` is left orphaned (logged advisory, no rewrite — we don't
    // mutate docs on a read path when both fields are present).
    const inst = agent.instance ?? {};
    const hasBirthplace = inst.birthplace != null;
    const hasHome = inst.home != null;

    if (hasBirthplace && hasHome) {
      console.warn('[agent-loader] agent doc has both birthplace and home; home is orphaned and will NOT be removed automatically (to avoid unexpected writes on read). Manual cleanup recommended.');
      return agent;
    }

    if (!hasBirthplace && hasHome) {
      // In-place rename. `agent.instance` already came from parseAgentDoc,
      // which returned a fresh object — safe to mutate.
      agent.instance = { ...inst, birthplace: inst.home };
      delete agent.instance.home;

      // Rewrite the wiki doc so `home` no longer appears on disk. Best-effort:
      // if the PUT fails we keep the in-memory rewrite and the next load will
      // retry. Construct the new body by replacing the `home` key token in
      // the JSON block — simpler and safer than round-tripping through the
      // full frontmatter + JSON serializer.
      const rewritten = text.replace(/"home"\s*:/g, '"birthplace":');
      try {
        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/markdown' },
          body: rewritten,
        });
        if (!putRes.ok) throw new Error(`PUT HTTP ${putRes.status}`);
        console.log('[agent-loader] migrated home → birthplace in', wikiPath);
      } catch (e) {
        console.warn('[agent-loader] migration PUT failed; keeping in-memory rewrite:', e);
      }
      return agent;
    }

    // hasBirthplace-only or neither — parseAgentDoc already filled in
    // MINIMAL_DEFAULT.instance (which has `birthplace`) when `instance` was
    // missing from the doc, so the agent object is already well-formed.
    return agent;
  } catch (e) {
    console.warn('[agent-loader] fetch failed, falling back:', e);
    return { ...MINIMAL_DEFAULT };
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run:

```bash
node --test tests/renderer/agent-loader.test.mjs
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/agent-loader.js tests/renderer/agent-loader.test.mjs
git commit -m "feat(sigil): migration path home → birthplace in loadAgent

Adds one-time rewrite-on-load: docs with only 'home' get PUT back with
'birthplace' (string-level replace in the JSON block); docs with both
log an advisory and do not rewrite. PUT failures keep the in-memory
rewrite and log a warning — next load retries.

Tests cover: birthplace-only (no PUT), home-only (PUT + upgrade),
both (advisory + no PUT), fetch failure (fallback)."
```

---

## Task 5: Daemon — lastPosition map + IPC verbs

**Files:**
- Modify: `src/daemon/unified.swift` (add instance state + 2 dispatch cases; ~40 lines net)

The daemon gets a simple in-memory `[String: (Double, Double)]` map and two new `canvas_message` dispatch cases. Response pattern mirrors `canvas.create` (send a `canvas.response` with matching `request_id`).

- [ ] **Step 1: Add the map as daemon-instance state**

In `src/daemon/unified.swift`, find the section where daemon instance state is declared (near other `private var` declarations around line 53 where `displayGeometryBroadcastScheduled` lives). Add:

```swift
    // Per-agent last-known position, keyed by agent id (e.g. "default" from
    // `sigil/agents/default.md`). In-memory only — wiped on daemon restart.
    // Written by the renderer on every transition to IDLE; read by the
    // renderer on boot to resume the avatar where the user last left it.
    // Spec: docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md
    private var lastPositions: [String: (x: Double, y: Double)] = [:]
    private let lastPositionsLock = NSLock()
```

- [ ] **Step 2: Extend the canvas-message dispatch with two new cases**

In `src/daemon/unified.swift`, find the switch statement inside `canvasManager.onEvent` around line 124–140. The current dispatch is:

```swift
                switch type {
                case "subscribe", "unsubscribe":
                    let events = (inner?["events"] as? [String]) ?? []
                    self.handleCanvasSubscription(canvasID: canvasID, type: type, events: events)
                    return
                case "canvas.create":
                    self.handleCanvasCreate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.update":
                    self.handleCanvasUpdate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.remove":
                    self.handleCanvasRemove(callerID: canvasID, payload: inner ?? [:])
                    return
                default:
                    break
                }
```

Add two cases before `default`:

```swift
                case "agent.lastPosition.get":
                    self.handleAgentLastPositionGet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "agent.lastPosition.set":
                    self.handleAgentLastPositionSet(callerID: canvasID, payload: inner ?? [:])
                    return
```

- [ ] **Step 3: Implement the two handlers**

In the same file, alongside `handleCanvasCreate` and `handleCanvasUpdate` (near line 440), add:

```swift
    /// Request/response: return the stored lastPosition for `agent_id` or
    /// null if none. Required payload field: agent_id (String). Optional:
    /// request_id (String) for correlation.
    private func handleAgentLastPositionGet(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let agentID = payload["agent_id"] as? String, !agentID.isEmpty else {
            if let rid = requestID {
                self.sendCanvasResponse(canvasID: callerID, requestID: rid,
                    status: "error", code: "MISSING_AGENT_ID",
                    message: "agent.lastPosition.get requires agent_id")
            }
            return
        }
        lastPositionsLock.lock()
        let pos = lastPositions[agentID]
        lastPositionsLock.unlock()

        var extra: [String: Any] = ["agent_id": agentID]
        if let p = pos {
            extra["position"] = ["x": p.x, "y": p.y]
        } else {
            extra["position"] = NSNull()
        }
        if let rid = requestID {
            self.sendCanvasResponse(canvasID: callerID, requestID: rid,
                status: "ok", code: nil, message: nil, extra: extra)
        }
    }

    /// Fire-and-forget: record the current position for `agent_id`. Required
    /// payload fields: agent_id (String), x (Double), y (Double). No response
    /// emitted; caller is expected to treat this as eventually-consistent.
    private func handleAgentLastPositionSet(callerID: String, payload: [String: Any]) {
        guard let agentID = payload["agent_id"] as? String, !agentID.isEmpty,
              let x = (payload["x"] as? NSNumber)?.doubleValue,
              let y = (payload["y"] as? NSNumber)?.doubleValue else {
            fputs("[last-position] malformed set from canvas=\(callerID); ignoring\n", stderr)
            return
        }
        lastPositionsLock.lock()
        lastPositions[agentID] = (x: x, y: y)
        lastPositionsLock.unlock()
    }
```

- [ ] **Step 4: Extend `sendCanvasResponse` to accept arbitrary extra fields**

The existing `sendCanvasResponse` at line 414 likely does not accept an `extra` dictionary. Find it and update its signature + body. The expected existing shape is:

```swift
    private func sendCanvasResponse(canvasID: String, requestID: String,
                                     status: String, code: String?, message: String?) {
        var payload: [String: Any] = [
            "type": "canvas.response",
            "request_id": requestID,
            "status": status,
        ]
        if let code = code { payload["code"] = code }
        if let message = message { payload["message"] = message }
        // ... send logic ...
    }
```

Change the signature + body to:

```swift
    private func sendCanvasResponse(canvasID: String, requestID: String,
                                     status: String, code: String?, message: String?,
                                     extra: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "type": "canvas.response",
            "request_id": requestID,
            "status": status,
        ]
        if let code = code { payload["code"] = code }
        if let message = message { payload["message"] = message }
        for (k, v) in extra { payload[k] = v }
        // ... existing send logic unchanged ...
    }
```

All existing callers continue to work (extra defaults to empty).

- [ ] **Step 5: Build the daemon**

```bash
cd /Users/Michael/Code/agent-os
bash build.sh
```

Expected: clean build, no errors. (The only expected warnings are pre-existing NSSpeechSynthesizer deprecation notes.)

- [ ] **Step 6: Restart the daemon + smoke-test the IPC verbs**

```bash
./aos service restart
sleep 2
./aos doctor --json | python3 -c "import json,sys; d=json.load(sys.stdin); print('daemon pid:', d.get('runtime',{}).get('daemon_pid'))"
```

Then verify via a scratch interactive canvas:

```bash
./aos show create --id lp-smoke \
  --url 'data:text/html,<!doctype html><script>
    function call(type, payload) {
      window.webkit.messageHandlers.headsup.postMessage(JSON.stringify({type, payload}));
    }
    window.__out = [];
    window.addEventListener("message", e => window.__out.push(e.data));
    // Register a receive handler for canvas.response from the daemon
    window.headsup = { receive: (b64) => window.__out.push(JSON.parse(atob(b64))) };
    // SET
    call("agent.lastPosition.set", { agent_id: "smoke", x: 111, y: 222 });
    // GET (with request_id)
    setTimeout(() => call("agent.lastPosition.get", { agent_id: "smoke", request_id: "r1" }), 50);
  </script>' \
  --interactive --at 0,0,200,200
sleep 1
./aos show eval --id lp-smoke --js 'JSON.stringify(window.__out)'
./aos show remove --id lp-smoke
```

Expected output contains an entry like:

```
{"type":"canvas.response","request_id":"r1","status":"ok","agent_id":"smoke","position":{"x":111,"y":222}}
```

If the response is missing, inspect the daemon log:

```bash
tail -50 ~/.config/aos/repo/daemon.log
```

Look for `[last-position]` or crash markers.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): agent.lastPosition.{get,set} IPC verbs + in-memory map

Adds a daemon-scope [String: (x, y)] dictionary keyed by agent_id, plus
two canvas-message dispatch cases:
  - agent.lastPosition.get (request/response; returns position or null)
  - agent.lastPosition.set (fire-and-forget write)

Map is in-memory only, wiped on daemon restart. NSLock-guarded for
thread safety. Extends sendCanvasResponse with an optional 'extra' dict
so the get-response can piggyback the position payload.

Spec §runtime-flow."
```

---

## Task 6: Renderer boot — resolvePosition() with lastPosition → birthplace fallback

**Files:**
- Modify: `apps/sigil/renderer/index.html` (boot module: add `resolvePosition`, wire into `boot()`)

- [ ] **Step 1: Add `resolvePosition` helper in the boot module**

In `apps/sigil/renderer/index.html`, inside the `<script type="module">` block near where `sigilReloadCurrentAgent` lives (around line 3449), add:

```javascript
// Request/response over the canvas IPC bridge to ask the daemon for the
// agent's lastPosition. Resolves with {x, y} if present, null if not, and
// null on timeout or malformed response. 250ms timeout is generous — the
// daemon's dispatch is synchronous on the main thread.
async function getLastPositionFromDaemon(agentId) {
    const requestId = 'lp-get-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Best-effort cleanup of the one-shot response handler
            const idx = window.liveJs._lpWaiters?.indexOf?.(handler);
            if (idx > -1) window.liveJs._lpWaiters.splice(idx, 1);
            resolve(value);
        };
        const handler = (msg) => {
            if (msg?.type !== 'canvas.response') return false;
            if (msg.request_id !== requestId) return false;
            if (msg.status !== 'ok') { done(null); return true; }
            const p = msg.position;
            if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') { done(null); return true; }
            done({ x: p.x, y: p.y });
            return true;
        };
        window.liveJs._lpWaiters = window.liveJs._lpWaiters || [];
        window.liveJs._lpWaiters.push(handler);
        const timer = setTimeout(() => done(null), 250);
        postToHost('agent.lastPosition.get', { agent_id: agentId, request_id: requestId });
    });
}

// Resolve the avatar's initial position. Tries the daemon's lastPosition
// map first (populated during this daemon's lifetime by IDLE transitions);
// falls back to resolveBirthplace(agent.instance.birthplace, displays) for
// first-spawn-ever and post-daemon-restart cases.
async function resolvePosition(agent, displays) {
    try {
        const lp = await getLastPositionFromDaemon(agent.id);
        if (lp) return lp;
    } catch (e) {
        console.warn('[sigil] lastPosition lookup failed; falling back to birthplace:', e);
    }
    return resolveBirthplace(agent.instance.birthplace, displays);
}
```

- [ ] **Step 2: Wire the new handler into `handleLiveJsMessage`**

The daemon emits `canvas.response` messages that must be intercepted before the default `canvas_message` path. Find `handleLiveJsMessage` in the classic inline script (around line 2880 where `case 'canvas.response':` already exists for the `create-hit` flow). Extend it to also call any registered lastPosition waiters. Find:

```javascript
        case 'canvas.response':
            if (msg.request_id === 'create-hit') {
                if (msg.status === 'ok') {
                    liveJs.hitReady = true;
                    console.log('[sigil-1] avatar-hit ready');
                } else {
                    console.error('[sigil-1] avatar-hit create failed:', msg.code, msg.message);
                }
            }
            break;
```

Replace with:

```javascript
        case 'canvas.response':
            // Existing avatar-hit flow
            if (msg.request_id === 'create-hit') {
                if (msg.status === 'ok') {
                    liveJs.hitReady = true;
                    console.log('[sigil-1] avatar-hit ready');
                } else {
                    console.error('[sigil-1] avatar-hit create failed:', msg.code, msg.message);
                }
                break;
            }
            // Generic waiter dispatch (currently used by the boot module's
            // lastPosition lookup). Each waiter returns true if it consumed
            // the message; consumed waiters are auto-removed inside the
            // resolver. Iterate over a snapshot to avoid mutation-during-
            // iteration if a waiter's done() callback splices the list.
            if (Array.isArray(liveJs._lpWaiters)) {
                for (const handler of liveJs._lpWaiters.slice()) {
                    try { handler(msg); } catch (e) { console.error('[sigil] waiter threw:', e); }
                }
            }
            break;
```

- [ ] **Step 3: Replace the boot call site to use `resolvePosition`**

Locate the boot block at line 3422 (currently reading `const home = resolveBirthplace(agent.instance.birthplace, displays);` after Task 1):

```javascript
        const home = resolveBirthplace(agent.instance.birthplace, displays);
```

Replace the entire block from `try { const displays = await awaitFirstDisplayGeometry();` through the `liveJs.currentAgentId = currentAgentId;` assignment with:

```javascript
    try {
        const displays = await awaitFirstDisplayGeometry();
        // Set currentAgentId early so that in-flight IDLE transitions
        // during boot (uncommon but possible) have a valid id to post under.
        const liveJs = window.liveJs;
        liveJs.currentAgentId = currentAgentId;
        const pos = await resolvePosition({ ...agent, id: currentAgentId }, displays);
        liveJs.avatarPos = { x: pos.x, y: pos.y, valid: true };
        liveJs.avatarSize = agent.instance.size;
        // Task 8 (foundation): snapshot union-of-displays for topology change detection
        if (typeof window.computeUnion === 'function') {
            liveJs.globalBoundsAtBoot = window.computeUnion(displays);
            liveJs.globalBounds = liveJs.globalBoundsAtBoot;
        }
        console.log('[sigil] position resolved:',
            'pos=(' + pos.x.toFixed(1) + ',' + pos.y.toFixed(1) + ')',
            'size=' + agent.instance.size,
            'agent=' + currentAgentId);
    } catch (e) {
        console.error('[sigil] position resolution failed:', e);
    }
```

Note: `agent.id` may not be set in the parsed agent object; the boot already derives `currentAgentId` from the URL param. We pass `{ ...agent, id: currentAgentId }` to `resolvePosition` so it can use the id consistently.

- [ ] **Step 4: Smoke-test the boot path end-to-end**

```bash
./aos show remove --id avatar-main 2>/dev/null || true
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2
./aos show eval --id avatar-main --js 'JSON.stringify({pos: liveJs.avatarPos, agent: liveJs.currentAgentId})'
```

Expected: `pos.valid === true`, `pos.x`/`pos.y` are finite numbers, `agent === "default"`.

Since the daemon's `lastPositions` map starts empty, `getLastPositionFromDaemon` returns null and `resolveBirthplace` runs — the avatar lands at the default birthplace (bottom-right nonant of the main display). Position should match the old `resolveHome`-driven behavior exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/index.html
git commit -m "feat(sigil): resolvePosition — lastPosition → birthplace fallback

Adds a request/response path over the canvas IPC bridge to query the
daemon's lastPosition map on boot, with a 250ms timeout and graceful
fallback to resolveBirthplace(). Sets currentAgentId before the query
so in-flight IDLE transitions (uncommon during boot) have a valid key.

Canvas.response handler extended to dispatch to a generic _lpWaiters
list, keeping the existing avatar-hit flow intact. Waiters self-clean
on resolve/timeout.

Spec §runtime-flow (boot sequence)."
```

---

## Task 7: Renderer IDLE hook — post lastPosition on transition to IDLE

**Files:**
- Modify: `apps/sigil/renderer/index.html` (classic-script `smSet()` near line 2956)

- [ ] **Step 1: Extend `smSet` to post lastPosition on IDLE entry**

Find `smSet` at line 2956:

```javascript
function smSet(next, reason) {
    if (liveJs.state === next) return;
    console.log('[sigil-1] state:', liveJs.state, '→', next, reason ? '(' + reason + ')' : '');
    liveJs.state = next;
    // Task 9: on every transition INTO IDLE, try to flush any pending
    // wiki_page_changed reload. If fast-travel was kicked off on this
    // same mouseup (drag-release→fast-travel, goto-release→fast-travel)
    // the state is IDLE but liveJs.travel is truthy — flushReload's
    // internal gate defers until the travel animation completes
    // (tickFastTravel retries the flush on completion).
    if (next === 'IDLE') flushReload();
}
```

Replace with:

```javascript
function smSet(next, reason) {
    if (liveJs.state === next) return;
    console.log('[sigil-1] state:', liveJs.state, '→', next, reason ? '(' + reason + ')' : '');
    liveJs.state = next;
    // Task 9: on every transition INTO IDLE, try to flush any pending
    // wiki_page_changed reload. If fast-travel was kicked off on this
    // same mouseup (drag-release→fast-travel, goto-release→fast-travel)
    // the state is IDLE but liveJs.travel is truthy — flushReload's
    // internal gate defers until the travel animation completes
    // (tickFastTravel retries the flush on completion).
    if (next === 'IDLE') {
        flushReload();
        postLastPositionToDaemon();
    }
}

// Fire-and-forget: tell the daemon where the avatar currently sits so
// subsequent spawns of this agent (within the daemon's lifetime) resume
// here instead of falling back to birthplace. Skipped if currentAgentId
// hasn't been set yet (boot race) or if avatarPos isn't valid (during
// fast-travel transit the position may be in a stale frame).
function postLastPositionToDaemon() {
    const agentId = liveJs.currentAgentId;
    if (!agentId) return;
    const p = liveJs.avatarPos;
    if (!p || !p.valid || typeof p.x !== 'number' || typeof p.y !== 'number') return;
    postToHost('agent.lastPosition.set', { agent_id: agentId, x: p.x, y: p.y });
}
```

- [ ] **Step 2: Smoke-test the IDLE-post path**

With avatar-main already running (from Task 6):

```bash
# Move the avatar programmatically via a small perturbation
./aos show eval --id avatar-main --js 'liveJs.avatarPos.x += 77; liveJs.avatarPos.y += 55; smSet("IDLE", "test-post"); true'
sleep 0.3

# Query the daemon lastPosition map via a throwaway canvas
./aos show create --id lp-peek --url 'data:text/html,<!doctype html><script>
  window.headsup = { receive: (b64) => { window.__r = JSON.parse(atob(b64)); } };
  window.webkit.messageHandlers.headsup.postMessage(JSON.stringify({
    type: "agent.lastPosition.get",
    payload: { agent_id: "default", request_id: "peek-1" }
  }));
</script>' --interactive --at 0,0,1,1
sleep 0.3
./aos show eval --id lp-peek --js 'JSON.stringify(window.__r)'
./aos show remove --id lp-peek
```

Expected: the peek canvas logs a `canvas.response` whose `position.x` and `position.y` match the avatar's current `liveJs.avatarPos` (after the +77 / +55 perturbation).

- [ ] **Step 3: Smoke-test the full respawn cycle**

```bash
# Set a distinctive position
./aos show eval --id avatar-main --js 'liveJs.avatarPos.x = 300; liveJs.avatarPos.y = 400; smSet("IDLE", "test-final"); true'
sleep 0.3

# Kill + relaunch avatar-main
./aos show remove --id avatar-main
sleep 0.5
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2

# Avatar should respawn at the position we set, not at birthplace (bottom-right nonant)
./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
```

Expected: `{"x":300,"y":400,"valid":true}` or near it (allowing for clamp to union).

- [ ] **Step 4: Smoke-test the daemon-restart reset**

```bash
./aos service restart
sleep 2
./aos show remove --id avatar-main 2>/dev/null || true
sleep 0.5
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2

# Daemon restart wiped lastPositions; avatar should be at birthplace (bottom-right)
./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
```

Expected: position is at the main display's bottom-right nonant (x ≈ mainW × 5/6, y ≈ mainH × 5/6), NOT at (300, 400).

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/index.html
git commit -m "feat(sigil): post lastPosition to daemon on IDLE transition

smSet() now fires agent.lastPosition.set whenever the state machine
enters IDLE. Skipped if currentAgentId or avatarPos isn't ready, so
boot races and invalid in-transit frames don't poison the map.

Closes the loop: IDLE write + boot read means a closed avatar resumes
where the user last dropped it, for the daemon's lifetime.

Spec §runtime-flow (IDLE update path)."
```

---

## Task 8: Integration acceptance sweep

**Files:**
- Create: `apps/sigil/tests/birthplace-acceptance.md` (evidence doc)

Runs the five integration scenarios from the spec and records evidence. No code change.

- [ ] **Step 1: Create the evidence doc scaffold**

Create `apps/sigil/tests/birthplace-acceptance.md`:

```markdown
# birthplace + lastPosition — acceptance evidence

**Spec:** `docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md`
**Date:** YYYY-MM-DD (fill in at run time)
**Runtime:** `aos runtime status --json` (paste output below)

```
(output)
```

---

## Scenario 1 — Fresh boot lands at birthplace

**Precondition:** daemon restarted (lastPositions map is empty).

**Steps + output:**

```
(commands + output)
```

**Result:** PASS / FAIL

---

## Scenario 2 — Move to IDLE, close + relaunch, lands at last IDLE position

**Steps + output:**

```
(commands + output)
```

**Result:** PASS / FAIL

---

## Scenario 3 — Restart daemon, next spawn at birthplace (not old lastPosition)

**Steps + output:**

```
(commands + output)
```

**Result:** PASS / FAIL

---

## Scenario 4 — Legacy doc (home-only) migrates on first load

**Precondition:** stage a test doc at `~/.config/aos/repo/wiki/sigil/agents/legacy.md` with only `home`, no `birthplace`.

**Steps + output:**

```
(commands + output showing: file before with 'home', avatar spawns correctly, file after with 'birthplace' and no 'home')
```

**Result:** PASS / FAIL

---

## Scenario 5 — Malformed birthplace descriptor → MINIMAL_DEFAULT birthplace

**Steps + output:**

```
(commands + output)
```

**Result:** PASS / FAIL
```

- [ ] **Step 2: Run Scenario 1 (fresh boot → birthplace)**

```bash
./aos service restart && sleep 2
./aos show remove --id avatar-main 2>/dev/null || true
sleep 0.5
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2
./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
```

Compute expected position manually: query displays, compute main display's visible_bounds × (5/6, 5/6). Record actual vs expected in the evidence doc. If they match within 1px, PASS.

- [ ] **Step 3: Run Scenario 2 (IDLE persistence within daemon lifetime)**

```bash
# Move + IDLE
./aos show eval --id avatar-main --js 'liveJs.avatarPos.x = 500; liveJs.avatarPos.y = 500; smSet("IDLE", "s2"); true'
sleep 0.3
./aos show remove --id avatar-main
sleep 0.5
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2
./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
```

Record. Expected: `{"x":500,"y":500,...}` (may clamp if 500,500 is outside the union on a small display — verify against union bounds).

- [ ] **Step 4: Run Scenario 3 (daemon restart clears map)**

```bash
# From Scenario 2's parked state
./aos service restart && sleep 2
./aos show remove --id avatar-main 2>/dev/null || true
sleep 0.5
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at $(./aos runtime display-union)
sleep 2
./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
```

Record. Expected: position matches Scenario 1 (birthplace), NOT Scenario 2's (500, 500).

- [ ] **Step 5: Run Scenario 4 (legacy doc migration)**

```bash
# Stage a legacy doc
WIKI_DIR=~/.config/aos/repo/wiki/sigil/agents
cat > $WIKI_DIR/legacy.md <<'EOF'
---
type: agent
id: legacy
name: Legacy
---

Legacy agent for migration test.

```json
{
  "version": 1,
  "appearance": { "shape": 6, "opacity": 0.25, "edgeOpacity": 1.0, "maskEnabled": true, "interiorEdges": true, "specular": true, "aura": { "enabled": true, "reach": 1.0, "intensity": 1.0, "pulseRate": 0.005 }, "colors": { "face": ["#bc13fe","#4a2b6e"], "edge": ["#bc13fe","#4a2b6e"], "aura": ["#bc13fe","#2a1b3d"] } },
  "minds": { "skills": [], "tools": [], "workflows": [] },
  "instance": {
    "home": { "anchor": "nonant", "nonant": "top-left", "display": "main" },
    "size": 200
  }
}
```
EOF

# Confirm before state
grep -c '"home"' $WIKI_DIR/legacy.md      # expect 1
grep -c '"birthplace"' $WIKI_DIR/legacy.md # expect 0

# Spawn a canvas pointing at the legacy agent
./aos show create --id avatar-legacy --url 'aos://sigil/renderer/index.html?agent=sigil/agents/legacy' --at $(./aos runtime display-union)
sleep 2

# Confirm avatar spawned at top-left (migrated home → birthplace worked at read time)
./aos show eval --id avatar-legacy --js 'JSON.stringify(liveJs.avatarPos)'

# Confirm after state (file on disk now uses birthplace, not home)
grep -c '"home"' $WIKI_DIR/legacy.md      # expect 0
grep -c '"birthplace"' $WIKI_DIR/legacy.md # expect 1

# Cleanup
./aos show remove --id avatar-legacy
rm $WIKI_DIR/legacy.md
```

Record all command outputs. PASS if before has home/0 and after has 0/birthplace and avatar spawned at top-left.

- [ ] **Step 6: Run Scenario 5 (malformed birthplace → fallback)**

```bash
# Stage a doc with malformed birthplace
WIKI_DIR=~/.config/aos/repo/wiki/sigil/agents
cat > $WIKI_DIR/malformed.md <<'EOF'
---
type: agent
id: malformed
name: Malformed
---

```json
{
  "version": 1,
  "appearance": { "shape": 6, "opacity": 0.25, "edgeOpacity": 1.0, "maskEnabled": true, "interiorEdges": true, "specular": true, "aura": { "enabled": true, "reach": 1.0, "intensity": 1.0, "pulseRate": 0.005 }, "colors": { "face": ["#bc13fe","#4a2b6e"], "edge": ["#bc13fe","#4a2b6e"], "aura": ["#bc13fe","#2a1b3d"] } },
  "minds": { "skills": [], "tools": [], "workflows": [] },
  "instance": {
    "birthplace": { "anchor": "nonant", "nonant": "this-cell-does-not-exist", "display": "also-fake-uuid" },
    "size": 150
  }
}
```
EOF

./aos show create --id avatar-malformed --url 'aos://sigil/renderer/index.html?agent=sigil/agents/malformed' --at $(./aos runtime display-union)
sleep 2
./aos show eval --id avatar-malformed --js 'JSON.stringify(liveJs.avatarPos)'
./aos show remove --id avatar-malformed
rm $WIKI_DIR/malformed.md
```

Expected: avatar spawns at bottom-right of main display (the `resolveBirthplace` fallback path handles both "unknown display UUID → main" and "unknown nonant cell → bottom-right"). PASS if position matches Scenario 1.

- [ ] **Step 7: Fill in the evidence doc**

Paste all command outputs, mark each scenario PASS/FAIL, and commit.

- [ ] **Step 8: Commit**

```bash
git add apps/sigil/tests/birthplace-acceptance.md
git commit -m "docs(sigil): birthplace + lastPosition acceptance evidence

All 5 scenarios from the spec's testing section recorded with actual
command output. Fresh-boot → birthplace, IDLE persistence, daemon-restart
reset, legacy-doc migration (home → birthplace rewrite on first load),
malformed-descriptor fallback.

Spec §testing."
```

---

## Self-Review Checklist (for the author, before handing off)

- [ ] **Spec coverage.** Walk the spec sections one at a time. Every requirement has a task: rename (Task 1), unit tests (Tasks 2, 4), MINIMAL_DEFAULT + seed (Task 3), migration logic (Task 4), daemon IPC (Task 5), boot flow (Task 6), IDLE hook (Task 7), integration (Task 8). No gaps.
- [ ] **Placeholder scan.** No "TBD", "fill in", "similar to", etc. Every code step shows the code.
- [ ] **Type consistency.** `resolveBirthplace` used everywhere it's referenced. `agent.lastPosition.get` / `.set` strings match across renderer, daemon, and tests. `lastPositions` key is agent_id string in both layers.
- [ ] **Commit cadence.** 8 commits, each bisectable. Rename is its own commit; migration, daemon, boot, and IDLE hook each land independently.
- [ ] **Out-of-scope discipline.** Touch only the files listed in the file map. No drive-by cleanups.
