# Work Card: afk-transfer-packet-result-route-shape-v0

**Status:** Accepted 2026-05-21
**Owner:** Implementer

## Tracker

Transfer classification:

- Recipient: Implementer
- Transfer kind: Implementer round
- Source artifact:
  `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
- Single next goal: design a docs-only transfer packet and async result-route
  shape that connects an integration job to a docked provider session.

Follow-up to accepted work card:

- `docs/design/work-cards/decision-contract-descriptor-afk-boundary-v0.md`

The accepted descriptor/AFK boundary note says the Decision Contract descriptor
is now bounded enough to emit selected packet fields and proof requirements
without owning session launch or results. The remaining uncertainty is the AFK
handoff surface between provider ingress, AOS session control, work/evidence
records, and notification routes.

Accepted evidence:

- Implementer branch: `implementer/afk-transfer-packet-result-route-shape-v0`
- Accepted commit: `e762e76a4906b88c9a819e7019b3d06dba1020ca`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- Synthesis update:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Foreman-side verification passed:
  `git diff --check f44660580b36759723aaf661bbc9efc5848c527a..e762e76a4906b88c9a819e7019b3d06dba1020ca`,
  `git diff --cached --check`, and `./aos dev recommend --json`.
- Recommendation accepted: design the session trigger/scheduler primitive
  before provider-neutral dispatch, work/evidence record trials, or a local
  prototype.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create one docs-only design note that sketches the transfer packet and async
result-route shape for a future AFK flow:

```text
integration job or sibling completion
  -> transfer packet
  -> docked provider session
  -> work/evidence record
  -> async result route
  -> integration job or notifier completion
```

The note should clarify boundaries before any implementation: what the packet
must carry, what the result route must update, what remains owned by the
gateway/broker, what belongs to AOS session control, and what proof belongs in
work/evidence records.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- the implementer native subagent instructions
- `the operator native subagent contract`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/remote-session-control.md`
- `docs/api/integration-broker.md`
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
`implementer/afk-transfer-packet-result-route-shape-v0` from the required start ref.
Keep the checkpoint local unless Foreman or Michael explicitly asks for a push
or PR.

## Existing Surfaces To Inspect

Start with:

- `docs/design/durable-agent-cognition-and-afk-primitives.md` - current
  sequence and explicit non-goals.
- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
  - accepted boundary matrix and AFK flow sketch.
- `docs/api/integration-broker.md` - current broker role, local HTTP API, job
  lifecycle, and gateway-not-session-authority boundary.
- `packages/gateway/src/integrations/types.ts` - current `IntegrationJob`,
  completion/start/failure request, notifier, and broker snapshot types.
- `packages/gateway/src/integrations/broker.ts` - current job creation,
  start/complete/fail, result formatting, and notifier behavior.
- `packages/gateway/src/integrations/http-api.ts` - current HTTP entry points
  that could become result-route targets later.
- `packages/gateway/src/db.ts` - persisted integration job fields and status
  transitions.
- `docs/design/aos-work-records-and-self-healing-recipes.md` - work/evidence
  record boundary.
- `docs/design/remote-session-control.md` - session-control record and
  provider-neutral control boundary.

Search as needed for:

```bash
rg -n "transfer packet|result route|async result|integration job|session trigger|provider-neutral|work record|evidence record|queued|running|succeeded|failed|notifyRequester" docs packages/gateway/src shared
```

## Required Output

Create:

- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`

Use this shape:

1. Summary:
   - docs-only sketch;
   - no schema, source change, command behavior change, or gateway ownership of
     sessions;
   - why packet/result-route design comes before session trigger/scheduler.
2. Existing surface inventory:
   - integration job fields and statuses;
   - HTTP start/complete/fail routes;
   - broker notifier behavior;
   - work/evidence record boundary;
   - remote/session-control boundary.
3. Transfer packet sketch:
   - packet id and source event/artifact;
   - requested recipient/dock/role;
   - cwd, worktree, branch policy, and required start ref;
   - selected Decision Contract id and selected outputs;
   - integration job linkage when present;
   - evidence requirements and stop conditions;
   - timeout/lease and manual-intervention behavior;
   - provider hint versus provider selection;
   - result-route reference.
4. Async result-route sketch:
   - route kinds: work record, evidence record, integration job start/complete/fail,
     Slack thread or DM through gateway notifier, Foreman inbox, local artifact
     path, issue/PR comment only when explicitly configured;
   - status mapping from session result to integration job status;
   - final report fields that should be delivered;
   - idempotence and retry expectations at design level.
5. Ownership and boundary matrix:
   - gateway/broker;
   - AOS session trigger/scheduler;
   - provider-neutral dispatch;
   - docked provider session;
   - transfer packet;
   - work record;
   - evidence record;
   - Decision Contract descriptor.
6. Manual AFK sequence:
   - how this could be simulated today with a work card, local branch, and
     broker job update without adding implementation;
   - what the future primitive would replace.
7. Explicit deferrals:
   - no transfer packet schema;
   - no session trigger/scheduler implementation;
   - no provider-neutral dispatch implementation;
   - no gateway job schema/API change;
   - no source, tests, command behavior, or router output change;
   - no `.docks` instruction or handoff script change;
   - no GitHub, push, or PR mutation;
   - no Researcher dock creation.
8. Recommendation:
   - next implementation/design slice after this note;
   - whether the next slice should be a session trigger sketch,
     provider-neutral dispatch sketch, work/evidence record trial, or local
     prototype, and why.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the new note
changes the near-term sequence or boundary wording. Keep that update short and
cite the new note.

## Scope

Edit only:

- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior mapping notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change source, tests, command behavior, router output, or
  `docs/dev/workflow-rules.json`.
- Do not change `.docks` role instructions, transfer scripts, hook behavior, or
  dock profiles.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, or API docs.
- Do not implement transfer packets, session trigger/scheduler,
  provider-neutral dispatch, async result routing, work records, or evidence
  records.
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
- transfer packet fields and any field exclusions;
- async result-route shape and status mapping;
- ownership/boundary decisions across gateway, AOS session control,
  provider-neutral dispatch, docked provider sessions, Decision Contracts,
  transfer packets, work records, and evidence records;
- manual AFK sequence summary;
- explicit deferrals preserved;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, `.docks` instructions,
  gateway API/schema, `docs/dev/workflow-rules.json`, GitHub, push, and PR
  surfaces were untouched;
- local-only state or unrelated dirty files.
