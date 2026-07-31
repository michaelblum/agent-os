# ADR 0037: Stateful Native Height-Field Programs

- Status: Accepted
- Date: 2026-07-31
- Extends: ADRs 0033, 0034, 0035, and 0036

## Context

The V1 and V2 native-effect graphs evaluate each point independently. They can
produce an analytic ripple or a lit sheet deformation, but they cannot retain
the height and velocity history required for fluid wakes and related surface
responses. Encoding a product-named Wake shader in AOS would violate the
consumer-art boundary. Accepting loops, shader source, or mutable buffers from
consumers would grant too much authority to data-only cartridges.

## Decision

`aos.scene.native-effect-program.v3` adds one engine-owned state primitive:
`damped_height_field`. The consumer still authors a finite data program and
bounded parameters. AOS owns:

- one logical global height-and-velocity field per effect instance;
- aspect-preserving bounded field dimensions;
- fixed-step integration, substep limits, backlog dropping, and edge absorption;
- a bounded swept-brush emitter with signed lobes;
- immutable, all-segment Metal state snapshots with GPU-completion-gated reuse;
  and
- texture, array, renderer, and sheet disposal.

The graph may read `state.height` and `state.gradient`. The gradient is the
central-difference derivative in global DesktopWorld units, independent of
field resolution. Existing position, texture-displacement, opacity, geometry,
and material outputs are unchanged.
Consumer declarations select bounded field dimensions, integration parameters,
and signed lobe composition through declared scalar parameters. They cannot
provide source, loops, kernels, allocation commands, pixel access, or native
handles.

The field domain is the union DesktopWorld plane, not an individual display.
Each display renderer samples that same field through global UV coordinates and
uses its own AOS-owned captured desktop texture. Display bezels are never fluid
boundaries. Effect-local geometry may clip rendering work, but it does not split
simulation state. A field generation remains immutable until every display has
submitted it, and a buffered texture cannot be rewritten until all command
buffers using that slot have completed.

Timed effect duration and emitter transit duration are independent. A consumer
may move an emitter quickly and allow the resulting surface to settle for the
remaining bounded effect lifetime. Gesture-owned effects retain the existing
lease and watchdog rules from ADR 0035.

## Consequences

- Consumers can define wakes and other bounded history-dependent surface art
  without adding product effects to AOS.
- AOS retains a finite, reviewable engine vocabulary and deterministic resource
  ownership.
- Cross-display state cannot diverge through per-display clocks or allocations.
- Stateful effects consume more memory and CPU than analytic graphs, so their
  field dimensions, substeps, lobes, brush samples, aggregate cell visits, and
  parameter ranges are independently bounded.
- Fragmentation, topology mutation, arbitrary multipass programs, and general
  consumer compute remain outside this contract.
