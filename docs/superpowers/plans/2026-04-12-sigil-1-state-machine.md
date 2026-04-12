# Plan — Sigil-1 avatar state machine

Spec: `docs/superpowers/specs/2026-04-12-sigil-1-state-machine.md`

Each task is a single reversible commit. Branch: main, no push. Screenshot verification via `aos see capture main --out /tmp/sigilN.png` between task groups.

## Tasks

### T1 — Bootstrap: live-js mode gate in renderer/index.html

Add `?mode=live-js` detection at the top of `init()`. When present:
- Skip the Swift IPC path
- Enable the new subscription + state-machine modules
- Keep Swift path working when flag absent (zero regression for avatar-sub)

Wire a `sigilBootMode` flag in `state`. Introduce a `setupLiveJs()` function called in place of `setupIPC()` when flag is set.

Commit: `feat(sigil): live-js boot mode gate in renderer`

Verification: load with and without `?mode=live-js` via `aos show create`; confirm Swift path unchanged, live-js path logs "live-js boot" and does not reject IPC messages.

### T2 — input_event subscription + position feed

In `setupLiveJs()`:
- Call `postToHost('subscribe', {events: ['input_event']})`
- On message, update `cursorTarget = {x, y, valid}`
- Add a `currentCursor` lerped toward `cursorTarget` at alpha 0.12 per rAF tick
- When state = IDLE, call `setScenePosition(screenToScene(currentCursor.x, currentCursor.y))`

Commit: `feat(sigil): live-js cursor subscription + lerp`

Verification: screenshot mid-motion; avatar should be on-screen near cursor in an IDLE screen capture.

### T3 — State machine core

Add `live-js` module section: `stateMachine = {state: 'IDLE', ...}` with transitions implemented as a `transition(event)` function. Events: `mouse_down`, `mouse_up`, `mouse_move`, `mouse_drag`, `key_down` (ESC only), plus synthetic `timer_fired` for future menu breathing.

Track:
- `mousedownPos` (for drag-origin zone)
- `pressTimer` (unused in Sigil-1; placeholder)
- `gotoActive` (for GOTO cue rendering)

Commit: `feat(sigil): state machine core (idle/press/drag/goto)`

Verification: log state transitions to console; manually trigger each transition; confirm logs match expected flow.

### T4 — Hit-area spawn + mode-based flipping

- On live-js boot, `canvas.create` `avatar-hit` as child, default `interactive=false`
- Every rAF tick: `canvas.update` `avatar-hit` with frame centered on avatar screen position
- On state enter `PRESS`/`DRAG`: `canvas.update` `{interactive: true}`
- On state enter `IDLE`/`GOTO`: `canvas.update` `{interactive: false}`

Reuse `draw.html`'s hit-area plumbing pattern. Include a `request_id` on the initial create to confirm spawn.

Commit: `feat(sigil): avatar-hit spawn + mode flip`

Verification: `aos show list --json` before + after; both canvases present. Click over a text field with avatar idle nearby → text field focuses (passthrough confirmed). Click directly on avatar → state transitions to PRESS (check console).

### T5 — Fast-travel port

Port `behaviorFastTravel` from Swift:
- `easeOutQuart(t) = 1 - Math.pow(1 - t, 4)`
- `duration = Math.max(0.12, Math.min(0.3, dist / 5000))` seconds
- Interpolate avatar screen position from start to target over duration; each frame, compute eased t and call `setScenePosition(screenToScene(...))`
- Emit `applyBehaviorPreset('fast_travel')` at kick-off and `applyBehaviorPreset('standby')` on landing (reuses existing ghost-trail machinery in renderer)

Commit: `feat(sigil): fast-travel port with omega ghosts`

Verification: trigger fast-travel from a manual console call → screenshot before/after → avatar relocated, ghosts visible.

### T6 — GOTO placeholder ring

Add a 2D canvas overlay (new `<canvas id="ui">` above Three.js canvas, also passthrough-styled). Render a dashed circle around current avatar screen position while `gotoActive`. Clears when state leaves GOTO.

Commit: `feat(sigil): goto-mode placeholder ring`

Verification: click avatar → screenshot shows dashed ring; ESC → screenshot shows ring gone.

### T7 — DRAG placeholder menu ring

Same UI overlay, different element: draw circle outline at 120px radius around `mousedownPos` when state = DRAG. On mouseup, log `[sigil-1] menu release angle=… radius=…` and return to IDLE (or fast-travel to release point if release is outside origin zone and not over the ring).

Commit: `feat(sigil): drag-mode placeholder menu ring`

Verification: manually drag from avatar → screenshot mid-drag shows ring; release → logs fire, fast-travel occurs, state resets.

### T8 — display_geometry subscription

Subscribe to `display_geometry`. Log the snapshot on arrival. Use for:
- Setting canvas size on launch if needed (aos should already have done this via `--at`, so this is mainly informational for Sigil-1; multi-display handoff is future work)
- Clamping fast-travel targets to visible bounds (out of visible_bounds → clamp to nearest edge)

Commit: `feat(sigil): display_geometry subscription + clamp`

Verification: log contents of the received snapshot; confirm at least 1 display entry with expected bounds.

### T9 — Handoff brief

Post to `handoff` channel with:
- What shipped commit-by-commit
- Screenshot evidence per acceptance criterion
- Known gaps (multi-display, breathing menu, slices)
- Verification checklist for morning QA
- Branch policy reminder (main, do NOT push)

No commit; channel post.

## Task dependencies

T1 → T2 → T3 → T4 → T5 → (T6 || T7) → T8 → T9

## Rollback

Each task is one commit. If morning QA says "revert this," `git revert <sha>` on the specific commit leaves preceding work intact. `avatar-sub.swift` path is untouched throughout, so full escape hatch is: remove `avatar-main` canvas and launch Swift avatar-sub instead.
