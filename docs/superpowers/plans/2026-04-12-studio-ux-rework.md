# Studio UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Celestial-era 3D-preview Avatar Studio with a stageless, identity-first inspector that manages a roster of agent wiki docs, provides a seeded reroll flyout, and relies on the live desktop avatar as its preview.

**Architecture:** Studio becomes a pure control surface. The live renderer (untouched) remains the source of truth for preview. Agents are wiki docs under `sigil/agents/`; the roster is a directory listing. Reroll is seeded via `mulberry32` + an in-repo wordlist. Undo is a session-scoped in-memory ring buffer. One small Swift addition surfaces a wiki directory listing endpoint (justified deviation from spec's "no Swift changes"; alternative is a stale sidecar index file — worse).

**Tech Stack:** Vanilla ES modules, HTML, CSS. `mulberry32` PRNG (existing). Node 22 `node --test` for pure-module unit tests. Browser-based smoke tests via `curl` + Studio loaded from `aos://sigil/studio/index.html`. Minimal Swift add in `src/content/server.swift` with an inline unit test path.

**Spec:** `docs/superpowers/specs/2026-04-12-studio-ux-rework-design.md` (commit `1f83ae0`).

---

## Spec Deviation: Wiki Directory Listing Endpoint

The spec asserts "roster is discovered by listing the wiki namespace; no separate index file" AND "No Swift changes." These are mutually incompatible — the content server today (`src/content/server.swift:262-302`) only GETs individual files, not directories. The options were:

1. **Add directory-listing to content server** (this plan) — ~30 lines of Swift, one endpoint, semantics match the wiki PUT/GET symmetry: `GET /wiki/<dir>/` returns a JSON listing of child files (names only). Cheap, general, usable by any future wiki surface.
2. Maintain a `sigil/agents/_index.md` sidecar — violates the spec's explicit "no separate index file" and creates a classic stale-index bug surface (fork must update the index atomically with the doc PUT).
3. Hardcode a fixed roster list — obviously wrong.

**Decision:** Option 1. Flagged to Michael at plan-review time; proceed unless he redirects.

---

## File Structure

### Modified

| File | Changes | Responsibility after rework |
|------|---------|----------------------------|
| `src/content/server.swift` | +~30 lines: trailing-slash directory listing endpoint | Unchanged except for new listing path |
| `apps/sigil/studio/index.html` | Rewritten shell (titlebar + header + rail + panels); panel contents for Shape/Color/FX preserved verbatim | App shell |
| `apps/sigil/studio/js/ui.js` | Remove 3D-coupling, add chip/roster/reroll wiring; factor scope-partitioned randomize | Panel interaction + agent lifecycle |
| `apps/sigil/studio/js/main.js` | Strip scene/three.js init; becomes a thin bootstrap importing only `ui.js` | Bootstrap |
| `apps/sigil/studio/css/base.css` | Replace split-view/canvas rules with app-shell layout | Shell layout |
| `apps/sigil/studio/css/sidebar.css` | Remove sidebar-title-wrapper/hamburger; keep nav rail styles; adjust to new shell | Nav rail + panels |
| `apps/sigil/studio/css/controls.css` | Unchanged | Slider/control styles |
| `apps/sigil/studio/css/context-menu.css` | Delete ctx-object/ctx-particle rules (canvas-only); keep overflow/menu rules if any | Cleanup |

### New

| File | Responsibility |
|------|---------------|
| `apps/sigil/studio/js/seed-words.js` | Two arrays (~128 adjectives + ~128 nouns) + `seedToWords(n)`/`wordsToSeed(s)` |
| `apps/sigil/studio/js/seed-history.js` | Bounded in-memory ring (recent-rolls); pure |
| `apps/sigil/studio/js/undo-buffer.js` | Session-scoped per-agent snapshot ring (20 entries); pure |
| `apps/sigil/studio/js/agent-api.js` | HTTP client: `listAgents()`, `loadAgentDoc(id)`, `putAgentDoc(id, markdown)`, `deleteAgent(id)` |
| `apps/sigil/studio/js/chip.js` | Agent chip component (render + sync-status + menu) |
| `apps/sigil/studio/js/roster.js` | Roster panel rendering, mini-orb CSS-gradient helper, tile overflow menu |
| `apps/sigil/studio/js/reroll.js` | Reroll flyout shell (scope chips, recent strip, seed pill) + orchestration |
| `apps/sigil/studio/js/randomize.js` | Extracted `randomizeAll(seed, scope)` with scope partitioning |
| `apps/sigil/studio/css/shell.css` | Titlebar, header, chip, reroll button, flyout, roster grid, agent tiles |
| `apps/sigil/renderer/agent-fork.js` | `forkAgent(sourceDoc, newId, newName)` → new doc string |
| `apps/sigil/studio/js/live-preview.js` | `pushLivePreview(appearance)` — wiki-bypassing live-state push |
| `tests/studio/seed-words.test.mjs` | `node --test` unit tests |
| `tests/studio/seed-history.test.mjs` | `node --test` unit tests |
| `tests/studio/undo-buffer.test.mjs` | `node --test` unit tests |
| `tests/studio/agent-fork.test.mjs` | `node --test` unit tests |
| `tests/content/wiki-list.test.sh` | Curl-based integration test for listing endpoint |

### Deleted

| File | Rationale |
|------|-----------|
| `apps/sigil/studio/js/scene.js` | 3D scene init, only used by the removed in-app preview |
| `apps/sigil/studio/js/skybox.js` | 3D skybox, Studio-preview-only |
| `apps/sigil/studio/js/interaction.js` | Camera orbit + context menus on the removed 3D canvas |
| `apps/sigil/studio/js/pathing.js` | Preview-only; live pathing is daemon-driven |
| `apps/sigil/studio/js/grid3d.js` | Studio-preview only |
| `apps/sigil/studio/js/swarm.js` | Studio-preview only |
| `apps/sigil/avatar.html` | Legacy, superseded by `renderer/index.html` |

---

## Conventions

- **Every non-trivial JS module has unit tests.** Pure modules use `node --test`; DOM-coupled modules get their own HTML harness page or are smoke-tested in the real Studio canvas.
- **Commit after every task** with a conventional-commits message prefixed `feat(studio):`, `refactor(studio):`, `test(studio):`, `chore(studio):`, or `feat(content):` for the Swift endpoint.
- **Never break the live renderer.** Before removing any Studio file, confirm it is not imported by `apps/sigil/renderer/*`.
- **Visual panel contents for Shape/Color/FX are preserved verbatim** from the current `index.html` — we are rebuilding the *shell* around them, not the controls.

---

## Task 1: Wiki directory listing endpoint (Swift)

**Files:**
- Modify: `src/content/server.swift:246-302`
- Test: `tests/content/wiki-list.test.sh` (new)

Adds `GET /wiki/<dir>/` (trailing slash required) → JSON `{"path": "<dir>", "entries": [{"name": "...", "kind": "file|dir"}]}`. No POST/PUT/DELETE on directories. Path traversal check mirrors the existing file path check.

- [ ] **Step 1: Write the failing integration test**

Create `tests/content/wiki-list.test.sh`:

```bash
#!/usr/bin/env bash
# Integration test: wiki directory listing endpoint.
# Assumes `./aos serve` is running in repo mode and exposes /wiki at the
# content port published in `~/.config/aos/repo/content.port`.
set -euo pipefail

PORT=$(cat "$HOME/.config/aos/repo/content.port" 2>/dev/null || echo "")
if [[ -z "$PORT" ]]; then
  echo "SKIP: aos daemon not running (no content.port)"; exit 0
fi

# Seed two agent docs via PUT
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: alpha\nname: Alpha\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: beta\nname: Beta\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null

# List the directory
BODY=$(curl -sf "http://127.0.0.1:$PORT/wiki/sigil/agents/")
echo "$BODY" | grep -q '"name":"alpha.md"' || { echo "FAIL: alpha.md not listed"; echo "$BODY"; exit 1; }
echo "$BODY" | grep -q '"name":"beta.md"' || { echo "FAIL: beta.md not listed"; echo "$BODY"; exit 1; }

# Path traversal must be rejected
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/../etc/passwd/")
[[ "$STATUS" == "400" || "$STATUS" == "403" ]] || { echo "FAIL: traversal returned $STATUS"; exit 1; }

# Cleanup
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null

echo "OK: wiki directory listing works"
```

Make executable: `chmod +x tests/content/wiki-list.test.sh`.

- [ ] **Step 2: Run it and verify it fails**

Run: `bash tests/content/wiki-list.test.sh`
Expected: `FAIL` with HTTP 404 on the listing call (endpoint does not exist yet).

- [ ] **Step 3: Implement the listing endpoint**

In `src/content/server.swift`, inside the `if prefix == "wiki"` block, before the `switch method` (around current line 262), insert a trailing-slash detection branch. The incoming `relativePath` has already stripped leading `/`. Check `decoded` (the original URL path) for a trailing slash:

```swift
// Directory listing: /wiki/<dir>/ → JSON listing of entries.
// Only GET/HEAD supported; no write semantics on directories.
if decoded.hasSuffix("/") {
    guard method == "GET" || method == "HEAD" else {
        return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method not allowed on directory")
    }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: resolvedPath, isDirectory: &isDir), isDir.boolValue else {
        return httpResponse(status: 404, statusText: "Not Found", body: "Directory not found")
    }
    let children = (try? FileManager.default.contentsOfDirectory(atPath: resolvedPath)) ?? []
    struct Entry: Codable { let name: String; let kind: String }
    let entries: [Entry] = children.sorted().compactMap { name in
        if name.hasPrefix(".") { return nil }
        let childPath = (resolvedPath as NSString).appendingPathComponent(name)
        var childIsDir: ObjCBool = false
        FileManager.default.fileExists(atPath: childPath, isDirectory: &childIsDir)
        return Entry(name: name, kind: childIsDir.boolValue ? "dir" : "file")
    }
    struct Listing: Codable { let path: String; let entries: [Entry] }
    let payload = Listing(path: relativePath, entries: entries)
    let data = (try? JSONEncoder().encode(payload)) ?? Data("{\"path\":\"\(relativePath)\",\"entries\":[]}".utf8)
    return httpResponse(status: 200, statusText: "OK", contentType: "application/json", body: method == "HEAD" ? nil : data)
}
```

Rebuild: `bash build.sh`

- [ ] **Step 4: Restart the daemon and re-run the test**

Run: `./aos service restart --mode repo && sleep 1 && bash tests/content/wiki-list.test.sh`
Expected: `OK: wiki directory listing works`

- [ ] **Step 5: Commit**

```bash
git add src/content/server.swift tests/content/wiki-list.test.sh
git commit -m "feat(content): wiki directory listing endpoint (GET /wiki/<dir>/)"
```

---

## Task 2: Seed wordlist + seed ↔ words helpers

**Files:**
- Create: `apps/sigil/studio/js/seed-words.js`
- Test: `tests/studio/seed-words.test.mjs`

Ships ~128 adjectives + ~128 nouns (16 384 combinations). Converts a numeric seed (0–999 999) to `<adjective>-<noun>-<NN>` and parses either form back to a numeric seed. Deterministic, no I/O.

Encoding: `adjIndex = (seed >>> 0) % ADJECTIVES.length`; `nounIndex = Math.floor(seed / ADJECTIVES.length) % NOUNS.length`; `tail = seed % 100`. Parsing reverses the mapping; unknown words fall back to hashing the whole string (stable via `mulberry32(strHash)` into the 0–999 999 range).

- [ ] **Step 1: Write the failing tests**

Create `tests/studio/seed-words.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedToWords, wordsToSeed, ADJECTIVES, NOUNS } from '../../apps/sigil/studio/js/seed-words.js';

test('roundtrip: same seed → same words → same seed', () => {
  for (const seed of [0, 1, 42, 1000, 999999]) {
    const words = seedToWords(seed);
    assert.match(words, /^[a-z]+-[a-z]+-\d{2}$/);
    assert.equal(wordsToSeed(words), seed);
  }
});

test('wordlists are sized and unique', () => {
  assert.ok(ADJECTIVES.length >= 128, `adjectives: ${ADJECTIVES.length}`);
  assert.ok(NOUNS.length >= 128, `nouns: ${NOUNS.length}`);
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length);
  assert.equal(new Set(NOUNS).size, NOUNS.length);
  for (const w of [...ADJECTIVES, ...NOUNS]) {
    assert.match(w, /^[a-z]+$/, `non-lowercase: ${w}`);
  }
});

test('unknown words fall back via hash (stable)', () => {
  const s1 = wordsToSeed('notaword-garbage-99');
  const s2 = wordsToSeed('notaword-garbage-99');
  assert.equal(s1, s2);
  assert.ok(s1 >= 0 && s1 < 1000000);
});

test('distinct seeds usually produce distinct words', () => {
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < 200; i++) {
    const w = seedToWords(i);
    if (seen.has(w)) collisions++;
    seen.add(w);
  }
  assert.equal(collisions, 0, 'first 200 seeds collide');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/studio/seed-words.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the module**

Create `apps/sigil/studio/js/seed-words.js`. Two arrays of ~128 lowercase words each (curate them inline — no offensive/loaded terms). Exports:

```javascript
// seed-words.js — stable bidirectional mapping between numeric seeds
// (0..999_999) and human-readable <adjective>-<noun>-<NN> triples.

export const ADJECTIVES = [
  'amber','arctic','azure','bold','brave','bright','calm','celestial',
  'citrine','cobalt','cosmic','crystal','cyan','daring','deep','distant',
  'dusk','ebon','electric','ember','emerald','fabled','feral','fierce',
  'flickering','forest','frost','gentle','ghostly','gilded','glassy','gleaming',
  'glitter','glowing','golden','hazy','hidden','hollow','honeyed','humble',
  'icy','indigo','inky','iron','ivory','jagged','jaded','jewel',
  'keen','kindred','lacquer','lavender','lazy','lilac','lively','lucid',
  'lunar','luminous','marble','meadow','merry','midnight','milky','mirror',
  'misty','molten','mossy','muted','nebula','neon','nimble','noble',
  'nomad','northern','obsidian','ocean','onyx','opal','orbit','pastel',
  'pearl','placid','plum','polar','prism','proud','quartz','quiet',
  'radiant','raven','rose','royal','russet','rustic','saffron','sage',
  'sapphire','scarlet','serene','shadow','silent','silken','silver','smoky',
  'solar','somber','sparkle','starlit','steady','stellar','still','stone',
  'storm','sudden','sunset','swift','tawny','tender','tidal','tiger',
  'twilight','umber','valiant','velvet','verdant','violet','vivid','wandering',
  'warm','whispered','wild','willow','winter','wistful','woven','zephyr',
];

export const NOUNS = [
  'aura','badger','beacon','bear','birch','bloom','bolt','braid',
  'breeze','briar','brook','canyon','cascade','cedar','cinder','citadel',
  'cloud','comet','coral','cove','crane','crest','crow','crystal',
  'daisy','dawn','delta','dew','domain','drift','dune','eagle',
  'echo','ember','falcon','fawn','fern','fjord','flame','fog',
  'forge','fox','frost','garnet','glade','glen','goose','grove',
  'hare','harvest','haven','hawk','heath','hill','horizon','ibis',
  'iris','ivy','jay','kestrel','kite','lake','lantern','lark',
  'leaf','lichen','lion','lotus','lynx','mantle','maple','marsh',
  'meadow','mesa','mist','moor','moss','mountain','nebula','nest',
  'oak','ocean','oracle','orchid','otter','owl','panther','peak',
  'pebble','petal','pine','piper','planet','plume','pond','prism',
  'quasar','quill','rain','rapid','raven','reed','reef','ridge',
  'river','robin','rose','sable','sapling','seed','shore','silhouette',
  'skiff','sky','slope','sparrow','spear','spire','spring','stag',
  'star','stone','stream','summit','sun','swan','thicket','thistle',
  'thorn','tide','tower','trail','twig','valley','vault','veil',
  'vine','vista','wake','wave','whisker','willow','wing','wisp',
];

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) % 1_000_000;
}

