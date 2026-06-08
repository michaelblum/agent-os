# Work Card: decision-contract-vocabulary-pass-v0

**Status:** Accepted 2026-05-21
**Owner:** Implementer

## Tracker

Follow-up to:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- accepted work card `docs/design/work-cards/decision-contract-shape-sketch-v0.md`

The accepted shape sketch recommends a docs vocabulary pass before any schema
slice. This round should make the vocabulary discoverable without changing
executable artifacts.

Accepted evidence:

- Implementer branch: `implementer/decision-contract-vocabulary-pass-v0`
- Accepted commit: `04fa584e930927d1fccb81ba61852d8ed3825611`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Changed docs:
  `docs/design/durable-agent-cognition-and-afk-primitives.md` and
  `docs/recipes/README.md`.
- Foreman-side verification passed:
  `git diff --check 8ae5d23efcabba963029bd610716de96bddb5da8..04fa584e930927d1fccb81ba61852d8ed3825611`
  and `./aos dev recommend --json`.
- Foreman added one tiny hygiene edit after acceptance to replace stale
  forward-looking inventory wording with links to the accepted inventory and
  shape-sketch notes.
- Recommendation accepted: map a second non-router candidate before any schema
  slice.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Add a concise docs-only vocabulary treatment for **Decision Contract** so future
agents can distinguish it from Recipe, Playbook, Workflow, Work Card, Work
Record, Evidence Record, Skill, and Transfer Packet.

The result should make the term easier to cite in later work cards while
preserving the current artifact boundaries and avoiding any schema or command
changes.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- `docs/recipes/README.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `.docks/AGENTS.md`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is docs-only. Do not run `./aos ready` unless you discover a need for live
runtime evidence, which is not expected.

## Branch/Base

branch_from: `docs/durable-agent-cognition-v0`
required_start_ref: `docs/durable-agent-cognition-v0`

This work card depends on local-only design notes on the branch above. Do not
reset to `origin/main`.

If you create an output branch, use
`implementer/decision-contract-vocabulary-pass-v0` from the required start ref. Keep the
checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Suggested Implementation Areas

Use the narrowest docs surface that makes the vocabulary reusable. Likely
options:

- Amend `docs/design/durable-agent-cognition-and-afk-primitives.md` with a
  compact "Artifact Vocabulary" or "Decision Contract Vocabulary" section.
- Add a short cross-reference in `docs/recipes/README.md` only if needed to
  prevent future agents from treating Decision Contract as a recipe type.
- Avoid editing ADR 0009 unless the current wording would be misleading without
  a Decision Contract note. If you do edit it, keep the change small and frame
  Decision Contract as adjacent vocabulary, not a revision of the ADR decision.

Do not create a new broad glossary file unless the existing design note becomes
hard to read with the vocabulary added.

## Required Behavior

The vocabulary pass should state:

- Decision Contract / Inference Block is durable judgment:
  "given these inputs and this evidence, classify/choose/route this way."
- It differs from Recipe, Playbook, Workflow, Work Card, Work Record, Evidence
  Record, Skill, and Transfer Packet.
- `docs/dev/workflow-rules.json` is still the current dev workflow router
  manifest, not a renamed Decision Contract.
- Decision Contract remains docs-only vocabulary for now.
- No schema should be added until a second non-router candidate proves the
  generic fields.
- Researcher/synthesis behavior remains user or dock configuration layered on
  top of AOS primitives, not agent-os core source logic.

## Scope

Primary scope is docs vocabulary. Edit only:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- optionally `docs/recipes/README.md`
- optionally `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`

Do not edit inventory or sketch notes unless you find a broken link introduced
by this vocabulary pass.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change `docs/dev/workflow-rules.json`.
- Do not change source, tests, command behavior, or router output.
- Do not move or rename recipes, playbooks, workflows, work cards, docks, or
  gateway files.
- Do not implement session trigger, scheduler, provider dispatch, or async
  result routing.
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
- where the vocabulary now lives;
- how Decision Contract is distinguished from the adjacent artifacts;
- whether `docs/dev/workflow-rules.json` remains explicitly unrenamed and
  unmodified;
- whether schemas, source, tests, command behavior, recipe moves, GitHub, push,
  and PR surfaces were untouched;
- exact verification commands and pass/fail results;
- recommended next slice;
- local-only state or unrelated dirty files.
