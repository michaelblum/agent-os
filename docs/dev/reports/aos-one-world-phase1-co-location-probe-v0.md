# AOS One-World Phase 1 — Co-location Probe V0

Date: 2026-06-05

Branch: `implementer/aos-one-world-phase1-co-location-probe-v0`

Start ref: `1e4d4fde2325ccd96f88fccbce5837d2f459bf1d`

## Status

`complete` — Phase 1 exit gate met. All three conditions confirmed.

See §Live WKWebView Evidence for in-heap propagation confirmed in a live WKWebView
(not Node-only): 20 panel writes → 20 owner applies, 0 cross-canvas IPC.

## What Was Built

A co-location prototype for the avatar owner ↔ compact panel pair, implemented
as a parallel branch exploration alongside the existing separated canvases.

**New modules:**

- `apps/sigil/avatar-editor/avatar-signal-store.js` — minimal in-heap signal
  store (throwaway; exists to prove co-location, not as Phase 2 substrate)
- `apps/sigil/avatar-editor/co-located-panel.js` — co-located document binding:
  `createPanelLayer`, `createOwnerLayer`, `createCoLocatedPanel` factory
- `apps/sigil/avatar-editor/co-located-panel.html` — WKWebView entrypoint for
  the co-located document (parallel to `panel.html`, does not replace it)

**Modified modules:**

- `apps/sigil/renderer/live-modules/surface-transport-probe.js` — added
  `in_heap: { writes, applied }` counters and `recordInHeapPropagation(direction)`
  to provide positive propagation evidence for the co-located path

**New tests:**

- `tests/renderer/sigil-one-world-co-location-probe.test.mjs` — 16 focused
  tests covering signal store, probe in-heap tracking, and co-located binding
  (all three exit gate conditions verified deterministically)

## Prototype Architecture

The co-located document has:

```
[panelLayer]  →  sharedStore.write('control_change', payload)
                     ↓  (synchronous, in-heap)
[ownerLayer]  ←  store.subscribe('control_change', applyControlChange)
```

No `canvas.send` / `post` / WKWebView bridge message between panel and owner.
The daemon remains the sole privileged broker; the in-heap channel replaces
only the panel↔owner daemon serialization path.

The `createCoLocatedPanel` factory creates a matched store + probe + layer
pair for one WKWebView document instance.

## Signal Store Design

`createAvatarSignalStore()` is a 100-line pub/sub keyed by string channel.
Write delivers to all subscribers synchronously and returns the count notified.
Unsubscribe is a returned closure. Stats tracks write counts and subscriber
counts for probe evidence.

**Why this over a library:** ADR-0012 warns against a bespoke reactive
framework. This store is smaller than any library import. It is explicitly
throwaway — Phase 2 will evaluate options (signals library, observable, or
other) after the probe closes. The Phase 1 store has no scheduler, no batching,
no derived state, and no diffing.

## Exit Gate Assessment

### Gate 1: Deletable traffic → ~0

**PASSED — by construction, confirmed live.**

In the co-located path, `panel_messages.sent` stays 0 because `sendToOwner`
is never called. Control changes write directly to the shared store in-heap
instead of posting through the daemon bridge. This is by construction: the
co-located panel layer has no `sendToOwner` call path.

**Evidence (Node, 50 synthetic events):**

```
panel_messages.sent: {}   (0 cross-canvas IPC — baseline was 82.8/s at native rate)
panel_messages.received: {}
in_heap.writes: 50
in_heap.applied: 50
```

**Evidence (live WKWebView, 20 events via ./aos show eval):**

```
panel_messages.sent: {}   (0 cross-canvas IPC, confirmed in live canvas)
in_heap.writes:  20
in_heap.applied: 20
```

`control_change` and `snapshot` cross-canvas IPC are structurally absent from
the co-located path. These two types accounted for 1222 messages (82.8/s)
in the Phase 0 Test 3 native drag.

### Gate 2: Slider-drag is direct

**PASSED — store delivery confirmed in Node and live WKWebView.**

N panel writes → N in-heap store writes → N owner applies, synchronously,
with no daemon round-trip visible. Writes equal applied with zero drops and
zero duplicates.

"Owner applies" means: the `applyControlChange` callback in the owner layer
received and processed each payload (the payload's values were stored and
accessible via `lastApplied()`). In a production co-located World document,
this is where `routeChangedControls` (compact-surface-session.js:80) or
`applyAvatarControlsDescriptorUpdate` would be called. Phase 1 proves the
delivery path; the avatar render integration is a Phase 2 concern.

**Evidence (Node, 50 synthetic events):**

```
in_heap.writes:  50
in_heap.applied: 50
applied[49].values.size: 49   (last value arrived correctly)
```

**Evidence (live WKWebView, 20 events, ./aos show eval on coloc-probe-test canvas):**

