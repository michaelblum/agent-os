# Sigil Foundation — Agent Documents & Global Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sigil's minimal `avatar-config.json` with per-agent wiki documents, migrate to a single global canvas spanning all displays, hard-code idle=parked, and wire live reload via the AOS wiki change channel.

**Architecture:** Agent is a markdown page under `sigil/agents/` in the wiki. Renderer fetches one such page at boot, applies its appearance blob to a state-source-of-truth model, spawns the avatar at the resolved home position within a union-of-displays canvas, and listens for `wiki_page_changed` to live-reload. Studio persists edits by writing the full agent doc back through the AOS wiki write API.

**Tech Stack:** Vanilla JS / Three.js renderer (`apps/sigil/renderer/`), Swift daemon for launch helpers, existing AOS wiki + display_geometry + input_event channels.

**Spec:** `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md`

**Depends on:** `docs/superpowers/plans/2026-04-12-aos-wiki-writes-and-namespaces.md` — Tasks 4 and 6 must land before this plan's Task 4. Task 3 + 5 of AOS plan must land before this plan's Task 10.

---

### Task 1: State-as-source-of-truth refactor

**Files:**
- Modify: `apps/sigil/renderer/state.js`
- Modify: `apps/sigil/renderer/presets.js` (`applyPreset` becomes `applyAppearance(blob)` that writes state; UI wiring stays in Studio)
- Modify: `apps/sigil/studio/js/ui.js` (UI controls now also go through a state-setter, not just DOM events)
- Modify: any module that currently reads state from DOM — consume state directly instead (colors.js, aura.js, phenomena.js, skins.js, omega.js, lightning.js, magnetic.js)
- Test: `apps/sigil/tests/appearance-roundtrip.html` (browser-runnable)

**Context:** Today `applyPreset` sets DOM input values and dispatches `input`/`change` events; Studio control listeners then update state and re-render. Live mode has no Studio DOM, so this doesn't work headlessly. Refactor so state is the source of truth, and both Studio UI and a new `applyAppearance(blob)` funnel into it.

- [ ] **Step 1: Write the roundtrip test page**

```html
<!-- apps/sigil/tests/appearance-roundtrip.html -->
<!DOCTYPE html>
<script type="module">
import state from '../renderer/state.js';
import { applyAppearance, snapshotAppearance } from '../renderer/appearance.js';

const fixture = {
  shape: 6, opacity: 0.25, edgeOpacity: 1.0,
  maskEnabled: true, interiorEdges: true, specular: true,
  aura: { enabled: true, reach: 1.0, intensity: 1.0, pulseRate: 0.005 },
  colors: { face: ['#bc13fe', '#4a2b6e'], edge: ['#bc13fe', '#4a2b6e'] },
  // … full default blob
};

applyAppearance(fixture);
const snap = snapshotAppearance();
const ok = JSON.stringify(snap) === JSON.stringify(fixture);
document.title = ok ? 'PASS' : 'FAIL';
document.body.innerText = ok ? 'PASS' : `FAIL\n${JSON.stringify(snap,null,2)}`;
</script>
```

- [ ] **Step 2: Run, confirm fail**

Open via `./aos show create --id rt-test --url aos://sigil/tests/appearance-roundtrip.html --at 100,100,400,400` — title will read "FAIL" because `appearance.js` doesn't exist.

- [ ] **Step 3: Create `apps/sigil/renderer/appearance.js`**

