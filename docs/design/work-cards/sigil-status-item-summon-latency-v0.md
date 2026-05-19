# Sigil Status Item Summon Latency V0

## Tracker

- Status: completed as no-code verification on 2026-05-19.
- Follow-up from `docs/design/work-cards/sigil-render-performance-regression-v0.md`.
- Accepted baseline commit: `11df6de` (`fix(sigil): cheapen idle avatar render loop`).
- User report: after the idle render fix, status-item hidden-to-visible summon
  still timed out on the first real-click path.
- Follow-up: `docs/design/work-cards/aos-do-click-real-input-delivery-latency-v0.md`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvas,
runtime readiness, or root cause. Rediscover before editing.

## Goal

Make the macOS status item reliably summon Sigil from renderer-hidden state on
the first real click.

This slice targets status item event/state synchronization. It should not reopen
the idle render loop work, and it should not take on Wiki Workbench cold-start
latency.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `src/AGENTS.md`
- `src/display/status-item.swift`
- `src/commands/serve.swift`
- `src/daemon/unified.swift`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/lib/status-item.sh`
- `tests/lib/visual-harness.sh`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/status-item-tracked-lifecycle-timeout.sh`
- `tests/sigil-real-input-status-avatar.sh`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "status_item\\.state|status_item\\.toggle|status_item\\.show|status_item\\.hide|persistentVisible|setPersistentVisible|togglePersistentCanvas|sendToggleIntent|onEvent|onMenuItems|emitStatusItemState" src apps/sigil tests
```

If Swift files change, use the repo build surface recommended by the router.
Do not call `bash build.sh` directly.

## Current Evidence

Before the idle render fix, Foreman measured:

- after forcing hidden state with `status_item.hide`, the first real status
  click failed to summon within `5000ms`;
- the second real click summoned in `1516.6ms`;
- a repeated cycle behaved the same: first click timed out after `5000ms`,
  second click summoned in `1417.1ms`.

After the older idle render fix, GDI measured:

- status-item hidden-to-visible summon remained slow at `20508.7ms`;
- idle render loop was no longer hot, so this is likely no longer render-loop
  scheduling.

After the corrected `11df6de` idle render performance slice, GDI measured:

- idle visible avatar stayed animated with `work.visualOnly=true`;
- pure avatar-motion frames had `structural=false`, `overlay=false`, and
  `publishState=false`;
- render-performance `sigil-avatar` reported `targetFps=30`, current FPS
  `30.3`, average FPS `29.2`, P95 `35ms`, over budget `0%`, and stable state;
- WebKit GPU dropped to about `18.5%` from the prior `47-51%`;
- daemon dropped to about `7.8%` from the prior `10-11%`;
- status-item summon after hidden state still timed out at `8000ms`.

Treat the status path as independent from idle avatar render-loop cost unless
new evidence proves otherwise.

GDI verification on `gdi/sigil-status-item-summon-latency-v0` found no code
change was needed after reset to `origin/main` at `e8d9c31`:

- the base already contains the generic `status_item.state` bridge from target
  canvas messages to `StatusItemManager.setPersistentVisible`;
- the bridge is scoped by `canvasID == mgr.toggleId`;
- `bash tests/sigil-status-item-lifecycle.sh` passed;
- `bash tests/status-item-tracked-lifecycle-timeout.sh` passed;
- `bash tests/sigil-real-input-status-avatar.sh` passed;
- `./aos ready` reported `ready=true mode=repo daemon=reachable tap=active`;
- direct split timing measured `./aos do click` command overhead at `2028.1ms`,
  renderer visible `165.8ms` after the click command returned, and total
  click-to-visible time `2193.8ms`.

Conclusion: status-item state synchronization is not the remaining slow stage.
The remaining measured cost belongs to real-input click delivery / CLI harness
overhead, now tracked separately.

Historical Foreman scoping had found a likely synchronization gap to confirm:

- Sigil emits `host.post('status_item.state', { visible })` from
  `emitStatusItemState()` in `apps/sigil/renderer/live-modules/main.js`.
- `StatusItemManager` owns a private `persistentVisible` boolean and has
  `setPersistentVisible(_:)`, but `rg` did not find a live consumer for
  `status_item.state` in `src/commands/serve.swift`, `src/daemon/unified.swift`,
  or `src/display/status-item.swift`.
- If `persistentVisible` remains `true` after the renderer is forced hidden,
  the next status click will send another hidden intent instead of visible,
  matching the observed first-click no-op pattern.

Treat this as a hypothesis, not a conclusion. Confirm with trace/log evidence
before patching.

## Required Behavior

For persistent tracked status item targets such as Sigil:

- the status item must keep its visible/hidden state in sync with renderer
  `status_item.state` messages from the configured target canvas;
- after renderer-driven hide, the next left click must send a visible intent on
  the first click;
- after renderer-driven show, the next left click must send a hidden intent on
  the first click;
- icon fill/animation state should reflect the same source of truth;
- cold-create and warm persistent canvas behavior must keep working;
- generic status item behavior stays daemon/native, while Sigil owns avatar
  product semantics and visibility animation.

Do not add Sigil-specific product policy to the daemon. A generic configured
target state bridge is acceptable; hard-coded Sigil behavior is not.

## Scope

Likely files:

- `src/display/status-item.swift`
- `src/commands/serve.swift` or `src/daemon/unified.swift` if event routing is
  the missing bridge
- `apps/sigil/renderer/live-modules/main.js` only if the emitted state payload
  needs a compact generic field
- focused status-item tests under `tests/`

Avoid broad lifecycle rewrites. Do not change radial menu semantics or Wiki
Workbench activation in this slice.

## Suggested Investigation

1. Add temporary trace or use existing logs to prove what the first real click
   sends after renderer-hidden state: `target_state=hidden`, `visible`, or no
   delivery.
2. Confirm whether `status_item.state` reaches the daemon event path.
3. Decide the right bridge:
   - route `status_item.state` from the configured target canvas to
     `StatusItemManager.setPersistentVisible`;
   - or derive persistent visibility from a canonical canvas lifecycle field if
     one already exists and is more accurate.
4. Keep stale or out-of-target messages from mutating the status item; only the
   configured `toggleId` should update this status item's persistent state.

## Verification

Minimum deterministic checks:

```bash
git diff --check
./aos dev recommend --json
```

If Swift changed:

```bash
./aos dev build
```

Focused checks:

```bash
bash tests/sigil-status-item-lifecycle.sh
bash tests/status-item-tracked-lifecycle-timeout.sh
```

Live or isolated real-input check:

```bash
bash tests/sigil-real-input-status-avatar.sh
```

Also perform one direct regression measurement in repo mode if `./aos ready`
passes:

1. Launch Sigil through the configured status item.
2. Force hidden via the renderer path, for example
   `window.__sigilDebug.dispatch({ type: 'status_item.hide' })`.
3. Click the real AOS status item once.
4. Record time from click to `window.__sigilDebug.snapshot().avatarVisible === true`.

Acceptance target: first-click summon should be consistently under `2000ms` on
an already-warm persistent `avatar-main` canvas. If it is still slower, report
the exact stage that consumed time.

Cleanup any live diagnostic canvases before reporting.

## Completion Report

Include:

- files changed;
- confirmed root cause;
- before/after first-click status summon latency;
- whether `status_item.state` is now consumed or why another source of truth was
  chosen;
- deterministic tests run and pass/fail results;
- live AOS readiness result or blocker;
- any remaining status-item or Wiki Workbench follow-up recommendation.
