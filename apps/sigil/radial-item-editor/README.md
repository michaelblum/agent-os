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

`AOS_SIGIL_CONTENT_ROOT` is the AOS content-root name, not a filesystem path.
Leave it unset unless you need a non-default key; the launch script points that
root at the current git worktree's `apps/sigil` directory.

## Contracts

The editor publishes `canvas_object.registry` snapshots for the selected item.
Generic glTF items expose one model host object. The wiki brain exposes its
shell, fiber stem, fiber bloom, and fractal tree objects.

The toolkit object transform panel sends `canvas_object.transform.patch`
messages back to the editor. The editor mutates only its in-memory copy of the
radial item config, then emits `canvas_object.transform.result` and a refreshed
registry.

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
