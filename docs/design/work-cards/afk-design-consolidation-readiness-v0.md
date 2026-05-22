# Work Card: afk-design-consolidation-readiness-v0

**Status:** Ready for GDI
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- Single next goal: consolidate the accepted AFK packet, scheduler, and
  provider-neutral dispatch sketches into a prototype-readiness map.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-provider-neutral-dispatch-shape-v0.md`

The accepted provider-neutral dispatch note says the AFK path is now sketched
from inbound packet, through scheduler and dispatch, into a docked provider
session, and back to lifecycle/result routes. The next risk is not another
primitive sketch; it is whether the notes use one coherent vocabulary and
whether a first manual or local prototype can produce enough work/evidence
receipts without prematurely adding schemas or command behavior.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create one docs-only consolidation/readiness note that makes the AFK design
branch reviewable as a coherent local plan before source prototyping.

The note should:

- align vocabulary across transfer packet/result route, session
  trigger/scheduler, provider-neutral dispatch, provider adapter/session
  catalog/telemetry, terminal substrate, and future work/evidence records;
- identify duplicate or overlapping fields across the three AFK notes and name
  the owning surface for each repeated fact;
- define the minimum receipt trail a manual trial or first local prototype must
  leave behind;
- decide whether the next slice should be a docs-only work/evidence record
  receipt shape, a deterministic local dry-run prototype, or another
  consolidation correction.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
- `docs/design/remote-session-control.md`
- `docs/design/worktree-session-scope.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/api/integration-broker.md`
- `shared/schemas/provider-session-catalog.md`
- `shared/schemas/agent-session-telemetry.md`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is docs/design validation. Do not run `./aos ready` unless you discover a
need for live runtime evidence, which is not expected.

## Branch/Base

branch_from: `docs/durable-agent-cognition-v0`
required_start_ref: `docs/durable-agent-cognition-v0`

This card depends on local-only accepted design notes and accepted work cards
on the branch above. Do not reset to `origin/main`.

If you create an output branch, use
`gdi/afk-design-consolidation-readiness-v0` from the required start ref. Keep
the checkpoint local unless Foreman or Michael explicitly asks for a push or
PR.

## Existing Surfaces To Inspect

Start with:

- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md` -
  packet fields, result destinations, status mapping, and route ownership.
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md` -
  packet intake, current-state checks, leases, heartbeats, lifecycle state, and
  start/resume decisions.
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md` -
  provider/session command boundary, adapter comparison, idempotence keys, and
  dispatch lifecycle.
- `docs/design/durable-agent-cognition-and-afk-primitives.md` - current
  sequence and the branch-level synthesis.
- `docs/design/aos-work-records-and-self-healing-recipes.md` - existing
  work/evidence record vocabulary that a receipt trial should reuse or
  explicitly distinguish.
- `docs/api/integration-broker.md` - current integration job and async result
  boundaries.
- `shared/schemas/provider-session-catalog.md` and
  `shared/schemas/agent-session-telemetry.md` - existing provider observation
  vocabulary that should not be duplicated in a packet or proof record.

Search as needed for:

```bash
rg -n "transfer packet|result route|scheduler|lease|heartbeat|dispatch|provider-neutral|work record|evidence record|receipt|integration job|provider session|telemetry|catalog|terminal substrate|Decision Contract|Inference Block" docs shared packages apps .docks AGENTS.md
```

## Required Output

Create:

- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`

Use this shape:

1. Summary:
   - docs-only consolidation/readiness note;
   - no schema, source change, command behavior change, provider launch,
     scheduler implementation, dispatch implementation, gateway API change, or
     prototype;
   - why this pass comes before source prototyping.
2. Source note inventory:
   - what each accepted AFK note now owns;
   - what the Decision Contract descriptor/AFK boundary note still contributes;
   - which older wording is superseded by packet/scheduler/dispatch notes.
3. Vocabulary alignment:
   - canonical names for packet, result route, scheduler run, lease,
     heartbeat, dispatch attempt, provider adapter, provider session, terminal
     substrate, catalog record, telemetry event, work receipt, and evidence
     receipt;
   - names or phrases to avoid because they blur ownership.
4. Duplicate field and ownership map:
   - repeated facts such as cwd/worktree, branch/start ref, packet id/ref,
     result route ref, scheduler run id, dispatch attempt id, lease/deadline,
     provider/session id, capability facts, verification status, external
     publication policy, and follow-up route;
   - the owning surface for each fact;
   - whether other surfaces copy, reference, observe, or summarize the fact.
5. End-to-end AFK contract sketch:
   - inbound provider/integration job;
   - transfer packet;
   - session trigger/scheduler;
   - provider-neutral dispatch;
   - docked provider session;
   - work/evidence receipts;
   - result-route update.
6. Minimum receipt trail for a manual trial:
   - the smallest set of durable facts needed to review one AFK run after the
     session ends;
   - what belongs in a work receipt versus evidence receipt;
   - how to represent no-op, blocked, failed, partially complete, and
     completed outcomes without adding schemas yet.
7. Prototype readiness gates:
   - prerequisites that are satisfied by the current notes;
   - unresolved questions that can stay deferred;
   - unresolved questions that must be answered before source work;
   - the lowest-risk prototype shape if source work is ready.
8. Boundary matrix:
   - packet/result route;
   - scheduler;
   - dispatch;
   - provider adapter;
   - dock profile/session;
   - provider catalog/telemetry;
   - terminal substrate;
   - work/evidence receipts;
   - integration broker/gateway;
   - Foreman/GDI/Operator coordination.
9. Explicit deferrals:
   - no schema or command implementation;
   - no provider launch;
   - no gateway job schema/API mutation;
   - no work/evidence record implementation;
   - no dock/profile/instruction mutation;
   - no GitHub mutation or external publication;
   - no Researcher dock creation.
10. Recommendation:
   - choose one next slice: docs-only work/evidence receipt shape,
     deterministic local dry-run prototype, or consolidation correction;
   - explain why the chosen slice is the smallest reversible step.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the new note
changes the near-term sequence or prototype readiness wording. Keep that update
short and cite the new note.

## Scope

Edit only:

- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior AFK or Decision Contract notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change source, tests, command behavior, router output, shared schema
  files, or `docs/dev/workflow-rules.json`.
- Do not change `.docks` role instructions, dock profiles, transfer scripts,
  hook behavior, or provider config files.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, apps, packages, or shared schema files.
- Do not implement provider-neutral dispatch, session trigger/scheduler,
  transfer packets, async result routing, work records, or evidence records.
- Do not launch provider sessions or mutate tmux/process sessions.
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json
```

No Swift rebuild, Node test, provider launch, or live AOS smoke is required
unless you violate this card's docs-only scope, which should not be necessary.

## Completion Report

Report:

- files changed;
- vocabulary decisions and any phrases avoided;
- duplicate field ownership decisions;
- minimum work/evidence receipt trail for a manual trial;
- prototype readiness decision and recommended next slice;
- explicit deferrals preserved;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, `.docks` instructions,
  dock profiles, provider config files, gateway API/schema, shared schema
  files, `docs/dev/workflow-rules.json`, GitHub, push, and PR surfaces were
  untouched;
- local-only state or unrelated dirty files.
