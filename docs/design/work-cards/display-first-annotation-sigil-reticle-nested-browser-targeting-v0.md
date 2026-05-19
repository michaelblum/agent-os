# Display-First Annotation Sigil Reticle Nested Browser Targeting V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Adapter tracker: https://github.com/michaelblum/agent-os/issues/297
- Current direction:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Builds on:
  - `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
  - `docs/design/work-cards/surface-inspector-native-ax-candidate-adapter-v0.md`
  - `docs/design/work-cards/surface-inspector-controlled-browser-dom-projection-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, Sigil state, Chrome/Chromium state, or prior
implementation state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## User Report

Michael needs to use the Sigil reticle repeatedly:

1. first select a window as an annotation anchor;
2. invoke the reticle again;
3. target sub-elements deeper inside that already anchored parent window;
4. attach comments or commentless frame anchors to those deeper targets.

The observed failure is that after the reticle parks outside the parent window,
moving the cursor back inside can still select elements outside the parent
window. The reticle is not respecting the parent anchor as the active target
scope for the next selection.

Michael also needs first-class targeting of elements on Chrome and Chromium
web pages, including Chromium-family apps such as Comet. Native browser chrome
or coarse AX window targets are not enough.

## Diagnosis To Confirm

The current Sigil reticle bridge already targets shared annotation candidates,
but it is mostly flat:

- `createSigilAnnotationReticleController().enter()` creates a new session with
  the display root every time instead of seeding from the most recent live
  parent/window anchor.
- `resolveSigilAnnotationReticleTarget()` chooses the best projectable candidate
  under the pointer from the full cached candidate list, not from direct
  descendants of the current scope.
- Native AX candidate building in Sigil uses the latest native window event as
  the selected root rather than the committed parent anchor. That makes root
  mismatch and stale cursor context easy to miss when the reticle starts outside
  the target window.
- Controlled browser DOM element targets exist for local fixtures, and browser
  content seam blockers exist, but arbitrary Chrome/Chromium page DOM/CDP is
  still deferred. That deferral is now a product blocker for annotation
  targeting.

Confirm or correct this diagnosis in code before implementing.

## Goal

Make the Sigil reticle support progressive scoped targeting across repeated
uses, and introduce the smallest safe Chrome/Chromium page-targeting adapter
needed for display-first annotation anchors.

After selecting a parent window, canvas, or browser page root, a later reticle
run should treat that parent as the active scope. Hover/release should prefer
direct child candidates inside that scope and must not select sibling windows,
outside canvases, annotation overlays, or stale elements outside the parent
scope.

For Chrome/Chromium web pages, the adapter may be CDP/Playwright-backed, but it
must be explicit, bounded, and user-visible. It should expose DOM element target
records through the existing annotation candidate/projection vocabulary.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- `docs/design/work-cards/surface-inspector-controlled-browser-dom-projection-v0.md`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `packages/toolkit/workbench/controlled-browser-dom-surface.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `src/browser/window-resolver.swift`
- `src/browser/browser-adapter.swift`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/toolkit/browser-dom-element-picker.test.mjs`
- `tests/toolkit/annotation-projection.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev gh issue view 295 --json
./aos dev gh issue view 297 --json
./aos dev recommend --json
rg -n "annotationReticle|committed_scope_stack|preview_scope_stack|chooseAnnotationCandidate|buildNativeAxElementAnnotationCandidate|browser-content-seam|browser_dom_cdp_deferred|BROWSER_DOM_ELEMENT_PICKER|Chromium|Comet|Chrome" apps packages src tests docs
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic tests only unless Foreman or Michael routes
runtime repair.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/annotation-reticle.js` owns the reticle
  session, preview, release commit, anchor creation, and travel placement.
- `apps/sigil/renderer/live-modules/main.js` owns candidate evidence caching,
  candidate projection into DesktopWorld coordinates, native window/AX event
  ingestion, semantic target ingestion, and reticle event recording.
- `packages/toolkit/workbench/annotation-session.js` owns committed and preview
  scope stack semantics. Prefer extending this neutral session model over a
  private Sigil-only stack.
- `packages/toolkit/workbench/annotation-candidates.js` owns candidate
  normalization and ranking. Scope filtering should be a neutral helper when it
  applies to Surface Inspector and Sigil.
- `packages/toolkit/components/surface-inspector/index.js` already implements
  scoped canvas, semantic target, native window, and native AX candidate
  behavior. Extract or mirror neutral logic only; do not make Sigil depend on
  Surface Inspector UI internals.
