# Work Card: Toolkit Subject Browser Zag Disclosure Revamp V0

## Tracker

- Parent issue: #366, "Epic: Toolkit Subject Browser facet/resource drilldown".
- Depends on merged Phase 1 Zag primitives:
  `75aacaa1caa58980abd57c61bc901cc790f08a04`.
- Expected owner: GDI.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, issue, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the deliberate Subject Browser design revamp that follows the Zag
primitive foundation. It replaces the brittle right-rail composition with a
progressive-disclosure design, while preserving the subject/workbench contracts
already built in the current Subject Browser branch.

## Goal

Refactor the toolkit Subject Browser so its interaction geometry is stable,
discoverable, and guided by reusable toolkit primitives instead of one-off
nested scroll patches.

The intended outcome is:

- graph-first root remains the first screen;
- selecting a graph node still opens Markdown;
- opening or inspecting non-wiki Subjects still uses the generic Subject Browser
  model and workbench/resource hosts;
- active drilldown Path remains the hierarchy orientation anchor;
- recent Trail remains recent-open history, not breadcrumbs;
- Catalog, Index, Details, Trail, and diagnostics stop competing as one long
  vertical document;
- required controls are visible, hit-testable, and usable through native input
  at default size and `900x620`;
- `Clear` returns the left pane and Path to a clean graph-root state.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `/Users/Michael/Code/tmp/progressive-disclosure-supplement.md`
- `docs/design/work-cards/toolkit-subject-browser-corrective-plan.md` if it is
  present locally; if not, continue from this work card.
- `docs/api/toolkit/controls.md`
- `packages/toolkit/controls/zag-primitives.js`
- `packages/toolkit/controls/defaults.css`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/styles.css`
- `packages/toolkit/components/wiki-kb/views/graph.js`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- `tests/toolkit/controls-zag-primitives.test.mjs`

## Design Principles To Apply

Use the progressive disclosure supplement as a hard design constraint:

- classify every region as must-see, nice-to-see, contextual, or diagnostic
  before placing it;
- show only what the user needs for the current decision, with obvious paths to
  more depth;
- keep most flows to initial + one secondary layer;
- never hide controls whose absence causes errors;
- use tabs only for peer contexts;
- use drilldown and breadcrumbs/path fragments for hierarchy;
- use accordions for peer lists with expandable details;
- use collapsibles for diagnostic/raw/debug sections;
- use popovers for contextual preview/help near a trigger;
- use tooltips for icon-only controls;
- do not make a three-dot menu the only path to a primary action.

For this browser specifically:

- Catalog, Index, Details, and Trail are peer workbench contexts. They should not
  all compete as always-visible vertical sections.
- Subject/resource hierarchy is a drilldown path. It should not be modeled as
  tabs.
- Raw JSON, debug state, and diagnostic metadata should be collapsed by default.
- Primary actions for the active target must stay visible and at least `44px`.

## Proposed Shape

Use the merged Phase 1 controls rather than adding another private layout system:

- `<aos-splitter>` or `createSplitter()` for graph/viewer versus workbench
  regions where resizing is useful.
- A small peer-context switcher for Catalog / Index / Details / Trail. If
  `<aos-tabs>` is not available in the public controls layer yet, keep the
  switcher small and explicit, and document that it should move to tabs when
  Phase 2 tabs land.
- `createAccordion()` for Subject lists and resource lists where rows expose
  secondary details.
- `createCollapsible()` for raw JSON, diagnostics, and debug-only metadata.
- `createPopover()` for Subject preview cards or contextual detail that should
  not take over the persistent panel.
- `createTooltip()` for icon-only controls.
- `createDialog()` only for confirmation/destructive flows, if any are added.
- `createMenu()` only for coherent rare overflow actions, never for primary
  Inspect/Open/Back/Clear actions.

## Acceptance Flows

The revamp must pass these live flows without DOM/eval activation:

1. Fresh default launch shows graph root, top Path toolbar, and a clear
   workbench context without critical overlap.
2. Native graph-node click opens Markdown and adds a recent Trail entry.
3. Native Catalog or Index `Open` hit-tests to the visible button and adds
   recent Trail history.
4. Work Record `Inspect -> health` reaches readable JSON through visible native
   controls; `Inspect` does not add recent history.
5. Sigil `Inspect -> logical_items -> Wiki Graph` reaches the three-entry Path
   and visible JSON host through visible native controls.
6. Path ancestor clicks restore the relevant Subject/resource ancestor.
7. `Clear` resets Path, focused target, and left pane to a clean graph-root
   state.
8. At `900x620`, the Sigil path remains reachable through normal controls and
   ordinary scrolling; no sticky region or peer context may cover required
   controls.

Bounded `./aos show eval` is allowed only for observation after native
interaction, never for activation or forcing state.

## Boundaries / Non-Goals

- Do not move Subject Browser policy into the daemon.
- Do not change Sigil product behavior except through generic Subject Browser
  compatibility.
- Do not collapse Trail into Path or Path into Trail.
- Do not make radial menu items graph nodes; resources remain resources until a
  product decision says otherwise.
- Do not add app-specific hacks for Work Record or Sigil. If a layout problem is
  generic, solve it in the browser shell or toolkit controls.
- Do not add tabs/tree-view package scope unless Foreman explicitly routes a
  Phase 2 primitive slice first.

## Verification

Run deterministic checks:

```bash
node --check packages/toolkit/components/wiki-subject-browser/index.js
node --check packages/toolkit/components/wiki-subject-browser/model.js
node --check packages/toolkit/components/wiki-kb/views/graph.js
node --check packages/toolkit/controls/zag-primitives.js
node --test tests/toolkit/wiki-subject-browser.test.mjs
node --test tests/toolkit/controls-zag-primitives.test.mjs
node --test tests/toolkit/workbench-subject.test.mjs tests/toolkit/radial-menu-subject.test.mjs tests/schemas/aos-workbench-subject.test.mjs tests/renderer/radial-item-editor.test.mjs
git diff --check
```

Run live AOS proof only after deterministic checks pass:

```bash
./aos ready
CANVAS_ID=wiki-subject-browser-v0 packages/toolkit/components/wiki-subject-browser/launch.sh
```

Then verify the acceptance flows above at default size, clean up the canvas, and
repeat the Sigil path at `900x620`.

## Completion Report

Report back to Foreman with:

- branch/head SHA;
- files changed;
- which Zag primitives are now consumed and where;
- how the progressive disclosure supplement shaped the new layout;
- deterministic tests run with exact pass/fail counts;
- default-size live proof;
- `900x620` live proof;
- canvas cleanup result;
- residual design risks or Phase 2 primitive needs.
