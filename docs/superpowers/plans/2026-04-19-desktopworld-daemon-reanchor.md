# DesktopWorld Daemon/API Re-anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every remaining daemon-facing spatial contract — JSON schema, `display_geometry` payload, `aos runtime display-union`, toolkit alias seams, and downstream consumers — from native-main-display-anchored coordinates onto the canonical **DesktopWorld** frame, with the CLI default shape treated as an explicit migration decision rather than a predetermined outcome.

**Architecture:** The toolkit JS runtime (`packages/toolkit/runtime/spatial.js`) already re-anchors native payloads into DesktopWorld inside `normalizeDisplays`. Two Swift producers still emit only native-compat values — the `aos see list` topology producer (`buildSpatialTopology()` in `src/perceive/capture-pipeline.swift`, governed by `shared/schemas/spatial-topology.schema.json`) and the narrower `display_geometry` channel (`snapshotDisplayGeometry()` in `src/display/display-geometry.swift`, a displays-only subset). Every consumer re-derives the shift. This plan re-anchors both producers to emit DesktopWorld-anchored fields **alongside** the native-compat fields, promotes DesktopWorld in the schema, forces toolkit callers to choose `computeDesktopWorldBounds` vs `computeVisibleDesktopWorldBounds` explicitly, and routes the `aos runtime display-union` default through a structured decision memo before implementation. Additive-first, deprecate-second — no consumer breaks in Phase 1–2.

**Producer / contract split (read before editing):**

| Surface | Schema | Producer | Scope |
| --- | --- | --- | --- |
| `aos see list` (full topology) | `shared/schemas/spatial-topology.schema.json` + `shared/schemas/spatial-topology.md` | `buildSpatialTopology()` in `src/perceive/capture-pipeline.swift:1425-1583`, backed by `STDisplay` / `STCursor` in `src/perceive/models.swift:92-158` | Displays + windows + apps + cursor. Canonical topology snapshot. **Owns cursor DesktopWorld coordinates.** |
| `display_geometry` channel | `shared/schemas/daemon-event.md` for envelope; `shared/schemas/spatial-topology.md` for the displays subset | `snapshotDisplayGeometry()` in `src/display/display-geometry.swift` + emitters in `src/daemon/unified.swift:1782` | Displays-only subset for subscribers who need live geometry updates. **No cursor field — stays that way.** |

**Cursor ownership decision:** DesktopWorld cursor coordinates live on the topology schema / `aos see list` producer only. The `display_geometry` channel does not currently carry a cursor field and this plan does not add one. Live-cursor consumers (Sigil, canvas-inspector, spatial-telemetry) already re-anchor `input_event` messages via `nativeToDesktopWorldPoint` in `packages/toolkit/runtime/spatial.js`; that path stays unchanged. A single batch-time DesktopWorld cursor read is available via `aos see list --json`.

**Tech Stack:** Swift 5.9+ (daemon, CLI), vanilla JS ES modules (toolkit, Sigil renderer), JSON Schema Draft 2020-12, `aos` unified binary, `node --test` (toolkit tests), `bash` (integration tests).

**Spec / authority:**
- `shared/schemas/spatial-topology.md`
- `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md`
- `docs/superpowers/plans/2026-04-19-desktopworld-planning-session-brief.md`
- `ARCHITECTURE.md` (Union Canvas Contract section)

---

## Scope

**In scope:**
- JSON schema at `shared/schemas/spatial-topology.schema.json` (owns the `aos see list` topology contract) — high-priority migration surface.
- Prose schema at `shared/schemas/spatial-topology.md` reconciled with the JSON schema.
- `aos see list` topology producer: `buildSpatialTopology()` in `src/perceive/capture-pipeline.swift:1425-1583` and the encodable models in `src/perceive/models.swift:92-158` (`STDisplay`, `STCursor`, `STBounds`, `SpatialTopology`).
- `display_geometry` daemon channel payload in `src/display/display-geometry.swift` (displays-only subset).
- `aos runtime display-union` CLI in `src/commands/runtime.swift` — default-shape decision analyzed here.
- Toolkit JS runtime cleanup in `packages/toolkit/runtime/spatial.js` (retire the `computeDisplayUnion` alias and its re-export in `packages/toolkit/runtime/index.js`, plus its Sigil passthrough in `apps/sigil/renderer/live-modules/display-utils.js`).
- Allowlist tighten in `tests/fixtures/spatial-governance-allowlist.json`.
- Consumers that will shift from re-deriving to reading canonical fields: Sigil renderer live modules, canvas-inspector, spatial-telemetry, workbench, `apps/sigil/tests/display-geometry/index.html`, `tests/runtime-display-union.sh`.
- Historical doc supersession notes / `ARCHITECTURE.md` and `AGENTS.md` / session-start hook guidance where it still says "legacy `global_bounds`".

**Out of scope:**
- Native AppKit/CG bridge helpers in `src/shared/types.swift` (`cgPointToScreen`, `screenPointToCG`, etc.). They stay native-boundary by design.
- `spatial-topology.schema.json` window/app sub-trees. Only the `Display`, `Bounds`, `Cursor`, and top-level aggregate fields participate in re-anchor.
- Adding a cursor field to the `display_geometry` channel payload. That channel stays displays-only; cursor re-anchor lives on `aos see list` only.
- Full Phase-6 allowlist collapse from `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md`. This plan only tightens what it touches.
- Sigil app-specific stage projection (`apps/sigil/renderer/live-modules/main.js` Three.js scene math beyond the global-to-DesktopWorld boundary it already owns).

---

## File Map

**High-priority migration surfaces (touched in most phases):**

- `shared/schemas/spatial-topology.schema.json` — contract surface for `aos see list`; carries new DesktopWorld fields and names native ones explicitly.
- `shared/schemas/spatial-topology.md` — prose contract; reconciled with the JSON schema.
- `src/perceive/capture-pipeline.swift:1425-1583` (`buildSpatialTopology`) — producer for `aos see list`; owns cursor DesktopWorld emission.
- `src/perceive/models.swift:92-158` — Swift encodable models (`STDisplay`, `STCursor`, etc.) used by the topology producer.
- `src/display/display-geometry.swift` — narrower producer for the `display_geometry` daemon channel (displays-only subset).
- `src/commands/runtime.swift` — home of `aos runtime display-union`; subject of the explicit default-shape decision.
- `packages/toolkit/runtime/spatial.js` — canonical JS runtime; retire the legacy alias, keep explicit `computeDesktopWorldBounds` / `computeVisibleDesktopWorldBounds`.
- `packages/toolkit/runtime/index.js` — re-export surface; remove the deprecated alias export.
- `tests/fixtures/spatial-governance-allowlist.json` — drops `computeDisplayUnion`.

**Consumers (touched in Phase 5):**

- `apps/sigil/renderer/live-modules/main.js` — `display_geometry` handler at lines 485-507 and `input_event` re-anchor at line 515.
- `apps/sigil/renderer/live-modules/display-utils.js` — drop `computeDisplayUnion` passthrough.
- `packages/toolkit/components/canvas-inspector/index.js` — `display_geometry` handler around line 358, bootstrap handler at line 347.
- `packages/toolkit/components/spatial-telemetry/index.js` — `display_geometry` handler around line 299.
- `packages/toolkit/components/spatial-telemetry/model.js` — re-export surface matches toolkit/runtime.
- `apps/sigil/workbench/index.html` — subscribes to `display_geometry`, line 148.
- `apps/sigil/tests/display-geometry/index.html` — smoke harness; currently reads `msg.global_bounds`.

**Tests:**

- `tests/schemas/spatial-topology.test.mjs` — new; asserts schema structure (Phase 1).
- `tests/topology-payload.sh` — new; asserts `aos see list --json` emits native + DesktopWorld display fields and cursor DesktopWorld siblings (Phase 2 Task 3).
- `tests/display-geometry-payload.sh` — new; asserts `display_geometry` channel payload emits native + DesktopWorld fields and **no** cursor (Phase 2 Task 4).
- `scripts/display-geometry-snapshot.mjs` — new; one-shot channel subscriber used by the display_geometry test.
- `tests/runtime-display-union.sh` — existing; asserts CLI output shape; changes depending on Phase 4 decision.
- `tests/toolkit/runtime-spatial.test.mjs` — existing; add coverage for DesktopWorld-field ingestion.
- `tests/toolkit/spatial-governance.test.mjs` — existing; adjusts when `computeDisplayUnion` leaves the allowlist.
- `tests/toolkit/canvas-inspector.test.mjs` — existing; verify behavior with both old-shape and new-shape payloads.
- `tests/toolkit/spatial-telemetry-model.test.mjs` — existing.
- No Swift unit harness exists in-repo for `snapshotDisplayGeometry` or `buildSpatialTopology`; coverage stays integration-level via the shell tests above.