```js
import state from './state.js';
import { updateAllColors } from './colors.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from './phenomena.js';
// … other module imports as needed

/**
 * Apply a full appearance blob to state + trigger scene updates.
 * Blob shape = the JSON stored inside sigil/agents/<id>.md.
 */
export function applyAppearance(blob) {
  // Shape / geometry
  state.shape = blob.shape;
  state.stellation = blob.stellation ?? 0;
  state.opacity = blob.opacity;
  state.edgeOpacity = blob.edgeOpacity;
  state.maskEnabled = blob.maskEnabled;
  state.interiorEdges = blob.interiorEdges;
  state.specular = blob.specular;

  // Aura
  state.auraEnabled = blob.aura?.enabled ?? false;
  state.auraReach = blob.aura?.reach ?? 1.0;
  state.auraIntensity = blob.aura?.intensity ?? 1.0;
  state.auraPulseRate = blob.aura?.pulseRate ?? 0.005;

  // Colors (all pairs)
  state.colors = structuredClone(blob.colors ?? {});
  updateAllColors();

  // Phenomena toggles + counts
  state.pulsarEnabled = blob.phenomena?.pulsar?.enabled ?? false;
  state.pulsarRayCount = blob.phenomena?.pulsar?.count ?? 1;
  updatePulsars(state.pulsarRayCount);
  // … repeat for gamma, accretion, neutrino

  // Trails / omega / skins / grid / etc. — mirror every field
  // Omitted here for brevity; the engineer implements the exhaustive mapping
  // by walking Studio's current UI field inventory (presets.js is the reference).

  // Notify scene of changes
  state._onAppearanceChanged?.();
}

export function snapshotAppearance() {
  return {
    shape: state.shape,
    stellation: state.stellation,
    opacity: state.opacity,
    edgeOpacity: state.edgeOpacity,
    maskEnabled: state.maskEnabled,
    interiorEdges: state.interiorEdges,
    specular: state.specular,
    aura: { enabled: state.auraEnabled, reach: state.auraReach,
            intensity: state.auraIntensity, pulseRate: state.auraPulseRate },
    colors: structuredClone(state.colors),
    phenomena: {
      pulsar: { enabled: state.pulsarEnabled, count: state.pulsarRayCount },
      // … gamma, accretion, neutrino
    },
    // … full inventory
  };
}
```

**Implementer note:** the "full inventory" is every UI control currently defined in `studio/index.html` + every field currently set by `presets.js`. Walk both files and enumerate. Missing fields cause a silent drift bug; comprehensive mapping is required.

- [ ] **Step 4: Rewrite Studio UI listeners to update state**

In `studio/js/ui.js`, every control listener today does `state.x = value; render()`. Keep that pattern. On load, Studio now calls `applyAppearance(loadedBlob)` once, then the UI reflects state (two-way: UI writes state on input, Studio renders state on applyAppearance by reading state → setting DOM values in a separate `syncUIFromState()` pass).

```js
// Studio init
import { applyAppearance, snapshotAppearance } from '../../renderer/appearance.js';
// Load default blob from /_state/avatar-config.json OR hard-coded default.
applyAppearance(DEFAULT_APPEARANCE);
syncUIFromState();
```

`syncUIFromState()` reads `state.*` and populates DOM input values — new helper, stubbed per control. (Code omitted; mirrors `applyAppearance` in reverse, for DOM update only.)

- [ ] **Step 5: Verify no regressions in Studio**

Manual: launch Studio (`./aos show create --id studio --url aos://sigil/studio/index.html --at 0,0,1512,982`), click through a few presets, confirm visual output is identical to pre-refactor.

- [ ] **Step 6: Run roundtrip test**

```bash
./aos show create --id rt-test --url aos://sigil/tests/appearance-roundtrip.html --at 100,100,400,400
# Check window title === "PASS"
./aos show remove --id rt-test
```

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/renderer/appearance.js apps/sigil/renderer/state.js \
        apps/sigil/renderer/presets.js apps/sigil/studio/js/ui.js \
        apps/sigil/tests/appearance-roundtrip.html \
        # any other modified renderer modules
git commit -m "refactor(sigil): state-as-source-of-truth + applyAppearance / snapshotAppearance"
```

---

### Task 2: Agent document loader

**Files:**
- Create: `apps/sigil/renderer/agent-loader.js`
- Create: `apps/sigil/tests/agent-loader-test.html`

- [ ] **Step 1: Write loader test**

```html
<!-- apps/sigil/tests/agent-loader-test.html -->
<!DOCTYPE html>
<script type="module">
import { parseAgentDoc, loadAgent, MINIMAL_DEFAULT } from '../renderer/agent-loader.js';

