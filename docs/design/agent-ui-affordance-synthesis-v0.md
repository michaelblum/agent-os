# Agent UI Affordance Synthesis V0

Durable report for analyst review.

Prepared from repo state around
`implementer/sigil-context-menu-compact-surface-lifecycle-extraction-v0` at
`f38768bd62e45245fe83e9881ca0d5b81da76c75`, with the PR #397 stack already
accepted through the pure snapshot projection correction.

## 1) Project Snapshot

- Name: Agent OS (AOS)
- Mission: Make computer-use surfaces visible, addressable, and safely
  operable by agents through AOS-native primitives rather than screenshot-only
  or ad hoc JavaScript paths.
- Core functions/tech: AOS daemon canvas primitives; toolkit surfaces and
  panels; Sigil as an opinionated app/consumer; semantic DOM/ARIA metadata;
  AX/xray capture; Surface Inspector; workbench/annotation projection;
  `see -> do -> see` verification loops.
- Analysis goal: Synthesize current UI-affordance schemes into a candidate
  canonical "agent-readable UI target" direction without regressing into older
  selector-first, screenshot-first, or duplicated vocabulary designs.
- Standards/protocols discovered:
  - Toolkit `normalizeSemanticTarget(...)` already centralizes role/name/ref,
    surface, state, and frame normalization for semantic targets
    (`packages/toolkit/runtime/semantic-targets.js`).
  - Toolkit panel forms already expose normalized control records for agent
    operation through `getControlRecords()` and `getControlRecord()`
    (`packages/toolkit/panel/form.js`).
  - Sigil compact controls now reuse the toolkit semantic target normalizer and
    publish AOS-native records through context-menu snapshots
    (`apps/sigil/avatar-editor/compact-surface.js`,
    `apps/sigil/context-menu/snapshot-projection.js`).
  - Surface Inspector and annotation projection consume richer adapter evidence
    with `adapter_id`, `subject_id`, projection geometry, blockers, reveal
    capability, and source metadata
    (`packages/toolkit/workbench/annotation-projection.js`,
    `packages/toolkit/components/surface-inspector/index.js`).
  - Accessibility guidance says AX/ARIA roles and names are the default control
    model; AOS metadata carries routing identity, not a separate visible
    agent language (`docs/guides/aos-app-accessibility-surfaces.md`).
- Confidence level: high, because the core synthesis is grounded in current
  code paths and tests, while older GitHub issues are treated only as historical
  signals.

## 2) Material Digest

### Material A: User brief, "Agent UI Affordances"

- Source: pasted user brief in Foreman session.
- Type: note.
- Key claims:
  - Existing schemes are conceptually converging but not unified.
  - Natural target is an AOS-native UI target record shaped like AX node plus
    DOM metadata plus AOS action contract.
  - Candidate fields: stable `id/ref`, `role`, `name`, `frame`, `state`,
    `surface`, `source`, and action hints.
  - `normalizeSemanticTarget(...)` or a sibling normalizer should become the
    canonical choke point.
- Why it might matter: The brief identifies the exact architectural pressure
  exposed by recent Sigil work: agents need a stable target/action contract,
  not merely better DOM attributes or one app-specific control record.
- Evidence quality: strong as a synthesis prompt; it matches the current code
  shape in toolkit forms, Sigil compact records, and annotation adapters.

### Material B: Toolkit semantic target runtime

- Source: `packages/toolkit/runtime/semantic-targets.js` and
  `tests/toolkit/runtime-semantic-targets.test.mjs`.
- Type: code and tests.
- Key claims:
  - `normalizeSemanticTarget(...)` requires an id, maps AX roles to web roles,
    normalizes frame-like inputs, derives `aosRef`, and preserves state fields
    such as enabled/current/pressed/selected/checked/expanded/value.
  - Attribute helpers stamp `aria-label`, `data-aos-ref`,
    `data-aos-surface`, `data-semantic-target-id`, `data-aos-action`, and
    related ARIA state.
  - Tests assert no implicit action identity default, stable ref derivation,
    AX role normalization, and stale optional attr removal.
- Why it might matter: This is the closest existing producer-side choke point.
  It should remain the small canonical normalization core or become the base for
  a sibling target normalizer.
- Evidence quality: strong; behavior is directly covered by tests.

### Material C: Toolkit panel form control records

- Source: `packages/toolkit/panel/form.js` and
  `tests/toolkit/panel-form.test.mjs`.
