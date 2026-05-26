# Sigil Reticle Comet Preview Anchor Bridge Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Landed browser bridge blocker correction on `main`:
  `a597e550b8dc2f5a0afd596d23c6fb729b8c30fd`
- Prior routed cards:
  - `docs/design/work-cards/sigil-reticle-comet-browser-candidate-cache-v0.md`
  - `docs/design/work-cards/sigil-reticle-comet-browser-bridge-blocker-correction-v0.md`
- Operator live evidence directory:
  `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
browser state, display topology, Sigil state, Comet state, or temp artifact
availability. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/main`
- `required_start_ref: origin/main`
- Expected output branch:
  `gdi/sigil-reticle-comet-preview-anchor-bridge-correction-v0`
- Stop and report instead of rebasing if `origin/main` is not at or after
  `a597e550b8dc2f5a0afd596d23c6fb729b8c30fd`.

## Operator Evidence

Operator live-smoked `main` at
`a597e550b8dc2f5a0afd596d23c6fb729b8c30fd` and reported:

- `git status --short --branch`: `## main...origin/main`
- `./aos ready`: `ready=true mode=repo daemon=reachable tap=active`
- No files edited.
- Result: still blocked, not live-accepted.

Artifacts:

- `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/04-reticle-hover-page-pre-release.json`
- `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/05-reticle-after-release.json`
- `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/07-cursor-page-region.json`
- `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/07-cursor-page-region.png`
- `/tmp/aos-operator-sigil-reticle-295-20260521/pass2/10-final-show-list.json`

Important observed facts from Foreman artifact inspection:

- `04-reticle-hover-page-pre-release.json` shows
  `annotationReticle.decision_report.selected` is the Comet native window:
  `native-window:195:Comet`, `adapter_id: "macos-ax"`,
  `root_kind: "native_window"`, `subject_kind: "native_window"`.
- The same artifact shows
  `annotationReticleBrowserDomBridge.blocker_reason` is
  `browser_native_window_scope_required`.
- Repeated `browser_dom_bridge_blocked` events carry that same blocker with no
  `browser_window_id`, no `browser_session_id`, no `content_rect`, and empty
  `active_scope_address`.
- `annotationReticle.active_scope` at that point is still the committed display
  root `sigil:display:1:root`.
- `annotationReticle.preview_target` is the Comet native window in the earlier
  `03-reticle-entered.json` artifact, while the bridge is already blocked.
- `07-cursor-page-region.json` proves AOS can see Comet page content at the
  page-region pointer: window `Comet`, `window_id=195`, bundle
  `ai.perplexity.comet`, and an `AXGroup` page-content element under the
  pointer.

## Foreman Review Finding

The previous correction succeeded at preserving precise daemon error codes, but
the live path is blocked before reaching the daemon. The bridge currently asks
for browser evidence before the same-frame reticle preview/release-selected
native browser window is usable as the browser anchor.

In `apps/sigil/renderer/live-modules/main.js`, `flushAnnotationReticlePreview()`
currently calls:

```js
annotationReticleRequestBrowserDomTarget(pointer, 'preview');
annotationReticle.updatePreview(pointer);
```

and `commitAnnotationReticleRelease()` calls:

```js
annotationReticleRequestBrowserDomTarget({ x, y, valid: true }, 'release');
const event = annotationReticle.commitRelease({ x, y, valid: true });
```

`annotationReticleBrowserDomBridgeEvidence()` then reads only
`annotationReticle.snapshot()?.active_scope`. On initial display-root reticle
entry, the committed active scope is the display root, even though the current
decision report has selected the Comet native window as the actionable anchor.
That is why live evidence reports `browser_native_window_scope_required` while
the reticle decision report selected a native browser window.

## Goal

Make the Sigil reticle browser bridge use the current preview/release-selected
native browser window as the browser bridge anchor when the committed active
scope is still a display/root scope, so Comet page-content hover/release yields
either:

- a cached/selected `aos-browser-dom-element-picker` candidate; or
- the next precise bridge blocker, such as `browser_session_unresolved`,
  `browser_session_not_local`, `browser_content_inset_unresolved`,
  `browser_dom_point_unresolved`, `native_ax_root_mismatch`,
  `no_dom_target_at_point`, `browser_dom_target_failed`, stale response, stale
  scope, or scoped candidate rejection.

