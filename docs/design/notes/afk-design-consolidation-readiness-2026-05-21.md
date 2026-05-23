# AFK Design Consolidation Readiness

**Date:** 2026-05-21
**Status:** docs-only consolidation/readiness note

## Summary

This note consolidates the accepted AFK packet, scheduler, and provider-neutral
dispatch sketches into a prototype-readiness map. It aligns vocabulary, assigns
ownership for repeated fields, identifies the minimum receipt trail for one
manual AFK trial, and recommends the next reversible slice.

It does not add a schema, source change, command behavior change, provider
launch, scheduler implementation, dispatch implementation, gateway API change,
work/evidence record implementation, dock/profile mutation, GitHub mutation, or
prototype.

This pass belongs before source prototyping because the current notes now span
several boundaries that are easy to blur: integration ingress, transfer packet,
scheduler lifecycle, provider adapter, terminal substrate, docked worker, and
result receipts. A first local prototype should exercise those boundaries with
one provider and one dock, not accidentally make a single-provider command or
manual clipboard route the platform contract.

## Source Note Inventory

The accepted AFK notes now divide ownership this way:

| Note | Owns |
| --- | --- |
| `afk-transfer-packet-result-route-shape-2026-05-21.md` | One-transfer launch context, result-route kinds, integration-job status mapping, final report fields, and gateway/broker boundary. |
| `afk-session-trigger-scheduler-shape-2026-05-21.md` | Packet intake, current-state validation, idempotence key, start/resume decision, lease/heartbeat policy, lifecycle state, and lifecycle route updates. |
| `afk-provider-neutral-dispatch-shape-2026-05-21.md` | Provider selection, dock launch-root resolution, provider command construction, terminal/session substrate facts, availability/auth drift facts, and provider session facts returned to scheduler. |

`decision-contract-descriptor-and-afk-boundary-2026-05-21.md` still
contributes the reusable-judgment boundary. A Decision Contract descriptor may
select recipient, stop conditions, proof requirements, packet fields, and
result-route requirements, but it does not own one packet's launch state, a
scheduler run, provider process state, or receipts from a completed run.

Older wording in
`docs/design/durable-agent-cognition-and-afk-primitives.md` remains useful as
branch-level synthesis, but its broad "session trigger", "background dispatch",
and "provider-neutral CLI dispatch" sections are superseded for detailed field
ownership by the three accepted AFK notes. The durable cognition note should now
point readers to this consolidation pass before any source prototype.

## Vocabulary Alignment

Canonical terms:

| Term | Use |
| --- | --- |
| Transfer packet | Minimal launch-context artifact for one transfer into a fresh or resumed docked session. |
| Result route | Configured destination and policy for lifecycle and terminal updates. |
| Scheduler run | One scheduler claim over a packet/result-route/work-surface idempotence key. |
| Lease | Time-bounded authority for intake, launch, execution, heartbeat absence, or human-needed pause. |
| Heartbeat | Lightweight lifecycle receipt that a docked provider session still owns the run. |
| Dispatch attempt | One provider-neutral start, resume, dry-run, or reject attempt requested by scheduler. |
| Provider adapter | Provider-specific command, availability, auth, catalog, and telemetry interpreter. |
| Provider session | A concrete Codex, Claude Code, Gemini, or future provider runtime session. |
| Terminal substrate | Tmux or process/pty driver, terminal handle, attachability, capture, health, and process lifetime. |
| Catalog record | Read-only normalized provider session discovery and resume-command record. |
| Telemetry event | Provider-neutral raw lifecycle, metric, capability, or mismatch observation. |
| Work receipt | Durable summary of what one run attempted, did, updated, and recommends next. |
| Evidence receipt | Immutable or append-only proof for commands, route updates, outputs, traces, human answers, or provider observations. |

Avoid these phrases unless the sentence immediately narrows ownership:

| Avoid | Reason |
| --- | --- |
| "Gateway starts a session" | The gateway is ingress/notifier/job presentation, not session authority. |
| "Packet status" | Scheduler owns lifecycle state; the packet is launch context. |
| "Dispatch lifecycle" | Dispatch owns attempts and provider facts; scheduler owns lifecycle. |
| "Provider owns the dock" | The dock owns role identity; provider is an adapter/runtime choice. |
| "Telemetry proves completion" | Telemetry is observation; work/evidence receipts prove run outcomes. |
| "Work record routes the session" | Work records summarize runs; scheduler/result routes deliver lifecycle and terminal updates. |
| "Decision Contract runs AFK" | A Decision Contract selects reusable route outputs; AFK primitives execute and record the run. |

## Duplicate Field And Ownership Map

