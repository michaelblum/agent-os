# AOS HTML Workbench Expression V0

`aos_html_workbench_expression` is the metadata sidecar for a safe HTML
projection of a durable artifact source. V0 is intentionally narrow:
Markdown work-cards and human alignment packs remain the canonical source,
while the HTML expression is the human-facing review, annotation, and
checkpoint surface. The only supported `artifact_kind` values are `work_card`
and `human_alignment_pack`.

Required metadata includes the source path and deterministic source hash, the
generated HTML path, semantic targets with source line ranges and DOM selectors,
Mermaid block preservation records, annotation/checkpoint capabilities, and the
security/export policy.

The V0 security posture is source-safe by default. Source-authored HTML is
escaped by the shared Markdown renderer, unsafe links are stripped, Mermaid
source is preserved inside deterministic containers, and source-authored script
or inline event handler execution is not supported.

Resume/export records must not mutate source Markdown automatically. They may
emit annotation sidecars, decision sidecars, proposed Markdown patches, or
no-op approval records for a later step to apply.

## Design Positioning

The contract is Agent OS's disciplined adoption of the "HTML as richer agent
output" pattern. HTML is not the source of truth and not a blanket replacement
for Markdown. It is an addressable projection layer used when human review,
annotation, reveal, comparison, or checkpoint interaction needs real DOM
geometry and stable semantic targets.

Keep new artifact kinds narrow and evidence-backed. Before expanding beyond
`work_card` and `human_alignment_pack`, define the source expression, generated
HTML expression, surviving structured sidecar/result, security policy, and
cleanup/archive behavior. See
`docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`.
