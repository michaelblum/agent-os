# AFK Authorization Safety Contract

**Date:** 2026-05-24
**Status:** docs-only safety contract and implementation sequence

## Summary

An AFK authorization is an explicit, bounded user authorization for AOS to keep
working while the human is not watching. It is not an unattended alias for the
current `--supervised-live-launch --i-am-present` path, and it must not weaken
that path. The current human-present launch gate stays correct for supervised
live provider launch.

The AFK authorization contract adds a separate authorization packet that can later
permit a scheduler to run pre-approved local work until the lease expires or a
stop condition is hit. It preserves branch isolation, local receipts, hard
budgets, cleanup proof, and a wake-up report. This note does not implement a
command, schema, fixture, provider launch, queue, gateway route, notifier, PR
flow, or unattended behavior.

Compatibility note: earlier prototype code and receipts use `sleep_lease`
fields and `--sleep-lease*` flags. Those names remain compatibility spellings;
new user-facing help and examples should prefer `AFK authorization` and
`AFK live launch`.

## Relationship To Current AFK Surfaces

Current accepted AFK work already separates:

- transfer packet launch facts;
- scheduler validation, idempotence, lifecycle, lease, and route state;
- provider-neutral dispatch and launch-attempt evidence;
- guarded supervised live launch under explicit human presence;
- local work/evidence receipt shape;
- provider transcript/catalog boundaries;
- cleanup proof.

An AFK authorization sits above those surfaces as a user authorization envelope. It
does not replace the transfer packet, work card, scheduler run, launch attempt,
work receipt, or evidence receipt. The scheduler may consume a lease only after
the lease packet and each queued work item validate against current state.

## Authorization Model

A valid AFK authorization must include these fields before any unattended work is
eligible:

| Field | Required decision |
| --- | --- |
| `lease_id` | Stable local id for idempotence, duplicate detection, and wake-up reporting. |
| `authorized_by` | The local human/user identity or explicit local operator string. |
| `authorized_at` | Timestamp when the human granted the lease. |
| `expires_at` | Absolute timestamp. No relative-only lease is valid. |
| `max_wall_clock_minutes` | Maximum duration from first accepted scheduler run, capped by policy even if `expires_at` is later. |
| `max_provider_launches` | Hard count across all work items. `0` is valid for deterministic-only dry runs. |
| `provider_budget` | Token or spend budget when a provider exposes enforceable limits. Until provider enforcement exists, store `not_enforceable_yet` plus the user-declared ceiling and treat lack of enforcement as a wake-up disclosure. |
| `allowed_docks` | Explicit list. Near-term default: `["implementer"]`; `operator` is denied unless the lease names a supervised capture plan that does not require live human judgment. |
| `allowed_providers` | Explicit list. Near-term default: `["codex"]` only after provider-auth checks pass. |
| `allowed_work_refs` | One work card ref or a small ordered queue of refs. No broad "any work" authorization. |
| `allowed_branch_policy` | Branch creation, commit, push, and local-only constraints. No merge to `main`. |
| `allow_branch_push` | Explicit boolean. Default `false`; if `true`, only named `implementer/*` branches may be pushed and the wake-up report must list pushed refs. |
| `external_publication_policy` | Default `none`: no GitHub issue/PR mutation, Slack/gateway notification, external notifier, or public route. |
| `result_route` | Local route for receipts and wake-up report, required before launch. |
| `stop_conditions` | Lease-wide stop conditions in addition to work-card stop conditions. |

The authorization grant should be represented as a local packet or queue record before
provider launch. It should be written before the first scheduler action so a
duplicate invocation can prove whether work is already authorized, running,
completed, expired, or rejected.

## Work Scope

The first implementation should support exactly one pre-approved work card.
A small ordered queue can follow after one-card lease validation and receipt
writing are proven. A queue must be explicit and finite, with each item carrying
its own required start ref, expected branch/output behavior, verification
commands, stop conditions, and result route.

