# Work Card: afk-session-trigger-scheduler-shape-v0

**Status:** Ready for GDI
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- Single next goal: design a docs-only session trigger/scheduler shape for
  packet-driven docked provider sessions.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-transfer-packet-result-route-shape-v0.md`

The accepted packet/result-route note says the handoff payload, result
destinations, status mapping, and ownership boundaries are now clear enough to
answer the next design question: what AOS primitive accepts a packet, applies a
lease, starts or resumes a docked provider session, and records lifecycle
updates without making the gateway or provider adapter the session authority?

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create one docs-only design note that sketches the session trigger/scheduler
primitive for future AFK work. The note should define what the primitive owns
between a transfer packet and provider-neutral dispatch:

```text
transfer packet
  -> session trigger/scheduler
  -> provider-neutral dispatch
  -> docked provider session
  -> lifecycle/result-route updates
```

The output should make the scheduler boundary concrete enough that the next
slice can design provider-neutral dispatch without also deciding lease,
timeout, packet intake, or result-route lifecycle semantics.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/remote-session-control.md`
- `docs/design/worktree-session-scope.md`
- `docs/api/integration-broker.md`
- `shared/schemas/provider-session-catalog.md`
- `shared/schemas/provider-session-catalog.schema.json`
- `shared/schemas/agent-session-telemetry.md`
- `shared/schemas/agent-session-telemetry.schema.json`
- `shared/schemas/integration-broker-snapshot.md`
- `packages/gateway/src/integrations/types.ts`
- `packages/gateway/src/integrations/broker.ts`
- `packages/gateway/src/integrations/http-api.ts`
- `packages/gateway/src/db.ts`

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

This card depends on local-only design notes and accepted work cards on the
branch above. Do not reset to `origin/main`.

If you create an output branch, use
`gdi/afk-session-trigger-scheduler-shape-v0` from the required start ref. Keep
the checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Existing Surfaces To Inspect

Start with:

- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md` -
  accepted packet fields, result routes, status mapping, and manual AFK flow.
- `docs/design/durable-agent-cognition-and-afk-primitives.md` - near-term
  sequence and explicit Researcher deferral.
- `docs/design/remote-session-control.md` - provider-neutral session control
  record, local authority, leases, and high-trust remote-control boundary.
- `docs/design/worktree-session-scope.md` - worktree/session scope guidance and
  warnings against broad session control.
- `shared/schemas/provider-session-catalog.*` - existing provider-neutral
  session discovery shape.
- `shared/schemas/agent-session-telemetry.*` - existing provider-neutral
  telemetry/capability envelope.
- `docs/api/integration-broker.md` and `packages/gateway/src/integrations/*` -
  current broker job lifecycle and why gateway remains ingress/notifier rather
  than session authority.

Search as needed for:

```bash
rg -n "session trigger|session start|session control|provider-neutral|lease|timeout|heartbeat|transfer packet|result route|integration job|tell --register|tell --who|provider-session|agent-session" AGENTS.md .docks docs shared packages/gateway/src
```

## Required Output

Create:

- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`

Use this shape:

1. Summary:
   - docs-only sketch;
   - no schema, source change, command behavior change, provider launch, or
     gateway ownership of sessions;
   - why scheduler design follows packet/result-route design and precedes
     provider-neutral dispatch.
2. Existing surface inventory:
   - transfer packet and result-route fields from the accepted note;
   - provider session catalog and agent session telemetry surfaces;
   - remote/session-control record boundary;
   - integration job start/complete/fail route boundary;
   - any current `aos tell` or dock/session communication assumptions found in
     docs.
3. Trigger/scheduler responsibility sketch:
   - packet resolution and validation;
   - required start ref and worktree/cwd checks;
   - lease/timeout and heartbeat expectations;
   - session start versus session resume;
   - lifecycle states such as queued, accepted, launching, running, stalled,
     human-needed, succeeded, failed, expired, superseded;
   - result-route updates on start, stall, completion, failure, and expiry;
   - human-needed/TCC blocker handling;
   - audit/work-record/evidence-record hooks.
4. Non-responsibilities:
   - reusable route judgment;
   - provider-specific launch mechanics;
   - full transcript storage;
   - gateway job schema/API ownership;
   - work/evidence proof semantics;
   - Researcher behavior or synthesis policy.
5. Candidate command or API shape:
   - design-only examples such as `aos session trigger --packet <ref>` or a
     local scheduler queue entry;
   - required inputs and outputs;
   - what must be returned synchronously versus written asynchronously;
   - how idempotence is keyed.
6. Lifecycle state machine:
   - normal success path;
   - terminal failure;
   - human-needed stall and resume;
   - lease expiry or lost heartbeat;
   - superseded packet or duplicate trigger.
7. Boundary matrix:
   - session trigger/scheduler;
   - provider-neutral dispatch;
   - transfer packet;
   - result route;
   - work record;
   - evidence record;
   - integration job/gateway;
   - Decision Contract descriptor;
   - docked provider session.
8. Explicit deferrals:
   - no scheduler implementation;
   - no provider-neutral dispatch implementation;
   - no transfer packet schema;
   - no gateway job schema/API change;
   - no source, tests, command behavior, router output, or
     `docs/dev/workflow-rules.json` change;
   - no `.docks` instruction or handoff script change;
   - no GitHub, push, or PR mutation;
   - no Researcher dock creation.
9. Recommendation:
   - whether the next slice should be provider-neutral dispatch, work/evidence
     record trial, or a local prototype, and why.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the new note
changes the near-term sequence or boundary wording. Keep that update short and
cite the new note.

## Scope

Edit only:

- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior mapping notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change source, tests, command behavior, router output, or
  `docs/dev/workflow-rules.json`.
- Do not change `.docks` role instructions, transfer scripts, hook behavior, or
  dock profiles.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, or shared schema files.
- Do not implement session trigger/scheduler, provider-neutral dispatch,
  transfer packets, async result routing, work records, or evidence records.
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json
```

No Swift rebuild, Node test, or live AOS smoke is required unless you violate
this card's docs-only scope, which should not be necessary.

## Completion Report

Report:

- files changed;
- scheduler responsibilities and non-responsibilities;
- lifecycle state machine summary;
- command/API shape examples and idempotence keying;
- boundary decisions across scheduler, dispatch, transfer packet, result route,
  work/evidence records, gateway/integration jobs, Decision Contracts, and
  docked provider sessions;
- explicit deferrals preserved;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, `.docks` instructions,
  gateway API/schema, shared schema files, `docs/dev/workflow-rules.json`,
  GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files.