- Type: code and tests.
- Key claims:
  - `controlRecordFor(...)` builds on `normalizeSemanticTarget(...)`, adds
    `descriptor_id`, `field_id`, `ref`, `kind`, `options`, `hidden`, and
    action hints such as `select`, `drag`, `set-value`, `open`, `toggle`,
    `focus`.
  - Tests verify records are usable for agent operation, including ref shape,
    role, name, value, options, and option frames.
- Why it might matter: This is the strongest current "agent can operate this
  control" API, but it is still form/control-specific. It should inform the
  action-hints part of the canonical target, not become the whole model.
- Evidence quality: strong; explicit tests cover record payloads.

### Material D: Sigil compact control records and context-menu snapshots

- Source: `apps/sigil/avatar-editor/compact-surface.js`,
  `apps/sigil/context-menu/snapshot-projection.js`,
  `apps/sigil/context-menu/menu.js`, and focused renderer tests.
- Type: code and tests.
- Key claims:
  - Sigil compact tabs and controls expose normalized records with stable
    `ref === surface:id`, roles, names, values, frames, state, and actions.
  - Context-menu snapshot projection now exposes compact records through a pure
    `buildContextMenuSnapshot(menuState, compactSurface)` seam.
  - Recent real-input tests treat DOM selector fallback as a broken-contract
    signal for controls instead of the normal path.
- Why it might matter: This is the best current vertical slice proving the
  target model can make a complex rendered UI more agent-readable without
  giving agents arbitrary DOM spelunking as the primary contract.
- Evidence quality: strong; compact records and snapshot payloads are covered
  by deterministic tests and recent Foreman/Implementer verification.

### Material E: Surface Inspector and annotation projection consumers

- Source: `packages/toolkit/components/surface-inspector/index.js`,
  `packages/toolkit/workbench/annotation-projection.js`, and
  `tests/toolkit/annotation-candidates.test.mjs`.
- Type: code and tests.
- Key claims:
  - Surface Inspector stores per-canvas semantic targets and converts them into
    annotation projection evidence.
  - `buildSemanticTargetProjectionAdapterResult(...)` normalizes semantic
    target payloads into adapter evidence with `adapter_id`,
    `subject_id`, `subject_path`, `root_id`, render status, reveal capability,
    projection rects, local rects, clip/scroll chains, blockers, and source
    metadata.
  - Candidate ranking prefers specific visible actionable semantic targets over
    passive containers and blocked candidates.
- Why it might matter: This is the main consumer-side proof that the canonical
  record needs both operation fields and projection/diagnostic fields. A
  narrow form-control schema would be insufficient.
- Evidence quality: strong; adapter normalization and ranking have tests.

### Material F: Workbench semantic targets

- Source: `packages/toolkit/workbench/html-workbench-expression.js`,
  `packages/toolkit/components/markdown-workbench/index.js`, and
  `docs/api/toolkit/workbench.md`.
- Type: code and docs.
- Key claims:
  - Workbench surfaces emit semantic targets for document structure, controls,
    source lines, sections, annotations, and generated artifacts.
  - Some workbench paths still hand-stamp attributes and sidecar target
    metadata rather than flowing through one target-record normalizer.
- Why it might matter: Workbench broadens the target universe beyond controls:
  document regions, generated artifacts, source ranges, and annotation anchors
  all need target identity and projection without necessarily being directly
  actionable.
- Evidence quality: mixed to strong; the pattern is real, but not all paths use
  the same normalizer today.

### Material G: Older issues and design notes

- Source: GitHub issues #164, #223, #297, #136; design docs
  `docs/design/see-do-grammar-trace-connections.md`,
  `docs/guides/aos-app-accessibility-surfaces.md`,
  `docs/design/browser-capture-ladder-projection.md`.
- Type: historical roadmap/context.
- Key claims:
  - #164 wants a Playwright-shaped target/ref dialect over canonical AOS
    primitives.
  - #223 owns broad surface-system architecture.
  - #297 owns annotation projection and subject-address adapters.
  - #136 tracks structured DOM perception for AOS canvases.
- Why it might matter: These are useful lenses but dangerous as direct owners.
  They predate several current strict-contract moves and can invite regression
  if interpreted as a license to add aliases, selector-first addressing, or a
  second semantic vocabulary.
- Evidence quality: mixed; good strategic context, not current implementation
  authority.

## 3) Relevance Matrix

