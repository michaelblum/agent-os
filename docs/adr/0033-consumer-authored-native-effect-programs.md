# ADR 0033: Consumer-Authored Native Effect Programs

- Status: Accepted
- Date: 2026-07-28
- Supersedes: the complete-effect registry requirement in ADR 0032
- Extended by: ADRs 0034 and 0035

## Context

ADR 0032 proved that a committed scene interaction can trigger a low-latency,
cross-display Metal effect over AOS-owned desktop textures without exposing
pixels or native handles. Its first implementation hard-coded a complete Ripple
shader and product-facing parameter vocabulary into AOS. That proved the native
path, but it would require an AOS source change and managed-Mac rebuild for every
new consumer effect or visual adjustment.

AOS is the privileged engine and console. A consumer such as Sigil owns its art,
presets, and input bindings. The boundary therefore needs more expression than
a complete-effect registry and less authority than arbitrary JavaScript or Metal
source inside the daemon.

## Decision

The scene interaction document may contain up to eight
`aos.scene.native-effect-program.v1` declarations in a
`nativeEffectPrograms` catalog. An interaction selects one by `programId` through
the generic `aos.scene.effect.program` implementation and supplies bounded
parameter overrides plus an existing pointer or gesture trigger.

An effect program is finite JSON containing:

- a canonical identity, positive revision, and bounded duration;
- at most 16 bounded scalar parameter declarations;
- a forward-only typed graph of at most 64 scalar or `vec2` nodes;
- registered arithmetic, trigonometric, vector, interpolation, and
  point-to-segment operators; and
- one DesktopWorld-point displacement output and one opacity output.

Programs may read only the shared elapsed clock, per-fragment global
DesktopWorld position, surface size and UV, and the frozen recognized event's
origin, current point, delta, and total delta. They cannot read pixel values,
declare loops or branches, create resources, issue draw commands, reference
remote assets, or contain source code.

AOS validates and type-checks the graph independently in the toolkit and native
runtime. It generates Metal source exclusively from trusted templates and
numeric node indexes. Structural validation and the cumulative 32-program
DesktopWorld budget reject before an operation enters all-display scene
dispatch. After committed authorizations change, AOS atomically prepares the
candidate GPU context by canonical program digest on a dedicated serial queue,
while native-effect input admission remains closed. Main-actor publication is a
generation-checked pointer swap; stale candidates are discarded without
touching shared resources. A preparation failure retains the previous prepared
context and leaves the new native effect unavailable; it does not roll back an
otherwise usable committed browser scene. No consumer string becomes executable
source. Generated exponentials, division, and normalization use total bounded
semantics. AOS clamps final displacement to 96 DesktopWorld points and final
opacity to `[0, 1]`.

The complete interaction document, including its program catalog and parameter
overrides, remains covered by the cartridge's existing canonical digest. The
trusted scene extension still grants the two explicit capabilities
`aos.scene.desktop_frame_texture` and `aos.scene.native_sheet_effect`; it does
not own or execute the effect program. Program or preset changes therefore
change cartridge bytes without changing extension authority.

The existing native sheet, capture broker, per-display segmentation, global
coordinate plane, shared clock, one-active-effect admission, input routing,
authorization checks, transparent compositing, deadlines, and deterministic
disposal remain authoritative. The engine samples the desktop once per effect
instance and never exposes the frame to the consumer.

`aos.scene.effect.desktop-ripple` remains dual-read as an internal compatibility
path until reviewed consumers migrate. New product effects must use the program
contract. AOS may add general operators or render-pass capabilities when a new
class of graphics requires them; it must not add product-named effects or
parameters.

## Consequences

- Sigil can own and revise Ripple, Wake-like segment effects, and future bounded
  desktop distortions without rebuilding AOS for each composition or preset.
- AOS remains the only capture, GPU, topology, clock, budget, and disposal owner.
- V1 remains one texture-deformation/compositing pass. ADR 0034 adds bounded
  deformation of the existing tessellated sheet; new geometry sources,
  topology mutation, bounded multipass programs, or active input streams still
  require separately reviewed generic contract additions.
- A continuously updated pointer wake is not implied by the frozen-event V1
  contract. A segment wake can use the recognized origin and current point.
- Raw consumer shaders, native handles, public pixels, and a second scene or
  topology engine remain prohibited.
- Program-unavailable state degrades only the optional native visual. Gesture
  recognition, the WebKit/Three scene, and other DesktopWorld interactions
  remain usable.
