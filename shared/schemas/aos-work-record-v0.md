# AOS Work Record v0 Sketch

Status: schema-backed design sketch. The JSON Schema in
[`aos-work-record-v0.schema.json`](aos-work-record-v0.schema.json) validates the
example fixtures under
[`fixtures/aos-work-record-v0/`](fixtures/aos-work-record-v0/), but this is not
the active runtime helper contract yet.

## Purpose

A Work Record is the durable AOS artifact for one run of work. It is itself a
Subject, but this sketch defines the persisted run payload rather than the
`aos.workbench.subject` descriptor used to browse it.

The v0 shape follows `CONTEXT.md` and ADR-0001 through ADR-0010:

- `origin` bridges a run back to the executable artifact or v0 compatibility
  descriptor associated with it, if any.
- `references[]` cites related Subjects, transitional Markdown Guides/SOPs,
  artifacts,
  or external resources without making them the run origin.
- `claims[]` live on the durable intent spine.
- `execution_map.postconditions[]` live in the repairable execution map.
- `evidence[]` is immutable and is referenced by id.
- `claim_results[]` are verifier output, one result per Claim.
- `verifier_report` summarizes one verifier pass and derives indexes from
  `claim_results[]`.
- `health` is the current Verifier Health verdict for the Work Record.

## Top-Level Shape

```json
{
  "type": "aos.work_record",
  "schema_version": "2026-05-work-record-v0",
  "id": "work-record:<stable-id>",
  "label": "Human label",
  "created_at": "2026-05-05T16:00:00Z",
  "origin": {},
  "references": [],
  "intent": {},
  "execution_map": {
    "targets": [],
    "steps": [],
    "postconditions": [],
    "artifact_routes": [],
    "replay_policy": {}
  },
  "evidence": [],
  "claims": [],
  "claim_results": [],
  "verifier_report": {},
  "health": {},
  "metadata": {}
}
```

`execution_map.postconditions[]` is the canonical location for Postconditions.
This keeps selector, ref, command, or artifact-route drift in the repairable
map instead of on the durable Claim text.

## Origin

`origin` names the executable artifact that emitted the Work Record.

```json
{
  "origin": {
    "kind": "workflow",
    "ref": "workflow:browser-hosted-wiki-open-sigil",
    "run_id": "run:2026-05-05T16-20-00Z"
  }
}
```

Allowed origin kinds are `ad_hoc`, `recipe`, and `workflow`. Playbooks and
Guides/SOPs that shape a run without executing are cited through
`references[]`.
`ad_hoc` records use `ref: null` because no reusable origin emitted the run:

```json
{
  "origin": {
    "kind": "ad_hoc",
    "ref": null,
    "description": "One-off schema/documentation edit."
  }
}
```

Markdown Guides/SOPs under `docs/guides/` that guided a run are not origins.
Cite them in `references[]` with `relationship: "guided_by"` instead.

## References

`references[]` is for typed relationships to other Subjects, Facets, artifacts,
or documentation. These references do not change the Work Record identity and do
not replace internal ids such as `claim_id` or `postcondition_id`.

```json
{
  "id": "guided-by-entry-path-recipe",
  "relationship": "guided_by",
  "ref": "repo:docs/guides/agent-entry-paths-and-verification.md",
  "subject_type": "docs.guide",
  "layer": "narrative",
  "role": "operator_guidance"
}
```

Use relationship values that describe the role clearly, such as `guided_by`,
`origin_subject`, `input_to`, `output_artifact`, `derived_from`,
`superseded_by`, or `evidence_for`. The schema keeps relationship values open
for this sketch so the first producers are not over-fitted prematurely.

## Claims And Postconditions

Claims are the durable assertions about what the run accomplished. A Claim may
reference zero or more Postconditions:

```json
{
  "id": "claim:sigil-subject-opened",
  "text": "The Sigil wiki Subject was opened in the Browser-Hosted Wiki Subject Browser.",
  "scope": "run",
  "postcondition_refs": [
    "postcondition:sigil-heading-visible"
  ]
}
```

