# ADR 0024: DesktopWorld Stage 3D Outlet

- Status: Accepted
- Date: 2026-07-15

## Context

AOS already owns a logical, display-spanning DesktopWorld surface and a shared
click-through stage for passive visual layers. The shared stage is currently a
DOM and Canvas2D host, while `DesktopWorldSurfaceThree` helps a consumer build a
separate Three.js DesktopWorld surface. That split makes ordinary 3D consumers
repeat topology, camera, render-loop, resource, interaction, and inspection
work, and it encourages product-specific full-desktop canvases.

Sigil needs a rich companion renderer and editor, but companion identity,
presence states, moods, presets, and visual recipes are product concepts. They
must not become AOS platform policy. A reusable desktop-wide 3D scene host does
belong in AOS and should be proven first by Sigil without requiring a second
consumer.

## Decision

The singleton AOS DesktopWorld stage is the product-neutral visual host for the
desktop. Its canonical scoped identity is `desktop-world/main`. The stage has
compatible 2D and 3D outlets plus explicit interaction and inspection
bindings.

The 3D outlet will be exposed through the reviewed `@agent-os/toolkit/scene`
package. Its completed contract provides:

- an owner-scoped scene graph with stable resource and object identities;
- hierarchy, transforms, cameras, lights, geometry, materials, textures,
  particles, shader-material descriptors, and bounded post-processing;
- animation clips, timelines, curves, constraints, transitions, and generic
  signal-to-parameter bindings;
- incremental, revision-checked scene transactions instead of renderer reloads;
- stage leases, deterministic teardown, shared resource pooling, render budgets,
  hidden-state suspension, context recovery, and multi-display projection;
- object hit testing that binds only to explicit daemon input regions or
  semantic interaction surfaces; and
- `canvas_object.registry`, Surface Inspector, lifecycle, and performance
  evidence for every published resource.

The SDK supports the same scene document in two hosts:

- a local viewport host for product-owned editors and previews; and
- the AOS DesktopWorld host for the shared desktop projection.

The daemon continues to own the DesktopWorld canvas primitive and physical
display segments. Toolkit stage policy owns scene replication, camera
projection, rendering, leases, and object lifecycle. Consumers own their scene
documents, persistence, product semantics, editor UI, state interpretation, and
effect recipes.

Stage identities are structured rather than globally concatenated strings. A
consumer publishes an owner and resource, for example:

```text
stage:    desktop-world/main
owner:    io.ch-osctrl.sigil
resource: companion/main
object:   body/alpha
```

The existing `desktop_world_stage.layer.*` messages remain supported and render
through the 2D/HUD outlet. Existing standalone `DesktopWorldSurfaceThree`
consumers remain compatible while they migrate to shared-stage leases.

Shared-stage documents are declarative. They may reference validated shader
assets and registered effect implementations, but they may not execute arbitrary
consumer JavaScript. An untrusted executable extension host or cross-process
texture-composition path requires a separate security decision.

The initial implementation is deliberately narrower than the completed
contract above. It adds strict scene-document, transaction, lease, registry,
numeric signal and elapsed-clock animation bindings, inspection, local
viewport, and DesktopWorld host policy plus ResourceScope accounting for stage
objects. Hosts use trusted, dependency-injected projection factories and the
existing bounded Three lifecycle. It does **not** add daemon command forms,
singleton shared-stage transport, resource pooling, hit testing, arbitrary
timeline or animation-graph evaluation, or cross-process scene replication.
Those capabilities require separate reviewed slices and must not be claimed
from the package host alone.

## Consequences

- Consumers stop creating private full-desktop canvases for ordinary 3D
  visuals.
- Sigil can own a bespoke companion system while using the same public stage
  contract as future consumers.
- AOS must grow a real scene transaction, lease, animation, interaction, and
  diagnostics contract rather than merely exporting camera helpers.
- Product editors remain outside AOS. AOS supplies headless authoring and
  rendering affordances, not a branded DCC interface.
- Scene persistence remains consumer-owned; the shared stage is an ephemeral,
  reconstructable projection.
- Existing 2D affordances and input-region safety remain intact during the 3D
  migration.

## Initial Reference Consumer

Sigil is the first reference consumer. Its canonical resource is
`companion/main`; its Alpha/Omega composition, presence states, moods, voice
reactivity, effects, presets, and Avatar Studio remain in the Sigil repository.
