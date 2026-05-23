# AFK Work Evidence Receipt Shape

**Date:** 2026-05-21
**Status:** docs-only work/evidence receipt sketch

## Summary

This note defines the minimum receipt shape for one manual AFK trial and for a
later deterministic dry-run prototype.

It does not add a schema, source change, command behavior change, fixture,
provider launch, scheduler implementation, dispatch implementation, gateway
mutation, generated receipt, or prototype. It only names the temporary receipt
bundle a worker and scheduler-style manual operator should leave so a finished
AFK run is reviewable after the session ends.

This is the last docs boundary before a deterministic dry-run prototype if no
gaps are found. The accepted AFK packet, scheduler, dispatch, and consolidation
notes already separate launch context, lifecycle authority, provider/session
facts, and gateway notification. The remaining blocker to a dry-run prototype
is receipt shape: what a run must leave behind to prove what happened without
pretending persisted work/evidence schemas already exist.

## Source Inventory

Receipt obligations come from these existing surfaces:

| Source | Receipt obligation |
| --- | --- |
| `afk-transfer-packet-result-route-shape-2026-05-21.md` | Carry packet id/ref, source event/artifact, recipient dock, cwd/worktree, branch policy, required start ref, selected outputs, proof requirements, stop conditions, result route, final report fields, and integration-job status mapping. |
| `afk-session-trigger-scheduler-shape-2026-05-21.md` | Record scheduler run id, intake validation, idempotence key, accepted/rejected action, lease/deadline, heartbeat expectation, lifecycle state, route attempts, duplicate/superseded/expired outcomes, and human-needed state. |
| `afk-provider-neutral-dispatch-shape-2026-05-21.md` | Record dispatch attempt id, selected provider, dock launch root, provider command or dry-run command, terminal substrate, availability/auth checks, provider session facts, catalog references, telemetry references, and provider drift/mismatch facts. |
| `afk-design-consolidation-readiness-2026-05-21.md` | Reuse the duplicate-field ownership map, minimum manual-trial receipt trail, and prototype-readiness questions. |
| `aos-work-records-and-self-healing-recipes.md` | Reuse the durable work-record layers: intent, execution map, evidence, and health. |
| `docs/api/integration-broker.md` | Preserve current broker job statuses: `queued`, `running`, `succeeded`, and `failed`; treat broker routes as result targets, not session authority. |
| `provider-session-catalog.md` | Cite read-only provider session discovery facts such as provider, session id, cwd, branch, timestamps, source file, and resume command. |
| `agent-session-telemetry.md` | Cite raw provider-neutral metrics, lifecycle events, capabilities, and mismatch diagnostics without converting them into proof by themselves. |

Reused terms: transfer packet, result route, scheduler run, lease, heartbeat,
dispatch attempt, provider adapter, provider session, terminal substrate,
catalog record, telemetry event, work receipt, and evidence receipt.

Temporary terms in this note: receipt bundle, manual receipt root, receipt
manifest, and proof summary. They are review vocabulary for the manual and
dry-run phases. They should either disappear or become explicit schema fields
when the real work/evidence record contracts exist.

## Receipt Taxonomy

A receipt bundle is the reviewable set of linked receipts for one AFK run. It
does not become a schema. It is a manual convention that keeps future schemas
honest.

| Receipt | Owns | Does not own |
| --- | --- | --- |
| Transfer receipt | The one-transfer launch facts: packet id/ref, source event/artifact, selected recipient, cwd/worktree/branch/start-ref policy, proof requirements, stop conditions, external publication policy, and result-route references. | Scheduler lifecycle state, provider process/session identity, proof outputs, or final worker claims. |
| Scheduler receipt | The run claim: scheduler run id, idempotence key, intake validation, start/resume/dry-run/reject decision, lease/deadline, heartbeat expectation, lifecycle state, duplicate/superseded/expired facts, and route attempts. | Provider-specific command construction or proof semantics. |
| Dispatch receipt | One provider-neutral attempt: dispatch attempt id, selected provider, selected dock launch root, command or dry-run command, terminal driver, availability/auth facts, provider session/catalog/telemetry observations, and mismatch/rejection facts. | Packet validation, scheduler lifecycle policy, dock role policy, or final work status. |
| Work receipt | What the worker attempted and concluded: goal, constraints, execution summary, changed paths/artifacts, checks run, route updates attempted, final status, blocker if any, local-only state, health, next owner, and follow-up recommendation. | Raw proof output or provider telemetry internals. |
| Evidence receipt | Immutable or append-only proof: command output, check output, route responses, notification responses, catalog records, telemetry observations, trace paths, screenshots, human-needed packets, or human answers. | Run-level interpretation by itself. Evidence supports claims; it does not replace the work receipt. |