Postconditions are structured checks inside the execution map:

```json
{
  "id": "postcondition:sigil-heading-visible",
  "kind": "browser_dom",
  "description": "The after-capture exposes a visible Sigil subject heading.",
  "target": "browser:wiki-browser/heading.sigil",
  "check": {
    "kind": "text_contains",
    "ref": "heading.sigil",
    "expected": "Sigil"
  },
  "repair_policy": {
    "mode": "patch_execution_map",
    "notes": "Patch refs or locator candidates, not the Claim text."
  }
}
```

Step-local gates can remain Postconditions without being promoted into Claims.
Run-wide outcomes become Claims that reference the relevant Postconditions.

## Claim Results And Verifier Report

Claim Results are verifier output. Each item points back to one Claim and may
include per-Postcondition results:

```json
{
  "id": "claim-result:sigil-subject-opened",
  "claim_id": "claim:sigil-subject-opened",
  "status": "verified",
  "confidence": 0.96,
  "reason": "The after-capture evidence shows the expected subject heading.",
  "evidence_refs": ["evidence:after-see"],
  "postcondition_results": [
    {
      "postcondition_id": "postcondition:sigil-heading-visible",
      "status": "passed",
      "evidence_refs": ["evidence:after-see"],
      "reason": "The expected heading was present."
    }
  ]
}
```

`verifier_report` is report metadata and derived indexes. The embedded report
does not repeat the full `claims[]` list; `claim_results[]` is the source of
truth.

```json
{
  "verifier_report": {
    "id": "verifier-report:wiki-open-sigil",
    "generated_at": "2026-05-05T16:22:00Z",
    "verifier": {
      "id": "aos.verifier.work-record.v0",
      "kind": "schema-example",
      "version": "v0"
    },
    "claim_results_ref": "claim_results",
    "derived_indexes": {
      "verified": ["claim:sigil-subject-opened"],
      "failed": [],
      "unverified": []
    },
    "evidence_refs": ["evidence:after-see"],
    "feedback": []
  }
}
```

If a Verifier Report travels as a standalone artifact later, it can include a
`claims_digest` without becoming a second source of Claim text.

## Verifier Health

`health` is the current health Layer verdict written from the verifier pass.
The field uses `verdict` to avoid overloading generic `status` or `state`.

```json
{
  "health": {
    "verdict": "valid",
    "reason": "All run Claims verified against immutable evidence.",
    "evaluated_at": "2026-05-05T16:22:00Z",
    "verifier_report_id": "verifier-report:wiki-open-sigil",
    "confidence": 0.96,
    "repair_gate_refs": [],
    "replay_gate_refs": []
  }
}
```

Allowed verdicts are `valid`, `stale`, `repairable`, `blocked`, `impossible`,
`superseded`, and `retired`.

## Replay And Repair Gates

The execution map carries explicit replay policy:

```json
{
  "replay_policy": {
    "mode": "report_only",
    "replay_requires_workflow_gate": true,
    "repair_requires_workflow_gate": true,
    "gate_refs": [],
    "notes": "No autonomous replay or repair in v0."
  }
}
```

The schema requires both `replay_requires_workflow_gate` and
`repair_requires_workflow_gate` to be `true`. That encodes the v0 rule that
evidence-backed replay or repair loops need an explicit Workflow gate even when
the record has an executable or compatibility origin.

## Work Recording Frame Packs

Work Recording frame packs are an additive recording layer over this Work
Record shape. The frame contract is defined in
[`docs/design/aos-work-recording-frame-contract-v0.md`](../../docs/design/aos-work-recording-frame-contract-v0.md).

Baseline, delta, and keyframe records relate to the existing model as follows:

- `recording_baseline` captures the initial surface state, state ids, target
  descriptors, environment metadata, and Work Record/replay policy context.
