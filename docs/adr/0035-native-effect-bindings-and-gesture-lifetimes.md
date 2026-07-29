# ADR 0035: Native Effect Bindings And Gesture Lifetimes

- Status: Accepted
- Date: 2026-07-29
- Extends: ADRs 0032, 0033, and 0034

## Context

The first native-sheet contract allowed one fixed-duration visual binding per
interaction. That supports click feedback, but not a coordinated interaction
where pointer feedback becomes a continuously controlled deformation and then
a separate release effect. Raising the three-second program duration would
hide the lifecycle mismatch and could leave a full-desktop native surface
alive after a lost terminal gesture.

AOS already owns gesture arbitration, pointer capture, DesktopWorld
coordinates, scene generations, the native sheet, and deterministic cleanup.
The effect lifecycle should follow those existing leases rather than introduce
a second input or topology system.

## Decision

An interaction may declare a bounded `nativeEffects` array. The legacy
singular `nativeEffect` field remains decode-compatible, but both forms may not
coexist. Each affordance may bind at most one effect to a given pointer button
or gesture phase: three pointer buttons plus start and end, for at most five
bindings per interaction. The complete document remains limited to 256
bindings.

Each binding has an optional lifecycle:

- omitted or `{ "kind": "timed" }` runs for the program's bounded duration;
- `{ "kind": "gesture" }` is valid only on a gesture `start` trigger.

A gesture-owned effect captures and installs one native sheet at gesture
start. Canonical gesture updates replace only its bounded event uniforms; they
do not recapture pixels, recreate geometry, compile a pipeline, or install
another sheet. Gesture end may atomically replace it with a timed end-phase
binding from the same interaction. Gesture cancellation or an end without a
replacement retires it immediately.

One native sheet remains active at a time. A later phase from the same owner,
resource revision, topology generation, and interaction may replace the active
phase after deterministic disposal. Unrelated effects and same-phase reentry
remain busy-rejected. Capture, installation, authorization, and replacement
races fail closed.

The three-second program-duration limit remains the artistic and resource
bound for timed effects. It is not the lifetime of a gesture-owned effect. A
gesture-owned effect remains active while its pointer lease is valid and has a
five-minute engine watchdog solely to recover from lost terminal input,
consumer failure, or transport loss. The watchdog is not consumer-configurable.

## Consequences

- Consumers can author click feedback, continuous drag deformations, and
  release transitions without adding product effects to AOS.
- Live gesture coordinates share the existing scene event contract and global
  DesktopWorld plane.
- The captured texture remains intentionally frozen for each effect instance;
  the underlying desktop and unrelated applications are not assumed frozen.
- AOS still exposes no pixels, native handles, shader source, or arbitrary
  executable extension code.
- Stateful history such as a many-sample wake still requires either a bounded
  declarative representation or a later reviewed engine primitive; this ADR
  does not authorize consumer loops or mutable GPU buffers.