These receipts relate to future persisted records this way:

```text
transfer receipt -> future transfer packet record or packet ref
scheduler receipt -> future scheduler/session-run record
dispatch receipt -> future dispatch-attempt record
work receipt -> future work record
evidence receipt -> future evidence record
```

Until schemas exist, the receipt bundle should be readable Markdown with fenced
command outputs or local artifact links. Any machine-readable block inside it
is illustrative and local to that note.

## Mandatory Field Sketch

Every reviewable AFK receipt bundle must include these facts, even when the
value is `not_applicable`, `not_observed`, or `missing_with_reason`.

| Group | Mandatory fields |
| --- | --- |
| Run identity and correlation | `receipt_bundle_id`, `created_at`, `updated_at`, `packet_id_or_ref`, `scheduler_run_id`, `dispatch_attempt_ids`, `source_event_or_artifact`, and `result_route_refs`. |
| Source and packet/result-route references | Work card or design note path, integration job id when present, Decision Contract output ref when present, packet ref, selected recipient, proof requirements, stop conditions, and external publication policy. |
| Work surface | `cwd`, `worktree`, `branch`, `required_start_ref`, `start_ref_sha` when resolved, branch policy, dirty/untracked baseline, and whether the surface is local-only or pushable. |
| Dock and provider/session facts | Dock, role kind if selected, provider or provider policy, provider session id when observed, terminal substrate, launch root, command or dry-run command, catalog record refs, telemetry event refs, auth/availability status, and mismatch facts. |
| Lifecycle facts | Intake decision, selected scheduler action, lifecycle state transitions, lease/deadline, heartbeat expectation, heartbeat observations or absence, duplicate/superseded/expired facts, route-update attempts, and final status. |
| Work and verification facts | Bounded goal, commands/checks run, pass/fail results, changed paths, artifacts created, artifacts deliberately not created, explicit deferrals preserved, local-only state, blocker class, next owner, and follow-up recommendation. |
| Evidence facts | Evidence receipt ids or paths, proof summaries for every required claim, command output refs, workflow-router output ref, provider catalog/telemetry refs, route/notification response refs, human-needed refs, and missing-evidence explanations. |

Minimum review rule: a final status is not proved unless each mandatory field is
present or explicitly marked missing with a reason, and each required proof
claim links to an evidence receipt or says why no evidence exists.

## Temporary Storage And Naming

Manual receipts before schemas exist should live under:

```text
docs/design/notes/manual-afk-receipts/
```

That directory is intentionally a design-note staging area, not the final home
for work records or evidence records. A manual run should use one Markdown file
per receipt bundle:

```text
docs/design/notes/manual-afk-receipts/<YYYY-MM-DD>-<packet-or-source-slug>-<dock>-<status>.md
```

Examples:

```text
docs/design/notes/manual-afk-receipts/2026-05-21-afk-receipt-shape-gdi-completed.md
docs/design/notes/manual-afk-receipts/2026-05-21-slack-kilos-researcher-human-needed.md
```

The receipt file should contain sections for transfer, scheduler, dispatch,
work, and evidence receipts. If a run creates large or sensitive proof, the
receipt should link to local-only artifact paths and state that they are not
committed. Examples of local-only artifacts include provider transcripts, full
command logs with secrets, screenshots containing private data, temporary
handoff files, and raw traces that were not explicitly approved for the repo.

Do not commit successor-Foreman handoffs as work cards or manual receipts. A
successor handoff belongs in chat, clipboard, or a temp file. Create a work
card only when the artifact assigns a deterministic GDI/correction round.
Create a manual AFK receipt only when it records a run result and evidence.

