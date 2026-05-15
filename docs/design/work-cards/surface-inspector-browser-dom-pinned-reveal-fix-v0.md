# Surface Inspector Browser DOM Pinned Reveal Fix V0

## Tracker

- Parent Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related human intent tracker: https://github.com/michaelblum/agent-os/issues/294
- Follows:
  `docs/design/work-cards/surface-inspector-controlled-browser-dom-projection-v0.md`

## Goal

Fix the remaining Surface Inspector browser DOM integration gap found by
Operator: pinned `browser_page` / `element_target` annotations are projectable
and can be pinned, but SI reveal controls call reveal with the annotation
wrapper instead of the raw browser DOM target payload. As a result, SI returns
`target_absent` for pinned DOM targets even though the controlled browser adapter
can reveal the same targets directly.

Keep this as a narrow Surface Inspector reveal repair. Do not continue Employer
Brand alignment/capture/report work in this slice.

## Operator Evidence

Operator verified the controlled Browser DOM projection path:

- local fixture only:
  `docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html`;
- deterministic smoke passed with `local_fixture_only`,
  `late_attach_replayed`, `hero_card_projectable`, `offscreen_revealed`, and
  `tooling_dom_not_published`;
- Surface Inspector discovered browser DOM targets through request/replay after
  SI launched;
- the hero target pinned as:
  - `kind: "element_target"`;
  - `surface_type: "browser_page"`;
  - `adapter_id: "aos-browser-dom-element-picker"`;
  - selector `[data-testid="hero-card"]`;
  - projection precision `browser_dom_element`;
- raw controlled browser adapter reveal worked:
  - hero returned `already_visible`;
  - `#offscreen-target` returned `revealed` after `scrollIntoView`;
- SI reveal controls failed for pinned browser DOM targets:
  - hero returned `target_absent`;
  - `#offscreen-target` returned `target_absent`;
  - likely cause: pinned annotation passes a wrapper node into `revealTarget`
    instead of the raw DOM target metadata.

## Required Behavior

### 1. Preserve Raw Browser DOM Target Payload For Pins

When SI turns a browser DOM target into a frame anchor/pin, the pin must preserve
enough raw target data for reveal:

- `preferred_selector`;
- `selector_candidates`;
- `xpath` if present;
- `surface_id`;
- `surface_type: "browser_page"`;
- `kind: "element_target"`;
- source URL/path;
- browser DOM visibility/reveal metadata;
- projection precision `browser_dom_element`.

Do not rely only on the SI wrapper subject id or label. The adapter needs the
same selector-bearing payload that the controlled browser publisher emitted.

### 2. Reveal Must Unwrap Browser DOM Pins Before Dispatch

`revealAnnotationTarget(...)` and the eval payload sent to the owner canvas must
detect browser DOM pins and pass a reveal target that the controlled browser DOM
publisher can resolve.

Acceptable implementation shapes:

- normalize a reveal payload from `pin.source_tree_node_metadata` when
  `adapter_id` is `aos-browser-dom-element-picker`;
- preserve the raw target under a stable field such as
  `source_tree_node_metadata.raw_target` and prefer it for reveal;
- add a small helper that converts a Surface Inspector pin into an
  adapter-specific reveal payload.

Required result:

- the owner canvas receives a payload with selector fields at the top level
  and/or in the documented metadata location that
  `controlled-browser-dom-surface.js` can resolve;
- no DOM selector is invented by SI;
- no fake selector is added when the original target lacks one.

### 3. SI Reveal Results Match Raw Adapter Results

For the controlled local fixture:

- revealing pinned hero card target must return `already_visible`;
- revealing pinned `#offscreen-target` must return `revealed` and update the
  pin projection to a visible/current projection;
- stale/missing DOM target still returns `target_absent` with an explicit
  blocker;
- unsupported targets still return `unsupported`, not a successful reveal.

### 4. Keep Browser DOM Projection Semantics Intact

Do not regress:

- late attach request/replay;
- `browser_page` semantic target ingestion;
- hero target projectability;
- offscreen target revealability;
- tooling DOM rejection;
- annotation mode frame anchor/comment cleanup;
- passive minimap behavior.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/components/surface-inspector/index.js`
  - `buildSurfaceInspectorTargetNodeForAnnotation`;
  - `revealAnnotationTarget`;
  - `buildRevealTargetEvalScript`;
- `packages/toolkit/workbench/controlled-browser-dom-surface.js`
  - `revealTarget`;
  - selector resolution helper;
- `packages/toolkit/workbench/browser-dom-element-picker.js`
  - committed `element_target` record shape;
- `packages/toolkit/workbench/annotation-projection.js`;
- `tests/toolkit/surface-inspector.test.mjs`;
- `tests/toolkit/browser-dom-element-picker.test.mjs`;
- `scripts/browser-dom-element-picker-surface-smoke.mjs`.

Add a focused unit test that reproduces the Operator failure: build/pin a
browser DOM target through SI state, ask SI reveal to create the payload, and
assert the controlled browser publisher receives/resolves selector-bearing DOM
target metadata rather than only a wrapper subject.

If existing helpers make full `revealAnnotationTarget` hard to unit-test,
extract a small pure helper for "pin -> reveal payload" and test that helper.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/browser-dom-element-picker.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
node scripts/browser-dom-element-picker-surface-smoke.mjs --stdout
git diff --check
```

If `./aos ready` passes, run a bounded AOS smoke:

1. launch the controlled local browser DOM fixture publisher;
2. launch Surface Inspector after it;
3. verify late attach discovers browser DOM targets;
4. pin the hero card target and reveal it through SI, expecting
   `already_visible`;
5. pin or select `#offscreen-target` and reveal it through SI, expecting
   `revealed`;
6. clear annotations and verify SI remains open, pins/comments are zero, and no
   source files changed.

## Non-Goals

- no arbitrary live websites;
- no Employer Brand capture, locator, report, export, or data-bundle mutation;
- no broad browser automation framework;
- no screenshot-pixel oracle;
- no Chrome extension/sidebar revival;
- no Surface-Zoom work;
- no new annotation interaction model beyond the reveal fix.
