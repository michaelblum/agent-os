# DesktopWorld Planning Session Brief

**Date:** 2026-04-19  
**Status:** active  
**Purpose:** first-turn calibration for a fresh planning session before it is
allowed to draft the daemon/API DesktopWorld implementation plan

## Mission

Do not write the implementation plan immediately.

First, prove that you understand the current spatial contract, the remaining
legacy surfaces, and the difference between the logical shared world and the
native compatibility boundary.

After answering the questionnaire below, stop and wait for human review.

## Current State

The repo has already shifted its canonical shared-world contract:

- `DesktopWorld` is now the canonical cross-surface space
- `DesktopWorld` origin is the top-left of the arranged full-display union
- `VisibleDesktopWorld` is a separate usable-area derivative
- main-display-anchored coordinates are compatibility/native-boundary only

Recent landed work already moved the docs and JS runtime in this direction:

- `c49eb64` docs(spatial): correct canonical desktop world contract
- `fe84531` refactor(spatial): re-anchor DesktopWorld to union origin

What is still incomplete:

- daemon/native payloads still expose old compatibility-shaped values in key
  places
- `aos runtime display-union` still mirrors legacy `global_bounds`
- several historical docs/tests/scripts still mention main-display-anchored
  behavior and must be treated carefully

## Authority And Read Order

Read these first:

1. `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md`
2. `shared/schemas/spatial-topology.md`
3. `ARCHITECTURE.md`
4. `packages/toolkit/runtime/spatial.js`
5. `src/display/display-geometry.swift`
6. `src/commands/runtime.swift`
7. `src/shared/types.swift`
8. `.agents/hooks/session-start.sh`

Historical context only, not canonical authority:

- `docs/superpowers/specs/2026-04-12-display-geometry-stream.md`
- `docs/superpowers/plans/2026-04-14-union-canvas-foundation.md`

## Response Rules

- Answer the questions below only.
- Do not propose an implementation plan yet.
- Cite concrete file paths in every answer.
- Keep each answer short but specific.
- Stop after the questionnaire.

## Questionnaire

1. Why is "top-left of the macOS main display = (0,0)" no longer acceptable as
   the canonical shared-world origin? Give the concrete monitor-toggle example
   and explain what should remain stable.

2. Distinguish `Native desktop compatibility`, `DesktopWorld`, and
   `VisibleDesktopWorld`. Which one is canonical, which one is derived, and
   which one should stay confined to the native boundary?

3. Name the highest-priority remaining implementation surfaces that still speak
   the old compatibility contract. For each one, say what is stale or risky
   about it.

4. What should `display_geometry` and `aos runtime display-union` mean after
   the daemon/API re-anchor? What compatibility strategy looks safest during the
   migration?

5. Why is `computeDisplayUnion()` currently a semantic smell? What distinction
   does the repo need to keep explicit instead of collapsing into one helper
   name?

6. What was misleading about the startup/display-debug guidance before cleanup,
   and what is the corrected interpretation of those panel placements now?

7. Which historical docs should not be used as the source of truth for the new
   planning work, and why?

8. If you are approved to continue after this questionnaire, what is the first
   planning move you would make, and in which markdown file would you put it?
