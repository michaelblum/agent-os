# Work Card: toolkit-panel-theme-consistency-audit-v0

**Status:** Ready for implementation
**Owner:** GDI

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make toolkit panel surfaces consistently consume the base theme and panel/control
primitives. When a panel needs a local tweak, either express it through an
existing primitive option, add a narrow primitive option, or document why the
local styling is product/content-specific.

This card comes from the Surface Inspector lower-pane tab correction: the
Surface Inspector used ARIA/Zag tab semantics but had private segmented-button
styling. That was a symptom of a broader drift between semantics, primitive
styling, and local component CSS.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/panel-window.md`
- `packages/toolkit/components/_base/theme.css`
- `packages/toolkit/panel/defaults.css`
- `packages/toolkit/controls/defaults.css`
- `tests/toolkit/style-contracts.test.mjs`

## Rediscover State

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
```

For live checks, use the AOS content host instead of raw browser pages. If
`./aos ready` reports a repo-mode input tap or TCC blocker, follow the repo
standard readiness/repair path before treating live visual checks as optional.

## Audit Snapshot

Static inventory on 2026-05-20 found that mounted toolkit panels are mostly
loading `components/_base/theme.css` and `panel/defaults.css` correctly:

- `artifact-bundle-workbench`
- `html-workbench-expression`
- `inspector-panel`
- `integration-hub`
- `log-console`
- `markdown-workbench`
- `object-transform-panel`
- `playbook-workbench`
- `render-performance`
- `spatial-telemetry`
- `surface-inspector`
- `surface-zoom-inspector`
- `test-console`
- `wiki-kb`
- `wiki-subject-browser`
- `work-record-workbench`

Two non-panel surfaces intentionally do not load panel chrome:

- `decision-gate`
- `desktop-world-stage`

The main drift is not missing imports. The main drift is component-local visual
language that duplicates primitive roles:

1. `packages/toolkit/components/integration-hub/index.js` uses
   `createAosZagTabs`, `role="tablist"`, and `data-aos-tabs-*`, but renders the
   tab selector with `aos-segmented` and pill-like private styling. A live check
   showed the active tab background does not match the content panel background.
2. `packages/toolkit/components/wiki-kb/index.js` / `styles.css` now treats
   Graph and Radial Graph as layout modes of one graph canvas and uses the
   segmented control primitive instead of tab semantics.
3. `packages/toolkit/components/surface-zoom-inspector/index.js` /
   `styles.css` renders `secondary-tabs` inside a pane header with
   `role="tablist"` and private button styling. Decide whether these are true
   tabs attached to a secondary content body or mode buttons. Then fix the
   semantics and visuals accordingly.
4. `packages/toolkit/components/object-transform-panel/index.js` renders
   descriptor mode selectors as `role="tablist"` even though they appear to be
   mode toggles inside one field, not tabpanels. This should likely become a
   segmented/toggle group with `aria-pressed` or an explicit control primitive,
   not tabs.
5. `packages/toolkit/components/artifact-bundle-workbench/styles.css` and
   `packages/toolkit/components/test-console/styles.css` use aliases such as
   `--aos-text`, `--aos-text-strong`, `--aos-text-muted`, and `--aos-muted`.
   These are not base theme tokens today, so they resolve through fallbacks.
   Either add intentional compatibility aliases in the base theme or migrate the
   components to the existing `--text-*` aliases.

## Implementation Direction

Start with the primitive boundary, not with one-off restyles.

1. Extend the shared tab styling contract in `packages/toolkit/panel/defaults.css`
   only if the existing `.aos-tabs`, `.aos-tab`, and `.aos-tab-content` classes
   cannot express the needed variants. Likely variants are compact density,
   equal-width/grid tabs, and nested-pane tab backgrounds. Prefer custom
   properties or `data-density` / `data-layout` attributes over new component
   classes.
2. Migrate real content tabs to the connected tab primitive:
   `integration-hub`, `wiki-kb`, and any true-tab subset of
   `surface-zoom-inspector`.
3. Recast non-tab mode switches as segmented/toggle controls:
   `object-transform-panel` descriptor modes, and any surface-zoom secondary
   selector that is not actually connected to a tabpanel.
4. Decide the text-token alias policy. If `--aos-text*` aliases are retained,
   define them in `packages/design-tokens/tokens.css` and
   `packages/toolkit/components/_base/theme.css` with a no-drift test. If not,
   migrate the two component styles to `--text-primary`, `--text-secondary`,
   and `--text-muted`.
5. Add style-contract tests so this does not regress:
   - every `mountPanel` / `mountChrome` component imports `_base/theme.css` and
     `panel/defaults.css`;
   - `aos-segmented` is not used with `role="tablist"`;
   - elements with `data-aos-tabs-*` use the shared connected tab classes or an
     explicitly documented primitive variant;
   - undefined theme aliases are rejected or covered by compatibility tokens.

## Hard Boundaries

- Do not rewrite app-specific Sigil context-menu styling as part of this slice.
  This card is for `packages/toolkit/`.
- Do not move toolkit policy into the daemon.
- Do not change component product behavior while fixing semantics and primitive
  consumption.
- Do not add new dependency packages for styling.
- Do not treat every hardcoded color as a bug. Diagnostic overlays, projection
  markers, warning states, and content previews may need local semantic colors.
  The audit target is duplicated panel/chrome/control styling.

## Verification

Run focused tests first:

```bash
node --test tests/toolkit/style-contracts.test.mjs tests/toolkit/surface-inspector.test.mjs tests/toolkit/zag-adapter-tabs.test.mjs
bash tests/help-contract.sh
```

Then do live visual checks through AOS for at least:

```bash
./aos show create --id toolkit-audit-integration-hub --at 80,80,640,520 --interactive --scope global --url aos://toolkit/components/integration-hub/index.html
./aos show wait --id toolkit-audit-integration-hub --js '!!document.querySelector(".integration-hub-surface-tabs")' --timeout 8s

./aos show create --id toolkit-audit-wiki-kb --at 760,80,640,520 --interactive --scope global --url aos://toolkit/components/wiki-kb/index.html
./aos show wait --id toolkit-audit-wiki-kb --js '!!document.querySelector(".wiki-kb-tab-strip") || !!document.querySelector(".wiki-kb-compact-chrome")' --timeout 8s
```

For each true tab surface, inspect computed styles or screenshots to confirm:

- active tab background equals its visible tabpanel/body background;
- active tab bottom border bridges into the panel body;
- inactive tabs sit on the tab strip baseline;
- tab semantics remain valid keyboard-accessible Zag/ARIA tabs.

Known unrelated test caveat from the current branch: the broad
`node --test tests/toolkit/*.test.mjs` sweep fails in
`tests/toolkit/browser-evidence-capture.test.mjs` with expected `completed` vs
actual `completed_with_failures`. Do not block this slice on that unrelated
browser-evidence failure unless it reproduces in a changed path.

## Completion Report

When done, report:

- files changed;
- primitive option(s) added or reused;
- which surfaces were migrated;
- which local styles remain intentionally local and why;
- tests and live checks run;
- any follow-up slices that remain.
