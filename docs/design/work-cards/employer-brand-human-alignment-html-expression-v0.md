# Employer Brand Human Alignment HTML Expression V0

## Tracker

- Related HTML expression issue: https://github.com/michaelblum/agent-os/issues/301
- Related HTML expression epic: https://github.com/michaelblum/agent-os/issues/300
- Related Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related human intent tracker: https://github.com/michaelblum/agent-os/issues/294

## Goal

Make the Employer Brand Audit Human Alignment Pack available as a first-class
HTML Workbench Expression so Operator and the human can review the real
alignment artifact through the canonical Surface Inspector path.

The existing HTML Workbench Expression V0 proves Markdown work-cards. This slice
should extend the same neutral expression contract to the existing human
alignment pack:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`

Markdown remains canonical. The generated HTML expression is a rich review,
annotation, Mermaid, semantic-target, and checkpoint surface only.

## Why Now

The controlled HTML work-card expression and Surface Inspector semantic-target
flows now pass:

- late Surface Inspector attach discovers semantic targets from an already-open
  HTML expression surface;
- semantic targets expose `can_reveal=true`;
- reveal works for offscreen targets;
- SI can create a semantic pin and comment;
- annotation state clears cleanly.

The next useful step is to move from the synthetic #301 work-card fixture to the
actual Employer Brand human alignment artifact before resuming more capture
work.

## Required Work

### 1. Artifact Kind Extension

Extend the HTML Workbench Expression metadata contract narrowly so it can
represent a human-facing alignment pack.

Acceptable artifact kind:

- `human_alignment_pack`

Keep the existing `work_card` support unchanged.

Do not generalize to arbitrary HTML or arbitrary Markdown artifact classes in
this slice. Add only the kind needed for this review path.

### 2. Builder / CLI Support

Update the builder and CLI so the caller can generate an HTML expression from
the Employer Brand alignment Markdown with:

- source kind: `markdown`
- artifact kind: `human_alignment_pack`
- source path:
  `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`
- deterministic timestamp for checked-in fixtures
- generated metadata + HTML fixture

The existing work-card fixture must remain deterministic.

### 3. Generated Fixture

Add deterministic generated expression fixtures for the alignment pack.

Suggested location:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.expression.json`

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.expression.html`

If a different location better matches existing fixture conventions, use that
and document it in the test/doc update.

The expression must preserve semantic targets/source-map entries for the main
human decision areas, including at least:

- `current-assumptions`
- `companies-and-competitor-set`
- `source-categories-and-page-types`
- `desired-evidence-elements-and-expected-clip-counts`
- `what-not-to-collect`
- `kilos-interpretation`
- `source-trust-and-inaccessible-source-policy`
- `report-tone-and-direction`
- `explicit-human-decision-points`

The Mermaid evidence-flow block must remain preview-safe and represented in
`mermaid_blocks` metadata.

### 4. Launch / Smoke Path

Ensure the existing HTML Workbench Expression launch helper can launch this
new expression fixture without a special script.

Surface Inspector should be able to see semantic targets after launch, using the
already-corrected semantic-target request/replay path.

### 5. Docs / Tests

Update docs/api or nearby fixture documentation enough that future Operator/GDI
sessions know how to launch the Employer Brand alignment expression.

Add focused tests proving:

- `artifact_kind: "human_alignment_pack"` schema-validates;
- existing `work_card` fixture still schema-validates;
- generated alignment expression fixture is deterministic;
- required decision-area semantic targets exist;
- the Mermaid block is preserved safely;
- generated HTML still strips unsafe source-authored script/link behavior
  through the existing shared renderer path.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/schemas/aos-html-workbench-expression-v0.test.mjs
node --test tests/toolkit/markdown-render.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
bash tests/help-contract.sh
git diff --check
```

Run a bounded AOS smoke if `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.expression.json
```

Smoke expectations:

- HTML expression launches and is readable;
- Mermaid flow is present as a safe preview/fallback;
- Surface Inspector sees semantic targets for the required decision areas;
- at least `companies-and-competitor-set` and
  `explicit-human-decision-points` report reveal capability and reveal
  successfully;
- no source Markdown is mutated.

## Non-Goals

- Do not resume Employer Brand live capture, locator repair, URL opening,
  crawling, report rendering, export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics,
  or data bundles.
- Do not convert Markdown to canonical HTML.
- Do not migrate existing Markdown docs.
- Do not add arbitrary source-authored JavaScript execution.
- Do not add new Surface-Zoom annotation behavior.
- Do not add minimap action controls.
