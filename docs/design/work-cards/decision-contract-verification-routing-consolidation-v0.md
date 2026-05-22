# Work Card: decision-contract-verification-routing-consolidation-v0

**Status:** Ready for GDI
**Owner:** GDI

## Tracker

Follow-up to:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
- accepted work card
  `docs/design/work-cards/decision-contract-transfer-routing-mapping-v0.md`

Foreman cadence note: prior slices intentionally stayed narrow while the term
was unstable. That is now too fine-grained. This round should combine the next
candidate mapping with consolidation so Foreman can decide the next workstream
without another single-note GDI loop.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Map live-versus-deterministic verification routing as a third Decision Contract
candidate, then consolidate the Decision Contract field guidance across the
three candidates already studied:

- dev workflow routing;
- Foreman transfer routing;
- live-versus-deterministic verification routing.

The output should answer whether the concept is ready for a schema sketch, or
whether it should remain docs-only while AFK/session primitives mature.

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
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/recipes/surface-inspector-controlled-browser-dom-smoke.md`
- `.docks/foreman/skills/session-transfer/references/gdi-work-card-authoring.md`

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
`gdi/decision-contract-verification-routing-consolidation-v0` from the
required start ref. Keep the checkpoint local unless Foreman or Michael
explicitly asks for a push or PR.

## Existing Files To Inspect

Start with:

- `docs/recipes/agent-entry-paths-and-verification.md` - entry path and
  verification routing.
- `AGENTS.md` - repo-wide readiness, host-shell, AOS developer, and dev-router
  guidance.
- `.docks/foreman/AGENTS.md` - live verification blocker handling and next-step
  ladder.
- `.docks/gdi/AGENTS.md` - deterministic verification, live blocker, and
  human-needed handling.
- `.docks/operator/AGENTS.md` - supervised live/HITL evidence boundary.
- `docs/dev/workflow-rules.json` - changed-file verification recommendations.
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md` - current
  field sketch.
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
  - field strain from second candidate.

Search as needed for:

```bash
rg -n "live|deterministic|ready|TCC|Input Monitoring|Accessibility|human_needed|human-needed|Operator|verification|entry path|runtime evidence|docs-only|rebuild|smoke" AGENTS.md .docks docs
```

## Required Output

Create:

- `docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`

Use this shape:

1. Summary: whether live-versus-deterministic verification routing is a
   credible third Decision Contract candidate.
2. Candidate mapping:
   - inputs;
   - source-authority evidence;
   - current-state evidence;
   - outputs/decisions;
   - consumers;
   - invalidation triggers.
3. Consolidated field guidance across all three candidates:
   - fields that hold;
   - fields that need renaming or clarifying;
   - fields that should stay optional;
   - fields that should not be in a near-term schema.
4. Readiness decision:
   - schema sketch now;
   - docs-only vocabulary;
   - AFK primitive design first;
   - or one more candidate.
5. Recommended next slice, sized larger than the prior one-note mapping rounds.

Also make a small synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the
consolidation changes the recommended sequence or field guidance. Keep that
edit short and cite the consolidation note.

## Scope

Edit only:

- `docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior inventory/mapping notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change `.docks` role instructions, transfer scripts, hook behavior, or
  dock profiles.
- Do not change source, tests, command behavior, router output, or
  `docs/dev/workflow-rules.json`.
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
- whether verification routing is a credible third candidate;
- consolidated field guidance;
- readiness decision for schema versus docs-only versus AFK-primitives-first;
- recommended next slice and why it is not another tiny mapping;
- exact verification commands and pass/fail results;
- whether `.docks` instructions/scripts/profiles, source, schemas, tests,
  command behavior, `docs/dev/workflow-rules.json`, GitHub, push, and PR
  surfaces were untouched;
- local-only state or unrelated dirty files.
