# Surface Inspector Annotation Root + Candidate Adapter V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Adjacent foundation issue: https://github.com/michaelblum/agent-os/issues/296
- Adjacent adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Existing UX correction card:
  `docs/design/work-cards/surface-inspector-annotation-mode-ux-corrections-v0.md`
- Existing projection adapter card:
  `docs/design/work-cards/surface-inspector-annotation-reveal-and-projection-adapters-v0.md`
- Existing AOS-owned HTML expression card:
  `docs/design/work-cards/aos-html-workbench-expression-v0.md`
- Existing Pi lessons note:
  `docs/design/pi-computer-use-lessons-for-aos-see-do.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make Annotation Mode root-first and adapter-candidate driven.

When Annotation Mode is active and no root is selected, hovering should identify
window/root candidates only. Clicking a window or AOS root canvas selects that
root and scopes later hover inspection inside it. Once a root is selected,
adapter-specific candidates may appear under the cursor, using a shared
candidate shape that works for native macOS AX, AOS toolkit semantic targets,
AOS-owned HTML surfaces, and later browser seams.

AOS-owned HTML panels and workbench surfaces are allowed in this slice as the
controlled DOM training ground. Arbitrary live browser DOM/CDP piercing remains
out of scope until the explicit browser boundary slice.

## User Decision

The user accepted the root-first recommendation and explicitly accepted
deferring the ultimate browser DOM/CDP boundary until last. They also noted that
many AOS panels are HTML. Treat that as a product constraint:

- AOS-owned HTML surfaces are first-party surfaces and may expose structured DOM
  semantics through toolkit-owned contracts.
- AOS-owned HTML is not the same as arbitrary browser DOM/CDP. It can exercise
  selector, bounds, reveal, and semantic-target behavior without crossing into
  live website inspection.
- Browser chrome, tab frames, and tab content seams may be represented
  conservatively, but page DOM/CDP inspection remains deferred.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/surface-inspector-annotation-mode-ux-corrections-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-reveal-and-projection-adapters-v0.md`
- `docs/design/work-cards/aos-html-workbench-expression-v0.md`
- `docs/design/pi-computer-use-lessons-for-aos-see-do.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
gh issue view 295 --json number,title,state,url,body,labels
gh issue view 296 --json number,title,state,url,body,labels
gh issue view 297 --json number,title,state,url,body,labels
./aos dev recommend --json
```

If Swift/native files will be changed, use the router recommendation before
building. If the work stays in toolkit JS/docs/tests, a full daemon readiness
check may be deferred until the bounded live smoke. If runtime smoke is needed,
run:

```bash
./aos ready
```

## Existing Code To Inspect

- `src/perceive/cursor.swift` - owns the one-shot cursor/window/AX element
  response.
- `src/perceive/ax.swift` - owns AX hit testing, bounds, context path, action
  names, and xray traversal helpers.
- `src/perceive/daemon.swift` - owns live mouse attention events and
  cursor-driven AX/window change emission.
- `src/act/actions.swift` - existing AX actions and execution metadata.
- `src/act/targeting.swift` - existing AX target matching and disambiguation.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - current
  annotation state, scope stack, candidate selection, projection capability
  defaults, reveal result handling, and tree rows.
- `packages/toolkit/workbench/annotation-projection.js` - neutral projection
  result contract.
- `packages/toolkit/workbench/browser-dom-element-picker.js` - controlled DOM
  element picker, selector candidates, target rejection, projection, and reveal.
- `packages/toolkit/workbench/controlled-browser-dom-surface.js` - fixture-only
  controlled DOM publisher for first-party training.
- `packages/toolkit/components/canvas-inspector/index.js` - Surface Inspector UI
  state and action wiring.
- `packages/toolkit/components/canvas-inspector/styles.css` - visual treatment
  for hover/active candidates and annotation controls.