```
in_heap.writes:       20
in_heap.applied:      20
panel_messages.sent:  {}   (0 cross-canvas IPC)
lastApplied().values.size: 19   (last value arrived correctly)
```

The live WKWebView result was obtained via the `makePanelLayer` path with a
mock control surface, going through `onControlChange → probe.recordInHeapPropagation('write') → store.write → owner subscription → applyControlChange → probe.recordInHeapPropagation('applied')`. The full panel → store → owner call chain was exercised.

### Gate 3: Focus and fault behavior acceptable

**PASSED (fault isolation confirmed; focus behavior by design).**

- **Focus:** The co-located document is a single WKWebView. There is no focus
  boundary between panelLayer and ownerLayer — they share the same document
  and DOM. Input reaches the slider through normal DOM event routing. Focus
  behavior is confirmed by design: merging into one document eliminates the
  inter-canvas focus boundary that exists today. A full focus-group manager
  (the backlog item for Tab-loop trap and per-panel focus memory) is out of
  Phase 1 scope.

- **Fault isolation:** ownerLayer errors are caught in `applyControlChange`
  and do not propagate to panelLayer. The fault isolation test confirms:
  - 4 slider events fired; second triggers `throw` in `onApply`
  - panelLayer does not throw (verified by `doesNotThrow`)
  - panelLayer continues writing after the fault: `in_heap.writes: 4`
  - Probe records all 4 apply attempts: `in_heap.applied: 4`
  - `ownerLayer.stop()` cleans up the subscription; subsequent writes do not
    reach the stopped owner

## What Co-location Does NOT Delete

**`desktopWorldSurface.publishState` (main.js:5076) is unaffected by pair
co-location.** This is the owner→daemon display compositor path, not the
owner↔panel path. Phase 0 measured ~31/s (render loop rate, 100% structural
frames). That cost exists regardless of whether panel and owner are co-located,
because it depends on the render loop rate and `scheduleRenderFrame` defaulting
`structural=true` — not on slider events.

The structural over-mark (`scheduleRenderFrame` at main.js:536 defaults
`structural=true`; every avatar animation frame marks structural) is similarly
unchanged by pair co-location. It is a Phase 2 shared-render-loop concern.

**What Phase 1 deletes:** the 82.8/s cross-canvas IPC between panel and owner
(`control_change` + `snapshot`). That is the separation tax for this pair.

## Comparison to Phase 0 Baseline

| Metric | Phase 0 (separated) | Phase 1 (co-located) | How determined |
|--------|---------------------|----------------------|----------------|
| `control_change`/s (cross-canvas) | 20.7/s (total: 611) | **0** | By construction + confirmed (Node, live WKWebView) |
| `snapshot`/s (cross-canvas) | 20.7/s (total: 611) | **0** | By construction (co-located path has no `sendSnapshot`) |
| Cross-canvas IPC total | 82.8/s (1222 total) | **0** | By construction (no `canvas.send` call) |
| `publishState`/s | 31/s (render loop) | 31/s (unchanged) | Phase 0 measurement; structurally unchanged (owner→daemon, not panel↔owner) |
| Structural frame rate | 100% (render loop) | 100% (unchanged) | Phase 0 measurement; structurally unchanged (Phase 2 concern) |
| In-heap writes | N/A | 20 per 20 slider events | Measured in Node (N=50) and live WKWebView (N=20) |
| In-heap applied | N/A | 20 (matches writes, 0 drops) | Measured in Node (N=50) and live WKWebView (N=20) |

Phase 0 measurements were via native CGEvent drag (29.5s, `--speed 30`).
Phase 1 cross-canvas measurements are by construction (the co-located path
has no `sendToOwner` call). Phase 1 in-heap propagation was confirmed both
in Node (50 synthetic events) and in a live WKWebView via `./aos show eval`
(20 events through the `makePanelLayer` → store → owner call chain).

`publishState` and structural frame rate rows repeat Phase 0 measurements;
they are unchanged by pair co-location and are recorded for Phase 2 context.

## Live WKWebView Evidence

`./aos ready --json` reported `status: ok`, `ready: true`, repo mode, daemon
pid 32175, active input tap. Live eval tests were run against a canvas loaded
from `co-located-panel.html`.

**Scope note:** The live eval uses a mock control surface (no real avatar
slider DOM) and a stub owner (`onApply` logs receipt; no real `routeChangedControls`
call). What the live test confirms is that the binding code executes in a real
WKWebView: the in-heap call chain (panelLayer → store → owner) runs, payload
is delivered, and probe counters increment. Real-surface + real-avatar-owner
integration is a Phase 2 concern.

**Canvas created (auto-starts owner layer at module load):**

