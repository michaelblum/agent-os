# ADR 0026: DesktopWorld Cartridge And Engine Boundary

- Status: Partially superseded by ADR 0029
- Date: 2026-07-18

## Context

ADR 0024 established the singleton AOS DesktopWorld stage and the public scene
package. The first Sigil consumer still had to compose its scene, transitions,
pointer gestures, hit regions, and inspection wiring across product-owned
modules. That encourages remounts, private full-display windows, and bespoke
interaction loops instead of one reusable desktop scene engine.

The historical embedded Sigil implementation demonstrates useful fast travel,
radial menus, minimap, telemetry, and hit-surface mechanics. It is evidence,
not active product authority. Restoring that product code to AOS would reverse
the accepted repository boundary.

## Decision

AOS owns a product-neutral DesktopWorld engine. It provides the persistent
stage, trusted implementation registries, rendering lifecycle, multi-display
coordinates, owner-scoped affordances, gesture arbitration, declarative
responses, route execution, inspection, performance telemetry, and detachable
DevTools.

Consumers supply versioned data-only cartridges. V1 uses this canonical layout:

```text
cartridge.json
scene.json
animations.json
interactions.json
assets/
```

The manifest digest-binds every payload and local asset, declares all trusted
implementation IDs, and lowers explicit engine budgets. Cartridges contain no
functions, scripts, shader source, remote runtime URLs, symlinks, special
files, or arbitrary executable extensions. AOS-owned registries remain the only
executable boundary.

Cartridge resolution produces the existing `aos.scene.document.v1` and its
bounded animation and interaction descriptors. It does not create a second
renderer, stage, transport, persistence system, or product policy layer.

ADR 0029 supersedes only the claim that AOS-owned registries are the sole
executable boundary. Cartridges remain data-only; reviewed consumer projection
extensions are installed and authorized through a separate trust contract.

The generic gesture lifecycle is independent from its response. Conventional
translation and aim-and-commit both begin with a drag recognizer; the former
moves an object during updates, while the latter keeps it fixed, renders an aim
route, and commits a transition only on release. Escape and ownership loss
cancel either lifecycle through engine-owned semantics.

AOS DevTools own their session, telemetry, and host-neutral views. They may run
as detached desktop panels or transfer one interactive host lease into a
consumer surface. A consumer may launch, filter, dock, or host the public view,
but does not fork its implementation or own the underlying session.

## Consequences

- Sigil can package `companion/main` as a forkable cartridge while retaining
  product-owned appearance, state names, moods, voice policy, and commands.
- Future consumers receive familiar scene, gesture, event, replay, and
  inspection contracts without inheriting Sigil semantics.
- Historical visual parity is proved through immutable fixtures and fixed-clock
  comparison, not by restoring embedded product code.
- New executable implementation IDs require an AOS review; cartridge authors
  cannot ship code by naming an unregistered implementation.
- The initial cartridge PR validates and resolves descriptors. Gesture
  execution, generic interaction rendering, DevTools sessions, agent tooling,
  and Sigil migration remain separate reviewed slices under this decision.
