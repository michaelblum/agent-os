# AFK Transfer Packet Result Route Shape

**Date:** 2026-05-21
**Status:** docs-only packet and result-route sketch

## Summary

This note sketches a transfer packet and async result-route shape for a future
AFK flow:

```text
integration job or sibling completion
  -> transfer packet
  -> docked provider session
  -> work/evidence record
  -> async result route
  -> integration job or notifier completion
```

It does not add a schema, source change, command behavior change, gateway API
change, session trigger, scheduler, provider dispatch implementation, work
record implementation, or evidence record implementation. It also keeps the
gateway out of session ownership. The gateway can create provider-facing jobs
and notify requesters, but AOS session control must own session launch, resume,
leases, and terminal session state.

The packet/result-route design comes before a session trigger or scheduler
because the scheduler needs to know what launch context is legitimate to carry
between actors and what result routes must be updated when the worker finishes.
Without that boundary, a scheduler prototype would either under-specify the
worker handoff or accidentally make the gateway, Decision Contract descriptor,
or provider adapter responsible for sessions.

## Existing Surface Inventory

### Integration Jobs

The current gateway store persists `IntegrationJob` records with:

- identity and provider fields: `id`, `provider`, `workflowId`,
  `workflowTitle`, `surface`;
- requester route fields: `requester`, `channel`, `thread`;
- launch text and lifecycle fields: `commandText`, `status`, `createdAt`,
  `updatedAt`, `startedAt`, `completedAt`;
- result and diagnostic fields: `summary`, `resultText`, `resultJson`,
  `errorText`, `metadata`.

The current statuses are:

- `queued`: a provider or local launch request has been recorded, but a worker
  has not started execution;
- `running`: execution has started;
- `succeeded`: execution completed successfully;
- `failed`: execution reached a terminal failure.

Queued KILOS-style workflows already demonstrate the shape: Slack can collect
structured inputs, create a job, and later receive start/complete/fail updates
when another worker picks up the request.

### HTTP Start, Complete, And Fail Routes

The current local HTTP API exposes:

- `POST /api/integrations/jobs/:id/start`: marks a queued job as `running`,
  sets `startedAt` when needed, merges metadata, and notifies the requester only
  when `notifyRequester` is explicitly `true`;
- `POST /api/integrations/jobs/:id/complete`: marks a queued or running job as
  `succeeded`, stores summary, text lines, optional `resultJson`, optional
  `artifactLink`, clears `errorText`, sets `completedAt`, and notifies the
  requester unless `notifyRequester` is `false`;
- `POST /api/integrations/jobs/:id/fail`: marks a queued or running job as
  `failed`, stores summary, lines, `errorText`, metadata, sets `completedAt`,
  and notifies the requester unless `notifyRequester` is `false`.

Those routes are plausible future result-route targets. They are not a session
control API and should not be extended by assumption in this design slice.

### Broker Notifier Behavior

The broker owns provider-notifier dispatch after job transitions. It looks up a
registered notifier by `job.provider` and sends a provider-neutral
`IntegrationJobNotification` with the job and rendered text. Slack then maps
that notification to the original thread or DM when possible.

The notifier should remain a result delivery surface. It should not know how to
launch, resume, interrupt, or supervise a docked provider session.

### Work And Evidence Record Boundary

Work records describe one run as:

```text
intent + execution map + evidence + health
```

For AFK work, the work record should own what the docked session attempted,
which packet and source artifact guided it, which commands or procedures ran,
which route updates were attempted, final status, health, and next-owner
recommendation. Evidence records should own immutable or append-only proof:
command output, diff checks, test receipts, trace links, screenshots, citations,
Operator reports, human answers, job transition responses, and notification
receipts.

The packet should request proof. It should not contain the proof itself.

### Remote And Session-Control Boundary

The remote-session-control note frames a provider-neutral session control
record with `session_id`, provider, harness, state, cwd, worktree, branch,
terminal handle, canvases, telemetry, actions, and owner metadata. It also
keeps session control high-trust, local-authority, lease-oriented, and separate
from raw terminal remoting.

The AFK transfer packet should feed a future session trigger/scheduler. It
should not become the session control record. Session control should resolve
provider availability, create or resume the session, enforce leases/timeouts,
and report actual session identity and state.

## Transfer Packet Sketch

A transfer packet is the minimal launch-context artifact that lets a fresh
docked provider session start a bounded goal without inheriting a full transcript
or provider-specific launch assumptions.

Candidate fields:

| Field | Purpose |
| --- | --- |
| `packet_id` | Stable id for this one transfer packet. |
| `created_at` | Packet creation timestamp. |
| `source_event` | Inbound event or sibling completion that caused the transfer, such as Slack command, local workflow launch, Foreman dispatch, or session result. |
| `source_artifact` | Work card, design note, issue, PR, integration job, or evidence record that contains the authoritative task context. |
| `requested_recipient` | Target dock or actor, such as `gdi`, `foreman`, `operator`, `human`, or future configured role. |
| `requested_role_kind` | Optional role-kind lens, such as Planner, Worker, Reviewer, Reporter, Human Gate, or Researcher-compatible behavior. |
| `cwd` | Repository or project root where the session should run. |
| `worktree` | Specific worktree root when different from `cwd`. |
| `branch_policy` | Required branch behavior: stay on existing branch, create branch, reuse named branch, keep local-only, push when complete, or no git mutation. |
| `required_start_ref` | Exact ref or commit the recipient must start from when the source artifact depends on branch-local context. |
| `decision_contract` | Selected Decision Contract descriptor id and rule ids when a reusable decision chose the route. |
| `selected_outputs` | The selected recipient, branch/output expectations, proof requirements, stop conditions, and route references emitted by the Decision Contract. |
| `integration_job` | Optional provider job linkage: `job_id`, provider, requester, channel, thread, workflow id/title, and whether job transition updates are expected. |
| `evidence_requirements` | Commands, reports, artifacts, current-state checks, or human confirmations that must prove completion. |
| `stop_conditions` | Conditions that must stop the session instead of broadening scope, such as TCC blocker, login/paywall/CAPTCHA, ambiguous routing, dirty worktree conflict, or missing source artifact. |
| `timeout_or_lease` | Wall-clock timeout, lease expiry, heartbeat expectation, and stale-session handling policy. |
| `human_needed` | Bounded human-action packet or route when the worker cannot continue without a human decision or permission repair. |
| `provider_hint` | Optional provider preference, such as Codex, Claude, or Gemini. This is advisory unless policy says it is an explicit provider requirement. |
| `result_route` | Reference to one or more async result routes to update when the session starts, finishes, stalls, or fails. |

Field exclusions:

- no full role docs or provider instructions;
- no copied transcript history;
- no immutable proof payloads;
- no provider process handle or terminal session id before session control
  creates one;
- no gateway-owned session lifecycle fields;
- no reusable route rule body when a Decision Contract descriptor owns it;
- no schema migration or command contract.

The packet may carry selected Decision Contract outputs, but the descriptor
remains the authority for reusable judgment. The packet is one transfer's launch
context.

## Async Result-Route Sketch

An async result route tells the future session trigger/scheduler and docked
provider session where lifecycle updates and terminal results should be
delivered. A packet can contain more than one route when the same completion must
update durable records and notify a requester.

Route kinds:

- `work_record`: append or finalize the work record for the session run;
- `evidence_record`: write immutable proof artifacts or append proof links;
- `integration_job_start`: call the broker start route for a linked job;
- `integration_job_complete`: call the broker complete route for a linked job;
- `integration_job_fail`: call the broker fail route for a linked job;
- `gateway_notifier`: deliver to a Slack thread or DM through the broker's
  provider notifier after a job update;
- `foreman_inbox`: leave a local Foreman-visible result packet for review or
  next-slice routing;
- `local_artifact_path`: write the final report or machine-readable receipt to a
  named local path;
- `issue_or_pr_comment`: post externally only when explicitly configured by the
  packet or work card.

Status mapping from session result to integration job status:

| Session result | Integration job status | Notes |
| --- | --- | --- |
| Session accepted packet and started execution | `running` | Use start route only after the worker has actually taken ownership. |
| Session completed every required proof and no blocker remains | `succeeded` | Complete with summary, final report fields, artifacts, and evidence links. |
| Session could not complete because the task failed, source artifact was invalid, verification failed, or a stop condition is terminal for this route | `failed` | Fail with error text, summary, evidence links, and next-owner recommendation. |
| Session needs human action but the job should remain resumable | keep `queued` or `running` | Record human-needed state in metadata/work record; notify only if route policy calls for it. |
| Session lease expired or heartbeat was lost | `failed` or route-specific stale state | Until a scheduler exists, treat this as design-level policy, not a current job transition. |

Final report fields that should be delivered:

- `packet_id`;
- session id/provider when available;
- source event and source artifact;
- recipient dock and role kind;
- final status: completed, failed, stalled, human-needed, timed-out, or
  superseded;
- concise summary;
- files changed or artifacts created;
- commands/checks run and pass/fail results;
- evidence record links or local paths;
- work record link or local path;
- integration job id and attempted transition;
- notification route attempted and result when available;
- explicit deferrals preserved;
- local-only state, unrelated dirty state, or generated artifacts;
- next owner and action required.

Design-level idempotence and retry expectations:

- result routes should be idempotent by `packet_id`, session id, and route kind;
- repeated start updates should not erase stronger terminal state;
- complete/fail should be terminal for integration jobs, matching the current
  broker transition guard;
- evidence writes should append immutable receipts or de-duplicate by content
  hash/artifact id;
- notification retries should not create duplicate external messages unless the
  provider route explicitly allows follow-up messages;
- a route update failure should be evidence in the work record, not hidden in a
  terminal transcript;
