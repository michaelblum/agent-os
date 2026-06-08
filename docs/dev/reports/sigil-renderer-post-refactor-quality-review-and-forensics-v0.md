# Sigil Renderer — Post-Refactor Quality Review & Forensics V0

## For

Foreman. Routing decisions are yours; this report supplies grounded findings,
severities, and cleaner directions. Recommendations are marked **Opinion** and
are not directives.

## Scope & Evidence Basis

Three connected pieces of work, all on `implementer/post-refactor-real-input-dogfooding-corrections-v0`
(date: 2026-06-01):

1. **Branch review** of the single correction commit `784cedc7` vs
   `origin/main` `77cdbdb1`.
2. **Forensic code-quality audit** (maintainability, not micro-perf) of seven
   files named for review.
3. **Observe-mode direction check** — whether the reticle/selection/annotation/
   snapshot/recording subsystems are being superseded, and what that implies
   for deletion.

**Verification gap (carried throughout):** findings are from static reading and
local greps. The live real-input smokes were **not** run — the audit report
`post-refactor-aos-dock-real-input-audit-v0.md` records the repo daemon as
`degraded` / `human_required` (`input_tap.status=unavailable`). Anything tagged
as needing a live run is called out per finding.

---

# Part 1 — Branch Review: `…dogfooding-corrections-v0`

Single commit `784cedc7`, test-only, 6 files, +75 / −265. No file crosses 1,000
lines (max `tests/sigil-hit-target-drag-fast-travel.sh` at 625). Stated goal
(corrections card): *"make the post-refactor real-input verification path honest
again."*

**Recommended disposition (Opinion): do not accept as-is; route two reversible
corrections on this branch before merge.** Two issues cut directly against the
card's "honest verification" objective.

## BR-1 — HIGH — The two new `wait_until` wrappers never retry (decorative flake-fix)

`tests/sigil-hit-target-drag-fast-travel.sh:308` (`menu_effect`) and `:530`
(`ext_menu_control`).

The inline `wait_until` in this file uses a `__pending` retry protocol
(`:72`): `if last is not None and not (isinstance(last, dict) and last.get("__pending")): return last`.
Pre-existing callers respect it — `landed` (`:215`), `post_travel_menu` (`:246`),
`wormhole_landed` (`:425`) wrap their probe as `lambda …: result if <ready> else None`,
so they poll until ready.

The two probes this diff **introduced** do not. Their predicate is
`lambda: show_eval_json("""… return JSON.stringify({ ok: …, … })""")` — it always
returns a dict, never `None`, never `__pending`. So `wait_until` returns on
iteration 1 regardless of `ok`. The `timeout=5.0` and the labels are dead
scaffolding.

- **Why it matters:** the old code called `show_eval_json(...)` once. This diff
  added the wrapper precisely because the refactored compact menu
  (`aos-form-field` / `aos-segmented`) mounts asynchronously after
  `right_mouse_down`. As written, if the control isn't mounted on the first
  probe, `pointFor(...)` returns null → `{ ok:false, error:'missing …' }` →
  returned immediately → hard fail. The intended flake-fix is a no-op, and a
  future maintainer will trust a settle guarantee that isn't there.
- **Latent trap:** the predicate body *performs the clicks* (`clickWorld(...)`,
  drags, `key_down`). If someone "fixes" the retry by returning `None`/`__pending`
  on the missing-element branches, the whole click sequence re-dispatches every
  50 ms — state thrash / double-toggles.
- **Cleaner direction:** split the seam — perform the click sequence once; wrap
  only a read-only readiness/result probe in `wait_until`, returning
  `{"__pending": True}` (or `None`) until the compact control reports settled.
  This matches the `__pending` convention the file already supports.
- **Live-run note:** BR-1's fix should be confirmed by an actual run where the
  compact menu mounts async — that's the scenario the wrapper was meant to cover.

## BR-2 — MEDIUM — Deletes the only test of a live production failure mode (daemon-echo suppression)