- `recording_delta_frame` stores typed #430 interaction records: action
  intents, execution results, optional gesture frames, observed input evidence,
  state patches, observations, and artifact refs.
- `recording_keyframe` is a periodic recovery snapshot. It does not replace the
  semantic action/state delta records.
- `recording_evidence_ref` points to existing immutable `evidence[]` entries
  and artifact routes.
- `recording_replay_policy` re-perceives, resolves target descriptors, reissues
  semantic action intents, and verifies state patches under the same replay and
  repair gates required by `execution_map.replay_policy`.

The v0 JSON Schema does not add a top-level frame-pack slot yet. Fixtures keep
the recording contract beside Work Records until a runtime producer needs an
additive persisted field.

## Capture Builder And Report-Only Profile

The first runtime producer is intentionally narrow:
`buildWorkRecordV0FromCommandEvidence()` in
`packages/toolkit/workbench/work-record-capture.js` turns one bounded repo
command evidence source into a completed Work Record v0. The source still looks
like AOS evidence: it carries a command Target, optional State ID, immutable
output evidence, expected command postconditions, and references back to the
issue or test file that shaped the run.

The first named verifier profile is
`aos.verifier.work-record.v0.report-only`, exposed by
`runWorkRecordVerifierProfile()` in
`packages/toolkit/workbench/work-record-verifier.js`. The profile wraps the
deterministic report-only checker. It validates internal Work Record integrity,
derives claim indexes from `claim_results[]`, confirms replay and repair remain
workflow-gated, and reports diagnostics without mutating the record.

This command-evidence path is deliberately above the daemon. It is the smallest
proof that Work Records can be generated from bounded evidence instead of only
hand-authored fixtures. Future browser/canvas evidence producers or
transitional Step Descriptor bridges should reuse the same shape by swapping the
evidence source from repo-command output to `see/do/see` captures, browser
traces, screenshots, or artifact bundles. They should still emit Claims,
Postconditions, Claim Results, Verifier Report, and Health through a named
report-only profile before any replay or repair behavior is introduced.

The second producer is also narrow:
`buildWorkRecordV0FromAosActionEvidence()` turns one saved AOS action evidence
source into the same completed v0 shape. Its source records one
`see -> do -> see` slice with before perception, AOS action metadata, after
perception, target dialect, selected action target, State IDs where available,
and immutable artifact refs. Direct browser/canvas evidence may store a
Target-with-Ref, saved-ref evidence should preserve the Saved Ref plus resolved
underlying target, and native AX evidence should preserve its selector bridge
descriptor. The builder stores the selected action target in
`execution_map.steps[].action`, stores before/action/after receipts in
`evidence[]`, and ties the post-action Postcondition to the after-perception
evidence.

### Saved Refs, Evidence, And Post-Action Proof

Saved Ref is evidence provenance, not Work Record object identity. When an
action comes from `ref:<snapshot-id>:<ref-id>`, the Work Record should preserve
both the Saved Ref and resolved underlying target metadata in the selected
action target, evidence metadata, or adjacent execution-map metadata. The Saved
Ref proves which saved perception workspace supplied the action candidate; the
resolved target metadata records what was actually dispatched through browser,
canvas, or native bridge action code.

Post-action proof is the after-perception evidence evaluated through a
post-action Postcondition and its `claim_results[]` entry. Do not invent a raw
JSON diff protocol to prove the result. If a ref, selector,
Postcondition check, or artifact route drifts, repair the execution map under an
explicit workflow/repair gate and keep the evidence immutable. Do not rewrite
Claim text to chase selector drift, do not mutate `evidence[]`, and do not
replay, repair, or macro-play back from a Work Record unless
`execution_map.replay_policy` authorizes that behavior through the required
workflow gates. The v0 verifier and harness remain report-only.