- retries should preserve the original packet id and create new evidence for
  each attempt.

## Ownership And Boundary Matrix

| Surface | Owns | Does not own |
| --- | --- | --- |
| Gateway/broker | Provider ingress, workflow catalog, persisted integration jobs, job start/complete/fail transitions, provider notifier dispatch, broker-local UI state. | AOS session authority, dock role semantics, provider-neutral dispatch, work/evidence proof semantics, or scheduler leases. |
| AOS session trigger/scheduler | Resolving a packet, applying lease/timeout policy, choosing when to start or resume a docked session, updating lifecycle result routes. | Provider-specific workflow UI, reusable route judgment, gateway job schema, or final proof content. |
| Provider-neutral dispatch | Launching a docked session through a selected provider adapter with cwd, worktree, dock, packet, and result-route reference. | Permanent dock identity, Decision Contract source rules, gateway-owned session lifecycle, or app-specific synthesis logic. |
| Docked provider session | Executing one bounded goal, honoring dock role instructions, preserving stop conditions, producing final report, writing or linking proof. | Choosing broad workstream scope, owning gateway job lifecycle policy, changing provider scheduler rules, or redefining the packet. |
| Transfer packet | Minimal one-transfer launch context: recipient, source artifact, start ref, branch policy, selected outputs, evidence requirements, stop conditions, lease, human-needed route, result route. | Full role docs, session control record, transcripts, immutable proof, reusable decision rules, provider process state. |
| Work record | Run intent, execution map, evidence links, route update attempts, health, summary, next-owner recommendation. | Reusable route policy, session scheduler, or provider notifier implementation. |
| Evidence record | Immutable or append-only proof: command outputs, traces, screenshots, status receipts, citations, logs, Operator reports, human answers, job transition responses. | Policy interpretation, route selection, launch context, or session ownership. |
| Decision Contract descriptor | Reusable judgment metadata, source-authority evidence, current-state evidence kinds, invalidation triggers, recompute procedure, selected packet/proof/result-route outputs. | One-off packet state, run receipts, provider process state, job transition delivery, or scheduler implementation. |

The important split is that a Decision Contract may choose packet fields and
proof requirements, but the packet carries them for one transfer; session control
launches the worker; the worker produces work/evidence records; and result
routing updates the configured destinations.

## Manual AFK Sequence

This flow can be simulated today without implementation:

1. A provider or local operator creates a queued integration job through the
   existing broker workflow launch path.
2. Foreman writes a GDI work card that includes the job id, branch/base,
   recipient, stop conditions, required evidence, and expected completion
   report.
3. A human or Foreman creates a local branch from the required start ref and
   dispatches the work card to a docked GDI session.
4. When GDI starts real work, a human or local operator can call
   `POST /api/integrations/jobs/:id/start` with worker metadata.
5. GDI completes the bounded task, writes the requested docs/artifacts, runs
   verification, and reports evidence.
6. Foreman reviews the result and, when accepted, a human or local operator can
   call `POST /api/integrations/jobs/:id/complete` with a summary, report lines,
   artifact link, and evidence metadata.
7. If GDI hits a terminal blocker or failed verification, the operator can call
   `POST /api/integrations/jobs/:id/fail` with error text and evidence links.

The future primitive would replace the human clipboard and manual broker update
steps. It would create or resolve the transfer packet, start/resume the docked
provider session, update the job to running when the session accepts the packet,
write work/evidence records as the session progresses, and deliver the final
result to the configured route.

## Explicit Deferrals

This note intentionally preserves these deferrals:

- no transfer packet schema;
- no session trigger or scheduler implementation;
- no provider-neutral dispatch implementation;
- no async result-routing implementation;
- no gateway job schema change;
- no gateway API change;
- no source change;
- no tests change;
- no command behavior change;
- no router output change;
- no `docs/dev/workflow-rules.json` change;
- no `.docks` instruction, handoff script, hook, or dock-profile change;
- no work-record or evidence-record implementation;
- no gateway ownership of sessions;
- no GitHub issue, PR, push, or external publication mutation;
- no Researcher dock creation.

## Recommendation

The next slice should be a session trigger/scheduler sketch, not a local
prototype yet.

This packet/result-route note now defines the handoff payload, result
destinations, status mapping, and ownership boundaries well enough for the next
design question: what AOS primitive accepts a packet, applies a lease, starts or
resumes a docked provider session, and records lifecycle updates without making
the gateway or provider adapter the session authority?

A provider-neutral dispatch sketch should follow immediately after the
trigger/scheduler sketch, because dispatch is how the scheduler actually starts
Codex, Claude, Gemini, or another provider against the same dock/session
contract. A work/evidence record trial is useful after those two sketches can
name which lifecycle and proof receipts the trial should emit. A local prototype
should wait until the trigger and dispatch boundaries are explicit enough to
avoid baking manual clipboard assumptions into source.
