# Work Card: afk-work-evidence-receipt-shape-v0

**Status:** Accepted 2026-05-22
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- Single next goal: define a docs-only AFK work/evidence receipt shape for a
  manual trial and first deterministic dry-run prototype.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-design-consolidation-readiness-v0.md`

The accepted consolidation/readiness note says the first prototype cannot be
reviewed without a receipt contract. Receipt fields are currently spread across
packet, scheduler, dispatch, final report, work-record, and evidence-record
language. This slice should consolidate that into one reviewable docs-only
receipt shape before any source prototype.

Accepted evidence:

- GDI branch: `gdi/afk-work-evidence-receipt-shape-v0`
- Accepted commit: `6b6c344df21e4271bdde97c89fbabd33b9237aef`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- Synthesis update:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Foreman-side verification passed:
  `git diff --check 1eae080bfa6704de68fae334a9cbd0d5fb911163..6b6c344df21e4271bdde97c89fbabd33b9237aef`,
  `git diff --check c20c85d9e0efd239a2112b5899a8ed164ab745d7..HEAD`,
  and `./aos dev recommend --json`.
- Recommendation accepted: route a deterministic local dry-run prototype that
  writes only local dry-run output or a receipt bundle, starts no provider,
  changes no schemas, and treats command names as experimental.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create one docs-only design note that defines the minimum work/evidence receipt
shape for a manual AFK trial and for a later deterministic dry-run prototype.

The note should:

- distinguish transfer, scheduler, dispatch, work, and evidence receipts
  without adding schemas;
- decide the minimum mandatory fields that make one AFK run reviewable after
  the session ends;
- propose a temporary storage and file-naming convention for manual receipts;
- define status vocabulary for no-op, blocked, failed, partially complete, and
  completed outcomes;
- explain how receipt links should reference packet, scheduler, dispatch,
  provider catalog/telemetry, commands, route updates, and human-needed facts;
- recommend whether the next slice after this should be a deterministic dry-run
  prototype, a correction to the receipt shape, or another docs-only boundary.

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
- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/remote-session-control.md`
- `docs/design/worktree-session-scope.md`
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
`gdi/afk-work-evidence-receipt-shape-v0` from the required start ref. Keep the
checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Existing Surfaces To Inspect

Start with:

- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md` -
  minimum receipt trail and prototype-readiness questions.
- `docs/design/aos-work-records-and-self-healing-recipes.md` - existing
  durable work-record vocabulary: intent, execution map, evidence, and health.
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md` -
  packet/final-report/result-route fields and integration-job status mapping.
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md` -
  scheduler lifecycle state, leases, heartbeats, idempotence, and route
  attempts.
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md` -
  dispatch attempt fields, provider/session facts, command examples, and
  provider drift cases.
- `docs/api/integration-broker.md` - current job status and notifier boundary.
- `shared/schemas/provider-session-catalog.md` and
  `shared/schemas/agent-session-telemetry.md` - provider observation references
  that receipts may cite but should not redefine.

Search as needed for:

```bash
rg -n "work receipt|evidence receipt|work record|evidence record|final report|result route|status|blocked|human-needed|telemetry|catalog|proof|verification|artifact|route update" docs shared packages apps .docks AGENTS.md
```

## Required Output

Create:

- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`

Use this shape:

1. Summary:
   - docs-only receipt shape;
   - no schema, source change, command behavior change, fixture, provider
     launch, scheduler/dispatch implementation, gateway mutation, or prototype;
   - why this note is the last docs boundary before a deterministic dry-run
     prototype if no gaps are found.
2. Source inventory:
   - what receipt obligations come from packet/result route, scheduler,
     dispatch, work-record design, integration broker, catalog, and telemetry;
   - which terms are reused and which terms are deliberately temporary.
3. Receipt taxonomy:
   - transfer receipt;
   - scheduler receipt;
   - dispatch receipt;
   - work receipt;
   - evidence receipt;
   - how these relate to future persisted records without becoming schemas.
4. Mandatory field sketch:
   - run identity and correlation;
   - source artifact and packet/result-route references;
   - cwd/worktree/branch/start-ref;
   - dock, provider, provider session, terminal substrate, catalog/telemetry
     references;
   - lifecycle, lease, heartbeat, route-update, and final status facts;
   - commands/checks, changed paths/artifacts, local-only state, blocker,
     next-owner, and follow-up recommendation;
   - evidence links and proof summaries.
5. Temporary storage and naming:
   - where manual receipts should live before schemas exist;
   - file naming convention;
   - which artifacts stay local-only;
   - how to avoid committing misplaced successor-Foreman handoffs as work
     cards.
6. Status vocabulary:
   - no-op;
   - blocked;
   - failed;
   - partially complete;
   - completed;
   - duplicate/superseded/expired if needed for scheduler outcomes;
   - how each status maps to route updates and next-owner recommendations.
7. Evidence link rules:
   - command output;
   - workflow-router output;
   - provider availability/auth facts;
   - catalog/telemetry observations;
   - route or notification response;
   - human-needed packet;
   - changed-file or artifact references;
   - how to cite missing evidence honestly.
8. Manual trial example:
   - a small illustrative receipt bundle for one docs-only AFK run;
   - keep it as an example inside the note, not a separate fixture file.
9. Prototype readiness decision:
   - questions answered by this receipt shape;
   - remaining questions that can stay deferred;
   - remaining questions, if any, that block a deterministic dry-run prototype.
10. Explicit deferrals:
   - no schemas;
   - no source/tests/command behavior;
   - no fixtures or generated artifacts;
   - no provider launch;
   - no gateway API/schema mutation;
   - no work/evidence record implementation;
   - no dock/profile/instruction mutation;
   - no GitHub mutation or external publication;
   - no Researcher dock creation.
11. Recommendation:
   - choose one next slice: deterministic local dry-run prototype, receipt
     correction, or another docs-only boundary;
   - explain why the chosen slice is the smallest reversible step.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the new note
changes the near-term sequence or prototype readiness wording. Keep that update
short and cite the new note.

## Scope

Edit only:

- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior AFK, Decision Contract, work-record, schema, or API docs
unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not create fixtures, generated artifacts, traces, or receipt files outside
  the required design note.
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
- receipt taxonomy and mandatory field decisions;
- temporary storage/naming decision;
- status vocabulary and route/next-owner mapping;
- evidence link rules and missing-evidence handling;
- manual trial example summary;
- prototype readiness decision and recommended next slice;
- explicit deferrals preserved;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, fixtures, `.docks`
  instructions, dock profiles, provider config files, gateway API/schema,
  shared schema files, `docs/dev/workflow-rules.json`, GitHub, push, and PR
  surfaces were untouched;
- local-only state or unrelated dirty files.
