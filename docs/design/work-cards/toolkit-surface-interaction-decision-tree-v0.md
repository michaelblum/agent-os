# Toolkit Surface Interaction Decision Tree And First Audit V0

## Tracker

- Epic: #223 AOS Surface System
- Related issues: #122 StageAffordance / visual-hit binding, #120 input event
  identity, #123 warm/suspend/resume lifecycle, #261 panel/window placement,
  #305 Sigil remodel
- Follows:
  `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md` and
  `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Document, lightly enforce, and apply the AOS surface interaction decision tree
so future agents choose the right interaction mechanism before adding WebViews,
daemon policy, private app hit testing, or new stage layers.

The output should make the platform philosophy executable enough that a future
developer can answer: "Should this use DOM hit testing, daemon input regions,
StageAffordance, a full interactive canvas, or a private app renderer?"

Make this slice wider than a pure docs pass, but keep it bounded around one
coherent deliverable:

1. a canonical decision tree;
2. local guardrails where agents actually enter the affected code;
3. a first conformance audit of the current surface stack;
4. cheap deterministic verification that the contract remains discoverable.

## Read First

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/recipes/gdi-work-card-authoring.md`
- `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 223 --json number,title,state,url,body,labels
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 261 --json number,title,state,url,body,labels
```

If `./aos ready` reports the known repo-mode TCC blocker, do not run live
pointer smoke. This slice is docs/contract/test oriented and can proceed with
deterministic verification.

## Existing Code And Docs To Inspect

- `packages/toolkit/panel/stage-affordance.js` - StageAffordance contract.
- `packages/toolkit/runtime/resource-scope.js` - resource ownership model.
- `packages/toolkit/runtime/input-region.js` - daemon input-region helper.
- `packages/toolkit/runtime/input-events.js` - input event normalization.
- `packages/toolkit/panel/chrome.js` - current minimized-chip client.
- `packages/toolkit/panel/drag-transfer.js` - passive stage visual precedent.
- `packages/toolkit/components/desktop-world-stage/` - passive stage renderer.
- `packages/toolkit/components/canvas-inspector/` - diagnostic surface
  precedent and future visibility target.
- `apps/sigil/` - second-client candidate; audit only, no migration.
- `src/daemon/unified.swift` - daemon input-region and lifecycle routing.

## Required Decision Tree

Document the choices in priority order. The exact wording can change after code
inspection, but the tree must cover these cases:

1. **DOM interaction inside an already interactive canvas.** Use normal DOM
   controls and accessibility semantics when the visual and hit area live inside
   the same interactive WebView.
2. **Toolkit panel/windowing behavior.** Use toolkit panel/windowing primitives
   for panel chrome, placement, drag, resize, minimize, maximize, restore, and
   close. Do not add app-private chrome for ordinary panel behavior.
3. **Passive DesktopWorld visual with small hit areas.** Use StageAffordance
   backed by `createResourceScope` and daemon input regions. Examples:
   minimized chips, lightweight global affordances, transient restore/close
   controls, simple desktop-world markers that need clicks.
4. **Visual-only global decoration or diagnostic layer.** Use the shared
   DesktopWorld stage without input regions when there is no hit area.
5. **Full interactive surface.** Use a real canvas/WebView only when the UI
   needs rich DOM interaction, focus, forms, menus, keyboard navigation, or
   independent application state.
6. **Private app renderer or 3D stage.** Allow this only when the app needs a
   distinct renderer lifecycle, richer graphics, or product expression that the
   shared 2D stage cannot provide. Sigil avatar/effects can fit here, but simple
   app panels and chips should not.
7. **Daemon primitive.** Add daemon work only for generic native capability:
   lifecycle, display topology, input routing, resource cleanup, identity, or
   performance primitives. Do not move product/windowing policy into daemon.

## Required First Audit

Add or update a durable audit note that applies the decision tree to current
surface code. The exact home is up to inspection, but prefer one of:

- `docs/design/aos-surface-system.md` if the audit is concise enough to live
  with the design contract;
- `docs/design/aos-canon-surface-boundary-alignment-plan.md` if it reads like
  alignment debt and issue routing;
- a new focused design note if the table would make either file too noisy.

The audit must classify at least these surfaces:

