# Sigil Workbench Consumer Boundaries — Design

**Session:** sigil-workbench-tight-loop  
**Date:** 2026-04-14  
**Status:** Draft  
**Scope:** Define the correct layering and ownership for the Sigil multi-tab workbench and the first-pass operator ergonomics requested in live testing: title, frame sizing, avatar default size, and Studio-driven avatar staging.  
**Out of scope:** Broad daemon/runtime feature work unless a missing lower-layer primitive is proven necessary by at least this consumer plus a credible second consumer shape. No speculative platform APIs.

## Problem

The first pass at the Sigil workbench surfaced a design failure more important than the individual bugs:

1. **Consumer behavior was drifting into shared layers.** Sigil-specific workstation policy started leaking toward daemon/runtime plumbing instead of staying in the Sigil consumer layer.
2. **The implementation expanded before the composition path was exhausted.** The repo already ships a layered path:
   - Layer 0: daemon/canvas primitives
   - Layer 1: runtime + panel primitives
   - Layer 2: reusable toolkit content
   - Layer 3: Sigil as a consumer
3. **The requested fixes are mostly consumer policy, not platform capability.**
   - `"SIGIL WORKBENCH"` should be `"SIGIL"`
   - the workbench should occupy the trailing two-thirds of one display with margin on all sides
   - default avatar size should be no larger than 200 px in normal stance
   - when Studio is up, the avatar should stage itself in the top-left nonant of the display hosting Studio

The platform/ecosystem framing matters here: Sigil is one consumer among many future ones. Shared layers must stay generic, reusable, and decoupled from Sigil’s staging preferences.

## Design principles

These are the constraints for this work:

1. **Use existing lower layers first.** If Layer 0/1/2 already provides the needed capability, compose it.
2. **If a lower-layer primitive is missing, add the smallest generic primitive.** Do not encode Sigil policy in shared layers.
3. **Consumer policy stays with the consumer.** Sigil-specific defaults, layout, staging, and orchestration belong in `apps/sigil/`.
4. **No platform work by accident.** A lower-layer extraction must be justified as a reusable primitive, not a convenience for the current consumer.
5. **Tight-loop changes stay decomposed.** Each change should be independently testable in the live operator loop.

## Existing composition path

The correct composition for the current workbench is:

```
Layer 0   AOS daemon
          show create / update / remove / eval
          display geometry
          wiki-backed content

Layer 1   toolkit runtime + panel primitives
          mountPanel
          Tabs(...)

Layer 2   toolkit content
          CanvasInspector
          LogConsole

Layer 3   Sigil consumer
          workbench shell
          workbench launcher
          avatar renderer
          studio + chat embeds
          agent-doc defaults
```

This means the workbench should remain a Sigil-owned shell that composes:

- `Tabs(...)` from `packages/toolkit/panel/`
- `CanvasInspector` and `LogConsole` from `packages/toolkit/components/`
- Sigil-owned iframe/content surfaces for Studio and Chat
- Sigil-owned launcher geometry and Sigil-owned avatar orchestration

## Ownership decisions

### 1. Workbench title

**Owner:** Sigil consumer layer  
**Location:** `apps/sigil/workbench/index.html`

This is presentational naming for a single consumer surface. No lower-layer abstraction is involved.

### 2. Workbench frame sizing and placement

**Owner:** Sigil consumer layer  
**Location:** `apps/sigil/workbench/launch.sh`

The requested placement is Sigil-specific workstation policy:

- choose one display
- inset by margin on all four sides
- use the trailing two-thirds of that display

This is not a generic daemon or toolkit concern yet. The launcher computes the frame from display geometry and creates the canvas accordingly.

If a second consumer needs reusable “display-relative frame recipes,” that extraction can happen later as a generic helper. For now the policy stays in Sigil.

### 3. Default avatar size

**Owner:** Sigil consumer defaults  
**Locations:**
- `apps/sigil/seed/wiki/sigil/agents/default.md`
- `apps/sigil/renderer/agent-loader.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/studio/js/ui.js`

The oversized avatar is not a platform issue. It is a consumer-default mismatch:

- seed defaults still target a large avatar
- renderer fallbacks still assume 300 px
- Studio fallback writes can reintroduce 300 px on save

The fix is to align Sigil defaults so “normal stance” resolves to a size no larger than 200 px. The exact chosen value should be stable across seed, renderer fallback, and Studio fallback. `180` is the recommended default because it is visibly smaller than 200 while leaving headroom for user scaling.

### 4. Studio-open avatar staging

**Owner:** Sigil consumer orchestration  
**Primary location:** `apps/sigil/workbench/launch.sh`  
**Possible secondary location:** `apps/sigil/workbench/index.html`

