# Sigil Workbench Consumer Boundaries Implementation Plan

> **For agentic workers:** keep implementation small and layer-correct. Do not add daemon/runtime behavior unless this plan explicitly proves the consumer-layer path is insufficient.

**Goal:** Implement the first-pass Sigil workbench ergonomics without mixing concerns across platform layers. Use existing daemon/toolkit composition first. Extract a generic lower-layer primitive only if the consumer path is demonstrably inadequate.

**Spec:** `docs/superpowers/specs/2026-04-14-sigil-workbench-consumer-boundaries-design.md`

**Principle:** Sigil is one consumer in a future ecosystem. Shared layers remain generic; Sigil policy stays in `apps/sigil/`.

---

## Phase 0 — Clean boundary reset

- [ ] Revert any in-flight daemon/runtime changes made solely for Sigil workbench behavior.
- [ ] Confirm the workbench still composes the existing toolkit `Tabs(...)` layout rather than reimplementing tabs.
- [ ] Confirm no new shared-layer API remains unless it can be defended as generic.

**Done when:** the diff contains only Sigil-layer changes, plus any generic lower-layer extraction explicitly justified by later phases.

---

## Phase 1 — Consumer-only fixes

### Task 1: Rename the workbench title

**Files:**
- `apps/sigil/workbench/index.html`

- [ ] Change the document title and panel title to `SIGIL`.
- [ ] Verify the mounted workbench reports `SIGIL` via `aos show eval`.

**Verification:**

```bash
./aos show eval --id sigil-workbench --js 'document.title'
./aos show eval --id sigil-workbench --js 'document.querySelector(".aos-title")?.textContent'
```

Expected: both return `SIGIL`.

### Task 2: Fix workbench geometry in the launcher

**Files:**
- `apps/sigil/workbench/launch.sh`

- [ ] Compute frame from display visible bounds, not hardcoded width/height.
- [ ] Use the display’s trailing two-thirds with margin on all four sides.
- [ ] Keep the logic entirely in the Sigil launcher.

**Verification:**

1. Launch the workbench:

```bash
apps/sigil/workbench/launch.sh
```

2. Inspect the canvas:

```bash
./aos show list --json
```

Expected: `sigil-workbench` frame is inset on all sides and uses roughly two-thirds of the chosen display width.

### Task 3: Reduce default avatar size

**Files:**
- `apps/sigil/seed/wiki/sigil/agents/default.md`
- `apps/sigil/renderer/agent-loader.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/studio/js/ui.js`
- any Sigil-owned default doc creation/fork helpers that still write `size: 300`

- [ ] Replace the old 300 px default with `180`.
- [ ] Align all Sigil-owned fallback/default sources to the same value.
- [ ] Ensure Studio writes do not reintroduce `300`.

**Verification:**

1. Seed/reseed default agent.
2. Launch avatar + workbench.
3. Inspect:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify({ size: window.liveJs.avatarSize, base: window.state.avatarBase })'
```

Expected: default values correspond to the new smaller size, and the rendered orb is visibly under 200 px in normal stance.

### Task 4: Stage avatar at workbench launch

**Files:**
- `apps/sigil/workbench/launch.sh`

- [ ] Compute the workbench display from the launch target.
- [ ] Compute that display’s top-left nonant center.
- [ ] Use existing platform primitives to stage the avatar there at launch.
- [ ] Keep the behavior Sigil-owned.

**Verification:**

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.liveJs.avatarPos)'
```

Expected: avatar position is near the top-left nonant center of the workbench’s display.

---

## Phase 2 — Decide whether a generic tab-activation primitive is needed

This phase is conditional. Do not implement it unless live testing proves that launch-time staging is insufficient.

### Decision gate

- [ ] Test the operator loop with the Phase 1 behavior.
- [ ] Determine whether restaging on Studio tab activation is a real requirement.

If the answer is **no**, stop. Do not add more shared-layer code.

If the answer is **yes**, continue to Task 5.

### Task 5: Extract a generic tab activation hook

**Candidate shared files:**
- `packages/toolkit/panel/layouts/tabs.js`
- `packages/toolkit/panel/index.js`
- docs as needed

- [ ] Add a small generic activation callback or event to `Tabs(...)`.
- [ ] Do not mention Sigil in the toolkit API.
- [ ] Keep the callback about tab lifecycle only.

Example shape:

```js
Tabs(contents, {
  onActivate(info) {}
})
```

Where `info` is generic, for example:

```js
{ index, title, manifest }
```

### Task 6: Consume the hook in Sigil

**Files:**
- `apps/sigil/workbench/index.html`

- [ ] Use the generic activation hook to react when `Studio` becomes active.
- [ ] Keep the avatar staging logic in Sigil.
- [ ] Avoid new daemon/runtime abstractions if existing `aos show eval` orchestration is sufficient.

**Verification:**

1. Switch from another tab back to Studio.
2. Confirm the avatar restages to the top-left nonant of the same display.

---

## Constraints

- [ ] No Sigil-specific behavior added to daemon/runtime in Phase 1.
- [ ] No generic lower-layer work without a clear reusable primitive.
- [ ] No ad hoc cross-canvas message bus for this feature.
- [ ] Keep the implementation decomposed into small, reviewable commits.

---

## Suggested commit order

1. `fix(sigil): rename workbench surface to SIGIL`
2. `fix(sigil): size workbench as trailing two-thirds of display`
3. `fix(sigil): reduce default avatar size to 180`
4. `feat(sigil): stage avatar to studio display at launch`
5. Optional only if required: `feat(toolkit): add generic tabs activation hook`
6. Optional only if required: `feat(sigil): restage avatar on studio tab activation`

---

## Acceptance summary

- [ ] Workbench title reads `SIGIL`
- [ ] Workbench occupies the trailing two-thirds of one display with margins
- [ ] Default avatar size is no larger than 200 px in normal stance
- [ ] Studio-first launch stages avatar in the top-left nonant of the workbench display
- [ ] Shared layers remain generic and decoupled from Sigil policy
