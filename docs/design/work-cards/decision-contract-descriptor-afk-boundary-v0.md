# Work Card: decision-contract-descriptor-afk-boundary-v0

**Status:** Ready for GDI
**Owner:** GDI

## Tracker

Follow-up to:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
- `docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`
- accepted work card
  `docs/design/work-cards/decision-contract-verification-routing-consolidation-v0.md`

The consolidation concluded that Decision Contract is useful docs vocabulary,
but a committed schema is premature. The next slice should be one larger
docs-only descriptor and boundary sketch that separates Decision Contract from
transfer packets, work records, evidence records, and AFK/session primitives.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create a single design note that sketches a docs-only Decision Contract
descriptor and the AFK primitive boundaries around it.

The note should make clear what belongs in a Decision Contract descriptor,
what belongs in transfer packets, what belongs in work/evidence records, and
what belongs in future session trigger / async result routing primitives.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
- `docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/remote-session-control.md`
- `docs/design/user-signal-surface.md`
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
`gdi/decision-contract-descriptor-afk-boundary-v0` from the required start ref.
Keep the checkpoint local unless Foreman or Michael explicitly asks for a push
or PR.

## Required Output

Create:

- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`

Use this shape:

1. Summary:
   - Decision Contract descriptor is docs-only for now.
   - No committed schema, migration, or command behavior change.
2. Descriptor sketch:
   - contract id and optional rule ids;
   - summary;
   - inputs;
   - source-authority evidence;
   - current-state evidence;
   - composite outputs;
   - consumers;
   - invalidation triggers;
   - optional recompute command or procedure;
   - backing/maturity note;
   - evidence pointer for validation.
3. Adapter examples:
   - how `docs/dev/workflow-rules.json` would be referenced by adapter rather
     than migrated;
   - how transfer routing would emit selected packet fields;
   - how verification routing would emit proof requirements and stop
     conditions.
4. Boundary matrix:
   - Decision Contract;
   - transfer packet;
   - work record;
   - evidence record;
   - integration job;
   - session trigger/scheduler;
   - async result routing;
   - provider-neutral dispatch.
5. AFK flow sketch:
   - inbound Slack/gateway or sibling completion;
   - route through a Decision Contract;
   - create transfer packet;
   - start docked provider session;
   - write work/evidence record;
   - notify result route.
6. Explicit deferrals:
   - no schema;
   - no transfer packet implementation;
   - no session trigger;
   - no provider dispatch;
   - no gateway ownership of sessions;
   - no Researcher dock creation.
7. Recommendation:
   - what the next implementation/design slice should be and why.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the descriptor
note changes the near-term sequence or boundary wording. Keep that update short
and cite the new note.

## Scope

Edit only:

- `docs/design/notes/decision-contract-descriptor-and-afk-boundary-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior mapping notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change source, tests, command behavior, router output, or
  `docs/dev/workflow-rules.json`.
- Do not change `.docks` role instructions, transfer scripts, hook behavior, or
  dock profiles.
- Do not move or rename recipes, playbooks, workflows, work cards, docks, or
  gateway files.
- Do not implement transfer packets, session trigger/scheduler, provider
  dispatch, async result routing, work records, or evidence records.
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
- descriptor fields and any field adjustments from consolidation;
- boundary decisions across Decision Contract, transfer packet, work record,
  evidence record, integration job, session trigger, async result routing, and
  provider dispatch;
- AFK flow summary;
- explicit deferrals preserved;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, `.docks` instructions,
  gateway ownership, `docs/dev/workflow-rules.json`, GitHub, push, and PR
  surfaces were untouched;
- local-only state or unrelated dirty files.