The policy “when Studio is up, stage the avatar in the top-left nonant of the display Studio is on” is Sigil-specific behavior. The platform should not know anything about Studio, nonants, or Sigil staging policy.

There are two implementation tiers:

#### Tier A — launch-time staging

At workbench launch:

1. compute the workbench’s target display
2. compute that display’s top-left nonant center
3. set the avatar’s staged position via the existing renderer/CLI path

This is enough for the current tight operator loop if “Studio is up” means “the workbench launched with the Studio tab active,” which is true today.

#### Tier B — tab-activation staging

If the operator loop requires restaging whenever the Studio tab becomes active again, Sigil should own that behavior.

The preferred layering is:

- first check whether `Tabs(...)` already exposes a clean activation hook
- if not, add a **generic** tab-activation callback to the panel layer
- keep the Sigil-specific response to that callback in `apps/sigil/workbench/`

The extracted primitive, if needed, is generic:

```js
Tabs(contents, { onActivate?(info) {} })
```

The primitive is generic because any future consumer may need to react to tab activation. The policy “move avatar to the top-left nonant” remains Sigil-owned.

## Non-goals

The following are explicitly rejected for this work:

- adding Sigil-specific events or semantics to the daemon
- adding daemon-side awareness of Studio, tabs, or nonants for this feature
- adding a generic cross-canvas message bus just to move the avatar
- introducing new platform APIs before proving existing `show eval` / existing toolkit hooks are insufficient

## Recommended implementation shape

### Phase 1 — thin consumer fixes only

1. Rename the workbench title to `SIGIL`
2. Resize/reposition the workbench in the launcher
3. Reduce Sigil’s default avatar size to `180`
4. Stage the avatar to top-left nonant at workbench launch

This phase should require **no daemon changes**.

### Phase 2 — extract one missing generic primitive only if needed

If live testing shows that launch-time staging is insufficient because the operator regularly switches back to Studio and expects restaging, then:

1. add a generic tab-activation hook to `Tabs(...)`
2. keep the avatar-home action in Sigil

This is acceptable because tab activation is a real panel/layout concern, not a Sigil concern.

## Detailed design

### Workbench frame recipe

Given the chosen display’s visible bounds `{x, y, w, h}` and margins `{mx, my}`:

- usable bounds = `{x + mx, y + my, w - 2mx, h - 2my}`
- workbench width = `round(usable.w * 2/3)`
- workbench height = `usable.h`
- workbench x = `usable.x + usable.w - workbench.width`
- workbench y = `usable.y`

This places the canvas in the trailing two-thirds of the display with visible margin on all four sides.

### Avatar default

The canonical default becomes:

- `instance.size = 180`

This must be reflected in:

- the seeded default agent doc
- renderer minimal fallback
- Studio’s “new / malformed / missing doc” fallback bodies
- any renderer state defaults that visually assume 300 as the normal case

The invariant is:

> A freshly launched Sigil workbench with default agent data renders an avatar whose normal stance is no larger than 200 px.

### Studio staging target

For a display’s visible bounds `{x, y, w, h}`, the top-left nonant center is:

- `x + w * 1/6`
- `y + h * 1/6`

This is the same nonant logic already used by Sigil’s birthplace model, just with a different chosen cell.

### Tooling boundary

For launch-time staging, the launcher may use existing AOS primitives such as:

- `aos graph displays --json`
- `aos show create`
- `aos show eval`

That is still layer-correct because the launcher is a Sigil consumer orchestrating generic platform primitives.

## Acceptance criteria

1. Launching `apps/sigil/workbench/launch.sh` opens a workbench titled `SIGIL`.
2. The workbench occupies the trailing two-thirds of its display with visible margin on all four sides.
3. A default launch produces an avatar no larger than 200 px in normal stance.
4. With the workbench launched into Studio-first mode, the avatar stages to the top-left nonant of that display.
5. No Sigil-specific behavior is added to daemon or toolkit layers in Phase 1.
6. If tab-reactive staging is later implemented, the shared extraction is a generic tab-activation primitive, not a Sigil-specific shared API.

## Open questions

1. Is launch-time Studio staging sufficient for the operator loop, or is restaging-on-tab-activation required immediately?
2. Does `Tabs(...)` already expose enough structure to implement a clean Sigil-owned activation hook without a toolkit change?
3. Should the selected workbench display always be the main display, or should launch placement follow a future operator-selected target display? For this phase: main display is acceptable unless operator testing disproves it.

## References

- `docs/superpowers/specs/2026-04-14-canvas-runtime-and-toolkit-primitives-design.md`
- `packages/toolkit/panel/layouts/tabs.js`
- `packages/toolkit/components/_dev/tabs-demo/index.html`
- `apps/sigil/workbench/index.html`
- `apps/sigil/workbench/launch.sh`
