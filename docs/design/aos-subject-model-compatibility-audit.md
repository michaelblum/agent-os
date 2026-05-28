# AOS Subject Model Compatibility Audit

**Status:** compatibility audit with 2026-05-06 v-next cutover notes
**Date:** 2026-05-06

## Purpose

The glossary and ADR pass defines the target subject model, but several live
helpers, tests, and API docs still encode older assumptions. This note records
the drift before schema work begins so the next pass can migrate deliberately
instead of turning legacy behavior into a new contract.

## Findings

### 1. Wiki helpers minted domain subject types at audit time

At audit time, `packages/toolkit/workbench/wiki-subject.js` mapped
`sigil/agents/*` paths or wiki pages with `type: agent` to
`subject_type: sigil.agent`. `tests/toolkit/wiki-subject.test.mjs` asserted
that behavior, and `docs/api/toolkit.md` listed `sigil.agent` under wiki page
subjects.

This conflicts with ADR-0007. In the target model, a wiki document remains a
wiki-oriented Subject (`wiki.entity`, `wiki.concept`, `wiki.workflow`, or
`wiki.reference`). A domain Subject such as `sigil.agent` is a separate Subject
that references the wiki document as the source of its narrative Facet.

Migration direction:

- keep `createWikiPageSubject` wiki-oriented;
- introduce or identify a domain helper for `sigil.agent` Subjects;
- represent the relationship through Subject References, not a context-dependent
  `subject_type`;
- update the tests and `docs/api/toolkit.md` together.

Migration status: the focused helper slice now keeps Sigil agent wiki documents
as `wiki.entity` Subjects and adds `createSigilAgentSubject()` for the separate
`sigil.agent` domain Subject. The live schema remains versioned as
`2026-05-03`, but it accepts top-level `subject_references[]`. Live helpers now
write top-level `subject_references[]` only; the remaining
`metadata.subject_references[]` support is isolated in the legacy reader adapter
for archived descriptors.

### 2. `capabilities[]` mixes high-level capabilities and operation contracts

Current subject builders place dotted operation/event contracts in
`capabilities[]`, including `markdown_document.text.patch`, `wiki.invoke`,
`workflow.project`, `work_record.execution_map.edit`,
`canvas_object.transform.patch`, and `sigil.radial_item_editor.lock_in`.

ADR-0010 defines Capability as a high-level named contract such as
`inspectable`, `editable`, `verifier-target`, `replayable`, or `exportable`.
The dotted strings remain useful, but they are operation contracts rather than
the high-level Capability taxonomy.

Migration direction:

- add a capability registry document before changing runtime behavior;
- decide whether to keep operation contracts in `capabilities[]` or split them
  into a new `contracts[]` field;
- add high-level capabilities in a backward-compatible way before removing any
  dotted strings that existing surfaces or tests inspect.

Cutover status: `shared/schemas/aos-subject-capabilities.md` records the v0
high-level Capability registry and the active subject schema constrains
`capabilities[]` to that registry. Runtime readers keep legacy dotted strings
readable from archived raw descriptors through `subjectContracts()` in
`packages/toolkit/workbench/subject.js`, but live writers now emit dotted
operation/event strings through top-level and Facet-local `contracts[]`.

### 3. `views[]` and `controls[]` are pre-facet projection fields

The schema currently has `views[]` and `controls[]`, while ADR-0001 defines
Facets as the concrete projections inside Layers and ADR-0010 treats Controls as
operations derived from Capabilities plus Facets.

Migration direction:

- keep `facets[]` and `facets[].hosts[]` as the live projection model;
- stop live writers from emitting `views[]` and `controls[]`;
- derive live view/control affordances from `facets[]`, `capabilities[]`, and
  operation contracts.

Cutover status:
`shared/schemas/aos-workbench-subject-vnext.md` sketches the target model, and
the active `aos-workbench-subject.schema.json` accepts `facets[]`,
`facets[].hosts[]`, `subject_references[]`, and `contracts[]` as canonical live
fields. It still accepts deprecated `views[]` and `controls[]` only as explicit
archived-fixture or persisted-import boundary fields.

### 4. Work-record origin, references, claims, and verifier output have a v0 sketch

Work-record fixtures and helpers still center on `intent`, `precondition`,
`action`, `postcondition`, `execution_map`, `evidence`, and `health`. The
newer vocabulary adds `origin`, `references[]`, `claims[]`, `claim_results[]`,
and `verifier_report`, but those fields are not yet encoded in the live fixture
tests or helper model. `packages/toolkit/workbench/work-record-subject.js`
currently exposes `source.recipe_id` rather than an `origin` object.

Migration direction:

- use the Work Record v0 sketch as the migration target before touching helpers;
- add optional `origin: { kind, ref }`, `references[]`, Claims,
  Postconditions, Claim Results, and verifier-report fixtures first;
- keep Playbook step promotion grammar separate before runtime replay work;
- keep historical evidence immutable and patch only execution-map or reusable
  execution knowledge.

Schema-design status: `shared/schemas/aos-work-record-v0.md` now sketches the
Work Record v0 payload with a validating JSON Schema, ad-hoc and
Playbook-origin examples, `origin`, `references[]`, Claims,
`execution_map.postconditions[]`, `claim_results[]`, `verifier_report`, and
Verifier Health. Runtime helpers and UI surfaces are intentionally unchanged.

