# Work Card: Rename canvas-inspector → surface-inspector

**Branch:** `gdi/rename-canvas-inspector`  
**Type:** Refactor — no behavior changes  
**Scope:** Hard cutover. No compatibility aliases.

---

## Background

The component directory, manifest name, and channel prefix are `canvas-inspector` but every user-facing layer — the manifest title, default canvas ID, Sigil utility action, annotation schemas, and docs — already uses `surface-inspector` / `Surface Inspector`. This work card normalizes the internal naming to match the semantic.

See research: `docs/dev/reports/canvas-inspector-naming.md`

**Out of scope:** `packages/toolkit/components/surface-zoom-inspector` — leave untouched. It is a fixture-only proof workbench and a candidate for future fold-in to surface-inspector, not a rename target here.

---

## Instructions for GDI

### Preconditions

```sh
git fetch origin
git reset --hard origin/main
git checkout -b gdi/rename-canvas-inspector
```

### Step 1 — Rename the component directory

```sh
git mv packages/toolkit/components/canvas-inspector packages/toolkit/components/surface-inspector
```

### Step 2 — Update manifest name, title, channelPrefix in index.js

In `packages/toolkit/components/surface-inspector/index.js`, update:

```js
// Before
name: 'canvas-inspector',
title: 'Surface Inspector',
channelPrefix: 'canvas-inspector',

// After
name: 'surface-inspector',
title: 'Surface Inspector',
channelPrefix: 'surface-inspector',
```

### Step 3 — Update launch.sh

In `packages/toolkit/components/surface-inspector/launch.sh`:

- Remove the `AOS_CANVAS_INSPECTOR_ID` fallback — hard cutover only.
- Update the `CANVAS_ID` line to:
  ```sh
  CANVAS_ID="${AOS_SURFACE_INSPECTOR_ID:-surface-inspector}"
  ```
- Remove the `LEGACY_CANVAS_ID` variable and any logic that references it.
- Update the `--manifest` flag from `canvas-inspector` to `surface-inspector`.
- Update the `--url` path from `.../canvas-inspector/index.html` to `.../surface-inspector/index.html`.

### Step 4 — Update all references in the codebase

Find and replace every remaining `canvas-inspector` string (excluding the git history and this work card/report). Focus areas:

```sh
grep -r "canvas-inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" --include="*.html" --include="*.sh" -l
```

Key known locations from the naming investigation:

- `apps/sigil/workbench/index.html` — import path and stylesheet path
- `apps/sigil/renderer/live-modules/main.js` — utility canvas id references, `ensureUtilityCanvasVisible` call
- `apps/sigil/context-menu/menu.js` — any `canvas-inspector` id references
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/` — any schema filenames or content referencing `canvas-inspector`
- Any other files surfaced by the grep

Do **not** replace `surface_inspector` strings (those are already correct).

### Step 5 — Verify no canvas-inspector references remain

```sh
grep -r "canvas-inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" --include="*.html" --include="*.sh" -l
```

Expected result: no files listed (other than git history artifacts which grep won't see).

### Step 6 — Run tests

```sh
npm test
```

All tests must pass. If any test references `canvas-inspector` by name, update the test to `surface-inspector`.

### Step 7 — Stage with explicit paths, commit, push

Stage only the files you modified:

```sh
git add packages/toolkit/components/surface-inspector/
git add apps/sigil/
git add docs/
git add shared/schemas/
# add any other explicit paths touched
git show --stat HEAD
git commit -m "refactor(toolkit): rename canvas-inspector to surface-inspector (hard cutover)"
git push origin gdi/rename-canvas-inspector
```

Report back with: branch name, HEAD SHA, `git show --stat HEAD` output, and test results.

---

## Acceptance Criteria

- [ ] `packages/toolkit/components/canvas-inspector` no longer exists
- [ ] `packages/toolkit/components/surface-inspector` exists with all original files
- [ ] `name`, `channelPrefix` in `index.js` updated to `surface-inspector`
- [ ] `launch.sh` updated — no legacy `AOS_CANVAS_INSPECTOR_ID` fallback, no `LEGACY_CANVAS_ID`
- [ ] Zero remaining `canvas-inspector` string references in codebase
- [ ] All tests pass
- [ ] `surface-zoom-inspector` untouched
- [ ] Commit staged with explicit paths only

---

## Future Note

`packages/toolkit/components/surface-zoom-inspector` is a fixture-only proof workbench for the "select surface → inspect inside → draft annotation" loop. It is a candidate for fold-in to `surface-inspector` in a future session — do not modify it in this work card.
