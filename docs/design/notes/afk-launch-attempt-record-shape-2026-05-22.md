# AFK Launch Attempt Record Shape

**Date:** 2026-05-22
**Status:** docs-only boundary sketch

## Summary

The next AFK provider-launch slice needs one durable correlation object before
it starts a real provider. The record should bind scheduler intent, transfer
packet inputs, provider selection, dock launch root, terminal substrate,
provider acceptance, catalog discovery, telemetry parsing, and result-route
delivery without claiming those later observations exist at creation time.

This note defines that launch-attempt/session record shape. It does not add a
schema, mutate source, launch a provider, inspect real provider transcripts, or
change scheduler, dispatch, catalog, telemetry, gateway, work-record,
evidence-record, or route behavior.

The smallest record is not a full work record or evidence record. It is a
dispatch-owned launch attempt that starts with an idempotence key and intended
launch facts, then accumulates observation references as the provider session
becomes visible.

## Smallest Record

Create one `launch_attempt` record before or during provider launch:

```json
{
  "record_type": "aos.afk_launch_attempt",
  "schema_status": "not_a_schema",
  "launch_attempt_id": "launch-attempt-<stable-id>",
  "scheduler_run_id": "scheduler-<id>",
  "dispatch_attempt_id": "dispatch-<id>",
  "idempotence_key": "<stable-key>",
  "created_at": "2026-05-22T00:00:00.000Z",
  "updated_at": "2026-05-22T00:00:00.000Z",
  "lifecycle_state": "requested",
  "transfer": {
    "packet_id_or_ref": "<packet-ref>",
    "source_event_or_artifact": "<event-or-artifact-ref>",
    "result_route_refs": ["<route-ref>"],
    "required_start_ref": "<git-ref>",
    "start_ref_sha": "<sha>",
    "external_publication_policy": "local-only"
  },
  "selection": {
    "selected_provider": "codex",
    "provider_selection_source": "explicit|hint|policy|availability",
    "selected_dock": "gdi",
    "dock_role_kind": "gdi",
    "dock_profile_ref": ".docks/gdi/dock.json",
    "launch_root": ".docks/gdi"
  },
  "launch_intent": {
    "action": "start|resume|dry-run|reject",
    "intended_worktree": "/Users/Michael/Code/agent-os",
    "intended_launch_cwd": "/Users/Michael/Code/agent-os/.docks/gdi",
    "intended_branch": "gdi/example",
    "command_argv": ["codex", "--no-alt-screen"],
    "command_env_refs": ["AOS_TRANSFER_PACKET_REF", "AOS_RESULT_ROUTE_REF"],
    "deadline_or_lease": "<lease-ref>",
    "launch_requested": true
  },
  "terminal_substrate": {
    "status": "not_observed",
    "driver": "not_observed",
    "session_handle": "not_observed",
    "cwd": "not_observed",
    "command": "not_observed",
    "snapshot_ref": "not_observed"
  },
  "provider_acceptance": {
    "status": "not_observed",
    "provider_session_id": "not_observed",
    "provider_reported_cwd": "not_observed",
    "provider_reported_branch": "not_observed",
    "provider_reported_head": "not_observed",
    "provider_version": "not_observed",
    "model": "not_observed"
  },
  "catalog": {
    "status": "not_observed",
    "catalog_record_refs": "not_observed",
    "match_count": "not_observed",
    "matched_session_id": "not_observed",
    "source_file": "not_observed",
    "resume_command": "not_observed"
  },
  "telemetry": {
    "status": "not_observed",
    "telemetry_event_refs": "not_observed",
    "lifecycle_event_refs": "not_observed",
    "capability_event_refs": "not_observed",
    "mismatch_refs": []
  },
  "result_route": {
    "status": "not_attempted",
    "attempt_refs": [],
    "delivered_refs": [],
    "failure": "not_observed"
  },
  "mismatches": [],
  "evidence": {
    "required_before_completed": [],
    "observed_refs": []
  }
}
```

At creation, the mandatory fields are the correlation and intent fields:
`launch_attempt_id`, `scheduler_run_id`, `dispatch_attempt_id`,
`idempotence_key`, timestamps, lifecycle state, packet reference, result route,
selected provider, selected dock, launch root, intended worktree/cwd, action,
and launch policy. Later fields must start as `not_observed`,
`not_attempted`, or empty arrays rather than nulls that could be confused with
parser failure.

