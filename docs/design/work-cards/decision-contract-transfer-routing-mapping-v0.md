# Work Card: decision-contract-transfer-routing-mapping-v0

**Status:** Accepted 2026-05-21
**Owner:** GDI

## Tracker

Follow-up to:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- accepted work card `docs/design/work-cards/decision-contract-vocabulary-pass-v0.md`

The accepted vocabulary pass says a schema should wait until at least one
second non-router candidate proves the generic fields. This round maps transfer
routing as that second candidate without adding a schema or automating session
launch.

Accepted evidence:

- GDI branch: `gdi/decision-contract-transfer-routing-mapping-v0`
- Accepted commit: `163a48605b810d304bf731fc984c6cdf7d756470`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
- Foreman-side verification passed:
  `git diff --check 2abf72ea5720cb72662cb1f6eecf59926bbcedfa..163a48605b810d304bf731fc984c6cdf7d756470`
  and `./aos dev recommend --json`.
- Recommendation accepted with cadence adjustment: transfer routing is a
  credible second docs-backed candidate, but the next GDI slice should be
  broader than another single-note mapping.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Map Foreman transfer routing to the docs-only Decision Contract field sketch.
The output should decide whether transfer routing is a credible second
candidate, which fields fit cleanly, which fields strain, and whether this
strengthens or weakens the case for a future generic Decision Contract schema.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
- `.docks/foreman/skills/session-transfer/references/operator.md`
- `.docks/foreman/skills/session-transfer/references/foreman.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`

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

This work card depends on local-only design notes and accepted work cards on
the branch above. Do not reset to `origin/main`.

If you create an output branch, use
`gdi/decision-contract-transfer-routing-mapping-v0` from the required start
ref. Keep the checkpoint local unless Foreman or Michael explicitly asks for a
push or PR.

## Existing Files To Inspect

Start with:

- `.docks/foreman/skills/session-transfer/SKILL.md` - transfer kinds, placement
  matrix, and universal transfer header.
- `.docks/foreman/AGENTS.md` - Foreman next-step loop, acceptance ladder, and
  transfer-routing responsibilities.
- `.docks/README.md` - repo-wide transfer storage and dock contract.
- `.docks/AGENTS.md` - shared transfer vocabulary and storage rules.
- `.docks/gdi/AGENTS.md` - GDI branch/base and completion report contract.
- `.docks/operator/AGENTS.md` - Operator supervised/HITL transfer boundary.
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`
  - GDI-specific transfer fields.

Search as needed for:

```bash
rg -n "Transfer|handoff|dispatch|work card|successor|human-needed|relay|correction|operator|required_start_ref|branch_from|result route|clipboard" .docks docs/design/work-cards
```

## Required Output

Create:

- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`

Use this shape:

1. Summary: whether transfer routing is a credible second Decision Contract
   candidate.
2. Current transfer routing model:
   - inputs;
   - evidence inspected;
   - outputs/decisions;
   - consumers;
   - invalidation triggers.
3. Mapping table from the Decision Contract field sketch to current transfer
   routing docs.
4. Field strain: which generic fields fit poorly or need adjustment.
5. Relationship to AFK primitives:
   - transfer packet;
   - session trigger/scheduler;
   - async result routing;
   - provider-neutral dispatch.
6. Recommendation:
   - keep docs-only;
   - adjust field names;
   - map another candidate;
   - or prepare a schema sketch.

The note should explicitly avoid implementing transfer packets or session
trigger. It should answer only whether transfer routing strengthens the generic
Decision Contract model.

## Scope

Primary scope is docs/design exploration. Edit only:

- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`

You may make a tiny link amendment to
`docs/design/durable-agent-cognition-and-afk-primitives.md` only if the new
mapping would otherwise be undiscoverable.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change `.docks` role instructions, transfer scripts, hook behavior, or
  dock profiles.
- Do not change source, tests, command behavior, or router output.
- Do not move or rename recipes, playbooks, workflows, work cards, docks, or
  gateway files.
- Do not implement session trigger, scheduler, provider dispatch, transfer
  packets, or async result routing.
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
- whether transfer routing is a credible second candidate;
- how current transfer routing maps to the proposed fields;
- fields that need adjustment based on this second mapping;
- relationship to AFK primitives;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether `.docks` instructions/scripts/profiles, source, schemas, tests,
  command behavior, GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files.
