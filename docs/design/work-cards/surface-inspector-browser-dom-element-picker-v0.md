# Surface Inspector Browser DOM Element Picker V0

## Tracker

- Parent Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related human intent tracker: https://github.com/michaelblum/agent-os/issues/294
- Related evidence workflow tracker: https://github.com/michaelblum/agent-os/issues/293
- Related Employer Brand workflow: `docs/design/employer-brand-comparative-audit-workflow.md`

## Prior Art

This work-card is based on local archaeology of the old Syborg and
Studio/Gurulab annotation systems.

Syborg source:

- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/CLAUDE.md`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/annotation-classes.ts`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/__tests__/select-overlay.test.ts`

Studio/Gurulab source:

- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/docs/annotation_ancestor_picker_integration_plan_2026-03-14.md`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/.codex/skills/web-sherpa/scripts/semantic_workflow_runner.js`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/tools/web-sherpa-profile-manager/hitl_overlay.cjs`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/artifacts/annotation-e2e/2026-03-15T02-49-06-075Z/05_element_selection_committed.png`

Important prior-art behavior:

- Syborg `select` mode behaved like Chrome DevTools element inspect:
  - hover highlighted the DOM element under the cursor;
  - click produced an ancestor badge cascade;
  - hovering a badge preview-highlighted that ancestor;
  - clicking a badge committed a `SelectAnnotation`.
- Studio later generalized this to an `element_target` selection:
  - right-click opened an ancestor picker while annotation mode was active;
  - target discovery used `document.elementsFromPoint()` and skipped overlay DOM;
  - ancestor traversal handled shadow roots via `getRootNode().host`;
  - ancestors were grouped by visual distinctness;
  - committed payloads carried selector candidates, tag, role, text excerpt,
    ancestor chain, viewport/page bounds, and source `right_click_badge`.
- The Studio path used CDP/Playwright injection (`Runtime.evaluate` /
  `chromium.connectOverCDP`) for a headed browser surface. The acronym is CDP,
  Chrome DevTools Protocol.

Do not port the old Chrome extension/sidebar architecture. Treat these files as
algorithm and interaction donors only.

## Goal

Add a conservative, AOS-native browser DOM element picker foundation for Surface
Inspector.

The outcome should prove that a controlled browser page can expose DOM elements
as structured Surface Inspector annotation targets, including hover/pick
semantics and selector-rich committed annotation intent records.

This is the missing bridge for Employer Brand evidence intent alignment: the
human/Operator must be able to point at an exact DOM element on a source page,
choose the right ancestor, and produce a durable target record before locator or
capture work resumes.

## Required Behavior

### 1. Controlled Browser DOM Projection Adapter

Create a neutral browser DOM projection adapter, not an Employer Brand-specific
collector.

Minimum adapter responsibilities:

- accept a controlled document/page context;
- resolve the underlying DOM element at a viewport point;
- skip overlay/tooling DOM;
- reject hidden, zero-area, script/style/head/meta/html-only targets;
- build an ancestor chain from clicked element to `body`;
- cross shadow boundaries via `getRootNode()` and `ShadowRoot.host`;
- compute viewport and page bounds;
- build selector candidates;
- build a text/role/tag descriptor;
- emit Surface Inspector-compatible target/annotation records.

Use the existing AOS semantic-target and annotation-projection vocabulary where
it fits. Do not invent a parallel annotation data model.

### 2. Element Picker Interaction Contract

Model the interaction as an element picker, similar to DevTools inspect mode.

Required states:

- inactive;
- hover candidate;
- ancestor picker open;
- ancestor preview candidate;
- committed element target.

Required interactions:

- hover point -> current DOM element candidate;
- select point or context-click point -> ancestor picker model;
- hover ancestor option -> preview that ancestor's rect;
- commit ancestor option -> structured `element_target` annotation intent.

For V0 this can be a local harness/model plus controlled browser injection
surface. Do not overbuild the final production UI.

### 3. Structured Element Target Record

Committed records should include at least:

- `kind: "element_target"`;
- stable `id`;
- source URL and/or local file path;
- viewport bounds;
- page bounds;
- selector candidates;
- preferred selector;
- XPath if easy and deterministic, otherwise nullable;
- tag name;
- ARIA role;
- accessible name or label when available;
- text excerpt;
- ancestor chain;
- anchor point;
- picker provenance such as `source: "element_picker"` or
  `source: "right_click_badge"`;
- visibility/reveal state;
- nullable later fields for Playwright locator/codegen.

This record should be useful as input to later Employer Brand source target
plans and locator/capture plans.

### 4. Selector Candidate Strategy

Borrow Studio's selector priority, but implement it in AOS terms:

1. stable `id`;
2. stable `data-testid`, `data-test`, `data-cy`, `data-qa`;
3. stable `name`;
4. role + accessible label when both are present;
5. stable class tokens;
6. bounded parent path with `nth-of-type` fallback.

Selectors are candidates, not truth. The final workflow may still require human
review or Playwright/codegen confirmation.

### 5. Controlled Injection Harness

Use a controlled local HTML fixture first. The harness may use Playwright/CDP
injection, but it must be explicit and bounded.

Acceptable V0 execution:

- local HTML fixture only;
- headed or headless browser controlled by existing repo browser tooling or a
  small test harness;
- injected script via Playwright evaluate / CDP `Runtime.evaluate`;
- no arbitrary live website browsing;
- no login/paywall/CAPTCHA/consent bypass;
- no screenshots/captures unless a narrow smoke needs a diagnostic `/tmp`
  image.

The injected script should expose a small state surface, for example
`window.__aosDomElementPickerState`, so tests and Operator can inspect state
without relying on pixels.

### 6. Surface Inspector Compatibility

Surface Inspector should be able to consume the adapter output as projected
annotation targets.

Minimum acceptable compatibility for V0:

- a fixture or live harness payload can be normalized by
  `packages/toolkit/workbench/annotation-projection.js`;
- target records identify the browser page surface distinctly, for example
  `surface_type: "browser_page"`;
- reveal behavior is modeled:
  - visible targets are immediately projectable;
  - offscreen targets are revealable with `scrollIntoView`;
  - unsupported/stale targets report explicit blockers.

Do not require Surface Inspector minimap action controls to work inside live
browser DOM in this slice unless it falls out naturally from the adapter. The
first success criterion is structured DOM intent records.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/canvas-inspector/index.js`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/aos-semantic-targets.md`
- current browser target docs under `docs/design/see-do-grammar-trace-connections.md`
- `src/browser/`

Likely new files:

- `packages/toolkit/workbench/browser-dom-element-picker.js`
- `scripts/browser-dom-element-picker-smoke.mjs`
- `tests/toolkit/browser-dom-element-picker.test.mjs`
- `docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html`
- `docs/design/fixtures/browser-dom-element-picker-v0/element-target-record.json`

## Verification

Run focused tests:

```bash
node --test tests/toolkit/browser-dom-element-picker.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

If a local browser harness is available and bounded, run the smoke against the
controlled fixture and verify:

- hover at a known point returns the expected deepest element;
- ancestor picker model includes the expected parent chain;
- committing a broader ancestor emits an `element_target` record;
- selector candidates include the expected stable selector;
- offscreen/reveal behavior is modeled or explicitly blocked;
- no live website, source capture, or Employer Brand artifact mutation occurs.

## Non-Goals

- no arbitrary live website collection;
- no Employer Brand capture/locator/report/export mutation;
- no final production browser overlay UI;
- no Chrome extension/sidebar revival;
- no broad CDP automation framework;
- no screenshot-pixel oracle;
- no login/paywall/CAPTCHA/consent bypass;
- no Surface-Zoom work.