**Historical / documentation:**

- `docs/superpowers/specs/2026-04-12-display-geometry-stream.md` — already has supersession banner; append pointer to this plan.
- `docs/superpowers/plans/2026-04-14-union-canvas-foundation.md` — already has supersession banner; append pointer to this plan.
- `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md`, `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md`, `docs/superpowers/plans/2026-04-13-sigil-birthplace-and-lastposition.md` — add a one-liner note that `--at $(./aos runtime display-union)` is historical; prefer `--track union`.
- `ARCHITECTURE.md:273` — keep the `--track union` sentence; tweak the legacy-shorthand wording only if Phase 4 decision renames/deprecates the subcommand.
- `.agents/hooks/session-start.sh:227-230` — reconciled with whatever Phase 4 decides.

---

## Phase 1 — Schema re-anchor (high-priority surface)

Goal: make `shared/schemas/spatial-topology.schema.json` describe both the native-compat values and the canonical DesktopWorld-anchored values explicitly, so downstream consumers can lock onto the new fields without schema drift. This phase only touches the schema; producer work (to actually populate the new fields) lives in Phase 2.

### Task 1: Introduce `NativeBounds` / `DesktopWorldBounds` typedefs in the JSON schema

**Files:**
- Modify: `shared/schemas/spatial-topology.schema.json:66-76` (existing `Bounds` typedef), `shared/schemas/spatial-topology.schema.json:89-137` (`Display` typedef)

- [ ] **Step 1: Add the failing schema test**

Create `tests/schemas/spatial-topology.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const schema = JSON.parse(
  await fs.readFile(new URL('../../shared/schemas/spatial-topology.schema.json', import.meta.url), 'utf8'),
);

test('Display typedef carries both native and DesktopWorld bounds', () => {
  const display = schema.$defs?.Display;
  assert.ok(display, 'expected $defs.Display');
  const props = display.properties || {};
  assert.ok(props.native_bounds, 'expected native_bounds property');
  assert.ok(props.native_visible_bounds, 'expected native_visible_bounds property');
  assert.ok(props.desktop_world_bounds, 'expected desktop_world_bounds property');
  assert.ok(props.visible_desktop_world_bounds, 'expected visible_desktop_world_bounds property');
});

test('top-level defines desktop_world_bounds + visible_desktop_world_bounds', () => {
  const props = schema.properties || {};
  assert.ok(props.desktop_world_bounds, 'expected top-level desktop_world_bounds');
  assert.ok(props.visible_desktop_world_bounds, 'expected top-level visible_desktop_world_bounds');
});

test('Cursor typedef carries DesktopWorld siblings', () => {
  const cursor = schema.$defs?.Cursor;
  assert.ok(cursor, 'expected $defs.Cursor');
  const props = cursor.properties || {};
  assert.ok(props.desktop_world_x, 'expected desktop_world_x sibling');
  assert.ok(props.desktop_world_y, 'expected desktop_world_y sibling');
});
```

> **Note:** these tests assert the shape of `spatial-topology.schema.json` only. They do not assert runtime `aos see list --json` output — Phase 2 covers producer emission.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/schemas/spatial-topology.test.mjs`
Expected: FAIL — `expected native_bounds property`.

- [ ] **Step 3: Update the schema**

Edit `shared/schemas/spatial-topology.schema.json`:

```jsonc
// In $defs, add below the existing Bounds typedef:
"NativeBounds": {
  "type": "object",
  "required": ["x", "y", "width", "height"],
  "additionalProperties": false,
  "properties": {
    "x": { "type": "number", "description": "Left edge in native desktop compatibility coordinates (top-left of macOS main display = (0,0))." },
    "y": { "type": "number", "description": "Top edge in native desktop compatibility coordinates." },
    "width": { "type": "number" },
    "height": { "type": "number" }
  }
},
"DesktopWorldBounds": {
  "type": "object",
  "required": ["x", "y", "width", "height"],
  "additionalProperties": false,
  "properties": {
    "x": { "type": "number", "description": "Left edge in DesktopWorld coordinates (top-left of arranged full-display union = (0,0))." },
    "y": { "type": "number", "description": "Top edge in DesktopWorld coordinates." },
    "width": { "type": "number" },
    "height": { "type": "number" }
  }
}
```

In the `Display` typedef, replace the existing `bounds` / `visible_bounds` entries with:

```jsonc
"bounds": {
  "$ref": "#/$defs/NativeBounds",
  "description": "Full display frame in native desktop compatibility coordinates. Kept for AppKit/CG boundary consumers; shared-world consumers should prefer desktop_world_bounds."
},
"visible_bounds": {
  "$ref": "#/$defs/NativeBounds",
  "description": "Usable area excluding menu bar and dock, in native desktop compatibility coordinates."
},
"native_bounds": {
  "$ref": "#/$defs/NativeBounds",
  "description": "Alias of bounds. Reserved for explicit native-boundary consumers."
},
"native_visible_bounds": {
  "$ref": "#/$defs/NativeBounds",
  "description": "Alias of visible_bounds for explicit native-boundary consumers."
},
"desktop_world_bounds": {
  "$ref": "#/$defs/DesktopWorldBounds",
  "description": "Full display frame in DesktopWorld coordinates. Canonical cross-surface value."
},
"visible_desktop_world_bounds": {
  "$ref": "#/$defs/DesktopWorldBounds",
  "description": "Usable area in DesktopWorld coordinates (VisibleDesktopWorld)."
}
```

Add `native_bounds`, `native_visible_bounds`, `desktop_world_bounds`, `visible_desktop_world_bounds` to the `Display.required` array.

In the top-level `properties` block, add:

```jsonc
"desktop_world_bounds": {
  "$ref": "#/$defs/DesktopWorldBounds",
  "description": "Full DesktopWorld union bounds (= canonical cross-surface union rect). Origin is (0,0) by construction."
},
"visible_desktop_world_bounds": {
  "$ref": "#/$defs/DesktopWorldBounds",
  "description": "Union of visible_bounds projected into DesktopWorld. Usable-area logic only."
}
```

Add both to the top-level `required` array.

Update the schema `description` (line 5) to remove the "Current producer coordinates remain native desktop compatibility" language and say: "Display and cursor bounds are emitted in both native desktop compatibility coordinates (for AppKit/CG boundary consumers) and DesktopWorld coordinates (canonical cross-surface world). See `shared/schemas/spatial-topology.md`."

In the `Cursor` typedef (lines 55-64), keep `x`/`y` as native-compat and add **required** `desktop_world_x` / `desktop_world_y` number fields:

```jsonc
"Cursor": {
  "type": "object",
  "required": ["x", "y", "desktop_world_x", "desktop_world_y", "display"],
  "additionalProperties": false,
  "properties": {
    "x": { "type": "number", "description": "Cursor X in native desktop compatibility coordinates." },
    "y": { "type": "number", "description": "Cursor Y in native desktop compatibility coordinates." },
    "desktop_world_x": { "type": "number", "description": "Cursor X in DesktopWorld coordinates." },
    "desktop_world_y": { "type": "number", "description": "Cursor Y in DesktopWorld coordinates." },
    "display": { "type": "integer", "minimum": 1, "description": "Ordinal of the display the cursor is on." }
  }
}
```

Cursor DesktopWorld fields belong to the topology schema only — they never appear on the `display_geometry` channel payload. Record that rule in the schema `description` alongside the bounds note.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/schemas/spatial-topology.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/schemas/spatial-topology.schema.json tests/schemas/spatial-topology.test.mjs
git commit -m "feat(schemas): carry DesktopWorld bounds alongside native in spatial-topology"
```

---

### Task 2: Reconcile the prose schema with the JSON schema