const sample = `---
type: agent
id: default
name: Default
tags: [sigil]
---

Prose here.

\`\`\`json
{"appearance":{"shape":6},"minds":{"skills":[]},"instance":{"home":{"anchor":"nonant","nonant":"bottom-right","display":"main"},"size":300}}
\`\`\`
`;

const parsed = parseAgentDoc(sample);
const ok = parsed.id === 'default'
        && parsed.appearance.shape === 6
        && parsed.instance.size === 300;

// Malformed fallback
const fallback = parseAgentDoc('not markdown no json');
const ok2 = fallback.appearance === MINIMAL_DEFAULT.appearance;

document.title = (ok && ok2) ? 'PASS' : 'FAIL';
</script>
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement loader**

```js
// apps/sigil/renderer/agent-loader.js
export const MINIMAL_DEFAULT = Object.freeze({
  id: 'default',
  name: 'Default',
  appearance: { shape: 6, opacity: 0.25, edgeOpacity: 1.0,
                maskEnabled: true, interiorEdges: true, specular: true,
                aura: { enabled: true, reach: 1.0, intensity: 1.0, pulseRate: 0.005 },
                colors: { face: ['#bc13fe','#4a2b6e'], edge: ['#bc13fe','#4a2b6e'] } },
  minds: { skills: [], tools: [], workflows: [] },
  instance: { home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' }, size: 300 }
});

export function parseAgentDoc(markdown) {
  try {
    const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = fmMatch ? parseYAMLFrontmatter(fmMatch[1]) : {};
    const jsonMatch = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) throw new Error('no json block');
    const body = JSON.parse(jsonMatch[1]);
    return {
      id: frontmatter.id ?? MINIMAL_DEFAULT.id,
      name: frontmatter.name ?? MINIMAL_DEFAULT.name,
      tags: frontmatter.tags ?? [],
      appearance: body.appearance ?? MINIMAL_DEFAULT.appearance,
      minds: body.minds ?? MINIMAL_DEFAULT.minds,
      instance: body.instance ?? MINIMAL_DEFAULT.instance,
    };
  } catch (e) {
    console.warn('[agent-loader] falling back to minimal default:', e);
    return { ...MINIMAL_DEFAULT };
  }
}

function parseYAMLFrontmatter(src) {
  // Minimal: key: value; lists in [a, b, c] form. Good enough for our frontmatter needs.
  const out = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1,-1).split(',').map(s => s.trim()).filter(Boolean);
    }
    out[m[1]] = v;
  }
  return out;
}

export async function loadAgent(wikiPath) {
  try {
    const res = await fetch(`aos://wiki/${wikiPath}.md`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseAgentDoc(text);
  } catch (e) {
    console.warn('[agent-loader] fetch failed, falling back:', e);
    return { ...MINIMAL_DEFAULT };
  }
}
```

**Implementer note:** verify the correct content-server URL scheme. `aos://wiki/` may actually be `aos://_wiki/` or similar — grep `content-server` for the mount root.

- [ ] **Step 4: Run test**

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/agent-loader.js apps/sigil/tests/agent-loader-test.html
git commit -m "feat(sigil): agent document loader with frontmatter + json-block parser"
```

---

### Task 3: Home position resolver

**Files:**
- Create: `apps/sigil/renderer/home-resolver.js`
- Create: `apps/sigil/tests/home-resolver-test.html`

- [ ] **Step 1: Write resolver test**

```html
<script type="module">
import { resolveHome } from '../renderer/home-resolver.js';

const displays = [
  { uuid: 'A', is_main: true, visible_bounds: { x: 0, y: 25, w: 1512, h: 957 } },
  { uuid: 'B', is_main: false, visible_bounds: { x: 1512, y: 0, w: 1920, h: 1080 } },
];

