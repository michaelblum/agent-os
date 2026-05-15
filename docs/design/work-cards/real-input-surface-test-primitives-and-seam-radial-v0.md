# Real-Input Surface Test Primitives And DesktopWorld Path Radial V0

## Tracker

- Issue: #305 Remodel Sigil as first-class consumer of AOS surface platform
- Parent evidence:
  - `docs/design/work-cards/sigil-radial-real-input-semantic-capture-correction-v0.md`
  - `docs/design/aos-surface-stack-v0-integration-ledger.md`
  - `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- Related primitives:
  - `packages/toolkit/runtime/spatial.js`
  - `packages/toolkit/runtime/desktop-world-surface.js`
  - `packages/toolkit/runtime/desktop-world-hit-region.js`
  - `tests/lib/real-input-surface-harness.sh`
  - `tests/lib/visual-harness.sh`
  - `tests/lib/sigil/radial-menu.sh`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make real-input surface tests use composable AOS-derived test primitives instead
of scenario-local display math, and extend the Sigil radial real-input scenario
with topology-neutral DesktopWorld path coverage.

The user explicitly pushed back on the prior GDI report phrase "on secondary
displays": secondary-display bugs are red flags, and tests should not route
around the DesktopWorld abstraction by reimplementing DPI/resolution conversion
inside each Python harness. Consumer scenarios should express intent in
DesktopWorld space. Native coordinates are allowed only at the final CGEvent
injection boundary, through a shared helper backed by AOS/toolkit primitives.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/work-cards/sigil-radial-real-input-semantic-capture-correction-v0.md`
- `packages/toolkit/runtime/spatial.js`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`

## Rediscover State

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files \
  tests/lib/real-input-surface-harness.sh \
  tests/lib/visual-harness.sh \
  tests/lib/sigil/radial-menu.sh \
  tests/scenarios/sigil/radial-menu/real-input.sh \
  packages/toolkit/runtime/spatial.js \
  apps/sigil/renderer/live-modules/main.js
gh issue view 305 --json number,title,state,url,body,labels
```

If `./aos ready` reports a TCC/input-tap blocker, do not run permission loops.
Report the exact diagnosis and still complete deterministic helper work.

## Existing Code To Inspect

These files contain repeated test logic that should be factored into reusable
helpers where practical:

- `tests/lib/sigil/radial-menu.sh` - currently owns real CGEvent movement,
  wait/retry helpers, display probing, DesktopWorld/native conversion, semantic
  capture, and Sigil radial assertions.
- `tests/sigil-context-menu-real-input.sh` - duplicates `wait_until`,
  `native_point_for`, display normalization, and real input helpers.
- `tests/sigil-hit-target-drag-fast-travel.sh` - duplicates `wait_until`,
  canvas lookup, world/native conversion, and extended-display checks.
- `tests/sigil-avatar-interactions.sh` - duplicates semantic target capture and
  world-point derivation.
- `tests/surface-inspector-cross-display-drag.sh` - has conditional
  extended-display setup and should share topology helpers where sensible.
- `tests/canvas-seam-straddle-placement.sh` - is a lower-level native/AppKit
  boundary test. It may keep native/window-server truth checks because its job
  is explicitly to verify the DesktopWorld/native seam, not consumer behavior.

## Test Primitive Rule

Use this rule when deciding what to extract:

- Test authoring follows the same primitives-first discipline as product code.
  Do not ad-hoc a scenario by copying launch plumbing, display math, input
  movement, or semantic-target parsing. Look for existing test primitives,
  molecules, and templates first, then create a new primitive only when a clear
  reusable pattern or boundary emerges.
- A test primitive wraps one AOS primitive or platform boundary: readiness,
  canvas lifecycle, Surface Inspector visibility, DesktopWorld topology, real
  pointer injection, semantic-target capture, or cleanup.
- A test molecule composes primitives into a fixture such as "visible Surface
  Inspector plus Sigil avatar" or "real-input surface scenario with diagnostics."
- A scenario template expresses one product behavior using those molecules and
  keeps only product-specific intent and assertions locally.
- Consumer tests express positions, paths, hit targets, and expected behavior in
  DesktopWorld space.
- Shared test helpers may use `aos graph displays --json` and toolkit spatial
  helpers to discover topology, visible DesktopWorld bounds, display seams, and
  conditional skip reasons.
- Shared test helpers may convert a DesktopWorld point to native only at the
  final real-input injection boundary, because CGEvent still needs native
  coordinates.
- Scenario-local tests should not hand-roll DPI, scale-factor, native display
  origin, or `desktop_world_bounds` conversion logic.
- Boundary tests whose purpose is native/window-server placement may compare
  native/AppKit coordinates directly, but they should be labeled as boundary
  tests and not copied into app scenarios.
- Do not create a new primitive just because a helper function is possible. A
  local assertion is fine when it is genuinely product-specific and does not own
  platform behavior.

## Required Test Primitives

Create reusable helpers under `tests/lib/` so later scenarios can import them.
Choose shell plus Python modules if that is the least disruptive shape. The
helpers should be composable and small:

- AOS command helpers: `run`, `run_json`, captured-error JSON wrapping, and
  `wait_until`.
- Canvas helpers: `show list`, `show get`, `show eval`, canvas lookup by id,
  externally observable frame/interactivity checks, and cleanup wait.
- Surface Inspector Level 1 helpers: require `AOS_REAL_INPUT_OK=1`, run
  `./aos ready`, launch or reuse visible `surface-inspector`, assert active UI,
  and include inspector state in failure diagnostics.
- Display topology helpers: normalize display payloads through the same
  semantics as `packages/toolkit/runtime/spatial.js`; find main/extended
  displays; compute visible DesktopWorld bounds; create geographically centered
  padded traversal paths; and produce precise skip reasons when the visible
  DesktopWorld cannot fit the padded path.
- Real pointer helpers: eased mouse move/down/drag/up path helpers. These should
  accept DesktopWorld points and convert to native at the injection boundary.
  Do not use the old short `aos do drag --speed 6` path for radial menu proof.
- Semantic target helpers: capture `--xray`, map target ids, and include canvas
  frame/interactivity/show-list/Surface-Inspector/app-trace diagnostics on
  capture failure.

Prefer importing toolkit spatial helpers directly from Node where possible.
If the live real-input harness stays Python-heavy, add a small checked
equivalent in `tests/lib/` and cover it with focused tests so it cannot drift
from toolkit semantics unnoticed.

## Sigil Radial DesktopWorld Path Coverage

Extend `tests/scenarios/sigil/radial-menu/real-input.sh` or add a sibling
scenario if that keeps the base path clearer.

The DesktopWorld path scenario must be dynamic:

- Compute the visible DesktopWorld union from AOS/toolkit display primitives.
- Inset the path by radial-menu-safe DesktopWorld padding so the final radial
  target surface can open without edge clipping.
- If the visible DesktopWorld is too small for the padded path, skip with a
  precise message and the exit code used by nearby test harnesses for
  environment skips.
- If the padded path fits, run the scenario regardless of whether the
  environment has one display, horizontal displays, stacked displays, or another
  arrangement.

Required path behavior:

- Keep Surface Inspector visible/active through the Level 1 harness.
- Place the avatar at the first point of a centered X/figure-eight path inside
  the padded visible DesktopWorld.
- Perform four real-input fast-travel gestures through that path and confirm
  each avatar travel step in DesktopWorld coordinates.
- Reopen the radial menu at the final padded path point.
- Move through the radial menu items with eased/held DesktopWorld paths.
- Confirm the radial child semantic target surface is externally observable:
  daemon canvas active, interactive, visible/intersecting active display area,
  target ids present, and `aos see capture --canvas ... --xray` returns semantic
  targets.
- Release on the deterministic final item and assert the expected action.
- Clean up all scenario-owned app/action surfaces while preserving a user-owned
  or pre-existing `surface-inspector`.

## Required Docs

Update docs only where they prevent future regression:

- `tests/README.md` or a new `docs/recipes/` entry should state the test
  primitive rule: app-level surface tests use DesktopWorld intent and shared
  helpers; only boundary placement tests inspect native/AppKit truth directly.
- `docs/design/aos-surface-stack-v0-integration-ledger.md` should keep #305
  open until this path slice passes or skips with a precise topology reason.
- `docs/design/aos-canon-surface-boundary-alignment-plan.md` should retain the
  same issue disposition.

## Hard Boundaries

- Do not weaken the DesktopWorld abstraction by copying more native/DPI math
  into Sigil scenario code.
- Do not change daemon display geometry semantics unless you find and prove a
  primitive bug.
- Do not retire `aos do drag` or rewrite the action primitive in this slice.
  If jitter/precision remains an action primitive problem, document or route a
  separate exact card after this harness work. The follow-up card is
  `docs/design/work-cards/aos-drag-action-control-surface-v0.md`.
- Do not remove parked legacy Sigil surfaces.
- Do not close #305 unless the canonical radial scenario and DesktopWorld path
  coverage are both accounted for.
- Do not stage, commit, push, or open PRs.

## Verification

Always run:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/input-message.test.mjs \
  tests/renderer/hit-target.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/renderer/sigil-input-regions.test.mjs \
  tests/toolkit/runtime-desktop-world-hit-region.test.mjs \
  tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
```

Add focused tests for any new pure helper modules.

If `./aos ready` is clean, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Also run the new DesktopWorld path scenario. If visible bounds are insufficient,
the path scenario must skip cleanly with a precise reason. If the padded path
fits, it must pass.

After live scenarios, report:

```bash
./aos show list --json
./aos status --json
```

Do these sequentially, not in parallel with `./aos ready`, to avoid creating a
false ownership-mismatch snapshot during daemon startup/recovery.

## Completion Report

Report:

- repeated logic found and factored;
- new helper files and their intended reuse boundary;
- how the helpers preserve DesktopWorld abstraction;
- what remains native-only and why it is a boundary test;
- canonical radial scenario result;
- DesktopWorld path scenario result, including pass or exact skip reason;
- post-run cleanup state;
- whether #305 can close or must stay open with a named remaining gap.