**Files:**
- Modify: `shared/schemas/spatial-topology.md`

- [ ] **Step 1: Read the current doc**

Re-read `shared/schemas/spatial-topology.md`. It already names the four layers and flags that native-compat values are "boundary compatibility only" (lines 47-54).

- [ ] **Step 2: Update the `How to convert between layers` and `How aos do uses this` sections**

Edit `shared/schemas/spatial-topology.md`:

- In the "Converting Between Layers" block (lines 56-67), replace the prose with a table that names the new schema fields: for display rects use `native_bounds` ↔ `desktop_world_bounds` (subtract/add DesktopWorld origin); for visible rects, use `native_visible_bounds` ↔ `visible_desktop_world_bounds`. Keep the LCS/physical-pixels rows intact.
- In the `How aos do Uses This` block (lines 107-131), retarget the "Click in a window from LCS" example so the math cites `native_bounds` explicitly as the daemon-emitted value and notes that shared-world code uses `desktop_world_bounds`.
- Under `Union Canvas Contract` (lines 172-178), clarify that the **top-level** `desktop_world_bounds` is the authoritative union rect (and is `[0,0,w,h]` by construction).

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/spatial-topology.md
git commit -m "docs(schemas): align prose topology doc with DesktopWorld-anchored fields"
```

---

## Phase 2 — Producer re-anchor

Goal: both producers emit the new DesktopWorld-anchored fields alongside the existing native-compat ones. The `aos see list` topology producer additionally emits cursor DesktopWorld coordinates (that is the only producer that carries cursor). The `display_geometry` channel stays cursor-less by design. Consumers can opt onto the new fields without either producer breaking old consumers.

### Task 3: `aos see list` — re-anchor the topology producer and cursor

**Files:**
- Modify: `src/perceive/models.swift:92-158` (extend `STDisplay`, `STCursor`, `SpatialTopology`)
- Modify: `src/perceive/capture-pipeline.swift:1425-1583` (`buildSpatialTopology`)

- [ ] **Step 1: Write the integration test**

Create `tests/topology-payload.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PAYLOAD=$(./aos see list --json 2>/dev/null)
# Pass payload via env var so the heredoc below is free to carry the script body
# (heredoc is stdin; echoing to python3 would be consumed by the heredoc, not read).
PAYLOAD="$PAYLOAD" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['PAYLOAD'])
displays = payload.get('displays', [])
assert displays, 'expected at least one display'
for display in displays:
    for key in ('native_bounds', 'native_visible_bounds', 'desktop_world_bounds', 'visible_desktop_world_bounds'):
        assert key in display, f'display missing {key}: {display}'