export function seedToWords(seed) {
  const n = Math.abs(Math.trunc(seed)) % 1_000_000;
  const adj = ADJECTIVES[n % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(n / ADJECTIVES.length) % NOUNS.length];
  const tail = String(n % 100).padStart(2, '0');
  return `${adj}-${noun}-${tail}`;
}

export function wordsToSeed(s) {
  const m = typeof s === 'string' && s.match(/^([a-z]+)-([a-z]+)-(\d{1,3})$/);
  if (!m) return hashString(String(s));
  const ai = ADJECTIVES.indexOf(m[1]);
  const ni = NOUNS.indexOf(m[2]);
  const tail = parseInt(m[3], 10);
  if (ai < 0 || ni < 0 || isNaN(tail)) return hashString(s);
  // Reconstruct a seed consistent with seedToWords: any seed with the given
  // (adj, noun, tail) satisfies the constraints; pick the canonical one.
  // Formula: seed % ADJ = ai; floor(seed/ADJ) % NOUNS = ni; seed % 100 = tail.
  // Find smallest seed in [0, ADJ*NOUNS*100) matching all three.
  const L = ADJECTIVES.length;
  for (let k = 0; k < 100; k++) {
    const candidate = ai + L * (ni + NOUNS.length * k);
    if (candidate % 100 === tail) return candidate;
  }
  // Fallback if no alignment exists within one k-cycle (shouldn't happen).
  return hashString(s);
}
```

- [ ] **Step 4: Run and verify passing**

Run: `node --test tests/studio/seed-words.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/js/seed-words.js tests/studio/seed-words.test.mjs
git commit -m "feat(studio): seed ↔ words bidirectional mapping"
```

---

## Task 3: Seed history ring buffer

**Files:**
- Create: `apps/sigil/studio/js/seed-history.js`
- Test: `tests/studio/seed-history.test.mjs`

Bounded FIFO of the last N seeds with per-entry metadata (`seed`, `scope`, `timestamp`). Used by the reroll flyout's recent strip. Pure module, no DOM.

- [ ] **Step 1: Failing test**

Create `tests/studio/seed-history.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeedHistory } from '../../apps/sigil/studio/js/seed-history.js';

test('push adds entries in temporal order (newest first)', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 2, scope: 'shape' });
  const entries = h.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].seed, 2);
  assert.equal(entries[1].seed, 1);
  assert.ok(entries[0].timestamp >= entries[1].timestamp);
});

test('capacity is enforced; oldest drops', () => {
  const h = createSeedHistory({ capacity: 3 });
  for (let i = 0; i < 5; i++) h.push({ seed: i, scope: 'all' });
  const seeds = h.entries().map(e => e.seed);
  assert.deepEqual(seeds, [4, 3, 2]);
});

test('duplicate consecutive seeds collapse', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 1, scope: 'all' });
  h.push({ seed: 2, scope: 'all' });
  assert.deepEqual(h.entries().map(e => e.seed), [2, 1]);
});

