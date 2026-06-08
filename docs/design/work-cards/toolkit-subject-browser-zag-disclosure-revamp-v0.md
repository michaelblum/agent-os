# Work Card: Toolkit Subject Browser Zag Disclosure Revamp V0

## Tracker

- Parent issue: #366, "Epic: Toolkit Subject Browser facet/resource drilldown".
- Depends on merged Phase 1 Zag primitives:
  `75aacaa1caa58980abd57c61bc901cc790f08a04`.
- Expected owner: Implementer.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, issue, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the deliberate Subject Browser design revamp that follows the Zag
primitive foundation. It replaces the brittle right-rail composition with a
progressive-disclosure design, while preserving the subject/workbench contracts
already built in the current Subject Browser branch.

## Restart Guidance After Interrupted Draft

An interrupted Implementer attempt left draft work in:

```text
/Users/Michael/Code/agent-os-implementer-zag-disclosure
```

That worktree contains uncommitted edits to:

- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-subject-browser/styles.css`

Treat that diff as reference material only. It is not accepted, not reviewed,
and not the canonical starting point. Before implementing, inspect it to harvest
useful ideas, then start from current `main` unless Foreman explicitly says
otherwise. Do not copy the draft wholesale without revalidating each change
against this card.

If creating or using a sibling worktree is necessary to protect unrelated dirty
state, state that before doing it. Do not build `./aos` in a fresh worktree until
deterministic checks pass and the live proof is actually needed.

Execution order:

1. Do a read-only triage of the interrupted draft and summarize which ideas are
   worth keeping.
2. Implement the revamp in small deterministic checkpoints on top of current
   `main`: shell composition first, then Path/Clear behavior, then resource
   drilldown controls, then responsive behavior.
3. Run deterministic checks after each checkpoint that materially changes
   behavior.
4. Run live AOS proof only after the deterministic implementation is stable.
5. Stop and report if live proof needs DOM/eval activation. Do not grind through
   another long Operator-style pass.

## Foreman Review Correction

Implementer completed an implementation branch at
`implementer/toolkit-subject-browser-zag-disclosure-revamp-v0`
(`c064a3da48807e7155b577778164ed5e51c7e1b8`). Foreman review found two narrow
blockers before Operator acceptance. Do not restart the revamp and do not broaden
the UI design.

1. Bring the branch onto current `origin/main` so it includes the latest work-card
   guidance, then keep the fix path-scoped.
2. Fix `Clear` so the Subject Browser's Path, focused target, and left pane all
   return to a clean graph-root state. The current branch calls
   `workbench.onMessage({ type: 'clear-selection' })`, but Markdown Workbench only
   forwards that message to the embedded graph and leaves any previously opened
   Markdown document pane visible.
3. Remove the remaining WebView component imports from the controls barrel or
   introduce a browser-safe split. `packages/toolkit/controls/index.js` now exports
   Zag primitives that import bare `@zag-js/*` modules. Browser-loaded components
   must not import that barrel until Zag packaging is browser-safe. Foreman found
   remaining component imports in `surface-inspector` and `surface-zoom-inspector`.
4. Re-run the deterministic checks below plus a targeted import scan proving no
   shipped browser component imports `../../controls/index.js` unless it is
   intentionally Node/test-only.
5. Re-run only the bounded live acceptance flows for the two corrected areas:
   `Clear` after opening Markdown, and launch/load sanity for the components whose
   imports were changed if those launchers are available.

Second Foreman review of branch head
`0c315aee35a4047d0b69b9cffaef632e8d045757` accepted the Clear code path, but
the browser-component barrel import gate still fails. This scan must return no
browser component hits before Operator:

```bash
rg "\\.\\./\\.\\./controls/index\\.js|controls/index\\.js|from ['\\\"].*controls/index" packages/toolkit/components tests/toolkit -n
```

The remaining failing browser component imports were:

- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-zoom-inspector/index.js`

## Operator Clear Failure Correction

Operator acceptance on branch head
`1920bd23744d3e4358695864927e2fca0cfac515` reported `needs_implementer_fix`.
The import gate and inspector launch sanity passed, but native activation of a
visible `Clear` control did not reset the browser. After the click, observation
still showed the Markdown path, focused Work Record details, and Markdown content
in the left pane.

Treat this as an interaction-geometry/semantic-target failure unless code
evidence proves otherwise. The root reset control must be unambiguous and
native-clickable:

- disambiguate the top Path reset control from the Details `Clear` control and
  any other clear/reset controls;
- make the root reset control's visible label, aria label, semantic target name,
  action, and `data-aos-ref` specific enough for native target resolution;
- harden the handler path so activation of that root control clears
  `selected_path`, `focused_subject_id`, focused details, recent focus state, and
  the embedded Markdown document pane;
- preserve the separate Details clear action if it remains useful, but do not let
  it satisfy the root-reset acceptance check;
- add deterministic coverage that distinguishes root reset from Details clear;
- run a targeted live proof that opens Markdown, focuses Work Record details,
  activates the root reset control through native interaction, and then observes
  graph-root Path, no focused target, and no open Markdown pane.

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