// nonant bottom-right of main
let p = resolveHome({ anchor: 'nonant', nonant: 'bottom-right', display: 'main' }, displays);
const ok1 = Math.round(p.x) === Math.round(0 + 1512*5/6) && Math.round(p.y) === Math.round(25 + 957*5/6);

// coords
p = resolveHome({ anchor: 'coords', coords: { x: 400, y: 200 } }, displays);
const ok2 = p.x === 400 && p.y === 200;

// bogus display UUID -> fallback to main bottom-right
p = resolveHome({ anchor: 'nonant', nonant: 'top-left', display: 'NOT-REAL' }, displays);
const ok3 = Math.round(p.x) === Math.round(1512/6) && Math.round(p.y) === Math.round(25 + 957/6);

document.title = (ok1 && ok2 && ok3) ? 'PASS' : `FAIL ${ok1} ${ok2} ${ok3}`;
</script>
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement resolver**

```js
// apps/sigil/renderer/home-resolver.js
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

export function resolveHome(home, displays) {
  const mainDisplay = displays.find(d => d.is_main) ?? displays[0];
  if (!mainDisplay) return { x: 0, y: 0 };

  if (home.anchor === 'coords' && home.coords) {
    return { x: home.coords.x, y: home.coords.y };
  }

  // Anchor to display — resolve by UUID or 'main'
  const target = home.display === 'main'
    ? mainDisplay
    : (displays.find(d => d.uuid === home.display) ?? mainDisplay);

  const vb = target.visible_bounds;
  const cell = NONANT_CELLS[home.nonant ?? 'bottom-right'] ?? NONANT_CELLS['bottom-right'];
  return { x: vb.x + vb.w * cell[0], y: vb.y + vb.h * cell[1] };
}
```

- [ ] **Step 4: Run, commit**

```bash
git add apps/sigil/renderer/home-resolver.js apps/sigil/tests/home-resolver-test.html
git commit -m "feat(sigil): home position resolver (nonant/coords + display fallback)"
```

---

### Task 4: Sigil seed step

**Files:**
- Create: `apps/sigil/seed/wiki/sigil/agents/default.md`
- Create: `apps/sigil/sigilctl-seed.sh` (or fold into existing `sigilctl` if present)

**Dependency:** AOS plan Task 6 (`aos wiki seed` subcommand exists).

- [ ] **Step 1: Write the seed file**

```markdown
---
type: agent
id: default
name: Default
tags: [sigil, orchestrator]
---

The default Sigil agent. Purple polyhedron, parked in the bottom-right
of the main display at boot.

```json
{
  "version": 1,
  "appearance": {
    "shape": 6,
    "stellation": 0,
    "opacity": 0.25,
    "edgeOpacity": 1.0,
    "maskEnabled": true,
    "interiorEdges": true,
    "specular": true,
    "aura": { "enabled": true, "reach": 1.0, "intensity": 1.0, "pulseRate": 0.005 },
    "colors": {
      "face": ["#bc13fe", "#4a2b6e"],
      "edge": ["#bc13fe", "#4a2b6e"],
      "aura": ["#bc13fe", "#2a1b3d"]
    },
    "phenomena": {
      "pulsar":    { "enabled": false, "count": 1 },
      "gamma":     { "enabled": false, "count": 1 },
      "accretion": { "enabled": false, "count": 1 },
      "neutrino":  { "enabled": false, "count": 1 }
    },
    "trails": { "enabled": true, "count": 6, "opacity": 0.5, "fadeMs": 400, "style": "omega" }
  },
  "minds": { "skills": [], "tools": [], "workflows": [] },
  "instance": {
    "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
    "size": 300
  }
}
```
```

- [ ] **Step 2: Add seed invocation to Sigil startup**

If Sigil has its own entry-point script (e.g. sigilctl), add:

```bash
./aos wiki seed --namespace sigil --file "agents/default.md:apps/sigil/seed/wiki/sigil/agents/default.md"
```