test('clear empties the buffer', () => {
  const h = createSeedHistory({ capacity: 4 });
  h.push({ seed: 1, scope: 'all' });
  h.clear();
  assert.equal(h.entries().length, 0);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/studio/seed-history.test.mjs`
Expected: FAIL (missing module).

- [ ] **Step 3: Implement**

Create `apps/sigil/studio/js/seed-history.js`:

```javascript
// seed-history.js — bounded temporal ring of recent reroll seeds.
// Newest first; consecutive duplicates collapse (useful when the user
// repeats the same scope with the same seed).

export function createSeedHistory({ capacity = 8 } = {}) {
  const buf = [];
  return {
    push({ seed, scope }) {
      const entry = { seed, scope, timestamp: Date.now() };
      if (buf.length > 0 && buf[0].seed === seed && buf[0].scope === scope) {
        buf[0] = entry;
        return;
      }
      buf.unshift(entry);
      if (buf.length > capacity) buf.length = capacity;
    },
    entries() {
      return buf.slice();
    },
    clear() {
      buf.length = 0;
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/studio/seed-history.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/js/seed-history.js tests/studio/seed-history.test.mjs
git commit -m "feat(studio): seed history ring buffer"
```

---

## Task 4: Undo ring buffer

**Files:**
- Create: `apps/sigil/studio/js/undo-buffer.js`
- Test: `tests/studio/undo-buffer.test.mjs`

Session-scoped, per-agent, 20-entry ring of pre-save appearance snapshots. API: `record(agentId, appearance, meta)`, `undo(agentId) → { appearance, meta } | null`, `canUndo(agentId)`, `clear(agentId?)`. Pure module.

- [ ] **Step 1: Failing test**

Create `tests/studio/undo-buffer.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoBuffer } from '../../apps/sigil/studio/js/undo-buffer.js';

test('record then undo returns the snapshot', () => {
  const u = createUndoBuffer({ capacity: 20 });
  u.record('alice', { shape: 6 });
  const popped = u.undo('alice');
  assert.deepEqual(popped.appearance, { shape: 6 });
});

test('per-agent isolation', () => {
  const u = createUndoBuffer();
  u.record('alice', { shape: 6 });
  u.record('bob', { shape: 8 });
  assert.equal(u.undo('alice').appearance.shape, 6);
  assert.equal(u.undo('bob').appearance.shape, 8);
});

test('capacity cap drops oldest', () => {
  const u = createUndoBuffer({ capacity: 3 });
  for (let i = 0; i < 5; i++) u.record('alice', { shape: i });
  // stack has [4,3,2]; undo returns newest first
  assert.equal(u.undo('alice').appearance.shape, 4);
  assert.equal(u.undo('alice').appearance.shape, 3);
  assert.equal(u.undo('alice').appearance.shape, 2);
  assert.equal(u.undo('alice'), null);
});

test('canUndo reflects state', () => {
  const u = createUndoBuffer();
  assert.equal(u.canUndo('alice'), false);
  u.record('alice', { shape: 6 });
  assert.equal(u.canUndo('alice'), true);
  u.undo('alice');
  assert.equal(u.canUndo('alice'), false);
});

test('meta roundtrips', () => {
  const u = createUndoBuffer();
  u.record('alice', { shape: 6 }, { seed: 42, scope: 'shape' });
  const e = u.undo('alice');
  assert.equal(e.meta.seed, 42);
  assert.equal(e.meta.scope, 'shape');
});
```

- [ ] **Step 2: Run, fail**

Run: `node --test tests/studio/undo-buffer.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/sigil/studio/js/undo-buffer.js`:

```javascript
// undo-buffer.js — session-scoped per-agent undo ring.
// Stores pre-save appearance snapshots; popping triggers re-apply + save in
// the caller. No persistence — closing Studio forfeits history.

export function createUndoBuffer({ capacity = 20 } = {}) {
  const stacks = new Map(); // agentId -> [{ appearance, meta, timestamp }, ...] (newest at end)
  return {
    record(agentId, appearance, meta = {}) {
      if (!stacks.has(agentId)) stacks.set(agentId, []);
      const stack = stacks.get(agentId);
      stack.push({
        appearance: structuredClone(appearance),
        meta: { ...meta },
        timestamp: Date.now(),
      });
      if (stack.length > capacity) stack.shift();
    },
    undo(agentId) {
      const stack = stacks.get(agentId);
      if (!stack || stack.length === 0) return null;
      return stack.pop();
    },
    canUndo(agentId) {
      const stack = stacks.get(agentId);
      return !!(stack && stack.length > 0);
    },
    clear(agentId) {
      if (agentId === undefined) stacks.clear();
      else stacks.delete(agentId);
    },
  };
}
```

- [ ] **Step 4: Run, pass**

Run: `node --test tests/studio/undo-buffer.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/js/undo-buffer.js tests/studio/undo-buffer.test.mjs
git commit -m "feat(studio): session-scoped undo ring buffer"
```

---

## Task 5: Agent fork helper

**Files:**
- Create: `apps/sigil/renderer/agent-fork.js`
- Test: `tests/studio/agent-fork.test.mjs`

`forkAgent(sourceMarkdown, newId, newName)` rewrites the source doc: replaces frontmatter `id:` and `name:`, preserves `tags`, preserves the `json` block including `appearance`, `minds`, `instance`. Lives under `renderer/` so future canvases can reuse.

- [ ] **Step 1: Failing test**

Create `tests/studio/agent-fork.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkAgent } from '../../apps/sigil/renderer/agent-fork.js';

const SOURCE = `---
type: agent
id: old
name: Old One
tags: [sigil, blue]
---

Some prose about the agent.

\`\`\`json
{
  "version": 1,
  "appearance": { "shape": 6, "opacity": 0.5 },
  "minds": { "skills": ["think"], "tools": [], "workflows": [] },
  "instance": { "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" }, "size": 300 }
}
\`\`\`
`;

test('frontmatter id and name are replaced; tags preserved', () => {
  const out = forkAgent(SOURCE, 'new', 'New One');
  assert.match(out, /^---\ntype: agent\nid: new\nname: New One\ntags: \[sigil, blue\]\n---/);
});

test('json block fully preserved', () => {
  const out = forkAgent(SOURCE, 'new', 'New One');
  const m = out.match(/```json\s*\n([\s\S]*?)\n```/);
  assert.ok(m, 'json block present');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.appearance.shape, 6);
  assert.deepEqual(parsed.minds.skills, ['think']);
});

test('missing source falls back to a valid doc', () => {
  const out = forkAgent('', 'fresh', 'Fresh');
  assert.match(out, /id: fresh/);
  assert.match(out, /name: Fresh/);
  assert.match(out, /```json/);
});

test('rejects invalid ids', () => {
  assert.throws(() => forkAgent(SOURCE, '', 'x'), /id/);
  assert.throws(() => forkAgent(SOURCE, 'bad/id', 'x'), /id/);
  assert.throws(() => forkAgent(SOURCE, '../escape', 'x'), /id/);
});
```

- [ ] **Step 2: Fail**

Run: `node --test tests/studio/agent-fork.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/sigil/renderer/agent-fork.js`:

```javascript
// agent-fork.js — deterministic fork of an agent wiki doc.
// Rewrites frontmatter id/name; preserves tags, prose, and the json body
// (including appearance, minds, instance). Used by the three fork entry
// points (+ new, save-as, clone).

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function forkAgent(sourceMarkdown, newId, newName) {
  if (!ID_RE.test(newId) || newId.includes('..') || newId.includes('/')) {
    throw new Error(`invalid agent id: ${JSON.stringify(newId)}`);
  }
  const src = sourceMarkdown || defaultDoc(newId, newName);
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return defaultDoc(newId, newName);

  const body = src.slice(fmMatch[0].length);
  const originalFm = fmMatch[1];
  const fmLines = originalFm.split('\n');
  let sawId = false, sawName = false;
  const rewritten = fmLines.map(line => {
    if (/^id:\s*/.test(line)) { sawId = true; return `id: ${newId}`; }
    if (/^name:\s*/.test(line)) { sawName = true; return `name: ${newName}`; }
    return line;
  });
  if (!sawId) rewritten.push(`id: ${newId}`);
  if (!sawName) rewritten.push(`name: ${newName}`);
  return `---\n${rewritten.join('\n')}\n---\n${body.startsWith('\n') ? body : '\n' + body}`;
}

function defaultDoc(id, name) {
  const body = {
    version: 1,
    appearance: {},
    minds: { skills: [], tools: [], workflows: [] },
    instance: {
      home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
      size: 300,
    },
  };
  return `---
type: agent
id: ${id}
name: ${name}
tags: [sigil]
---

Sigil agent: ${name}.

\`\`\`json
${JSON.stringify(body, null, 2)}
\`\`\`
`;
}
```

- [ ] **Step 4: Pass**

Run: `node --test tests/studio/agent-fork.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/agent-fork.js tests/studio/agent-fork.test.mjs
git commit -m "feat(sigil): agent-fork helper shared by studio entry points"
```

---

## Task 6: Agent API client module

**Files:**
- Create: `apps/sigil/studio/js/agent-api.js`

HTTP wrapper around the wiki REST surface. One place for URL construction; Studio code never fetches `/wiki/...` directly again. Not unit-tested in isolation (pure I/O wrapper); validated in Task 12 smoke test.

- [ ] **Step 1: Write the module**

Create `apps/sigil/studio/js/agent-api.js`:

```javascript
// agent-api.js — HTTP surface for sigil/agents/* wiki docs.
// All calls are relative to the same origin Studio is served from. The content
// server exposes /wiki/<path> (GET/PUT/DELETE on files) and /wiki/<dir>/
// (GET listing; trailing slash required). See src/content/server.swift.

const NS = 'sigil/agents';

export async function listAgents() {
  const res = await fetch(`/wiki/${NS}/`);
  if (!res.ok) throw new Error(`listAgents: HTTP ${res.status}`);
  const payload = await res.json();
  return payload.entries
    .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
    .map(e => e.name.slice(0, -'.md'.length));
}

export async function loadAgentDoc(id) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`loadAgentDoc(${id}): HTTP ${res.status}`);
  return await res.text();
}

export async function putAgentDoc(id, markdown) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: markdown,
  });
  if (!res.ok) throw new Error(`putAgentDoc(${id}): HTTP ${res.status}`);
}