When a source-backed recipe uses
`aos see refs --diff <from>..<to> --expect-ref <ref>=...` as a compact
postcondition step, the Work Record boundary stays the same. The recipe result
or command stdout can be stored as immutable evidence, the Postcondition can
reference the expected `diff.ref_expectation` fields, and the Claim Result can
cite that evidence. The Work Record must not treat the recipe step as a
portable replay instruction, repair a stale ref automatically, or replace
after-perception evidence with an untracked assertion string.

This is the bridge for the Step Descriptor contract:
a gated harness can emit the same saved evidence envelope after it runs `see`,
resolves a target, executes `do`, and captures `see` again. The
`aos.step_descriptor` descriptor owns target-resolution metadata and
repair hints; the Work Record owns what actually happened. This slice does not
replay the action, repair refs, or add a broad recorder/verifier command.
Replay and repair remain gated by `execution_map.replay_policy`.

The Step Descriptor bridge keeps that split explicit:
`buildWorkRecordV0FromStepDescriptorEvidence()` combines one
`aos.step_descriptor` descriptor with one saved AOS action evidence source. The
gated harness or containing Workflow contributes `origin.kind: "workflow"` and
`origin.ref`; the step descriptor contributes target-resolution metadata, step
repair hints, workflow gate refs, and claim-promotion metadata. The action
evidence still contributes the immutable before/action/after receipts, State
IDs, selected action target, Claim Results, Verifier Report, and Health. This
bridge does not make Playbook
the executable substrate and does not execute or replay the descriptor.

The first harness layer above that bridge is
`runOneStepStepDescriptorHarness()` in
`packages/toolkit/workbench/step-descriptor-harness.js`. It is intentionally a
module API above the daemon instead of a broad public CLI. Its boundary is:

- **Step descriptor:** target-resolution,
  preconditions, action shape, postconditions, repair hints, and Claim
  promotions for the gated bridge.
- **Harness run:** one explicit Workflow-gated attempt to simulate from saved
  evidence or call a caller-supplied adapter that returns saved AOS action
  evidence. The harness rejects missing or undeclared gates before action code
  runs.
- **Work Record evidence:** immutable before/action/after receipts and the
  selected action target for what actually happened during the run. A selected
  action target may be a direct Target-with-Ref, a Saved Ref with resolved
  underlying target metadata, or a native bridge descriptor.
- **Verifier diagnostics:** report-only classifications such as target/ref
  drift, precondition failure, action failure, postcondition failure, evidence
  ref drift, and State ID inconsistency. Diagnostics do not mutate the Work
  Record.
- **Future replay/repair:** separate Workflow-gated work that may produce a new
  run or an explicit execution-map patch. It is not performed by the v0 harness
  or the report-only verifier.

## Evidence Adapter Boundary

The first richer verifier evidence adapters live in
`packages/toolkit/workbench/work-record-evidence-adapters.js`. They are pure
toolkit helpers above the daemon: callers pass a Work Record object, and the
helpers inspect only structured payloads already embedded in `evidence[]` and
`execution_map.postconditions[]`. They do not call `./aos`, inspect live
canvases, open browsers, read files from artifact URIs, mutate Work Records,
patch execution maps, replay actions, repair refs, or add a public CLI surface.

`aos.verifier.work-record.v0.report-only` now composes those helpers with the
existing internal-integrity checker. The old checks still validate ids, derived
indexes, workflow gates, State IDs, action target refs, immutable evidence, and
failed postcondition result classifications. The evidence adapters add
report-only diagnostics when a supported postcondition can be checked directly
against payload evidence:

- Browser DOM/ARIA-style payloads use semantic target arrays such as
  `evidence[].metadata.semantic_targets[]` with `ref`, `target`, `role`,
  `name`, `value`, and `data_aos_ref` fields.
- Canvas/AX-like payloads use the same semantic target contract with canvas or
  AX target dialects and may include bounds, canvas ids, or AX paths as
  metadata. The adapter still verifies only deterministic semantic fields.
