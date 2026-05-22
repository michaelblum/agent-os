# Work Card: decision-contract-shape-sketch-v0

**Status:** Accepted 2026-05-21
**Owner:** GDI

## Tracker

Follow-up to:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- accepted work card `docs/design/work-cards/decision-contract-inventory-v0.md`

The inventory confirmed that `docs/dev/workflow-rules.json` is the strongest
current machine-readable Decision Contract candidate. This round should sketch
the candidate shape without adding schemas, renaming artifacts, or changing
command behavior.

Accepted evidence:

- GDI branch: `gdi/decision-contract-shape-sketch-v0`
- Accepted commit: `3b73e803715a7e489dcdbb561e72379e6caad424`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- Foreman-side verification passed:
  `git diff --check 6a3af8931449e328e3ca3add91c0ab3e6ae55b40..3b73e803715a7e489dcdbb561e72379e6caad424`,
  `./aos dev recommend --json`, and `./aos dev recommend --help` for the
  documented `--paths` / `--files` input claim.
- Recommendation accepted: keep Decision Contract docs-only for now, perform a
  docs vocabulary pass, then map a second non-router candidate before any schema
  slice.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create a docs-only Decision Contract shape sketch using
`docs/dev/workflow-rules.json` as the concrete example. The output should make
the concept precise enough for Foreman to decide whether a future schema slice
is warranted, while preserving the current router manifest unchanged.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/work-cards/decision-contract-inventory-v0.md`
- `docs/recipes/README.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`

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

This work card depends on local-only design and inventory notes on the branch
above. Do not reset to `origin/main`.

If you create an output branch, use
`gdi/decision-contract-shape-sketch-v0` from the required start ref. Keep the
checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Existing Files To Inspect

Start with:

- `docs/dev/workflow-rules.json` - concrete candidate contract.
- `shared/schemas/dev-workflow-rules.schema.json` - current manifest shape.
- `tests/schemas/dev-workflow-rules.test.mjs` - schema validation evidence.
- `tests/dev-workflow-router.sh` - router behavior evidence.
- `tests/dev-audit.sh` - audit claim behavior.
- `src/commands/dev.swift` - `./aos dev recommend` and audit command behavior.
- `docs/dev/active-profile.json` and `docs/dev/workflow-profiles.json` -
  adjacent workflow-profile policy that should not be collapsed into the
  Decision Contract sketch.

Search as needed for `dev recommend`, `workflow-rules`, and `dev audit` if the
files above do not answer a mapping question.

## Required Output

Create:

- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`

Use this shape:

1. Summary: what a Decision Contract is in agent-os terms, and why this is
   still docs-only.
2. Proposed docs-only field sketch:
   - `id`
   - `summary`
   - `inputs`
   - `required_evidence`
   - `decision_outputs`
   - `confidence`
   - `invalidation_triggers`
   - `recompute_command`
   - `consumers`
   - `last_validated_at`
3. Mapping table from those fields to current `docs/dev/workflow-rules.json`
   and adjacent evidence.
4. Non-mapping section: fields or semantics that should not be forced into the
   current router manifest.
5. Open questions for a future schema slice.
6. Recommendation: whether the next step should be schema, docs vocabulary,
   another candidate inventory, or no further action.

The sketch should make clear that `docs/dev/workflow-rules.json` remains a dev
workflow router manifest today. Do not imply that it has already been renamed
or promoted.

## Scope

Primary scope is docs/design exploration. Edit only:

- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`

You may make a tiny link amendment to
`docs/design/durable-agent-cognition-and-afk-primitives.md` or
`docs/design/notes/decision-contract-inventory-2026-05-21.md` only if the new
shape sketch would otherwise be undiscoverable.

## Hard Boundaries

- Do not add or modify `shared/schemas/`.
- Do not change `docs/dev/workflow-rules.json`.
- Do not change `src/commands/dev.swift`, tests, command behavior, or router
  output.
- Do not rename recipes, playbooks, workflows, work cards, or docks.
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
- whether the shape sketch supports keeping Decision Contract as docs-only
  vocabulary for now;
- how `docs/dev/workflow-rules.json` maps to the proposed fields;
- fields that should not be forced into the current manifest;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, recipe moves, GitHub, push,
  and PR surfaces were untouched;
- local-only state or unrelated dirty files.
