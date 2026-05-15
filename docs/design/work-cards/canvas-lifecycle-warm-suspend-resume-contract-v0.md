# Canvas Lifecycle Warm/Suspend/Resume Contract V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #123 Canvas warm, suspend, and resume lifecycle primitive
- Related issues: #120 input event identity, #303 generic input regions,
  #304 stage-backed minimized chips, #305 Sigil remodel
- Clarifying ADR:
  `docs/adr/0011-host-neutral-surfaces-use-capability-bounded-hosts.md`
- Prior work cards:
  - `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
  - `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
  - `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`
  - `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`
  - `docs/design/work-cards/input-event-v2-version-truth-correction-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make canvas warm/suspend/resume a clear daemon/toolkit lifecycle contract rather
than an app-specific trick.

The motivating symptom is slow first-use or slow minimize/restore behavior in
surfaces such as Surface Inspector and Sigil. The solution should not be a Sigil
workaround. It should make the primitive lifecycle semantics explicit enough
that toolkit panels, inspectors, and future Sigil surfaces can opt into warm
readiness with bounded resource cost.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/adr/0011-host-neutral-surfaces-use-capability-bounded-hosts.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `shared/schemas/daemon-event.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 123 --json number,title,state,url,body,labels
./aos dev recommend --json
```

The current repo-mode runtime is expected to be blocked for live pointer smoke:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Use deterministic and isolated-daemon tests while that remains true. Do not run
interactive live smoke until the safe TCC reset has happened.

## Current Evidence

- `src/display/canvas.swift` already has `suspend` and `resume`.
- `CanvasRequest` already accepts `suspended` on create/update.
- Resume waits for renderer `lifecycle.complete` ACK and falls back after a
  timeout.
- Toolkit runtime exports `suspendCanvas()` and `resumeCanvas()`.
- `packages/toolkit/runtime/_smoke/lifecycle.html`,
  `tests/lifecycle-complete.sh`, and `tests/lifecycle-complete-timeout.sh`
  already prove parts of resume ACK behavior.
- Stage-backed minimized chips currently suspend the source panel and resume it
  on restore, but there is no named warm/precreate contract for reusable
  surface readiness.

## Required Behavior

### Lifecycle Vocabulary

Document and enforce a small V0 lifecycle vocabulary:

- `cold`: no canvas/window/resource exists.
- `warming`: canvas has been requested and may be loading while hidden.
- `warm_suspended`: canvas exists, renderer has had a chance to load/ready, but
  its window is hidden/suspended.
- `active`: canvas is visible/interactive according to its normal flags.
- `suspended`: canvas was active and is now hidden/paused.
- `removed`: canvas and owned resources are gone.

Use different names only if the existing code has better terms, but make the
state machine explicit in docs and tests.

### Daemon Primitive

Prefer expressing warm V0 with existing primitives if they are sufficient:

- create a canvas with `suspended: true`;
- let its renderer load enough to emit ready/manifest;
- keep it hidden until `canvas.resume`;
- preserve parent/cascade semantics;
- preserve input-region cleanup on suspend/remove;
- publish lifecycle state through `canvas_lifecycle` snapshots/live updates.

If existing suspended create does not actually load enough to be useful as a
warm surface, add the smallest daemon primitive needed. Do not add app policy to
the daemon.

### Toolkit Runtime API

Expose a small runtime helper only if it removes real duplication. Likely
acceptable V0 shapes:

- `warmCanvas(options)` / `prewarmCanvas(options)` wrapping create-suspended +
  readiness wait;
- `createCanvasLifecycleController(options)` for warm/resume/suspend/remove
  bookkeeping;
- or a documented pattern using existing `spawnChild({ suspended: true })`,
  `resumeCanvas`, and `suspendCanvas` if no new helper is justified.

The helper or documented pattern must make these choices explicit:

- owner/parent canvas id;
- target canvas id;
- URL/content root;
- initial frame;
- timeout and failure behavior;
- whether warm canvases are interactive while suspended;
- cleanup on owner removal or setup failure.

### Resource Cost And Observability

Warm surfaces must be bounded and visible to agents:

- add or document a count/metadata field that lets Surface Inspector or
  lifecycle snapshots distinguish normal active canvases from warm suspended
  canvases;
- avoid silent unbounded pools;
- expose stale warm resources through existing lifecycle/resource inspector paths
  when possible;
- document which layer owns pool policy. V0 can be no pool, only explicit warm
  canvases.

### Panel/Stage Integration

Do not rewrite panel chrome broadly. Do prove that the lifecycle contract can
serve the existing surface stack:

- minimized stage chips continue to use source suspend/resume correctly;
- restore must not wait on a hidden WebView chip path unless the fallback is
  explicitly selected;
- default panel/window policy remains toolkit-owned;
- daemon remains a lifecycle/input/display primitive layer.

### Sigil Position

Do not start Sigil migration in this slice.

Add a short note to `apps/sigil/AGENTS.md` or the design doc only if needed:
Sigil may later use the lifecycle primitive for avatar/menu/workbench warming,
but should not keep inventing private warm-hidden surfaces once toolkit/daemon
primitives are available.

## Scope

Primary ownership is daemon lifecycle plus toolkit runtime. Touch panel tests
only enough to prove minimize/restore remains compatible. Touch Sigil docs only
as a future consumer note.

## Hard Boundaries / Non-Goals

- Do not start the Sigil platform-stage remodel.
- Do not build a daemon window manager.
- Do not add a broad global canvas pool with automatic eviction unless the
  existing code already has a narrow natural home for it.
- Do not make every canvas warm by default.
- Do not change Browser Host vs Canvas Host boundaries from ADR 0011.
- Do not run live pointer smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

Inspect before editing:

- `src/display/protocol.swift`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/runtime/_smoke/lifecycle.html`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/components/surface-inspector/`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/aos-surface-system.md`
- `shared/schemas/daemon-event.md`
- `tests/lifecycle-complete.sh`
- `tests/lifecycle-complete-timeout.sh`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/runtime-canvas-lifecycle.test.mjs`

## Verification

Run focused deterministic tests:

```bash
git diff --check
node --test tests/toolkit/runtime-canvas-lifecycle.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
bash tests/lifecycle-complete.sh
bash tests/lifecycle-complete-timeout.sh
```

If schema or public docs change, also run:

```bash
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
```

If Swift changes, run:

```bash
./aos dev recommend --json
./aos dev build --force
```

If `./aos ready` passes after build, run a bounded smoke:

1. create or warm a toolkit smoke canvas in suspended/warm state;
2. prove it appears in lifecycle snapshots as warm/suspended;
3. resume it and verify renderer readiness/ACK behavior;
4. suspend it again and verify resources remain bounded;
5. remove it and verify no stale lifecycle/resource entry remains.

If readiness reports `daemon_tcc_grant_stale_or_missing`, skip live smoke and
report that blocker.

## Completion Report

Include:

- final lifecycle vocabulary and state transitions;
- whether warm V0 used existing suspended create or added a new primitive;
- toolkit helper or documented pattern added;
- resource-cost/observability behavior;
- panel/stage compatibility result;
- tests run with exact results;
- build result if Swift changed;
- live smoke result or TCC blocker;
- recommended next slice for #303/#305 after lifecycle V0.