Foreman may not choose a new card while the human is asleep unless that exact
choice is already represented in the lease queue. Implementer may continue after a test
failure only for one bounded correction attempt named by policy, such as "fix
the immediate failure and rerun the same verification once." After that, the
run stops as `manual_intervention` or `failed`.

Operator and human-in-the-loop work are forbidden by default during a sleep
lease. Any task that asks for visual judgment, login, CAPTCHA, consent, account
creation, purchase, legal acceptance, external submission, ambiguous selector
approval, or human preference must stop and be represented as
`human_judgment_needed` in the receipt.

Work that needs human judgment is not a partial authorization gap to work
around. The worker records the blocker, preserves local state, and waits for a
wake-up decision.

## Start Gates

The scheduler must reject or block the lease before provider launch unless all
selected gates pass:

- The lease packet exists, is parseable, is not expired, and has not been
  superseded.
- The result route and receipt root are writable.
- A pre-launch lease receipt is written with lease id, selected work ref,
  idempotence key, baseline state, and planned action.
- Duplicate/idempotence checks prove no active or terminal compatible run
  already owns the same lease/work/ref/action tuple.
- The repo path, worktree, required start ref, source artifacts, and work card
  all resolve in current state.
- The worktree is clean, or the lease allows a path-scoped dirty-state baseline
  and every dirty path is named before launch.
- The branch policy can create or reuse the expected isolated work branch
  without overwriting unrelated local changes.
- `./aos ready` passes when the work requires live AOS control, or the lease
  explicitly selects a deterministic-only fallback that does not need runtime
  readiness.
- Provider availability/auth checks pass without prompting for credentials,
  install, subscription, browser login, or interactive consent.
- The selected dock and provider are allowed by the lease and by current dock
  role contracts.
- The provider token/spend budget is enforceable, or the run records
  `provider_budget=not_enforceable_yet` and applies only wall-clock and launch
  count limits.

If any start gate fails, no provider, bridge, terminal, tmux session, gateway
job, result route, external notifier, or transcript/catalog scan should start.
The receipt records `rejected`, `blocked`, or `manual_intervention` with the exact
gate.

## Runtime Guardrails

Runtime state should be local, bounded, and reviewable:

- Lease files live under a runtime-mode isolated local state root, not under
  committed docs. A design-phase prototype may use a temp path or
  `docs/design/notes/manual-afk-receipts/` only for manually reviewed
  receipts.
- Heartbeats are lightweight lifecycle records, not transcript bodies. Initial
  cadence: every 10 minutes or after each command/check/commit boundary,
  whichever comes first.
- Receipts update at start, each work-card state transition, each verification
  gate, each provider launch/cleanup boundary, and terminal completion/failure.
- The scheduler enforces the earlier of `expires_at`,
  `max_wall_clock_minutes`, provider launch count, and any provider budget it
  can enforce.
- Provider launches are counted before process start and reconciled after
  cleanup. Failed launches still consume the launch count unless launch never
  began.
- Retry limits are explicit: one provider launch retry at most, and one bounded
  correction attempt after verification failure at most, only when the lease
  permits them.
- Process cleanup proof is required before reporting terminal success:
  bridge stopped or unreachable, owned provider command child/group exited, no
  owned `pty-proxy.py` process remains, and temporary owned scratch files are
  removed.
- Branch isolation is mandatory. No merge to `main`, no direct `main` commit,
  no destructive cleanup, and no rewriting unrelated local state.
- No PR, GitHub issue mutation, Slack/gateway notification, external
  publication, or durable public route occurs unless the AFK authorization explicitly
  authorizes that exact route. Near-term AFK authorizations should keep this set to
  none.
- Provider transcript bodies are out of bounds. Receipts may store bounded
  metadata such as provider session id, path, mtime, size, cwd, branch, head,
  adapter correlation, and cleanup facts.
- Provider stores, catalogs, telemetry, gateway state, dock profiles, hooks,
  and Codex configuration are read-only unless a future lease explicitly names
  a reviewed mutation. The near-term contract forbids those mutations.

## Stop Conditions

The run stops immediately when any of these conditions appears:

- TCC/readiness blocker or inactive input tap for work that requires live AOS
  control.