## Status Vocabulary

Use this run-level vocabulary in work receipts:

| Status | Meaning | Route update | Next-owner recommendation |
| --- | --- | --- | --- |
| `no-op` | The packet/run was valid, but no mutation or execution was needed. | Send a terminal success-style local/work-record update; complete an integration job only when the route defines no-op as successful completion. | Usually `foreman` for review or `none` when no action remains. |
| `blocked` | Progress stopped on an external or policy condition that can plausibly be resolved without replacing the packet. | Write human-needed or blocked metadata; notify requester only when route policy calls for it; keep an integration job queued/running if resumable. | `human`, `operator`, or `foreman`, depending on blocker class. |
| `failed` | A required validation, dispatch, execution, verification, or route operation reached terminal failure for this run. | Send failure route; map to integration job `failed` when the broker route is configured. | `foreman` for correction routing, or `human` if external recovery is required before retry. |
| `partially-complete` | Some required work or proof finished, but one or more required items remain incomplete. | Send failure or blocked route unless a local work-record route supports partial terminal state; include completed and missing proof. | `foreman` for next-slice selection. |
| `completed` | Every required proof passed, route attempts are recorded, and no required work remains. | Send terminal success route; map to integration job `succeeded` when the broker route is configured. | `foreman` for review/merge when a relay branch exists, or `none` when the route is self-contained. |

Scheduler-only statuses may appear in scheduler receipts:

| Status | Meaning | Route update | Next-owner recommendation |
| --- | --- | --- | --- |
| `duplicate` | The idempotence key is already owned by an active or terminal compatible run. | Record duplicate and point to owning run; do not launch a second provider session. | `foreman` only if duplicate ownership is ambiguous. |
| `superseded` | A newer packet, route, or source artifact invalidated this run before completion. | Record superseding ref and stop dispatch; prevent stale terminal overwrite. | `foreman` for route cleanup or no action if supersession is expected. |
| `expired` | Intake, launch, execution, or heartbeat lease expired before terminal worker result. | Record timeout/stale evidence; fail or mark stale according to route policy. | `foreman` for retry decision, or `human` if the expiry came from a human-needed stall. |

Do not use `stalled` as a final work status in this note. Use `blocked` with a
blocker class and next owner. A future scheduler lifecycle may still use
`stalled` internally when it needs to distinguish resumable automation pause
from human-needed.

## Evidence Link Rules

Evidence links should be precise enough that a reviewer can inspect the proof
without reading an entire provider transcript.

| Evidence kind | Link rule |
| --- | --- |
| Command output | Store the exact command, cwd, exit status, timestamp, and relevant output excerpt or artifact path. For long output, link to a local-only log and summarize the claim it proves. |
| Workflow-router output | Include the `./aos dev recommend --json` command, whether it succeeded, its rule ids/classes/actions summary, and any changed-file caveat. |
| Provider availability/auth facts | Cite the adapter check or dispatch dry-run output. If no provider was launched, say `not_applicable: dry-run/no-provider-launch`. |
| Catalog observations | Cite provider, session id, cwd, branch, timestamps, source file, and resume command from a catalog record, or say no compatible catalog record was observed. |
| Telemetry observations | Cite telemetry record type, observed timestamp, provider/session identity, metric/event/capability/mismatch code, and source precision. Do not claim telemetry proves completion unless it is paired with work/evidence proof. |
| Route or notification response | Record route kind, target, request id when available, response status/body summary, retry status, and whether requester notification happened. |
| Human-needed packet | Record blocker class, human action requested, route used, whether the run is resumable, and the exact evidence that automation cannot proceed. |
| Changed files or artifacts | Link to paths relative to repo root for committed/reviewable files. For generated or sensitive local-only artifacts, link to local path only if appropriate and mark `local_only`. |
| Missing evidence | Use `missing_with_reason`, state the missing evidence kind, explain why it is unavailable, and describe whether that blocks completion or merely lowers confidence. |

Missing evidence must be honest. A receipt may still be useful with missing
evidence, but it cannot claim `completed` for a requirement whose proof is
missing or indirect.

## Manual Trial Example