export async function deleteAgent(id) {
  const res = await fetch(`/wiki/${NS}/${encodeURIComponent(id)}.md`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteAgent(${id}): HTTP ${res.status}`);
  }
}
```

- [ ] **Step 2: Smoke-check with curl against a running daemon**

With `aos serve` running and the endpoint from Task 1 in place, verify listAgents' URL manually:

```bash
PORT=$(cat ~/.config/aos/repo/content.port)
curl -sf "http://127.0.0.1:$PORT/wiki/sigil/agents/" | head -c 200
```

Expected: JSON with entries array including `default.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/studio/js/agent-api.js
git commit -m "feat(studio): agent-api HTTP client"
```

---

## Task 7: Extract scope-partitioned `randomizeAll(seed, scope)`

**Files:**
- Create: `apps/sigil/studio/js/randomize.js`
- Modify: `apps/sigil/studio/js/ui.js:547-647`

Lift `randomizeAll` out of `ui.js` into its own module, split the body into `randomizeShape`, `randomizePalette`, `randomizeEffects`, and dispatch by `scope`. Preserve the existing `setUI` mechanism (it dispatches `input` + `change` events, which is how panels currently persist). Scope defaults to `'everything'`.

- [ ] **Step 1: Identify the functions `randomizeAll` depends on**

Grep: `rg -n "updatePulsars|updateGammaRays|updateAccretion|updateNeutrinos|EFFECTS|state\." apps/sigil/studio/js/ui.js | sed -n '1,40p'`
Note which are exported/importable vs. local to ui.js. If any are local, either export them from ui.js (preferred — one-line change) or pass them into the randomize function as dependencies (second-choice).

- [ ] **Step 2: Create the module with a thin dependency-injection boundary**

Create `apps/sigil/studio/js/randomize.js`:

```javascript
// randomize.js — scope-partitioned seeded randomization.
// Split from ui.js so the reroll flyout can target shape / palette / effects
// independently. Preserves the setUI(el,val)→dispatch(input,change) path so
// panels auto-persist via their existing listeners.
import state from '../../renderer/state.js';

// Seeded PRNG (mulberry32). Same seed → same result.
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setUI(id, val, strVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    if (el.checked !== val) { el.checked = val; el.dispatchEvent(new Event('change')); }
  } else {
    el.value = val;
    if (strVal !== undefined) {
      const vDisp = document.getElementById(id.replace('Slider', 'Val'));
      if (vDisp) vDisp.innerText = strVal;
    }
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  }
}

function randomizeShape(rng) {
  const shapes = [4, 6, 8, 12, 20, 90, 91, 92, 93, 100];
  setUI('shapeSelect', shapes[Math.floor(rng() * shapes.length)]);
  const stellation = (rng() * 3 - 1).toFixed(2); setUI('stellationSlider', stellation, stellation);
  const opacity = rng().toFixed(2); setUI('opacitySlider', opacity, opacity);
  const edgeOpacity = (rng() * 0.8 + 0.2).toFixed(2); setUI('edgeOpacitySlider', edgeOpacity, edgeOpacity);
  setUI('maskToggle', rng() > 0.5);
  setUI('interiorEdgesToggle', rng() > 0.5);
  setUI('specularToggle', rng() > 0.5);
  // Shape-family param resets (tetartoid / torus / cylinder / box)
  state.tetartoidA = 1.0; state.tetartoidB = 1.5; state.tetartoidC = 2.0;
  setUI('tetASlider', 1.0, '1.00'); setUI('tetBSlider', 1.5, '1.50'); setUI('tetCSlider', 2.0, '2.00');
  state.torusRadius = 1.0; state.torusTube = 0.3; state.torusArc = 1.0;
  setUI('torusRadiusSlider', 1.0, '1.00'); setUI('torusTubeSlider', 0.3, '0.30'); setUI('torusArcSlider', 1.0, '1.00');
  state.cylinderTopRadius = 1.0; state.cylinderBottomRadius = 1.0; state.cylinderHeight = 1.0; state.cylinderSides = 32;
  setUI('cylinderTopSlider', 1.0, '1.00'); setUI('cylinderBottomSlider', 1.0, '1.00');
  setUI('cylinderHeightSlider', 1.0, '1.00'); setUI('cylinderSidesSlider', 32, '32');
  state.boxWidth = 1.0; state.boxHeight = 1.0; state.boxDepth = 1.0;
  setUI('boxWidthSlider', 1.0, '1.00'); setUI('boxHeightSlider', 1.0, '1.00'); setUI('boxDepthSlider', 1.0, '1.00');
}

function randomizePalette(rng) {
  if (rng() > 0.5) {
    const c1 = '#' + Math.floor(rng() * 16777215).toString(16).padStart(6, '0');
    const c2 = '#' + Math.floor(rng() * 16777215).toString(16).padStart(6, '0');
    setUI('masterColor1', c1);
    setUI('masterColor2', c2);
  }
  // Skin weighted toward 'none'.
  const skins = ['none', 'none', 'none', 'rocky', 'gas-giant', 'ice', 'volcanic', 'solar'];
  setUI('skinSelect', skins[Math.floor(rng() * skins.length)]);
}

function randomizeEffects(rng, deps) {
  const aReach = (rng() * 3).toFixed(2); setUI('auraReachSlider', aReach, aReach);
  const aInt = (rng() * 3).toFixed(2); setUI('auraIntensitySlider', aInt, aInt);
  const spin = (rng() * 0.025).toFixed(3); setUI('idleSpinSlider', spin, spin);
  const pulse = (rng() * 0.019 + 0.001).toFixed(3); setUI('pulseRateSlider', pulse, pulse);
  setUI('pulsarToggle', rng() > 0.7);
  setUI('accretionToggle', rng() > 0.7);
  setUI('gammaToggle', rng() > 0.7);
  setUI('neutrinoToggle', rng() > 0.7);
  setUI('lightningToggle', rng() > 0.7);
  setUI('magneticToggle', rng() > 0.7);
  if (state.isOmegaEnabled) {
    setUI('omegaShapeSelect', [4, 6, 8, 12, 20, 90, 100][Math.floor(rng() * 7)]);
    setUI('omegaStellationSlider', (rng() * 3 - 1), (rng() * 3 - 1).toFixed(2));
    setUI('omegaOpacitySlider', rng(), rng().toFixed(2));
    setUI('omegaEdgeOpacitySlider', rng(), rng().toFixed(2));
    setUI('omegaScaleSlider', 0.5 + rng() * 3, (0.5 + rng() * 3).toFixed(2));
    setUI('omegaMaskToggle', rng() > 0.5);
    setUI('omegaCounterSpin', rng() > 0.5);
    setUI('omegaInterDimensional', rng() > 0.7);
  }
  ['pulsarCount', 'accretionCount', 'gammaCount', 'neutrinoCount'].forEach(id => setUI(id, 1));
  state.pulsarRayCount = 1; state.accretionDiskCount = 1; state.gammaRayCount = 1; state.neutrinoJetCount = 1;
  deps.updatePulsars(1); deps.updateGammaRays(1); deps.updateAccretion(1); deps.updateNeutrinos(1);
  ['p', 'a', 'g', 'n'].forEach(k => {
    const tVal = (rng() * 0.5).toFixed(2);
    const tSpd = (rng() * 4 + 0.5).toFixed(1);
    const tMod = ['uniform', 'staggered', 'random'][Math.floor(rng() * 3)];
    setUI(`${k}TurbSlider`, tVal, tVal);
    setUI(`${k}TurbSpdSlider`, tSpd, tSpd);
    document.getElementById(`${k}TurbMod`).value = tMod;
    state.turbState[k].val = parseFloat(tVal);
    state.turbState[k].spd = parseFloat(tSpd);
    state.turbState[k].mod = tMod;
  });
}

export function randomizeAll(seed, scope = 'everything', deps = {}) {
  const rng = mulberry32(seed >>> 0);
  if (scope === 'shape' || scope === 'everything') randomizeShape(rng);
  if (scope === 'palette' || scope === 'everything') randomizePalette(rng);
  if (scope === 'effects' || scope === 'everything') randomizeEffects(rng, deps);
  return seed;
}
```

- [ ] **Step 3: Remove the old `randomizeAll` / `mulberry32` from `ui.js`**

In `apps/sigil/studio/js/ui.js`:
1. Delete the inline `function mulberry32(seed)` at line 14.
2. Delete the inline `function randomizeAll(seed) { ... }` at line 547–647.
3. At the top of `ui.js`, add: `import { randomizeAll } from './randomize.js';`
4. Find `document.getElementById('btn-randomize').addEventListener('click', () => randomizeAll());` at line 1015 — leave this line until Task 13 (it still works as-is; no scope argument → `'everything'`), but replace the call with an explicit seed: `() => randomizeAll(Math.floor(Math.random() * 999999), 'everything', { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos })`.
5. Find the URL-seed autorun at line 1855 — update to pass the deps object too.

- [ ] **Step 4: Smoke test in the live Studio**

Build: `bash build.sh && ./aos service restart --mode repo`. Open Studio: `./aos show create --id studio --url 'aos://sigil/studio/index.html' --interactive --focus --at 200,200,460,720`. Click the randomize button, confirm behavior matches previous.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/js/randomize.js apps/sigil/studio/js/ui.js
git commit -m "refactor(studio): extract scope-partitioned randomize module"
```

---

## Task 8: Shell CSS — new app-shell styles

**Files:**
- Create: `apps/sigil/studio/css/shell.css`

All new shell selectors live here: titlebar, header row, chip, reroll button, reroll flyout, roster grid, agent tiles, sync status. Component CSS stays with `controls.css` / `sidebar.css` for panel internals.

- [ ] **Step 1: Write the CSS**

Create `apps/sigil/studio/css/shell.css`:

```css
/* shell.css — Studio app shell for the stageless UX rework.
   All new chrome styles live here. Panel interior styles stay in
   controls.css and sidebar.css. Purple accent #bc13fe carries over. */

:root {
  --accent: #bc13fe;
  --accent-dim: rgba(188, 19, 254, 0.15);
  --accent-glow: 0 0 8px rgba(188, 19, 254, 0.35);
  --shell-bg: #0b0b14;
  --shell-fg: #e8e6f2;
  --shell-border: #2a2a3a;
  --shell-border-muted: #1e1e2a;
}

html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--shell-bg);
  color: var(--shell-fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

#studio-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

/* --- Header row (persistent agent chip + reroll) --- */
#studio-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--shell-border);
  background: linear-gradient(180deg, #141420 0%, var(--shell-bg) 100%);
  -webkit-user-select: none;
  -webkit-app-region: drag;
}

/* Agent chip --- identity pill */
#agent-chip {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #181826;
  border: 1px solid var(--shell-border);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 120ms, box-shadow 120ms;
  -webkit-app-region: no-drag;
}
#agent-chip:hover { border-color: var(--accent); box-shadow: var(--accent-glow); }

#agent-chip .orb {
  width: 28px; height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  background: radial-gradient(circle at 30% 30%, #fff6, transparent 55%),
              var(--orb-gradient, linear-gradient(135deg, var(--accent), #4a2b6e));
  box-shadow: inset 0 0 4px rgba(0,0,0,0.4);
}
#agent-chip .text { flex: 1; min-width: 0; }
#agent-chip .name {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#agent-chip .sync {
  font-size: 11px;
  color: #9a9aa8;
  display: flex;
  align-items: center;
  gap: 6px;
}
#agent-chip .sync .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #3fbd6f;
  transition: background-color 150ms;
}
#agent-chip .sync[data-state='saving'] .dot { background: #e5a11a; }
#agent-chip .sync[data-state='error'] .dot { background: #d94e4e; }

#agent-chip .caret {
  font-size: 10px;
  color: #6a6a7a;
}

/* Reroll button */
#btn-reroll {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--accent-dim);
  color: var(--shell-fg);
  border: 1px solid var(--accent);
  border-radius: 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  -webkit-app-region: no-drag;
}
#btn-reroll:hover { background: rgba(188, 19, 254, 0.3); }

/* Chip menu (popover anchored below chip) */
.popover {
  position: absolute;
  background: #1a1a28;
  border: 1px solid var(--shell-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 4px;
  z-index: 100;
  min-width: 180px;
}
.popover[hidden] { display: none; }
.popover .item {
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.popover .item:hover { background: var(--accent-dim); }
.popover .item.danger { color: #e88686; }
.popover .sep { height: 1px; background: var(--shell-border-muted); margin: 4px 0; }

/* --- Reroll flyout --- */
#reroll-flyout {
  width: 280px;
  padding: 10px;
}
#reroll-flyout .scopes {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
#reroll-flyout .scope {
  flex: 1;
  padding: 6px 8px;
  background: #1a1a28;
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  font-size: 11px;
  text-align: center;
  cursor: pointer;
}
#reroll-flyout .scope.active {
  background: var(--accent-dim);
  border-color: var(--accent);
}
#reroll-flyout .recent {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 36px;
  overflow-x: auto;
}
#reroll-flyout .recent .mini-orb {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid transparent;
  cursor: pointer;
  flex-shrink: 0;
}
#reroll-flyout .recent .mini-orb.current { border-color: var(--accent); }
#reroll-flyout .seed-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
#reroll-flyout .seed-input {
  flex: 1;
  padding: 6px 10px;
  background: #0f0f18;
  border: 1px solid var(--shell-border);
  color: var(--shell-fg);
  border-radius: 20px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}

