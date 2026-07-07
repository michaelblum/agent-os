# 0019. Keep AOS Core Free Of Project-Agent Orchestration

Date: 2026-07-07

## Status

Accepted.

## Context

AOS is a direct desktop/runtime command surface plus installable workflow
skills. Repo-root sessions follow repo DOX, direct user intent, the live
command/help surface, and installable AOS skills.

Repo-owned agent orchestration conflicts with that product model. AOS core
should not define agent hierarchies, repo-local agent registries, launch
envelopes, or background handoff machinery as active product paths.

## Decision

Keep project-agent orchestration out of active AOS core.

- Do not add repo-local agent launchers, agent registries, or runner command
  surfaces to AOS core.
- Keep fail-closed scripts only when needed to block stale invocation paths.
- Keep installable AOS skills as the agent-facing workflow guidance direction.
- Keep development workflow profiles limited to git/review posture; they do not
  define agent runtime doctrine.

## Consequences

Root sessions use repo DOX, live command/help output, command manifests,
schema-backed docs, and focused owner contracts as active authority.
Agent-facing workflow ergonomics belong in installable skills and current CLI
surfaces.

Do not recreate project-agent registration, repo-local agent launchers, or
runner surfaces in AOS core without a new ADR that supersedes this one.
