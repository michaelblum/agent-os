# AOS HTML Workbench Expression V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/300
- Active issue: https://github.com/michaelblum/agent-os/issues/301
- Related Surface Annotation tracker: https://github.com/michaelblum/agent-os/issues/294
- Related Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related Human Intent epic: https://github.com/michaelblum/agent-os/issues/141
- Related control-surface epic: https://github.com/michaelblum/agent-os/issues/129
- Related evidence workflow tracker: https://github.com/michaelblum/agent-os/issues/293

## Goal

Add HTML Workbench Expressions as a first-class human-facing projection for rich
AOS artifacts, starting with Markdown-authored work-cards.

The important architecture rule is:

- Markdown remains the durable source expression for work-cards and prose docs.
- JSON remains the canonical machine-readable expression for schemas, bundles,
  manifests, and audit data.
- HTML becomes the default rich workbench expression for human review,
  annotation, Mermaid diagrams, semantic targets, checkpoint interaction, and
  two-way intent alignment.

This slice should prove the pattern with work-cards. It should not migrate old
Markdown files, replace JSON contracts, or build a broad report renderer.

## Why

Recent Surface Inspector and Employer Brand alignment work exposed the cost of
using Markdown preview geometry as the interaction substrate. Synthetic
line-based bounds and fake document rectangles create fragile annotation and
reveal behavior. HTML already has a real layout tree, section anchors, semantic
attributes, scroll ancestors, focusable controls, and `getBoundingClientRect()`
projection.

For AOS, the practical target is not "HTML instead of Markdown." It is:

1. author and diff simple source files;
2. render those source files into annotation-ready HTML expressions;
3. let humans and agents align intent on the rendered surface;
4. export structured decisions, annotations, or source patches.

## Existing Code To Inspect

Start with:

- `packages/toolkit/markdown/render.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `packages/toolkit/components/artifact-bundle-workbench/index.js`
- `packages/toolkit/workbench/human-checkpoint.js`
- `packages/toolkit/workbench/markdown-spatial-subject-tree.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/annotation-perception-verification.js`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `docs/recipes/layered-subject-expressions.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/api/toolkit.md`
- Markdown Workbench tests under `tests/toolkit/markdown-*`
- workbench checkpoint tests under `tests/toolkit/workbench-human-checkpoint.test.mjs`

## Scope

Implement the first bounded expression path:

- source: a Markdown work-card file;
- expression: generated safe HTML plus structured metadata;
- host: AOS workbench surface/canvas;
- review: annotation-ready semantic targets and checkpoint/resume payloads;
- export: structured sidecar/patch suggestion, not automatic source mutation.

Likely implementation areas:

- `packages/toolkit/workbench/` for a neutral expression builder/helper;
- `packages/toolkit/components/` for a small HTML workbench expression surface,
  or a narrow extension to Markdown Workbench if that is clearly less invasive;
- `shared/schemas/` for a first-class HTML expression metadata schema if needed;
- `scripts/` for a CLI that builds/opens/validates an expression;
- `docs/api/toolkit.md` for the contract;
- focused tests.

Do not make this Employer Brand-specific.

## Contract

Add a neutral HTML Workbench Expression contract. It may be a schema, docs
contract, fixture shape, or combination, but tests must exercise the contract as
data.

Minimum expression metadata:

- schema id and version;
- expression id;
- source kind, initially `markdown`;
- source path;
- source content hash or equivalent deterministic revision marker;
- generated at timestamp;
- artifact kind, initially `work_card`;
- expression HTML path or inline HTML fixture path;
- semantic targets list;
- source map list;
- Mermaid block list;
- annotation/checkpoint capability flags;
- security/sandbox policy;
- export/resume behavior.

Each semantic target should include:

- target id;
- `data-aos-ref`;
- role/kind, such as `document`, `section`, `heading`, `decision`,
  `checklist_item`, `mermaid_block`, or `code_block`;
- accessible label;
- source path;
- source line start/end when known;
- CSS selector or DOM anchor id in the generated HTML;
- annotation eligibility;
- reveal eligibility.

## Markdown Work-Card Adapter

Build an adapter that turns a Markdown work-card into an HTML expression.

Required behavior:

- preserve canonical Markdown source;
- render safe Markdown using the shared renderer path where possible;
- preserve Mermaid fenced blocks as visible diagrams or safe preview containers;
- wrap major sections in stable semantic containers;
- stamp semantic targets with `data-aos-ref`, `data-aos-surface`,
  `data-semantic-target-id`, and source metadata attributes;
- include source-line metadata where available;
- generate an outline/nav from headings;
- expose decisions/checklists/non-goals/verification sections as targetable
  regions when they can be identified deterministically;
- include a plain source link/path in the expression state;
- produce a structured expression metadata payload alongside the HTML.

Do not require full Markdown AST sophistication if the repo does not have it
yet. A conservative heading/line-range parser is acceptable for V0 as long as
the output is deterministic and tests cover it.

## Human-Facing Surface

Provide a way to open or host the HTML expression in AOS.

Required:

- expression opens in an AOS canvas/workbench surface;
- the visible page reads like a reviewable work-card, not raw debug output;
- Surface Inspector can see stable semantic targets where current primitives
  allow;
- the page has no arbitrary untrusted script execution;
- generated controls are semantic and accessible;
- content remains readable without requiring annotation mode.

Nice but not required:

- modest color treatment for section classes;
- sticky outline/sidebar;
- visible source path/revision chip;
- inline Mermaid error/placeholder states.

Avoid decorative polish that hides the contract work.

## Annotation And Checkpoint Path

The expression must be annotation-ready.

Required:

- expression targets are compatible with structured annotations;
- checkpoint start/resume can refer to expression targets;
- human comments/decisions can be captured as structured records;
- resume output can produce one of:
  - annotation sidecar;
  - decision sidecar;
  - proposed Markdown patch;
  - no-op approval record.

Do not mutate source Markdown automatically in V0. It is enough to emit a
structured patch suggestion or decision record that a later Foreman/Implementer step can
apply.

## Work-Card Authoring Flow

After this slice, the intended Foreman flow should be possible:

1. Foreman writes a durable Markdown work-card.
2. Foreman or Operator opens the HTML Workbench Expression for that work-card.
3. Human reviews the rendered expression, optionally annotates or edits through
   the checkpoint flow.
4. Resume emits structured annotations/decisions/patch suggestions.
5. Foreman finalizes the Markdown source and sends Implementer the final work-card.

This work-card only needs to implement enough of the flow to prove it with a
fixture work-card. It does not need to automate Foreman handoff.

## Security And Safety

Generated HTML must be safe by default:

- escape unsafe source HTML unless explicitly allowed by the shared renderer;
- strip or neutralize unsafe links;
- no arbitrary script execution from source Markdown;
- if JavaScript is needed for the workbench shell, keep it repo-owned and
  deterministic;
- preserve Mermaid source safely;
- avoid inline event handlers generated from source content.

Document the security model in `docs/api/toolkit.md` or the schema docs.

## Non-Goals

- No migration of existing `.md` files.
- No broad replacement of Markdown Workbench.
- No making generated HTML canonical source by default.
- No report renderer/export system.
- No arbitrary user-authored JavaScript execution.
- No Employer Brand-specific fields.
- No Surface-Zoom dependency.
- No live website capture or browser automation.
- No Implementer handoff clipboard changes.

## Deliverables

Implement as many of these as are necessary for a clean V0:

- HTML Workbench Expression builder/helper for Markdown work-cards.
- First schema/docs/fixture for expression metadata.
- CLI or script to build and optionally open a work-card expression.
- AOS-hosted expression surface or narrow Markdown Workbench integration.
- Fixture generated from a representative work-card.
- Structured annotation/checkpoint resume payload for that fixture.
- Tests for rendering, sanitization, semantic targets, source mapping,
  Mermaid preservation, checkpoint payload, and existing Markdown compatibility.
- Docs update in `docs/api/toolkit.md`.

## Suggested Verification

Start with:

```bash
./aos dev recommend --json
```

Likely test commands:

```bash
node --test tests/toolkit/markdown-render.test.mjs
node --test tests/toolkit/markdown-workbench-model.test.mjs tests/toolkit/markdown-workbench-layout.test.mjs
node --test tests/toolkit/workbench-human-checkpoint.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add focused tests for the new expression builder/surface.

If `./aos ready` is available, run one bounded smoke:

1. generate an HTML expression for this work-card or a fixture work-card;
2. open it in an AOS canvas/workbench;
3. verify heading/section semantic targets are visible through structured state
   or xray;
4. add one annotation/comment through the available checkpoint or SI path;
5. resume/export and verify the structured annotation/decision payload maps
   back to the source path and line range.

If local readiness is blocked, report the blocker and rely on deterministic
tests.

## Completion Audit

Final report must include:

- issue #301 reference;
- files changed;
- the exact source-vs-expression rule implemented;
- generated fixture path;
- semantic target/source map summary;
- Mermaid support status;
- annotation/checkpoint status;
- security/sanitization behavior;
- verification commands and results;
- explicit statement that existing Markdown docs were not migrated and
  Employer Brand capture/report artifacts were not mutated.
