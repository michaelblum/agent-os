# AOS Supervised Run v0 Sketch

Status: legacy schema-backed design sketch, retained for its own fixtures and
not active Work Record or Step Descriptor authority. The JSON Schema in
[`aos-supervised-run-v0.schema.json`](aos-supervised-run-v0.schema.json)
validates example fixtures under
[`fixtures/aos-supervised-run-v0/`](fixtures/aos-supervised-run-v0/).

## Purpose

A Supervised Run coordinates one bounded piece of agent work while a human can
observe, steer, confirm, fail, block, or annotate the run. It is a
coordination/event layer, not the durable evidence artifact for the run.

The active durable artifact is Work Record V1. This legacy Supervised Run V0
may carry `evidence:*` references and handoff metadata for its historical V0
projection, but it does not duplicate Work Record `evidence[]`, Claims,
Postconditions, Claim Results, Verifier Reports, or Health. Workflows own
orchestration. Active `aos.step_descriptor` V1 descriptors are neutral input to
a caller-selected harness; a Supervised Run records the bounded coordination
state for one attempt.

## ADR 0040 Transition Boundary

This schema and its harness contain no Gate field. Its actual migration debt is
`work_record_projection.target_schema`, which is fixed to the frozen
`2026-05-work-record-v0` contract. Active Work Record and Step Descriptor V1
readers do not consume or translate that projection. A future owner must either
migrate Supervised Run explicitly to the active neutral contracts or retire it;
this document does not promote the V0 projection to current authority.

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

`operating_path` records the run environment, available sensors, and
verification context; it is descriptive and grants no authority. A future
console can present the same run as a test, collection review, or workflow
collaboration surface, but the persisted contract should not use old standalone
`test.*` event names.

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

Supervised Run V0 predates the active Work Record and Step Descriptor V1
contracts. Its surviving boundaries are:

- A Workflow can be the orchestration origin for a run; an active
  `aos.step_descriptor` V1 supplies neutral step metadata to a caller-selected
  harness, not the Work Record origin or execution authority.
- A Supervised Run coordinates one bounded attempt and human feedback timeline.
- Work Record V1 is the active optional durable run artifact with immutable
  evidence, Claims, Postconditions, Claim Results, Verifier Report, and Health.

`evidence_refs[]` deliberately stores references such as `evidence:after-see`
instead of embedding Work Record evidence objects with URI, digest, immutable
metadata, or verifier payloads. `work_record_projection` is optional handoff
metadata for a future builder. In this V0 schema it names only the frozen
`2026-05-work-record-v0` target, candidate record id, projected evidence refs,
and Claim-promotion hints. No active V1 builder consumes or translates that
projection; keeping the fixture valid does not make it a current bridge.

## Non-Goals

This v0 contract does not add a daemon-backed event channel, public
`aos test run` command, toolkit console UI, shell harness execution, replay,
repair, macro playback, live browser execution, or broad workbench rewrite.
Those are separate future slices. This schema has no Gate field; any future
coordination layer may accept caller-selected Gates as neutral input, but AOS
must not require Gate as permission to execute.

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
