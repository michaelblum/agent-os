# Sigil Reticle Comet Browser Candidate Cache V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Accepted scoped-targeting head on `main`:
  `a363613a6ce23c2d98315fffdc86162727c184fb`
- Operator live evidence artifact directory:
  `/tmp/aos-operator-sigil-reticle-20260521/`
- Accepted scoped-targeting cards:
  - `docs/design/work-cards/sigil-reticle-scoped-targeting-explainability-correction-v0.md`
  - `docs/design/work-cards/sigil-reticle-scoped-descendant-disambiguation-correction-v0.md`
  - `docs/design/work-cards/sigil-reticle-native-ax-active-scope-path-correction-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
browser state, display topology, Comet state, Sigil state, or artifact
availability. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/main`
- `required_start_ref: origin/main`
- Expected output branch:
  `gdi/sigil-reticle-comet-browser-candidate-cache-v0`
- Stop and report instead of rebasing if `origin/main` is not at or after
  `a363613a6ce23c2d98315fffdc86162727c184fb`.

## Operator Evidence

Operator live validation on `main` at `a363613` confirmed the native scoped
targeting correction:

- `./aos ready` reported `ready=true mode=repo daemon=reachable tap=active`.
- VS Code was available on the non-main display, focused/maximized:
  window `7735`, native bounds `-207,1012,1920,1050`.
- Reticle launched through Sigil radial drag-through-reticle.
- Full-frame parent selection worked: selected `macos-ax` `AXGroup` for VS
  Code, `fallback=false`, and rejected a separate native window candidate as
  `candidate_visual_equivalent`.
- After the parent was active, the reticle did not let the active parent or
  same-window full window win:
  - active parent rejected as `candidate_is_active_scope`;
  - full native window rejected as `candidate_not_in_active_scope` /
    `candidate_outside_active_scope`;
  - no distinct descendant existed in the empty editor area, so fallback was
    explicit: `active_scope_no_distinct_descendant_under_pointer`.

The remaining live gap is browser-specific:

- Comet was visible.
- `./aos see cursor` resolved page-content AX evidence:
  `/tmp/aos-operator-sigil-reticle-20260521/final-cursor.json`
  showed Comet window `195`, bundle `ai.perplexity.comet`, and an `AXGroup`
  page-content element under the pointer.
- Clean Sigil reticle evidence did not receive a Comet/browser candidate into
  its live cache.
- The reticle report stayed explicit but unproductive:
  `raw_candidate_count=2`, `scoped_candidate_count=0`, fallback
  `active_scope_no_distinct_descendant_under_pointer`.

The saved final Sigil debug artifact was captured after cleanup, so it no
longer contains the in-flight reticle `decision_report`. Treat the Operator
report above as the live evidence source and rediscover locally.

## Goal

Make Sigil reticle browser-page targeting for Comet/Chromium explainable and
actionable when AOS can see native page-content evidence but the reticle cache
does not receive a browser DOM candidate.

The desired outcome is not guaranteed DOM targeting for every browser page. The
desired outcome is that the reticle either:

- obtains and caches a scoped browser candidate when the local browser bridge
  has enough session/window/content-rect evidence; or