# Top-level aggregates.
assert 'desktop_world_bounds' in payload, 'expected top-level desktop_world_bounds'
assert 'visible_desktop_world_bounds' in payload, 'expected top-level visible_desktop_world_bounds'
assert payload['desktop_world_bounds']['x'] == 0, payload['desktop_world_bounds']
assert payload['desktop_world_bounds']['y'] == 0, payload['desktop_world_bounds']
# Cursor DesktopWorld siblings belong on topology, not on display_geometry.
cursor = payload.get('cursor', {})
assert 'desktop_world_x' in cursor, cursor
assert 'desktop_world_y' in cursor, cursor
print('PASS')
PY
```

Make it executable: `chmod +x tests/topology-payload.sh`.

- [ ] **Step 2: Rebuild and run the test to verify it fails**

Run:

```bash
bash build.sh
bash tests/topology-payload.sh
```

Expected: FAIL — `display missing native_bounds` or cursor sibling missing.

- [ ] **Step 3: Extend the encodable models**

Edit `src/perceive/models.swift`. Replace `STDisplay` with:

```swift
struct STDisplay: Encodable {
    let display_id: Int
    let display_uuid: String?
    let ordinal: Int
    let label: String
    let is_main: Bool
    let bounds: STBounds
    let visible_bounds: STBounds
    let native_bounds: STBounds
    let native_visible_bounds: STBounds
    let desktop_world_bounds: STBounds
    let visible_desktop_world_bounds: STBounds
    let scale_factor: Double
    let rotation: Double
    let windows: [STWindow]
}
```

Replace `STCursor` with:

```swift
struct STCursor: Encodable {
    let x: Double
    let y: Double
    let desktop_world_x: Double
    let desktop_world_y: Double
    let display: Int
}
```

Add two DesktopWorld aggregate fields to `SpatialTopology`:

```swift
struct SpatialTopology: Encodable {
    let schema: String
    let version: String
    let timestamp: String
    let screens_have_separate_spaces: Bool
    let cursor: STCursor
    let focused_window_id: Int?
    let focused_app: STFocusedApp?
    let displays: [STDisplay]
    let desktop_world_bounds: STBounds
    let visible_desktop_world_bounds: STBounds
    let apps: [STApp]
}
```

- [ ] **Step 4: Teach `buildSpatialTopology()` to populate the new fields**

Edit `src/perceive/capture-pipeline.swift:1425-1583`:

Before constructing `stDisplays` (around line 1511), compute the native full-desktop union once and define a re-anchor helper:

```swift
// Native full-desktop union (top-left of macOS main display = (0,0)).
let unionOrigin: CGPoint = {
    guard let first = displays.first else { return .zero }
    let rect = displays.dropFirst().reduce(first.bounds) { $0.union($1.bounds) }
    return rect.origin
}()
func reanchor(_ b: STBounds) -> STBounds {
    STBounds(x: b.x - unionOrigin.x, y: b.y - unionOrigin.y, width: b.width, height: b.height)
}
```

Inside the `displays.map` closure, wrap `bounds` and `visible_bounds` as native and compute their DesktopWorld siblings:

```swift
let nativeBounds = STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                            width: d.bounds.width, height: d.bounds.height)
let nativeVisible = visibleBounds  // the existing STBounds computed above
return STDisplay(
    display_id: Int(d.cgID),
    display_uuid: uuid,
    ordinal: d.ordinal,
    label: label,
    is_main: d.isMain,
    bounds: nativeBounds,
    visible_bounds: nativeVisible,
    native_bounds: nativeBounds,
    native_visible_bounds: nativeVisible,
    desktop_world_bounds: reanchor(nativeBounds),
    visible_desktop_world_bounds: reanchor(nativeVisible),
    scale_factor: d.scaleFactor,
    rotation: d.rotation,
    windows: windowsByDisplay[d.cgID] ?? []
)
```

Extend the `stCursor` construction (line 1456):

```swift
let stCursor = STCursor(
    x: cursorPt.x,
    y: cursorPt.y,
    desktop_world_x: cursorPt.x - unionOrigin.x,
    desktop_world_y: cursorPt.y - unionOrigin.y,
    display: cursorDisplay.ordinal
)
```

Build the top-level DesktopWorld aggregates and pass them into the `SpatialTopology` constructor (around lines 1571-1581):

```swift
let desktopWorldUnion: STBounds
let visibleDesktopWorldUnion: STBounds
if stDisplays.isEmpty {
    desktopWorldUnion = STBounds(x: 0, y: 0, width: 0, height: 0)
    visibleDesktopWorldUnion = desktopWorldUnion
} else {
    let fullRects = stDisplays.map { $0.desktop_world_bounds }
    let visRects = stDisplays.map { $0.visible_desktop_world_bounds }
    func union(_ rects: [STBounds]) -> STBounds {
        let minX = rects.map { $0.x }.min() ?? 0
        let minY = rects.map { $0.y }.min() ?? 0
        let maxX = rects.map { $0.x + $0.width }.max() ?? 0
        let maxY = rects.map { $0.y + $0.height }.max() ?? 0
        return STBounds(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
    desktopWorldUnion = union(fullRects)
    visibleDesktopWorldUnion = union(visRects)
}
let topology = SpatialTopology(
    schema: "spatial-topology",
    version: "0.1.0",
    timestamp: iso8601.string(from: Date()),
    screens_have_separate_spaces: NSScreen.screensHaveSeparateSpaces,
    cursor: stCursor,
    focused_window_id: focusedWinID.map { Int($0) },
    focused_app: focusedApp,
    displays: stDisplays,
    desktop_world_bounds: desktopWorldUnion,
    visible_desktop_world_bounds: visibleDesktopWorldUnion,
    apps: stApps
)
```

Full-DesktopWorld origin is `(0,0)` by construction; `visible_desktop_world_bounds` may have non-zero origin (menu bar inset etc.), which is the intentional difference from the full union.

- [ ] **Step 5: Bump schema version**

Change `version: "0.1.0"` to `version: "0.2.0"` in `src/perceive/capture-pipeline.swift` and in `shared/schemas/spatial-topology.schema.json`'s `version` pattern example in `shared/schemas/spatial-topology.md`. New required fields are a breaking schema bump.

- [ ] **Step 6: Rebuild and run the test to verify it passes**

Run:

```bash
bash build.sh
bash tests/topology-payload.sh
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/perceive/models.swift src/perceive/capture-pipeline.swift tests/topology-payload.sh
git commit -m "feat(perceive): re-anchor spatial-topology producer to DesktopWorld"
```

---

### Task 4: `display_geometry` channel — re-anchor displays-only subset

**Files:**
- Modify: `src/display/display-geometry.swift:14-72`

- [ ] **Step 1: Write the integration test**

Create `tests/display-geometry-payload.sh`. This harness subscribes to the `display_geometry` channel via a short Node script (the channel is not exposed on stdout, so we cannot reuse `aos see list`). The Node script resolves the active socket from `./aos doctor --json` so it works under both `repo` and `installed` runtime modes without hardcoding a path:

```bash
#!/usr/bin/env bash
set -euo pipefail

PAYLOAD=$(node scripts/display-geometry-snapshot.mjs)
PAYLOAD="$PAYLOAD" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['PAYLOAD'])
displays = payload.get('displays', [])
assert displays, 'expected at least one display'
for display in displays:
    for key in ('native_bounds', 'native_visible_bounds', 'desktop_world_bounds', 'visible_desktop_world_bounds'):
        assert key in display, f'display missing {key}: {display}'
assert 'desktop_world_bounds' in payload, 'expected top-level desktop_world_bounds'
assert 'visible_desktop_world_bounds' in payload, 'expected top-level visible_desktop_world_bounds'
assert payload['desktop_world_bounds']['x'] == 0, payload['desktop_world_bounds']
assert payload['desktop_world_bounds']['y'] == 0, payload['desktop_world_bounds']
# Channel payload deliberately has no cursor.
assert 'cursor' not in payload, 'display_geometry must not carry cursor fields'
print('PASS')
PY
```

Create `scripts/display-geometry-snapshot.mjs`. Resolve the active socket from `./aos doctor --json` (field `identity.socket_path`, confirmed shape from `src/commands/operator.swift:39-42` and `src/daemon/unified.swift:1966`) so the script respects whichever runtime mode is live — repo or installed — without assuming `~/.config/aos/repo/...`:

```js
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aosBin = path.join(repoRoot, 'aos');

function resolveSocketPath() {
  const override = process.env.AOS_SOCKET_PATH;
  if (override) return override;
  const raw = execFileSync(aosBin, ['doctor', '--json'], { encoding: 'utf8' });
  const doctor = JSON.parse(raw);
  const socketPath = doctor?.identity?.socket_path || doctor?.runtime?.socket_path;
  if (!socketPath) {
    throw new Error('aos doctor --json did not report a socket_path');
  }
  return socketPath;
}

const sock = resolveSocketPath();
const client = net.createConnection(sock);
let buf = '';
client.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line) continue;
    try {
      const env = JSON.parse(line);
      if (env.event === 'display_geometry') {
        process.stdout.write(JSON.stringify(env.data));
        client.end();
        process.exit(0);
      }
    } catch {}
  }
});
client.on('connect', () => {
  client.write(JSON.stringify({ action: 'subscribe', events: ['display_geometry'], snapshot: true }) + '\n');
});
client.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
setTimeout(() => { console.error('timeout'); process.exit(1); }, 3000);
```

`AOS_SOCKET_PATH` stays as an opt-in override for CI harnesses that already know the path; default path is `./aos doctor --json`, which is mode-aware.

Make both executable: `chmod +x tests/display-geometry-payload.sh scripts/display-geometry-snapshot.mjs`.

- [ ] **Step 2: Rebuild and run the test to verify it fails**

Run:

```bash
bash build.sh
bash tests/display-geometry-payload.sh
```

Expected: FAIL — `display missing native_bounds` or similar.

- [ ] **Step 3: Update `snapshotDisplayGeometry()`**

Edit `src/display/display-geometry.swift`:

Replace the loop body (lines 22-53) with:

```swift
for entry in entries {
    let cgID = entry.id
    let uuid = displayUUID(for: cgID) ?? ""
    let bounds = entry.bounds
    let visible = visibleBounds(for: cgID, fallback: bounds, screens: screensByNumber)
    let rotation = Int(CGDisplayRotation(cgID))

    let nativeBounds: [String: Double] = [
        "x": bounds.origin.x, "y": bounds.origin.y,
        "w": bounds.width, "h": bounds.height,
    ]
    let nativeVisible: [String: Double] = [
        "x": visible.origin.x, "y": visible.origin.y,
        "w": visible.width, "h": visible.height,
    ]

    displayDicts.append([
        "display_id": Int(cgID),
        "display_uuid": uuid,
        "bounds": nativeBounds,
        "visible_bounds": nativeVisible,
        "native_bounds": nativeBounds,
        "native_visible_bounds": nativeVisible,
        "scale_factor": entry.scaleFactor,
        "rotation": rotation,
        "is_main": entry.isMain,
    ])

    minX = min(minX, bounds.minX)
    minY = min(minY, bounds.minY)
    maxX = max(maxX, bounds.maxX)
    maxY = max(maxY, bounds.maxY)
}
```

Below the existing `globalBounds` computation (lines 55-65), add a DesktopWorld pass (copy verbatim from the Swift block in the previous plan revision — identical logic, identical output):

```swift
let nativeUnion: (x: Double, y: Double, w: Double, h: Double)
if entries.isEmpty {
    nativeUnion = (0, 0, 0, 0)
} else {
    nativeUnion = (minX, minY, maxX - minX, maxY - minY)
}

var visibleMinX = Double.infinity
var visibleMinY = Double.infinity
var visibleMaxX = -Double.infinity
var visibleMaxY = -Double.infinity
for display in displayDicts {
    guard let v = display["native_visible_bounds"] as? [String: Double] else { continue }
    visibleMinX = min(visibleMinX, v["x"] ?? 0)
    visibleMinY = min(visibleMinY, v["y"] ?? 0)
    visibleMaxX = max(visibleMaxX, (v["x"] ?? 0) + (v["w"] ?? 0))
    visibleMaxY = max(visibleMaxY, (v["y"] ?? 0) + (v["h"] ?? 0))
}
let visibleUnionNative: (x: Double, y: Double, w: Double, h: Double)
if !visibleMinX.isFinite {
    visibleUnionNative = nativeUnion
} else {
    visibleUnionNative = (visibleMinX, visibleMinY, visibleMaxX - visibleMinX, visibleMaxY - visibleMinY)
}

func reanchor(_ rect: [String: Double]) -> [String: Double] {
    [
        "x": (rect["x"] ?? 0) - nativeUnion.x,
        "y": (rect["y"] ?? 0) - nativeUnion.y,
        "w": rect["w"] ?? 0,
        "h": rect["h"] ?? 0,
    ]
}
for idx in displayDicts.indices {
    if let native = displayDicts[idx]["native_bounds"] as? [String: Double] {
        displayDicts[idx]["desktop_world_bounds"] = reanchor(native)
    }
    if let nativeVisible = displayDicts[idx]["native_visible_bounds"] as? [String: Double] {
        displayDicts[idx]["visible_desktop_world_bounds"] = reanchor(nativeVisible)
    }
}

