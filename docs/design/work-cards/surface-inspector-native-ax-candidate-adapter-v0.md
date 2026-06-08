# Surface Inspector Native AX Candidate Adapter V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Builds on accepted root/candidate slice:
  `docs/design/work-cards/surface-inspector-annotation-root-candidate-adapter-v0.md`
- Builds on accepted AOS semantic reveal slice:
  `docs/design/work-cards/surface-inspector-aos-semantic-target-reveal-v0.md`
- Related design note:
  `docs/design/surface-zoom-ax-element-adapter-slot.md`
- Pi lesson reference:
  `docs/design/pi-computer-use-lessons-for-aos-see-do.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make Surface Inspector Annotation Mode consume native macOS window and AX
element data as conservative annotation candidates.

The user-facing behavior should move closer to the original "chrome element
inspector" goal:

- no selected root: hovering native app windows can show/select a native window
  root candidate;
- selected native window root: hovering inside that window can show one bounded
  AX element candidate under the cursor;
- AX child candidates expose role/label/value/bounds/action names/capabilities;
- unsupported reveal remains explicit instead of pretending AX descendants can
  always be scrolled or focused.

This slice should use only explicit cursor/window/element data already emitted
by AOS perception. Do not add broad AX tree harvesting.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/surface-inspector-annotation-root-candidate-adapter-v0.md`
- `docs/design/work-cards/surface-inspector-aos-semantic-target-reveal-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-reveal-and-projection-adapters-v0.md`
- `docs/design/surface-zoom-ax-element-adapter-slot.md`
- `docs/api/aos.md`
- `shared/schemas/daemon-event.md`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
gh issue view 297 --json number,title,state,url,body,labels,comments
./aos ready
./aos status
./aos dev recommend --json
```

This slice depends on live perception events. If `./aos ready` reports the input
tap inactive, run one safe `./aos ready --repair`. If repair still requires
human permission work, report the blocker and rely on deterministic tests.

## Existing Code To Inspect

- `src/perceive/events.swift` - current `window_entered` and
  `element_focused` payloads.
- `src/perceive/daemon.swift` - emits `window_entered`, `app_entered`, and
  `element_focused` while the cursor moves.
- `src/perceive/cursor.swift` and `src/perceive/models.swift` - one-shot cursor
  response with native window and AX element fields.
- `packages/toolkit/components/surface-inspector/index.js` - owns Surface
  Inspector input subscriptions, annotation hit regions, hover candidates, and
  root/scope behavior.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - owns shared
  annotation candidate normalization, ranking, adapter priority, and default
  projection capabilities.
- `tests/toolkit/surface-inspector.test.mjs` and
  `tests/toolkit/surface-inspector-annotations.test.mjs` - focused deterministic
  tests for candidate selection, root filtering, and SI model behavior.
- `tests/toolkit/surface-inspector-ax.test.mjs` - accessibility semantics tests
  for the Surface Inspector component.

## Required Behavior

### 1. Native Window Root Candidate

When Annotation Mode is active and no root is selected:

- Surface Inspector may use the latest explicit `window_entered` event or
  equivalent cursor/window payload to create a native window root candidate;
- the candidate uses `adapter_id: "macos-ax"` and a subject kind such as
  `native_window`;
- candidate metadata includes window id, app name, pid, bundle id when present,
  title when present, and current bounds;
- the candidate is projectable only when current display-space bounds are known;
- clicking/pinning the candidate selects that native window root and scopes
  later hover behavior to that root.

Do not synthesize a native window candidate from screenshots or stale topology.

### 2. AX Element Candidate Under Selected Native Root

When a native window root is selected:

- Surface Inspector may use the latest explicit `element_focused` event or
  `aos see cursor`-equivalent AX element payload as a hover candidate;
- the AX element must be accepted only when the current cursor/window context
  still belongs to the selected native root, using available pid/window/app
  evidence;
- candidate metadata includes role, title, label, value, enabled, bounds,
  context path, action names, and normalized capabilities;
- candidates with no current bounds are tree-only/unsupported, not display
  overlays;
- `can_reveal=false` unless a bounded native reveal action already exists and
  is proven in this slice.

### 3. Candidate Ranking And Blockers

Native AX candidates must flow through the shared candidate contract from the
root/candidate slice:

- projectable bounded AX elements can show a hover perimeter;
- action-capable AX elements should rank above passive containers when bounds
  overlap;
- stale or root-mismatched AX events should set a blocker such as
  `native_ax_root_mismatch` or `native_ax_stale_cursor_context`;
- unsupported reveal should use the existing explicit blocker pattern, for
  example `bounded_ax_reveal_unavailable`.

### 4. Privacy And Safety Boundary

Allowed:

- current visible window under the cursor;
- current AX element under the cursor;
- one-shot `aos see cursor` payloads;
- event-stream payloads emitted while Annotation Mode is explicitly active.

Not allowed:

- broad AX tree traversal of arbitrary apps;
- hidden background scraping;
- browser page DOM inspection through AX;
- pretending AX element refs are stable persistent ids;
- raw click/focus side effects during hover.

### 5. Browser Boundary

Browser-class windows can use the native window root behavior and native browser
chrome AX candidates when bounded by the current cursor. Browser page DOM/CDP
remains deferred and must keep reporting `browser_dom_cdp_deferred`.

## Scope

Primary ownership boundary:

- toolkit Surface Inspector event consumption and candidate modeling;
- shared annotation candidate tests;
- docs/API updates only if event payload or public candidate contract changes.

Avoid Swift changes unless the current event payload is missing a small field
that cannot be recovered in toolkit. If Swift changes are needed, use
`./aos dev recommend --json` before building and keep the native primitive
generic.

## Hard Boundaries / Non-Goals

- No broad AX harvesting.
- No AX tree browser.
- No native AX reveal implementation unless a bounded existing primitive is
  already available and tests make it safe.
- No Chrome DOM/CDP.
- No live website inspection.
- No screenshot-pixel oracle.
- No snapshot/settings work from #298.
- No agent-rich-leaf work from #299.
- No Employer Brand workflow changes.

## Suggested Implementation Areas

Implementer should inspect first and then choose the smallest correct patch.

Likely implementation:

1. Add a toolkit helper that normalizes native window event payloads into
   annotation candidates.
2. Add a toolkit helper that normalizes AX element payloads into annotation
   candidates under a selected native root.
3. Extend Surface Inspector input/event subscription while Annotation Mode is
   active to include the native perception events needed for the helpers, if
   the host supports subscribing to those event names.
4. Add deterministic tests for:
   - native window root candidate shape;
   - selected native root accepting a matching AX element candidate;
   - root mismatch rejecting/staling an AX element candidate;
   - `browser_dom_cdp_deferred` remaining intact.
5. Add a bounded live smoke only after deterministic tests pass.

## Verification

Run deterministic tests:

```bash
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector-ax.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
git diff --check
```

If Swift changes are made, also run the router-selected build/checks. Likely:

```bash
./aos dev recommend --json
./aos dev build
bash tests/see-do-state-metadata.sh
```

If `./aos ready` passes, run one bounded live smoke:

1. Launch Surface Inspector.
2. Enable Annotation Mode.
3. Hover a normal native app window and verify the native window root candidate
   is highlighted, not DesktopWorld or an AOS stage layer.
4. Pin/select the native window root.
5. Hover an interactive AX element inside that window.
6. Verify exactly one scoped AX element candidate appears with action names and
   normalized capabilities when available.
7. Verify the candidate does not claim reveal support unless explicitly proven.
8. Clear annotation mode and clean up any smoke canvases.

If live readiness is blocked, report the concrete blocker and do not loop.

## Completion Report

Report back with:

- changed files;
- native window candidate behavior implemented;
- AX element candidate behavior implemented;
- explicit safety/privacy boundary preserved;
- deterministic tests and live smoke result;
- `./aos ready` result or blocker;
- recommended next slice within #297 or whether to move to #298 snapshots.