Illustrative bundle for one docs-only AFK run, kept here as an example rather
than a separate fixture:

```markdown
# Manual AFK Receipt: afk-receipt-shape GDI completed

receipt_bundle_id: manual-afk-2026-05-21-afk-receipt-shape-gdi
created_at: 2026-05-21T00:00:00Z
final_status: completed

## Transfer Receipt

- packet_id_or_ref: manual dispatch in
  `docs/design/work-cards/afk-work-evidence-receipt-shape-v0.md`
- source_artifact:
  `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- recipient: gdi
- cwd: `/Users/Michael/Code/agent-os`
- worktree: same as cwd
- branch: `gdi/afk-work-evidence-receipt-shape-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- result_route_refs: local completion report to Foreman/human chat
- external_publication_policy: no GitHub mutation; keep checkpoint local unless
  explicitly asked

## Scheduler Receipt

- scheduler_run_id: manual-gdi-round
- idempotence_key: source_artifact + required_start_ref + branch
- intake_decision: accepted
- selected_action: dry-run-style manual execution, no provider launch
- lease: current GDI goal turn
- heartbeat: chat/tool progress updates only
- route_attempts: final local completion report

## Dispatch Receipt

- dispatch_attempt_id: manual-existing-session
- provider: codex
- terminal_substrate: existing local Codex CLI session
- command: not_applicable, session already active
- catalog_ref: not_observed
- telemetry_ref: not_observed
- availability_auth: not_checked, no provider launch required

## Work Receipt

- goal: create docs-only AFK work/evidence receipt note
- commands_checks:
  - `git status --short --branch`
  - `./aos dev recommend --json`
  - `git diff --check`
- changed_paths:
  - `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
  - `docs/design/durable-agent-cognition-and-afk-primitives.md`
- explicit_deferrals: schemas, fixtures, provider launch, gateway mutation,
  work/evidence record implementation, external publication
- final_status: completed
- next_owner: foreman
- follow_up: deterministic local dry-run prototype

## Evidence Receipts

- router_output: `./aos dev recommend --json` succeeded and classified the
  branch as docs-only.
- diff_check: `git diff --check` passed.
- missing_evidence: provider catalog and telemetry are not applicable because
  the run did not launch or inspect a provider session.
```

## Prototype Readiness Decision

This receipt shape answers the questions that blocked a deterministic dry-run
prototype:

- The dry run can emit one receipt bundle with transfer, scheduler, dispatch,
  work, and evidence sections instead of inventing schemas.
- Mandatory review fields are known for run identity, source refs, work
  surface, dock/provider/session facts, lifecycle, commands/checks, changed
  paths, local-only state, blockers, next owner, follow-up, and proof links.
- Manual storage and file naming are defined for pre-schema receipts.
- Run-level status vocabulary is separated from scheduler-only duplicate,
  superseded, and expired states.
- Missing evidence has an explicit representation and cannot silently support a
  completed claim.

Remaining questions can stay deferred until after a dry-run prototype:

- Exact JSON schemas for packets, scheduler records, dispatch attempts, work
  records, and evidence records.
- Exact final CLI spelling for session trigger, scheduler, dispatch, and
  receipt writing.
- Exact route retry/de-duplication implementation.
- Provider fallback ranking and active provider launch behavior.
- UI/workbench projection for receipt bundles.

No remaining docs-only question blocks a deterministic dry-run prototype, as
long as the prototype writes only a local receipt bundle or dry-run output,
starts no provider, changes no schemas, and treats all command names as
experimental.

## Explicit Deferrals

This slice deliberately defers:

- schemas;
- source/tests/command behavior;
- fixtures or generated artifacts;
- provider launch;
- gateway API or schema mutation;
- work/evidence record implementation;
- dock/profile/instruction mutation;
- GitHub mutation or external publication;
- Researcher dock creation.

## Recommendation

The next slice should be a deterministic local dry-run prototype. It is the
smallest reversible step because it can validate packet intake, current-state
checks, idempotence, provider selection as a dry-run fact, and receipt emission
without launching a provider, mutating the gateway, or committing schema
contracts. If the dry run exposes missing mandatory fields, correct this receipt
shape before moving to provider launch.
