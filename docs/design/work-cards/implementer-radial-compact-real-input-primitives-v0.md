# Implementer Work Card: Radial and Compact Real-Input Primitives

## Recipient

Implementer

## Transfer Kind

Implementer round

## Single Goal

Replace one-off Sigil radial and compact-surface real-input choreography with reusable AOS-first scenario primitives, remove hardcoded radial drag geometry, and prove compact panel wheel scrolling stays scrolled instead of snapping back to the top.

## Branch / Base

- `branch_from`: `origin/implementer/post-refactor-real-input-dogfooding-corrections-v0`
- `required_start_ref`: `origin/implementer/post-refactor-real-input-dogfooding-corrections-v0`
- Work on a branch that preserves the post-refactor real-input dogfooding corrections. Do not restart from `origin/main`.

`origin/implementer/real-input-scenario-harness-consolidation-v0` is useful prior work, but it is an ancestor of `origin/implementer/post-refactor-real-input-dogfooding-corrections-v0`. Start from the post-refactor branch so the latest compact control-record fixes remain in scope.

## Source Context

The user reports two related failures in the live testing surface:

1. Agents were freelancing live UI tests instead of using AOS commands such as `./aos do` and `./aos see`.
2. The avatar compact panel cannot be practically scrolled with the user's mouse wheel because it flicks back to the top.

Foreman also found a hardcoded radial drag distance:

```text
tests/sigil-avatar-interactions.sh:214: window.__sigilDebug.dispatchDesktop({ type: 'left_mouse_dragged', x: p.x + 48, y: p.y })
```

That distance should come from the radial menu's resolved settings, not from a magic number.

Foreman live evidence on 2026-06-02:

- `./aos ready` passed: `ready=true mode=repo daemon=reachable tap=active`.
- `./aos see capture main --canvas avatar-main --perception --xray --out /tmp/aos-foreman-avatar-compact-snapback-v0/before.png`
- `./aos do scroll 1520,1380 --dy -80 --state-id see_c4d9267509d6`
- `./aos see capture main --canvas avatar-main --perception --xray --out /tmp/aos-foreman-avatar-compact-snapback-v0/after-scroll-delay.png`

The delayed screenshot still shows the compact panel at the top content after a real scroll event, consistent with the user's snap-back report. Earlier Foreman probing also showed small scroll deltas could momentarily move `scrollTop`, which means current tests that only assert one immediate `scrollTop` change can miss the user-visible bug.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md`
- `docs/design/work-cards/implementer-post-refactor-real-input-dogfooding-corrections-v0.md`
- `docs/design/work-cards/implementer-post-refactor-real-input-dogfooding-finish-v0.md`
- `docs/design/work-cards/implementer-post-refactor-real-input-dogfooding-review-correction-v0.md`
- `docs/design/work-cards/implementer-real-input-scenario-harness-consolidation-v0.md`
- `tests/sigil-avatar-interactions.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/sigil-context-menu-real-input.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/sigil_real_input_context.py`
- `tests/lib/sigil/radial-menu.sh`
- `packages/toolkit/runtime/radial-gesture.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/compact-surface-session.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/theme/avatar-control-surface.css`

## Rediscovery Commands

