# AOS Work Record v0 Sketch

Status: schema-backed v0 contract with fixture-backed toolkit producers. The JSON Schema in
[`aos-work-record-v0.schema.json`](aos-work-record-v0.schema.json) validates the
example fixtures under
[`fixtures/aos-work-record-v0/`](fixtures/aos-work-record-v0/), and the
toolkit builders/verifier in `packages/toolkit/workbench/` produce and inspect
the current deterministic fixtures. This remains report-only: it records and
verifies bounded runs, but it does not authorize autonomous replay, repair, or
macro recording.

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
- `health` stores the embedded verifier health written with the Work Record.
  Consumers must treat fresh report-only verifier status and diagnostics as the
  current health authority.

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

## Repair Plan V0

A Work Record Repair Plan is a read-only planning envelope over a source Work
Record and a fresh report-only verifier result. It proposes next steps; it is
not a repaired Work Record, verifier result, patch artifact, or proof that a
repair happened.

The current planner emits:

```json
{
  "type": "work_record.repair_plan",
  "schema_version": "2026-07-work-record-repair-plan-v0",
  "status": "planned",
  "source_work_record": {},
  "current_report": {},
  "current_health": "repairable",
  "embedded_health": "repairable",
  "health_verdict": "repairable",
  "historical_results": {},
  "failure_classes": [],
  "blockers": {},
  "mutates_record": false,
  "executes_actions": false,
  "automatic_replay_allowed": false,
  "workflow_gates": [],
  "plan_steps": [],
  "candidate_patches": [],
  "recommended_commands": [],
  "evidence_refs": [],
  "diagnostics": [],
  "followup": {}
}
```

The planner must keep `current_health` derived from the fresh report-only
verifier result. `embedded_health` is historical Work Record data and never
overrides the current report diagnostics. `historical_results` points at
embedded `claim_results[]` as record contents, not current proof.

Repair Plans are intentionally conservative:

- `valid`: no repair plan; recommend read/export/verify only.
- `stale`: plan fresh perception or re-resolution and a follow-up Work Record;
  any mutation remains workflow-gated.
- `repairable`: plan fresh perception or re-resolution plus a descriptive
  execution-map `candidate_patch` under an explicit workflow gate; the patch is
  not applied by the plan.
- `blocked`: classify missing evidence, permission, runtime, cleanup, or
  postcondition blockers and name the required external action or gate.
- `impossible`: explain why the known target class cannot satisfy the intent
  and prohibit replay.
- `superseded`: point at replacement records when available and avoid repair.
- `retired`: preserve the record as historical-only evidence and avoid repair.

Every `candidate_patches[]` entry is descriptive and must carry
`applied:false`. Recommended commands must report `executes_in_plan:false`.
Commands or steps that could mutate state must be marked
`requires_workflow_gate:true`; the planner does not create, satisfy, or bypass
that gate. A future repair attempt should emit a new Work Record or an explicit
patch artifact instead of rewriting `evidence[]`, `claims[]`, historical
`claim_results[]`, or the source Work Record.

## Workflow Gate Authorization V0

Workflow Gate Authorization is the read-only bridge between a Repair Plan and
the existing AOS gate contracts:

- `repair_plan`: read-only Work Record repair planning output.
- `workflow_gate`: a required approval/orchestration boundary named by the
  Repair Plan.
- `gate_request`: an `aos.gate.request.v1` request generated from one
  Repair Plan gate.
- `gate_record`: a terminal `aos.gate.record.v1` outcome.
- `resume_event`: a terminal `aos.gate.resume-event.v1` outcome created from a
  deferred gate continuation.
- `authorization`: report-only evaluation of whether the terminal outcome
  satisfies the Repair Plan gate.
- `future_attempt`: a later repair or re-run attempt that must produce a new
  Work Record or explicit patch artifact.

The toolkit contract is
`work_record.workflow_gate_authorization` with schema version
`2026-07-work-record-workflow-gate-authorization-v0`. It reports
`authorizes_future_attempt:true|false`, `executes_repair:false`,
`mutates_record:false`, and `automatic_replay_allowed:false`. Authorization is
not evidence that repair happened, does not run recommended commands, does not
apply candidate patches, does not replay actions, and does not mutate the source
Work Record or Repair Plan.

`gate-request` generation is allowed only when current Repair Plan output names
a mutating gated step or candidate patch. Valid, impossible, retired, and
superseded records return `not_required` unless the current Repair Plan itself
contains such a gated mutating candidate. Generated requests use
`aos.gate.request.v1`, `ui.variant:"approve_deny"`, a stable request id derived
from source Work Record identity, Repair Plan identity, and Workflow gate id,
and metadata that links the request back to Work Record repair planning. Prompt
bodies stay compact and do not embed heavy evidence payloads.

Authorization checking fails closed. Supported statuses are `not_required`,
`pending`, `authorized`, `denied`, `dismissed`, `timeout`, `stale`,
`mismatch`, `insufficient_evidence`, and `unsupported`. Positive authorization
requires a matching terminal gate outcome and an inspectable affirmative answer
payload. A terminal `answered` record without stored response data is
`insufficient_evidence`; callers that need later authorization proof must use
`--store-response` or `metadata.record_response:true` on the gate path that
stores the answer payload. Denied, dismissed, timeout, stale plan identity,
wrong Work Record, wrong plan, wrong gate, missing response, and unsupported
outcomes do not authorize a future attempt.

## Repair Attempt Plan V0

A Work Record Repair Attempt Plan packages a current Repair Plan and optional
Workflow Gate Authorization into a deterministic, non-executing descriptor for
a future explicit executor. It answers what a future repair attempt would need
to do, what it may touch, what proof it must emit, how cleanup or rollback
would be recorded, and why the attempt is or is not currently authorized. It is
not the executor.

The toolkit contract is `work_record.repair_attempt_plan` with schema version
`2026-07-work-record-repair-attempt-plan-v0`. The envelope includes:

```json
{
  "type": "work_record.repair_attempt_plan",
  "schema_version": "2026-07-work-record-repair-attempt-plan-v0",
  "status": "blocked_authorization_required",
  "source_work_record": {},
  "repair_plan": {},
  "workflow_gate_authorizations": [],
  "attempt_identity": {},
  "preconditions": [],
  "planned_operations": [],
  "candidate_patches": [],
  "recommended_commands": [],
  "evidence_requirements": [],
  "postconditions": [],
  "cleanup_expectations": [],
  "rollback_expectations": [],
  "risk": {},
  "known_limits": [],
  "executes_repair": false,
  "executes_actions": false,
  "applies_patches": false,
  "mutates_record": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported statuses are `not_required`, `ready`,
`blocked_authorization_required`, `blocked_authorization_denied`,
`blocked_authorization_insufficient`, `blocked_precondition`, `stale`,
`mismatch`, and `unsupported`. `ready` means only that the descriptor is safe
to hand to a future explicit executor; it does not mean repair happened.

Positive readiness requires the current Repair Plan to validate, source Work
Record identity to match, Repair Plan identity to match any supplied
authorization, every mutating planned operation to have an authorized matching
Workflow gate, all required preconditions to be representable as explicit
checks, no candidate patch to be marked applied, and no recommended command to
be marked executed.

Missing, denied, dismissed, timeout, insufficient, stale, wrong-record,
wrong-plan, wrong-gate, unsupported, and invalid authorization cases fail
closed. `valid`, `impossible`, `retired`, and `superseded` records produce
`not_required` unless the current Repair Plan itself contains a gated mutating
candidate that needs a future attempt.

`attempt_identity` is derived from source Work Record identity, Repair Plan
schema/version/digest, Workflow Gate Authorization identities when supplied,
Workflow gate ids, gated step ids, candidate patch ids, and planned operation
ids. `planned_operations[]` are typed descriptors, not live execution. Each
operation carries `executes_in_plan:false`, authorization status, target
boundary, precondition refs, evidence requirement refs, postcondition refs,
cleanup refs, and rollback refs. Patch-like candidates preserve
`applied:false`; command-like recommendations preserve
`executes_in_plan:false`.

The planner must not execute repair, replay actions, apply candidate patches,
run recommended commands, patch execution maps, auto-resume agents, mutate the
source Work Record, or treat authorization as proof that repair happened.
Future execution must emit a new Work Record or explicit patch artifact, plus
the evidence required by the attempt plan.

## Repair Guided Recovery V0

Guided Recovery is a read-only routing envelope over the existing Work Record
repair chain. It does not add a new executor or policy authority. The public
command is:

```bash
aos work-record repair guide <id-or-path> [--profile id] [--root path ...] \
  [--authorization path|--gate-record id-or-path|--resume-event path|--continuation-id id] \
  [--attempt-plan path] [--attempt-artifact path] \
  [--execution-root dir] [--artifact-root dir] \
  [--replacement-root dir] [--index-root dir] [--json]

aos work-record repair bundle <id-or-path> --output-root <dir> \
  [--profile id] [--root path ...] \
  [--authorization path|--gate-record id-or-path|--resume-event path|--continuation-id id] \
  [--attempt-plan path] [--attempt-artifact path] \
  [--replacement-root dir] [--index-root dir] [--dry-run] [--json]

aos work-record repair bundle status \
  --bundle-root <dir> [--bundle-root <dir> ...] \
  [--bundle-parent <dir> ...] [--json]

aos work-record repair bundle inspect <bundle-root> [--json]
```

The envelope type is `work_record.repair_guided_recovery` with schema version
`2026-07-work-record-repair-guided-recovery-v0`. It includes source Work Record
identity/path/digest, current status report summary, Repair Plan summary,
optional gate request/authorization summary, optional Repair Attempt Plan
summary, optional Repair Attempt Artifact validation, optional finalization
dry-run summary, optional supersession lookup, optional replacement read/status
summary, current stage, stage status, blockers, missing inputs, deterministic
artifact path recommendations, and command descriptors.

Guide stages are `valid_no_repair_needed`, `superseded`,
`retired_or_impossible`, `repair_plan_unavailable`, `gate_required`,
`authorization_pending`, `authorization_denied`,
`authorization_insufficient`, `attempt_plan_blocked`, `ready_to_plan_attempt`,
`ready_to_execute`, `attempt_artifact_invalid`, `ready_to_finalize`,
`finalization_blocked`, `finalized`, and `unsupported`. Each stage carries
`status`, `why`, `evidence`, `next_command`, `missing_inputs`,
`would_mutate_if_run`, and `requires_user_approval`. `ready_to_plan_attempt`
means the Repair Attempt Plan is ready in memory but still needs saved JSON
stdout at the listed attempt-plan path. `ready_to_execute` with
`stage_status:"ready"` requires a `ready` Repair Attempt Plan plus supplied
`--attempt-plan`, `--execution-root`, and `--artifact-root`; otherwise it is
blocked with matching `missing_inputs`. `ready_to_finalize` requires a
validating supplied Attempt Artifact and a successful finalization dry-run.
`finalized` requires active supersession lookup plus readable replacement
status.

Command descriptors are stable structured recommendations, not executed work.
Each descriptor includes `id`, `purpose`, `command`, `argv`, `mutates_state`,
approval/root requirements, `expected_output`, `next_stage_after_success`, and
`not_run_by_guide:true`. Descriptors whose JSON stdout must be persisted for a
later command include `stdout_artifact`, `save_stdout_to`, and downstream
`requires_saved_output_from` fields. `argv` remains the direct process
invocation; shell redirection is never the only persistence contract. Descriptor
`command` and `persistence_command` values are display-only shell-quoted text
derived from `argv` and the structural saved-output fields; consumers must not
parse them for execution. The guide may report mutating commands such as
`repair execute` or `repair finalize`, but it must not run them.

Public recovery envelopes expose a compact `recovery_summary` for scan-first
continuation. `repair guide`, `repair bundle`, `repair bundle inspect`, and
each `repair bundle status` row derive this summary from existing validated
stage, descriptor, manifest, continuation, lifecycle, and diagnostic fields.
It is not authoritative state and must not become a second recovery state
machine. The object includes `state`, `headline`, `why`, `source_work_record`,
`bundle_root`, `guide_stage`, `guide_stage_status`, `next`, `artifacts`,
`safety`, and `diagnostic_codes`. `state` is one of `ready`, `blocked`,
`finalized`, `invalid`, `missing`, `unsupported`, or `unknown`. `next.argv` is
the only executable continuation form; display strings are optional
display-only derivatives. Invalid, missing, unsupported, and unknown summaries
must not expose a safe continuation argv. Incomplete bundle-owned artifacts or
descriptors, digest mismatches, descriptor mismatches, invalid manifests, path
escapes, forbidden artifacts, unsupported schemas, missing roots, and unknown
inspection statuses fail closed with empty `next.command_id` and `next.argv`.
Bundle inspection summaries, top-level inspect `continuation`, and lifecycle
status rows use one classifier for the canonical state set so
`inspect.recovery_summary.state`,
`status.bundles[].lifecycle_status`, and
`status.bundles[].recovery_summary.state` do not drift. `safety` reports whether an inspector
ran a command, whether the bundle wrote replacement or supersession outputs,
whether live UI is involved, and whether automatic replay is allowed.

Guided Recovery can run only read-only/report-only/planning checks and existing
non-mutating dry-runs. It must report these flags as false:
`mutates_record`, `writes_replacement_record`,
`writes_supersession_index_entry`, `executes_repair`, `executes_actions`,
`runs_recommended_commands`, `applies_patches`, `uses_live_ui`,
`uses_browser`, `uses_native_ax`, `uses_canvas`, `starts_workflow_engine`,
`auto_resumes`, and `automatic_replay_allowed`.

## Repair Recovery Bundle V0

Recovery Bundle is an operator handoff artifact over Guided Recovery. It
materializes non-mutating guide/report/planning outputs under an explicit
`--output-root` so a later session can continue from files and descriptors
without hidden stdout redirection or shell inference. The public command is:

```bash
aos work-record repair bundle <id-or-path> --output-root <dir> \
  [--profile id] [--root path ...] \
  [--authorization path|--gate-record id-or-path|--resume-event path|--continuation-id id] \
  [--attempt-plan path] [--attempt-artifact path] \
  [--replacement-root dir] [--index-root dir] [--dry-run] [--json]
