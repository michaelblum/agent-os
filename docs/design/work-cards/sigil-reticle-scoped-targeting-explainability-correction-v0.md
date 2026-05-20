# Sigil Reticle Scoped Targeting Explainability Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Adapter tracker: https://github.com/michaelblum/agent-os/issues/297
- Prior broad card:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-nested-browser-targeting-v0.md`
- Prior accepted bridge:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Current contracts:
  - `docs/api/toolkit/workbench.md`
  - `packages/toolkit/workbench/annotation-candidates.js`
  - `apps/sigil/renderer/live-modules/annotation-reticle.js`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
issue state, display topology, VS Code state, Comet/Chrome state, candidate
cache state, or prior live evidence. Read and rediscover before editing. Work
in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a correction after the reticle target bridge and nested browser
targeting work landed. Do not replay the older broad card as if it has not been
implemented. Preserve the wins and fix the inconsistent scoped targeting.

## Branch / Base

- `branch_from: origin/main`
- `required_start_ref: origin/main`
- Expected output branch:
  `gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Stop and report instead of rebasing if the work card is not present on
  `origin/main` or if the current tree lacks
  `packages/toolkit/workbench/annotation-candidates.js`.

## User Report

Michael tested the Sigil radial menu reticle maneuver for targeting annotation
anchors.

What worked:

- targeting the extended display worked;
- targeting sub-elements on the extended display worked sometimes;
- reticle targeting highlighted elements inside a web page in Comet browser.

Observed defects:

- with VS Code maximized on the extended display, after targeting a parent app
  window/anchor, dragging the reticle inside that parent sometimes highlighted
  one panel and sometimes highlighted the full app window;
- when an anchor is active, reticle hover should only highlight direct children
  of that anchor unless a deliberate up-scope behavior is implemented;
- inside a Comet web page, some DOM elements highlight and others are ignored,
  but the system does not make clear why one element is chosen and another is
  skipped.

Terminology: a frame is a commentless annotation anchor; comments are optional
text attached to anchors. Preserve internal `pin` names only where renaming
would be noisy.

## Goal

Make Sigil reticle scoped target selection stable and explainable.

After a parent anchor is active, reticle preview/release must prefer scoped
direct children of that anchor. If no direct child can be selected, the reticle
must expose a concrete reason rather than silently falling back to the parent,
full app window, stale global candidate, or display root.

