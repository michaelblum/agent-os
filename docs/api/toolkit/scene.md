# Toolkit Scene API

`@agent-os/toolkit/scene` is the compatibility facade for AOS DesktopWorld
scene work. New consumers should use the focused entry point that matches the
task:

| Task | Package | Guide |
|---|---|---|
| Data-only scenes and interactions | `@agent-os/toolkit/scene/authoring` | [Authoring](./scene-authoring.md) |
| Session, hosts, signals, animation, and rendering | `@agent-os/toolkit/scene/runtime` | [Runtime](./scene-runtime.md) |
| Reviewed trusted projection code | `@agent-os/toolkit/scene/extensions` | [Extensions](./scene-extensions.md) |
| Inspection, profiling, monitoring, and replay | `@agent-os/toolkit/scene/devtools` | [DevTools](./scene-devtools.md) |

The broad `@agent-os/toolkit/scene` export remains stable for existing
consumers. Direct imports from toolkit internals are not public contracts.

## Choose The Boundary

Use a data-only cartridge when registered geometry, materials, numeric
bindings, and stock interactions are sufficient. Use a trusted extension only
for reviewed first-party geometry, materials, shaders, effects, or animation
code that cannot be represented by the cartridge contract. Use isolated
standalone WebGL when executable content is untrusted, preview-only, or should
not receive AOS scene authority.

A cartridge never grants code execution. A trusted extension is same-realm
privileged code and requires explicit digest review and installation. A
standalone WebGL surface is not a DesktopWorld cartridge or extension.

## Ownership

AOS owns the persistent renderer, frame clock, global DesktopWorld coordinate
plane, display segmentation, cameras, topology generations, all-display
settlement, input regions, gestures, telemetry, and disposal. Ordinary authors
position objects once in the global plane; they do not build one scene or
camera per display. Advanced anchoring and native-input APIs expose display
facts only where those facts are required.

Consumers own product state, names, prompts, semantic actions, visual recipes,
and approval policy. Importing the toolkit grants no AOS command execution,
daemon socket access, native input, TCC permission, or product identity.

## Public Commands

The command manifest is the argument authority. These authoring commands do
not start the daemon:

```bash
aos scene cartridge scaffold ./companion-scene \
  --id example/companion --template aim-and-commit --json
aos scene cartridge validate ./companion-scene --json

aos scene extension scaffold ./companion-renderer \
  --owner example.consumer --id companion-renderer \
  --template basic-three --json
aos scene extension validate ./companion-renderer --json
```

The public connection-scoped runtime transport remains:

```bash
aos scene --stage desktop-world/main \
  --owner example.consumer --resource example/companion --follow
```

It accepts strict NDJSON operations named `mount`, `transact`, `signal`,
`play`, `suspend`, `resume`, `inspect`, `subscribe`, `unsubscribe`, `remove`,
and `close`. Product adapters should inject that public transport into
`createDesktopWorldSceneSession()` rather than reimplementing recovery or
opening the private daemon socket.

## Stable Contracts

- `aos.scene.document.v1` is the bounded object and resource graph.
- `aos.scene.transaction.v1` is the optimistic structural mutation envelope.
- `aos.scene.cartridge.v1` digest-binds scene, animation, interaction, and
  local asset data.
- `aos.scene.event.v1` carries typed product-neutral gesture events.
- `aos.scene.extension.v1` binds reviewed projection code to owner, ABI, Three
  revision, implementation IDs, and budgets.
- `aos.desktop-world.devtools.stage.v1` is the content-free engine snapshot.

Command help is generated from
`manifests/commands/source/aos/39-scene.json`. Event and snapshot schemas are
generated and validated with the rest of the AOS public contracts.
