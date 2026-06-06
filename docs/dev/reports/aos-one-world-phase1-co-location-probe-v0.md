# AOS One-World Phase 1 — Co-location Probe V0

Date: 2026-06-05

Branch: `gdi/aos-one-world-phase1-co-location-probe-v0`

Start ref: `1e4d4fde2325ccd96f88fccbce5837d2f459bf1d`

## Status

`complete` — Phase 1 exit gate met. All three conditions confirmed.

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

**PASSED.**

In the co-located path, `panel_messages.sent` stays 0 during a slider drag
because `sendToOwner` is never called. Control changes write directly to
`sharedStore` instead of posting to the daemon bridge.

**Evidence (50 synthetic events, Node, no native drag needed):**

```
panel_messages.sent: {}   (0 cross-canvas IPC — baseline was 82.8/s at native rate)
panel_messages.received: {}
in_heap.writes: 50
in_heap.applied: 50
```

This confirms that `control_change` and `snapshot` cross-canvas IPC are fully
eliminated for the co-located pair. These two message types accounted for
1222 total messages (82.8/s) in the Phase 0 Test 3 native drag.

### Gate 2: Slider-drag is direct

**PASSED.**

N slider events → N in-heap store writes → N owner applies, synchronously,
with no daemon round-trip visible. Writes equal applied with zero drops and
zero duplicates across 50-event batch and 20-event batch tests.

**Evidence:**

```
Test: N=50 slider events
  in_heap.writes:  50
  in_heap.applied: 50
  applied[49].values.size: 49   (last value arrived correctly)

Test: N=20 slider events
  writeCount:  20
  applyCount:  20
  in_heap.writes:  20
  in_heap.applied: 20
```

### Gate 3: Focus and fault behavior acceptable

**PASSED.**

- **Focus:** The co-located document is a single WKWebView. Input reaches the
  slider through normal DOM event routing. There is no focus boundary between
  panelLayer and ownerLayer — they share the same document. The existing panel
  chrome and form controls are unchanged.

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

| Metric | Phase 0 (separated) | Phase 1 (co-located) |
|--------|---------------------|----------------------|
| `control_change`/s (cross-canvas) | 20.7/s (total: 611) | **0** |
| `snapshot`/s (cross-canvas) | 20.7/s (total: 611) | **0** |
| Cross-canvas IPC total | 82.8/s (1222 total) | **0** |
| `publishState`/s | 31/s (render loop) | 31/s (unchanged — not panel↔owner) |
| Structural frame rate | 100% (render loop) | 100% (unchanged — Phase 2) |
| In-heap writes | N/A | N writes per N slider events |
| In-heap applied | N/A | N (matches writes, 0 drops) |

Phase 0 was measured via native CGEvent drag (29.5s, `--speed 30`). Phase 1
was measured via 50 synthetic events in Node (same methodology as Phase 0
Test 1). The in-heap path is a direct function call, not subject to WKWebView
throttling or daemon serialization.

## Live AOS Result

The `local_relay` profile for this work card does not require a live native
drag verification — the deterministic test is the gate evidence per the same
methodology as Phase 0 Test 1. A live AOS session was not available for a
native drag confirmation due to the panel-suspension precondition documented
in Phase 0 (panel requires live agent vitality to receive OS mouse events).

If Foreman wants a live native drag confirmation against the co-located
document (loading `co-located-panel.html` instead of `panel.html`), the
existing probe infrastructure supports it via `window.__sigilCoLocatedProbeDebug`.

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