For browser page targeting, preserve the current Comet/Chromium breakthrough
but add enough candidate/rejection evidence that a human can tell why a web page
element was selected, ignored, blocked, or deferred.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-nested-browser-targeting-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/browser/focus-browser.test.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos dev gh issue view 295 --json
./aos dev gh issue view 297 --json
rg -n "chooseAnnotationCandidateForScope|filterAnnotationCandidatesForScope|candidate_outside_active_scope|candidate_not_direct_child|annotationReticle|browser_dom_bridge|Comet|browser-dom-point" apps packages src tests docs
```

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with "ready", run:

```bash
./aos ready --post-permission
```

Only continue live verification if it reports ready.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-candidates.js` owns scoped candidate
  filtering and ranking. It already has rejection reasons such as
  `candidate_outside_active_scope`, `candidate_not_direct_child`,
  `native_ax_root_mismatch`, and `browser_content_inset_unresolved`.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` owns reticle
  session entry, preview, release, live committed scope reuse, fallback
  subjects, commit events, and snapshot state.
- `apps/sigil/renderer/live-modules/main.js` owns candidate evidence caching,
  native AX event ingestion, browser DOM target requests, reticle event
  recording, and debug snapshots.
- `packages/toolkit/workbench/browser-dom-element-picker.js` and the
  `browser_dom.element_target` daemon path own browser DOM hit-test results and
  skipped target evidence.
- `tests/toolkit/annotation-candidates.test.mjs` already covers some scoped
  native and browser DOM cases. Extend it for the observed inconsistent cases
  instead of replacing those tests.

## Required Behavior

### 1. Stable Direct-Child Selection Under Active Anchor

When the active scope is a committed parent anchor, reticle hover/release must
not select the active scope itself as the preview target while the pointer is
inside that scope unless an explicit up-scope gesture exists.

Expected behavior:

- if a scoped direct child candidate under the pointer exists, select it;
- if only grandchildren exist and direct-child mode is active, select the direct
  child ancestor when available and record the rejected grandchild reason;
- if no direct child exists, keep the current anchor or fallback visually
  stable and record `active_scope_no_direct_child_under_pointer` or a more
  precise existing blocker;
- do not alternate between the full app window and panels merely because
  candidate cache timing changes.

### 2. Rejection Evidence Reaches Sigil Debug State

Reticle debug state and recent reticle events must expose enough evidence to
understand a targeting decision:

- active scope address, adapter id, root id/kind, and subject path;
- raw candidate count and scoped candidate count;
- selected candidate id/adapter/subject kind/label;
- at least the first few rejected candidate ids with reasons;
- fallback reason when display/window/root fallback is used;
- whether the selected target came from native AX, AOS semantic targets,
  canvas/window candidates, browser DOM element picker, or display fallback.

This evidence may live in `liveJs.annotationReticle`,
`liveJs.annotationReticleEvents`, or another existing Sigil debug surface. Do
not add a new product UI unless a tiny existing diagnostics row needs the data.

### 3. VS Code Extended Display Case

Add deterministic coverage for a maximized native app window on a non-main or
extended display:

- parent native window scope is active;
- child panel candidate and full-window candidate both contain the pointer;
- a smaller outside/sibling candidate also contains or overlaps the pointer;
- scoped selection chooses the child panel, rejects the active full-window
  scope as `candidate_is_active_scope`, and rejects outside/sibling candidates
  as `native_ax_root_mismatch` or `candidate_outside_active_scope`;
- release commits a nested `scope_path` under the parent anchor.

If current native AX evidence cannot identify VS Code panel ancestry reliably,
preserve that as explicit blocker evidence instead of letting the full app
window look like a successful child target.

### 4. Comet / Chromium Browser Page Explainability

Preserve browser page element targeting in Comet/Chromium, but make ignored
elements explainable.

Expected behavior:

- DOM target responses should carry skipped stack evidence or rejection reasons
  through to Sigil reticle diagnostics where feasible;
- ignored elements should distinguish at least hidden/zero-area/tooling DOM,
  unsupported tag, outside active scope, missing content inset, stale browser
  session/window, no DOM target at point, and direct-child mismatch;
- browser DOM candidates with proven content rect and matching window/session
  should outrank coarse native AX browser-window/app candidates inside the
  scoped browser page/window;
- if the browser content inset or session cannot be proven, do not draw a false
  overlay. Report `browser_content_inset_unresolved`,
  `browser_session_not_local`, or the current exact blocker.

Do not broaden this into page crawling, capture/export, or an extension.

### 5. Candidate Cache Freshness

Inspect whether preview inconsistency is caused by stale cached candidates,
late browser DOM responses, or native AX/window event ordering. If so:

- mark stale candidates and keep them from winning scoped hover;
- coalesce browser DOM refreshes without doing full DOM discovery on every
  mousemove;
- ensure late browser DOM responses are only accepted when they match the
  active scope and recent pointer/reason;
- keep fallback explicit when cache freshness is the blocker.

## Scope

Likely ownership:

- `packages/toolkit/workbench/annotation-candidates.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js` only if skipped
  or blocker evidence is not currently carried far enough
- focused tests under `tests/toolkit/`, `tests/renderer/`, and browser tests if
  Swift/browser command behavior changes
- docs/API only if a shared diagnostics contract changes

Avoid daemon or Swift changes unless inspection proves the browser DOM target
path cannot provide the needed blocker/skipped evidence otherwise. If Swift
changes are needed, use `./aos dev recommend --json` and `./aos dev build`.

## Hard Boundaries / Non-Goals

- No persistent annotation database.
- No snapshot schema redesign.
- No Surface Inspector-first authoring flow.
- No Sigil-named daemon policy.
- No broad AX tree harvesting.
- No screenshot-pixel oracle.
- No page crawling, scraping, login bypass, CAPTCHA/consent bypass, report
  generation, or Employer Brand workflow mutation.
- No Chrome extension/sidebar revival.
- No full-page DOM/CDP discovery on every mousemove.
- No visual redesign beyond diagnostics needed to verify selection.

## Suggested Implementation Areas

One acceptable path:

1. Extend `filterAnnotationCandidatesForScope(..., { include_rejections: true })`
   or add a small sibling helper so Sigil can get both scoped candidates and
   rejection evidence without duplicating toolkit rules.
2. Teach `resolveSigilAnnotationReticleTarget(...)` to preserve that decision
   report in the returned target result.
3. Carry the decision report into `annotationReticle.snapshot()` and commit
   events.
4. Add deterministic tests for active-scope self rejection, panel-vs-window
   selection, outside candidate rejection, and browser DOM candidates outranking
   coarse browser window candidates when evidence is valid.
5. Carry browser DOM skipped/rejection evidence from
   `browser_dom.element_target` into the candidate or reticle event stream.
6. Add or update a bounded real-input scenario only after deterministic tests
   explain the intended decision path.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json
node --check packages/toolkit/workbench/annotation-candidates.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check
```

If browser/Swift code changes:

```bash
./aos dev build
bash tests/browser/focus-browser.test.sh
bash tests/browser/see-capture.test.sh
```

If `./aos ready` passes, run a bounded live smoke:

1. Confirm `./aos ready` reports ready.
2. Use the Sigil reticle to target the extended display and confirm that still
   works.
3. With VS Code maximized on the extended display, target the app/window as the
   parent anchor.
4. Invoke the reticle again and drag inside the active parent. Verify panel or
   direct-child selection is stable and the full app window does not silently
   win while a direct child is under the pointer.
5. Capture Sigil reticle debug state showing active scope, selected candidate,
   candidate counts, and rejection reasons.
6. In Comet or another available Chromium-family browser, target visible page
   elements and capture debug evidence for both selected and ignored elements.
7. Trigger the radial camera if live anchors exist and verify nested
   `scope_path` evidence survives.
8. Clean up canvases and report final `./aos ready` plus
   `git status --short --branch`.

If Comet is not locally available to GDI, use the available Chromium-family
browser for live smoke and report Comet as an Operator follow-up.

## Completion Report

Report:

- changed files;
- exact scoped target rule implemented;
- how active-scope self/full-window fallback is prevented or explained;
- new rejection/debug evidence fields and where Foreman/Operator can inspect
  them;
- what changed for Comet/Chromium DOM element targeting and ignored-element
  explanations;
- deterministic tests and exact results;
- live smoke result or exact readiness/TCC/browser availability blocker;
- final `./aos ready`;
- final `git status --short --branch`;
- recommended follow-up if deeper browser frame/shadow DOM, scroll/resize
  settle, or comment UI still needs separate work.

If this GDI CLI session already had a completed active goal, remind the human
to run `/goal clear` before retiring it or starting unrelated work.