`tests/sigil-avatar-interactions.sh` drops the `label_toggle` block (≈ −90 lines),
which asserted `ignoredEchoes >= 2` — that the hit-canvas ignores daemon echo
events (`stage === 'hit-canvas:ignored'`, `reason === 'daemon-echo'`).

That production logic is **still live**: `apps/sigil/renderer/live-modules/main.js:3958`
records `reason: 'daemon-echo'` suppression (one of six `hit-canvas:ignored`
reasons at `:3936–3974`). A grep across `tests/` for `daemon-echo` /
`ignoredEchoes` / `hit-canvas:ignored` now returns **zero** references — no
replacement anywhere, including renderer unit tests.

- **Not a problem (for clarity):** the GOTO and RADIAL assertion deletions in the
  same file are legitimate — the audit report documents the renderer contract
  change (short avatar click now opens RADIAL, not GOTO), and that coverage is
  owned by `tests/renderer/sigil-input-regions.test.mjs`, the radial-menu
  scenarios, and the `radial-*` renderer suites. Consolidating duplicated
  state-machine coverage out of this smoke is a genuine improvement.
- **Cleaner direction:** restore a focused assertion of `daemon-echo` suppression
  at a durable seam (a renderer/toolkit unit test over the `hit-canvas:ignored`
  decision, or a probe using a selector that survives the compact-menu refactor),
  **or** cite an existing test that covers `main.js:3958` (none found).

## What's good (branch)

Net −190 lines; real duplication removed, not relocated. Real-input gating routes
through the canonical `aos_real_input_surface_require_enabled` seam. Selector
migration to descriptor-based compact controls is the correct adaptation. The
`radialPhase is None` assertion fix (`:194`) correctly tracks the documented
contract change.

---

# Part 2 — Forensic Audit (7 files)

Maintainability focus. Files: `apps/sigil/renderer/live-modules/main.js`,
`apps/sigil/renderer/index.html`,
`packages/toolkit/workbench/visual-object-resource-lifecycle.js`,
`tests/renderer/stellation-no-rebuild.test.mjs`,
`tests/toolkit/visual-object-resource-lifecycle.test.mjs`,
`tests/lib/sigil/visual-harness.sh`, `scripts/aos-experience.mjs`.

Structural debt is concentrated in `main.js` (4,982 lines, 213 top-level
functions) and in a contract asymmetry that radiates across three files. Each
finding tagged **quick / medium / architectural**.

## FA-1 — `main.js` is a half-finished extraction, not just a big file — **architectural**

`apps/sigil/renderer/live-modules/main.js` (whole file).

The decomposition pattern is **already established and only half-applied**.
`createSigilAnnotationReticleController(...)` exists at `:1543` and owns reticle
state; sibling modules already exist under `live-modules/`
(`annotation-reticle.js`, `selection-mode-runtime.js`,
`context-recording-runtime.js`, `ux-tree*.js`). Yet the entrypoint still hosts
the subsystem glue around them:

- **37** `annotationReticle*` functions (`:1698–:2650`), incl. a **13-function**
  `…FromValue / …FromWindow / …FromAxPayload / …FromBrowserContext` normalizer
  family (`:1837–:1980`);
- **21** `selectionMode*` functions (`:2710–:2939`);
- ~20 agent-terminal / utility-canvas functions (`:903–:1344`);
- 18 radial-gesture / target-surface functions.

- **Why it matters:** a 4,982-line / 213-function entrypoint is the single
  biggest navigation hazard here for humans and agents; any edit forces holding
  unrelated subsystems in working memory, and grep-to-edit is unsafe.
- **Cleaner direction:** finish the extraction the controller started — move the
  reticle projection / native-window / AX / browser-DOM glue into an adapter
  module beside `annotation-reticle.js`; lift `selectionMode*` and
  `agentTerminal/utility*` likewise.