| Signal | Mission fit | Technical fit | Workflow fit | Risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| Use AX/ARIA-like `role/name/state` plus AOS `ref/action/surface` | High: matches agent-readable surfaces | High: current normalizer already does most of this | High: familiar to models and tests | Low if kept canonical | High |
| Make `normalizeSemanticTarget(...)` the base or parent normalizer | High | High for producer-side records | Medium: consumers still need richer projection fields | Medium: overloading it could make it too broad | High |
| Add sibling `normalizeAgentUiTarget(...)` | High | High: can compose semantic target plus operation/projection fields | High: gives adapters one payload | Medium: new schema churn if premature | Medium-high |
| Treat toolkit form records as the universal model | Medium | Medium: excellent for controls | Medium: bad fit for document/AX/root subjects | High: narrows the world to forms | High |
| Treat Surface Inspector adapter evidence as the universal producer model | Medium | Medium: excellent for projection/diagnostics | Medium: too consumer-heavy for simple controls | High: leaks annotation-specific terms upstream | High |
| Keep selectors as primary target refs | Low | Low: conflicts with stable AOS refs | Low: brittle replay | High regression risk | High |
| Keep DOM selector fallback as broken-contract evidence | High | High: matches recent Sigil tests | High: forces real target records | Low | High |
| Generalize from current Sigil compact-control proof | High | High: current code and tests are strong | High: practical vertical slice | Medium: app-specific vocabulary may leak upward | High |
| Revive older issue language directly | Medium | Mixed | Mixed | High: could restore aliases/shims or broad grab-bag scope | High |

## 4) Cross-Source Threads

### Common Themes

- Stable identity is the center of gravity. Current working contracts prefer
  `id`, `aosRef`/`ref`, `surface`, canvas/root identity, and descriptor ids over
  transient DOM selectors.
- The canonical record has to serve two adjacent but distinct loops:
  perception/reveal/annotation and direct operation.
- AX/ARIA vocabulary is the right semantic base because agents and operating
  systems already understand `role`, `name`, `value`, and state.
- AOS-specific data should describe routing and ownership: `ref`, `surface`,
  parent canvas/root, descriptor id, action ids, source/provenance.
- Geometry must be explicit and coordinate-space-labeled. Producer-local
  `frame` is not enough for Surface Inspector; consumer-side adapters also need
  display-space projection, clipping, scroll/reveal state, and blocker reasons.
- Tests are already pulling the repo toward strict contracts: missing stable ids
  throw, fallback selectors are called out, and action hints are explicit.

### Contradictions Or Tension

- `normalizeSemanticTarget(...)` is intentionally small, but the desired
  canonical record spans source provenance, action affordances, projection
  status, and fallback/blocker evidence. Expanding the existing function too
  far could make the clean base normalizer harder to trust.
- Toolkit form records are actionable but not universal. Workbench headings,
  annotation anchors, native AX windows, browser content seams, and canvas roots
  are targets even when they are not form controls.
- Surface Inspector adapter results are universal enough for projection and
  diagnostics, but too annotation-heavy to be the producer-side target record.
- Older issue #164 frames a Playwright-shaped dialect, but the current repo
  standard is still canonical `see/do/show/tell/listen`. A familiar dialect can
  be ergonomic sugar only after the underlying AOS target record is stable.

### Non-Obvious Implications

- The repo probably needs a two-layer contract:
  - Producer record: "agent UI target" emitted by DOM/toolkit/Sigil/workbench
    code.
  - Projection adapter result: "current subject projection" consumed by
    Surface Inspector and annotation mode.
- `normalizeSemanticTarget(...)` should stay the semantic base. A sibling like
  `normalizeAgentUiTarget(...)` can add `descriptor_id`, `actions`, `source`,
  `owner`, `coordinate_space`, `projection`, and blocker/fallback metadata
  without bloating the current small helper.
- `ref` should remain the canonical action address. Selectors, XPath, DevTools
  paths, and DOM attrs are evidence or reveal hints, not first-class identity.
- Sigil compact controls are the best near-term proof fixture because they
  already combine toolkit form records, app descriptors, context-menu snapshots,
  real-input expectations, and strict fallback handling.
- A model-friendly record should resemble AX/DOM but should not pretend that
  AX, DOM, and canvas targets have identical lifecycle guarantees.

## 5) Actionable Moves

### Now (0-3 Days)

- Action: Use this report as the advisor packet and ask for schema critique
  before coding.
  - Why: The next risk is premature implementation of the wrong abstraction.
  - Estimated effort: S.
  - Expected impact: high.

