# AOS Canon And Surface Boundary Alignment Plan

**Date:** 2026-05-11
**Status:** Surface Stack V0 integration checkpoint
**Epic:** AOS Surface System, GitHub #223

## Why This Exists

The repo already has a strong architecture philosophy, but the lore is spread
across root instructions, architecture docs, toolkit docs, Sigil docs, design
notes, and implementation leftovers. Smart agents can still infer the wrong
thing when a performance bug crosses layers. The minimize-chip investigation is
the current example: the slow path is a toolkit windowing policy implemented
with an overly heavy daemon canvas primitive, not proof that the daemon should
own all windowing policy.

This plan makes the intended direction explicit enough that future agents should
default to the right architecture even before a human asks probing questions.

## Canonical Boundary

AOS has three surface layers:

1. **Daemon/kernel.** Own native capabilities and generic contracts: canvas
   lifecycle, native frames, display topology, content serving, input streams,
   lifecycle routing, cleanup, voice, and coordination. It should expose cheap
   primitives a surface system can use, but it should not encode app-specific UI
   policy or become the default AOS window manager.
2. **Toolkit/default surface system.** Own reusable opt-in policy: panel chrome,
   controls, workbench shells, placement, window state, minimize/maximize/restore,
   DesktopWorld visual stages, visual/interaction bindings, and a future surface
   manager. Developers can use, customize, or bypass this layer.
3. **Apps.** Own product expression, domain state, content, theming, and special
   behavior. Sigil is the first opinionated app built on the platform, not a
   reason to fork platform concepts inside `apps/sigil/`.

The boundary rule is: move native mechanics down, move reusable policy to the
toolkit, and keep product expression in apps. When the toolkit is slow, look for
the missing daemon primitive before moving policy into Swift.

## Contradictions And Drift Found

1. **DesktopWorld ownership language conflicts with the shared stage.**
   `ARCHITECTURE.md` said a DesktopWorld surface has one owning app and
   multi-tenant surfaces are out of scope. The toolkit now has a shared
   DesktopWorld stage with layer upsert/remove messages. Resolution: a raw
   native DesktopWorld surface still has one owner, but a toolkit-owned shared
   stage can expose multi-consumer layer policy.

2. **The surface-system note called the stage daemon-managed.**
   The code provides a toolkit stage component hosted on a daemon
   `--surface desktop-world` canvas. Resolution: the daemon owns the primitive;
   the toolkit owns default stage policy and messages.

3. **Daemon input ownership must stay product-neutral.**
   `src/daemon/unified.swift` previously kept `SigilInputState`,
   `sigil_input_mode`, and hard-coded canvas ids such as `avatar` and
   `agent-chat`. Resolution: Sigil now claims avatar/context-menu native input
   through generic `input_region.*` primitives; keep future product policy in
   apps or toolkit layers.

4. **Toolkit minimize policy is correct-layer policy using an overly heavy
   primitive.**
   `packages/toolkit/panel/chrome.js` creates an interactive minimized-chip
   WebView and then suspends/resumes canvases. Resolution: keep minimize policy
   in toolkit, but render simple chips through the shared DesktopWorld stage and
   route their hit areas through explicit interaction surfaces or daemon
   input-region primitives.

5. **Sigil is both platform proof and private platform fork.**
   Sigil already uses toolkit runtime and DesktopWorld adapters, but it still
   owns `avatar-main` as a private full-coverage stage and carries its own
   hit-target lifecycle. Resolution: treat `avatar-main` as an acceptable
   transitional 3D renderer boundary, not as the pattern for future apps. Extract
   generic stage, binding, and input contracts before further Sigil-specific
   expansion.

6. **Provider-specific docs carried more toolkit detail than local AGENTS.**
   Root guidance says specialized guidance belongs in subtree `AGENTS.md`, while
   `packages/toolkit/CLAUDE.md` and `src/CLAUDE.md` were the detailed local
   guides. Resolution: add provider-neutral subtree `AGENTS.md` files and leave
   provider-specific files as compatibility surfaces.

## Surface Stack Normalization Roadmap

This work now lives under #223 as the umbrella epic. Older overlapping issues
should be folded into the same track instead of creating parallel surface
systems.