- **Why architectural, not mechanical:** these functions are coupled through
  module-level mutable singletons (`liveJs`, `state`, scattered top-level `let`
  flags). The extraction must first define what state each module owns vs.
  borrows — that boundary work is the task.
- **Connects to Part 3** (observe mode): see OBS below.

## FA-2 — `proof_window` and `profiler_measurement` disagree on casing in the same builder — **quick→medium**

`packages/toolkit/workbench/visual-object-resource-lifecycle.js:191-199`.

`profiler_measurement` is strict snake_case — `tests/toolkit/visual-object-resource-lifecycle.test.mjs:219`
("uses canonical snake_case input only") asserts camelCase input is *ignored*
and coerced to `0`/`null`. But the sibling `proof_window` block dual-reads both
spellings (`duration_ms ?? durationMs`, etc.), and every caller actually feeds it
camelCase (`…lifecycle.test.mjs:43,115`; `main.js:3127,3174`).

- **Why it matters:** two nested objects in one factory enforce opposite
  contracts; a caller can't infer the rule from the signature, and the test
  suite now locks both behaviors in.
- **Cleaner direction:** pick snake_case (matches the profiler decision and the
  emitted shape), delete the three `?? camelCase` fallbacks, snap the three
  callers. Couples to FA-4.

## FA-3 — A 5-level-deep agent-terminal parking block is inlined in the message dispatcher — **medium**

`apps/sigil/renderer/live-modules/main.js:4189-4240` (within `handleHostMessage`,
`:4156–:4410`).

The `canvas_lifecycle` branch carries ≈50 lines of nested agent-terminal parking
state transitions (prewarming × suspended × pendingCollapse × parked-at-status),
5 `if/else` levels deep, inside a 254-line `if (msg.type === …) { … return; }`
ladder.

- **Why it matters:** a self-contained state machine buried in the router makes
  both the router and the parking rules hard to read and impossible to test in
  isolation. This is the inarguable extraction.
- **Cleaner direction:** extract `handleAgentTerminalCanvasLifecycle(...)`.
- **Secondary (lower priority, Opinion):** the 20-branch type ladder *could*
  become a dispatch table, but several branches do bespoke extraction
  (`canvas_message` sub-type discrimination at `:4381–:4401`; pointer transform
  at `:4403`) — a naive map would fragment cohesion. Treat as optional, not a
  blocker.

## FA-4 — The stellation smoke is a valid live seam in the wrong place, with a duplicated contract — **medium**

`apps/sigil/renderer/live-modules/main.js:2999-3180`, exposed at `:4796` as
`__sigilDebug.stellationResourceSmoke`.

≈180 lines (`captureStellationProfilerObservation` + `reduceProfilerSamples` +
`runPrimaryStellationResourceSmoke`) of profiling/evidence construction in the
entrypoint. **This is not leaked test logic** — it reads `performance.memory` and
live Three.js meshes that only exist in the running renderer; it is the
legitimate live counterpart to the deterministic
`stellation-no-rebuild.test.mjs`, and the review skill values that bounded
feedback loop. The problems are *location* and *duplication*:

- the descriptor `{ id: 'sigil-avatar-stellation', state_path: …, route: …,
  renderer_sync: ['updatePrimaryStellation'] }` and the long
  `poolingBoundary.rationale` string are duplicated **verbatim** between
  `main.js:3148-3171` and `stellation-no-rebuild.test.mjs:176-202`;
- the `proofWindow` object is built twice within the function (`:3125-3130` and
  `:3172-3177`), camelCase (feeds FA-2).

- **Cleaner direction:** move the profiler trio into a focused
  debug/profiler module the renderer exposes; export one shared
  `STELLATION_LIFECYCLE_DESCRIPTOR` constant for both smoke and test; build
  `proof_window` once.

## FA-5 — Test-file assertion WET, when the file already contains the fix — **medium**

`tests/renderer/stellation-no-rebuild.test.mjs`.

