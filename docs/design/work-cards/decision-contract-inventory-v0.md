# Work Card: decision-contract-inventory-v0

**Status:** Accepted 2026-05-21
**Owner:** GDI

## Tracker

Validation follow-up for:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- local Foreman checkpoint `ec4497c docs(design): capture durable agent cognition primitives`

This card validates the design note's claim that agent-os already has hidden
Decision Contract / Inference Block examples. It should produce a compact
inventory and recommendation, not implement new schemas or command surfaces.

Accepted evidence:

- GDI branch: `gdi/decision-contract-inventory-v0`
- Accepted commit: `057be101bc4697725e5dc6aa836c751566bb5b34`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- Foreman-side verification passed:
  `git diff --check 0bba4c894b84003656d3fa947bed7956c96ba91f..057be101bc4697725e5dc6aa836c751566bb5b34`
  and `./aos dev recommend --json`.
- Hidden-example hypothesis accepted as confirmed. Recommended next slice:
  sketch Decision Contract shape against `docs/dev/workflow-rules.json` as
  docs-only vocabulary; do not add a schema yet.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Inventory current repo artifacts that behave like Decision Contracts or
Inference Blocks: source-backed or docs-backed rules where inputs plus evidence
produce a bounded classification, route, or next-action choice.

The output should let Foreman decide whether the next slice should define a
formal Decision Contract shape, extend an existing schema, or keep the concept
as design vocabulary for now.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/recipes/README.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/remote-session-control.md`

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

This work card and its source design note are local-only on the branch above.
Do not reset to `origin/main`. A clean worktree on `main` is the wrong starting
state for this round because it will not contain the design note or this card.

If you create an output branch, use
`gdi/decision-contract-inventory-v0` from the required start ref. Keep the
checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Existing Files To Inspect

Start with these files, then search as needed:

- `docs/dev/workflow-rules.json` - manifest-backed changed-file routing.
- `shared/schemas/dev-workflow-rules.schema.json` - current schema for the
  routing manifest.
- `tests/schemas/dev-workflow-rules.test.mjs` - validation expectations for
  the routing manifest.
- `src/commands/dev.swift` - `./aos dev recommend` implementation surface.
- `docs/recipes/context-doc-maintenance.md` - adopt/adapt/reject/defer
  classification example.
- `.docks/README.md` and `.docks/AGENTS.md` - dock selection, transfer storage,
  and role-boundary rules.
- `.docks/foreman/AGENTS.md` - Foreman routing/acceptance loop.
- `.docks/foreman/skills/session-transfer/SKILL.md` - transfer classification
  rules.
- `docs/recipes/agent-entry-paths-and-verification.md` - entry-path and
  verification classification.
- `docs/recipes/aos-surface-interaction-decision-tree.md` - surface interaction
  routing decisions.
- `docs/design/user-signal-surface.md` - human-gate decision records and
  continuation routing.
- `packages/gateway/src/integrations/broker.ts` and
  `packages/gateway/src/db.ts` - integration job state transitions and async
  result surfaces.

Use `rg` to find additional candidates. Useful terms include:

```bash
rg -n "classify|classification|route|routing|decision|defer|adopt|adapt|reject|blocked|human_needed|human-needed|required_start_ref|trigger|result route|invalidation|recommend" AGENTS.md .docks docs packages src shared tests
```

## Required Output

Create:

- `docs/design/notes/decision-contract-inventory-2026-05-21.md`

Use this shape:

1. Summary: whether the hidden-example hypothesis is confirmed.
2. Candidate inventory table with columns:
   - artifact;
   - current form;
   - inputs;
   - evidence inspected;
   - outputs/decisions;
   - consumers;
   - invalidation triggers;
   - recommendation.
3. Classification:
   - true Decision Contract candidate;
   - recipe/SOP with embedded decision table;
   - transfer/work-card policy;
   - workflow/job state machine;
   - not a fit.
4. Recommendation for the next slice:
   - no schema yet;
   - docs-only vocabulary;
   - schema sketch;
   - migrate/rename nothing;
   - specific artifact to promote first.

If the inventory reveals that
`docs/dev/workflow-rules.json` is not the best first machine-readable example,
say so and explain which artifact is better.

## Scope

Primary scope is docs/design validation. Edit only:

- `docs/design/notes/decision-contract-inventory-2026-05-21.md`

You may make a tiny link or wording amendment to
`docs/design/durable-agent-cognition-and-afk-primitives.md` only if the new
inventory would otherwise be undiscoverable or if you find a material error in
the source note.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change `aos` command behavior.
- Do not move or rename recipes, playbooks, workflows, docks, or gateway files.
- Do not implement session trigger, scheduler, provider dispatch, or async
  result routing.
- Do not create a Researcher dock.
- Do not put synthesis logic in `agent-os` source.
- Do not push, open a PR, mutate GitHub issues, or publish externally.
- Do not run live browser/model/control sessions.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json
```

No Swift rebuild, Node test, or live AOS smoke is required unless you edit
schema, source, tests, or command contracts, which this card does not call for.

## Completion Report

Report:

- files changed;
- whether the hidden-example hypothesis was confirmed, partially confirmed, or
  refuted;
- top 3-5 Decision Contract candidates and why;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether any source, schema, command, recipe move, GitHub, push, or PR surfaces
  were intentionally untouched;
- local-only state or unrelated dirty files.
