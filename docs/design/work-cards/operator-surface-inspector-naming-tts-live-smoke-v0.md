# Operator Surface Inspector Naming TTS Live Smoke V0

## Tracker

- Epic: #223 AOS Surface System
- Related issue: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions
- Related work card:
  - `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume daemon, canvas,
permission, audio, or prior verification state. Read and rediscover before
observing.

## Goal

Live-smoke the Surface Inspector naming and voice-announcement cleanup after the
repo-mode macOS permission reset is complete.

The intended user-facing name is **Surface Inspector**. The component path,
manifest name, and see-bundle namespace intentionally remain
`canvas-inspector` / `canvas_inspector_bundle` compatibility contracts.

## Read First

- `AGENTS.md`
- `docs/design/aos-surface-system.md`
- `docs/api/toolkit/components.md`
- `packages/toolkit/components/canvas-inspector/launch.sh`

## Rediscover State

If the human has just removed/re-added repo-mode Accessibility/Input Monitoring
permissions and returned with "ready", run:

```bash
./aos ready --post-permission
```

Otherwise run:

```bash
./aos ready
```

If readiness reports a TCC or input-tap blocker, stop and report the exact
blocker. Do not improvise a permission repair loop.

Then inspect:

```bash
git status --short --branch
./aos show list --json
```

## Required Observations

- Launching the toolkit inspector through
  `packages/toolkit/components/canvas-inspector/launch.sh` creates
  `surface-inspector` by default.
- The old `canvas-inspector` canvas is absent after default launch, unless
  compatibility was intentionally forced.
- `./aos show wait --id surface-inspector --manifest canvas-inspector` succeeds.
- Status item / Sigil utility entry labels say `Surface Inspector`, not
  `Canvas Inspector`.
- When voice announcements are enabled, create/remove announcements say
  `Surface Inspector displayed` and `Surface Inspector removed`, not
  `Canvas canvas inspector displayed`.
- Log console announcements say `Log Console`.
- `remove-all` announcement says `All surfaces removed`.
- Compatibility remains visible where intended: component route
  `aos://toolkit/components/canvas-inspector/index.html`, manifest
  `canvas-inspector`, and see-bundle namespace/config
  `canvas_inspector_bundle`.

## Suggested Evidence

- `./aos show list --json` before/after launch.
- Exact command used to launch Surface Inspector.
- A short note on heard TTS phrases, or a clear statement if audio could not be
  observed.
- One compatibility check, such as
  `./aos show wait --id surface-inspector --manifest canvas-inspector`.

## Hard Boundaries / Non-Goals

- Do not implement fixes.
- Do not rename the component directory, manifest name, or
  `canvas_inspector_bundle` namespace.
- Do not combine this with broad Surface Inspector annotation QA.
- Do not expand into general panel/windowing QA; run the minimize smoke only if
  Foreman routes that separate card.

## Completion Report

Include:

- exact readiness result;
- actions performed;
- whether default launch used `surface-inspector`;
- whether legacy `canvas-inspector` was absent or intentionally present;
- heard or observed announcement phrases;
- compatibility checks performed;
- blockers or follow-up needed.