- Relevant tests:
  `tests/toolkit/surface-inspector-annotations.test.mjs`,
  `tests/toolkit/annotation-projection.test.mjs`,
  `tests/toolkit/browser-dom-element-picker.test.mjs`,
  `tests/toolkit/canvas-inspector.test.mjs`,
  `tests/toolkit/canvas-inspector-ax.test.mjs`,
  `tests/aos-semantic-targets-xray.sh`,
  `tests/see-do-state-metadata.sh`.

## Required Behavior

### 1. Root-First Annotation Mode

With Annotation Mode active and no selected root:

- hover highlights only selectable roots, such as visible native windows and AOS
  root canvases;
- the highlight is perimeter-only and ephemeral;
- no descendant element overlays are shown;
- clicking a root selects it and makes the highlight sticky as the active root;
- the selected root becomes the scope for later candidate inspection.

With a selected root:

- hover inside that root asks the appropriate adapter for a candidate under the
  cursor;
- hover outside the selected root clears or switches root candidate state
  according to the current UI model, but does not silently annotate unrelated
  surfaces;
- Escape or an explicit UI control exits Annotation Mode.

Do not make turning Annotation Mode on paint every display or window.

### 2. Shared Annotation Candidate Shape

Introduce or normalize a shared candidate shape for Surface Inspector hover and
pin/comment creation. The implementation may extend current annotation nodes
instead of creating a new schema if that is the smaller correct change.

Each candidate should carry, when known:

- `adapter_id`;
- root id, root label, and root kind;
- subject id and subject path;
- subject kind, role, label, value/text excerpt;
- display-space rect and local-space rect;
- current render/projection status;
- action names and normalized capabilities;
- state id or source event id when available;
- confidence or priority evidence;
- blocker reason when unavailable, unsupported, stale, or rejected;
- source metadata needed to refresh or reacquire.

### 3. Capability-Aware Candidate Ranking

Candidate selection should prefer useful interactive targets over noisy
containers.

Ranking should consider:

- projectable visible rect contains the cursor;
- smaller visible rect before larger ancestor rect;
- adapter priority for AOS toolkit semantic targets and first-party controlled
  DOM targets;
- actionable capabilities such as press, focus, set value, scroll, increment,
  or decrement;
- semantic role and label quality;
- rejection rules for overlays/tooling DOM and giant passive containers.

This should improve the existing `chooseSurfaceInspectorAnnotationCandidate`
behavior rather than replacing it with unrelated logic.

### 4. Native AX Candidate Enrichment

For native macOS AX candidates, enrich the cursor/hit-test payload enough for
Surface Inspector to make a useful hover decision:

- include AX action names when available;
- include normalized capabilities derived from role/actions/attributes;
- include bounds, role, title, label, value, enabled, and context path;
- keep the current privacy posture: explicit cursor/root inspection only, no
  broad hidden background AX harvesting;
- do not claim reveal support for AX descendants unless an existing bounded AX
  scroll/focus path can prove it.

### 5. AOS-Owned HTML As Training Ground

First-party AOS HTML panels, workbench expressions, and controlled fixture pages
may use DOM semantics because AOS owns the surface contract.

Allowed:

- toolkit semantic targets stamped with `data-aos-ref`,
  `data-semantic-target-id`, and related AOS attributes;
- controlled local DOM fixtures such as
  `docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html`;
- DOM `getBoundingClientRect()` and `scrollIntoView()` only inside AOS-owned or
  controlled surfaces;
- selector candidates as metadata for refresh/reacquire inside those controlled
  surfaces.

Not allowed:

- arbitrary live website DOM inspection;
- Chrome DevTools Protocol page piercing;
- Playwright locator promotion for external pages;
- login/paywall/consent bypass;
- treating browser DOM selectors as the only durable anchor.

### 6. Browser Boundary Remains Last

For browser-class windows in this slice:

- native browser chrome can be represented through AX when bounded and visible;
- tab/content viewport seams can be represented conservatively if geometry is
  available;
