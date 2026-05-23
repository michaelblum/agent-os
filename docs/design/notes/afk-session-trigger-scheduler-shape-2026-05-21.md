# AFK Session Trigger Scheduler Shape

**Date:** 2026-05-21
**Status:** docs-only session trigger/scheduler sketch

## Summary

This note sketches the future session trigger/scheduler primitive in the AFK
chain:

```text
transfer packet
  -> session trigger/scheduler
  -> provider-neutral dispatch
  -> docked provider session
  -> lifecycle/result-route updates
```

It does not add a schema, source change, command behavior change, provider
launch, gateway API change, gateway session ownership, scheduler implementation,
or provider-neutral dispatch implementation. It follows the packet/result-route
shape because the scheduler needs a concrete packet to accept and concrete
routes to update. It precedes provider-neutral dispatch because dispatch should
receive an already-validated packet, lease, cwd/worktree policy, result-route
reference, and start-versus-resume decision instead of also deciding scheduler
semantics.

The core boundary is: the scheduler accepts one transfer packet, validates that
it is still eligible to run, applies lease/timeout and heartbeat policy, decides
whether to start or resume a docked provider session, records lifecycle state,
and updates configured result routes. It does not decide the reusable route,
launch providers directly, own proof semantics, or make the gateway the session
authority.

## Existing Surface Inventory

### Transfer Packet And Result Route

`docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
defines the packet as minimal launch context, not a transcript or session
control record. Candidate packet fields include:

- `packet_id`, `created_at`, `source_event`, and `source_artifact`;
- `requested_recipient` and optional `requested_role_kind`;
- `cwd`, `worktree`, `branch_policy`, and `required_start_ref`;
- `decision_contract` and selected route outputs;
- optional `integration_job` linkage;
- `evidence_requirements` and `stop_conditions`;
- `timeout_or_lease`, `human_needed`, optional `provider_hint`, and
  `result_route`.

That same note defines async route kinds: `work_record`, `evidence_record`,
`integration_job_start`, `integration_job_complete`, `integration_job_fail`,
`gateway_notifier`, `foreman_inbox`, `local_artifact_path`, and explicitly
configured `issue_or_pr_comment`. It also maps session outcomes to integration
job transitions: accepted work can move a job to `running`; proved completion
can move it to `succeeded`; terminal task failure can move it to `failed`;
human-needed can remain resumable in queued or running state while metadata and
work records capture the stall.

### Provider Session Catalog And Telemetry

`shared/schemas/provider-session-catalog.*` is a read-only local adapter
contract for provider-owned sessions. It normalizes provider, session id, cwd,
branch, timestamps, source file, and resume command for Codex and Claude Code
without mutating provider files or making AOS a native client for either
runtime.

`shared/schemas/agent-session-telemetry.*` is the provider-neutral observability
envelope. It carries raw telemetry, lifecycle events, capabilities, and provider
shape mismatch diagnostics. Lifecycle events already include
`session_started`, `session_resumed`, `handoff_started`, `handoff_completed`,
and `session_ended`; capabilities include actions such as `resume`, `handoff`,
`compact`, and `check_in`. Those surfaces inform scheduler state, but they do
not define scheduling policy.

### Remote And Session-Control Record Boundary

`docs/design/remote-session-control.md` sketches a future provider-neutral
session control record with session id, provider, harness, state, cwd,
worktree, branch, terminal handle, canvases, telemetry, actions, and owner
metadata. It keeps mutating session control high-trust, local-authority,
lease-oriented, authenticated, auditable, and distinct from raw terminal
remoting.

The AFK scheduler should feed or update a session control record when one
exists. It should not collapse into the transfer packet, integration job, or
gateway store. It should remain a local AOS primitive that can be invoked by a
gateway, sibling session, local Foreman route, or future queue worker.

### Worktree And Session Scope

`docs/design/worktree-session-scope.md` warns against broad session-control
planes and stale worktree/content-root assumptions. For scheduler purposes, that
means packet intake must verify the cwd/worktree/start-ref contract before
dispatch. A clean git status alone is not evidence that the session is on the
right base, and a branch-local source artifact may be missing if the scheduler
starts from the wrong ref.

### Integration Job Boundary

`docs/api/integration-broker.md`, `packages/gateway/src/db.ts`,
`packages/gateway/src/integrations/broker.ts`, and
`packages/gateway/src/integrations/http-api.ts` keep gateway state scoped to
provider adapters, workflow launches, provider-local UI state, and integration
jobs. Current job status is `queued`, `running`, `succeeded`, or `failed`.
Existing HTTP routes can start, complete, or fail jobs. The broker notifier can
deliver provider-thread updates after job transitions.

Those routes are result-route targets. They are not the session authority, and
the scheduler should not require gateway schema changes in this design slice.

### AOS Tell And Dock Communication Assumptions

Repo-wide and dock-local guidance says daemon-native `tell`, `listen`, and the
session service behind `aos tell --register` and `aos tell --who` remain the
authority for human, agent, channel, and session communication. Clipboard
handoffs are the current manual transfer mechanism. A future scheduler should
replace the human-as-courier part of that path while preserving dock authority,
result routes, and session ownership in AOS.

## Trigger/Scheduler Responsibility Sketch

### Packet Resolution And Validation

The scheduler owns packet intake for one requested run:

- resolve packet references from a local path, queue entry, integration job
  metadata, sibling completion, or explicit command input;
- validate `packet_id`, source artifact, recipient/dock, cwd/worktree,
  branch policy, required start ref, stop conditions, lease, and result route;
- reject packets that reference missing source artifacts, unknown docks,
  unsupported role kinds, impossible branch policy, expired leases, or result
  routes that cannot be represented locally;
- classify duplicates and superseded packets before any provider launch;
- record the accepted packet and scheduler run id for idempotent lifecycle
  updates.

Validation should be current-state based. A packet may carry selected Decision
Contract outputs, but the scheduler should not trust them as still valid when
the source artifact, ref, branch, or route has drifted.

### Required Start Ref And Worktree/Cwd Checks

Before provider-neutral dispatch, the scheduler should confirm:

- `cwd` exists and is the intended project root;
- `worktree` exists when specified and matches the desired root;
- `required_start_ref` resolves;
- source artifacts named by the packet exist after the selected start ref is
  checked out or otherwise made visible;
- dirty state, existing branch, and branch policy are compatible;
- the scheduler can describe whether the work surface is local-only, pushable,
  no-git, or externally published by policy.

The scheduler does not need to perform every git operation itself. It does need
to make the chosen work surface explicit enough that provider-neutral dispatch
does not launch a dock into the wrong checkout.

### Lease, Timeout, And Heartbeat Expectations

The scheduler owns the run lease:

- accept a packet only before its intake lease expires;
- set a launch deadline for provider-neutral dispatch;
- track an execution lease or maximum no-heartbeat interval;
- treat lifecycle heartbeats as evidence that the docked provider session still
  owns the packet;
- expire or mark stale runs when dispatch never starts, the session disappears,
  or no heartbeat arrives inside policy;
- prevent late stale sessions from overwriting stronger terminal route state.

Heartbeats should be lightweight lifecycle updates, not transcript storage. They
may reference provider session catalog records, telemetry lifecycle events,
session control state, or explicit worker check-ins.

### Session Start Versus Session Resume

The scheduler chooses start or resume before dispatch:

- start when no compatible active/recent session owns the packet or work
  surface;
- resume when a provider session catalog/control record shows a compatible
  session id, cwd, branch/worktree, dock identity, and route id;
- refuse resume when the packet is superseded, lease is expired, cwd/worktree
  drifted, provider state is unknown in a way policy denies, or the session is
  already terminal;
- record whether the lifecycle was started, resumed, or rejected.

Provider-neutral dispatch executes the selected action. The scheduler records
why that action was selected and what result-route state must be updated.

### Lifecycle States

The scheduler should maintain a richer local lifecycle than current integration
jobs:

| State | Meaning |
| --- | --- |
| `queued` | Packet is known but not accepted by a scheduler run. |
| `accepted` | Scheduler validated the packet and claimed the idempotence key. |
| `launching` | Provider-neutral dispatch has been requested but the provider session has not accepted ownership. |
| `running` | A docked provider session accepted the packet and is heartbeating or otherwise observable. |
| `stalled` | The run cannot progress automatically but may be recoverable without replacing the packet. |
| `human-needed` | A bounded human action or decision is required before resume. |
| `succeeded` | Required proof passed and terminal success routes were written or attempted with evidence. |
| `failed` | Terminal task, validation, dispatch, or verification failure. |
| `expired` | Lease or heartbeat policy ended the run before terminal worker result. |
| `superseded` | A newer packet or route invalidated this run before completion. |

Integration job status can remain coarse. Scheduler lifecycle state can live in
future work/session records, route metadata, or a local queue record without
changing the gateway job schema in this sketch.

### Result-Route Updates

The scheduler owns lifecycle route updates around dispatch:

- on accepted: write or append scheduler claim metadata where configured;
- on launch: update local lifecycle state and optionally mark an integration
  job `running` only after worker ownership is real;
- on stall or human-needed: write work-record metadata, evidence link, and
  notifier text when route policy calls for requester visibility;
- on succeeded: deliver final report, evidence links, route update attempts,
  and next-owner recommendation;
- on failed: deliver failure summary, blocker, evidence, and whether retry with
  the same packet is permitted;
- on expired: write stale/timeout evidence and prevent stale late completion
  from overwriting terminal route state;
- on superseded: record the superseding packet or source and stop dispatch.

Route update failures are evidence. They should not be hidden in a provider
terminal transcript.

### Human-Needed And TCC Blockers

The scheduler should treat human-needed as a first-class recoverable lifecycle,
not as an unstructured failure. For repo-mode TCC/input-tap blockers, the GDI
contract already names the bounded recovery path:
`.docks/gdi/scripts/human-needed-tcc-reset`, followed by
`./aos ready --post-permission` after the human returns.

A scheduler should record:

- blocker class and exact remaining human action;
- whether the provider session should remain resumable;
- result routes that received the human-needed update;
- lease extension or pause policy;
- resume precondition and maximum waiting window.

It should not keep retrying live AOS verification when the blocker requires a
human permission or external-state change.

### Audit, Work Record, And Evidence Hooks

The scheduler should create durable hooks for:

- packet accepted/rejected reason;
- selected start/resume action;
- dispatch attempt id and provider session id when available;
- lease deadlines and heartbeat receipts;
- lifecycle transitions;
- route update attempts and responses;
- terminal proof summary and evidence record links.

Work records own the run story. Evidence records own immutable or append-only
proof. The scheduler owns the lifecycle transitions and route delivery attempts
that connect them.

## Non-Responsibilities

The session trigger/scheduler should not own:

- reusable route judgment or Decision Contract source rules;
- provider-specific launch mechanics, CLI flags, terminal handling, or auth;
- full transcript storage;
- gateway job schema, HTTP API, Slack UI, or provider notifier ownership;
- work-record or evidence-record proof semantics;
- Researcher behavior, source synthesis policy, ranking logic, or dock
  creation;
- broad workstream planning, next-slice selection, or role authority;
- direct GitHub mutation unless an explicit result route authorizes it.

## Candidate Command Or API Shape

Design-only command examples:

```bash
aos session trigger --packet docs/design/packets/example.json
aos session trigger --packet integration-job:01H... --queue local
aos session trigger --packet docs/design/packets/example.json --dry-run --json
```

Design-only queue-entry shape:

```json
{
  "scheduler_run_id": "afk-run-01",
  "packet_ref": "docs/design/packets/example.json",
  "packet_id": "packet-01",
  "result_route_ref": "route-01",
  "state": "accepted",
  "lease_expires_at": "2026-05-21T18:00:00Z",
  "idempotence_key": "packet-01:route-01:gdi:/Users/Michael/Code/agent-os:0523416"
}
```

Required inputs:

- packet reference or embedded packet id;
- caller/source identity when available;
- queue namespace or local runtime mode;
- optional dry-run flag;
- optional provider hint override only when policy permits;
- local cwd/worktree from the packet or invocation.

Synchronous output should include:

- scheduler run id;
- packet id and idempotence key;
- accepted/rejected state and reason;
- selected start/resume/duplicate/superseded action;
- selected dock, cwd/worktree, required start ref, and result route summary;
- lease deadlines;
- provider-neutral dispatch request id when dispatch is requested immediately.

Asynchronous writes should include:

- lifecycle transitions;
- heartbeat receipts;
- provider session id and resume handle when known;
- result-route updates;
- work/evidence record links;
- terminal completion, failure, expiry, or supersession receipts.

Idempotence should be keyed by stable launch context, not only by process id:

```text
packet_id + result_route_ref + requested_recipient + cwd/worktree + required_start_ref
```

Provider session id can refine a running/resume record after dispatch accepts
the packet, but it should not be required to identify a queued packet.

## Lifecycle State Machine

### Normal Success Path

```text
queued
  -> accepted
  -> launching
  -> running
  -> succeeded