| Repeated fact | Owner | Other surfaces |
| --- | --- | --- |
| `cwd` and `worktree` | Transfer packet states requested launch/work surface; scheduler validates current state before dispatch. | Dispatch reports actual launch cwd/worktree; catalog/telemetry observe provider facts; receipts summarize mismatches. |
| Branch/start ref | Transfer packet owns required start-ref and branch policy. | Scheduler verifies resolvability/compatibility; dispatch reports actual launch branch when observable; work receipt summarizes final state. |
| Packet id/ref | Transfer packet owns stable identity. | Scheduler references it in idempotence key; dispatch passes it to provider; receipts include it for correlation. |
| Result route ref | Result route owns destinations and route policy. | Packet references it; scheduler updates it; dispatch passes the ref through; work receipt records attempts. |
| Scheduler run id | Scheduler owns run identity and lifecycle state. | Dispatch and receipts reference it; provider session should not redefine it. |
| Dispatch attempt id | Provider-neutral dispatch owns attempt identity. | Scheduler correlates attempt outcomes; evidence receipt stores command/output/proof for each attempt. |
| Lease/deadline | Scheduler owns active lease policy and run deadlines. | Packet may request timeout/lease expectations; dispatch receives launch deadline; receipts record expiry or pause facts. |
| Heartbeat | Scheduler owns heartbeat expectation and lifecycle interpretation. | Provider session emits/checks in; telemetry may observe; evidence receipts store heartbeat receipts when needed. |
| Provider/session id | Provider adapter/session catalog owns observed provider identity. | Dispatch reports it; scheduler correlates resume/running state; work receipt summarizes; packet does not pre-own it. |
| Capability facts | Provider adapter, catalog, and telemetry surfaces own observed capabilities. | Dispatch reports availability/capabilities; scheduler decides policy response; receipts cite what was observed. |
| Verification status | Work receipt owns run-level pass/fail summary; evidence receipts own proof outputs. | Scheduler routes terminal state; packet requests proof; integration job receives coarse result when configured. |
| External publication policy | Transfer packet and work card/profile context own allowed publication. | Scheduler and dispatch preserve policy; work receipt reports whether external routes were attempted. |
| Follow-up route | Result route owns configured destination; work receipt owns next-owner recommendation. | Scheduler delivers configured update; Foreman/GDI/Operator coordination decides subsequent human/agent work. |

The rule is: one surface owns the authoritative value, adjacent surfaces carry
references, observations, or summaries. They should not copy a repeated fact
and then evolve it independently.

## End-To-End AFK Contract Sketch

```text
provider or integration ingress
  -> integration job or sibling completion is recorded
  -> route logic selects recipient, proof needs, and result route
  -> transfer packet carries one-transfer launch context
  -> session trigger/scheduler validates current state and claims a run
  -> scheduler chooses start, resume, dry-run, duplicate, superseded, or reject
  -> provider-neutral dispatch executes one adapter attempt
  -> provider adapter starts/resumes/rejects against a dock launch root
  -> docked provider session accepts packet and performs the bounded goal
  -> worker leaves work and evidence receipts
  -> scheduler/result-route update delivers lifecycle and terminal result
  -> gateway/broker notifies requester only when configured as a route
```

The gateway/broker path may create and update integration jobs, but it remains a
provider ingress, job history, and notifier surface around AOS. Session
authority stays with AOS session control, scheduler, and provider-neutral
dispatch. The docked provider session remains responsible for honoring role
instructions, stop conditions, verification requirements, and local-only
publication policy.

## Minimum Receipt Trail For A Manual Trial

A manual AFK trial can run before schemas exist if it leaves a durable,
reviewable receipt trail. The smallest useful trail is:

1. Transfer receipt: packet id/ref, source event or source artifact, recipient
   dock, cwd/worktree, branch/start ref, stop conditions, proof requirements,
   result-route ref, and external publication policy.
2. Scheduler receipt: scheduler run id, accepted/rejected decision,
   idempotence key, selected start/resume/dry-run/reject action, lease/deadline,
   and any current-state validation failure.
3. Dispatch receipt: dispatch attempt id, selected provider, launch root,
   provider command or dry-run command, driver, availability/auth result,
   provider session id or mismatch reason, and catalog/telemetry references when
   available.
4. Work receipt: bounded goal, files/artifacts changed, commands/checks run,
   route updates attempted, final status, local-only state, blocker or
   next-owner recommendation.
5. Evidence receipts: command output, `git diff --check`, workflow-router
   output, provider availability facts, route HTTP response, notification
   response, human-needed packet, or any other immutable proof needed for the
   run's claims.

Work receipt versus evidence receipt:

| Receipt | Belongs there |
| --- | --- |
| Work receipt | Intent, execution map summary, lifecycle summary, final status, route-update attempts, evidence links, health, next owner. |
| Evidence receipt | Raw command output, test/check output, route responses, trace/artifact paths, screenshots, human answer, provider catalog record, telemetry event, notification proof. |

Outcome representation without schemas:

| Outcome | Manual representation |
| --- | --- |
| No-op | Work receipt says no mutation was needed, why the packet was still valid, which checks proved it, and which routes were updated or skipped. |
| Blocked | Work receipt says blocker class and next owner; evidence receipt stores the concrete failure or human-needed packet. |
| Failed | Work receipt says terminal failure and retry eligibility; evidence receipt stores failed check/output/route response. |
| Partially complete | Work receipt lists completed and incomplete required items, preserved deferrals, and follow-up route; evidence links prove each completed claim. |
| Completed | Work receipt states all required proof passed and no required work remains; evidence receipts include every check and route update needed to prove that. |

