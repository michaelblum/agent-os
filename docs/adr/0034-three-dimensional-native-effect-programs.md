# ADR 0034: Three-Dimensional Native Effect Programs

- Status: Accepted
- Date: 2026-07-29
- Extends: ADR 0033
- Extended by: ADR 0035

## Context

ADR 0033 moved desktop effects from product-named AOS shaders to bounded,
consumer-authored data programs. Its V1 output can displace captured texture
samples, but it cannot move the tessellated native sheet or derive material
lighting from that geometry. A consumer could therefore tune a lens-like 2D
distortion without rebuilding AOS, but could not reproduce a Three.js-style
height-field ripple from the same artifact.

Copying Three.js, accepting shader source, or embedding product effects in AOS
would violate the privileged-runtime boundary. A finite intermediate
representation can instead provide the useful shared vocabulary while AOS
retains compilation and GPU authority.

## Decision

`aos.scene.native-effect-program.v2` extends the existing typed graph with
`vec3`, vector composition and component operators, and the read-only
`surface.position` builtin. A V2 program produces:

- a bounded `vec3` position offset for the existing tessellated sheet;
- a bounded `vec2` captured-texture displacement;
- a bounded scalar opacity; and
- one bounded material declaration using unlit or Lambert lighting, a light
  direction, normal-sampling distance, and perspective distance.

AOS evaluates position offsets in the global DesktopWorld coordinate plane.
Each display retains its existing native window, mesh, capture texture, and
input-transparent lifecycle. The renderer derives normals from neighboring
graph evaluations and projects the deformed world point through one common
global center and perspective before converting it to segment clip space. The
all-display clock, activation, capture, budget, and disposal contracts do not
change.

V1 remains accepted without reinterpretation. V2 adds no loops, source code,
texture reads, resource creation, topology mutation, arbitrary uniforms, or
native handles. Final position offsets are clamped to 512 DesktopWorld points;
the existing texture-displacement, opacity, graph-size, duration, program-count,
and transcendental budgets remain enforced.

The toolkit may deterministically compile the same validated program into a
Three.js-compatible GLSL evaluation function for trusted browser previews. The
generated source contains only registered templates and numeric graph nodes;
consumer text never becomes executable source. This preview backend does not
capture pixels, mount a scene, grant authority, or replace AOS's Metal backend.

## Consequences

- A consumer can own and tune a height-field ripple or related bounded
  deformation without changing or rebuilding AOS.
- Companion Studio can preview the same artifact used by the native Metal
  renderer instead of maintaining a second hand-authored visual definition.
- AOS remains the game engine and privileged renderer; consumers own the art,
  presets, and event bindings.
- Stateful pulse arrays, continuous wake emission, fragmenting or tearing the
  sheet, multipass desktop reconstruction, and topology-changing sinkholes need
  separately reviewed generic capabilities. V2 does not claim parity for them.
- Satin, RealityKit, and unrestricted Three.js shader APIs are not dependencies
  or extension ABIs.
