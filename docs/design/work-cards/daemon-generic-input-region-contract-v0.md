# Daemon Generic Input Region Contract V0

## Tracker

- Epic: #223 AOS Surface System
- Issue: #303 Daemon generic input regions for DesktopWorld-bound hit areas
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- Related code: `src/daemon/unified.swift`,
  `src/daemon/input-surface-ownership.swift`,
  `packages/toolkit/runtime/interaction-region.js`,
  `apps/sigil/renderer/hit-area.html`

## Goal

Replace Sigil-specific daemon input consumption with a generic AOS input-region
primitive that toolkit and apps can use for small hit areas coupled to
DesktopWorld visuals.

This is the native primitive needed before toolkit minimized chips, Sigil radial
items, and future desktop-stage affordances can avoid spawning one interactive
WebView per tiny rect.

## Current Evidence

- `src/daemon/unified.swift` keeps `SigilInputState`, `sigil_input_mode`, and
  hard-coded canvas ids such as `avatar` and `agent-chat`.
- Generic input-surface consumption exists but is gated behind
  `AOS_GENERIC_INPUT_CONSUME`.
- Toolkit has a JS-only region router in
  `packages/toolkit/runtime/interaction-region.js`, but it cannot by itself
  decide whether the daemon should consume native input.
- Sigil hit areas and radial menu target surfaces prove the binding pattern but
  implement it with extra canvases.

## Required Contract

Design and implement the smallest daemon contract that supports:

- registering, updating, and removing rectangular input regions in native or
  DesktopWorld coordinates;
- associating each region with an owner canvas, semantic label, priority,
  consume policy, and optional metadata;
- routing native pointer phases to the owning canvas or subscriber;
- deciding whether to consume the event before it reaches underlying apps;
- removing regions on owner canvas removal or suspend when appropriate;
- exposing enough state for Surface Inspector or tests to inspect active regions.

Prefer neutral event names such as `input_region.register`,
`input_region.update`, `input_region.remove`, and `input_region.event` unless
the existing IPC shape strongly suggests a better convention.

## Migration Requirements

1. Keep existing Sigil behavior working.
2. Move Sigil-specific daemon logic behind the new generic contract or remove it
   once Sigil registers equivalent regions.
3. Do not add new hard-coded app ids to daemon input handling.
4. Coordinate with toolkit runtime so a later stage-backed chip can register
   restore/close/drag regions without a WebView chip.

## Suggested Implementation Areas

- `src/daemon/unified.swift`
- `src/daemon/input-surface-ownership.swift`
- `src/display/canvas.swift`
- `shared/schemas/daemon-event.md` or a new schema if the event becomes public
- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/interaction-region.js`
- focused tests under `tests/daemon/`, `tests/toolkit/`, or existing harnesses

## Verification

Run focused tests for the changed contract. At minimum:

```bash
git diff --check
```

If Swift files change, use the repo workflow router before building:

```bash
./aos dev recommend --json
./aos dev build
```

If `./aos ready` passes, run a bounded smoke that registers one temporary region,
clicks it with real or synthetic input as appropriate, verifies event delivery,
then removes the region and proves it no longer consumes input.

## Non-Goals

- no full window manager in the daemon;
- no panel/chip visual implementation in this slice;
- no broad Sigil renderer remodel beyond registering equivalent regions;
- no general desktop replacement behavior outside AOS-owned regions.

## Completion Report

Include:

- final daemon input-region API shape;
- how Sigil-specific input logic was retained, wrapped, or removed;
- tests run;
- any remaining blockers for stage-backed minimized chips.