## Prototype Readiness Gates

Satisfied by current notes:

- The transfer packet has a launch-context boundary and field sketch.
- Result route kinds and integration-job status mapping are sketched.
- The scheduler owns validation, idempotence, start/resume decisions, leases,
  heartbeats, lifecycle state, and route attempts.
- Dispatch owns provider selection, launch-root resolution, command
  construction, driver facts, provider availability/auth checks, and provider
  session observations.
- Provider catalog and telemetry remain read-only observation contracts.
- Gateway/broker remains provider ingress, job history, and notifier, not
  session authority.

Deferred questions that can stay deferred:

- Exact persisted JSON schemas for packets, scheduler records, dispatch
  attempts, work receipts, and evidence receipts.
- Exact CLI spelling for `aos session trigger` or `aos session dispatch`.
- Exact provider fallback ranking and auth check implementation.
- Whether Gemini starts as dry-run-only or gains a catalog adapter first.
- UI/workbench projection for AFK runs.
- Researcher dock or role creation.

Questions to answer before source work:

- What is the first prototype's receipt storage location and file naming
  convention?
- Is the first source slice a dry-run only, or may it start one local provider
  session?
- Which one provider and one dock are in scope for the first prototype?
- What idempotence key is enough for the prototype to avoid duplicate local
  launches?
- Which receipt fields are mandatory for review even before schemas exist?
- Which current command should own the first dry-run output, if any, without
  implying the final CLI contract?

Lowest-risk source prototype shape, once those answers are fixed:

```text
local dry-run command or script
  -> reads a docs-only/manual packet fixture
  -> validates cwd/worktree/start-ref and source-artifact presence
  -> chooses one dock and one provider adapter in dry-run mode
  -> emits scheduler and dispatch receipts
  -> writes no gateway job, starts no provider, changes no schemas
```

That would test idempotence, field ownership, and receipt review without
committing to session launch behavior.

## Boundary Matrix

| Surface | Owns | Does not own |
| --- | --- | --- |
| Packet/result route | One-transfer launch context and configured lifecycle/result destinations. | Scheduler state, provider handles, immutable proof, reusable route rules. |
| Scheduler | Packet intake, current-state validation, idempotence, lease/heartbeat policy, lifecycle state, route update attempts. | Provider-specific CLI mechanics, proof semantics, gateway schema/API, route judgment. |
| Dispatch | One start/resume/dry-run/reject attempt, provider selection, dock launch-root resolution, provider command, driver/session facts. | Packet validation, lifecycle authority, gateway job state, dock role policy, final verification interpretation. |
| Provider adapter | Executable/version/auth checks, command shape, provider-local catalog and telemetry interpretation. | Permanent dock identity, scheduler lifecycle, gateway routes, role instructions. |
| Dock profile/session | Role identity and one bounded execution round under dock instructions. | Provider choice, broad workstream planning, packet redefinition, gateway session ownership. |
| Provider catalog/telemetry | Read-only session discovery, resume command facts, lifecycle/metric/capability/mismatch observations. | Launch mutation, scheduler policy, route updates, proof semantics. |
| Terminal substrate | Tmux/process handle, attachability, capture, input/output buffer, health, process lifetime. | Dock identity, packet validation, provider policy, result-route delivery. |
| Work/evidence receipts | Work receipt owns run summary and evidence links; evidence receipts own immutable proof. | Route selection, scheduler queue, provider launch mechanics, reusable judgment. |
| Integration broker/gateway | Provider ingress, workflow catalog, persisted job history, start/complete/fail transitions, notifier delivery. | AOS session authority, dock semantics, scheduler leases, provider-neutral dispatch, proof semantics. |
| Foreman/GDI/Operator coordination | Human/agent role authority, work-card routing, deterministic execution, supervised evidence, and next-owner recommendation. | Hidden session engine behavior, provider launch policy unless explicitly assigned, schema ownership by convention. |

## Explicit Deferrals

This consolidation preserves these deferrals:

- no schema or command implementation;
- no provider launch;
- no gateway job schema/API mutation;
- no work/evidence record implementation;
- no dock/profile/instruction mutation;
- no GitHub mutation or external publication;
- no Researcher dock creation;
- no provider-neutral dispatch implementation;
- no session trigger/scheduler implementation;
- no transfer packet implementation;
- no async result-routing implementation.

## Recommendation

The next slice should be a docs-only work/evidence receipt shape.

That is the smallest reversible step because the first prototype cannot be
reviewed without a receipt contract, and the current notes still leave receipt
fields split across packet, scheduler, dispatch, final report, work record, and
evidence record language. A receipt-shape note can decide mandatory manual-trial
fields, storage conventions, status vocabulary, and evidence links without
adding schemas or launching providers. After that, a deterministic local
dry-run prototype can target one packet fixture, one dock, and one provider
adapter while preserving the boundaries consolidated here.