```

The scheduler validates the packet, claims the idempotence key, requests
provider-neutral dispatch, receives worker ownership or heartbeat, then writes
terminal success routes with proof and route-update evidence.

### Terminal Failure

```text
queued
  -> accepted
  -> failed
```

or:

```text
queued
  -> accepted
  -> launching
  -> failed
```

or:

```text
queued
  -> accepted
  -> launching
  -> running
  -> failed
```

Failure can come from invalid source artifacts, incompatible worktree state,
dispatch failure, provider rejection, terminal worker failure, failed
verification, or terminal stop condition. The scheduler writes failure routes
with evidence and retry eligibility.

### Human-Needed Stall And Resume

```text
queued
  -> accepted
  -> launching
  -> running
  -> human-needed
  -> running
  -> succeeded
```

The human-needed state records the exact human action, pauses or extends the
lease by policy, and resumes only after the named precondition is satisfied.
If the human-needed window expires, the run moves to `expired` or `failed`
according to route policy.

### Lease Expiry Or Lost Heartbeat

```text
queued
  -> accepted
  -> launching
  -> expired
```

or:

```text
queued
  -> accepted
  -> launching
  -> running
  -> expired
```

Expiry records the missing heartbeat, stale dispatch, or exceeded lease. Late
worker completion must not overwrite a terminal expiry unless a future explicit
reconciliation policy accepts it.

### Superseded Packet Or Duplicate Trigger

Duplicate trigger:

```text
queued
  -> accepted
  -> running
