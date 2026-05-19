# Reconcile Zag Tree View After Surface Inspector Disclosure V0

## Tracker

- Parent Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Existing branch to reconcile:
  `gdi/toolkit-zag-tree-view-adapter-and-surface-inspector-adoption-v0`
- Current `main` already includes:
  `surface-inspector-annotate-pane-progressive-disclosure-v0`

## Goal

Rebase or replay the existing Zag tree-view adapter and Surface Inspector
adoption work onto current `main` without losing the newly merged Surface
Inspector Annotate pane progressive-disclosure behavior.

This is reconciliation work, not a fresh redesign. Preserve useful work from the
existing branch, resolve the Surface Inspector conflicts deliberately, and leave
the repository with one current branch or merged result.

## Current State

Foreman merged these previously orphaned branches into `main`:

- Sigil reticle/radial work from `gdi/toolkit-3d-radial-menu-workbench-v0`
- Surface Inspector Annotate pane progressive disclosure from
  `gdi/surface-inspector-annotate-pane-progressive-disclosure-v0`

Foreman then pruned stale branches:

- `gdi/toolkit-3d-radial-menu-workbench-v0`
- `gdi/toolkit-subject-browser-facet-resource-drilldown-v0`
- `gdi/toolkit-subject-browser-operator-final-acceptance-fix`
- `gdi/surface-inspector-annotate-pane-progressive-disclosure-v0`
- `gdi/toolkit-panel-minimized-chip-affordance-pointer-contract-v0`

The remaining tree-view branch is not disposable. It carries substantive work:

- `packages/toolkit/adapters/zag/tree-view.js`
- `tests/toolkit/zag-adapter-tree-view.test.mjs`
- Surface Inspector tree-view adoption changes
- tree-view adapter export from `packages/toolkit/adapters/zag/index.js`

But it conflicts with current `main` in:

```text
packages/toolkit/components/surface-inspector/index.js
```

The conflict exists because current `main` now includes the progressive
disclosure Annotate pane changes that the old tree-view branch said were
superseded. That old assumption is no longer valid; preserve the progressive
disclosure shape and integrate tree-view as a refinement inside it.

## Read First

From current `main`:

```bash
git status --short --branch
git log --oneline --decorate --max-count 8
git show origin/gdi/toolkit-zag-tree-view-adapter-and-surface-inspector-adoption-v0:docs/design/work-cards/toolkit-zag-tree-view-adapter-and-surface-inspector-adoption-v0.md
git diff --name-status main...origin/gdi/toolkit-zag-tree-view-adapter-and-surface-inspector-adoption-v0
git merge-tree --name-only main origin/gdi/toolkit-zag-tree-view-adapter-and-surface-inspector-adoption-v0
```

Then inspect:

```bash
packages/toolkit/adapters/zag/index.js
packages/toolkit/adapters/zag/tree-view.js
packages/toolkit/components/surface-inspector/index.js
tests/toolkit/surface-inspector.test.mjs
tests/toolkit/zag-adapter-tree-view.test.mjs
docs/design/work-cards/surface-inspector-annotate-pane-progressive-disclosure-v0.md
```

## Required Reconciliation

1. Start from current `main`, not from the stale branch base.
2. Bring forward the tree-view adapter and its tests.
3. Bring forward Surface Inspector tree-view adoption only where it composes with
   the current Annotate pane progressive-disclosure layout.
4. Preserve the current lower-pane peer-context model and Diagnostics separation.
5. Do not resurrect prominent duplicated anchor/comment count cards above the
   Annotate tree.
6. Keep raw support/debug rows out of the default Annotate body.
7. Preserve public Surface Inspector event, snapshot, and annotation contracts.
8. Do not touch Subject Browser, radial menu, or panel-chip behavior in this
   branch.

## Verification

Run deterministic checks:

```bash
node --check packages/toolkit/adapters/zag/tree-view.js
node --check packages/toolkit/components/surface-inspector/index.js
node --test tests/toolkit/zag-adapter-tree-view.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs tests/toolkit/surface-inspector-ax.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
git diff --check
```

If `./aos ready` reports `ready=true`, run a bounded Surface Inspector launch
sanity check:

```bash
./aos ready
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s
```

Then verify the canvas loads, the lower pane is reachable, Annotate can show the
tree, Diagnostics remains available, and cleanup removes the smoke canvas.

## Completion Report

Report back with:

- branch and head SHA;
- whether you rebased, cherry-picked, or rebuilt from the existing branch;
- changed files;
- conflict resolution summary for `surface-inspector/index.js`;
- deterministic test results with pass/fail counts;
- whether live Surface Inspector smoke ran;
- local-only state;
- final recommendation: accept, needs_gdi_fix, or needs_operator.
