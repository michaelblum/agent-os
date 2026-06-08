# Decision Contract Descriptor And AFK Boundary

**Date:** 2026-05-21
**Status:** docs-only descriptor and boundary sketch

## Summary

A Decision Contract descriptor is docs-only vocabulary for now. It describes a
reusable judgment:

```text
given these inputs and this evidence, classify/choose/route this way
```

This note does not add a committed schema, migration, command behavior change,
transfer packet implementation, session trigger, provider dispatch, async
result route, work record, or evidence record. It separates what the descriptor
should own from the AFK primitives that would eventually launch sessions and
route results.

The descriptor is useful because the three mapped candidates now agree on the
same core shape:

- dev workflow routing is schema-backed and command-backed;
- transfer routing is docs-backed and emits composite route outputs;
- verification routing is docs-backed, role-sensitive, and current-state
  sensitive.

That is enough to write a design descriptor. It is not enough to promote a
generic `shared/schemas/decision-contract` contract.

## Descriptor Sketch

The design-only descriptor should contain stable metadata about the reusable
decision. It should not store launch packets, session lifecycle state, current
test output, live readiness, or historical run evidence.

| Field | Belongs in descriptor | Does not belong in descriptor |
| --- | --- | --- |
| `contract_id` | Stable handle for the reusable judgment, such as `dev-workflow-routing` or `foreman-transfer-routing`. | One-off work-card id, session id, job id, or evidence id. |
| `rule_ids` | Optional named rules inside the contract, such as manifest rule ids or route kinds. | Provider runtime ids or per-run branch names unless they are stable rule inputs. |
| `summary` | Human-readable decision boundary and what the contract chooses. | Long process history or transcript context. |
| `inputs` | Recompute-time facts the decision expects: changed paths, task kind, requested recipient, evidence need, selected manifest, runtime-state class. | Cached current branch, dirty files, concrete test output, or live TCC state from a prior run. |
| `source_authority_evidence` | Stable authority surfaces that define the decision: manifests, schemas, role docs, recipes, command contracts, tests, or design notes. | Run receipts, screenshots, terminal output, Slack messages, or human answers. |
| `current_state_evidence` | Kinds of volatile proof the decision must inspect at recompute time: git status, changed files, readiness state, command output, Operator report. | The actual current-state receipt; that belongs in an evidence record or work record. |
| `outputs` | Composite decision result shape: classes, actions, commands, verification requirements, recipients, stop conditions, packet fields, result-route requirements. | Delivery state, provider process handles, session lifecycle transitions, or notification attempts. |
| `consumers` | Agents, commands, docs, recipes, or future services that rely on the decision. | Current subscribers waiting for a specific async result. |
| `invalidation_triggers` | Source or policy changes that make the decision suspect: new file surfaces, changed role boundaries, new session primitive, changed TCC recovery policy. | A single failed run unless it proves the rule or authority changed. |
| `recompute` | Optional command or procedure for recomputing the decision, such as `./aos dev recommend --json` or "Foreman reads current dock docs and state." | Background scheduling, retry policy, or provider launch mechanics. |
| `backing_maturity` | Prose note or enum-like wording: schema-backed, command-backed, test-backed, docs-backed, recently validated, partial, exploratory. | Numeric confidence that suggests more precision than the evidence supports. |
| `validation_evidence` | Pointer to the design note, test run, audit output, commit, or evidence record that last proved the descriptor mapping. | Bare timestamp without saying what was inspected. |

The descriptor can be a standalone design note, an adapter around an existing
manifest, or later a source-backed descriptor. The near-term shape should favor
adapter references over migration.

## Adapter Examples

### Dev Workflow Router

`docs/dev/workflow-rules.json` should stay the dev workflow router manifest. A
Decision Contract adapter would reference it rather than migrate it:

```yaml
contract_id: dev-workflow-routing
rule_ids: docs/dev/workflow-rules.json#rules[*].id
inputs:
  - changed file paths
  - optional explicit file list
  - selected manifest path
source_authority_evidence:
  - docs/dev/workflow-rules.json
  - shared/schemas/dev-workflow-rules.schema.json
  - tests/schemas/dev-workflow-rules.test.mjs
  - tests/dev-workflow-router.sh
  - tests/dev-audit.sh
  - src/commands/dev.swift
outputs:
  - rule ids
  - classes
  - actions
  - commands
  - verification
  - notes
  - TCC sensitivity
  - hot-swappable flag
recompute: ./aos dev recommend --json
```

The adapter does not add `confidence`, `last_validated_at`, or broad consumer
metadata to the live router manifest. Those belong in notes, tests, audit
evidence, or a future descriptor surface after the generic shape has matured.

### Transfer Routing

Transfer routing would emit selected transfer-packet fields. The Decision
Contract descriptor owns the route rule and evidence authority; the packet owns
the selected launch context:

```yaml
contract_id: foreman-transfer-routing
inputs:
  - task shape
  - recipient or actor
  - source artifact
  - branch/base facts
  - workflow profile
  - blocker state class
  - evidence need
outputs:
  - transfer kind
  - recipient dock or actor
  - storage location
  - dispatch payload shape
  - branch/output expectations
  - stop conditions
  - result evidence requirements
```

