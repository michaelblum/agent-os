# Surface Inspector Controlled Browser DOM Projection V0

## Tracker

- Parent Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related human intent tracker: https://github.com/michaelblum/agent-os/issues/294
- Related evidence workflow tracker: https://github.com/michaelblum/agent-os/issues/293
- Follows:
  `docs/design/work-cards/surface-inspector-browser-dom-element-picker-v0.md`

## Goal

Integrate the validated Browser DOM Element Picker V0 adapter with Surface
Inspector for a controlled local browser surface.

The previous slice proved the model/harness:

- `browser-dom-element-picker.js` resolves DOM targets and ancestor chains;
- committed records validate as `kind: "element_target"`;
- projection compatibility works through `buildBrowserDomAnnotationProjection`;
- Operator verified the controlled fixture and confirmed live SI browser-page
  projection was intentionally out of scope.

This slice should close that next gap: Surface Inspector can attach to a
controlled browser surface, request/publish DOM picker targets, reveal them, and
create/inspect structured element-target intent without relying on a standalone
smoke record as the interaction surface.

Keep this local and bounded. Do not start Employer Brand live website
collection.

## Required Behavior

### 1. Controlled Browser Surface Publisher

Add a small controlled browser DOM target publisher for local fixtures.

Required behavior:

- loads only the local controlled fixture in
  `docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html`;
- injects or evaluates the DOM picker adapter in a bounded page context;
- publishes current DOM picker targets using the same Surface Inspector semantic
  target replay pattern used by HTML Workbench Expression;
- accepts a Surface Inspector request message or equivalent harness trigger to
  replay current targets after SI launches late;
- exposes deterministic state for tests, such as selected point, ancestor
  options, committed element target, and publish count.

Use Playwright/CDP only as a bounded local harness. Do not introduce a broad
browser automation framework.

### 2. Surface Inspector Consumption

Surface Inspector should consume browser DOM element targets as first-class
annotation candidates.

Required behavior:

- target records identify `surface_type: "browser_page"`;
- projection uses `browser_dom_element` precision;
- visible DOM targets can be pinned/commented through existing SI annotation
  state helpers where possible;
- revealable offscreen DOM targets report `can_reveal=true` and a reveal action
  equivalent to `scrollIntoView`;
- unsupported/stale targets report explicit blockers.

Do not add minimap action controls or a separate browser-only annotation UI.
Use the existing Surface Inspector annotation vocabulary.

### 3. Reveal Path

Implement or model a bounded reveal path for controlled browser DOM targets.

Minimum:

- visible targets return `already_visible`;
- offscreen fixture target can be revealed with `scrollIntoView` through the
  controlled page harness;
- reveal result is reflected in projection/debug state;
- failures return explicit `target_absent`, `adapter_error`, or `unsupported`
  style statuses.

### 4. Fixture And Tests

Add deterministic fixtures/tests that prove:

- controlled browser DOM publisher emits expected targets for the local fixture;
- late Surface Inspector attach can request/replay current browser DOM targets;
- committed `element_target` is still schema-valid;
- `section[data-testid="hero-card"]` is projectable/revealable;
- an offscreen fixture element models/reveals correctly;
- rejected/tooling DOM is not published as a target;
- no live website URL is opened.

### 5. Operator Smoke Path

Provide a bounded command or documented sequence for Operator to verify:

- launch controlled local browser fixture;
- launch Surface Inspector after it;
- SI sees browser DOM targets;
- pin/comment the hero-card target or inspect the committed target record;
- reveal an offscreen target;
- clear annotations without mutating source files.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/html-workbench-expression/index.js`
- `scripts/browser-dom-element-picker-smoke.mjs`
- `tests/toolkit/browser-dom-element-picker.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

Likely new or changed files:

- a controlled browser DOM publisher/helper under `packages/toolkit/workbench/`
  or `packages/toolkit/components/` if a visible AOS-hosted surface is needed;
- a bounded script such as
  `scripts/browser-dom-element-picker-surface-smoke.mjs`;
- focused tests for late replay, projection, reveal, and non-live safety.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/browser-dom-element-picker.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

If `./aos ready` passes, run a bounded live smoke:

- local controlled fixture only;
- Surface Inspector launched after the browser DOM publisher;
- browser DOM targets discovered through replay/request path;
- hero-card target projectable;
- offscreen target reveal modeled or performed;
- clear annotations leaves source files unchanged.

## Non-Goals

- no arbitrary live websites;
- no Employer Brand capture/locator/report/export mutation;
- no broad CDP/playwright framework;
- no login/paywall/CAPTCHA/consent bypass;
- no screenshot-pixel oracle;
- no Chrome extension/sidebar revival;
- no Surface-Zoom work.
