# Desktop Pixel Native Baseline

`aos runtime probe desktop-pixels` is a temporary, explicit development proof.
It answers one question before any daemon, broker, consent, scene-resource, or
consumer abstraction participates: can the current AOS executable move current
desktop pixels from ScreenCaptureKit to one Metal surface per active display?

The command has two explicit host modes:

- `standalone` preserves the original direct per-display windows as the known-
  working control;
- `desktop-world` installs the same Metal renderer beneath the transparent
  WebKit layer in AOS's existing per-display DesktopWorld segment windows.

Both modes:

- uses only an existing Screen Recording grant and never requests permission;
- keeps captured pixels in memory and emits content-free timing facts;
- starts no daemon and uses no scene or desktop-pixel broker;
- bounds display count, pixels, tessellated geometry, presentation time, and
  visible duration;
- ignores pointer input and disposes streams, textures, geometry buffers, GPU
  pipeline resources, views, and windows before returning.

Run it only at a supervised native checkpoint with the daemon and product
consumers stopped:

```bash
./aos runtime probe desktop-pixels \
  --host standalone \
  --presentation inverted \
  --hold-ms 750 \
  --json
```

After the standalone control passes, prove the first infrastructure increment
without changing capture or rendering:

```bash
./aos runtime probe desktop-pixels \
  --host desktop-world \
  --presentation inverted \
  --hold-ms 750 \
  --json
```

The DesktopWorld-hosted result includes its canvas and topology generations plus
the stable AOS-owned sheet address `io.agent-os::native-sheet/main`. The sheet
is one logical DesktopWorld resource implemented by one coordinated native view
per physical display; it is not a single cross-display AppKit window. The stage
owns topology and windows, while the sheet owns only its native projection
hosts and a preallocated 64-by-64 tessellated mesh per segment. Every mesh
vertex carries its position in the shared DesktopWorld coordinate plane, so a
future effect can remain coherent across segment boundaries without creating a
second topology. The proof resolves the exact address before presentation and
must report zero installed sheets, geometry buffers, textures, and shared GPU
resources after cleanup. It still starts no daemon and creates no scene
document or scene-protocol lease. Each native view is lazy,
input-transparent, placed beneath WebKit, and retired by the existing canvas
lifecycle coordinator.

`identity` presents captured pixels unchanged. `inverted` is a visible proof
transform; it is not a reusable effect contract.

This command is not a consumer API and must not be invoked by Sigil. A passing
result establishes the native baseline for subsequent increments. Each later
layer must rerun the same proof before it can replace or absorb this path:

1. existing display topology and window ownership;
2. an addressable AOS-owned native sheet;
3. budgets and deterministic disposal;
4. reviewed consumer effect parameters and event triggers;
5. gesture and scene coordination;
6. explicit permission priming and passive consent status;
7. bounded image-product adapters for perception, crops, redaction, and diffs.

The intended product path is in-process and event-driven. The native sheet is a
specialized low-latency desktop-compositing lane, not a second general scene
engine. Later increments may add bounded geometry, materials, render passes,
parameters, and clock bindings suitable for screen-aligned and bounded desktop
effects. A loaded consumer cartridge may bind a companion affordance event such
as pointer-down to a named digest-reviewed effect program and bounded
parameters. AOS resolves and runs that program on its owned sheet, capture,
topology, clock, and Metal resources; it does not spawn this proof command for
each interaction. Three.js remains the richer object-scene lane. The two lanes
share DesktopWorld coordinates, signals, gestures, timing, and lifecycle rather
than pretending to share one renderer. Agent-facing scene or `show` tooling may
later invoke and inspect the same sheet, but that is a manual/debug route rather
than the interaction hot path.

Do not backfill an existing abstraction merely because it already exists. A
layer is retained only when the unchanged native proof remains green and the
layer provides a necessary ownership or safety property.