## Field Ownership

| Field group | Source of truth | Creation requirement | Later update source |
| --- | --- | --- | --- |
| `launch_attempt_id` | Dispatch | Mandatory before launch | Stable |
| `scheduler_run_id` | Scheduler | Mandatory before launch | Stable |
| `dispatch_attempt_id` | Dispatch | Mandatory before launch | Stable |
| `idempotence_key` | Scheduler plus dispatch | Mandatory before launch | Stable |
| `created_at`, `updated_at` | Dispatch record writer | Mandatory before launch | Record writer |
| `lifecycle_state` | Scheduler/dispatch lifecycle | Mandatory before launch | Scheduler/dispatch |
| `transfer.packet_id_or_ref` | Transfer packet | Mandatory before launch | Stable |
| `transfer.source_event_or_artifact` | Scheduler/transfer packet | Mandatory if known; otherwise `not_observed` | Scheduler |
| `transfer.result_route_refs` | Transfer packet/scheduler | Mandatory before launch | Scheduler/result route |
| `transfer.required_start_ref`, `start_ref_sha` | Transfer packet plus git validation | Mandatory for repo-bound GDI launch | Scheduler preflight |
| `transfer.external_publication_policy` | Transfer packet/workflow context | Mandatory before launch | Stable unless route policy rejects |
| `selection.selected_provider` | Dispatch provider selection | Mandatory before launch | Stable unless rejected before launch |
| `selection.provider_selection_source` | Dispatch | Mandatory before launch | Stable |
| `selection.selected_dock`, `dock_role_kind` | Scheduler/dispatch | Mandatory before launch | Stable |
| `selection.dock_profile_ref`, `launch_root` | Dock profile | Mandatory before launch | Stable |
| `launch_intent.action` | Scheduler-selected action | Mandatory before launch | Stable |
| `launch_intent.intended_worktree` | Scheduler/transfer current-state validation | Mandatory before launch | Stable |
| `launch_intent.intended_launch_cwd` | Dock profile plus dispatch | Mandatory before launch | Stable |
| `launch_intent.intended_branch` | Scheduler/git validation | Mandatory when branch policy applies | Provider/catalog comparisons |
| `launch_intent.command_argv` | Dispatch provider adapter | Mandatory before launch unless rejected/dry-run | Stable |
| `launch_intent.command_env_refs` | Dispatch provider adapter | Mandatory if environment carries packet/route refs | Stable |
| `launch_intent.deadline_or_lease` | Scheduler | Mandatory if scheduler assigned a lease | Scheduler |
| `terminal_substrate.*` | Terminal bridge or dispatch-owned substrate | `not_observed` until bridge/session starts | `/health`, `/ensure`, `/snapshot`, or future primitive |
| `provider_acceptance.*` | Provider terminal/status/adapter bridge | `not_observed` until provider acceptance | Provider output, bridge, or human-supervised receipt |
| `catalog.*` | Provider session catalog | `not_observed` until catalog scan/match | `packages/host/src/session-catalog.ts` or bridge `/sessions` |
| `telemetry.*` | Agent session telemetry | `not_observed` until parsing runs | `packages/host/src/session-telemetry.ts` or bridge `/session-inspector` |
| `result_route.*` | Result route delivery | `not_attempted` until route update | Gateway/broker/Foreman inbox/GitHub/local artifact route |
| `mismatches[]` | Dispatch, catalog, telemetry, route | Empty at creation unless preflight rejects | Every lifecycle observer |
| `evidence.*` | Scheduler/dispatch/result route | Required list may be known at creation | Work/evidence receipt writers |

## Lifecycle

