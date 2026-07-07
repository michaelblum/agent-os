# 0019. Retire Project-Agent Orchestration From AOS Core

Date: 2026-07-07

## Status

Accepted.

## Context

AOS briefly carried repo-local project-agent and dock scaffolding: `.docks/`,
`ai-agents/`, `./aos dev agents`, `./aos dev docks`, `./aos dev subagent`, and
AFK dock launch prototypes. That scaffold encoded session process, provider
role material, launch roots, hooks, and workflow doctrine inside the AOS repo.

That direction conflicts with the current product model. AOS should be a direct
desktop/runtime command surface plus installable workflow skills. Coding
sessions started at the repo root should follow repo DOX, direct user intent,
the live command/help surface, and installable AOS skills. They should not be
steered into a repo-owned specialist-agent hierarchy or dock runtime envelope.

## Decision

Retire project-agent orchestration from active AOS core.

- Remove `.docks/` and `ai-agents/` from the active repo tree.
- Archive the removed material outside the repo under
  `/Users/Michael/Code/tmp/agent-os/archival/`.
- Remove discoverable command forms for `dev agents`, `dev docks`,
  `dev subagent`, and dock-based `dev afk-*` prototypes.
- Keep historical schemas or scripts only when they validate old records or
  fail closed for stale references.
- Keep installable AOS skills as the agent-facing workflow guidance direction.
- Keep development workflow profiles limited to git/review posture; they do not
  define project-agent personas or docked session doctrine.

## Consequences

Root sessions no longer ingest dock/profile/role scaffolding from active
orientation files. Future AOS agent-facing ergonomics should be expressed as
skills, CLI help, command manifests, schema-backed docs, and focused DOX owner
contracts.

Do not recreate project-agent registration or dock launch routing in AOS core
without a new ADR that supersedes this one.
