# AOS Drag Action Control Surface V0

## Tracker

- Status: follow-up card, not yet routed.
- Related current slice:
  `docs/design/work-cards/real-input-surface-test-primitives-and-seam-radial-v0.md`
- Related code:
  - `src/act/actions.swift`
  - `src/act/act-cli.swift`
  - `src/act/act-models.swift`
  - `src/act/act-helpers.swift`
  - `src/shared/command-registry-data.swift`
  - `tests/lib/real-input-surface-harness.sh`
  - `tests/lib/sigil/radial-menu.sh`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Problem

`aos do drag` is currently too thin to be the canonical primitive behind rich
real-input scenarios.

The live CLI shape is:

```bash
aos do drag <x1,y1> <x2,y2> [--speed N] [--state-id id]
```

`cliDrag()` only overrides `state.profile.mouse.pixels_per_second` for
`--speed`. `handleDrag()` still uses the active profile's Bezier path and
`profile.mouse.jitter`. The built-in natural profile has `jitter: 2`, so a very
slow or short drag can retain human jitter even when a test intended a precise
or direct gesture.

That is why test harnesses are tempted to create private Quartz helpers for
eased paths, holds, direct paths, and semantic drag gestures. Those helpers may
be useful as temporary adapters, but repeated private action logic is a smell:
test primitives should usually be shorthand over AOS action primitives, not a
parallel action system.

## Goal

Promote drag into an expressive AOS action control surface with named intent,
cascading defaults, and explicit overrides. Tests should be able to say
"perform this drag expression" without owning motion generation details.

The exact CLI grammar can change after implementation review, but V0 should
support these concepts:

- source and destination nouns: from point/target to point/target;
- mode: `human`, `precise`, or `direct`;
- speed or duration;
- curve: linear/ease/bezier;
- jitter/erraticness as explicit options, including zero;
- overshoot as an explicit option;
- hold/dwell at start, intermediate points, and end;
- optional waypoints for path-like gestures;
- button selection where supported;
- structured output describing resolved options, path stats, and duration.

## Design Direction

Prefer one canonical action model shared by CLI, session JSON, and test helpers.
Avoid creating a test-only drag language that cannot be used by agents or apps.

Potential public shapes:

```bash
aos do drag 100,100 500,500 --mode human
aos do drag 100,100 500,500 --mode precise --duration 450ms --curve ease --jitter 0
aos do drag path --from 100,100 --through 180,120 --through 220,160 --to 500,500 --mode human --hold 120ms
```

or a JSON/session equivalent:

```json
{
  "action": "drag",
  "from": { "x": 100, "y": 100 },
  "to": { "x": 500, "y": 500 },
  "motion": {
    "mode": "precise",
    "duration_ms": 450,
    "curve": "ease",
    "jitter": 0
  }
}
```

Do not overfit the grammar before reading the command registry and action
session model. The important contract is that `--speed` is no longer an
ambiguous partial override: if a caller chooses precision/directness, jitter and
curve behavior become explicit.

## Test Primitive Relationship

After this exists, real-input test helpers should become compact shorthands over
public AOS drag expressions:

- `drag_human(from, to)` maps to the canonical human drag mode;
- `drag_precise(from, to)` maps to jitter-free precise mode;
- radial or seam gestures compose public drag/move/hold expressions rather than
  posting their own private path unless there is an unavoidable macOS boundary.

If a helper still has to use Quartz directly, it must say why the public action
surface is insufficient and should point back to this card or its successor.

## Required Behavior

- Existing `aos do drag <from> <to>` remains compatible.
- Existing `--speed` remains accepted, but its interaction with jitter/curve is
  documented and deterministic.
- A precise/direct mode produces monotonic, jitter-free pointer movement
  suitable for tests.
- A human mode preserves natural behavior but keeps jitter proportional enough
  that short/slow drags do not visibly vibrate or reverse intent.
- Dry-run output and command help include resolved motion options.
- The implementation reports enough path metadata for tests to assert the mode
  used without pixel-inspecting the entire cursor stream.

## Hard Boundaries

- Do not tie the action primitive to Sigil or radial menus.
- Do not make tests depend on private Swift internals.
- Do not remove profile support; this should refine cascading overrides, not
  replace profiles.
- Do not change browser Playwright drag behavior unless the grammar changes
  require a clearly documented adapter decision.

## Verification

Suggested focused checks:

```bash
git diff --check
./aos do drag --help
./aos do drag 100,100 110,100 --mode precise --duration 200ms --dry-run
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
```

Add deterministic Swift/CLI contract tests where this repo already tests command
registry/help surfaces. If live input is available, add a small real-input probe
that compares precise/direct short-drag stability against human mode without
requiring a specific app.

## Completion Report

Report:

- final public grammar;
- compatibility behavior for old `aos do drag <from> <to> [--speed]`;
- how cascading profile/default/override resolution works;
- what mode real-input test helpers should use;
- live or deterministic proof that precise/direct short drags do not inherit
  natural jitter.
