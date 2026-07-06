@../AGENTS.md

# Skills

## Purpose

`skills/` contains local skill packages used by agents working in this repo.

## Ownership

- Each child folder owns its own `SKILL.md`, scripts, assets, examples, and
  templates.
- Repo behavior belongs in AGENTS/DOX, docs, scripts, or source code, not in a
  skill unless the behavior is specifically agent-tooling workflow.

## Local Contracts

- Keep skill instructions executable and scoped to when the skill should be
  used.
- Do not encode project-wide invariants only inside a skill; mirror durable
  repo rules in the owning `AGENTS.md` or docs surface.

## Work Guidance

## Verification

- Run any skill-local script or example check when modifying executable skill
  behavior.

## Child DOX Index

- `agent-sync/` is a retired historical tombstone for ADR 0017. It must not
  sync Codex native custom agents, mutate `~/.codex/config.toml`, or recreate
  user-global agent registrations.
- `aos-agent-workspace/` contains the saved perception workspace and compact
  ref loop skill for normal `aos see` / `aos do` workflows.
- Each direct child folder is a standalone skill package.