```

The envelope type is `work_record.repair_recovery_bundle` with schema version
`2026-07-work-record-repair-recovery-bundle-v0`. It includes status, mode
(`dry_run` or `write`), source Work Record identity, output root, guide report
path, manifest path, planned/written/skipped artifact arrays, conflicts,
diagnostics, non-execution flags, the next recommended command descriptor, and
`recovery_summary`.

Recovery Bundle V0 is greenfield and has no legacy compatibility contract.
Current writer output is the contract. Same-schema manifests missing canonical
required `non_execution_flags` such as `mutates_record`, `writes_bundle`, or
`repairs_bundle` are invalid. Old generated smoke/test bundle directories
should be regenerated, not accepted through inspector compatibility. Any future
compatibility support requires an explicit schema/versioned migration stance.

The bundle may write only `bundle-manifest.json`, `guide-report.json`,
`commands/*.json`, and JSON stdout artifacts explicitly described by guide
descriptors such as `artifacts/gate-request.json` and
`artifacts/repair-attempt-plan.json`. Finalization dry-run and supersession
lookup stay explicit follow-up command descriptors only; the bundle is not a
finalizer or supersession lookup runner and does not materialize their reports.
Every artifact entry carries relative path, absolute path, artifact kind,
digest, producer, downstream consumers, write mode, bytes-known-at-plan-time,
existence, and conflict status. Written artifacts add write status.

Bundled descriptors are rebound to bundle-local artifact paths when those
artifacts are materialized: `stdout_artifact.path`, `save_stdout_to`, and
`requires_saved_output_from` agree, and descriptors carry
`not_run_by_bundle:true` plus `bundle_artifact_status` of `materialized`,
`planned_only`, `missing_input`, or `not_applicable`. No descriptor may imply a
file exists when the bundle did not write or plan the corresponding artifact.

Dry-run writes nothing and reports the exact planned file set. Write mode is
idempotent for identical existing files and fails closed for conflicting files,
path traversal, symlinked output roots, symlinked not-yet-created output-root
ancestors, symlinked bundle child paths, output-root file conflicts, and
source-record mutation. The bundle must never write replacement Work Records,
Source Supersession Index entries, source Work Records, gate records, gate
responses, Repair Attempt Artifacts, arbitrary patch output, or anything
outside `--output-root`. It must never run repair execution, repair
finalization, replacement writes, supersession lookup, supersession writes,
`aos gate` submission commands, `aos do`, browser/native AX/canvas/TCC
surfaces, replay, auto-resume, or a Workflow engine.

## Repair Recovery Bundle Lifecycle Status V0

Recovery Bundle Lifecycle Status is a read-only status index over explicitly
named Recovery Bundle roots. It is not a registry, crawler, recovery runner, or
persistent status store. The public command is:

```bash
aos work-record repair bundle status \
  --bundle-root <dir> [--bundle-root <dir> ...] \
  [--bundle-parent <dir> ...] [--json]
```

The envelope type is
`work_record.repair_recovery_bundle_lifecycle_status` with schema version
`2026-07-work-record-repair-recovery-bundle-lifecycle-status-v0`. It includes
status, bundle counts, `valid_count`, `ready_count`, `blocked_count`,
`invalid_count`, `missing_count`, `unsupported_count`, `finalized_count`,
`unknown_count`, the supplied roots, immediate-child roots derived from
explicit parents, `attention_queue`, `attention_summary`, per-bundle
summaries, diagnostics, and the canonical non-execution flags.

Discovery is intentionally bounded. Allowed candidates are exact
`--bundle-root` paths and immediate children of explicit `--bundle-parent`
directories that contain `bundle-manifest.json`. Parent scanning is
non-recursive and operator-owned. The command must not perform global search,
recursive home/tmp/repo scans, shell-glob expansion, root inference from Work
Record ids, manifest-driven discovery, registry writes, or status index writes.
Without at least one `--bundle-root` or `--bundle-parent`, it fails with a
structured missing-input diagnostic.

Every candidate bundle is inspected through the existing Recovery Bundle
Inspector. Lifecycle Status does not reimplement bundle validation. Missing and
invalid bundle roots remain represented in the same report so one bad root does
not abort the whole status index. Per-bundle summaries include bundle root,
canonical bundle root, inspection status, lifecycle status, source Work Record
identity, guide stage and stage status, continuation readiness, next command
id, exact next `argv` when the inspected bundle is validated enough to continue
and required saved outputs are present, whether the next command mutates state,
user-approval requirements, required saved-output presence, missing saved
outputs, and diagnostics.
Each row also includes `recovery_summary` with the row lifecycle state, guide
stage, exact next `argv`, missing inputs, missing saved outputs, and safety
flags, so agents can choose the next bundle without scanning the whole status
envelope.
The top-level `attention_queue` is a compact read-only queue derived from those
final per-bundle rows. It ranks `ready`, `blocked`, `missing`, `invalid`,
`unsupported`, `unknown`, then `finalized`, with deterministic ordering by
`canonical_bundle_root` within the same state. Queue items include rank, bundle
root, canonical bundle root, lifecycle state, attention label, short reason,
source Work Record identity, guide stage and status, structured next command
data, missing inputs, missing saved outputs, and diagnostic codes.
`attention_summary` exposes the first queue item and per-state counts. The
queue must not inspect bundle files, execute commands, write files, submit
gates, finalize, repair, replay, mutate source/replacement/supersession state,
or scan globally. It exposes `next.argv` only when the source row is `ready`,
has `continuation_ready:true`, has required saved outputs present, and already
has a validated row `next_argv`; invalid, missing, unsupported, unknown,
finalized, and non-continuable blocked rows expose an empty `next.argv`.

Lifecycle statuses are `ready`, `blocked`, `invalid`, `missing`,
`unsupported`, `finalized`, and `unknown`. A valid inspection with a safe next
descriptor and all required saved outputs present is `ready`; a valid
inspection with missing inputs or saved outputs is `blocked`; nonexistent
candidate roots are `missing`; unsupported schemas are `unsupported`; invalid
bundle structure is `invalid`; saved finalized guide state is `finalized`.

Lifecycle Status is read-only. It writes nothing, repairs nothing, executes no
commands or actions, runs no recommended commands, writes no replacement Work
Record or supersession entry, mutates no source record, uses no live UI,
browser/native AX/canvas/TCC surface, applies no patches, starts no Workflow
engine, and never auto-resumes or replays.

## Repair Recovery Bundle Inspection V0

Recovery Bundle Inspection is a read-only validation envelope over an existing
Recovery Bundle directory. The public command is:

```bash
aos work-record repair bundle inspect <bundle-root> [--json]
```

The envelope type is `work_record.repair_recovery_bundle_inspection` with
schema version
`2026-07-work-record-repair-recovery-bundle-inspection-v0`. It includes
status, explicit bundle root, canonical bundle root, manifest summary, guide
report summary, artifact validation summaries, descriptor validation summaries,
continuation summary, diagnostics, and non-execution flags.
The inspection envelope also includes `recovery_summary`, derived from the
validated manifest, guide report, descriptors, artifact checks, continuation,
and diagnostics.

The inspector reads only the explicit bundle root by default. It validates that
the root exists, is a directory, is not a symlink, and is not reached through a
symlinked ancestor. Every file or directory the inspector reads must stay under
the canonical bundle root and must not be a symlink. Manifest artifact paths
must be relative bundle paths and each recorded artifact path must exactly match
the writer-owned path resolved from `relative_path`. The inspector uses the
resolved `relative_path` target for file existence and digest checks, so an
independent manifest path claim cannot mask or redirect validation. Existing
materialized artifacts must match their manifest digest.

The inspector validates manifest `non_execution_flags` against the same
no-execution policy as the bundle contract. Missing required flags, non-boolean
values, boolean `true` values, and unknown non-false execution/write/live/replay
claims fail closed with diagnostics naming the offending flags and values. The
inspector's own clean non-execution flags do not override contradictory manifest
claims.

The inspector validates `bundle-manifest.json`, `guide-report.json`,
`commands/*.json`, descriptor `id`, `argv`, `command`, `not_run_by_guide:true`,
`not_run_by_bundle:true`, `stdout_artifact.path`/`save_stdout_to` consistency,
`requires_saved_output_from` presence, and `bundle_artifact_status`.
`materialized` requires a matching existing artifact; `planned_only` does not
imply a file exists. Forbidden bundle-owned outputs such as
`reports/finalization-dry-run.json`, `reports/supersession-lookup.json`,
`repair-attempt-artifact.json`, `replacement-records/**`,
`source-supersession-index/**`, `gate-record*.json`, and
`gate-response*.json` block continuation.

Continuation output reports the saved guide stage, safe next descriptor id,
exact `argv`, required saved-output presence, missing artifact paths, whether
human approval is required, whether the next command would mutate state, and a
reminder that the inspector did not run the command. Invalid, missing,
unsupported, unknown, and incomplete bundle-owned artifact or descriptor states
sanitize top-level `continuation` executable fields and report no executable
`recovery_summary.next.argv`. The inspector never writes
or repairs bundle files, never re-runs guide/planning, never submits gates,
never executes repair, finalization, replacement writing, supersession lookup
or writing, replay, Workflow engine work, live UI, browser, native AX, canvas,
screenshots, coordinates, or TCC proof.

## Controlled Repair Executor Result V0

The Controlled Repair Executor is the first explicit Work Record repair executor
slice. It consumes a ready Repair Attempt Plan, selects exactly one planned
operation registered by an injected operation registry, runs it only under an
explicit existing execution root, writes a Repair Attempt Artifact under an
explicit existing artifact root, and returns an executor result envelope. The
current public command wires a clearly named fixture registry for repo-owned
deterministic file-fixture operations; those fixture descriptors are not the
product repair abstraction. It is not a browser, native AX, canvas, live UI,
coordinate, screenshot, image matching, TCC-gated, arbitrary shell, generic
patch, Workflow engine, or auto-resume executor.

The toolkit result contract is `work_record.controlled_repair_executor_result`
with schema version
`2026-07-work-record-controlled-repair-executor-result-v0`. The envelope
includes:

```json
{
  "type": "work_record.controlled_repair_executor_result",
  "schema_version": "2026-07-work-record-controlled-repair-executor-result-v0",
  "status": "succeeded",
  "mode": "execute",
  "repair_attempt_plan": {},
  "source_work_record": {},
  "execution": {},
  "operation_outcomes": [],
  "artifact": {},
  "artifact_validation": {},
  "finalization": {},
  "side_effects": [],
  "mutates_execution_root": true,
  "mutates_source_record": false,
  "executes_repair": true,
  "would_execute_repair": false,
  "executes_actions": false,
  "uses_live_ui": false,
  "uses_browser": false,
  "uses_native_ax": false,
  "uses_canvas": false,
  "applies_patches": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported executor statuses include `dry_run`, `succeeded`, `failed`,
`partial`, `aborted_precondition`, `blocked_plan_not_ready`,
`blocked_authorization`, `blocked_unsupported_operation`,
`blocked_unsafe_command`, `blocked_workspace_escape`, `blocked_timeout`,
`artifact_invalid`, `finalize_blocked`, `cleanup_failed`, `rollback_failed`,
and `unsupported`. Dry-run reports direct argv command identity, roots,
artifact path, timeout, allowed mutations, cleanup/rollback plan, and expected
side effects without executing. Execute mode uses `shell:false`, deterministic
environment keys, bounded stdout/stderr capture, timeout enforcement, explicit
phase snapshots (`before`, `after_primary`, optional `after_cleanup`, optional
`after_rollback`, and `final`), cleanup and rollback result records, source Work
Record immutability checks, artifact writing, and artifact validation. Final
digest and file-change evidence must identify its phase range and compare
`before..final`, not a pre-cleanup or pre-rollback snapshot.

Source Work Records remain immutable. Replacement writing and Source
Supersession Index writing are separate explicit contracts and are not implied
by executor success. Executor finalization is deferred for this V0 public
command surface.

## Repair Attempt Artifact V0

A Work Record Repair Attempt Artifact records outcome data after a future
explicit repair attempt. It is the receiving artifact for what was attempted,
what actually happened, which evidence was produced, what cleanup or rollback
reported, and what the current verifier health says before and after the
attempt. It is not an executor, replay engine, patch applier, replacement Work
Record minter, or proof by itself.

The toolkit contract is `work_record.repair_attempt_artifact` with schema
version `2026-07-work-record-repair-attempt-artifact-v0`. The envelope includes:

```json
{
  "type": "work_record.repair_attempt_artifact",
  "schema_version": "2026-07-work-record-repair-attempt-artifact-v0",
  "status": "succeeded",
  "source_work_record": {},
  "repair_plan": {},
  "workflow_gate_authorizations": [],
  "repair_attempt_plan": {},
  "attempt_artifact_identity": {},
  "executor": {},
  "timing": {},
  "planned_operations": [],
  "operation_outcomes": [],
  "candidate_patch_outcomes": [],
  "recommended_command_outcomes": [],
  "evidence_refs": [],
  "verifier_before": {},
  "verifier_after": {},
  "final_health": {},
  "postcondition_results": [],
  "cleanup_results": [],
  "rollback_results": [],
  "source_work_record_mutation_check": {},
  "source_work_record_mutated": false,
  "rewrites_historical_evidence": false,
  "automatic_replay_allowed": false,
  "executor_implemented": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported artifact statuses are `succeeded`, `failed`, `partial`,
`aborted_precondition`, `blocked_authorization`, `blocked_plan_mismatch`,
`cleanup_failed`, `rollback_failed`, `invalid_artifact`, and `unsupported`.
Operation outcomes are data records with `planned_operation_id`, `status`,
timing, mutation boundary, authorization ref, evidence refs, stdout/stderr or
exit-status refs when relevant, cleanup flags, rollback flags, and diagnostics.
Candidate patch outcomes must distinguish described, applied, rejected, failed,
rolled-back, and validation evidence states. Recommended command outcomes must
distinguish command identity, executed/skipped status, exit code or signal,
stdout/stderr artifact refs, duration, mutation boundary, and cleanup or
rollback expectations.

The validator fails closed. Success requires matching source Work Record
identity, matching Repair Plan and Repair Attempt Plan digests, planned-vs-actual
operation matching, required evidence refs, passed postconditions, passed or
not-required cleanup, unchanged source Work Record, and final health derived
from `verifier_after` when present. Partial, cleanup-failed, rollback-failed,
missing-evidence, verifier-failed, mismatched-operation, stale-plan,
wrong-record, wrong-authorization, and source-record-mutated cases cannot be
reported as success.

Repair Attempt Artifacts must report mutation and replay facts honestly:
`source_work_record_mutated:false`, `rewrites_historical_evidence:false`,
and `automatic_replay_allowed:false`. The deterministic fixture builder consumes
explicit outcome JSON and emits an artifact with `executor_implemented:false`;
it does not execute repair, replay actions, apply patches, run recommended
commands, auto-resume, mutate source Work Records, or mint replacement Work
Records. A Controlled Repair Executor artifact may report
`executor_implemented:true` only when `executor.kind` is
`controlled_repair_executor` and the artifact validates against the same
planned-operation, required-evidence, cleanup/rollback, verifier-health, and
source-immutability checks. Replacement Work Record minting remains a separate
future product surface.

## Replacement Proposal V0

A Replacement Proposal turns a source Work Record, Repair Attempt Plan, and
validated Repair Attempt Artifact into a candidate replacement Work Record
shape. It is a proposal layer only: it does not write a replacement Work
Record, mutate the source Work Record, rewrite historical evidence or
`claim_results[]`, run repair, replay actions, apply patches, run recommended
commands, or auto-resume agents.

The toolkit contract is `work_record.replacement_proposal` with schema version
`2026-07-work-record-replacement-proposal-v0`. The envelope includes:

```json
{
  "type": "work_record.replacement_proposal",
  "schema_version": "2026-07-work-record-replacement-proposal-v0",
  "status": "proposed",
  "source_work_record": {},
  "repair_attempt_plan": {},
  "repair_attempt_artifact": {},
  "replacement_proposal_identity": {},
  "proposed_replacement_work_record": {},
  "supersedes": {},
  "carried_forward_evidence": [],
  "new_evidence": [],
  "postcondition_evidence_map": [],
  "omitted_evidence": [],
  "claim_provenance": [],
  "verifier_before": {},
  "verifier_after": {},
  "final_proposed_health": {},
  "source_work_record_mutation_check": {},
  "writes_replacement_record": false,
  "mutates_source_record": false,
  "rewrites_historical_evidence": false,
  "executes_repair": false,
  "executes_actions": false,
  "applies_patches": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported proposal statuses are `proposed`, `not_required`,
`blocked_attempt_failed`, `blocked_attempt_partial`,
`blocked_missing_evidence`, `blocked_source_mutated`,
`blocked_health_mismatch`, `stale`, `mismatch`, and `unsupported`.

`replacement_proposal_identity` is stable over source Work Record identity and
digest, Repair Attempt Plan schema/version/digest, Repair Attempt Artifact
schema/version/digest, proposed replacement Work Record id seed, carried-forward
evidence ids, new evidence ids, and final proposed health. Supersession is
proposed metadata only: the source Work Record must not be edited to say it is
superseded, and a future writer is required before any replacement exists as
product state.

Evidence transfer is explicit. `carried_forward_evidence[]` must trace to
source Work Record `evidence[]` and include a carry reason. `new_evidence[]`
must trace to the Repair Attempt Artifact or its declared outputs and map to
candidate replacement evidence ids. `postcondition_evidence_map[]` carries the
per-postcondition evidence refs into the proposed replacement shape so the
writer materializes only the evidence that proves each postcondition; semantic
target metadata must stay scoped to the evidence/postcondition it supports.
`omitted_evidence[]` must include an omit reason and replacement impact.
Proposed claim provenance must state that historical Claim Results were not
rewritten.

The validator checks consistency and provenance rather than replacing verifier
policy. `proposed` requires a valid source Work Record identity, matching
Repair Attempt Plan, validated succeeded Repair Attempt Artifact, unchanged
source Work Record digest, verifier-after health matching final proposed
health, required new evidence refs, explicit carried-forward evidence policy,
and a structurally plausible proposed replacement shape marked
`persisted:false`. Failed, partial, cleanup-failed, rollback-failed,
missing-evidence, verifier-contradicted, mismatched-plan, wrong-source,
source-mutated, and unsupported artifacts fail closed.

## Replacement Writer V0

The Replacement Writer is the controlled persistence step after a validated
Replacement Proposal. It writes only the proposed replacement Work Record under
an explicit output root; it is not a repair executor, replay executor, patch
applier, Workflow engine, source-record supersession writer, or auto-resume
surface.

The toolkit result contract is `work_record.replacement_writer_result` with
schema version `2026-07-work-record-replacement-writer-result-v0`. The envelope
includes:

```json
{
  "type": "work_record.replacement_writer_result",
  "schema_version": "2026-07-work-record-replacement-writer-result-v0",
  "status": "written",
  "mode": "write",
  "replacement_proposal": {},
  "source_work_record": {},
  "written_replacement_work_record": {},
  "output": {},
  "idempotency": {},
  "source_immutability_check": {},
  "atomic_write": {},
  "side_effects": [],
  "writes_replacement_record": true,
  "would_write_replacement_record": false,
  "mutates_source_record": false,
  "rewrites_historical_evidence": false,
  "executes_repair": false,
  "executes_actions": false,
  "applies_patches": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported statuses are `dry_run`, `written`, `already_exists`,
`blocked_invalid_proposal`, `blocked_invalid_replacement_record`,
`blocked_source_changed`, `blocked_output_escape`, `blocked_conflict`,
`blocked_write_failed`, `blocked_cleanup_failed`, and `unsupported`.
`writes_replacement_record:true` is valid only for `written` and
`already_exists`; `dry_run` reports `would_write_replacement_record:true`
without writing.

The writer requires `output_root` for every write or dry-run. An optional
`output_path` must remain under `output_root` and use the deterministic filename
derived from the replacement Work Record id. The writer rejects traversal and
symlink escape, creates missing directories only below the explicit root,
writes through a temporary file plus atomic rename, removes the temp file on
success, reports cleanup failures explicitly, treats identical existing content
as idempotent `already_exists`, and refuses different existing content as
`blocked_conflict`.

Successful writes expose `recommended_next.argv` for reading the written
replacement Work Record. `recommended_next.command_hint` is display-only
shell-quoted text derived from that argv; execute the argv directly and do not
parse the display string.

Before writing, the writer validates the Replacement Proposal, materializes the
proposed replacement as a Work Record v0 shape, validates the materialized shape
with the existing report-only verifier/profile expectations, and rechecks the
source Work Record digest when source path and digest are present. A digest
mismatch returns `blocked_source_changed`; the source Work Record is never
edited.

The written replacement Work Record has a stable id and provenance metadata
linking source Work Record, Replacement Proposal, Repair Attempt Plan, and
Repair Attempt Artifact. It carries forward source evidence only through the
proposal policy, includes new evidence from the Repair Attempt
Artifact/proposal, records supersession on the replacement record only, and does
not claim that repair, replay, recommended commands, candidate patches,
cleanup/rollback, or source-record supersession happened during the write.

## Source Supersession Index V0

The Source Supersession Index is the external discovery layer after a
Replacement Writer result exists. It records that a source Work Record has a
known replacement Work Record without editing either record. The index lives
only under an explicit `index_root`; there is no implicit repo write and no
global Work Record database.

The entry contract is `work_record.source_supersession_entry` with schema
version `2026-07-work-record-source-supersession-index-v0`. The envelope
includes:

```json
{
  "type": "work_record.source_supersession_entry",
  "schema_version": "2026-07-work-record-source-supersession-index-v0",
  "status": "active",
  "source_work_record": {},
  "replacement_work_record": {},
  "relationship": "superseded_by",
  "relationship_status": "active",
  "supersession_entry_identity": {},
  "replacement_writer_result": {},
  "replacement_proposal": {},
  "source_immutability_check": {},
  "index_root": "/tmp/work-record-index",
  "index_path": "/tmp/work-record-index/source-supersession/v0/source/entry.json",
  "created_at": "2026-07-04T00:00:00.000Z",
  "metadata": {},
  "mutates_source_record": false,
  "mutates_replacement_record": false,
  "executes_repair": false,
  "executes_actions": false,
  "applies_patches": false,
  "automatic_replay_allowed": false,
  "diagnostics": []
}
```

Writer result statuses are `dry_run`, `written`, `already_exists`, `conflict`,
`blocked_invalid_source`, `blocked_invalid_replacement`,
`blocked_source_changed`, `blocked_relationship_mismatch`,
`blocked_index_escape`, `blocked_write_failed`, `blocked_cleanup_failed`, and
`unsupported`. Entry and lookup relationship statuses are `active`,
`not_found`, `already_exists`, `conflict`, `malformed_index`, and the same
blocked statuses where applicable.

The writer accepts explicit source and replacement Work Record refs plus an
explicit index root. It validates both Work Record identities, verifies the
replacement record declares that it supersedes the source, checks source
id/digest against Replacement Writer provenance when available, rejects
traversal and symlink escape, writes one deterministic entry file through a
temp file plus atomic rename, removes the temp file on success, treats
byte-equivalent or semantically equivalent existing entries as idempotent
`already_exists`, and refuses conflicting source-to-replacement relationships.
Dry-run reports the exact index path, source identity, replacement identity,
idempotency result, planned atomic write, and side effects without writing.

Lookup is read-only. It accepts a source Work Record ref and explicit
`index_root`, scans only that root, reports `not_found` for missing index data,
reports malformed entry data as `malformed_index`, and returns source id,
source digest when available, replacement id/path/digest, relationship status,
and replacement readback state. `--replacement-root` is optional; without a
replacement root, lookup reports `replacement_readback.status:index_only`,
`read_proven:false`, and does not claim the replacement is readable. With one
or more replacement roots, lookup attempts root-backed replacement readback and
reports `replacement_readback.status`, `read_proven`, resolved root/path/digest
when available, and diagnostics.

Root-backed lookup can return `readable`, `not_found`, `digest_mismatch`,
`id_mismatch`, or `path_mismatch` for `replacement_readback.status`.
Replacement readback failures surface on the lookup envelope as
`blocked_invalid_replacement` rather than as fully proven active readable
relationships. A readable replacement exposes `recommended_next.argv`, an
executable direct argv array such as `["./aos", "work-record", "read", "<id>",
"--root", "<root>", "--json"]`; `recommended_next.command_hint`, when present,
is shell-quoted display text derived from that argv and is not the execution
contract. Supersession write results use the same structured recommendation
shape for the follow-up lookup. Supersession lookup is external discovery
metadata; it is not verifier health and does not mean the source Work Record
was mutated.

## Repair Finalization Result V0

Repair Finalization V0 is a bounded composition/write step after an
already-produced successful Repair Attempt Artifact. It does not introduce a
Workflow engine, arbitrary executor, replay runner, patch applier, source
mutation path, recommended-command runner, live UI proof path, or auto-resume
loop. It composes the existing lower-level contracts:

```text
Repair Attempt Artifact -> Replacement Proposal -> Replacement Writer -> Source Supersession Index -> Finalization Result
```

The result contract is `work_record.repair_finalization_result` with schema
version `2026-07-work-record-repair-finalization-result-v0`. The envelope
includes:

```json
{
  "type": "work_record.repair_finalization_result",
  "schema_version": "2026-07-work-record-repair-finalization-result-v0",
  "finalizer_implementation_version": "2026-07-work-record-repair-finalizer-v0",
  "status": "finalized",
  "mode": "write",
  "dry_run": false,
  "writes_replacement_record": true,
  "writes_supersession_index_entry": true,
  "wrote_replacement_record": true,
  "replacement_record_already_existed": false,
  "would_write_replacement_record": false,
  "wrote_supersession_index_entry": true,
  "supersession_index_entry_already_existed": false,
  "would_write_supersession_index_entry": false,
  "source_work_record": {},
  "repair_attempt_plan": {},
  "repair_attempt_artifact": {},
  "replacement_proposal": {},
  "replacement_writer_result": {},
  "supersession_index_result": {},
  "readback": {},
  "side_effects": [],
  "executes_repair": false,
  "executes_actions": false,
  "uses_live_ui": false,
  "uses_browser": false,
  "uses_native_ax": false,
  "uses_canvas": false,
  "applies_patches": false,
  "mutates_source_record": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recovery": {},
  "recommended_next": {}
}
```

Supported statuses are `dry_run`, `finalized`, `already_finalized`,
`not_required`, `blocked_invalid_source`, `blocked_invalid_attempt_plan`,
`blocked_invalid_attempt_artifact`, `blocked_attempt_not_successful`,
`blocked_missing_evidence`, `blocked_source_mutated`,
`blocked_health_mismatch`, `blocked_replacement_proposal`,
`blocked_replacement_write`, `blocked_supersession_write`,
`blocked_path_escape`, `blocked_conflict`, `partial_finalized`, `stale`,
`mismatch`, and `unsupported`.

Dry-run validates the source, attempt plan, attempt artifact, proposal,
Replacement Writer dry-run path, and Source Supersession Index plan, reports
the intended replacement and supersession outputs when they can be computed
safely, and writes nothing. Execute mode preflights both durable outputs before
the replacement write, then writes only the replacement Work Record under the
explicit replacement root and the source supersession entry under the explicit
index root. The source Work Record bytes must be unchanged before and after
finalization.

`finalized` requires a valid source, valid Repair Attempt Plan, validated
succeeded Repair Attempt Artifact, valid Replacement Proposal, durable
schema-valid replacement Work Record, durable valid Source Supersession Index
entry, active supersession lookup, and unchanged source digest.
`already_finalized` is the idempotent status for matching replacement and
supersession outputs that already exist. `partial_finalized` is a failure
status used only after preflight when a replacement has been written but the
supersession entry is missing or invalid; recovery must be explicit through
`supersession write`. Preflightable invalid roots, path escapes, relationship
mismatches, and writer-result provenance mismatches must fail before durable
finalization writes begin.

Finalization recovery guidance is structured. `finalized` and
`already_finalized` expose argv-backed recommendations for supersession lookup
and replacement read. `partial_finalized` exposes an argv-backed recommendation
for `supersession write`. Any `command_hint` is display-only shell-quoted text
derived from argv; consumers execute argv directly and do not parse display
strings.

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
and immutable artifact refs. For saved-ref evidence it may also record the
full `see --save -> do ref --dry-run -> do ref -> see --save ->
diff/readback -> cleanup` bridge. Direct browser/canvas evidence may store a
Target-with-Ref, saved-ref evidence preserves the Saved Ref plus resolved
underlying target and current-validation metadata, and native AX evidence
preserves its selector bridge descriptor. The builder stores the selected
action target in `execution_map.steps[].action`, stores before/dry-run/action/
after/cleanup receipts in `evidence[]` when present, and ties the post-action
Postcondition to the after-perception evidence.

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

When a source-backed recipe uses repeatable
`aos see refs --diff <from>..<to> --expect-ref <ref>=...` as a compact
postcondition step, the Work Record boundary stays the same. The recipe result
or command stdout can be stored as immutable evidence, the Postcondition can
reference the expected `diff.ref_expectation` or `diff.ref_expectations[]`
fields, and the Claim Result can cite that evidence. The Work Record must not
treat the recipe step as a
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
patch execution maps, replay actions, or repair refs.

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

## Consumption And Recovery

`packages/toolkit/workbench/work-record-consumer.js` and the public
`aos work-record` command provide the first model-facing Work Record consumer.
The surface is read-only and supports:

- `list` over canonical fixtures or explicit `--root` files/directories;
- `read` by Work Record id, Subject Entry Handle, or JSON path;
- `verify` with `aos.verifier.work-record.v0.report-only`;
- `status` for current report-only health, diagnostics, evidence refs, and
  recovery guidance;
- `plan-repair` for read-only Repair Plan output;
- `gate-request` and `gate-check` for Workflow Gate Authorization;
- `plan-attempt` for non-executing Repair Attempt Plan output;
- `repair guide` for a read-only Guided Recovery report across status,
  planning, authorization, attempt artifact, finalization dry-run, and
  supersession lookup state;
- `repair bundle` for a controlled output-root handoff bundle of non-mutating
  guide artifacts, rebound command descriptors, and safe planning artifacts;
- `repair bundle inspect` for read-only validation and continuation summary of
  an existing recovery bundle root;
- `attempt-artifact validate` and `attempt-artifact build` for read-only Repair
  Attempt Artifact validation and fixture/outcome artifact generation;
- `export` for a compact read-only evidence bundle manifest.

The consumer distinguishes embedded historical `claim_results[]` and
`health.verdict` from the fresh report-only verifier output. `status` exposes
`embedded_record_health`, `current_report_status`, and report-derived
`health_verdict`; failed current diagnostics cannot report current health as
`valid` merely because embedded health was optimistic. It fails closed for
unsupported schema versions, invalid V0 contract shapes, missing roots, invalid
JSON, and id-based
consumption when duplicate ids make a ref ambiguous. It does not mutate Work
Records, patch execution maps, repair refs, rewrite Claims, replay actions, or
inline heavy UI payloads.

`attempt-artifact validate` validates existing
`work_record.repair_attempt_artifact` JSON. `attempt-artifact build` consumes
explicit fixture/outcome input and emits deterministic artifact JSON. Both
surfaces report `read_only:true`, `mutates_state:false`,
`executes_repair:false`, `executes_actions:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`.

Recovery guidance covers all Verifier Health verdicts. `valid` recommends no
repair or redundant proof loop; `stale` and `repairable` point to
re-perception/re-resolution or explicit workflow gates; `blocked` names missing
evidence, permission, runtime, cleanup, or postcondition blockers; and
`impossible`, `superseded`, and `retired` do not offer replay as the next step.

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
- [`valid/saved-ref-browser-fill-or-canvas-set-value.json`](fixtures/aos-work-record-v0/valid/saved-ref-browser-fill-or-canvas-set-value.json)
  is generated from
  [`evidence/saved-ref-browser-fill-or-canvas-set-value.json`](fixtures/aos-work-record-v0/evidence/saved-ref-browser-fill-or-canvas-set-value.json).
  It records a saved-ref browser fill with before saved capture, dry-run,
  dispatch, after saved capture/readback, cleanup evidence, backend/strategy/
  fallback metadata, selected Saved Ref, resolved target, recommended next
  capture command, and health `valid`.
- [`valid/repairable-stale-saved-ref.json`](fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json)
  preserves stale saved-ref dry-run/action evidence and classifies health
  `repairable`; repair policy points to re-perceive and re-resolve under an
  explicit workflow gate.
- [`valid/cleanup-or-postcondition-failed.json`](fixtures/aos-work-record-v0/valid/cleanup-or-postcondition-failed.json)
  preserves successful action evidence plus failed cleanup evidence and
  classifies health as `blocked` without rewriting historical evidence.
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

The guarded-live proof harness
`tests/manual/cross-backend-saved-ref-regression-proof.sh` emits the same
record shape for a controlled browser saved-ref fill when
`AOS_SAVED_REF_PROOF_MODE=guarded-live`. The Work Record lives under the proof
root at `browser/work-record/fill-work-record.json`; companion source,
verifier, and summary artifacts stay beside it. That harness is proof
production, not a public recorder command.

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