### Step 1: Accept The Current Chip Slice

The #304 implementation is accepted as a V0 proof: default minimized chips are
now represented as DesktopWorld stage layers with daemon input regions, with the
old WebView chip retained as fallback. The stage-backed path now has live
real-pointer proof after the `canvas.info` shared-readiness correction: an
existing shared `aos-desktop-world-stage` can be owned by another canvas, the
minimize path reports `stageEnsureStatus.status: "already_exists"`, registers
restore/body/close input regions, suspends promptly, avoids default
`aos-chip-*` fallback WebViews, and cleans up chip layers and regions on
restore, close, and duplicate minimize.

### Step 2: Finish The Daemon Contract Baseline

#303's generic input-region primitive exists, and Sigil's daemon product branch
has been retired in favor of app-owned input-region claims. The product-branch
exit criterion is satisfied unless Foreman GitHub review finds a narrower
remaining contract gap in the issue text.

### Step 3: Add Toolkit Runtime Resource Scope

`createResourceScope` now provides the reusable ownership and cleanup pattern
for child canvases, stage layers, input regions, subscriptions, bridge handlers,
and custom cleanup callbacks. StageAffordance and inspector visibility use this
as the V0 resource baseline.

### Step 4: Extract StageAffordance

`createStageAffordance` now binds passive stage layers to explicit daemon input
regions with deterministic cleanup and ownership metadata. Default minimized
chips use it in the stage-backed path, and the WebView chip remains an explicit
fallback.

### Step 5: Document The Interaction Decision Tree

Make it clear when a surface should use DOM hit testing, daemon input regions,
toolkit StageAffordance, a full interactive canvas, or a private app renderer.
This prevents "just use a WebView" and "put it in the daemon" from becoming the
default answers.

Status: the canonical decision tree and first conformance audit live in
`docs/recipes/aos-surface-interaction-decision-tree.md`.

### Step 6: Normalize Panel And Windowing Under #261

`createPanelWindowController` is the public toolkit policy path for ordinary
panel placement, minimize, maximize, restore, drag, resize, close, fallback
behavior, final placement clamps, and cross-display transfer. The daemon
supplies primitives; toolkit owns default policy. Remaining #261 work should be
limited to private shell migrations or narrower placement gaps found in issue
review.

### Step 7: Improve Surface Inspector Visibility

Surface Inspector now shows canvases, stage layers, affordances, input regions,
owners, resource-scope metadata, and stale/incomplete resource hints. This is
the V0 diagnostic baseline for Foreman, GDI, Operator, and users to see what
the surface system is doing.

### Step 8: Handle Lifecycle Warming

#123 now has the V0 lifecycle primitives: `warmCanvas`,
`waitForCanvasReady`/status-ready helpers, `canvas.info`, suspend, resume, and
metadata-aware readiness checks. Further #123 work should name gaps beyond this
warm/suspend/resume V0 baseline.

### Step 9: Migrate Sigil In Bounded Platform-Consumer Slices

The broad Sigil stage remodel remains deferred. Bounded #305 work has already
landed: Sigil's input-region adapter, the toolkit DesktopWorld hit-region
controller, avatar/radial physical lifecycle migration, child source identity
cleanup, radial item panel/window controller migration, and the second-client
surface inventory. The inventory found no additional obvious live private
platform path to migrate in V0: remaining private 3D renderer behavior is Sigil
product expression, and remaining raw private windowing hits are parked legacy
surfaces. Foreman reran the canonical real-input radial scenario and confirmed
Surface Inspector visibility, avatar fast travel, radial semantic-target
capture, final action selection, and cleanup. GDI then rebuilt the real-input
surface scenarios on reusable AOS-derived test primitives and added
topology-neutral DesktopWorld path radial coverage. Foreman closed #305 as an
accepted V0 second-client checkpoint; future Sigil work should be opened as
exact follow-up cards.

### Step 10: Retire Transitional Paths

Retire or mark transitional code paths once their replacements are proven:
WebView chip fallback, private panel drag paths, Sigil product-named daemon
input paths, and historical native chrome ideas.

## Earlier Phase Map

The earlier phase names remain useful for grouping the same roadmap:

### Phase 0: Lore Permeation

Add boundary narrative in root, architecture, `docs/api/aos.md`, `src/`,
`src/daemon/`, `packages/toolkit/`, `packages/toolkit/runtime/`,
`packages/toolkit/controls/`, `packages/toolkit/panel/`, and Sigil docs. This
phase should be kept small and direct: it makes the current philosophy loud
without pretending all code already conforms.

### Phase 1: Toolkit Default Windowing

Promote the current panel/chrome work into an explicit default AOS windowing
package or panel contract. Keep it optional and customizable. The first
performance-driven implementation slice should replace WebView-backed minimized
chips with shared-stage visuals plus explicit hit routing.

### Phase 2: DesktopWorld Stage Contract

Make the 2D shared stage and future 3D stage contract explicit. Define when an
app should use shared stage layers, when a private DesktopWorld renderer is
allowed, and how visual layers bind to interaction regions, panels, menus, and
semantic targets.

### Phase 3: Daemon Generic Input Regions

Turn daemon-side input consumption into a generic platform primitive. Sigil is
now a consumer of the same input-region contract that toolkit chips, radial
items, context menus, and future apps use; future work should harden that shared
contract instead of adding app-named branches.

### Phase 4: Sigil Remodel

Reframe Sigil as an app provider of avatar/radial/effects layers plus product
state. Keep its 3D renderer where it is genuinely needed, but route simple
desktop layers through toolkit stages and route hit targets through the generic
binding/input system.

### Phase 5: Agent Guardrails

Add tests or lint-like checks where cheap: docs should point to provider-neutral
AGENTS, daemon code should not introduce new product-named input branches, and
toolkit/app code should not add private window chrome without a local boundary
note.

## Current Work Routing

1. Use `docs/design/aos-surface-stack-v0-integration-ledger.md` as the
   closure ledger for #304, #303, #122, #120, #123, #261, #305, #118, #119,
   and #45.
2. Foreman reconciled GitHub issue scope on 2026-05-12: #304, #303, #122,
   #120, #123, #261, #305, #118, and #119 are closed as accepted V0 or folded
   V0; #45 remains open but parked.
3. Keep the explicit WebView minimized-chip path as fallback only until
   confidence and telemetry justify retirement.
4. Treat Sigil second-client implementation work as accepted and closed for V0.
   Do not keep a broad Sigil remodel umbrella open; create exact follow-up cards
   for product revival of parked surfaces, Agent Terminal compatibility-path
   retirement, or a shared 3D stage only when a concrete cross-app need appears.

## Issue Map

- Epic #223: AOS Surface System.
- Issue #304: stage-backed minimized chips. Closed as accepted V0.
- Issue #122: toolkit-owned DesktopWorld hit-region controller. Closed as
  accepted V0; broader pointer-capture/router claims stay under #118/#119.
- Issue #303: daemon generic input regions. Closed as accepted V0.
- Issue #120: daemon/toolkit input event identity contract. Closed as accepted
  V0; future `assumeInside` compatibility retirement should be a narrow cleanup
  if needed.
- Issue #123: warm, suspend, and resume lifecycle primitives. Closed as
  accepted V0.
- Issue #261: panel window placement contract and private drag migration.
  Closed as accepted V0 after the placement-contract closure audit.
- Issue #302: AOS surface canon lore must be consistent across layers.
- Issue #305: remodel Sigil as first-class consumer of AOS surface platform.
  Closed as accepted V0 after final real-input radial and topology-neutral
  DesktopWorld path verification; future work should be exact follow-up cards,
  not broad primitive extraction.
- Issue #118: DesktopWorld interaction regions with pointer capture. Closed as
  accepted V0 after the interaction-router closure audit; future router
  hardening should name a new precise gap.
- Issue #119: older DesktopWorld interaction/warmed UI epic. Closed as folded
  V0 because its child claims are accepted under #118, #120, #122, #123, #303,
  #304, and #305.
- Issue #45: park as historical/native chrome idea unless native chrome becomes
  a concrete, opt-in surface strategy again.

Keep this design note and the integration ledger as the narrative source, with
GitHub issues as execution trackers.