- records a precise blocker in Sigil debug state/events explaining why no
  browser candidate can be requested or accepted.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/sigil-reticle-scoped-targeting-explainability-correction-v0.md`
- `docs/design/work-cards/sigil-reticle-scoped-descendant-disambiguation-correction-v0.md`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/toolkit/browser-dom-element-picker.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
rg -n "annotationReticleBrowserDomBridgeEvidence|annotationReticleRequestBrowserDomTarget|browser_dom_bridge|browser_session|browser_content_rect|latestNativeWindowEvent|latestNativeAxElementEvent|buildBrowserDomElementAnnotationCandidate|aos-browser-dom-element-picker" apps packages src tests docs
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with `ready`, run `./aos ready --post-permission`.

If the Operator artifacts still exist, inspect:

```bash
jq '.' /tmp/aos-operator-sigil-reticle-20260521/final-cursor.json
jq '.' /tmp/aos-operator-sigil-reticle-20260521/pre-clean-show-list.json
```

Do not depend on those temp artifacts for tests; they may be absent.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` owns native window/AX event
  ingestion, reticle candidate cache updates, browser DOM bridge evidence,
  browser DOM target requests, stale-response handling, and reticle debug
  events.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` owns decision
  reports and fallback subjects.
- `packages/toolkit/workbench/browser-dom-element-picker.js` owns browser DOM
  candidate shape and skipped/rejection evidence.
- `packages/toolkit/workbench/annotation-candidates.js` owns scoped candidate
  filtering, browser candidate acceptance, visual-equivalence collapse, and
  fallback reasons.

## Required Behavior

### Browser Bridge Blockers Must Be Visible

When the active scope is a native browser window/page-like anchor and Sigil
cannot request or accept a browser DOM candidate, `liveJs.annotationReticle`,
`liveJs.annotationReticleEvents`, or adjacent existing debug state must expose
the exact blocker. Distinguish at least:

- no browser session/window evidence, e.g. `browser_session_unresolved`;
- missing content inset, e.g. `browser_content_inset_unresolved`;
- pointer cannot be translated, e.g. `browser_dom_point_unresolved`;
- stale browser response/request scope mismatch;
- no DOM target at point;
- unsupported or non-local browser session/window;
- scoped candidate rejected because it is outside the active anchor.

The blocker must be visible even when no candidate is inserted into the cache.
Do not leave the user with only
`active_scope_no_distinct_descendant_under_pointer` when the real blocker is
that browser bridge evidence was unavailable.

### Candidate Cache Path

If Comet/Chromium native event payloads can provide enough local browser
evidence, update the Sigil reticle path so a bounded browser DOM target request
can be made and the resulting `aos-browser-dom-element-picker` candidate can be
inserted into the reticle candidate cache.

If the current daemon/browser path does not expose the needed evidence for
Comet, keep the implementation bounded and report the exact missing primitive
or payload field. Prefer explicit blocker propagation over speculative
browser-specific heuristics.

### Preserve Accepted Scoped Behavior

Do not regress the accepted `a363613` behavior:

- active native parent/full window cannot win as a fake child;
- native AX scoped path ancestry is enforced when available;
- visually distinct descendants are allowed;
- same-rectangle layers collapse with diagnostics;
- browser DOM skipped/rejection evidence is retained;
- stale browser DOM responses are ignored.

## Scope

Likely ownership:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- focused tests under `tests/renderer/` and `tests/toolkit/`

Avoid Swift/daemon changes unless inspection proves the existing browser DOM
target command cannot expose the needed blocker or evidence. If daemon changes
are necessary, keep them generic browser/annotation primitives, not Sigil
product policy.

## Hard Boundaries / Non-Goals

- Do not add broad DOM/CDP discovery on every mousemove.
- Do not crawl pages, export reports, bypass login/CAPTCHA/consent, or revive a
  browser extension.
- Do not make Surface Inspector the primary annotation authoring UI.
- Do not add persistent annotation storage or snapshot schema redesign.
- Do not use screenshot pixels as the source of truth.
- Do not add Sigil-named daemon policy.
- Do not regress native scoped targeting accepted at `a363613`.

## Verification

Minimum deterministic evidence:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

Add or update focused deterministic tests that prove blocker evidence is
recorded when a browser DOM target cannot be requested or accepted.

If `./aos ready` is green and Comet/Chromium is available, include a bounded
live smoke:

1. Launch Sigil reticle through the normal radial path.
2. Hover/release over a Comet/Chromium page area.
3. Capture `annotationReticle` / `annotationReticleEvents` evidence showing
   either a browser DOM candidate source or a precise browser bridge blocker.
4. Clean up smoke-opened canvases and run final `./aos ready`.

If live smoke is unavailable, state exactly why and include deterministic
evidence.

## Completion Report

Return a concise report with:

- files changed;
- whether a browser DOM candidate is now cached or which precise blocker is now
  surfaced;
- tests run with pass/fail results;
- `./aos ready` result;
- live smoke result or reason skipped;
- any remaining missing daemon/browser primitive as a follow-up.