- Action: Park the idea against #164 only as "underlying target record needed,"
  not as a commitment to top-level Playwright-style aliases.
  - Why: At the time of writing, #164 was the closest strategic owner, but it
    contained older dialect language that can regress the current strict
    `see/do` discipline. Query GitHub before treating it as the current owner.
  - Estimated effort: S.
  - Expected impact: medium.

- Action: Write a tiny ADR/design sketch for `aos-agent-ui-target-v0` before
  changing code.
  - Why: The shape crosses toolkit, Sigil, Surface Inspector, workbench, and
    daemon perception; it needs an explicit boundary.
  - Estimated effort: S.
  - Expected impact: high.

### Next (1-2 Weeks)

- Action: Route a Implementer audit card to produce a mapping table and JSON fixtures
  for five current producers/consumers:
  `normalizeSemanticTarget`, toolkit form records, Sigil compact records,
  Surface Inspector adapter candidates, and workbench semantic targets.
  - Why: This is machine-checkable and prevents schema design from being based
    on one subsystem.
  - Estimated effort: M.
  - Expected impact: high.

- Action: Prototype a sibling normalizer such as
  `normalizeAgentUiTarget(record, options)` in toolkit runtime, backed by
  fixtures rather than live UI.
  - Why: Keeps the base semantic target helper small while adding action,
    source, and projection-friendly fields.
  - Estimated effort: M.
  - Expected impact: high.

- Action: Convert one producer at a time to the sibling normalizer, starting
  with toolkit panel form records or Sigil compact records.
  - Why: These are already close to the desired shape and have focused tests.
  - Estimated effort: M.
  - Expected impact: medium-high.

- Action: Add a Surface Inspector adapter test that consumes the new canonical
  record without losing blocker/reveal/projection behavior.
  - Why: The consumer side is where schema simplification can accidentally hide
    stale, clipped, unsupported, or offscreen targets.
  - Estimated effort: M.
  - Expected impact: high.

### Later (Backlog)

- Action: Thread canonical target records into `aos see` outputs and `aos do`
  target resolution.
  - Why: The record becomes operational only when the see/do loop can consume
    it directly.
  - Estimated effort: L.
  - Expected impact: high.

- Action: Revisit #164's Playwright-shaped dialect after target records are
  stable.
  - Why: Ergonomic aliases are safe only when they route through the canonical
    AOS target/action contract.
  - Estimated effort: M.
  - Expected impact: medium.

- Action: Add browser DOM and native AX adapters as peer evidence sources, not
  primary schema owners.
  - Why: Browser/AX records need selector and platform evidence, but AOS should
    not become selector-first or AX-only.
  - Estimated effort: L.
  - Expected impact: high.

## 6) Open Questions

- Unknown: Should the canonical target record include projection fields directly
  or nest them under `projection`?
  - Validation step: Compare a toolkit form control, a Sigil tab, a workbench
    heading, a native AX button, and a browser DOM candidate as fixtures.

- Unknown: Should `name` and `label` both exist?
  - Validation step: Use AX/ARIA naming as the public semantic field (`name`)
    and reserve `label` as source metadata unless existing consumers require
    both.

- Unknown: How should action hints be represented?
  - Validation step: Map current action arrays (`select`, `toggle`, `drag`,
    `set-value`, `open`, `focus`) to AOS `do` verbs and identify gaps.

- Unknown: How much descriptor-specific data belongs in the canonical record?
  - Validation step: Audit `descriptor_id`, `field_id`, object ids, source line,
    and annotation anchor fields, then classify as core, extension, or metadata.

- Unknown: Should target records include children?
  - Validation step: Test flat records with `parent_ref`/`owner_path` first.
    Add `children` only where a producer can preserve stable hierarchy without
    duplicating large trees.

- Unknown: Where should fallback evidence live?
  - Validation step: Preserve `fallback`/`blocker_reason` style fields as
    explicit diagnostics and forbid silent fallback in operation-critical tests.

## 7) Core Output Payload

### Executive Summary

- The repo is already converging on an AOS-native agent UI target record, but
  the convergence is distributed across semantic target attrs, toolkit form
  records, Sigil compact control records, workbench targets, and Surface
  Inspector adapter evidence.
- The safest center is `normalizeSemanticTarget(...)` as the semantic base,
  with a sibling normalizer for the broader `agent UI target` contract rather
  than turning one helper into an everything schema.