Six tests repeat the same 8–12 line mesh/geometry/material identity-assertion
block (`:89-96`, `:147-158`, `:283-291`, `:373-381`, …). Test 9 (`:418-461`)
already demonstrates the clean form — a `meshes` / `geometries` / `materials`
map driven by one loop — but its neighbors didn't adopt it. Separately,
`configurePrimaryShape` (`:17-37`) hardcodes the full 20-field
`__sigilGeometryStats` literal, duplicating production's stat-shape knowledge
(drifts when a counter is added/renamed).

- **Cleaner direction:** promote the test-9 loop into a shared
  `assertResourcesStable(state, { meshes, geometries, materials })`; have the
  stats object expose its initial shape from one factory. (Minor, fold in:
  `hasFinitePositions` here duplicates `geometryHasFinitePositions` at
  `main.js:2990` — share one.)

## FA-6 — `visual-harness.sh` launch/show orchestration is copy-paste-divergent — **medium**

`tests/lib/sigil/visual-harness.sh:368-419` and `:188-251`.

Three `aos_visual_launch_sigil_with_inspector*` variants share an identical
skeleton and differ only in the show-avatar step. Two show helpers
(`…_via_real_status_click` `:188`, `…_via_live_status_click` `:239`) share an
identical `click + wait_ready + wait visible/interactive` tail and differ only in
pid acquisition. The embedded Python repeats loose display-bounds reads
(`desktopWorldBounds || desktop_world_bounds || bounds`, etc.) at `:301-302`,
`:324-329`, `:359`.

- **Why it matters:** three launch entrypoints that must stay behaviorally in
  sync are a drift risk for the live verification path; the triple-spelling
  bounds reads re-implement the display-shape contract per consumer.
- **Cleaner direction:** one launch fn parameterized by a show-strategy; one
  shared click+wait tail with pid passed in; a single `display_bounds(...)`
  accessor. The bounds fan-out is the same loose-contract disease as FA-2.

## FA-7 — `aos-experience.mjs` legacy-state compatibility layer has no removal gate — **quick**

`scripts/aos-experience.mjs:183-226`.

`legacyStatePath()` + dual-path read in `readActiveExperience` (`:203-213`) +
best-effort legacy `rmSync` in `writeActiveExperience` (`:215-226`) implement a
one-time unscoped→mode-scoped state migration with no documented removal trigger.
Also: `stateDir()` / `legacyStatePath()` duplicate `AOS_STATE_ROOT` resolution
(`:168-172` vs `:184-187`), and the `&& !value.startsWith('$')` env-guard repeats
4× (`:16`, `:19`, `:169`, `:184`).

- **Cleaner direction:** add a removal gate (dated comment or version check);
  extract one `envOr(name, fallback)` to collapse the four guard sites.

## Minor (compressed)

- `tests/lib/sigil/visual-harness.sh:276` — `rect_overlaps_point` is a pure
  pass-through to `rect_contains`; delete. **quick**
- `visual-object-resource-lifecycle.js:22-68` — four near-identical coercion
  helpers; optional consolidation. **quick**
- `scripts/aos-experience.mjs:24` — `prettyJSON`'s `"key":` → `"key" :` regex is
  almost certainly matching the Swift `aos` binary's JSON formatting for
  cross-surface consistency. **Opinion: leave as-is** unless that contract is
  gone — flagging only so a future reader doesn't "tidy" it blindly.

## Clean / no action

- `apps/sigil/renderer/index.html` (33 lines) — single boot path, dual error
  capture; nothing to do.
- `visual-object-resource-lifecycle.js` validator (`:205-281`) is well-bounded,
  and the snake-only profiler contract is *explicitly tested* — that half is the
  model the rest should follow (see FA-2).

---

# Part 3 — Observe-Mode Direction & Deletion Question

Question raised: are reticle / selection / annotation / snapshot / recording
being superseded by an encompassing "observe" mode, and can dead code be deleted?

## OBS-1 — The direction is real and documented, as a *vision*

Canonical source: `docs/dev/reports/aos-visual-object-architecture.md:699,707`:

> **Observe mode vision** (to be documented separately): Semantic capture system
> unifying selection mode, ancestry ladder, annotations, and snapshots.

> **"Observe mode"**: New term coined for the unified semantic capture system.
> Separate documentation needed to map this to existing concepts… Avatar refactor
> supports observe mode but is architecturally independent.

The substance matches the premise; the name is explicitly unsettled ("new term
coined," "to be documented separately").

## OBS-2 — It does not exist as code yet

- Clean grep of `apps/sigil/renderer` (excl. vendor) for `observeMode` / observe
  state / mode value: **nothing**. No unifying mode object, state, or toggle.
- Recent merges build the **substrate**, not the mode:
  - `2716f5e4` — selection-mode + visual-object cursor ladder + descriptor
    architecture (Phase 6);
  - `89f50dd7` / `16e4c157` — visual-object observe **snapshot boundary** proof;
  - `84c37530` — context selection mode + recording follow-through (added
    `selection-mode-runtime.js`, `context-recording-runtime.js`, `ux-tree*.js`).
- The reticle/selection/annotation/recording subsystems are **all currently live
  and wired** (`handleHostMessage` → `annotationReticleHandle*`; controller at
  `main.js:1543`; runtime modules active). They are the current implementation,
  not legacy.

## OBS-3 — Deletion assessment

- **Opinion: do not delete the reticle/selection/annotation/recording subsystems
  now.** Observe mode is a sketch; these are the load-bearing implementation.
  Removing the working implementation before its replacement exists is the move
  to avoid. The repo already stages convergence trackers for this transition
  (`surface-annotation-intent-convergence-tracker.md`,
  `context-annotation-session-keyframe-convergence-map-v0.md`). Implied safe
  sequence: build observe mode → migrate → retire superseded paths through those
  trackers.
- **Safe to act on now (relocation, not deletion):** FA-1 — finishing the
  extraction out of `main.js` removes no behavior, shrinks the entrypoint, and
  turns the eventual observe-mode swap into a module replacement instead of
  entrypoint surgery. **Opinion: this is the highest-value pre-observe-mode move.**
- **Possibly genuinely dead now (unverified):** demotion work exists
  (`display-first-annotation-surface-inspector-support-demotion-v0.md`) that may
  have left unreferenced compatibility paths. Distinct from the live subsystems;
  identifying them safely needs a focused dead-code pass (not done here).

---

# Severity Roll-Up

| ID | Area | Severity / Tag | Lever |
|----|------|----------------|-------|
| BR-1 | branch test seam | HIGH | wait_until never retries; needs live-run confirm |
| BR-2 | branch coverage | MEDIUM | daemon-echo suppression untested but live |
| FA-1 | main.js decomposition | architectural | finish half-done extraction |
| FA-2 | lifecycle contract | quick→medium | casing asymmetry, also unblocks FA-4 |
| FA-3 | dispatcher | medium | extract inline parking state machine |
| FA-4 | embedded smoke | medium | relocate + dedupe descriptor |
| FA-5 | stellation test WET | medium | adopt the loop the file already has |
| FA-6 | visual-harness WET | medium | one parameterized launch + bounds accessor |
| FA-7 | experience migration | quick | add removal gate; `envOr` helper |
| OBS | observe-mode | direction | build-then-retire; don't pre-delete live code |

## Bottom Line (Opinion)

The branch (`BR-1`/`BR-2`) should not merge until the verification path is honest
again — that's the card's own goal. The structural debt is concentrated, not
diffuse: **FA-1** (finish the entrypoint decomposition the reticle controller
already started) is the anchor and is also the cheapest enabler for the
observe-mode transition; **FA-2** is a small fix with outsized clarity payoff.
The two test files are thorough on behavior — their weakness is WET expression
(FA-5) and a contract the production side bends (FA-2/FA-4), not missing coverage.
On observe mode: the direction is confirmed but unbuilt; retire the reticle
*after* the replacement lands, not before.