/* --- Body: rail + panel --- */
#studio-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
#nav-rail-container {
  width: 56px;
  background: #0a0a12;
  border-right: 1px solid var(--shell-border);
}
#panel-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* --- Roster grid --- */
#panel-roster { }
#roster-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.agent-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  background: #141420;
  border: 1px solid var(--shell-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 120ms;
}
.agent-tile:hover { border-color: #4a3a6e; }
.agent-tile.active {
  border-color: var(--accent);
  box-shadow: var(--accent-glow);
}
.agent-tile .orb {
  width: 50px; height: 50px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fff6, transparent 55%),
              var(--orb-gradient, linear-gradient(135deg, var(--accent), #4a2b6e));
}
.agent-tile .name {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}
.agent-tile .status {
  font-size: 10px;
  color: #6a6a7a;
}
.agent-tile .kebab {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px; height: 20px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #6a6a7a;
}
.agent-tile:hover .kebab { display: flex; }
.agent-tile .kebab:hover { background: var(--accent-dim); color: var(--shell-fg); }
.agent-tile.new {
  border-style: dashed;
  color: #9a9aa8;
}
.agent-tile.new .plus {
  font-size: 28px;
  color: #6a6a7a;
}

/* --- Modal prompt (fork rename delete) --- */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal-backdrop[hidden] { display: none; }
.modal {
  background: #1a1a28;
  border: 1px solid var(--shell-border);
  border-radius: 10px;
  padding: 20px;
  min-width: 280px;
}
.modal h3 { margin: 0 0 10px; font-size: 14px; }
.modal label { display: block; font-size: 11px; color: #9a9aa8; margin-top: 10px; margin-bottom: 4px; }
.modal input {
  width: 100%;
  padding: 6px 10px;
  background: #0f0f18;
  border: 1px solid var(--shell-border);
  color: var(--shell-fg);
  border-radius: 6px;
  font-size: 13px;
  box-sizing: border-box;
}
.modal .buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.modal button {
  padding: 6px 14px;
  background: transparent;
  color: var(--shell-fg);
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.modal button.primary {
  background: var(--accent-dim);
  border-color: var(--accent);
}
.modal button.danger { color: #e88686; border-color: #6a2424; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/studio/css/shell.css
git commit -m "feat(studio): app-shell CSS for stageless UX"
```

---

## Task 9: Rewrite `index.html` shell

**Files:**
- Modify: `apps/sigil/studio/index.html`

Replace the outer structure. The Shape/Colors/Effects/Avatar panel **contents** (all their `<input>`, `<select>`, etc.) are copied verbatim into the new panel containers — we are rebuilding the shell, not the controls. Add `shell.css` to the `<link>` list. Remove Three.js CDN script.

- [ ] **Step 1: Read the panel bodies from current index.html**

Run: `grep -n '<div id="panel-geom"\|<div id="panel-colors"\|<div id="panel-anim"\|<div id="panel-env"\|^</div> *<!-- End panel' apps/sigil/studio/index.html` to find the current panel ranges; copy those blocks aside mentally (or into a scratch file). The plan does not respecify slider contents.

- [ ] **Step 2: Replace the file with the new shell**

Overwrite `apps/sigil/studio/index.html` with this structure, pasting the existing panel bodies into the placeholders:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sigil Studio</title>
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/shell.css">
<link rel="stylesheet" href="css/sidebar.css">
<link rel="stylesheet" href="css/controls.css">
</head>
<body>
<div id="studio-shell">
  <!-- Persistent header: agent chip + reroll button -->
  <div id="studio-header">
    <div id="agent-chip" role="button" tabindex="0" aria-haspopup="menu">
      <div class="orb" aria-hidden="true"></div>
      <div class="text">
        <div class="name">…</div>
        <div class="sync" data-state="saved"><span class="dot"></span><span class="label">All changes saved</span></div>
      </div>
      <span class="caret">▾</span>
    </div>
    <button id="btn-reroll" aria-haspopup="dialog">🎲 Reroll ▾</button>
  </div>

  <!-- Body: nav rail + active panel -->
  <div id="studio-body">
    <div id="nav-rail-container">
      <div id="nav-rail">
        <div class="nav-icon active" data-target="panel-roster" title="Roster">◈</div>
        <div class="nav-icon" data-target="panel-geom" title="Shape">▲</div>
        <div class="nav-icon" data-target="panel-colors" title="Colors">◉</div>
        <div class="nav-icon" data-target="panel-anim" title="Effects">✦</div>
        <div class="nav-icon" data-target="panel-env" title="Agent">☺</div>
      </div>
    </div>
    <div id="panel-container">
      <!-- Roster panel: grid rendered by roster.js -->
      <div id="panel-roster" class="panel active">
        <h2>Roster</h2>
        <div id="roster-grid"></div>
      </div>

      <!-- Shape panel: paste verbatim contents from prior #panel-geom -->
      <div id="panel-geom" class="panel">
        <!-- PASTE: former #panel-geom body from prior index.html -->
      </div>

      <!-- Colors panel -->
      <div id="panel-colors" class="panel">
        <!-- PASTE: former #panel-colors body -->
      </div>

      <!-- Effects panel -->
      <div id="panel-anim" class="panel">
        <!-- PASTE: former #panel-anim body -->
      </div>

      <!-- Agent panel (was Environment/Avatar placeholder) -->
      <div id="panel-env" class="panel">
        <h2>Agent</h2>
        <label>Display Name</label>
        <input type="text" id="agentDisplayName">
        <label>Home Anchor</label>
        <select id="agentHomeAnchor">
          <option value="nonant">Nonant</option>
          <option value="free">Free</option>
        </select>
        <label>Nonant</label>
        <select id="agentHomeNonant">
          <option value="top-left">top-left</option>
          <option value="top-center">top-center</option>
          <option value="top-right">top-right</option>
          <option value="middle-left">middle-left</option>
          <option value="middle-center">middle-center</option>
          <option value="middle-right">middle-right</option>
          <option value="bottom-left">bottom-left</option>
          <option value="bottom-center">bottom-center</option>
          <option value="bottom-right" selected>bottom-right</option>
        </select>
        <label>Display</label>
        <select id="agentHomeDisplay">
          <option value="main">main</option>
        </select>
        <label>Base Size <span id="baseSizeVal">300</span></label>
        <input type="range" id="baseSizeSlider" min="100" max="800" step="10" value="300">
        <label>Min Size <span id="minSizeVal">100</span></label>
        <input type="range" id="minSizeSlider" min="50" max="400" step="10" value="100">
        <label>Max Size <span id="maxSizeVal">800</span></label>
        <input type="range" id="maxSizeSlider" min="200" max="1200" step="10" value="800">
      </div>
    </div>
  </div>

  <!-- Popovers (chip menu, reroll flyout) rendered inline, positioned by JS -->
  <div id="chip-menu" class="popover" role="menu" hidden></div>
  <div id="reroll-flyout" class="popover" role="dialog" hidden></div>

  <!-- Modal host (reused by save-as / rename / delete-confirm) -->
  <div id="modal-host" class="modal-backdrop" hidden></div>
</div>

<script type="module" src="js/main.js"></script>
</body>
</html>
```

Note: any `id`s referenced by existing panel JS that lived in the old markup must be preserved in the pasted panel bodies. The Save/Load/Randomize/Close nav-rail icons are intentionally dropped.

- [ ] **Step 3: Drop `avatar.html`**

```bash
git rm apps/sigil/avatar.html
```

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/index.html
git commit -m "feat(studio): stageless app shell in index.html"
```

---

## Task 10: Strip 3D-canvas code from `main.js` and delete preview-only modules

**Files:**
- Modify: `apps/sigil/studio/js/main.js`
- Delete: `apps/sigil/studio/js/scene.js`, `skybox.js`, `interaction.js`, `pathing.js`, `grid3d.js`, `swarm.js`
- Modify: `apps/sigil/studio/js/ui.js` (remove any imports from deleted modules)

`main.js` becomes a bootstrap that runs `setupUI()` + `setupEditableLabels()`. No three.js, no render loop.

- [ ] **Step 1: Confirm none of the deleted files are imported by `renderer/`**

Run: `rg -l "from '.*studio/js/(scene|skybox|interaction|pathing|grid3d|swarm)" apps/sigil/renderer`
Expected: no matches.

- [ ] **Step 2: Delete preview-only modules**

```bash
git rm apps/sigil/studio/js/scene.js \
       apps/sigil/studio/js/skybox.js \
       apps/sigil/studio/js/interaction.js \
       apps/sigil/studio/js/pathing.js \
       apps/sigil/studio/js/grid3d.js \
       apps/sigil/studio/js/swarm.js
```

- [ ] **Step 3: Rewrite `main.js`**

Replace `apps/sigil/studio/js/main.js` with:

```javascript
// main.js — Studio bootstrap.
// Studio is a control surface. The live renderer on the desktop is the preview.
// We do not init a Three.js scene here; we only wire the UI.

import { setupUI, setupEditableLabels } from './ui.js';
import { setupChip } from './chip.js';
import { setupRoster } from './roster.js';
import { setupReroll } from './reroll.js';

function init() {
  setupUI();
  setupEditableLabels();
  setupChip();
  setupRoster();
  setupReroll();
}

window.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 4: Remove preview-only imports from `ui.js`**

In `apps/sigil/studio/js/ui.js`, delete any `import ... from './scene.js'`, `'./skybox.js'`, `'./interaction.js'`, `'./pathing.js'`, `'./grid3d.js'`, `'./swarm.js'`, and any calls like `initScene()`, `setupInteraction()`, `animatePathing()` that `ui.js` was making. Also delete references to `ctx-object`, `ctx-particle`, and any handler that attaches events to the removed 3D canvas (those DOM ids no longer exist).

If `ui.js` has animation/render-loop hooks, delete them — Studio runs no RAF loop.

- [ ] **Step 5: Build and smoke-test**

Run: `./aos service restart --mode repo` and open Studio via `./aos show create --id studio --url 'aos://sigil/studio/index.html' --interactive --focus --at 200,200,460,720`.
Expected: Studio opens, shows the new shell with Roster tab active. Console (DevTools if available) has no unresolved import errors.

If errors appear, fix imports in `ui.js`. Do not restore any of the deleted modules.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/studio/js/main.js apps/sigil/studio/js/ui.js
git commit -m "refactor(studio): remove 3D preview; main.js is bootstrap only"
```

---

## Task 11: Agent chip component + sync-status wiring

**Files:**
- Create: `apps/sigil/studio/js/chip.js`
- Modify: `apps/sigil/studio/js/ui.js` (wire sync-status updates into `persistAgent`)

Chip shows active agent name + sync status; clicking opens the chip menu (Save as…, Rename, Undo last save, Delete). `persistAgent` emits `sync:saving`/`sync:saved`/`sync:error` events on `document`; chip listens.

- [ ] **Step 1: Write chip.js**

Create `apps/sigil/studio/js/chip.js`:

```javascript
// chip.js — agent chip (identity pill + sync status + menu).
// Sources active-agent state from a small shared module bus so roster.js
// and chip.js stay in sync when the user switches agents.

import { getActiveAgent, onActiveAgentChange, setActiveAgent } from './active-agent.js';
import { openChipMenu } from './chip-menu.js';

export function setupChip() {
  const chip = document.getElementById('agent-chip');
  const nameEl = chip.querySelector('.name');
  const orbEl = chip.querySelector('.orb');
  const syncEl = chip.querySelector('.sync');
  const syncLabel = syncEl.querySelector('.label');

  function render(agent) {
    nameEl.textContent = agent?.name ?? agent?.id ?? '—';
    const [c1, c2] = agent?.appearance?.colors?.face ?? ['#bc13fe', '#4a2b6e'];
    orbEl.style.setProperty('--orb-gradient', `linear-gradient(135deg, ${c1}, ${c2})`);
  }
  render(getActiveAgent());
  onActiveAgentChange(render);

  function setSync(state, label) {
    syncEl.setAttribute('data-state', state);
    syncLabel.textContent = label;
  }
  document.addEventListener('sync:saving', () => setSync('saving', 'Saving…'));
  document.addEventListener('sync:saved',  () => setSync('saved',  'All changes saved'));
  document.addEventListener('sync:error',  (e) => setSync('error',  `Save failed — ${e.detail?.message ?? 'retry'}`));

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openChipMenu(chip);
  });
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChipMenu(chip); }
  });
}
```

- [ ] **Step 2: Write active-agent.js (shared bus)**

Create `apps/sigil/studio/js/active-agent.js`:

```javascript
// active-agent.js — single source of truth for "which agent is Studio editing?"
// Replaces the old ?agent=<id> URL-param-only model. The URL is still updated
// for bookmarking, but in-app state flows through this module.

