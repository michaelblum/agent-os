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

- `origin` bridges a run back to the reusable artifact that emitted it, if any.
- `references[]` cites related Subjects, documentation-only Recipes, artifacts,
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
    "kind": "playbook",
    "ref": "playbook:browser-hosted-wiki-open-sigil",
    "run_id": "run:2026-05-05T16-20-00Z"
  }
}
```

Allowed origin kinds are `ad_hoc`, `recipe`, `playbook`, and `workflow`.
`ad_hoc` records use `ref: null` because no reusable artifact emitted the run:

```json
{
  "origin": {
    "kind": "ad_hoc",
    "ref": null,
    "description": "One-off schema/documentation edit."
  }
}
```

Documentation-only Recipes that guided a run are not origins. Cite them in
`references[]` with `relationship: "guided_by"` instead.

## References

`references[]` is for typed relationships to other Subjects, Facets, artifacts,
or documentation. These references do not change the Work Record identity and do
not replace internal ids such as `claim_id` or `postcondition_id`.

```json
{
  "id": "guided-by-entry-path-recipe",
  "relationship": "guided_by",
  "ref": "repo:docs/recipes/agent-entry-paths-and-verification.md",
  "subject_type": "docs.recipe",
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
the record has a reusable origin.

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
hand-authored fixtures. Future browser or canvas Playbooks should reuse the same
shape by swapping the evidence source from repo-command output to `see/do/see`
captures, browser traces, screenshots, or artifact bundles. They should still
emit Claims, Postconditions, Claim Results, Verifier Report, and Health through a
named report-only profile before any replay or repair behavior is introduced.

## Examples

The canonical examples for this sketch are JSON fixtures:

- [`valid/ad-hoc.json`](fixtures/aos-work-record-v0/valid/ad-hoc.json) shows an
  ad-hoc Work Record with `origin.kind: "ad_hoc"` and no reusable origin.
- [`valid/playbook-origin.json`](fixtures/aos-work-record-v0/valid/playbook-origin.json)
  shows a Playbook-origin Work Record with Claims linked to Postconditions,
  Claim Results linked back to Claims, and a Verifier Report that derives
  indexes from `claim_results[]`.
- [`valid/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/valid/repo-command-adapter-test.json)
  is generated from
  [`evidence/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/evidence/repo-command-adapter-test.json)
  by the command-evidence builder, then checked with the named report-only
  verifier profile.

The fixture validation test also checks internal reference integrity that JSON
Schema cannot express alone: every Claim Result must reference an existing
Claim, every Claim Postcondition reference must resolve inside
`execution_map.postconditions[]`, and derived verifier indexes must point to
known Claims.

## Migration Notes

This sketch intentionally does not migrate
`packages/toolkit/workbench/work-record-subject.js` or Work Record workbench UI
surfaces. The next implementation pass should add optional reader support for
the new fields first, preserve the older fixture shape during migration, and
only then promote this sketch toward the active Work Record helper contract.
