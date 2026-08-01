# ADR 0038: DesktopWorld RenderKit Boundary

- Status: Accepted
- Date: 2026-08-01
- Extends: ADRs 0024, 0026, 0029, 0030, 0031, 0033, 0034, 0035, 0036, and 0037

## Context

DesktopWorld currently has two complementary rendering paths. Trusted scene
extensions build consumer-owned Three.js object graphs inside an AOS-owned
renderer. Native-effect programs let data-only cartridges describe bounded
Metal sheet deformation without receiving pixels, native handles, or shader
execution authority.

The declarative graph is an appropriate constrained tier, but it should not be
the expressive ceiling for reviewed first-party artwork. Rich effects such as
Ripple, Wake, Wormhole, refraction, fragmentation, and multipass composition
must remain owned and tunable by their product without adding product names or
art parameters to AOS for each revision. At the same time, granting arbitrary
consumer code direct capture, Metal, windows, or input authority would split
the privileged runtime and duplicate DesktopWorld infrastructure.

The trusted Three.js extension demonstrates the intended relationship: AOS
owns the renderer and physical world; the consumer owns the visual program.
The native lane needs the same relationship with an explicit trust and
capability model.

## Decision

AOS establishes **DesktopWorld RenderKit** as the common toolkit and native
runtime boundary for consumer-authored GPU effects. RenderKit is an extension
of the existing DesktopWorld engine, not a second scene engine, display model,
capture stack, input system, or product runtime.

### Ownership

AOS owns:

- macOS TCC authorization and protected API invocation;
- physical per-display windows and render surfaces;
- the one global DesktopWorld coordinate plane and display topology;
- capture sessions, textures, render targets, GPU command submission, and
  native graphics handles;
- stage clocks, gesture and cursor authority, render damage, resource budgets,
  context recovery, telemetry, and deterministic disposal; and
- admission and runtime enforcement for every consumer program.

`@agent-os/toolkit` owns the public authoring language and client contract:

- scenes, objects, meshes, geometry, materials, shaders or bounded shader
  representations, texture sources, uniforms, render and compute passes;
- signal and interaction bindings, budgets, lifecycle, inspection, replay, and
  typed runtime sessions; and
- the matching schemas, examples, API documentation, DevTools views, and agent
  guidance.

Consumers own product art, effect composition, parameters, presets, event
bindings, editor UX, and product policy. Consumer vocabulary does not enter the
AOS runtime or generic toolkit.

### One World And Lifecycle

RenderKit resources mount into the existing DesktopWorld resource aggregate.
They use the existing topology generation, global coordinates, stage clock,
input sessions, render-damage accounting, and owner-scoped lifecycle. AOS may
use one native surface per physical display, but those segments expose one
logical world and one effect instance. Display bezels are not effect, clock, or
simulation boundaries.

A consumer cannot create a window, renderer, display topology, capture stream,
RAF or display link, event tap, cursor controller, or unaccounted GPU resource.
Activation, replacement, suspension, context loss, cancellation, and disposal
must settle across every display before the aggregate reports success.

### Trust And Capability Tiers

RenderKit supports distinct tiers rather than treating every author as either
fully trusted or equally untrusted:

1. Existing data-only native-effect programs remain the constrained tier. They
   contain no executable source and continue to use finite engine-owned graph
   operations and state primitives.
2. A reviewed trusted-extension tier may admit first-party effect
   implementations by exact owner, identity, digest, compatibility, declared
   capabilities, and budgets. Runtime accounting and lifecycle enforcement
   still apply. Trust does not grant direct TCC, windows, event taps, filesystem,
   network, or raw native-handle ownership.
3. Downloaded or untrusted executable programs remain unsupported until a
   separate isolation boundary is accepted. They must not inherit the
   first-party tier by sharing a manifest shape.

The exact trusted native ABI and execution location are intentionally deferred
to a neutral measured spike. Raw Metal, RealityKit, and selected
Satin-derived components are implementation candidates, not trust boundaries.
The spike must compare an in-process AOS renderer extension with an AOS-owned
helper process before that choice becomes an ABI.

### Pixel Capabilities

Texture sampling and pixel readback are separate capabilities:

- A desktop-texture capability lets an admitted effect sample an AOS-owned
  texture inside the AOS renderer. Pixels and raw graphics handles do not leave
  that rendering boundary.
- An image-product capability lets an authorized AOS operation produce a
  bounded capture, crop, redaction, diff, OCR input, or perception artifact.
  AOS owns acquisition and sanitization; the operation exposes only its
  declared bounded result.

Both capabilities use the shared AOS capture and topology infrastructure. AOS
must not retain two permanent desktop-capture implementations for rendering and
perception.

Capability grants are owner-scoped. A first-party consumer may receive a broad
profile through explicit product policy without becoming a second TCC owner.

### Public Contract Completeness

Every PR that changes a public RenderKit contract must update the complete
agent-facing route in the same change:

- toolkit exports, types, schemas, and contract authority;
- one neutral runnable example;
- one deterministic fake-runtime test;
- API documentation and error/lifecycle reference;
- DevTools inspection and resource evidence;
- `aos-desktop-world-authoring` skill guidance and references; and
- generated command help and manifests when a command surface changes.

A public slice is incomplete when one of these surfaces describes a different
contract. A new root skill is warranted only if native effect authoring develops
a genuinely separate trigger and workflow.

## Required Evidence Before ABI Stabilization

The neutral spike must prove:

- a consumer-owned effect can change without embedding its vocabulary in AOS;
- coherent native output and timing across mismatched displays;
- AOS-supplied desktop texture, global coordinates, clock, and gesture signals;
- inspectable GPU allocations, frame timing, damage, and lifecycle state;
- deterministic unload and no resource growth after 100 activation/disposal
  cycles; and
- bounded failure behavior without weakening the permission broker.

The first failing increment is evidence about the boundary. Existing broker,
program, and consent machinery is retained, generalized, simplified, or
retired only after the spike identifies which layers preserve the working
native path.

## Consequences

- Products can own sophisticated native visual programs without requiring an
  AOS source edit for every artistic change.
- AOS remains the sole privileged host and generic engine rather than learning
  product effects.
- The constrained native-effect graph remains supported while the trusted tier
  is measured; no dual implementation becomes permanent by default.
- Framework, ABI, and process-isolation choices remain open until evidence is
  recorded in the cross-repository initiative ledger.
- Sigil adoption occurs effect by effect after the AOS contract merges; AOS and
  Sigil changes remain separately reviewed and pinned.

The canonical delivery state is tracked in
[DesktopWorld RenderKit cross-repository initiative](../design/desktopworld-renderkit-initiative.md).