Do not leave the live path blocked at `browser_native_window_scope_required`
when the same reticle decision report has selected a native browser window.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/sigil-reticle-comet-browser-candidate-cache-v0.md`
- `docs/design/work-cards/sigil-reticle-comet-browser-bridge-blocker-correction-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/host-runtime.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/toolkit/browser-dom-element-picker.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
rg -n "flushAnnotationReticlePreview|commitAnnotationReticleRelease|annotationReticleBrowserDomBridgeEvidence|annotationReticleRequestBrowserDomTarget|browser_native_window_scope_required|preview_target|decision_report|latestNativeWindowEvent|latestNativeAxElementEvent" apps/sigil packages/toolkit tests/renderer tests/toolkit
```

If the Operator artifacts still exist, inspect:

```bash
jq '{active:.annotationReticle.active, active_scope:.annotationReticle.active_scope, preview_target:.annotationReticle.preview_target, decision:.annotationReticle.decision_report, bridge:.annotationReticleBrowserDomBridge}' /tmp/aos-operator-sigil-reticle-295-20260521/pass2/04-reticle-hover-page-pre-release.json
jq '{window:.window, element:.element, cursor:.cursor}' /tmp/aos-operator-sigil-reticle-295-20260521/pass2/07-cursor-page-region.json
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - owns preview/release ordering,
  bridge evidence collection, browser DOM target requests, candidate cache
  insertion, and bridge debug events.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` - owns preview
  target selection, committed scope stack, release commit, and snapshot shape.
- `packages/toolkit/workbench/annotation-candidates.js` - owns scoped candidate
  selection and browser DOM candidate acceptance under native browser windows.
- `packages/toolkit/workbench/browser-dom-element-picker.js` - owns browser DOM
  candidate shape and projection metadata.
- `tests/renderer/annotation-reticle.test.mjs` - add focused deterministic
  coverage for preview/release browser anchor ordering or helper behavior.

## Required Behavior

### Preview Anchor

When reticle preview under a display/root active scope selects a native browser
window candidate, the browser bridge must treat that selected candidate as the
request anchor for the same pointer frame. It should not require the committed
active scope to already be the native window.

The bridge event/debug entry should expose which anchor was used or why it
could not be used. Add fields such as `anchor_candidate_id`,
`anchor_source`, `anchor_window_id`, or similar if that makes the evidence
clear.

### Release Anchor

On release over the same browser page region, ordering must not lose the
selected native browser anchor. If release needs a bridge request, it must use
the release-selected target from the same release decision, not stale display
scope alone.

### Browser Evidence Source

When the selected anchor is a native browser window, browser bridge evidence may
use the selected candidate/source metadata for `window_id`, `pid`, and bounds,
and may use current native AX page-content evidence for content rect if the
window event lacks an explicit browser content rect. Keep this bounded to the
selected native browser anchor; do not use unrelated stale native window or AX
events from another app.

If the selected anchor has only a native window id and no registered local
browser session, request by `browser_window_id` so the daemon can either resolve
the local session or return the precise `BROWSER_SESSION_UNRESOLVED` /
`BROWSER_SESSION_NOT_LOCAL` style blocker.

### Preserve Scoped Behavior

Do not regress the accepted scoped behavior:

- active native parent/full window cannot win as a fake child;
- native AX active-scope subject-path ancestry remains enforced;
- visually distinct descendants are allowed;
- same-rectangle layers collapse with diagnostics;
- browser DOM skipped/rejection evidence is retained;
- stale browser DOM responses and stale scope mismatches remain ignored and
  reported.

When the committed active scope is already a native AX/window scope, keep the
scope-safety checks strict. The display-root preview anchor exception is for
using the same-frame selected browser native window as the bridge anchor, not
for broad browser discovery.

## Scope

Likely ownership is limited to:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js` only if a small
  snapshot/helper addition is needed to expose the current selected target
  cleanly
- `tests/renderer/annotation-reticle.test.mjs`

Avoid daemon, Swift, browser adapter, Surface Inspector, persistent storage, or
schema redesign changes unless inspection proves an existing generic primitive
cannot expose the next blocker.

## Hard Boundaries / Non-Goals

- Do not add broad DOM/CDP discovery on every mousemove.
- Do not crawl pages, export reports, bypass login/CAPTCHA/consent, or revive a
  browser extension.
- Do not make Surface Inspector the primary annotation authoring UI.
- Do not add persistent annotation storage or snapshot schema redesign.
- Do not use screenshot pixels as source of truth.
- Do not add Sigil-named daemon policy.
- Do not weaken native scoped targeting accepted at `a363613`.
- Do not accept `browser_native_window_scope_required` as the terminal blocker
  when the current reticle decision selected a native browser window.

## Verification

Minimum deterministic evidence:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/host-runtime.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

Add focused deterministic coverage proving that when a preview/release decision
selects a native browser window while the committed scope is still a display
root, the bridge does not record `browser_native_window_scope_required` and
instead carries the selected native browser anchor into the browser evidence
path.

If `./aos ready` is green and Comet/Chromium is available, include a bounded
live smoke:

1. Launch Sigil reticle through the normal radial path.
2. Hover/release over a Comet/Chromium page-content area.
3. Capture `annotationReticle`, `annotationReticleEvents`, and
   `annotationReticleBrowserDomBridge` evidence showing either a browser DOM
   candidate source or a precise next bridge blocker.
4. Capture `./aos see cursor` evidence for the same page area if no browser DOM
   candidate appears.
5. Clean up smoke-opened canvases and run final `./aos ready`.

## Completion Report

Return a concise report with:

- files changed;
- exact preview/release anchor behavior changed;
- tests run with exact pass/fail results;
- `./aos ready` result;
- live smoke result or why it was skipped;
- final `git status --short --branch`;
- remaining blocker or follow-up recommendation.
