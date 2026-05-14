# Workbench Human Checkpoint V0

`aos.workbench_human_checkpoint` is the durable record for handing an editable
workbench surface to a human and resuming from that surface later. It records
readiness, subject identity, canvas identity, the initial content hash and
diagnostics, handoff instructions, resume diff metadata, save/draft outcome, and
structured annotation intent records.

V0 is intentionally workbench-scoped. It does not define live visual overlays,
workflow execution, or report/export behavior. Markdown Workbench is the first
concrete adapter.

Canonical schema:
`shared/schemas/workbench-human-checkpoint-v0.schema.json`

Required loop:

1. Run or require an explicit AOS readiness check.
2. If readiness is blocked, emit `status: "blocked_readiness"` with concrete
   repair instructions and no canvas claim.
3. If ready, launch or attach the editable workbench and emit `status:
   "launched"` or `status: "attached"`.
4. Use `status: "launched"` only after the surface exposes usable workbench
   state. If launch command execution or canvas-state verification fails, emit
   `status: "aborted"`, keep `canvas_id` null, store launch attempt metadata,
   and write handoff instructions that describe repair rather than claiming the
   surface opened.
5. Record the subject, `canvas_id`, initial hash, diagnostics, expected human
   action, and resume condition.
6. On resume, read the current workbench state, compute the deterministic diff
   summary, and set the behavior to `save`, `draft`, or `abort`.
7. Preserve committed, resolved, and rejected annotation intent records in the
   resume payload as `resume.annotations`; draft annotations remain on the
   checkpoint but are not treated as committed resume context.
8. When saving, use the subject adapter's persistence path and preserve the
   resulting `markdown_document.save.result` in `resume.save_result`.

## Annotation Intent Records

Checkpoint annotations use the structured record family from
`shared/schemas/annotation.schema.json`. Each record carries an explicit
`ordinal`, surface identity, source path or URL, coordinate space, optional
point and bounds, selector candidates, text excerpt, role/label, ancestor chain,
note, actor, lifecycle timestamps, and capture prepare/restore hints.

Supported V0 kinds are `point_comment`, `region_comment`, `element_selection`,
and `selection_comment`. Status values are `draft`, `committed`, `resolved`, and
`rejected`; resolving or rejecting keeps the record instead of deleting it.