A future transfer packet would carry the chosen `recipient`, `source_artifact`,
`required_start_ref`, `branch_policy`, `stop_conditions`,
`evidence_requirements`, and `result_route`. It should not carry the full role
docs or attempt to define Foreman/Implementer/Operator authority itself.

### Verification Routing

Verification routing would emit proof requirements and stop conditions. The
Decision Contract descriptor owns the classification rule; work/evidence
records own the receipts:

```yaml
contract_id: verification-routing
inputs:
  - task kind
  - active tooling context
  - changed behavior
  - evidence need
  - runtime readiness requirement
  - human involvement
  - workflow router advice
outputs:
  - runtime verification required/optional/skipped
  - selected proof path
  - commands/checks to run
  - rebuild requirement
  - synthetic-vs-real-input requirement
  - manual_intervention or Operator route
  - completion-report disclosures
```

If the selected route runs `git diff --check`, `./aos ready`, a schema test,
controlled fixture smoke, or an Operator probe, the output belongs in an
evidence record or work record, not in the Decision Contract descriptor.

## Boundary Matrix

| Artifact or primitive | Owns | Does not own |
| --- | --- | --- |
| Decision Contract descriptor | Reusable judgment metadata, source-authority evidence, current-state evidence kinds, composite outputs, invalidation triggers, optional recompute procedure, validation pointer. | Launch context for one session, historical run receipts, provider process state, persisted job lifecycle, notification delivery. |
| Transfer packet | Minimal fresh-session launch context selected by a route: recipient, source artifact, start ref, branch policy, stop conditions, evidence requirements, result route. | The reusable route rule, role authority docs, work history, immutable proof, provider-specific transcript. |
| Work record | What happened in one run: intent, execution map, evidence links, health, result summary, next-owner recommendation. | The reusable decision rule or provider scheduler. |
| Evidence record | Immutable or append-only proof: command output, traces, screenshots, status, citations, logs, Operator report, human answer record, result links. | Policy interpretation, route selection, or session launch. |
| Integration job | Provider-adapter workflow/job lifecycle: queued/running/succeeded/failed, requester, channel/thread, summary, result JSON, notifier metadata. | Agent/session authority or durable session control. Gateway jobs remain provider/workflow presentation state around AOS. |
| Session trigger/scheduler | Resolves a transfer packet, selects launch/resume timing, starts or resumes a docked provider session, applies timeout and stop policy. | Decision Contract source rules, gateway ownership of sessions, or work/evidence proof semantics. |
| Async result routing | Delivers terminal session results to configured routes: work/evidence record, integration job result, Slack thread, Foreman inbox, issue/PR comment when configured. | The decision that selected the route or the provider runtime itself. |
| Provider-neutral dispatch | Launches a docked session through an available provider adapter with cwd, worktree, dock, packet, and result route. | Permanent dock identity, provider-specific role semantics, or gateway-owned session lifecycle. |

The important boundary is that a Decision Contract may emit fields consumed by
transfer packets, session triggers, and result routes, but it should not absorb
those primitives. Keeping this split prevents a reusable rule descriptor from
becoming a hidden workflow engine.

## AFK Flow Sketch

One future unattended flow can use all pieces without collapsing ownership:

```text
Slack/gateway message or sibling completion
  -> provider adapter creates or updates an integration job
  -> AOS/Foreman route reads a Decision Contract descriptor
  -> route recomputes against source authority and current state
  -> route creates a transfer packet with selected packet fields
  -> session trigger/scheduler starts a docked provider session
  -> provider-neutral dispatch launches the selected dock/provider
  -> worker session executes one bounded goal
  -> worker writes a work record and links evidence records
  -> async result routing notifies the configured result route
  -> integration job is completed/failed when the route calls for it
```

In that flow, Slack and the gateway are ingress, notifier, and job presentation
surfaces. They do not become the owner of AOS sessions. The session authority
belongs with AOS session control and provider-neutral dispatch, while the
durable proof belongs in work and evidence records.

## Explicit Deferrals

This note intentionally defers:

- no Decision Contract schema;
- no migration of `docs/dev/workflow-rules.json`;
- no transfer packet implementation;
- no session trigger or scheduler;
- no provider-neutral dispatch implementation;
- no async result-routing implementation;
- no work-record or evidence-record implementation changes;
- no gateway ownership of sessions;
- no gateway job schema change;
- no `.docks` role instruction, hook, transfer script, or dock-profile change;
- no source, tests, command behavior, router output, or workflow-rules change;
- no Researcher dock creation.

Researcher remains after the AFK primitives. Without a session trigger and
async result route, a Researcher dock would only add another manually launched
role and would not test the unattended operating model.

## Recommendation

The next slice should design one transfer packet and async result-route shape
that connects an integration job to a docked provider session.

That is the right next move because the Decision Contract descriptor is now
bounded enough: it can emit selected packet fields and proof requirements
without owning session launch or results. The remaining uncertainty is the AFK
handoff surface between provider ingress, AOS session control, work/evidence
records, and notification routes. A docs-only packet/result-route sketch would
test those boundaries while preserving the current deferrals:

- gateway remains provider ingress and notifier, not session authority;
- transfer packets remain launch context, not reusable judgment;
- work/evidence records remain receipts, not routing policy;
- provider dispatch remains an adapter over dock/session contracts, not a new
  dock identity model.

Only after that packet/result-route shape has survived review should Foreman
consider a prototype session trigger or any source-backed descriptor schema.