- Screenshot and artifact evidence is metadata-only in this slice. The adapter
  may check URI, digest, content type, dimensions, attachment metadata, or
  similar deterministic fields. It must not claim that pixels contain a visual
  object, text, layout, or state unless a future deterministic image-check
  contract is added.

Supported adapter-backed failure classes include `target_ref_drift`,
`semantic_target_missing`, `semantic_value_mismatch`,
`semantic_role_name_mismatch`, and `artifact_metadata_mismatch`. These are
diagnostics on the verifier report, not automatic Work Record edits. A record
can remain schema-valid and keep optimistic historical `claim_results[]` while
the current report-only verifier flags the embedded evidence as no longer
supporting the claim.

## Examples

The canonical examples for this sketch are JSON fixtures:

- [`valid/ad-hoc.json`](fixtures/aos-work-record-v0/valid/ad-hoc.json) shows an
  ad-hoc Work Record with `origin.kind: "ad_hoc"` and no reusable origin.
- [`valid/workflow-origin.json`](fixtures/aos-work-record-v0/valid/workflow-origin.json)
  shows an `origin.kind: "workflow"` shape with Claims linked
  to Postconditions, Claim Results linked back to Claims, and a Verifier Report
  that derives indexes from `claim_results[]`.
- [`valid/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/valid/repo-command-adapter-test.json)
  is generated from
  [`evidence/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/evidence/repo-command-adapter-test.json)
  by the command-evidence builder, then checked with the named report-only
  verifier profile.
- [`valid/aos-browser-click-status.json`](fixtures/aos-work-record-v0/valid/aos-browser-click-status.json)
  is generated from
  [`evidence/aos-browser-click-status.json`](fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json)
  by the AOS action evidence builder. It records one browser Target-with-Ref
  click with before perception, action metadata, after perception, a
  post-action Postcondition, immutable evidence refs, and the same report-only
  verifier profile.
- [`valid/evidence-adapter-browser-canvas.json`](fixtures/aos-work-record-v0/valid/evidence-adapter-browser-canvas.json)
  shows adapter-backed browser semantic target, canvas/AX-like semantic target,
  and screenshot metadata checks that pass deterministically.
- [`report-only-failures/evidence-adapter-failures.json`](fixtures/aos-work-record-v0/report-only-failures/evidence-adapter-failures.json)
  remains schema-valid but intentionally fails adapter-backed report-only
  diagnostics for target/ref drift, missing semantic targets, value mismatch,
  role/name mismatch, and artifact metadata mismatch.
- [`valid/workflow-browser-click-status.json`](fixtures/aos-work-record-v0/valid/workflow-browser-click-status.json)
  is generated from the same AOS action evidence plus
  [`../aos-step-descriptor-v0/valid/browser-click-status.json`](fixtures/aos-step-descriptor-v0/valid/browser-click-status.json)
  by the Step Descriptor bridge. It preserves `origin.kind: "workflow"`,
  `origin.ref`, the promoted Claim metadata, evidence refs, postcondition refs,
  Claim Results, Verifier Report, Health, and workflow-gated replay/repair
  policy.

The fixture validation test also checks internal reference integrity that JSON
Schema cannot express alone: every Claim Result must reference an existing
Claim, every Claim Postcondition reference must resolve inside
`execution_map.postconditions[]`, and derived verifier indexes must point to
known Claims.

## Migration Notes

The toolkit now has a compatibility reader for v0 records in
`packages/toolkit/workbench/work-record-adapter.js`, projects v0 records through
`packages/toolkit/workbench/work-record-subject.js`, and opens them read-only in
the stock Work Record workbench. Older helper-shaped records keep their existing
manual edit and patch-request path. The current capture boundary has two
source-specific producers plus one bridge: bounded repo command evidence,
bounded AOS action evidence, and Step Descriptor-plus-action-evidence. Future
browser/canvas producers or transitional Step Descriptor bridges should continue
to emit this v0 shape from bounded `see/do/see` evidence while preserving the
same report-only verifier gate.