let current = null;
const listeners = new Set();

export function getActiveAgent() { return current; }

export function setActiveAgent(agent) {
  current = agent;
  if (agent?.id) {
    const url = new URL(window.location);
    url.searchParams.set('agent', agent.id);
    window.history.replaceState({}, '', url);
  }
  listeners.forEach(fn => { try { fn(agent); } catch (e) { console.warn(e); } });
}

export function onActiveAgentChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

- [ ] **Step 3: Write chip-menu.js (stub; wired in next tasks)**

Create `apps/sigil/studio/js/chip-menu.js`:

```javascript
// chip-menu.js — popover menu anchored to the agent chip.
// Menu items emit custom events on document; task-specific handlers live in
// fork-flow.js, rename-flow.js, delete-flow.js, and undo handler in ui.js.

import { getActiveAgent } from './active-agent.js';
import { undoLastSave } from './undo-handler.js';

export function openChipMenu(anchor) {
  const menu = document.getElementById('chip-menu');
  const canUndo = undoLastSave.canUndo(getActiveAgent()?.id);
  menu.innerHTML = `
    <div class="item" data-act="save-as">Save as…</div>
    <div class="item" data-act="rename">Rename</div>
    <div class="item" data-act="undo" ${canUndo ? '' : 'style="opacity:0.4;pointer-events:none"'}>Undo last save</div>
    <div class="sep"></div>
    <div class="item danger" data-act="delete">Delete…</div>
  `;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.hidden = false;

  const onDoc = (e) => {
    if (!menu.contains(e.target)) { closeMenu(); }
  };
  const onClick = (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    closeMenu();
    document.dispatchEvent(new CustomEvent(`chip:${act}`));
  };
  function closeMenu() {
    menu.hidden = true;
    document.removeEventListener('click', onDoc, true);
    menu.removeEventListener('click', onClick);
  }
  setTimeout(() => {
    document.addEventListener('click', onDoc, true);
    menu.addEventListener('click', onClick);
  }, 0);
}
```

Create `apps/sigil/studio/js/undo-handler.js` (placeholder that subsequent tasks flesh out):

```javascript
// undo-handler.js — bridge between chip menu Undo and the undo-buffer.
// Fully wired in Task 14; stub here so chip-menu.js imports resolve.
import { createUndoBuffer } from './undo-buffer.js';

const buffer = createUndoBuffer({ capacity: 20 });

export const undoLastSave = {
  buffer,
  canUndo(agentId) { return !!agentId && buffer.canUndo(agentId); },
};
```

- [ ] **Step 4: Wire `persistAgent` in `ui.js` to emit sync events + record undo snapshots**

In `apps/sigil/studio/js/ui.js`, find `async function persistAgent() {` and wrap it:

```javascript
// ADD at top of ui.js imports:
import { undoLastSave } from './undo-handler.js';
import { snapshotAppearance } from '../../renderer/appearance.js';  // may already be imported
import { getActiveAgent } from './active-agent.js';

// REPLACE the existing persistAgent body with:
async function persistAgent() {
  const activeId = getActiveAgent()?.id ?? activeAgentId;
  document.dispatchEvent(new CustomEvent('sync:saving'));

  // Snapshot previous appearance for undo before mutating.
  const prevAppearance = snapshotAppearance();
  undoLastSave.buffer.record(activeId, prevAppearance);

  let doc;
  try {
    const res = await fetch(`/wiki/sigil/agents/${activeId}.md`);
    doc = res.ok ? await res.text() : initialAgentDoc(activeId);
  } catch { doc = initialAgentDoc(activeId); }

  const appearance = snapshotAppearance();
  const updated = replaceAppearanceInDoc(doc, appearance);

  try {
    const put = await fetch(`/wiki/sigil/agents/${activeId}.md`, {
      method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: updated,
    });
    if (!put.ok) throw new Error(`HTTP ${put.status}`);
    document.dispatchEvent(new CustomEvent('sync:saved'));
  } catch (e) {
    document.dispatchEvent(new CustomEvent('sync:error', { detail: { message: String(e.message ?? e) } }));
  }
}
```

Also: at load time, when Studio seeds from `loadAgent(...)`, call `setActiveAgent({ id: activeAgentId, name: agent.name, appearance: agent.appearance })` so the chip renders something meaningful.

- [ ] **Step 5: Smoke test**

Rebuild, restart daemon, open Studio. Chip shows the active agent name; adjust a slider; chip flashes "Saving…" then "All changes saved." Click chip → menu appears with four items; click elsewhere dismisses.

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/studio/js/chip.js \
        apps/sigil/studio/js/chip-menu.js \
        apps/sigil/studio/js/active-agent.js \
        apps/sigil/studio/js/undo-handler.js \
        apps/sigil/studio/js/ui.js
git commit -m "feat(studio): agent chip + sync status + chip menu scaffold"
```

---

## Task 12: Roster panel rendering

**Files:**
- Create: `apps/sigil/studio/js/roster.js`
- Modify: `apps/sigil/studio/js/ui.js` (nav-rail panel switching respects `panel-roster`)

Roster lists agents via `listAgents()`, renders a tile per agent (name + mini-orb derived from the agent's `appearance.colors.face`), highlights the active one, and trails a `+ new` tile. Clicking a tile switches active agent (load doc → `applyAppearance` → `setActiveAgent`). Tile hover shows a kebab that opens Rename / Clone / Delete via custom events.

- [ ] **Step 1: Write roster.js**

Create `apps/sigil/studio/js/roster.js`:

```javascript
// roster.js — agent tile grid (default Studio view).
// Queries the content-server's wiki directory listing, derives mini-orb
// gradients from each agent's appearance.colors.face, switches active agent
// on tile click. Kebab opens rename/clone/delete actions.

import { listAgents, loadAgentDoc } from './agent-api.js';
import { parseAgentDoc } from '../../renderer/agent-loader.js';
import { applyAppearance } from '../../renderer/appearance.js';
import { getActiveAgent, setActiveAgent, onActiveAgentChange } from './active-agent.js';

function renderTile(agent, active) {
  const tile = document.createElement('div');
  tile.className = 'agent-tile' + (active ? ' active' : '');
  tile.dataset.agentId = agent.id;
  const [c1, c2] = agent?.appearance?.colors?.face ?? ['#bc13fe', '#4a2b6e'];
  tile.innerHTML = `
    <div class="orb" style="--orb-gradient: linear-gradient(135deg, ${c1}, ${c2})"></div>
    <div class="name">${escapeHtml(agent.name ?? agent.id)}</div>
    <div class="status">${active ? 'editing' : 'idle'}</div>
    <div class="kebab" role="button" tabindex="0" aria-label="Actions">⋯</div>
  `;
  tile.addEventListener('click', async (e) => {
    if (e.target.classList.contains('kebab')) return;
    await switchToAgent(agent.id);
  });
  tile.querySelector('.kebab').addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('roster:kebab', { detail: { id: agent.id, anchor: e.target } }));
  });
  return tile;
}

function renderNewTile() {
  const tile = document.createElement('div');
  tile.className = 'agent-tile new';
  tile.innerHTML = `<div class="plus">+</div><div class="name">New agent</div>`;
  tile.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('roster:new'));
  });
  return tile;
}

async function switchToAgent(id) {
  const markdown = await loadAgentDoc(id);
  if (markdown === null) { console.warn('[roster] missing', id); return; }
  const agent = parseAgentDoc(markdown);
  agent.id = id;
  applyAppearance(agent.appearance);
  setActiveAgent(agent);
}

