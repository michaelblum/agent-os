# AOS Agent Runtime M3 Correction

Date: 2026-06-10

## Decision

M3's `native-codex` default was off-plan architectural drift. It reversed the
reason the AOS agent runner exists: AOS needs owned, inspectable, testable child
execution because Codex native subagent execution was opaque, difficult to debug,
and not reliable as the repo's default execution substrate.

Effective immediately:

- `provider-sdk` is the default `./aos dev agents` engine.
- `native-codex` is an explicit diagnostic/import lane only.
- `docs/adr/0019-retire-project-agent-orchestration.md` is the durable
  authority that keeps the runner path out of active AOS core.
- `docs/dev/reports/aos-agent-runtime-m3-native-contract-v0.md` is historical
  and superseded where it claims `native-codex` is the default.

## Corrected Intent

The AOS runner is not a provider-proof smoke harness and not a wrapper around an
opaque Codex native loop. It is the in-house execution layer for project agents:
role/profile readback, provider execution, typed artifacts, runtime readback,
status/error guards, and approval-gated patch validation/application.

The execution destination is:

```text
Foreman coordination
  -> ./aos dev agents
  -> scripts/aos_agents/runner.py
  -> provider-backed child execution with typed artifacts
  -> Foreman-owned review/apply/git decisions
```

`native-codex` may still be useful for diagnostics, compatibility comparison, or
manual import experiments. It is not the default lane and must not be described
as the desired destination without a new explicit architecture decision.

## Immediate Mitigation

This correction performs the minimum safe revert of M3 drift:

- `scripts/aos_agents/runner.py` sets `provider-sdk` as `DEFAULT_ENGINE`.
- Runtime info reports provider execution as the default AOS-owned lane.
- `scripts/aos_agents/README.md` documents provider-first execution and native
  Codex as explicit diagnostic/import.
- Command metadata no longer advertises `native-codex` as the default.
- Dock/profile and root Codex instructions stop presenting native Codex
  subagents as routine default delegation.
- Focused tests assert the corrected default.

## Preserved M1/M2 Safety Boundaries

The correction preserves the useful M1/M2/M3 safety gates:

- read-only roles remain `explorer`, `reviewer`, `validator`, and `historian`;
- `implementer` remains rejected by default;
- implementer patch artifacts require explicit `--patch-output`;
- provider/native child execution never applies patches directly;
- `--check-patch` and `--apply-patch` do not execute children;
- `--apply-patch` requires explicit checkout-mutation approval, rejects dirty
  worktrees, reruns `git apply --check`, and leaves changes unstaged.

## Future Work

- Replace the provider adapter with a more direct AOS-owned provider abstraction
  if needed, but keep the same artifact and safety contracts.
- Add richer lifecycle/evidence records only after the corrected default is
  stable.
- Treat Codex native subagent improvements as optional evidence, not as automatic
  reason to return the default to `native-codex`.
