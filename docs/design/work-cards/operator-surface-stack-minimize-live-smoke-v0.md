# Operator Surface Stack Minimize Live Smoke V0

## Tracker

- Epic: #223 AOS Surface System
- Issue: #304 Toolkit minimized chips should use DesktopWorld stage layers and
  hit regions
- Related issues: #122 StageAffordance, #303 daemon input regions, #261 panel
  window placement
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume daemon, canvas,
permission, or prior verification state. Read and rediscover before observing.

## Goal

After the repo-mode TCC permission reset is complete, live-smoke the default
toolkit minimize path for Surface Inspector and report whether the stage-backed
chip path works in real pointer interaction.

This is a rerun after the live materialization correction in
`docs/design/work-cards/toolkit-stage-chip-live-materialization-correction-v0.md`.
The previous live smoke proved that the real minimize click suspended
`surface-inspector`, but no `aos-desktop-world-stage`, stage layer, input
regions, or `aos-chip-*` fallback materialized. The corrected path should now
create or reuse `aos-desktop-world-stage`, upsert one chip stage layer, register
body/restore/close input regions, and only then suspend the source panel.

## Read First

- `AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
- `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
./aos show list --json
```

If `./aos ready` still reports
`diagnosis=daemon_tcc_grant_stale_or_missing`, stop. Report the blocker and do
not improvise a permission repair loop.

## Required Observations

- Surface Inspector minimize should collapse promptly into a visual chip.
- `aos-desktop-world-stage` should exist or already be present before the source
  panel is left suspended.
- Surface Inspector should be able to observe one chip stage layer, three chip
  input regions, and one affordance for the minimized panel.
- The default path should not create an interactive `aos-chip-*` WebView canvas
  unless fallback was intentionally forced.
- Restore through the chip hit region should resume the source panel and remove
  the chip stage layer plus all chip input regions.
- Close through the chip hit region should remove the source panel and remove
  the chip stage layer plus all chip input regions.
- Duplicate minimize clicks should not create duplicate stage layers or
  duplicate input regions.
- Forced fallback should be observable as fallback, not silent confusion.

## Suggested Evidence

- Before and after `./aos show list --json` snapshots.
- Any Surface Inspector or daemon event output that shows stage layers, input
  regions, or fallback canvases.
- A short timing note for perceived minimize latency.
- A clear statement of whether `input_region.event` reaches the controller while
  the source panel is suspended.

## Hard Boundaries / Non-Goals

- do not implement fixes;
- do not migrate Sigil;
- do not change daemon permissions except through the documented safe reset path;
- do not expand into general panel/windowing QA.

## Completion Report

Include:

- exact readiness result;
- actions performed;
- observed minimize, restore, close, duplicate-minimize, fallback, and cleanup
  results;
- whether any `aos-chip-*` WebView appeared in the default path;
- any stale layers, input regions, subscriptions, or canvases observed;
- screenshots or command output snippets only where they clarify a pass/fail.