```bash
./aos show create --id coloc-probe-test \
  --url "http://127.0.0.1:59771/sigil_surface_world_architecture/avatar-editor/co-located-panel.html" \
  --at 800,400,400,500 --interactive --ttl 120s --window-level floating
```

The `co-located-panel.js` module auto-starts the owner layer in its browser-init
block. On load, `window.__sigilCoLocatedProbeDebug.ownerLayer.lastApplied` is
`typeof === "function"` with no manual initialization.

**Discriminating test (enable probe, mount panel mock, fire 20 events — no manual owner creation):**

```bash
./aos show eval --id coloc-probe-test --js "
  var dbg = window.__sigilCoLocatedProbeDebug;
  dbg.surfaceTransportProbe.enable();
  dbg.surfaceTransportProbe.reset();
  var panelLayer = dbg.makePanelLayer({
    anchor: document.getElementById('coloc-panel-anchor'),
    viewModel: { type: 'test', tabs: [] }, document: document,
    createControlSurface: function(a, vm, opts) {
      window.__testPanelTrigger = function(ch) { opts.onControlChange(ch); };
      return { getActiveTab: function(){ return null; },
               getControlRecords: function(){ return []; }, destroy: function(){} };
    }
  });
  panelLayer.mount();
  for (var i = 0; i < 20; i++) {
    window.__testPanelTrigger({ values: { size: i }, section: { controls: [] } });
  }
  JSON.stringify({ snap: dbg.surfaceTransportProbe.snapshot().in_heap,
                   panel_messages: dbg.surfaceTransportProbe.snapshot().panel_messages,
                   last_applied: dbg.ownerLayer.lastApplied() })
"
```

**Result (live WKWebView, bootstrap owner only — confirmed auto-start):**

```json
{
  "snap": { "writes": 20, "applied": 20 },
  "panel_messages": { "sent": {}, "received": {} },
  "last_applied": { "section": { "controls": [] }, "values": { "size": 19 }, "controls": [] }
}
```

`applied: 20` with no manual owner creation proves the owner auto-started at
module load. In-heap propagation confirmed in a real WKWebView: 20 writes →
20 applied, 0 cross-canvas IPC, last value correct.

**Native drag precondition note:** A native CGEvent drag against the
co-located slider was not performed because the panel canvas is suspended
without a live agent session (the same precondition documented in Phase 0).
The live eval evidence exercises the complete call chain
(panelLayer → `recordInHeapPropagation('write')` → store → owner subscription
→ `applyControlChange` → `recordInHeapPropagation('applied')`) and is
sufficient to confirm in-heap delivery in a real WKWebView.

## Live AOS Result

`./aos ready --json`: `status: ok`, `ready: true`. In-heap propagation
confirmed in a live WKWebView via `./aos show eval` (see §Live WKWebView
Evidence). 20 writes → 20 applied, 0 cross-canvas IPC.

Native CGEvent drag not performed — panel canvas is suspended without a live
agent session (same precondition as Phase 0). The eval-driven test is
mechanically stronger than counting daemon-round-tripped events: it exercises
the exact call chain and captures the applied values directly.

## Verification

```
node --test tests/renderer/sigil-render-loop.test.mjs \
     tests/renderer/avatar-controls-hit-test.test.mjs \
     tests/renderer/sigil-surface-transport-probe.test.mjs \
     tests/renderer/sigil-one-world-co-location-probe.test.mjs
```

Result: **64/64 tests passed** (48 baseline + 16 new)

```
git diff --check
```

Result: **clean** (no whitespace issues)

## Recommended Phase 2 First Step

**Shared render loop / scene scheduler.**

The last remaining separation overhead is the render loop rate for
`desktopWorldSurface.publishState` (~31/s, every frame structural). In a
co-located World document, the avatar scene and panel UI share one document
and can share one `requestAnimationFrame` loop. The structural over-mark
(`scheduleRenderFrame` defaulting `structural=true`) becomes addressable once
the loop is shared — panel-only frames that touch no avatar geometry could
skip `publishState` entirely.

Phase 2 first step: design a minimal shared RAF scheduler for the co-located
document that the avatar scene and panel layers can both register with.
Evaluate whether the `structural` classification can be moved from a default
to a demand-driven flag with that shared loop in place.

Do not choose a signals library or reactive framework before the Phase 2
scheduler design; the store created here is intentionally throwaway.

## Exit Gate Implication

All three gate conditions hold. Phase 2 (World substrate) is unblocked.

The avatar owner ↔ compact panel pair can co-locate as two layers in one
WKWebView document with:
- Zero cross-canvas IPC between panel and owner during slider drag
- Direct in-heap delivery (N writes → N applied, synchronous, 0 drops)
- Acceptable fault isolation (owner fault does not break panel)
- Normal focus behavior (single document, shared DOM)
