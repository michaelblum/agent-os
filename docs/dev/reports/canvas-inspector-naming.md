# canvas-inspector Naming Investigation

## Summary

There is no evidence that `packages/toolkit/components/canvas-inspector` was
renamed to a `packages/toolkit/components/surface-inspector` directory. The live
component directory and manifest name remain `canvas-inspector`, while the
user-facing title, default canvas id, annotation schemas, docs, and several
runtime reason strings use `Surface Inspector` / `surface-inspector` naming.

`packages/toolkit/components/surface-zoom-inspector` is a separate fixture-only
proof component, not a replacement for `canvas-inspector`.

## Evidence Collected

### Commit-message searches

Commands run:

```sh
git log --all --oneline --grep="surface-inspector"
git log --all --oneline --grep="surface_inspector"
```

Both commands returned no commits. There is no commit-message evidence for a
`canvas-inspector` to `surface-inspector` rename.

### Codebase string searches

Commands run:

```sh
grep -r "surface-inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" -l
grep -r "surface_inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" -l
```

`surface-inspector` references exist in docs, schemas, Sigil code, and the
`canvas-inspector` component. Notable live references include:

- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/canvas-inspector/launch.sh`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/context-menu/menu.js`
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`

`surface_inspector` references are mostly schema/reason-string/API references,
including `surface_inspector_annotation_state`,
`surface_inspector_annotation_snapshot`, and refresh/reveal lifecycle reason
strings inside `packages/toolkit/components/canvas-inspector/index.js`.

These references show an intentional user-facing/runtime vocabulary, not a
directory rename.

## Rename Evidence

Command run:

```sh
git log --follow --oneline -- packages/toolkit/components/canvas-inspector/index.js
```

The `--follow` history starts with:

```text
77b43fd refactor(toolkit): migrate canvas-inspector to Layer 1a+1b foundation
```

and continues through many direct modifications to
`packages/toolkit/components/canvas-inspector/index.js`. Running with
`--name-status` shows the first tracked operation as:

```text
77b43fd refactor(toolkit): migrate canvas-inspector to Layer 1a+1b foundation
A       packages/toolkit/components/canvas-inspector/index.js
```

No rename from or to a `surface-inspector` path was detected.

Command run:

```sh
git log --follow --oneline -- packages/toolkit/components/surface-zoom-inspector/index.js
```

The complete `--follow` history is:

```text
4093bdd Integrate dock harness and workbench primitives
```

Running with `--name-status` shows:

```text
4093bdd Integrate dock harness and workbench primitives
A       packages/toolkit/components/surface-zoom-inspector/index.js
```

No rename was detected for `surface-zoom-inspector` either.

Conclusion: there is no git rename evidence for
`canvas-inspector` -> `surface-inspector`. The likely source of the memory is
the component's user-facing and runtime naming, especially the default canvas id
and docs.

## Component Purposes

### `packages/toolkit/components/canvas-inspector`

The file header identifies this as the toolkit canvas debug panel:

```text
canvas-inspector - Content factory for the toolkit's canvas debug panel.
```

The component renders live daemon canvas state, display geometry, minimap
overlays, canvas lifecycle updates, object marks, mouse effects, surface
resources, and the Surface Inspector annotation flow.

Its manifest remains:

```js
name: 'canvas-inspector',
title: 'Surface Inspector',
channelPrefix: 'canvas-inspector',
```

Its launch script reinforces the compatibility split:

```sh
CANVAS_ID="${AOS_SURFACE_INSPECTOR_ID:-${AOS_CANVAS_INSPECTOR_ID:-surface-inspector}}"
LEGACY_CANVAS_ID="canvas-inspector"
...
--url "aos://$TOOLKIT_CONTENT_ROOT/components/canvas-inspector/index.html"
--manifest canvas-inspector
```

So the directory/manifest/channel namespace is still `canvas-inspector`, while
the default live canvas id and user-facing title are `surface-inspector` /
`Surface Inspector`.

### `packages/toolkit/components/surface-zoom-inspector`

`surface-zoom-inspector` imports its own model, loads a Spatial Subject Tree
fixture, mounts a distinct chrome title, and uses an actor id of
`surface-zoom-inspector`:

```js
export const SURFACE_ZOOM_INSPECTOR_ACTOR = { role: 'operator', id: 'surface-zoom-inspector' }
```

Its UI title is:

```js
title: 'Surface-Zoom Inspector'
```

`docs/api/toolkit/components.md` describes it as a bounded local proof of the
"select a surface, inspect inside that surface, draft annotation" loop and
explicitly says it is fixture-only and does not replace Surface Inspector.

Conclusion: these are distinct components. `canvas-inspector` is the active
live Surface Inspector implementation. `surface-zoom-inspector` is a separate
fixture/proof workbench for spatial subject tree inspection.

## Registration Status

Commands run:

```sh
grep -r "canvas-inspector" apps/sigil packages/gateway --include="*.js" --include="*.ts" --include="*.html" -l
grep -r "surface-zoom-inspector" apps/sigil packages/gateway --include="*.js" --include="*.ts" --include="*.html" -l
```

`canvas-inspector` is wired into Sigil:

- `apps/sigil/workbench/index.html` imports
  `components/canvas-inspector/index.js` and loads
  `components/canvas-inspector/styles.css`.
- `apps/sigil/renderer/live-modules/main.js` treats both `surface-inspector`
  and `canvas-inspector` as utility canvas ids, and its default utility config
  creates id `surface-inspector` with URL
  `components/canvas-inspector/index.html`.
- `apps/sigil/renderer/live-modules/main.js` also calls
  `ensureUtilityCanvasVisible('canvas-inspector', ...)` for the annotation
  toggle path.
- `apps/sigil/context-menu/menu.js` routes the inspector action through
  `onUtilityAction?.('surface-inspector')`.

No `canvas-inspector` or `surface-zoom-inspector` references were found under
`packages/gateway/` by the requested grep commands.

`surface-zoom-inspector` is not wired into Sigil or gateway by those grep
commands. It has its own package-local launch path:

```sh
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

## Recommendation

Recommendation: **both are separate active components**, with a documentation
clarification rather than removal.

The current naming is intentional but confusing:

- `canvas-inspector` is the stable component directory, manifest name, channel
  prefix, and compatibility namespace.
- `Surface Inspector` / `surface-inspector` is the user-facing surface name,
  default canvas id, annotation schema vocabulary, and Sigil utility id.
- `surface-zoom-inspector` is a separate fixture-only proof component.

If the team wants to reduce future confusion, file a narrow rename/consolidation
work card for naming cleanup only after deciding whether compatibility aliases
must remain. Based on the current evidence, do not remove either component as
obsolete.
