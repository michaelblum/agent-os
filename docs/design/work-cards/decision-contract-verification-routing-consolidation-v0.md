# Work Card: decision-contract-verification-routing-consolidation-v0

**Status:** Accepted 2026-05-21
**Owner:** Implementer

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
without another single-note Implementer loop.

Accepted evidence:

- Implementer branch: `implementer/decision-contract-verification-routing-consolidation-v0`
- Accepted commit: `bbc84ffc7a10ebe6c33e15a862174e4a508abad2`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/decision-contract-verification-routing-consolidation-2026-05-21.md`
- Synthesis update:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Foreman-side verification passed:
  `git diff --check fad562d48e75971903f11b16b5b1f148663462f5..bbc84ffc7a10ebe6c33e15a862174e4a508abad2`
  and `./aos dev recommend --json`.
- Recommendation accepted: do not add a committed schema yet; route a broader
  docs-only Decision Contract descriptor and AFK primitive boundary sketch.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
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
- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- the implementer native subagent instructions
- `the operator native subagent contract`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/decision-contract-inventory-2026-05-21.md`
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md`
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
- `docs/recipes/agent-tooling-contexts-and-verification.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/recipes/surface-inspector-controlled-browser-dom-smoke.md`
- `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`

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
`implementer/decision-contract-verification-routing-consolidation-v0` from the
required start ref. Keep the checkpoint local unless Foreman or Michael
explicitly asks for a push or PR.

## Existing Files To Inspect

Start with:

- `docs/recipes/agent-tooling-contexts-and-verification.md` - tooling context and
  verification routing.
- `AGENTS.md` - repo-wide readiness, host-shell, AOS developer, and dev-router
  guidance.
- `.docks/foreman/AGENTS.md` - live verification blocker handling and next-step
  ladder.
- the implementer native subagent instructions - deterministic verification, live blocker, and
  manual-intervention handling.
- `the operator native subagent contract` - supervised live/HITL evidence boundary.
- `docs/dev/workflow-rules.json` - changed-file verification recommendations.
- `docs/design/notes/decision-contract-shape-sketch-2026-05-21.md` - current
  field sketch.
- `docs/design/notes/decision-contract-transfer-routing-mapping-2026-05-21.md`
  - field strain from second candidate.

Search as needed for:

```bash
rg -n "live|deterministic|ready|TCC|Input Monitoring|Accessibility|manual_intervention|manual-intervention|Operator|verification|tooling context|runtime evidence|docs-only|rebuild|smoke" AGENTS.md .docks docs
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
