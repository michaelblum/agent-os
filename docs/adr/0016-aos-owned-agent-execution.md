# ADR 0016: AOS-Owned Agent Execution

**Status:** Accepted
**Date:** 2026-06-10

## Decision

AOS owns project-agent child execution by default. The canonical execution
surface is `./aos dev agents`, backed by the repo-owned Python runner at
`scripts/aos_agents/runner.py`, durable schemas, focused tests, and runtime
artifacts under `.runtime/dev/aos-agents/`.

The default agent engine is `provider-sdk`, the AOS-owned local runner adapter.
`native-codex` is an explicit diagnostic/import lane only. It may render and
validate Codex native subagent dispatch contracts, but it must not be the default
child execution substrate, and Foreman must not treat it as a trusted replacement
for the AOS runner.

## North Star

The AOS agent runtime exists because Codex native subagent execution was opaque
and unreliable for this repo's operating model. The required destination is
inspectable, testable, AOS-owned execution with:

- role-specific model, effort, sandbox, and instruction control;
- typed `summary.json`, `result.json`, `native-dispatch.json`, and `patch.diff`
  artifacts where applicable;
- deterministic runtime paths under `.runtime/dev/aos-agents/`;
- status guards and error-path coverage;
- provider/child output that can be read, checked, imported, or rejected without
  hidden upstream state;
- explicit Foreman control over patch review, checkout mutation, commits, pushes,
  pull requests, and merges.

Opaque native subagent loops, prompt-prefix role selection, inherited Foreman
model/effort, encrypted runtime schemas, non-replayable 400 errors, and hidden
child execution state are the failure modes this runtime is designed to avoid.

## Background

The original dock model treated `.docks/foreman`, `.docks/gdi`, and
`.docks/operator` as separate role entrypoints. That was too slow for routine
work, so Foreman became the entrypoint for a team of specialized agents.

Codex native subagents initially appeared to provide that team model, but the
available dispatch path inherited Foreman's model and reasoning effort. That
defeated the economic and capability goal: AOS must be able to mix role-specific
model capability, cost, and speed.

The repo then tried Codex `multi_agent_v2` because it promised structured
`agent_type` selection. In local use it was not trustworthy enough to be the
execution substrate: the implementation produced 400 errors, encrypted schemas,
and poor visibility into the dispatch loop. AOS therefore brought the execution
layer in-house through `scripts/aos_agents/runner.py` and `./aos dev agents`.

## Consequences

- `provider-sdk` is the default engine for `./aos dev agents`.
- `native-codex` requires an explicit `--engine native-codex` request and remains
  a diagnostic/import lane.
- `native-codex` may not become default again through a milestone report, README
  rewrite, or command manifest update. Reversal requires a new ADR or explicit
  human architecture decision that names this ADR and explains why the native
  substrate is now inspectable, testable, role-bound, and debuggable enough.
- M1/M2 provider-backed work is the seed of the canonical runtime, not just a
  disposable smoke harness.
- M3's `native-codex` default was off-plan drift from this north star and is
  superseded by `docs/dev/reports/aos-agent-runtime-m3-correction-v1.md`.

## Guardrails

- A read-only role may plan without executing, but provider execution must remain
  explicit with `--execute`.
- `implementer` remains rejected by default. It may produce patch artifacts only
  through explicit `--patch-output`.
- Child execution, whether provider-backed or native-imported, never applies
  patches directly.
- `--check-patch` and `--apply-patch` never invoke child execution.
- `--apply-patch` requires `--i-approve-checkout-mutation`, rejects dirty
  worktrees, reruns `git apply --check`, applies with plain `git apply`, and
  leaves changes unstaged.

## Verification

Changes to this runtime must run:

```bash
bash tests/aos-agents-runner.sh
```

Changes to dock/profile delegation language must also run:

```bash
node --test tests/schemas/dock-operating-profiles.test.mjs
bash tests/dock-hook-isolation.sh
```
