# AOS Supervised Run v0 Sketch

Status: schema-backed design sketch. The JSON Schema in
[`aos-supervised-run-v0.schema.json`](aos-supervised-run-v0.schema.json)
validates example fixtures under
[`fixtures/aos-supervised-run-v0/`](fixtures/aos-supervised-run-v0/).

## Purpose

A Supervised Run coordinates one bounded piece of agent work while a human can
observe, steer, confirm, fail, block, or annotate the run. It is a
coordination/event layer, not the durable evidence artifact for the run.

The durable artifact remains Work Record v0. A Supervised Run may carry
Work Record-compatible `evidence:*` references and handoff metadata for a later
Work Record builder, but it does not duplicate Work Record `evidence[]`,
Claims, Postconditions, Claim Results, Verifier Reports, or Health. Workflows
own orchestration, and `aos.step_descriptor` descriptors may carry
compatibility step metadata for a gated harness; a Supervised Run records the
bounded coordination state for one attempt.

## Top-Level Shape

```json
{
  "type": "aos.supervised_run",
  "schema_version": "2026-05-supervised-run-v0",
  "id": "supervised-run:<stable-id>",
  "label": "Human label",
  "created_at": "2026-05-06T18:00:00Z",
  "completed_at": "2026-05-06T18:01:00Z",
  "status": "completed",
  "operating_path": "agent/dev/testing/headed/real-input/hitl-sidecar",
  "origin": {},
  "references": [],
  "intent": {},
  "timeline_transport": {},
  "timeline": [],
  "steps": [],
  "human_responses": [],
  "evidence_refs": [],
  "work_record_projection": {},
  "metadata": {}
}
```

`operating_path` is required because the run's authority, sensors, and
verification obligations are part of the contract. A future console can present
the same run as a test, collection review, or workflow collaboration surface,
but the persisted contract should not use old standalone `test.*` event names.

## Timeline Events

`timeline[]` is an ordered event timeline. Each entry has an integer
`sequence`, a generic `supervised.*` event type, an ISO timestamp, and a typed
source. The array form is the checked-in fixture shape; the same events are
suitable for single-writer JSONL transport by serializing one timeline event per
line in sequence order.

The v0 event names are reusable across projections:

```text
supervised.run.started
supervised.step.started
supervised.step.instruction
supervised.step.expectation
supervised.step.automated_check
supervised.human.requested
supervised.human.confirmed
supervised.human.failed
supervised.human.blocked
supervised.human.note
supervised.step.completed
supervised.run.completed
```

The schema also permits `supervised.run.failed` and `supervised.run.blocked` so
failed or blocked runs do not need test-specific names later. Step, check, human
request, human response, and completion events carry refs back into the
structured run state.

## Step State

`steps[]` stores the current state for each bounded supervised step:

- `instruction` is the human-readable action or observation request.
- `expectation` states what should be true after the step.
- `automated_checks[]` stores deterministic check summaries and
  Work Record-compatible evidence refs, not full Work Record evidence objects.
- `human_request` records the prompt and allowed response kinds.
- `human_response_refs[]` points at the first-class human response records.
- `completion` records the final step status and required evidence refs.

Completed runs require every step to be completed, and completed steps require
completion evidence refs. This keeps a run from claiming completion without the
step evidence needed by a later Work Record builder.

## Human Responses

`human_responses[]` is the canonical sidecar for human feedback in v0. A
response has one of four reusable kinds: `confirmed`, `failed`, `blocked`, or
`note`. Every response records:

- the step and human request it answers,
- the timeline event that captured it,
- author identity,
- source channel or fixture,
- response time,
- a summary,
- optional Work Record-compatible evidence refs.

Human feedback is first-class timeline evidence, but it is not a parallel truth
store. A later Work Record projection may promote a confirmation, failure,
blocker, or note into evidence, Claim Results, or verifier feedback using the
Work Record schema.

## Work Record And Step Descriptor Alignment

Supervised Runs align with Work Record v0 and Step Descriptor v0 by keeping the
boundaries explicit:

- A Workflow can be the orchestration origin for a run; `aos.step_descriptor`
  supplies step metadata under a gate, not the Work Record origin.
- A Supervised Run coordinates one bounded attempt and human feedback timeline.
- Work Record v0 remains the durable run artifact with immutable evidence,
  Claims, Postconditions, Claim Results, Verifier Report, and Health.

`evidence_refs[]` deliberately stores references such as `evidence:after-see`
instead of embedding Work Record evidence objects with URI, digest, immutable
metadata, or verifier payloads. `work_record_projection` is optional handoff
metadata for a future builder. It names the target Work Record schema, candidate
record id, projected evidence refs, and any Claim-promotion hints without
creating a second durable run-record format.

## Non-Goals

This v0 contract does not add a daemon-backed event channel, public
`aos test run` command, toolkit console UI, shell harness execution, replay,
repair, macro playback, live browser execution, or broad workbench rewrite.
Those are separate future slices and need explicit Workflow gates where they
touch execution.

## Examples

- [`valid/dry-run-human-confirmed.json`](fixtures/aos-supervised-run-v0/valid/dry-run-human-confirmed.json)
  shows a deterministic completed dry run with one automated check, one human
  confirmation, completion evidence refs, and optional Work Record projection
  metadata.
- [`invalid/missing-operating-path.json`](fixtures/aos-supervised-run-v0/invalid/missing-operating-path.json)
  is rejected because the operating path is required.
- [`invalid/malformed-human-response.json`](fixtures/aos-supervised-run-v0/invalid/malformed-human-response.json)
  is rejected because human responses must use the `confirmed`, `failed`,
  `blocked`, or `note` response kinds with author, source, and time.
- [`invalid/completed-without-step-evidence.json`](fixtures/aos-supervised-run-v0/invalid/completed-without-step-evidence.json)
  is rejected because completed runs cannot omit required step completion
  evidence.

Validate the contract with:

```sh
node --test tests/schemas/aos-supervised-run-v0.test.mjs
```