let desktopWorldBounds: [String: Double] = [
    "x": 0, "y": 0, "w": nativeUnion.w, "h": nativeUnion.h,
]
let visibleDesktopWorldBounds: [String: Double] = [
    "x": visibleUnionNative.x - nativeUnion.x,
    "y": visibleUnionNative.y - nativeUnion.y,
    "w": visibleUnionNative.w,
    "h": visibleUnionNative.h,
]
```

Extend the final return dict (lines 67-72):

```swift
return [
    "type": "display_geometry",
    "displays": displayDicts,
    "global_bounds": globalBounds,
    "desktop_world_bounds": desktopWorldBounds,
    "visible_desktop_world_bounds": visibleDesktopWorldBounds,
]
```

Update the file doc comment (lines 1-13) to say the payload now carries both native-compat and DesktopWorld-anchored values, that `global_bounds` is retained as a compat alias of the native union, and that cursor fields stay out of this channel by design.

- [ ] **Step 4: Rebuild and run the test to verify it passes**

Run:

```bash
bash build.sh
bash tests/display-geometry-payload.sh
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/display/display-geometry.swift scripts/display-geometry-snapshot.mjs tests/display-geometry-payload.sh
git commit -m "feat(display): emit DesktopWorld-anchored fields in display_geometry payload"
```

---

## Phase 3 — Toolkit JS runtime cleanup

Goal: remove the ambiguous `computeDisplayUnion` alias, let `normalizeDisplays` prefer daemon-provided DesktopWorld fields when they exist, and keep re-anchoring as a fallback for older payloads.

### Task 5: Teach `normalizeDisplays` to prefer daemon-provided DesktopWorld fields

**Files:**
- Modify: `packages/toolkit/runtime/spatial.js:35-68` (`normalizeNativeDisplay`), `packages/toolkit/runtime/spatial.js:151-168` (`normalizeDisplays`)
- Test: `tests/toolkit/runtime-spatial.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/toolkit/runtime-spatial.test.mjs`:

```js
test('normalizeDisplays consumes daemon-provided desktop_world_bounds without re-anchoring', () => {
  const out = normalizeDisplays([{
    display_id: 1,
    is_main: true,
    scale_factor: 2,
    bounds: { x: -200, y: 0, w: 1920, h: 1080 },
    visible_bounds: { x: -200, y: 30, w: 1920, h: 1050 },
    native_bounds: { x: -200, y: 0, w: 1920, h: 1080 },
    native_visible_bounds: { x: -200, y: 30, w: 1920, h: 1050 },
    desktop_world_bounds: { x: 0, y: 0, w: 1920, h: 1080 },
    visible_desktop_world_bounds: { x: 0, y: 30, w: 1920, h: 1050 },
  }]);
  assert.deepEqual(out[0].bounds, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(out[0].visibleBounds, { x: 0, y: 30, w: 1920, h: 1050 });
  assert.deepEqual(out[0].nativeBounds, { x: -200, y: 0, w: 1920, h: 1080 });
});

test('normalizeDisplays falls back to re-anchoring when DesktopWorld fields are absent', () => {
  const out = normalizeDisplays([{
    display_id: 1,
    is_main: true,
    scale_factor: 2,
    bounds: { x: -200, y: 0, w: 1920, h: 1080 },
    visible_bounds: { x: -200, y: 30, w: 1920, h: 1050 },
  }]);
  assert.deepEqual(out[0].bounds, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(out[0].visibleBounds, { x: 0, y: 30, w: 1920, h: 1050 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/toolkit/runtime-spatial.test.mjs`
Expected: FAIL — first case's `bounds` ends up at `{ x: 0, y: 0 }` via the existing fallback by accident (it already re-anchors), second case already passes. The new assertion that `desktop_world_bounds` is honored verbatim (not re-derived from native) drives the implementation.

Hardening: tighten the first test by constructing a case where the native-re-anchor and daemon-provided DesktopWorld diverge (e.g. daemon reports `desktop_world_bounds.x = 5` by choice — used to detect future policy changes). The test asserts the daemon-provided rect wins.

- [ ] **Step 3: Update `normalizeNativeDisplay` + `normalizeDisplays`**

Edit `packages/toolkit/runtime/spatial.js`:

In `normalizeNativeDisplay`, capture daemon-provided DesktopWorld rects when present:

```js
const rawDesktopWorld = display.desktopWorldBounds
  || display.desktop_world_bounds
  || null;
const rawVisibleDesktopWorld = display.visibleDesktopWorldBounds
  || display.visible_desktop_world_bounds
  || null;

return {
  ...display,
  // ...existing fields...
  nativeBounds,
  nativeVisibleBounds,
  desktopWorldBounds: rawDesktopWorld ? normalizeRect(rawDesktopWorld) : null,
  visibleDesktopWorldBounds: rawVisibleDesktopWorld ? normalizeRect(rawVisibleDesktopWorld) : null,
};
```

In `normalizeDisplays`, prefer daemon-provided values over re-anchor:

```js
return nativeDisplays.map((display) => {
  const bounds = display.desktopWorldBounds
    ?? translateRect(display.nativeBounds, nativeDesktopBounds)
    ?? { x: 0, y: 0, w: 0, h: 0 };
  const visibleBounds = display.visibleDesktopWorldBounds
    ?? translateRect(display.nativeVisibleBounds, nativeDesktopBounds)
    ?? bounds;
  return {
    ...display,
    bounds,
    visibleBounds,
    native_bounds: display.nativeBounds,
    native_visible_bounds: display.nativeVisibleBounds,
    visible_bounds: visibleBounds,
    desktop_world_bounds: bounds,
    visible_desktop_world_bounds: visibleBounds,
  };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/toolkit/runtime-spatial.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/runtime/spatial.js tests/toolkit/runtime-spatial.test.mjs
git commit -m "feat(toolkit): prefer daemon-provided DesktopWorld bounds in normalizeDisplays"
```

---

### Task 6: Retire `computeDisplayUnion` alias

**Files:**
- Modify: `packages/toolkit/runtime/spatial.js:222-224`
- Modify: `packages/toolkit/runtime/index.js:21` (remove export)
- Modify: `apps/sigil/renderer/live-modules/display-utils.js:25-45` (remove passthrough)
- Modify: `tests/fixtures/spatial-governance-allowlist.json:30-32`
- Test: `tests/toolkit/runtime-spatial.test.mjs`, `tests/toolkit/spatial-governance.test.mjs`

- [ ] **Step 1: Grep for callers**

Run: `rg -n 'computeDisplayUnion' packages apps tests docs`
Expected callers (from the planning-phase audit):
- `packages/toolkit/runtime/spatial.js:222` (definition)
- `packages/toolkit/runtime/index.js:21` (re-export)
- `apps/sigil/renderer/live-modules/display-utils.js:25,40` (passthrough)

Add any additional hits uncovered at execution time to this task as explicit substeps.

- [ ] **Step 2: Write the failing governance test update**

`runSpatialAudit()` returns `result.definitions` as a plain object built via `Object.fromEntries(...)` (`scripts/spatial-audit.mjs:106-114`). Existing tests use property access (`result.definitions.normalizeDisplays`, see `tests/toolkit/spatial-governance.test.mjs:13-28`). Match that shape.

Edit `tests/toolkit/spatial-governance.test.mjs`:

- Delete the existing assertion `assert.deepEqual(result.definitions.computeDisplayUnion, ['packages/toolkit/runtime/spatial.js']);` at line 17.
- Append a new test that asserts the alias is no longer defined anywhere in the repo:

```js
test('computeDisplayUnion alias is not defined anywhere', async () => {
  const result = await runSpatialAudit(repoRoot);
  assert.equal(result.definitions.computeDisplayUnion, undefined, 'alias must be removed');
});
```

Run: `node --test tests/toolkit/spatial-governance.test.mjs`
Expected: FAIL — the new test fails because the alias still exists in `packages/toolkit/runtime/spatial.js`.

- [ ] **Step 3: Delete the alias and all references**

- Remove lines 222-224 from `packages/toolkit/runtime/spatial.js`.
- Remove `computeDisplayUnion,` from the import list in `packages/toolkit/runtime/index.js:21`.
- In `apps/sigil/renderer/live-modules/display-utils.js`, drop the `computeDisplayUnion` import at lines 25/40. Callers of `display-utils.computeDisplayUnion` must replace with an explicit choice: `computeVisibleDesktopWorldBounds` for usable-area logic, `computeDesktopWorldBounds` for the full-union frame.
- Delete the `computeDisplayUnion` entry from `tests/fixtures/spatial-governance-allowlist.json` (lines 30-32).

- [ ] **Step 4: Grep for residual consumers**

Run: `rg -n 'computeDisplayUnion'`
Expected: no remaining hits except historical docs (those acquire a supersession note in Phase 6).

For any runtime file hit, replace with the explicit helper. Each replacement is its own commit with message `refactor(<scope>): use computeVisibleDesktopWorldBounds` or `refactor(<scope>): use computeDesktopWorldBounds`.

- [ ] **Step 5: Run the full toolkit test suite**

Run: `node --test tests/toolkit/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the audit script**

Run: `node scripts/spatial-audit.mjs --check`
Expected: exit 0, no violations.

- [ ] **Step 7: Commit**

```bash
git add packages/toolkit/runtime/spatial.js packages/toolkit/runtime/index.js apps/sigil/renderer/live-modules/display-utils.js tests/fixtures/spatial-governance-allowlist.json tests/toolkit/spatial-governance.test.mjs tests/toolkit/runtime-spatial.test.mjs
git commit -m "refactor(toolkit): retire computeDisplayUnion alias"
```

---

## Phase 4 — `aos runtime display-union` default-shape decision

> **This phase is an explicit migration decision, not a predetermined outcome.** The end state of the CLI is chosen here with a written memo, human approval, and only then implementation. Do not pick an option in Task 7 without completing Task 8 first.

### Task 7: Audit current callers and their expectations

**Files:**
- Read-only: every file from the Phase 0 grep hitlist

- [ ] **Step 1: Enumerate every live caller**

Run: `rg -n 'aos runtime display-union' --glob '!docs/**' --glob '!*.md'`

Build the caller matrix (call site → what they feed the output into → coordinate space they actually need). Starter set from the planning-phase audit:

| Caller | Current use | Coordinate space actually needed |
| --- | --- | --- |
| `tests/runtime-display-union.sh:4` | Asserts the output matches `x,y,w,h` integers (shape smoke) | Any stable well-formed shape |
| `apps/sigil/tests/foundation-acceptance.md:82,454,462` | Passes the value to `aos show create --at` for a snapshot canvas | Whatever shape `aos show create --at` interprets — today that is **native-compat** (see `src/display/canvas.swift:678-679`) |
| `src/display/canvas.swift:669` | Code comment claims the command mirrors `allDisplaysBounds()` → native-compat | Native-compat |
| `src/shared/command-registry-data.swift:901-906` | Registry example; no runtime use | Documentation only |
| `.agents/hooks/session-start.sh` / `AGENTS.md` | Not direct callers, but agents are steered to `--track union` over this command | N/A |

Read each cited file to confirm. Record any caller whose `--at` handoff would break if the output shape changed (i.e. would drift a snapshot canvas off the intended frame).

- [ ] **Step 2: Record the audit**

Append the matrix to `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md` under a new `## Phase 4 Decision Memo` section (at the bottom of this file).

- [ ] **Step 3: Commit the audit**

```bash
git add docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md
git commit -m "docs(plan): record aos runtime display-union caller audit"
```

---

### Task 8: Produce the decision memo and pause for human approval

**Files:**
- Modify: `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md` (`## Phase 4 Decision Memo` section)

Evaluate **four** options explicitly. Each option has implementation, migration, and risk notes.

**Option A — Keep native-compat as default; add `--desktop-world` flag.**
- *Implementation:* unchanged stdout; `runtimeDisplayUnionCommand` parses `--desktop-world` and prints `0,0,w,h`.
- *Migration:* zero caller breakage. `aos show create --at $(./aos runtime display-union)` stays identical.
- *Risk:* keeps misleading default — the name "display union" continues to be the less canonical shape. Contradicts the goal of pushing DesktopWorld into the default mental model.
- *When to pick:* if the audit finds callers outside this repo (packaged runtime, external scripts) that parse the current shape verbatim.

**Option B — Switch default to DesktopWorld; add `--native` flag.**
- *Implementation:* default stdout becomes `0,0,w,h` in DesktopWorld. `--native` preserves `runtimeDisplayUnion()`'s current behavior.
- *Migration:* `apps/sigil/tests/foundation-acceptance.md` and any docs passing the value to `aos show create --at` must move to `--track union` (already the preferred pattern per `ARCHITECTURE.md:273` and the union-canvas spec) or pass `--native`. `tests/runtime-display-union.sh` stays valid.
- *Risk:* requires `aos show create --at` to either start accepting DesktopWorld rects or keep rejecting them — document explicitly that `--at` remains native-compat and steer callers to `--track union`.
- *When to pick:* if the audit confirms all direct CLI callers are either docs (updatable) or `--track union` candidates, and DesktopWorld visibility is the priority.

**Option C — Replace with two commands: `aos runtime desktop-world` and deprecate `display-union`.**
- *Implementation:* introduce `aos runtime desktop-world [--visible] [--native]`. Keep `aos runtime display-union` for one release with a stderr deprecation warning and the current native-compat stdout.
- *Migration:* callers update over time; single-release overlap.
- *Risk:* adds an additional CLI surface to maintain; registry entry in `src/shared/command-registry-data.swift` doubles.
- *When to pick:* if we want a clean long-term naming even at the cost of a transition release.

**Option D — Deprecate entirely; promote `--track union` + `aos see list --json` DesktopWorld fields.**
- *Implementation:* `aos runtime display-union` prints a deprecation line + the current value; removed in a later release.
- *Migration:* callers shift to `aos show create --track union` (Sigil) or to parsing `aos see list --json`'s `desktop_world_bounds`.
- *Risk:* no CLI one-liner for "just give me the union rect"; shell pipelines must use `jq` or similar.
- *When to pick:* if the caller audit shows the command is only a shell shortcut to `--track union` that no longer carries weight.

- [ ] **Step 1: Write the memo**

Populate `## Phase 4 Decision Memo` with: caller matrix (from Task 7), the four options above (copy verbatim), and a **Recommendation** block that picks one option with a one-paragraph justification grounded in the caller matrix and in the goal stated in `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md`.

- [ ] **Step 2: Hand off for human review**

Do not proceed past this step without explicit human approval of the recommendation. Post the memo section to the handoff channel per `## Shared Handoff Method` in `AGENTS.md` and stop.

- [ ] **Step 3: Commit the memo**

```bash
git add docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md
git commit -m "docs(plan): aos runtime display-union migration memo (awaiting decision)"
```

---

### Task 9: Implement the approved CLI migration

**Files:** depend on the option chosen in Task 8.

- [ ] **Step 1: Load the decision**

Re-read the approved option in `## Phase 4 Decision Memo`. Bind the remaining steps to that option.

- [ ] **Step 2: Update `src/commands/runtime.swift`**

Option A — add `--desktop-world` parsing to `runtimeDisplayUnionCommand`, call into a new `runtimeDesktopWorldUnion()` that reads the DesktopWorld fields from `snapshotDisplayGeometry()`.

Option B — flip the default to DesktopWorld; keep `runtimeDisplayUnion()` as `--native`. Update the help text and the doc comment at lines 46-62 to match.

Option C — add a new `desktop-world` subcommand; keep `display-union` with a stderr deprecation line that points to `desktop-world`.

Option D — emit a deprecation banner on every invocation; keep current stdout.

For every option, update `src/shared/command-registry-data.swift:901-906` to match the new canonical form.

- [ ] **Step 3: Update `tests/runtime-display-union.sh`**

Option A — no change. Option B — add a second test asserting DesktopWorld union origin is `0,0,*,*`. Option C — keep the existing test under `--native` and add a new `tests/runtime-desktop-world.sh` for the new command. Option D — assert the deprecation banner appears on stderr.

- [ ] **Step 4: Update consumers and docs**

Touch every hit from the Task 7 audit that would break under the chosen option. Specifically:

- `apps/sigil/tests/foundation-acceptance.md` — replace `--at "$(./aos runtime display-union)"` with the canonical `--track union` invocation, or pass `--native` per Option B.
- `ARCHITECTURE.md:273` — reflect the new default.
- `.agents/hooks/session-start.sh` — no change expected; it does not call the command directly.
- `src/display/canvas.swift:669` — update the comment so the `allDisplaysBounds()` note points at the new CLI's equivalent behavior.

- [ ] **Step 5: Rebuild and run the full integration slice**

```bash
bash build.sh
bash tests/runtime-display-union.sh
# Option B/C: also run the newly added test.
bash tests/display-geometry-payload.sh
node --test tests/toolkit/*.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

Commit the CLI/registry/test changes first, then a separate commit per doc file.

```bash
git add src/commands/runtime.swift src/shared/command-registry-data.swift tests/runtime-display-union.sh
git commit -m "feat(runtime): migrate aos runtime display-union per decision memo"

git add apps/sigil/tests/foundation-acceptance.md ARCHITECTURE.md
git commit -m "docs: realign docs with new aos runtime display-union shape"
```

---

## Phase 5 — Consumer migration

Goal: every `display_geometry` consumer reads the daemon-provided DesktopWorld fields when present, drops defensive re-anchoring, and uses explicit helper names (no `computeDisplayUnion`).

### Task 10: Sigil renderer

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js:485-507, 544, 584-631`
- Modify: `apps/sigil/renderer/live-modules/display-utils.js`

- [ ] **Step 1: Update the `display_geometry` handler**

At `apps/sigil/renderer/live-modules/main.js:485-507`, replace the re-derivation with direct reads:

```js
if (msg.type === 'display_geometry') {
    liveJs.displays = normalizeDisplays(msg.displays || []);
    liveJs.globalBounds = msg.desktop_world_bounds
        ? { ...msg.desktop_world_bounds, minX: msg.desktop_world_bounds.x, minY: msg.desktop_world_bounds.y, maxX: msg.desktop_world_bounds.x + msg.desktop_world_bounds.w, maxY: msg.desktop_world_bounds.y + msg.desktop_world_bounds.h }
        : computeDesktopWorldBounds(liveJs.displays);
    liveJs.visibleBounds = msg.visible_desktop_world_bounds
        ? { ...msg.visible_desktop_world_bounds, minX: msg.visible_desktop_world_bounds.x, minY: msg.visible_desktop_world_bounds.y, maxX: msg.visible_desktop_world_bounds.x + msg.visible_desktop_world_bounds.w, maxY: msg.visible_desktop_world_bounds.y + msg.visible_desktop_world_bounds.h }
        : computeVisibleDesktopWorldBounds(liveJs.displays);
    // existing avatar-clamp block stays, now reads liveJs.visibleBounds.
    ...
}
```

Keep the fallback to `computeDesktopWorldBounds`/`computeVisibleDesktopWorldBounds` so the renderer works against older `./aos` builds.

- [ ] **Step 2: Remove `computeDisplayUnion` passthrough**

Edit `apps/sigil/renderer/live-modules/display-utils.js` to drop the `computeDisplayUnion` import/export (lines 25, 40). Every call site within Sigil that reached this passthrough must re-target to the explicit helper.

- [ ] **Step 3: Run the existing Sigil boot smoke**

Run: `bash tests/sigil-foundation-smoke.sh` (or the nearest equivalent — check `tests/` directory for the boot smoke Sigil owns).

- [ ] **Step 4: HITL verification**

Using the shared session-start method from `AGENTS.md`:

```bash
./aos clean
bash tests/display-debug-battery.sh
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --track union
```

Verify: avatar appears, responds to clicks, stays inside `visible_desktop_world_bounds`. Use `./aos see capture` to confirm — do not ask the user what they see.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js apps/sigil/renderer/live-modules/display-utils.js
git commit -m "refactor(sigil): consume daemon DesktopWorld fields; drop computeDisplayUnion"
```

---

### Task 11: Canvas inspector

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/index.js:316-363`
- Test: `tests/toolkit/canvas-inspector.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/toolkit/canvas-inspector.test.mjs`:

```js
test('canvas-inspector uses daemon-provided desktop_world_bounds when present', () => {
  // Build the inspector, deliver a display_geometry payload with desktop_world_bounds,
  // and assert the minimap layout uses union (0,0,w,h) not a re-derived rect.
  // (See existing patterns in this test file for mounting + stubbing the host bridge.)
});
```

Flesh out the assertion body matching existing harness patterns in the same file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/canvas-inspector.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Update the inspector message handler**

Edit the `display_geometry` branch in `packages/toolkit/components/canvas-inspector/index.js:358-363` so the handler records the daemon-provided `desktop_world_bounds` and `visible_desktop_world_bounds` on the local state object for the minimap to consume. `normalizeDisplays` already propagates the per-display rects; the component's minimap computation in `computeMinimapLayout` (`packages/toolkit/runtime/spatial.js:411-459`) already defers to `computeDesktopWorldBounds`.

The change is: when the message carries `desktop_world_bounds`, prefer it for any local aggregate state that was previously re-deriving; otherwise fall back.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/canvas-inspector.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/index.js tests/toolkit/canvas-inspector.test.mjs
git commit -m "refactor(canvas-inspector): consume daemon DesktopWorld aggregates"
```

---

### Task 12: Spatial telemetry

**Files:**
- Modify: `packages/toolkit/components/spatial-telemetry/index.js:262-299`
- Modify: `packages/toolkit/components/spatial-telemetry/model.js`
- Test: `tests/toolkit/spatial-telemetry-model.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/toolkit/spatial-telemetry-model.test.mjs` a test that drives `buildSpatialTelemetrySnapshot` with a payload including `desktop_world_bounds` and asserts the resulting snapshot reports the daemon-authoritative union rect.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/toolkit/spatial-telemetry-model.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Update `model.js` / `index.js`**

Teach `buildSpatialTelemetrySnapshot` to accept and report daemon-provided DesktopWorld aggregates; update the message handler at `packages/toolkit/components/spatial-telemetry/index.js:299` to forward them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/toolkit/spatial-telemetry-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/toolkit/components/spatial-telemetry/index.js packages/toolkit/components/spatial-telemetry/model.js tests/toolkit/spatial-telemetry-model.test.mjs
git commit -m "refactor(spatial-telemetry): consume daemon DesktopWorld aggregates"
```

---

### Task 13: Workbench + display-geometry smoke page

**Files:**
- Modify: `apps/sigil/workbench/index.html:141-148`
- Modify: `apps/sigil/tests/display-geometry/index.html:24-87`

- [ ] **Step 1: Workbench**

Trace what the workbench does with its `display_geometry` subscription (line 141). If it only uses `msg.displays`, no change needed. Otherwise point it at `desktop_world_bounds` explicitly.

- [ ] **Step 2: Smoke harness**

Edit `apps/sigil/tests/display-geometry/index.html` to print both `global_bounds` (native-compat, labeled) and `desktop_world_bounds` + `visible_desktop_world_bounds` (canonical). This keeps the harness a usable live debugger for both shapes.

- [ ] **Step 3: HITL verification**

```bash
./aos clean
./aos show create --id dg-smoke --url 'aos://sigil/tests/display-geometry/index.html' --track union
./aos see capture user_active --out /tmp/dg.png
```

Confirm the captured image shows both aggregate rects and the DesktopWorld one lands at `0,0,*,*`.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/workbench/index.html apps/sigil/tests/display-geometry/index.html
git commit -m "refactor(sigil): surface DesktopWorld aggregates in workbench + smoke harness"
```

---

## Phase 6 — Governance + historical doc cleanup

Goal: every governance surface, session-start steer, and historical doc matches the new default once Phase 4 lands.

### Task 14: Historical doc supersession notes

**Files:**
- Modify: `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md`
- Modify: `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md`
- Modify: `docs/superpowers/plans/2026-04-13-sigil-birthplace-and-lastposition.md`

- [ ] **Step 1: Prepend a supersession banner**

For each file, add a short banner at the top:

```markdown
> **Supersession note:** References to `aos runtime display-union` and
> `--at $(aos runtime display-union)` predate the DesktopWorld re-anchor.
> Current authority: `shared/schemas/spatial-topology.md` and
> `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md`.
> Prefer `--track union` for new work.
```

Do not rewrite the body — the supersession banner is sufficient.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md docs/superpowers/plans/2026-04-13-sigil-birthplace-and-lastposition.md
git commit -m "docs: flag historical display-union references as superseded"
```

---

### Task 15: Session-start hook guidance

**Files:**
- Modify: `.agents/hooks/session-start.sh:227-230`

- [ ] **Step 1: Refresh the wording**

Current line says: `Treat that placement as operator convenience only; the shared world contract is \`DesktopWorld\` (arranged full-display union).`

After Phase 2, extend that to: `Daemon \`display_geometry\` now emits \`desktop_world_bounds\` and \`visible_desktop_world_bounds\` directly; prefer those fields over re-deriving from native.`

- [ ] **Step 2: Commit**

```bash
git add .agents/hooks/session-start.sh
git commit -m "docs(hooks): steer sessions toward daemon DesktopWorld aggregates"
```

---

### Task 16: Spatial audit allowlist tighten

**Files:**
- Modify: `tests/fixtures/spatial-governance-allowlist.json`
- Test: `tests/toolkit/spatial-governance.test.mjs`

- [ ] **Step 1: Confirm Task 6 already removed `computeDisplayUnion`**

Run: `node scripts/spatial-audit.mjs --summary`
Confirm the allowlist no longer lists the alias (Task 6 removed it). If other helpers have lost their one remaining caller through Phases 5–6, drop them too. A helper with no active caller should not keep a slot in the allowlist.

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/spatial-governance-allowlist.json
git commit -m "test(spatial-governance): tighten allowlist after DesktopWorld re-anchor"
```

---

## Final Verification

- [ ] Run the full test battery:

```bash
bash build.sh
node --test tests/toolkit/*.test.mjs tests/schemas/*.test.mjs
bash tests/runtime-display-union.sh
bash tests/topology-payload.sh
bash tests/display-geometry-payload.sh
bash tests/display-debug-battery.sh
node scripts/spatial-audit.mjs --check
```

All PASS.

- [ ] HITL sanity run with `./aos show create --track union ...` for Sigil + canvas-inspector + spatial-telemetry, using `./aos see capture` to verify — do not ask the user what they see.

- [ ] Update memory: only if a surprising-and-durable fact came out of the migration decision (e.g. "external callers relied on the legacy `global_bounds` shape — Option B was rejected because …"). Otherwise leave memory alone.

---

## Phase 4 Decision Memo

### Caller audit (Task 7)

Runtime callers (source + tests):

| Caller | File + line | Current shape consumed | Breaks under Option B? | Breaks under Option C? | Breaks under Option D? |
| --- | --- | --- | --- | --- | --- |
| `aos runtime display-union` command impl | `src/commands/runtime.swift:52-77` | Prints native-compat `global_bounds` as `x,y,w,h` | n/a — the command itself is the subject | Kept for one release with deprecation; impl still runs | Kept, adds deprecation banner |
| `aos show create --at` sample comment | `src/display/canvas.swift:665-679` | Comment only; no runtime parsing of the CLI output. `--at` treats its 4-int arg as native-compat CGRect (line 679) | Comment becomes stale if default flips; rewrite needed regardless | Comment rewrite | Comment rewrite |
| Command registry entry | `src/shared/command-registry-data.swift:901-906` | Registry example; no runtime use | Update registry example text | Replace id/usage | Add "(deprecated)" note |
| Integration test | `tests/runtime-display-union.sh:4` | Asserts output matches `^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$` (shape smoke; does not care about origin) | Still passes if the new default stays well-formed; semantic assertion unchanged | Passes for new command; keep old-command test on `--native` fallback | Passes; test can optionally grep for deprecation line |

Docs / test docs callers (non-runtime, but real):

| Caller | File + line | Breaks under B / C / D? |
| --- | --- | --- |
| Sigil foundation acceptance doc | `apps/sigil/tests/foundation-acceptance.md:82, 454, 462` | **Yes** under B — passes the CLI output to `aos show create --at`. `--at` remains native-compat. If the default flips to DesktopWorld, these invocations produce a snapshot canvas on the wrong display for any layout where the native union origin is not (0,0). Option C/D require the same update. All four options fix this by switching the examples to `--track union` (already the canonical pattern per `ARCHITECTURE.md:273` and the union-canvas spec). |
| Historical Sigil specs / plans | `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md:126,128`, `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md:12,79`, `docs/superpowers/plans/2026-04-14-union-canvas-foundation.md:*`, `docs/superpowers/plans/2026-04-13-sigil-birthplace-and-lastposition.md:*`, `docs/superpowers/plans/2026-04-12-sigil-foundation-agents-and-global-canvas.md:455,525` | Not runtime callers. Acquire supersession banners in Phase 6 regardless of option chosen. |
| Architecture prose | `ARCHITECTURE.md:273` | Already names `--track union` as the canonical pattern; the `--at $(aos runtime display-union)` fallback note needs wording refresh under any option. |

**Callers-at-risk count:** one live runtime reference (`tests/runtime-display-union.sh` — shape smoke only, passes under any option) plus one live doc path (`apps/sigil/tests/foundation-acceptance.md` — breaks under Option B unless updated, but the doc already calls `--track union` the preferred pattern). No Swift or JS runtime code parses the command output. No external scripts in this repo parse it. No packaged runtime callers found.

### Options (Task 8)

- **Option A — Keep native-compat default; add `--desktop-world` flag.**
  - Implementation: unchanged stdout; `runtimeDisplayUnionCommand` parses `--desktop-world` and prints `0,0,w,h` (the top-level `desktop_world_bounds`).
  - Migration: zero caller breakage. `aos show create --at $(./aos runtime display-union)` stays identical.
  - Risk: preserves the misleading default. "Display union" name continues to produce the less-canonical shape. Contradicts the goal of making DesktopWorld the default mental model. Fresh sessions keep copying the old shape.
  - When to pick: if external/out-of-repo callers we don't control depend on the current shape.

- **Option B — Switch default to DesktopWorld; add `--native` flag.**
  - Implementation: default stdout becomes `0,0,w,h` in DesktopWorld. `--native` preserves today's native-compat `global_bounds` output.
  - Migration: `apps/sigil/tests/foundation-acceptance.md` must update its `--at $(./aos runtime display-union)` invocations (either `--track union` as the CLAUDE-documented canonical pattern, or `--native` for an explicit native shape). `tests/runtime-display-union.sh` stays valid (shape smoke only).
  - Risk: `--at` remains native-compat (`src/display/canvas.swift:679`). Any caller that fed display-union output directly into `--at` must stop on multi-display setups where the native union origin is not (0,0). The foundation doc is the only such caller in the repo.
  - When to pick: DesktopWorld visibility is the priority and the doc update is trivial. Matches the goal stated in `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md:140-170`.

- **Option C — Replace with `aos runtime desktop-world`; deprecate `display-union`.**
  - Implementation: introduce `aos runtime desktop-world [--visible] [--native]`. Keep `aos runtime display-union` for one release with a stderr deprecation warning and current native-compat stdout.
  - Migration: callers update over time; single-release overlap.
  - Risk: two CLI surfaces to maintain, registry entry duplicates, fresh sessions have two different names to learn during the overlap.
  - When to pick: if we want a clean long-term naming and can absorb the transition.

- **Option D — Deprecate entirely; steer to `--track union` + `aos see list --json`.**
  - Implementation: `aos runtime display-union` prints deprecation + current value; removed in a later release.
  - Migration: Sigil-style callers shift to `aos show create --track union`; pipelines that need the bounds use `jq '.desktop_world_bounds'` over `aos see list --json`.
  - Risk: no CLI one-liner for "just give me the union rect." Shell pipelines need `jq`. Removes a cheap diagnostic.
  - When to pick: if the command is purely a shell shortcut to `--track union` with no other cost/benefit.

### Recommendation

**Option B — switch default to DesktopWorld; add `--native` flag.**

Rationale:
- The caller audit shows only one live runtime consumer (`tests/runtime-display-union.sh`, shape-only) and one live doc consumer (`apps/sigil/tests/foundation-acceptance.md`). Neither depends on the native shape; both can be updated trivially.
- `--track union` is already the documented replacement for `--at $(aos runtime display-union)` per `ARCHITECTURE.md:273` and the union-canvas spec. Callers that still need a plain CLI union rect now get the canonical DesktopWorld shape by default.
- DesktopWorld at `(0,0,w,h)` is the canonical cross-surface world per `shared/schemas/spatial-topology.md:30-44`. The command should reflect the canonical default; `--native` remains the explicit escape hatch for AppKit/CG boundary callers.
- Option C/D both increase surface area (new command / jq pipelines) with no corresponding caller benefit given the tiny audit footprint. Option A locks in a known misleading default.

### Human decision

_(Record approved option + approver handle before starting Task 9. Plan is paused here for review.)_