If Sigil launches by operator running `aos show create`, document the seed step in `apps/sigil/CLAUDE.md` and make it a precondition in the launch command wrapper.

- [ ] **Step 3: Verify**

```bash
rm -rf ~/.config/aos/repo/wiki/sigil/agents
<seed invocation>
test -f ~/.config/aos/repo/wiki/sigil/agents/default.md || exit 1
```

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/seed/wiki/sigil/agents/default.md apps/sigil/sigilctl-seed.sh apps/sigil/CLAUDE.md
git commit -m "feat(sigil): default agent seed + wiki seed invocation"
```

---

### Task 5: Global canvas bounds helper

**Files:**
- Create: `src/commands/runtime.swift` modification (or new file under `src/commands/`)
- Modify: `src/main.swift` to register `runtime display-union` subcommand

- [ ] **Step 1: Write test**

```bash
# tests/runtime-display-union.sh
OUT=$(./aos runtime display-union)
# Format: x,y,w,h (integers, comma-separated)
echo "$OUT" | grep -qE '^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$' || { echo "FAIL: $OUT"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Implement**

```swift
// In runtime.swift command module
func runtimeDisplayUnion() -> String {
    let displays = NSScreen.screens  // or existing display-geometry snapshot helper
    guard !displays.isEmpty else { return "0,0,0,0" }
    var minX = Int.max, minY = Int.max, maxX = Int.min, maxY = Int.min
    for s in displays {
        let f = s.frame
        minX = min(minX, Int(f.minX)); minY = min(minY, Int(f.minY))
        maxX = max(maxX, Int(f.maxX)); maxY = max(maxY, Int(f.maxY))
    }
    return "\(minX),\(minY),\(maxX-minX),\(maxY-minY)"
}
```

Prefer reusing the existing display-geometry snapshot helper rather than re-walking `NSScreen.screens` — the helper already normalizes coordinates the renderer expects.

- [ ] **Step 3: Commit**

```bash
git add src/commands/runtime.swift src/main.swift tests/runtime-display-union.sh
git commit -m "feat(runtime): display-union subcommand for global canvas bounds"
```

---

### Task 6: Renderer live-js boot with agent loader

**Files:**
- Modify: `apps/sigil/renderer/index.html` (or the live-js boot module, likely `renderer/live-modules/main.js`)

- [ ] **Step 1: Plumb ?agent= param + loader**

```js
// Near existing live-js bootstrap
import { loadAgent } from '../agent-loader.js';
import { applyAppearance } from '../appearance.js';
import { resolveHome } from '../home-resolver.js';

const params = new URLSearchParams(location.search);
const agentPath = params.get('agent') ?? 'sigil/agents/default';
const currentAgentId = agentPath.split('/').pop();  // e.g. 'default'

const agent = await loadAgent(agentPath);
applyAppearance(agent.appearance);

// Wait for display_geometry snapshot before computing home
const displays = await awaitFirstDisplayGeometry();
const home = resolveHome(agent.instance.home, displays);
liveJs.avatarPos = { x: home.x, y: home.y };
liveJs.avatarSize = agent.instance.size;
liveJs.currentAgentId = currentAgentId;
```

`awaitFirstDisplayGeometry()` is a promise wrapper around the existing subscription — returns the first broadcast payload.

- [ ] **Step 2: Manual verification**

```bash
./aos wiki seed --namespace sigil --file "agents/default.md:apps/sigil/seed/wiki/sigil/agents/default.md"
./aos show create --id avatar-main \
  --url "aos://sigil/renderer/index.html?mode=live-js&agent=sigil/agents/default" \
  --at $(./aos runtime display-union)
```

Expected: avatar renders at bottom-right nonant of main display at size 300.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js apps/sigil/renderer/index.html
git commit -m "feat(sigil): live-js boot loads agent doc + resolves home position"
```

---

### Task 7: Idle=parked state machine

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js` (wherever the Sigil-1 state machine `smIdle*` / cursor tracking lives)

- [ ] **Step 1: Delete cursor-follow in IDLE**

Find the IDLE branch that updates `liveJs.avatarPos` from `currentCursor`. Remove that write. `currentCursor` continues to update in the background.

Before:
```js
case 'IDLE':
  liveJs.avatarPos.x += (currentCursor.x - liveJs.avatarPos.x) * FOLLOW_ALPHA;
  liveJs.avatarPos.y += (currentCursor.y - liveJs.avatarPos.y) * FOLLOW_ALPHA;
  break;
```

After:
```js
case 'IDLE':
  // Parked: avatarPos is not modified. currentCursor tracks for GOTO-click math.
  break;
```

- [ ] **Step 2: Verify**

Launch avatar (Task 6 command). Move cursor — orb does not move. Click orb — GOTO ring appears at orb position. Click elsewhere — orb fast-travels to click.

- [ ] **Step 3: Annotate superseded spec**

Add to top of `docs/superpowers/specs/2026-04-12-sigil-1-state-machine.md`:

```markdown
> **Superseded 2026-04-12:** Acceptance criterion #2 (idle cursor-follow) was the wrong default. See `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md` for the parked-idle model that replaces it.
```

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js docs/superpowers/specs/2026-04-12-sigil-1-state-machine.md
git commit -m "feat(sigil): idle=parked — remove cursor-follow in IDLE (resolves #25)"
```

---

### Task 8: Global canvas clamp on display changes

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js` (existing display_geometry handler)

- [ ] **Step 1: Add union-change handling**

On each `display_geometry` rebroadcast:

```js
function onDisplayGeometry(payload) {
  const union = computeUnion(payload.displays);
  liveJs.globalBounds = union;
  // Clamp if avatar now outside
  if (liveJs.avatarPos.x < union.minX || liveJs.avatarPos.x > union.maxX ||
      liveJs.avatarPos.y < union.minY || liveJs.avatarPos.y > union.maxY) {
    liveJs.avatarPos.x = Math.max(union.minX, Math.min(union.maxX, liveJs.avatarPos.x));
    liveJs.avatarPos.y = Math.max(union.minY, Math.min(union.maxY, liveJs.avatarPos.y));
  }
  // Canvas resize itself is deferred — if the topology material-changed,
  // log a hint that operator may want to restart the avatar.
  if (unionSize(union) !== unionSize(liveJs.globalBoundsAtBoot)) {
    console.info('[sigil] global bounds changed since boot; restart avatar for full canvas coverage');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js
git commit -m "feat(sigil): clamp avatar to union-of-displays on topology change"
```

---

### Task 9: Live reload on wiki_page_changed

**Files:**
- Modify: live-js boot module

**Depends on:** AOS plan Task 4.

- [ ] **Step 1: Subscribe + filter**

```js
subscribe('wiki_page_changed', async (payload) => {
  const expected = `sigil/agents/${liveJs.currentAgentId}.md`;
  if (payload.path !== expected) return;
  liveJs.pendingReload = true;
  if (liveJs.state === 'IDLE') flushReload();
});

async function flushReload() {
  if (!liveJs.pendingReload) return;
  liveJs.pendingReload = false;
  const agent = await loadAgent(`sigil/agents/${liveJs.currentAgentId}`);
  applyAppearance(agent.appearance);
  liveJs.avatarSize = agent.instance.size;
  // Note: home NOT re-resolved. Home applies only at spawn.
}
```

Also call `flushReload()` at every state transition into IDLE (e.g. at the end of fast-travel, drag release that returns to IDLE, goto-cancel).

- [ ] **Step 2: Manual test**

Launch avatar. Hand-edit `~/.config/aos/repo/wiki/sigil/agents/default.md` — change a face color. Save. Observe avatar color change within ~1 second while cursor is still.

Start a fast-travel, edit during it, verify color changes only after travel completes.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js
git commit -m "feat(sigil): live reload avatar on wiki_page_changed (resolves #20)"
```

---

### Task 10: Studio persistence through wiki write API

**Files:**
- Modify: `apps/sigil/studio/js/ui.js`

**Depends on:** AOS plan Tasks 3 + 5 (PUT endpoint + event fires).

- [ ] **Step 1: Rewrite save**

Replace the existing `persistConfig` block (ui.js around line 707) with:

```js
const params = new URLSearchParams(location.search);
const activeAgentId = params.get('agent') ?? 'default';
const AGENT_PATH = `sigil/agents/${activeAgentId}.md`;

async function persistAgent() {
  // Fetch current doc to preserve frontmatter, prose, minds, instance
  let doc;
  try {
    const res = await fetch(`aos://wiki/${AGENT_PATH}`);
    doc = await res.text();
  } catch (e) {
    console.warn('[studio] no existing agent doc; writing fresh');
    doc = initialAgentDoc(activeAgentId);
  }

  const appearance = snapshotAppearance();
  const updated = replaceAppearanceInDoc(doc, appearance);

  const put = await fetch(`/wiki/${AGENT_PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: updated,
  });
  if (!put.ok) {
    showStudioError(`save failed: HTTP ${put.status}`);
    return;
  }
}

function replaceAppearanceInDoc(markdown, appearance) {
  // Find ```json ... ``` block, parse, replace .appearance, reserialize.
  const match = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) {
    // Append a fresh block
    const body = JSON.stringify({ appearance, minds: { skills:[], tools:[], workflows:[] },
      instance: { home: { anchor:'nonant', nonant:'bottom-right', display:'main' }, size: 300 }},
      null, 2);
    return markdown + `\n\`\`\`json\n${body}\n\`\`\`\n`;
  }
  const parsed = JSON.parse(match[1]);
  parsed.appearance = appearance;
  const newBlock = JSON.stringify(parsed, null, 2);
  return markdown.replace(match[0], '```json\n' + newBlock + '\n```');
}
```

Bind to the existing Studio save button. Keep the existing debounce / throttle if present.

- [ ] **Step 2: Round-trip test**

1. Launch Studio with `?agent=default`.
2. Change a slider, click save.
3. Read `~/.config/aos/repo/wiki/sigil/agents/default.md` — JSON block reflects new value.
4. If avatar is running, confirm it live-reloads (Task 9's hookup).

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/studio/js/ui.js
git commit -m "feat(sigil): Studio save persists full agent doc via wiki PUT (resolves #28, completes #20/#26)"
```

---

### Task 11: Acceptance sweep

**Files:** `apps/sigil/tests/foundation-acceptance.md` (checklist doc)

- [ ] **Step 1: Walk spec acceptance criteria 1-12**

Each criterion gets a manual QA line. Screenshot where visual. Examples:

```markdown
- [ ] 1. Default seed materializes. Delete wiki/sigil/agents, restart Sigil, file exists.
- [ ] 2. Launch spawns orb at home. Screenshot shows orb at bottom-right nonant.
- [ ] 3. Idle parked. Cursor moves, orb doesn't. Screenshot pair.
- [ ] 4. Click-goto still works. Screenshot ring + post-travel.
- [ ] 5. Trails honor config. Edit count=12, fast-travel, count trail segments.
- [ ] 6. Global canvas crosses displays. Requires second physical display.
- [ ] 7. Live reload on wiki edit.
- [ ] 8. Live reload deferred mid-gesture.
- [ ] 9. Studio save roundtrip.
- [ ] 10. Home off-screen fallback.
- [ ] 11. Cascade cleanup.
- [ ] 12. Sigil-1 spec annotation present.
```

- [ ] **Step 2: Execute and record**

Each box checked implies a passing verification. Screenshot paths logged in the doc.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/tests/foundation-acceptance.md
git commit -m "test(sigil): foundation acceptance — all 12 criteria verified"
```

---

## Completion

Sigil foundation shipped. Sigil-2 (menu slices, beam, stellation, breathing menu) can start on top. Studio UX rework (save-as, roster, clone, random-variant flyout) is a follow-on spec.