```

The second trigger resolves to the existing scheduler run when the idempotence
key matches and the current state is nonterminal.

Superseded packet:

```text
queued
  -> accepted
  -> superseded
```

or:

```text
queued
  -> accepted
  -> launching
  -> running
  -> superseded
```

Supersession records the newer packet or route and stops stale result delivery.

## Boundary Matrix

| Surface | Owns | Does not own |
| --- | --- | --- |
| Session trigger/scheduler | Packet intake, current-state validation, idempotence key, start/resume decision, lease/timeout/heartbeat policy, lifecycle state, route update attempts. | Reusable route judgment, provider-specific launch mechanics, gateway job schema/API, proof semantics, Researcher synthesis behavior. |
| Provider-neutral dispatch | Adapter-level launch/resume request for a selected provider with dock, cwd/worktree, packet ref, lease, and route ref. | Packet validation policy, route selection, scheduler lifecycle authority, dock role semantics, terminal proof. |
| Transfer packet | One transfer's launch context: recipient, source artifact, start ref, branch policy, proof requirements, stop conditions, lease, human-needed route, result route. | Session control record, transcripts, immutable proof, reusable route rules, provider process handles. |
| Result route | Destination and policy for lifecycle and terminal updates, including work/evidence record, integration job, notifier, inbox, artifact path, or explicit external comment. | Scheduler state machine, reusable route judgment, provider launch, or proof interpretation. |
| Work record | Intent, execution map, lifecycle summary, route update attempts, evidence links, health, next-owner recommendation. | Scheduler queue ownership, provider dispatch implementation, immutable proof payload. |
| Evidence record | Append-only proof: command output, status receipts, traces, screenshots, citations, human answers, notification receipts. | Policy interpretation, launch context, route selection, session authority. |
| Integration job/gateway | Provider ingress, workflow catalog, persisted job history, start/complete/fail transitions, provider notifications, broker-local UI state. | AOS session authority, dock semantics, scheduler leases, provider-neutral dispatch, work/evidence proof semantics. |
| Decision Contract descriptor | Reusable judgment metadata, authority evidence, current-state evidence kinds, invalidation triggers, selected packet/proof/result-route outputs. | One-off packet state, scheduler lease, provider session lifecycle, job transition delivery, run receipts. |
| Docked provider session | Execute one bounded dock goal, honor role instructions and stop conditions, heartbeat/check in, produce final report and proof links. | Workstream coordination, gateway ownership, scheduler policy, route selection, packet redefinition. |

## Explicit Deferrals

This note intentionally preserves these deferrals:

- no scheduler implementation;
- no provider-neutral dispatch implementation;
- no transfer packet schema;
- no gateway job schema change;
- no gateway API change;
- no source change;
- no tests change;
- no command behavior change;
- no router output change;
- no `docs/dev/workflow-rules.json` change;
- no `.docks` instruction, handoff script, hook, or dock-profile change;
- no work-record or evidence-record implementation;
- no GitHub issue, push, PR, or external publication mutation;
- no Researcher dock creation.

## Recommendation

The next slice should be provider-neutral dispatch over the dock/session
contract.

The packet/result-route sketch defines the payload and destinations. This note
defines the scheduler boundary: validation, lease, lifecycle, start/resume, and
route updates. Provider-neutral dispatch is now the missing adapter boundary
between a scheduler decision and an actual Codex, Claude, Gemini, or future
provider session. A work/evidence record trial should follow after dispatch can
name the lifecycle receipts a worker would emit. A local prototype should wait
until dispatch is sketched, so source work does not bake in a single provider
or manual clipboard assumption.