- Provider auth prompt, credential prompt, install prompt, subscription prompt,
  or account switch.
- Unexpected provider or dock prompt that is not part of the pre-approved work
  card.
- Permission request from macOS, browser, provider, shell, package manager, or
  external service.
- Unrelated dirty worktree state appears after baseline capture.
- Required start ref, work card, or source artifact disappears or drifts.
- Merge conflict, rebase requirement, or branch rewrite requirement.
- Verification fails after the lease's bounded correction attempt is consumed.
- Provider timeout, lost heartbeat, lost process ownership, or cleanup proof is
  missing.
- Token/spend/time/launch budget is reached or cannot be measured as promised.
- A task requires external publication, issue/PR mutation, push not authorized
  by the lease, or any human judgment.
- A provider transcript body would need to be read to prove completion.
- The scheduler cannot write or update the receipt.

Stop outcomes should use existing receipt vocabulary where possible:
`blocked`, `failed`, `expired`, `manual_intervention`, or `partially-complete`.
Do not claim `completed` when evidence is missing or indirect.

## Wake-Up Report

The wake-up report is the human-facing receipt summary. It should be compact,
but every claim must link to local receipt or evidence paths. Required fields:

- lease id, authorization time, expiry, wall-clock duration, and final status;
- selected dock/provider and provider launches attempted;
- branch, base ref, start SHA, head SHA, commits, and pushed branches;
- changed files and intentionally untouched files or queues;
- commands/tests/checks run, pass/fail result, and exact failing command when
  applicable;
- provider sessions launched with bounded metadata only: provider, session id,
  launch cwd, branch/head if observed, transcript/catalog ref, mtime/size, and
  adapter correlation status;
- token/spend estimate when available, or `not_available` /
  `not_enforceable_yet` with reason;
- local artifacts, receipt paths, evidence paths, and any local-only sensitive
  artifacts not committed;
- cleanup proof and any cleanup blocker;
- result route attempts and whether any external route was deliberately not
  attempted;
- unresolved blockers, stop condition, and whether the work is resumable;
- the next human decision, such as review branch, approve push, rerun failed
  test, grant permission, choose next work card, or discard local branch.

The report should not paste full transcripts, large logs, secrets, provider
stores, or unreviewed generated artifacts into chat.

## Near-Term Implementation Sequence

1. Add deterministic AFK authorization packet validation with no provider launch.
   Validate required authorization fields, expiry, duration, provider launch
   count, allowed docks/providers, work refs, branch policy, result route,
   duplicate key, and stop condition vocabulary.
2. Emit dry-run receipts for both accepted and rejected AFK authorizations. The
   receipt should prove why authorization would or would not be eligible without
   launching providers, changing branches, pushing, or writing generated
   schemas.
3. Run a guarded AFK live launch proof with a short duration while the human
   is awake. It must use explicit AFK authorization, keep
   `--i-am-present` semantics for the supervised proof, launch only the
   approved provider/dock/work ref, and stop on the first policy mismatch.
4. Only after the dry-run and awake guarded-live gates pass, attempt the first
   true overnight run. That run should be one pre-approved Implementer work card,
   local-only by default, with branch push disabled unless explicitly granted,
   and with a wake-up report as the primary result.

## Explicit Deferrals

This note deliberately does not add:

- a new standalone authorization command;
- final `aos session` spelling;
- unattended, background, or sleep aliases for the current supervised live
  command;
- schemas, fixtures, generated receipt artifacts, gateway routes, broker
  routes, Slack/notifier routes, GitHub issue/PR mutation, or external
  publication;
- provider transcript body reading or provider store/catalog/telemetry
  mutation;
- dock profile, hook, Codex config, or runtime mutation;
- a Researcher dock or broad queue-selection policy.

## Recommendation

The next source slice should be deterministic AFK authorization packet validation and
dry-run receipt output. It should reject invalid or expired leases before any
provider launch and should produce a reviewable accepted/rejected receipt for
one pre-approved work card. A true overnight run should wait until that dry run
and one short awake guarded-live lease proof both pass.
