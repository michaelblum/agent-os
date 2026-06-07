# HTML Workbench Expression Adoption Audit

**Date:** 2026-05-13
**Status:** durable design audit
**Related issues:** #300, #301, #263, #293, #295, #141, #129, #140, #302

## Source Signal

A transcript about "HTML as the new Markdown" argued that agents should use
HTML for richer human-facing outputs: side-by-side exploration, PR explainers,
research reports, custom one-off editors, diagrams, sliders, visual hierarchy,
and other surfaces that keep humans in the loop. The useful signal is not that
HTML should replace Markdown. The useful signal is that agent-generated work
often needs an inspectable surface rather than another long text document.

The transcript also carries cautions: HTML costs more tokens, can be noisy in
version control, can decay from novelty into new clutter, can look polished
while remaining shallow, can fail on mobile, and can hallucinate or mishandle
images. It is strongest as a projection and interaction layer, not as canonical
source.

## Adoption Finding

Agent OS has already absorbed the strong version of the signal under the
Layered Subject Expression and HTML Workbench Expression patterns.

The current AOS stance is:

- Markdown remains the durable source expression for prose, work-cards, recipes,
  and docs.
- JSON remains the canonical machine-readable expression for schemas, bundles,
  manifests, evidence, and audit data.
- HTML becomes a rich workbench expression for human review, annotation,
  semantic targets, Mermaid diagrams, checkpoint interaction, and structured
  intent alignment.

This is better than the raw "just ask for HTML" pattern. It keeps simple source
diffs and machine contracts stable while using HTML where a browser layout tree,
DOM selectors, `data-aos-ref`, scroll/reveal behavior, and Surface Inspector
integration are actually useful.

## Current Repo Evidence

HTML Workbench Expression V0 exists as a concrete slice:

- `shared/schemas/aos-html-workbench-expression-v0.md`
- `shared/schemas/aos-html-workbench-expression-v0.schema.json`
- `packages/toolkit/workbench/html-workbench-expression.js`
- `packages/toolkit/components/html-workbench-expression/`
- `scripts/aos-html-workbench-expression.mjs`
- `docs/api/toolkit/workbench.md`
- `docs/design/work-cards/aos-html-workbench-expression-v0.md`
- `tests/toolkit/html-workbench-expression.test.mjs`
- `tests/schemas/aos-html-workbench-expression-v0.test.mjs`

The V0 implementation supports Markdown-authored work-cards and human alignment
packs. It emits deterministic metadata, source hashes, generated HTML paths,
source maps, semantic targets, Mermaid preservation records, capability flags,
security policy, and resume/export behavior. It deliberately does not mutate
source Markdown automatically.

Artifact Bundle Subject V0 is also already integrated, not merely proposed. At
the time of writing, Issue #263 was closed as complete, with a read-only
artifact-bundle subject, fixture, canonical subject helper, artifact bundle
workbench, catalog/browser opening path, docs, tests, and live AOS verification
evidence. The artifact bundle workbench covers gallery, preview, source, exports,
provenance,
validation, and linked work-record evidence.

## Reinforced Design Rule

Use format pluralism by layer:

- Use Markdown when the main job is durable text that humans and agents can edit
  line by line.
- Use JSON or another structured format when the main job is correctness,
  validation, or machine exchange.
- Use HTML Workbench Expressions when the main job is comprehension,
  annotation, reveal, comparison, review, or checkpointed human steering.
- Use Artifact Bundle Subjects when the main job is inspecting a collection of
  generated or collected artifacts with provenance, validation, exports, and
  related work records.
- Use application-native UI only when the interaction is recurring enough to
  deserve product-quality controls and persistence.

The durable primitive is not a file extension. It is the loop: ingest real
context, render a human-legible surface, let the human steer, then export a
precise machine-legible result.

## Contradictions And Divergent Patterns

The main contradiction is stale documentation, not implementation. The Open
Design cross-reference still describes artifact bundles as a proposed narrow
path and says the note has no runtime implementation. That was true when it was
written, but issue #263 later integrated Artifact Bundle Subject V0. Future
agents should treat that note as historical analysis plus adaptation rationale,
not current implementation status.

The second tension is issue lifecycle. At the time of this audit, #301 and #307
were related lifecycle references for the V0 implementation. Query GitHub for
current #301 and #307 state before drawing any current conclusion.

The third tension is scope naming. Issue #300 calls HTML the "default rich
workbench expression for human-facing artifacts," while implementation stays
narrow to `work_card` and `human_alignment_pack`. That is healthy if future
work expands through explicit artifact kinds and tests. It becomes risky if
agents read #300 as permission to generate arbitrary HTML reports without
source maps, semantic targets, sidecars, or cleanup policy.

The fourth tension is artifact lifecycle. AOS has strong source/projection
contracts, but the default disposal/archive policy for one-off generated HTML,
reports, screenshots, PDFs, prototypes, and validation outputs is still not as
explicit as the source-vs-projection rule. Without a lifecycle rule, the system
can regress into artifact sprawl: useful visual outputs with unclear ownership,
cleanup, archival, or surviving structured result.

The V0 lifecycle answer is now `docs/design/generated-artifact-lifecycle-policy.md`.
Future HTML Workbench Expression kinds should treat that note as the minimum
producer contract for source hashes, output locators, cleanup/archive policy,
privacy/redaction policy, and the structured result that survives if generated
HTML is deleted.

The fifth tension is Design Operator history. #140 was used as a
design-operator context tracker at the time of writing, but its comments already
warned that older `docs/superpowers` path guidance was stale and that
artifact/workspace ideas routed through AOS workbench subjects and #263. Query
GitHub for current #140 state before acting on it; do not implement from the old
path wording without checking current design docs.

## Related Issue IDs

This audit used #300, #301, #263, #293, #295, #297, #298, #299, #141, #129,
#140, and #302 as related issue references at the time of writing. Query GitHub
for their current titles, states, labels, and PR links before acting on them.

The durable design signal is that HTML expressions can become rich review
projections for evidence workflow artifacts, but extraction should still wait
for stabilized cross-domain reuse. They can also serve as checkpointable
review/control surfaces within human-intent and steerable-collection workflows,
but they do not replace collection/session workflow semantics.

## Recommended Next Work

Do not broaden HTML Workbench Expression immediately. First add a narrow
lifecycle decision for generated projection artifacts:

1. Define where disposable generated expressions live.
2. Define when generated expressions are archived as artifact-bundle members.
3. Define what structured sidecar/result must survive when an expression is
   discarded.
4. Define cleanup expectations for one-off generated HTML and report outputs.
5. Add the lifecycle rule to the relevant toolkit workbench docs before adding
   more artifact kinds.

The initial decision is captured in
`docs/design/generated-artifact-lifecycle-policy.md`; remaining work should
apply it to new producers rather than inventing ad hoc artifact rules.