Run these before editing and include the relevant output in your completion report:

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/post-refactor-real-input-dogfooding-corrections-v0 origin/implementer/real-input-scenario-harness-consolidation-v0
git merge-base --is-ancestor origin/implementer/real-input-scenario-harness-consolidation-v0 origin/implementer/post-refactor-real-input-dogfooding-corrections-v0; echo "harness_ancestor_of_post=$?"
./aos ready
./aos show list --json
rg -n "p\\.x \\+ 48|left_mouse_dragged.*48|AOSNativeControls|RealPointer|radialGestureMenu|deadZoneRadius|handoffRadius|radiusBasis|do scroll|scrollTop|data-sigil-avatar-control-surface" tests apps/sigil packages/toolkit
```

If live readiness is blocked by TCC or input-tap permissions, stop the live portion and use the repo recovery path:

```bash
the manual TCC blocker report path
./aos ready --post-permission
```

Continue deterministic harness cleanup only if it is clearly separable from the blocked live proof.

## Required Behavior

### 1. No Hardcoded Radial Drag Geometry

- Remove the `p.x + 48` style radial drag distance from `tests/sigil-avatar-interactions.sh` and any equivalent hardcoded radial threshold you find.
- Derive radial drag points from the canonical runtime configuration:
  - use the resolved radial gesture menu config from `packages/toolkit/runtime/radial-gesture.js` and/or the live `window.__sigilDebug.snapshot().radialGestureMenu` fields;
  - if the expected state is `FAST_TRAVEL`, use the resolved handoff threshold plus a small named epsilon;
  - if the expected state is only radial entry, use the resolved dead-zone threshold plus a small named epsilon;
  - make the source field and computed distance explicit in helper output or assertion messages.
- Add a targeted assertion that changing radius basis / dead zone / handoff values changes the computed test path. The test should fail if a future caller silently reintroduces a fixed pixel constant.

### 2. Reusable AOS-First Input Primitives

Introduce or consolidate small helpers instead of growing one-off scenario scripts. Keep the boundary narrow and local to the current Sigil real-input needs.

Expected helper capabilities:

- resolve Sigil radial gesture geometry from the canonical config or live snapshot;
- compute radial drag points for a named phase or threshold;
- open the avatar compact menu through real input with `./aos do click --right`;
- scroll the compact surface through real input with `./aos do scroll`;
- scroll until a named control or selector is visible/reachable, with bounded attempts and progress checks;
- select compact tabs, select controls, and drag sliders using existing AOS-native control records where available;
- open/select radial menu items through AOS-backed real input.

Live action helpers must call `./aos do`. `./aos show eval` is allowed for bounded state probes, selector lookup, or isolated deterministic seams, but it must not replace the real action proof. Raw daemon HTTP calls, direct `tmux`, `curl`, state-file inspection, and direct PTY control are out of scope unless an `./aos` command is missing or broken; if you bypass AOS, state the reason in the completion report.

### 3. Compact Surface Scroll Must Persist

Fix or route the actual compact-panel snap-back bug. Do not settle for a test that only observes a momentary `scrollTop` increase.

Required acceptance:

- Open the compact avatar control surface from the avatar using real input.
- Use real wheel input through `./aos do scroll` over the compact panel.
- Verify the panel is still scrolled after a delay, not just immediately after the event. A reasonable proof is:
  - `before.scrollTop === 0`;
  - `afterImmediate.scrollTop > before.scrollTop`;
  - `afterDelay.scrollTop >= afterImmediate.scrollTop` or at least remains above a named threshold that proves the visible content did not reset to the top.
- Capture screenshot artifacts before and after the delayed check with `./aos see capture`.
- If the root cause is remounting, preserve scroll position across `compactSurfaceSession.mount()` / `contextMenu.applySnapshot()` or avoid unnecessary remounts for equivalent open snapshots.
- If the root cause is display-segment replay, make the fix segment-aware. Foreman observed that live `./aos show eval --id avatar-main` can sample the wrong union-display segment while the compact panel is visible on the other segment; the live proof must not hide that with a wrong-segment eval.
- Update `tests/sigil-context-menu-real-input.sh` or add a focused companion scenario so it catches the snap-back regression. The existing "scrollTop changed from real wheel" check is insufficient by itself.

### 4. AOS Dogfooding Evidence

The completion report must include AOS-first evidence:

- readiness result from `./aos ready`;
- at least one `./aos see capture` artifact path for the compact panel before/after delayed scroll;
- at least one `./aos do scroll` result;
- real-input scenario output showing the delayed scroll assertion;
- radial drag helper output showing the resolved config source and computed distance.

## Scope Boundaries

- Keep edits focused to Sigil tests, real-input helpers, context-menu scroll behavior, and radial gesture test geometry.
- Product changes are allowed only if required to fix the observed compact scroll snap-back.
- Do not weaken AOS readiness gates or make live tests silently pass when real input did not run.
- Do not remove or discard untracked work cards/reports in the working tree.
- Do not make Implementer self-accept broad product direction. If fixing the scroll bug reveals a larger design choice, report it back to Foreman with the smallest safe reproduction.

## Verification

Run all applicable deterministic checks:

```bash
git diff --check
bash -n tests/*.sh tests/lib/sigil/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/radial-gesture-menu.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
bash tests/sigil-context-menu-real-input.sh
```

Run live checks only when `./aos ready` passes and the repo-standard live-input opt-in is present:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/sigil-context-menu-real-input.sh
```

If you add a new focused compact-scroll live scenario, run it with `AOS_REAL_INPUT_OK=1` and include its command in the report.

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- whether `tests/sigil-avatar-interactions.sh` no longer contains the magic `+48` radial drag distance;
- the exact config fields used for radial drag threshold computation;
- helper names added or consolidated;
- compact scroll root cause and fix;
- before/immediate/delayed scroll evidence, including screenshot artifact paths;
- commands run and pass/fail results;
- any live readiness blocker and whether the manual TCC blocker report path was used;
- the next smallest follow-up if anything remains.