- page DOM/CDP inspection should report a blocker such as
  `browser_dom_cdp_deferred`;
- no hidden live-page scraping or locator resolution.

### 7. Stale And Reacquire Behavior

Do not draw stale overlays.

When a selected root or candidate changes:

- refresh against current state before projecting;
- if a candidate cannot be found by its direct identity, try bounded reacquire
  using role, label, capabilities, selector/source metadata, and nearest
  previous position where that is adapter-appropriate;
- if reacquire confidence is low, mark the candidate `stale` or `unsupported`
  with a blocker reason instead of painting the old rect.

### 8. Action And Input Semantics

Annotation Mode controls are annotation controls, not pass-through target
clicks by default.

- Click to select root should be consumed by the annotation layer unless an
  explicit pass-through affordance exists.
- Pin/comment controls remain AOS-hosted controls or first-party toolkit
  controls, not injected ad-hoc text buttons inside arbitrary target content.
- Adapter reveal/focus writes should be serialized per selected root when the
  implementation introduces write operations.

## Scope

Primary ownership boundary:

- daemon/native primitive for AX cursor candidate enrichment;
- toolkit workbench for candidate normalization, ranking, projection status, and
  controlled DOM/AOS semantic target behavior;
- toolkit Surface Inspector UI for root selection and hover behavior.

This is platform work. Do not make it Sigil-specific or Employer Brand-specific.

## Hard Boundaries / Non-Goals

- Do not implement arbitrary browser DOM/CDP inspection.
- Do not open live websites for this slice.
- Do not port or resurrect the old Chrome extension/sidebar stack.
- Do not make selectors the sole anchor.
- Do not use screenshot pixels as the structured hit-test oracle.
- Do not move toolkit policy into the daemon. Native hit testing belongs below;
  candidate ranking and annotation UX belong in toolkit.
- Do not resume Employer Brand capture, locator, report, or export work.
- Do not broaden this into snapshot persistence or settings unless a small
  field is required for the candidate contract.

## Suggested Implementation Areas

GDI should inspect first and then choose the narrowest implementation.

Likely first pass:

1. Add tests that define the root-first state transitions and candidate ranking
   expectations.
2. Extend the annotation candidate model/ranking in
   `surface-inspector-annotations.js`.
3. Extend native AX cursor hit-test payloads if needed for capability-aware
   candidates.
4. Wire Surface Inspector UI so no-root mode highlights roots only, while
   selected-root mode asks adapters for inner candidates.
5. Reuse the existing controlled browser DOM fixture only as a first-party DOM
   training surface.

## Verification

Start with deterministic tests:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/canvas-inspector-ax.test.mjs
git diff --check
```

If Swift/native candidate payloads change, run the router first and then build
through the canonical surface:

```bash
./aos dev recommend --json
./aos dev build
bash tests/see-do-state-metadata.sh
bash tests/aos-semantic-targets-xray.sh
```

If `./aos ready` passes, run one bounded live smoke:

1. Launch Surface Inspector.
2. Enable Annotation Mode.
3. Confirm no-root hover highlights windows/root canvases only.
4. Click one AOS root canvas or window to select it.
5. Move inside the selected root and confirm exactly one scoped candidate
   overlay appears.
6. Confirm AOS-owned HTML/control surfaces can expose first-party semantic or
   controlled DOM candidates.
7. Confirm external browser page DOM/CDP reports deferred/unsupported rather
   than piercing the page.

If readiness is blocked, report the concrete blocker and rely on deterministic
tests.

## Completion Report

Report back with:

- files changed;
- root-selection behavior implemented;
- candidate contract fields added or normalized;
- AX capability enrichment status;
- AOS-owned HTML / controlled DOM fixture status;
- explicit browser DOM/CDP deferred behavior;
- exact tests run and results;
- live smoke result or readiness blocker;
- any unrelated dirty state left untouched;
- recommended follow-up slice.