export async function setupRoster() {
  const grid = document.getElementById('roster-grid');
  async function refresh() {
    grid.replaceChildren();
    try {
      const ids = await listAgents();
      const active = getActiveAgent();
      for (const id of ids) {
        const md = await loadAgentDoc(id);
        if (!md) continue;
        const parsed = parseAgentDoc(md);
        parsed.id = id;
        grid.appendChild(renderTile(parsed, id === active?.id));
      }
    } catch (e) {
      console.warn('[roster] refresh failed:', e);
    }
    grid.appendChild(renderNewTile());
  }
  onActiveAgentChange(() => refresh());
  document.addEventListener('roster:refresh', refresh);
  await refresh();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
```

- [ ] **Step 2: Ensure nav-rail switching supports `panel-roster`**

In `apps/sigil/studio/js/ui.js`, find the nav-icon switcher (existing code that toggles `.nav-icon.active` and `.panel.active`). Confirm it works with the new markup — if it hardcodes the panel ids, add `'panel-roster'` to the allow-list. If it reads `data-target`, no change needed.

- [ ] **Step 3: Smoke test**

Rebuild, restart daemon, open Studio. Roster panel shows tiles for every `sigil/agents/*.md` plus `+ new`. Click a non-active tile → active agent switches; Shape panel appears correct for that agent when you navigate to it.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/js/roster.js apps/sigil/studio/js/ui.js
git commit -m "feat(studio): roster panel with agent tiles and active switching"
```

---

## Task 13: Reroll flyout + scope-partitioned randomize wiring

**Files:**
- Create: `apps/sigil/studio/js/reroll.js`
- Modify: `apps/sigil/studio/js/ui.js` (remove any remnants of `btn-randomize` event listener; rename or delete)

Flyout anchored to `#btn-reroll`. Scope chips toggle active scope (state kept in module). Recent strip shows up to 6 mini-orbs (from `seed-history`). Seed pill shows the current seed in word form; pressing Enter on the pill reruns with that seed. Clicking the button (outside the flyout, or with flyout already open) executes the roll with current scope + fresh seed.

- [ ] **Step 1: Write reroll.js**

Create `apps/sigil/studio/js/reroll.js`:

```javascript
// reroll.js — reroll flyout: scope chips, recent strip, seed pill.
// Roll execution goes through randomize.js; history is kept in seed-history.
import { randomizeAll } from './randomize.js';
import { seedToWords, wordsToSeed } from './seed-words.js';
import { createSeedHistory } from './seed-history.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from './ui.js';

const history = createSeedHistory({ capacity: 6 });
let currentScope = 'everything';
let currentSeed = Math.floor(Math.random() * 999999);

function render() {
  const fly = document.getElementById('reroll-flyout');
  const scopes = ['everything', 'shape', 'palette', 'effects'];
  const entries = history.entries();
  fly.innerHTML = `
    <div class="scopes">${scopes.map(s => `
      <div class="scope ${s === currentScope ? 'active' : ''}" data-scope="${s}">${labelOf(s)}</div>
    `).join('')}</div>
    <div class="recent">${entries.map(e => `
      <div class="mini-orb ${e.seed === currentSeed ? 'current' : ''}"
           title="${seedToWords(e.seed)}"
           data-seed="${e.seed}"
           style="background: linear-gradient(135deg, ${hashToHex(e.seed, 0)}, ${hashToHex(e.seed, 1)})"></div>
    `).join('')}</div>
    <div class="seed-row">
      <input class="seed-input" value="${seedToWords(currentSeed)}" spellcheck="false">
    </div>
  `;
  fly.querySelectorAll('.scope').forEach(el => {
    el.addEventListener('click', () => { currentScope = el.dataset.scope; render(); });
  });
  fly.querySelectorAll('.mini-orb').forEach(el => {
    el.addEventListener('click', () => { executeRoll(Number(el.dataset.seed)); });
  });
  const input = fly.querySelector('.seed-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { executeRoll(wordsToSeed(input.value.trim())); }
  });
}

function executeRoll(seed) {
  currentSeed = (seed >>> 0) % 1000000;
  randomizeAll(currentSeed, currentScope, { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos });
  history.push({ seed: currentSeed, scope: currentScope });
  render();
}

function hashToHex(seed, channel) {
  const h = Math.imul(seed + channel * 17, 0x9e3779b1) >>> 0;
  return '#' + (h & 0xffffff).toString(16).padStart(6, '0');
}
function labelOf(s) { return { everything: 'All', shape: 'Shape', palette: 'Palette', effects: 'FX' }[s]; }

export function setupReroll() {
  const btn = document.getElementById('btn-reroll');
  const fly = document.getElementById('reroll-flyout');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!fly.hidden) { executeRoll(Math.floor(Math.random() * 999999)); return; }
    const rect = btn.getBoundingClientRect();
    fly.style.left = `${Math.max(8, rect.right - 280)}px`;
    fly.style.top = `${rect.bottom + 4}px`;
    render();
    fly.hidden = false;
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  });
  function onDoc(e) {
    if (!fly.contains(e.target) && e.target !== btn) {
      fly.hidden = true;
      document.removeEventListener('click', onDoc, true);
    }
  }
}
```

- [ ] **Step 2: Export the needed helpers from ui.js**

In `ui.js`, find `updatePulsars`, `updateGammaRays`, `updateAccretion`, `updateNeutrinos`. Change their declarations from `function updatePulsars(...)` to `export function updatePulsars(...)`, etc. If they currently live inside `setupUI()` as closures, hoist them to module scope and export.

Also remove the old `btn-randomize` click listener (line ~1015) — the new `btn-reroll` in the header replaces it. If `btn-randomize` no longer exists in the DOM, the listener would have errored; confirm it's gone.

- [ ] **Step 3: Smoke test**

Open Studio. Click Reroll ▾ → flyout appears. Click "Shape" chip → chip highlights. Click Reroll ▾ again → a roll executes (only shape params change). Seed pill shows words (e.g., `forest-lion-42`). Replace words, press Enter → same seed can be reproduced. Recent strip populates with mini-orbs.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/js/reroll.js apps/sigil/studio/js/ui.js
git commit -m "feat(studio): reroll flyout with scope chips, seed words, recent strip"
```

---

## Task 14: Fork / Save-as / Clone / Rename / Delete / Undo flows

**Files:**
- Create: `apps/sigil/studio/js/agent-actions.js`
- Modify: `apps/sigil/studio/js/undo-handler.js` (flesh out)
- Modify: `apps/sigil/studio/js/main.js` (wire setup)

All destination-changing actions live here. Each listens for a custom event (`chip:save-as`, `chip:rename`, `chip:delete`, `chip:undo`, `roster:new`, `roster:kebab`) and opens the appropriate modal prompt. Flows:

- **Fork (save-as / + new / clone)** → prompt for id + name → `forkAgent(source, id, name)` → `putAgentDoc(id, doc)` → switch active agent → roster refresh.
- **Rename** → prompt for name → fetch doc, rewrite frontmatter `name:` line, PUT → refresh chip + roster.
- **Delete** → confirm modal → `deleteAgent(id)` → switch to `default` if we just deleted the active → roster refresh.
- **Undo last save** → `undoLastSave.buffer.undo(activeId)` → `applyAppearance(snapshot)` → `persistAgent()` (which records a new undo entry, so the undo is itself reversible by another undo… but the expected user model is "undo once, stop" — that's fine).

- [ ] **Step 1: Write agent-actions.js**

Create `apps/sigil/studio/js/agent-actions.js`:

```javascript
// agent-actions.js — flows that change agent destination (fork/rename/delete/undo).
// Each flow is wired to a custom event emitted by chip-menu or roster.

import { forkAgent } from '../../renderer/agent-fork.js';
import { listAgents, loadAgentDoc, putAgentDoc, deleteAgent } from './agent-api.js';
import { parseAgentDoc } from '../../renderer/agent-loader.js';
import { applyAppearance } from '../../renderer/appearance.js';
import { getActiveAgent, setActiveAgent } from './active-agent.js';
import { undoLastSave } from './undo-handler.js';

// --- Modal prompt helper ---
function prompt({ title, fields, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    const fieldHtml = fields.map(f => `
      <label>${f.label}</label>
      <input data-key="${f.key}" value="${f.value ?? ''}" ${f.pattern ? `pattern="${f.pattern}"` : ''}>
    `).join('');
    host.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        ${fieldHtml}
        <div class="buttons">
          <button data-act="cancel">Cancel</button>
          <button data-act="ok" class="primary ${danger ? 'danger' : ''}">${confirmLabel}</button>
        </div>
      </div>
    `;
    host.hidden = false;
    const firstInput = host.querySelector('input');
    firstInput?.focus();
    firstInput?.select();
    host.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'cancel') { close(null); }
      else if (act === 'ok') {
        const values = {};
        for (const input of host.querySelectorAll('input')) values[input.dataset.key] = input.value.trim();
        close(values);
      }
    });
    function close(result) { host.hidden = true; host.innerHTML = ''; resolve(result); }
  });
}

// --- Fork (save-as / + new / clone) ---
async function doFork(sourceId) {
  const source = sourceId ? await loadAgentDoc(sourceId) : '';
  const result = await prompt({
    title: sourceId ? `Fork "${sourceId}"` : 'Create new agent',
    fields: [
      { key: 'id', label: 'Id (lowercase, no spaces)', value: '', pattern: '[a-z0-9_-]+' },
      { key: 'name', label: 'Display name', value: '' },
    ],
    confirmLabel: 'Create',
  });
  if (!result || !result.id || !result.name) return;
  const existing = await listAgents();
  if (existing.includes(result.id)) {
    alert(`Agent id "${result.id}" already exists.`);
    return;
  }
  const newDoc = forkAgent(source, result.id, result.name);
  await putAgentDoc(result.id, newDoc);
  const parsed = parseAgentDoc(newDoc); parsed.id = result.id;
  applyAppearance(parsed.appearance);
  setActiveAgent(parsed);
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Rename ---
async function doRename(id) {
  const md = await loadAgentDoc(id);
  if (!md) return;
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const currentName = m ? (m[1].match(/^name:\s*(.+)$/m)?.[1] ?? id) : id;
  const result = await prompt({
    title: `Rename "${id}"`,
    fields: [{ key: 'name', label: 'Display name', value: currentName }],
    confirmLabel: 'Rename',
  });
  if (!result || !result.name) return;
  const updated = md.replace(/^name:\s*.+$/m, `name: ${result.name}`);
  await putAgentDoc(id, updated);
  const active = getActiveAgent();
  if (active?.id === id) setActiveAgent({ ...active, name: result.name });
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Delete ---
async function doDelete(id) {
  const confirmed = await prompt({
    title: `Delete "${id}"?`,
    fields: [],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  await deleteAgent(id);
  const active = getActiveAgent();
  if (active?.id === id) {
    // Switch to default (or first remaining)
    const remaining = await listAgents();
    const fallback = remaining.find(x => x === 'default') ?? remaining[0];
    if (fallback) {
      const md = await loadAgentDoc(fallback);
      const parsed = parseAgentDoc(md); parsed.id = fallback;
      applyAppearance(parsed.appearance);
      setActiveAgent(parsed);
    }
  }
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Undo ---
async function doUndo() {
  const id = getActiveAgent()?.id;
  if (!id) return;
  const entry = undoLastSave.buffer.undo(id);
  if (!entry) return;
  applyAppearance(entry.appearance);
  document.dispatchEvent(new CustomEvent('undo:applied'));
  // Autosave picks up via normal slider-change path? No — applyAppearance
  // doesn't dispatch slider events. Trigger an explicit persist.
  document.dispatchEvent(new CustomEvent('persist:request'));
}

// --- Roster kebab menu ---
function openRosterKebab(id, anchor) {
  // Reuse chip-menu popover element
  const menu = document.getElementById('chip-menu');
  menu.innerHTML = `
    <div class="item" data-act="rename">Rename</div>
    <div class="item" data-act="clone">Clone…</div>
    <div class="sep"></div>
    <div class="item danger" data-act="delete">Delete…</div>
  `;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.hidden = false;
  const onClick = async (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    menu.hidden = true;
    menu.removeEventListener('click', onClick);
    if (act === 'rename') doRename(id);
    else if (act === 'clone') doFork(id);
    else if (act === 'delete') doDelete(id);
  };
  const onDoc = (e) => {
    if (!menu.contains(e.target)) {
      menu.hidden = true;
      document.removeEventListener('click', onDoc, true);
      menu.removeEventListener('click', onClick);
    }
  };
  setTimeout(() => {
    menu.addEventListener('click', onClick);
    document.addEventListener('click', onDoc, true);
  }, 0);
}

export function setupAgentActions() {
  document.addEventListener('chip:save-as', () => doFork(getActiveAgent()?.id));
  document.addEventListener('chip:rename', () => doRename(getActiveAgent()?.id));
  document.addEventListener('chip:delete', () => doDelete(getActiveAgent()?.id));
  document.addEventListener('chip:undo', doUndo);
  document.addEventListener('roster:new', () => doFork(null));
  document.addEventListener('roster:kebab', (e) => openRosterKebab(e.detail.id, e.detail.anchor));
}
```

- [ ] **Step 2: Wire `persist:request` event in ui.js**

Add to the ui.js section where `persistAgent` is defined:

```javascript
document.addEventListener('persist:request', () => { persistAgent(); });
```

- [ ] **Step 3: Wire setup in main.js**

Update `apps/sigil/studio/js/main.js`:

```javascript
import { setupUI, setupEditableLabels } from './ui.js';
import { setupChip } from './chip.js';
import { setupRoster } from './roster.js';
import { setupReroll } from './reroll.js';
import { setupAgentActions } from './agent-actions.js';

function init() {
  setupUI();
  setupEditableLabels();
  setupChip();
  setupRoster();
  setupReroll();
  setupAgentActions();
}
window.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 4: Smoke test each flow**

In the live Studio:
- Roster → click "+ new" → prompt appears, type `testfork` / `Test Fork` → tile appears, becomes active.
- Chip menu → Save as… → prompt, type `testsaveas` / `Test Save As` → works.
- Chip menu → Rename → prompt with current name → change → chip + roster tile both update.
- Adjust a slider, then Chip menu → Undo last save → appearance reverts, live avatar reflects.
- Roster tile kebab → Delete → confirm modal → tile disappears; active switches to default if deleted the active.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/js/agent-actions.js \
        apps/sigil/studio/js/undo-handler.js \
        apps/sigil/studio/js/main.js \
        apps/sigil/studio/js/ui.js
git commit -m "feat(studio): fork / rename / delete / undo flows"
```

---

## Task 15: Live-preview on slider `input` events

**Files:**
- Create: `apps/sigil/studio/js/live-preview.js`
- Modify: `apps/sigil/studio/js/ui.js`

Sliders currently fire `applyAppearance` updates directly (via the `setUI`/input handlers already present) and persist only on `change`. Today that already flows through `state` and will be picked up by the in-app canvas — but there is no in-app canvas anymore. We need the `input` events to push the live state to the desktop avatar.

The desktop avatar re-reads the wiki doc only on `wiki_page_changed`, which fires on PUT. For true live preview during drag we need a non-persistent channel. Options:

1. **PUT on every `input` event** — simplest; content server already handles 60+Hz fine for small markdown docs on localhost, and `wiki_page_changed` re-applies cheaply. Downside: lots of unnecessary writes.
2. **`sigil_live_preview` pub/sub message** via the existing daemon channel bus, consumed by the renderer's state bridge. More work (daemon + renderer + Swift) and out of scope (no Swift changes).
3. **Debounced autosave already via `change`** — accept that scrubbing a slider updates the live avatar only when you release. Simplest possible. No new code.

Decision: **#3 for v1** (no change needed beyond deleting the old in-app render-loop expectations). Flag #1 as an option for a follow-up issue if scrub-feel is wanted. The spec's "`input` event live-preview" ambition is deferred.

- [ ] **Step 1: Document the decision in a one-paragraph comment**

Add to `apps/sigil/studio/js/ui.js` near the `persistAgent` definition:

```javascript
// Note: scrub-during-drag live preview was considered (PUT on `input` events
// to hit the desktop avatar via wiki_page_changed). Deferred — the existing
// change-event autosave provides release-to-commit feedback, which is the
// dominant editing gesture. Revisit if scrub-feel becomes a priority; see
// issue filed as follow-on.
```

- [ ] **Step 2: Skip live-preview.js — not needed for v1**

If you created a file, delete it:

```bash
test -f apps/sigil/studio/js/live-preview.js && git rm apps/sigil/studio/js/live-preview.js || true
```

- [ ] **Step 3: File follow-on issue**

```bash
gh issue create --title "Studio: live-preview on slider scrub" \
  --label enhancement \
  --body "Today the desktop avatar updates only on \`change\` (slider release). Scrub-during-drag feedback would require either (a) PUT-on-input (chatty but trivial) or (b) a non-persistent \`sigil_live_preview\` pub/sub channel. Deferred from the Studio UX rework plan."
```

- [ ] **Step 4: Commit the comment**

```bash
git add apps/sigil/studio/js/ui.js
git commit -m "docs(studio): note live-preview deferral; follow-on issue filed"
```

---

## Task 16: Agent panel wiring (identity/home/size)

**Files:**
- Modify: `apps/sigil/studio/js/ui.js`

The Agent panel now holds `agentDisplayName`, `agentHomeAnchor`, `agentHomeNonant`, `agentHomeDisplay`, and the base/min/max size sliders. On agent switch, populate from the loaded doc's `instance`/frontmatter. On change, rewrite the doc's `json` block (not just appearance) and PUT.

- [ ] **Step 1: Add a doc-rewriting helper in ui.js**

Next to `replaceAppearanceInDoc`, add:

```javascript
function replaceJsonBlock(markdown, mutator) {
  const match = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
  let body = match ? JSON.parse(match[1] || '{}') : {
    version: 1, appearance: {}, minds: { skills: [], tools: [], workflows: [] },
    instance: { home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' }, size: 300 },
  };
  body = mutator(body) ?? body;
  const ser = JSON.stringify(body, null, 2);
  if (match) return markdown.replace(match[0], '```json\n' + ser + '\n```');
  return markdown + `\n\`\`\`json\n${ser}\n\`\`\`\n`;
}

async function persistAgentInstance(patch) {
  const id = getActiveAgent()?.id;
  if (!id) return;
  document.dispatchEvent(new CustomEvent('sync:saving'));
  try {
    const res = await fetch(`/wiki/sigil/agents/${id}.md`);
    const doc = res.ok ? await res.text() : initialAgentDoc(id);
    const updated = replaceJsonBlock(doc, (body) => {
      body.instance = { ...(body.instance ?? {}), ...patch };
      return body;
    });
    const put = await fetch(`/wiki/sigil/agents/${id}.md`, {
      method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: updated,
    });
    if (!put.ok) throw new Error(`HTTP ${put.status}`);
    document.dispatchEvent(new CustomEvent('sync:saved'));
  } catch (e) {
    document.dispatchEvent(new CustomEvent('sync:error', { detail: { message: String(e.message ?? e) } }));
  }
}
```

- [ ] **Step 2: Wire the Agent panel inputs**

Inside `setupUI()`:

```javascript
// Agent panel — identity and home
const nameInput = document.getElementById('agentDisplayName');
const anchorSel = document.getElementById('agentHomeAnchor');
const nonantSel = document.getElementById('agentHomeNonant');
const displaySel = document.getElementById('agentHomeDisplay');

function hydrateAgentPanel(agent) {
  if (!agent) return;
  if (nameInput) nameInput.value = agent.name ?? agent.id ?? '';
  const home = agent.instance?.home ?? {};
  if (anchorSel) anchorSel.value = home.anchor ?? 'nonant';
  if (nonantSel) nonantSel.value = home.nonant ?? 'bottom-right';
  if (displaySel) displaySel.value = home.display ?? 'main';
}
onActiveAgentChange(hydrateAgentPanel);

nameInput?.addEventListener('change', (e) => {
  // Name rewrites frontmatter, not json body — reuse rename flow
  document.dispatchEvent(new CustomEvent('chip:rename-inline', { detail: { name: e.target.value } }));
});
[anchorSel, nonantSel, displaySel].forEach(el => el?.addEventListener('change', () => {
  persistAgentInstance({
    home: { anchor: anchorSel.value, nonant: nonantSel.value, display: displaySel.value },
  });
}));

// base/min/max sliders persist into instance.size (base) and into ephemeral state
// for min/max — Sigil-1 schema only has `size`; min/max are deferred.
document.getElementById('baseSizeSlider')?.addEventListener('change', (e) => {
  persistAgentInstance({ size: parseInt(e.target.value, 10) });
});
```

Also add a handler for the `chip:rename-inline` event in agent-actions.js that just calls `doRename` with the new name pre-supplied (or add an overload).

- [ ] **Step 3: Smoke test**

Switch agents in the roster; Agent panel reflects identity and home. Change nonant → sync indicator flashes Saving → Saved. Reload Studio → values persist.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/studio/js/ui.js apps/sigil/studio/js/agent-actions.js
git commit -m "feat(studio): agent panel wires identity/home to wiki"
```

---

## Task 17: Cleanup — css, orphaned rules, docs

**Files:**
- Modify: `apps/sigil/studio/css/sidebar.css`, `context-menu.css`, `base.css`
- Modify: `apps/sigil/CLAUDE.md`

Remove selectors that reference DOM elements no longer present (`#sidebar-title-wrapper`, `#ctx-object`, `#ctx-particle`, `.camera-*`, etc.). Update `apps/sigil/CLAUDE.md` to reflect the new architecture: Studio is stageless, preview is the desktop avatar, agent lifecycle lives in Studio.

- [ ] **Step 1: Strip unused selectors**

Run: `rg -n 'sidebar-title-wrapper|ctx-object|ctx-particle|ctx-aura|ctx-phenom|camera-' apps/sigil/studio/css/` — each hit is a candidate for removal. For each, confirm the DOM id/class truly no longer exists (`rg -n "<id>|class=\"<cls>\"" apps/sigil/studio/index.html`), then delete the rule.

- [ ] **Step 2: Update `apps/sigil/CLAUDE.md`**

Edit the "Canvas Model" and "Architecture" sections to reflect: Studio no longer runs a preview renderer; legacy `avatar.html` has been removed; Studio is opened as an interactive canvas at ~460px and acts on agents via the wiki content server.

- [ ] **Step 3: Final smoke pass**

With the daemon restarted and Studio opened:
- Shape / Colors / Effects / Agent panels all edit their respective fields and save.
- Roster shows every agent; active agent has purple glow.
- `+ new`, Save as, Clone, Rename, Delete, Undo all work.
- Reroll flyout: scope chips, recent strip, seed input all work.
- Sync indicator transitions on save/error.
- Live desktop avatar re-applies appearance after slider releases.

- [ ] **Step 4: Run full test suite**

```bash
node --test tests/studio/*.test.mjs
bash tests/content/wiki-list.test.sh
```

All should pass.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/studio/css/*.css apps/sigil/CLAUDE.md
git commit -m "chore(studio): cleanup orphan CSS; update CLAUDE.md for stageless Studio"
```

---

## Self-Review Summary

- **Spec coverage:** every summary bullet (1–4), every section of UI Design (window/header/nav/roster/reroll/undo/live-preview), every Files-Touched line has a corresponding task. Live-preview on `input` was deferred to a follow-on issue (Task 15) — documented and filed.
- **Placeholder scan:** all code steps contain real code; no "TBD"; no "similar to Task N" shortcuts.
- **Type consistency:** `createUndoBuffer` / `undoLastSave.buffer.record` / `undoLastSave.canUndo` names match across tasks; `randomizeAll(seed, scope, deps)` signature is consistent; `setActiveAgent` / `getActiveAgent` / `onActiveAgentChange` match across chip, roster, and agent-actions modules; `agent-api.js` function names (`listAgents`, `loadAgentDoc`, `putAgentDoc`, `deleteAgent`) match call sites.
- **One known spec deviation:** Swift change in Task 1. Justified in the "Spec Deviation" section at the top.
- **One documented live-preview deferral:** Task 15 files a follow-on issue.