| State | Meaning | Required evidence to enter |
| --- | --- | --- |
| `requested` | Scheduler accepted a transfer packet and dispatch is preparing an attempt. | Packet ref, result route, selected dock/provider policy, idempotence key. |
| `rejected` | Dispatch refused before launch. | Structured mismatch such as unsupported provider, invalid cwd, branch mismatch, missing dock profile, or policy violation. |
| `terminal_started` | A terminal/session substrate exists for this attempt. | Driver, session handle, cwd, command, and bridge health or equivalent substrate proof. |
| `provider_acceptance_unobserved` | Terminal started but dispatch has not observed provider session id or provider acceptance. | Terminal substrate proof and timeout/observation window. |
| `provider_session_observed` | Provider identity/session id or provider status text was observed. | Provider session id or explicit provider acceptance evidence with source. |
| `catalog_matched` | A read-only catalog record matches the provider session. | Catalog record ref with provider, session id, cwd, source file, updated_at, and resume command. |
| `telemetry_observed` | Telemetry, lifecycle, capability, or mismatch events were parsed. | Telemetry event refs or structured telemetry mismatch refs. |
| `completed` | Worker finished and result route was updated or explicitly local-only delivered. | Final worker report, route delivery ref or local-only receipt, and required evidence list satisfied. |
| `failed` | The attempt reached a terminal failure. | Failure mismatch, failed route update, provider exit, or required evidence failure. |
| `blocked` | Human or external state is required. | Concrete blocker such as TCC, auth prompt, missing provider install, or manual permission gate. |
| `expired` | Lease/deadline elapsed before required state. | Scheduler deadline and last observed state. |

`catalog_matched` and `telemetry_observed` are observational states, not proof
that the work completed. A launch attempt can complete without telemetry if the
record explicitly says telemetry remained `not_observed` and the acceptance
criteria for that slice do not require it.

## Mismatch Representation

Mismatches should be append-only objects in `mismatches[]` and may also be
mirrored in the relevant field group. Suggested shape:

```json
{
  "code": "wrong_cwd",
  "severity": "error|warn|info",
  "observed_at": "2026-05-22T00:00:00.000Z",
  "source": "dispatch|terminal_substrate|provider_acceptance|catalog|telemetry|result_route",
  "expected": { "cwd": "/Users/Michael/Code/agent-os/.docks/gdi" },
  "observed": { "cwd": "/Users/Michael/Code/agent-os" },
  "effect": "rejected|failed|not_observed|requires_human|continue_with_warning",
  "evidence_ref": "<evidence-ref-or-not_observed>"
}
```

Initial codes needed before schemas exist:

| Case | Code | Effect |
| --- | --- | --- |
| Wrong launch cwd | `wrong_cwd` | Reject before launch or fail after provider acceptance. |
| Wrong worktree | `wrong_worktree` | Reject before launch unless policy allows. |
| Wrong branch/head | `wrong_branch` or `wrong_head` | Reject before launch or fail provider acceptance. |
| Provider unavailable | `provider_unavailable` | Reject or block depending on whether installation/auth can be remediated. |
| Provider auth prompt | `provider_auth_required` | Block; do not continue unattended. |
| Terminal started but no provider id | `provider_session_id_not_observed` | Move to `provider_acceptance_unobserved`; fail or expire at deadline. |
| Multiple catalog matches | `multiple_catalog_matches` | Warn or fail depending on whether provider session id disambiguates. |
| No catalog match | `catalog_match_not_observed` | Remain `not_observed`; do not fail unless slice requires catalog proof. |
| Telemetry unavailable | `telemetry_unavailable` | Remain `not_observed` or warn; do not invent metrics. |
| Telemetry shape drift | `telemetry_shape_mismatch` | Record telemetry mismatch refs; keep session visible when possible. |
| Route update failed | `route_update_failed` | Fail if result delivery was required; otherwise report local-only fallback explicitly. |

## Idempotence Key

Before the provider session id exists, duplicate prevention should use a stable
launch-intent key:

```text
hash(packet_id_or_ref, scheduler_run_id, selected_dock, selected_provider,
     launch_root, intended_worktree, required_start_ref, result_route_refs,
     action)
```

If `scheduler_run_id` is unique per accepted packet, it should be part of the
key. If the scheduler retries the same run, the same key should cause dispatch
to return the existing launch attempt and current lifecycle state instead of
starting a second provider. If the scheduler intentionally wants a replacement
attempt, it should mint a new scheduler run or dispatch attempt with a clear
supersession link.

The key must not depend on `provider_session_id`, catalog source file, or
telemetry refs because those are unavailable until after launch.

## Relationship To Neighbor Artifacts