- Toolkit form records provide the strongest action-hint model; Surface
  Inspector/annotation adapters provide the strongest projection, blocker, and
  reveal model; Sigil compact controls provide the strongest current vertical
  proof.
- The most important regression guard is to keep stable AOS refs as primary
  identity. Selectors, XPath, raw DOM paths, screenshot pixels, and `show eval`
  should stay fallback/provenance/diagnostic paths.
- Older issues are useful context but should not be treated as implementation
  authority. In particular, #164 should not be read as permission to add a
  second semantic vocabulary before the canonical target record is stable.

### Ranked Opportunities

1. Define `aos-agent-ui-target-v0` as a small schema/ADR with identity,
   semantics, state, action hints, geometry, source, and diagnostics.
2. Build a cross-codebase mapping table and fixture pack from current producers
   and consumers.
3. Add a sibling normalizer in toolkit runtime and migrate one existing producer
   under tests.
4. Teach Surface Inspector/annotation projection to consume the canonical record
   while preserving projection-specific blocker and reveal semantics.
5. Only then revisit command ergonomics and Playwright-shaped aliases.

### Recommended Next Action

Ask the analyst advisor to pressure-test this boundary:

```text
Should AOS define a two-layer UI target model: a producer-side
`agent_ui_target` record built on AX/ARIA semantics plus AOS identity/action
fields, and a consumer-side projection adapter result that adds current
display-space geometry, clipping, reveal/blocker state, and provenance?

Please challenge whether `normalizeSemanticTarget(...)` should grow into this
or stay as the semantic base for a sibling `normalizeAgentUiTarget(...)`.
Also identify regression traps from older #164/#223/#297/#136 language,
especially selector-first addressing, duplicated semantic vocabularies, and
Surface Inspector-specific concepts leaking into producer records.
```

## 8) Optional Format Adapters

### Advisor Brief

Heading: AOS Agent UI Affordances: Current Convergence And Regression Traps

Starter:

```text
The codebase is converging on an agent-readable UI target record, but the
contract is spread across five working systems: toolkit semantic targets,
toolkit panel form control records, Sigil compact control records, Surface
Inspector/annotation projection adapters, and workbench semantic targets.

The strongest current hypothesis is a two-layer model. Producer records should
look familiar to models and accessibility systems: stable id/ref, role, name,
value, state, frame, surface, source, and action hints. Consumer projection
records should add adapter id, subject/root paths, display-space projection,
clip/scroll/reveal evidence, blockers, and provenance.

The key review question is whether `normalizeSemanticTarget(...)` should be
expanded or preserved as the base helper for a sibling
`normalizeAgentUiTarget(...)`. The key regression risk is reviving older issue
language as selector-first or alias-heavy design before the canonical target
record is stable.
```

### Issue Comment Draft

Title: Agent UI target record synthesis

Problem:

```text
AOS has multiple partially overlapping UI-affordance records: semantic target
attrs, toolkit form control records, Sigil compact records, Surface
Inspector/annotation adapter candidates, and workbench semantic targets. They
are converging but not yet one stable target/action contract.
```

Proposal:

```text
Define `aos-agent-ui-target-v0` as a producer-side canonical target record
built on `normalizeSemanticTarget(...)`, plus a separate projection adapter
result for Surface Inspector/annotation consumers. Use current code fixtures to
map fields before changing runtime behavior.
```

Acceptance criteria:

```text
- Mapping table covers toolkit semantic targets, panel form records, Sigil
  compact records, Surface Inspector adapter candidates, and workbench targets.
- Schema distinguishes stable identity/action fields from selector/provenance
  hints and projection-only fields.
- Tests prove selector fallback remains diagnostic, not the primary action
  contract.
```

## 9) Sources

- User-provided "Brief: Agent UI Affordances" in Foreman chat.
- `packages/toolkit/runtime/semantic-targets.js`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `packages/toolkit/panel/form.js`
- `tests/toolkit/panel-form.test.mjs`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `apps/sigil/context-menu/compact-surface-session.js`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/context-menu-snapshot-projection.test.mjs`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- `packages/toolkit/workbench/html-workbench-expression.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `docs/api/toolkit/workbench.md`
- `docs/guides/aos-app-accessibility-surfaces.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `docs/design/browser-capture-ladder-projection.md`
- GitHub issue #164: Define Playwright-shaped AOS target/ref dialect.
- GitHub issue #223: Epic: AOS Surface System.
- GitHub issue #297: Annotation projection and subject-address adapters.
- GitHub issue #136: Add structured DOM perception for AOS canvases.