- default minimized chips;
- explicit WebView minimized-chip fallback;
- panel chrome minimize, maximize, restore, close, drag, and resize behavior;
- drag transfer visuals;
- DesktopWorld stage layers;
- Surface Inspector/action controls;
- daemon input regions and canvas lifecycle events;
- daemon Sigil-specific input paths, if still present;
- Sigil `avatar-main` and product visuals;
- Sigil radial/menu/extension affordances, if discoverable.

For each surface, record:

- current mechanism;
- target mechanism under the decision tree;
- whether it is acceptable now, transitional, or needs migration;
- the owning tracker or follow-up issue, such as #120, #122, #123, #261, #303,
  or #305;
- the next practical slice if action is needed.

Do not over-audit unrelated app code. The point is to make surface architecture
debt visible enough for Foreman to route the next GDI or Operator slice.

## Enforcement Expectations

Keep enforcement cheap and useful:

- update the canonical docs/API/subtree guidance where future agents will read
  it;
- create a recipe or similarly discoverable canonical page if that is cleaner
  than burying the decision tree in a long design note;
- add or extend a deterministic docs/contract test if the repo has an obvious
  place for it;
- add narrow guardrail language to `packages/toolkit/panel/AGENTS.md` and
  `apps/sigil/AGENTS.md` if needed;
- keep subtree guidance as pointers to the canonical tree instead of duplicating
  the whole contract in every `AGENTS.md`;
- do not create a broad linter or policy engine in this slice.

If adding a docs/contract test, prefer checking for stable headings, issue
anchors, and exported primitive names over matching long prose. Good targets are
the canonical decision-tree page, toolkit API docs, and the Sigil/toolkit local
guardrails.

## Scope

This is docs/governance, first audit, and optional small deterministic tests. It
should not change runtime behavior unless inspection reveals an extremely small
naming or export doc correction needed to keep the contract coherent.

## Hard Boundaries / Non-Goals

- no Sigil migration;
- no daemon changes;
- no new window manager implementation;
- no lifecycle warming implementation;
- no Surface Inspector UI implementation;
- no live pointer smoke while repo-mode TCC is blocked;
- no broad refactor of existing tests.
- no opening, closing, or relabeling GitHub issues from this slice unless the
  work card is explicitly amended; Foreman owns final issue hygiene after
  reviewing the completion report.

## Suggested Implementation Areas

- Add a canonical recipe such as
  `docs/recipes/aos-surface-interaction-decision-tree.md`, or explain in the
  completion report why an existing design/API page is the better canonical
  home.
- Add a focused section to `docs/api/toolkit.md`.
- Add a cross-reference in `docs/design/aos-surface-system.md` or
  `docs/design/aos-canon-surface-boundary-alignment-plan.md`.
- Add local guardrail language in `packages/toolkit/panel/AGENTS.md`.
- Add local guardrail language in `packages/toolkit/runtime/AGENTS.md` if the
  decision tree changes how runtime helpers should be introduced.
- Add Sigil-specific caution in `apps/sigil/AGENTS.md`: do not remodel Sigil
  until reusable primitives are locked, and use the decision tree before adding
  private DesktopWorld/UI behavior.
- If adding a deterministic test, prefer a small Node docs-contract test that
  checks for key decision-tree anchors rather than brittle prose matching.
- Add a short "what changed since the StageAffordance/ResourceScope slices"
  paragraph to the chosen design note so a fresh agent can connect the current
  audit to the accepted GDI work.

## Verification

Run:

```bash
git diff --check
```

If you add or modify docs/contract tests, run those exact tests. If the workflow
router recommends broader checks, include them in the completion report.

If any executable toolkit code changes, also run:

```bash
node --test tests/toolkit/*.test.mjs
```

## Completion Report

Include:

- files changed;
- where the decision tree lives;
- where the first conformance audit lives;
- audit findings grouped as acceptable, transitional, and needs follow-up;
- any enforcement or tests added;
- exact tests run with result;
- live smoke result or exact readiness blocker;
- recommended next slice: panel/windowing normalization (#261), Canvas
  Inspector visibility, lifecycle warming (#123), input identity (#120), or
  daemon Sigil-specific cleanup (#303).
