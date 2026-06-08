# Sigil Reticle Comet Browser Bridge Blocker Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Source follow-up card:
  `docs/design/work-cards/sigil-reticle-comet-browser-candidate-cache-v0.md`
- Returned Implementer branch under Foreman review:
  `implementer/sigil-reticle-comet-browser-candidate-cache-v0`
- Returned Implementer commit:
  `3646b1a72a83eb67b2cf591cde82cc1f3c248360`

Foreman rejected the returned slice for one blocking explainability gap. Do not
restart the broader browser targeting work or undo the candidate cache/debug
state direction from the returned commit.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
issue state, display topology, Comet state, browser state, Sigil state, or prior
review context. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/implementer/sigil-reticle-comet-browser-candidate-cache-v0`
- `required_start_ref: origin/implementer/sigil-reticle-comet-browser-candidate-cache-v0`
- Expected output branch: keep working on
  `implementer/sigil-reticle-comet-browser-candidate-cache-v0`
- Stop and report instead of rebasing if the current branch is not the Implementer
  branch above or if `apps/sigil/renderer/live-modules/main.js` lacks
  `annotationReticleBrowserDomBridge`.

## Foreman Review Finding

The returned commit records visible bridge state for local request setup,
stale responses, stale scope, no-target responses, candidate rejection, and
generic request failures. But daemon-side `browser_dom.element_target` error
responses still collapse to the generic blocker
`browser_dom_request_failed`.

The work card required exact blockers for unresolved session/window evidence,
missing content rect, point translation failures, stale scope, no DOM target,
unsupported or non-local browser sessions/windows, and scoped candidate
rejection. The daemon already returns specific error codes:

- `BROWSER_SESSION_UNRESOLVED`
- `BROWSER_DOM_POINT_UNRESOLVED`
- `BROWSER_CONTENT_INSET_UNRESOLVED`
- `NATIVE_AX_ROOT_MISMATCH`
- `BROWSER_SESSION_NOT_LOCAL`
- `BROWSER_DOM_TARGET_INVALID_JSON`
- `BROWSER_DOM_TARGET_FAILED`

However `apps/sigil/renderer/live-modules/host-runtime.js` rejects non-`ok`
canvas responses as an `Error` whose message is only
`CODE: message`, and `apps/sigil/renderer/live-modules/main.js` catches that
error and records:

```js
blocker_reason: 'browser_dom_request_failed'
```

That means the live Comet gap can still end with only a generic request failure
when the real blocker is an unresolved session, non-local session, native root
mismatch, or content rect problem.

Foreman deterministic evidence on the returned branch passed:

```bash
./aos dev recommend --json
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

Do not treat passing source-shape tests as acceptance for this correction.

## Goal

Make Sigil reticle browser bridge failures preserve the daemon's precise error
class in `liveJs.annotationReticleBrowserDomBridge` and
`liveJs.annotationReticleEvents`, so a Comet/browser cache miss is actionable
instead of collapsing to `browser_dom_request_failed`.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/sigil-reticle-comet-browser-candidate-cache-v0.md`
- `apps/sigil/renderer/live-modules/host-runtime.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `src/daemon/unified.swift`
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
rg -n "browser_dom\\.element_target|dispatchCanvasResponse|host\\.request\\('browser_dom\\.element_target'|browser_dom_bridge_failed|annotationReticleBrowserDomBridge|BROWSER_SESSION_NOT_LOCAL|NATIVE_AX_ROOT_MISMATCH" apps src tests packages
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and include the script output. After the human
returns with `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - owns bridge evidence,
  browser DOM target request, cache insertion, stale response handling, and
  reticle debug events.
- `apps/sigil/renderer/live-modules/host-runtime.js` - owns request promise
  rejection for non-`ok` canvas responses.
- `src/daemon/unified.swift` - owns the `browser_dom.element_target` error
  codes and messages.
- `tests/renderer/annotation-reticle.test.mjs` - currently has source-shape
  assertions for the bridge path; add stronger focused coverage or a small
  testable helper so the error-code mapping cannot regress silently.

## Required Behavior

When `browser_dom.element_target` rejects or returns an error, Sigil must record
the most specific blocker available:

- `BROWSER_SESSION_UNRESOLVED` -> `browser_session_unresolved`;
- `BROWSER_DOM_POINT_UNRESOLVED` -> `browser_dom_point_unresolved`;
- `BROWSER_CONTENT_INSET_UNRESOLVED` -> `browser_content_inset_unresolved`;
- `BROWSER_SESSION_NOT_LOCAL` -> `browser_session_not_local`;
- `NATIVE_AX_ROOT_MISMATCH` -> `native_ax_root_mismatch` or an existing scoped
  window/scope mismatch reason if that is already the local convention;
- `BROWSER_DOM_TARGET_INVALID_JSON` -> a precise invalid-target-response
  blocker, not generic request failure;
- `BROWSER_DOM_TARGET_FAILED` -> a precise target-evaluation failure blocker,
  not generic request failure.

Keep the raw daemon code and message visible in the bridge debug entry when
available. It is fine to add `code`, `error_code`, or similar fields to
`annotationReticleBrowserDomBridge` entries if that keeps the evidence explicit.

If you change `host-runtime.js`, keep the change generic for all canvas
requests: preserve the current `Error` behavior while attaching structured
`code`, `status`, and `message` fields to the thrown error. Do not force every
caller to handle a new result shape.

If you keep the normalization local to `main.js`, make the parser bounded to
known browser bridge codes and keep unknown failures as
`browser_dom_request_failed` with the raw message.

## Scope

Likely ownership is limited to:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/host-runtime.js` if structured rejected
  errors are the narrowest clean fix
- `tests/renderer/annotation-reticle.test.mjs`

Avoid daemon changes unless inspection proves the daemon is not returning the
code/message described above.

## Hard Boundaries / Non-Goals

- Do not add broad DOM/CDP discovery on every mousemove.
- Do not crawl pages, export reports, bypass login/CAPTCHA/consent, or revive a
  browser extension.
- Do not make Surface Inspector the primary annotation authoring UI.
- Do not add persistent annotation storage or snapshot schema redesign.
- Do not use screenshot pixels as the source of truth.
- Do not add Sigil-named daemon policy.
- Do not regress native scoped targeting accepted at `a363613`.
- Do not replace the returned bridge state with a less explicit event-only
  path.

## Verification

Minimum deterministic evidence:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/host-runtime.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

Add focused deterministic coverage that proves at least:

- a daemon `BROWSER_SESSION_NOT_LOCAL` rejection records
  `browser_session_not_local`;
- a daemon `BROWSER_SESSION_UNRESOLVED` rejection records
  `browser_session_unresolved`;
- an unknown rejection still records `browser_dom_request_failed` with the raw
  message.

If `./aos ready` is green and Comet/Chromium is available after the deterministic
correction passes, include a bounded live smoke:

1. Launch Sigil reticle through the normal radial path.
2. Hover/release over a Comet/Chromium page area.
3. Capture `annotationReticle` / `annotationReticleEvents` evidence showing
   either a browser DOM candidate source or a precise browser bridge blocker.
4. Clean up smoke-opened canvases and run final `./aos ready`.

## Completion Report

Return a concise report with:

- files changed;
- exact error-code-to-blocker behavior added;
- tests run with exact pass/fail results;
- `./aos ready` result;
- live smoke result or why it was skipped;
- final `git status --short --branch`;
- remaining blockers or follow-up recommendation.
