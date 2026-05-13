# Surface Inspector Annotation Hit Layer Empty Regions Crash V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Follows landed native AX slice: `04198c9 Add native AX annotation candidates`

## Fresh Context Contract

GDI starts from a fresh context window. Work in `/Users/Michael/Code/agent-os`.
Do not revert the landed native AX adapter work. Amend it with the smallest
safe correction.

## Goal

Fix the live-smoke crash when Surface Inspector Annotation Mode is enabled with
no current hit regions.

After repo-mode TCC was reset, `./aos ready --post-permission` passed:

```bash
ready=true mode=repo daemon=reachable tap=active
```

Then Foreman relaunched Surface Inspector and posted:

```bash
./aos show post --id surface-inspector --event '{"type":"canvas_inspector.annotation_toggle","reason":"native_ax_smoke"}'
```

The post succeeded, but the daemon crashed before the next eval. The daemon log
shows:

```text
[canvas-sub] added perception channel canvas=surface-inspector ... depth=2 rate=on-change
[canvas-sub] subscribe canvas=surface-inspector events=["input_event", "window_entered", "element_focused"] ...
*** Terminating app due to uncaught exception 'NSInternalInconsistencyException', reason:
'Invalid parameter not satisfying: CGRectContainsRect(..., frame). self=<aos.CanvasWindow ...> frame={{nan, nan}, {nan, nan}}'
```

Review points at `packages/toolkit/components/canvas-inspector/index.js`:

- `syncAnnotationHitLayer()` computes:
  `const frameRect = rectUnion(regions.map((region) => region.rect)) || currentFrameFallback()`
- `currentFrameFallback()` returns a canvas frame array `[x, y, w, h]`.
- `syncAnnotationHitLayer()` treats the fallback as a rect object:
  `frameRect.x`, `frameRect.y`, `frameRect.w`, `frameRect.h`.
- When regions are empty, that yields `NaN` and the daemon receives a bad
  `canvas.create` frame for the annotation hit layer.

## Required Behavior

Enabling Annotation Mode must never create/update an annotation hit-layer canvas
with non-finite frame values.

If no projectable hit regions exist yet:

- either skip hit-layer canvas create until at least one region exists; or
- use a validated finite fallback rect derived from the Surface Inspector frame.

The preferred behavior is conservative: skip creating the hit layer when there
are no regions, keep Annotation Mode active, and continue waiting for cursor,
window, canvas, or AX candidate events to populate regions.

The fix should also make the daemon more robust if possible:

- reject `canvas.create` / `canvas.update` frames with non-finite values before
  constructing an `NSWindow`;
- return a structured error instead of crashing the daemon.

Keep this scoped. Do not add browser DOM/CDP work, AX harvesting, or any new
Annotation Mode UX.

## Suggested Tests

Add deterministic coverage for the no-region hit-layer path. Good options:

- export/test a small frame-normalization helper from
  `packages/toolkit/components/canvas-inspector/index.js`;
- or add a source/assertion test proving `syncAnnotationHitLayer()` cannot use
  array fallback values as object rects;
- and, if touching Swift validation, add a focused shell or Swift-facing test
  proving bad non-finite canvas frames are rejected without daemon crash.

Also preserve the native AX candidate tests from the landed slice.

## Verification

Run:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/canvas-inspector-ax.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
./aos dev recommend --json
```

If Swift changes are made:

```bash
./aos dev build
bash tests/daemon-ipc-system.sh
```

Always run:

```bash
git diff --check
./aos ready
```

If readiness passes, rerun the bounded live smoke:

1. Relaunch Surface Inspector.
2. Enable Annotation Mode.
3. Confirm daemon does not crash.
4. Confirm `system.ping` or `./aos status` remains reachable and input tap active.
5. Continue the native AX smoke from the previous card if the no-region crash is
   fixed.

## Completion Report

Report back with:

- changed files;
- exact crash fix;
- whether Swift frame validation was added;
- verification commands;
- live smoke result or remaining blocker.
