# ADR 0036: DesktopWorld Native Fidelity And Local Effect Geometry

- Status: Accepted
- Date: 2026-07-31
- Extends: ADRs 0029, 0034, and 0035

## Context

DesktopWorld formerly capped each browser projection at an arbitrary backing
pixel count. On mixed-density displays, that silently reduced the effective
device-pixel ratio below the native display scale and made a shared consumer
renderer look softer on the desktop than in its local editor. Rendering every
transparent pixel continuously at maximum quality would avoid that artifact,
but it would also spend most frame time on unchanged desktop regions.

The native sheet had the inverse problem. Its fixed 64 by 64 mesh was bounded
and predictable, but stretched too few vertices across a complete display for
small radial or route effects. Raising the full-display grid globally would
waste geometry and memory and would still prevent consumers from selecting the
right density for a reviewed effect.

## Decision

DesktopWorld browser projections use each display segment's exact native scale
factor. AOS fails closed when the requested backing dimensions exceed the
underlying WebGL implementation's hardware limits; it does not silently lower
quality. Render snapshots expose content-free effective scale, backing
dimensions, sample count, estimated allocation, frame timing, and damaged-pixel
percentage for profiling and acceptance.

Trusted projections may synchronously report a bounded global damage region.
AOS unions its previous and current bounds, intersects that region with each
display segment, and clears and renders only those scissor rectangles. Missing,
malformed, or explicitly full-stage damage falls back to a complete segment
render. Cleanup retains one final damage frame so pixels from a removed or
suspended resource cannot remain visible. Global DesktopWorld coordinates,
topology generations, clocks, and one renderer per segment remain unchanged.

V2 native-effect programs may optionally declare one generic geometry policy:

- `surface` tessellates each affected display surface at a bounded cell size;
- `event_point` creates one event-centered radial patch;
- `event_segment` creates one band around the event origin-to-current route;
- `event_endpoints` creates two event-centered radial patches.

AOS resolves those declarations into global rectangles, clips them against the
existing display segments, combines the resulting patches into one mesh buffer
per active segment, and rejects aggregate triangle, vertex, patch, or byte
budget overflow before publication. Geometry is allocated once per effect
instance, never per frame or pointer update, and is disposed with the existing
native-sheet lease. Programs that omit geometry retain the prior fixed 64 by 64
behavior.

V2 materials additionally support a bounded `standard` mode with roughness,
specular, Fresnel, and captured-texture refraction parameters. AOS compiles only
trusted shader templates. Consumers provide finite data declarations and event
bindings; they do not provide Metal source, pixels, native handles, loops, or
resource allocation instructions.

Full-desktop browser damage and `surface` native geometry are explicit,
temporary workloads. Small effects should declare point, segment, or endpoint
regions. AOS does not add tiled windows, another renderer, a second topology,
or automatic quality fluctuation without measured evidence that exact native
fidelity cannot sustain the required workload.

## Consequences

- A shared consumer render rig can retain editor-quality edges, lighting, aura,
  and framing on mixed-density desktop displays.
- Cross-display effects remain one global composition while each physical
  segment performs only its intersecting work.
- Consumers can tune dense radial and route meshes plus richer materials
  without adding product-named effects to AOS.
- Native DPR is the default fidelity policy. Quality reduction requires an
  explicit later decision supported by measured frame, memory, and lifecycle
  evidence.
- Fixed-time visual parity, bounded full-stage workloads, and repeated
  activation/disposal become acceptance obligations for consumers and AOS.