- `packages/toolkit/workbench/browser-dom-element-picker.js` owns DOM target
  records, ancestor chains, selector candidates, and projection compatibility
  for controlled browser DOM.
- `packages/toolkit/workbench/annotation-projection.js` owns
  `browser-content-seam` and `browser_dom_cdp_deferred` capability evidence.
- `src/browser/window-resolver.swift` recognizes a Chromium-family window
  allowlist but currently may not include Comet. Do not guess the owner name
  without evidence; add a measured allowlist entry or a small configurable path
  if needed.

## Required Behavior

### 1. Repeated Reticle Uses Reuse The Active Parent Scope

When the previous reticle commit created a live window/canvas/browser root
anchor, a later reticle entry should seed `committed_scope_stack` from the live
anchor path instead of starting only at the display root.

The active scope can come from the latest committed reticle session or another
shared annotation session source, but it must remain adapter-neutral. The
selected parent should be visible in debug state and commit events so Foreman
and Operator can verify what scope was active.

If the previous parent is stale, absent, or blocked, do not silently use it.
Fall back to the display root and record a blocker such as
`previous_scope_not_live`.

### 2. Candidate Selection Is Scoped To Direct Children

During preview/release, build the candidate set from the active scope:

- AOS canvas/window roots: direct child canvases and semantic targets owned by
  the scoped canvas/root.
- AOS semantic targets: direct semantic children when parent/path evidence is
  available; otherwise do not infer descendants from screen overlap alone.
- Native macOS windows: scoped AX element candidates are allowed only when the
  current native window evidence matches the selected native window root.
- Browser page roots: DOM element candidates are allowed only from the scoped
  browser page/session/frame.

When a candidate lacks ancestry but has a display rect, screen overlap alone is
allowed only as fallback evidence inside the active scope and must record a
blocker/limitation. It must not outrank a properly scoped direct child.

### 3. Outside Elements Stay Outside

If the reticle/avatar is parked outside a parent window, moving the cursor back
inside that window must not let sibling windows, overlay canvases, or stale
global candidates win selection. A candidate whose current projection is not
contained by or clipped to the active parent scope should be rejected or marked
blocked with a reason such as `candidate_outside_active_scope`.

Annotation-mode internal canvases, Sigil reticle/radial surfaces, Surface
Inspector action controls, hit layers, and overlay-only canvases must not become
authoring targets unless explicitly selected as diagnostics.

### 4. Scoped Commit Creates Deeper Anchors And Comments

Release should commit the scoped preview path:

- parent frame anchor remains live;
- child frame anchor is created or updated under that parent;
- `scope_path` records the full parent-to-child address chain;
- comment text remains optional and can be attached to the deepest active
  anchor without requiring Surface Inspector as the primary authoring UI;
- camera snapshot payloads preserve the nested path and adapter evidence.

Travel placement should use the selected child projection rect when available;
otherwise use the parent scope rect with an explicit blocker.

### 5. Chrome/Chromium Page DOM Targeting

Add the next narrow browser adapter boundary for user-visible Chrome/Chromium
web pages. This should not be limited to Google Chrome; it must account for
Chromium-family browsers including Comet when they expose a safe, local
debugging or browser-control path.

Minimum accepted behavior:

- identify a local browser window/session/tab/content seam without relying on
  screenshot pixels;
- attach to an explicitly controlled or user-approved local page through
  CDP/Playwright or an existing browser session registry path;
- reuse `browser-dom-element-picker.js` to produce `element_target` records for
  the element/ancestor under a viewport point;
- include frame chain, shadow chain where available, selector candidates,
  preferred selector, XPath if available, tag/role/label/text excerpt,
  viewport/page bounds, source URL, and provenance;
- project viewport bounds into display/DesktopWorld coordinates using a proven
  content rect/inset; if the content inset is unresolved, report
  `browser_content_inset_unresolved` and do not draw a false overlay;
- keep `browser_dom_cdp_deferred` only for browsers/pages that are not
  attached/approved or lack the needed primitives.

This is an annotation-targeting adapter, not a capture/export workflow.

### 6. Safety And Privacy Boundary

Allowed:

- user-visible active browser page targeting while Annotation Mode is active;
- explicit local CDP/Playwright attachment to a browser/session the user is
  working with;
- bounded DOM element hit testing at the current pointer or requested point;
- selector/locator candidate generation for annotation anchors.

Not allowed:

- background crawling or scraping;
- login/paywall/CAPTCHA/consent bypass;
- broad page capture, element clipping, report/export generation, or Employer
  Brand artifact mutation;
- a Chrome extension/sidebar revival;
- fresh full-page DOM/CDP discovery on every mousemove.

The mousemove hot path should use cached direct-child candidates and point-in-rect
checks. CDP/DOM refresh should be bounded, coalesced, and tied to mode entry,
scope change, click/context-click, scroll/resize settle, or explicit refresh.

## Scope

Likely ownership:

- Sigil reticle/runtime integration in
  `apps/sigil/renderer/live-modules/annotation-reticle.js` and
  `apps/sigil/renderer/live-modules/main.js`;
- neutral candidate scoping/ranking helpers in
  `packages/toolkit/workbench/annotation-candidates.js`;
- browser adapter/projection helpers in `packages/toolkit/workbench/` and
  `src/browser/` only if needed for local Chrome/Chromium session/window/page
  identity;
- focused renderer/toolkit/browser tests;
- docs/API updates only if a shared contract changes.

Avoid daemon policy changes unless inspection proves a missing generic
primitive is required. If Swift changes are needed, run
`./aos dev recommend --json` before selecting verification and use
`./aos dev build` rather than raw build scripts.

## Hard Boundaries / Non-Goals

- No persistent annotation database.
- No snapshot payload redesign beyond preserving nested path evidence.
- No Surface Inspector-first authoring flow.
- No Sigil-named daemon policy.
- No screenshot-pixel oracle.
- No broad AX tree harvesting.
- No broad browser automation framework.
- No live website capture/report/export work.
- No Chrome extension/sidebar revival.
- No treating selectors as the only durable anchor.

## Suggested Implementation Approach

1. Add deterministic tests that reproduce the current failure:
   - commit a parent native window/canvas/browser root;
   - enter reticle again;
   - provide one child candidate inside the parent and one smaller or higher
     priority sibling/outside candidate;
   - verify scoped selection chooses the child and rejects the outside candidate.
2. Add a neutral candidate scoping helper, for example
   `filterAnnotationCandidatesForScope(candidates, scope, point, options)`,
   that uses adapter id, root id/kind, subject path, parent id, projection rect,
   and root-match evidence.
3. Teach the Sigil reticle controller to seed the next entry scope from live
   committed anchors and to pass the active scope to target resolution.
4. Update native AX candidate construction in Sigil so selected-root evidence
   comes from the active native window anchor when present, not merely the
   latest native window event.
5. Extend browser DOM targeting from controlled fixture only to an explicit
   local Chrome/Chromium page adapter. Start with a controlled browser session
   or a fixture-driven CDP attach test; add live Chrome/Comet smoke only after
   deterministic coverage exists.
6. Keep unsupported browser/page cases explicit through blocker reasons rather
   than falling back to outside native AX or global window candidates.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check
```

If Swift/browser adapter code changes:

```bash
./aos dev recommend --json
./aos dev build
bash tests/browser/smoke.test.sh
```

If `./aos ready` passes, run a bounded live smoke:

1. Launch Sigil through the canonical repo-mode path.
2. Use real input to select a visible native window or AOS canvas as a parent
   reticle anchor.
3. Invoke the reticle again while the avatar/reticle starts outside that parent.
4. Move inside the parent and verify a child candidate inside the parent wins
   over outside/sibling candidates.
5. Release and verify commit/session data records the nested `scope_path`.
6. Add or preserve an optional comment on the deepest anchor.
7. Trigger radial camera and verify snapshot evidence preserves the nested path.
8. For Chrome/Chromium, attach only to an explicit local browser page, target a
   visible DOM element, and verify the commit uses
   `adapter_id=aos-browser-dom-element-picker` or an explicitly named browser
   page adapter rather than `macos-ax` fallback.
9. If Comet is available locally, repeat the browser smoke there; otherwise
   report the missing local app as a live-smoke blocker and keep deterministic
   Chromium-family coverage.
10. Clean up canvases and report final `./aos ready` plus
    `git status --short --branch`.

## Completion Report

Report:

- files changed;
- exact nested reticle scope rule implemented;
- exact browser/Chromium adapter boundary implemented;
- whether Comet was proven live, covered deterministically, or blocked by local
  availability;
- tests run with pass/fail results;
- live smoke result or readiness blocker;
- any new blocker reasons introduced;
- any remaining follow-up slice needed for deeper browser frame/shadow DOM,
  scroll/resize settle, comments UI, or snapshot evidence.
