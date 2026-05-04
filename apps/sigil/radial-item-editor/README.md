# Sigil Radial Item Editor

This surface is the first concrete Sigil workbench for editing a radial menu
item made of addressable 3D parts. It is Sigil-owned, but it composes with the
toolkit object transform panel instead of inventing a private control surface.

## Launch

Use the repo daemon and point the Sigil content root at the worktree that owns
the change:

```bash
AOS=/Users/Michael/Code/agent-os/aos \
apps/sigil/radial-item-editor/launch.sh wiki-graph
```

The item argument is optional. Editable subjects are discovered from
`DEFAULT_SIGIL_RADIAL_ITEMS` and currently include `context-menu`,
`agent-terminal`, and `wiki-graph`.

`AOS_SIGIL_CONTENT_ROOT` and `AOS_TOOLKIT_CONTENT_ROOT` are AOS content-root
names, not filesystem paths. Leave them unset unless you need stable short keys.
On `main`, the launch script uses `sigil` and `toolkit`. On topic branches, it
uses branch-scoped root names so a worktree launch does not overwrite the
canonical repo roots expected by `aos ready`. If those roots are not already
live in the content server, the script performs one repo daemon restart before
creating the editor canvases.

## Contracts

The editor publishes `canvas_object.registry` snapshots for the selected item.
Generic glTF items expose one model host object. The wiki brain exposes its
shell, fiber stem, fiber bloom, and fractal tree objects.

The toolkit object transform panel sends `canvas_object.transform.patch`
messages back to the editor. The editor mutates only its in-memory copy of the
radial item config, then emits `canvas_object.transform.result` and a refreshed
registry.

The launch script opens the preview and transform controls as separate canvases,
then replays the current registry after both surfaces are ready. That avoids a
lost first registry message while keeping the editor and generic toolkit panel
independent. A later workbench shell can compose the same preview and controls
as panes in one split surface.

The `Lock in` button emits `sigil.radial_item_editor.lock_in`. That payload is a
source-ready handoff for an agent, not a browser-side file write. It names the
source file and export to update:

```text
apps/sigil/renderer/radial-menu-defaults.js
DEFAULT_SIGIL_RADIAL_ITEMS
```

Keep that boundary unless the platform gains an explicit persistence adapter.
The canvas should not receive broad filesystem authority just because an editor
needs to apply a tuned object definition.

## Verification

Focused source checks:

```bash
node --check apps/sigil/radial-item-editor/model.js
node --check apps/sigil/radial-item-editor/index.js
bash -n apps/sigil/radial-item-editor/launch.sh
node --test tests/renderer/radial-item-editor.test.mjs
```

Use AOS live verification when changing the bridge between this editor and the
toolkit transform panel. Visual tuning still needs human confirmation before the
exported payload is applied back to the production radial menu defaults.

## Split Workbench

`apps/sigil/radial-item-workbench/` is the composed version of the same tool. It
mounts the preview and toolkit object transform panel as panes in one canvas
while keeping the same editor model, object registry, transform patch, and
lock-in payload contracts.

```bash
AOS=/Users/Michael/Code/agent-os/aos \
apps/sigil/radial-item-workbench/launch.sh wiki-graph
```