| Artifact | Relationship |
| --- | --- |
| Transfer packet | Provides the packet ref, selected recipient/dock, work goal, required start ref, stop conditions, proof requirements, result route, and publication policy. The launch-attempt record should reference the packet rather than copy the whole packet. |
| Scheduler | Owns intake, lease/deadline, selected action, duplicate/superseded/expired decisions, and result-route expectations. The launch-attempt record reports lifecycle facts back to scheduler. |
| Dispatch | Owns provider selection, dock launch root resolution, command construction, terminal substrate handoff, idempotence enforcement, and structured rejection/mismatch facts. |
| Work receipt | Records what the worker did after launch. It can reference `launch_attempt_id` and provider session facts, but it should not replace the launch-attempt record. |
| Evidence receipt | Records immutable proof such as command output, terminal snapshots, catalog records, telemetry events, route responses, or human-needed packets. The launch-attempt record should point to evidence refs. |
| Provider session catalog | Supplies read-only post-launch session discovery: provider, session id, cwd, optional branch, timestamps, source file, and resume command. A missing catalog match is `not_observed` unless the slice requires catalog proof. |
| Telemetry | Supplies parsed provider metrics, lifecycle events, capabilities, and telemetry mismatch diagnostics. Telemetry should stay `not_observed` until transcript/statusline parsing actually runs. |
| Result route | Receives completion, failure, blocked, or expired status plus evidence refs. Route delivery has its own attempt/delivery/failure fields because provider launch can succeed while notification fails. |

## First Real-Launch Prototype Acceptance Evidence

A first supervised real-launch prototype should be accepted only when the
record proves these facts for one bounded run:

- A launch-attempt record is created before provider launch with mandatory
  correlation, packet, route, provider, dock, launch root, command, cwd, and
  idempotence fields.
- A repeated dispatch with the same idempotence key does not start a duplicate
  provider session; it returns the existing attempt or a structured duplicate
  result.
- The terminal substrate is observed with driver, session handle, cwd, command,
  and one snapshot or attach/capture proof.
- Provider acceptance is observed or explicitly times out as
  `provider_acceptance_unobserved`; if observed, the record includes provider
  session id, provider, cwd/branch/head when available, and provider version or
  `not_observed`.
- Catalog matching is attempted after provider acceptance and records exactly
  one matched catalog ref, zero matches, or multiple matches as structured
  state without mutating provider files.
- Telemetry parsing is attempted only through an approved surface and records
  telemetry refs, mismatch refs, or `not_observed`.
- Result-route delivery is attempted according to the packet route and records
  delivered refs or `route_update_failed`.
- Work/evidence receipts reference the launch attempt rather than duplicating
  its correlation fields.
- No provider config, gateway state, GitHub state, schema, dock profile, hook,
  or generated receipt artifact changes unless the prototype explicitly scopes
  and verifies them.

The current dry-run receipt already exposes `dispatch.launch_observability`
with selected provider/dock, launch root, intended cwd/worktree, dry-run
command, `launch_performed: false`, terminal substrate
`not_applicable: dry-run/no-provider-launch`, provider session id
`not_applicable: dry-run/no-provider-launch`, catalog `not_observed`, telemetry
`not_observed`, and mismatch facts. The no-provider terminal substrate test
proves the existing bridge can expose process-driver `/health`, `/ensure`,
`/snapshot`, empty `/sessions`, and missing `/session-inspector` facts with a
harmless command. The first real-launch prototype should combine those two
surfaces without turning the dry-run receipt into a schema.

## Recommended Next Slice

Implement a local, supervised, no-schema launch-attempt prototype that creates
one in-memory or temp-file launch-attempt record, starts only through an
approved terminal substrate, and performs provider launch only under an
explicit work card. The implementation should:

- reuse the dry-run `dispatch.launch_observability` field names where they
  already match this note;
- add the idempotence key and lifecycle state transitions around one launch
  attempt;
- record terminal substrate facts before provider acceptance;
- attempt catalog matching after provider session id is observed;
- leave telemetry as `not_observed` unless an approved parser runs;
- deliver the final result to a local-only route for the prototype.

## Explicit Deferrals

- No generic schema until at least one real-launch prototype proves the field
  boundaries.
- No unattended provider launch without an idempotence key and route policy.
- No scheduler, gateway, broker, GitHub, or external route mutation in this
  docs-only slice.
- No provider config mutation, dock profile mutation, hook mutation, or
  provider transcript mutation.
- No claim that catalog or telemetry exists before catalog scan or
  transcript/statusline parsing runs.
- No decision that Sigil owns AFK lifecycle; the bridge remains an available
  substrate example until a primitive boundary exists.