### 5. The grand plan used old navigation shorthand

At audit time, `docs/design/aos-grand-unification-plan.md` still said "vertical
subject chain" for the example:

```text
wiki:Sigil
sigil.radial_menu:default
sigil.radial_menu.item:wiki-graph
canvas_object:radial.wiki-brain.shell
```

ADR-0008 and `CONTEXT.md` now define this as a Navigation Trail of Subject Entry
Handles, not a chain of Subjects.

Migration direction:

- rewrite this section as a Navigation Trail of Subject Entry Handles;
- keep the example handles if they remain useful, but label them as entry
  handles and clarify which Subject each handle resolves to.

Cleanup status: the plan now uses Navigation Trail wording. Schema work still
needs to define the handle shape.

### 6. Anchor wording was mostly correct in code, but docs needed role language

The CLI legitimately exposes `--anchor-browser`, `--anchor-window`, and
`--anchor-channel`. ADR-0004 clarifies that Anchor is a role and that
`--anchor-browser browser:<session>/<ref>` resolves to an Anchor Binding
(`anchor_window + offset`). Some docs still read as if `--anchor-browser` is a
parallel target dialect instead of a role flag whose value is a normal browser
Target-with-Ref.

Migration direction:

- update prose before changing the CLI;
- do not replace `--anchor-browser` with a generic `--anchor <target>` until the
  window/channel/browser resolvers share one contract.

Cleanup status: the grand plan and browser trace note now use Anchor role and
Anchor Binding wording while preserving the current `--anchor-browser` CLI.

### 7. State ID docs had one older target example

At audit time, `docs/design/aos-work-records-and-self-healing-recipes.md` still
gave the screen dialect as `screen:<frame-id>/<x,y>`. ADR-0006 and the grand
plan use `screen:<state-id>/<x,y>` for coordinate fallback with a
perception-state guard.

Migration direction:

- update docs to `screen:<state-id>/<x,y>`;
- keep enforcement language honest: current AOS echoes/correlates state ids but
  does not reject stale coordinate actions yet.

Cleanup status: the work-record design note now uses `screen:<state-id>/<x,y>`.

## 2026-05-06 Cutover Classification

| Hit class | Representative evidence | Decision |
| --- | --- | --- |
| Live writers | `wiki-subject.js`, `markdown-workbench/model.js`, `work-record-subject.js`, `browser-step-descriptor-prototype.js`, `workflow-subject.js`, `sigil-subject.js`, and `apps/sigil/radial-item-editor/model.js` | Emit high-level `capabilities[]`, dotted `contracts[]`, concrete `facets[]`, `facets[].hosts[]`, and top-level `subject_references[]`; omit `views[]` and `controls[]`. |
| Live consumers | `wiki-subject-opening.js`, `step-descriptor-workbench/model.js`, and workbench snapshot tests | Derive affordances from `contracts[]`, `facets[]`, and Host entries; do not open from legacy `views[]`/`controls[]`. |
| Fixture/schema compatibility | `tests/toolkit/workbench-subject.test.mjs` and `tests/schemas/aos-workbench-subject.test.mjs` | Keep one explicit legacy reader boundary for archived descriptors with dotted raw capabilities or `views[]`/`controls[]`; schema marks legacy summaries as deprecated. |
| Persisted/import boundary | Old helper-shaped Work Record fixtures under `docs/design/fixtures/aos-work-records/` and schema-v0 Work Record fixtures | Preserve Work Record payload adapters; do not emit legacy Workbench Subject summaries from live Work Record Subjects. |
| Unrelated domain fields | Wiki graph view config, object-transform effect `controls`, object registry capabilities, gateway/session capabilities, and UI window controls | Leave untouched because they are not `aos.workbench.subject` descriptor fields. |

## Recommended Migration Order

1. Update docs-only drift that does not change behavior: navigation trail
   wording, anchor role wording, and `screen:<state-id>/<x,y>`.
2. Add schema sketches for Subject References, Facets, Hosts, Capabilities,
   operation contracts, Work Record origin/references, and verifier reports.
   Subject References, Facets, Hosts, Capabilities, and operation contracts now
   have initial sketches; Work Record origin/references, Claims,
   Postconditions, Claim Results, verifier reports, and Verifier Health now have
   an initial v0 sketch in `shared/schemas/aos-work-record-v0.md`.
3. Add a capability registry document and move operation contracts to
   `contracts[]`. The registry now makes `contracts[]` canonical for live
   writers, with `subjectContracts()` as the archived descriptor fallback.
4. Migrate wiki/domain subject helpers: split wiki document Subjects from domain
   Subjects and update tests. This is done for the representative helpers.
5. Move Workbench Subject helpers and representative consumers from
   `views[]`/`controls[]` toward `facets[]` plus capabilities/contracts. The
   bounded v-next cutover has done this for the representative live writers and
   consumers listed in the classification table.

## Verification Notes

This audit is documentation-only. It should be verified with `git diff --check`
and a focused docs review. No Swift build or runtime canvas loop is required.
