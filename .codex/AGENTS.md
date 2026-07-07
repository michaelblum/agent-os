@../AGENTS.md

# Codex Configuration

## Purpose

`.codex/` contains local Codex configuration for this checkout.

## Ownership

- `.codex/config.toml` owns local Codex model, approval, sandbox, and feature
  settings for this repo.
- Native Codex custom-agent registration stays disabled in active config.
- Provider role material lives outside `.codex/` and is source material for the
  AOS-owned runner, not active Codex custom-agent registration.

## Local Contracts

- Do not add `multi_agent_v2`, `[agents.*]`, or `.codex/agents/*.toml` as active
  Codex discovery surfaces.
- Preserved Codex-native role material belongs under
  `ai-agents/providers/codex/*.toml`.
- Do not run `$agent-sync` or recreate global `~/.codex/agents` registrations.
- Keep this file scoped to `.codex/` configuration. Repo-root session behavior
  is governed by root DOX plus the nearest `AGENTS.md` for the path being edited.

## Work Guidance

- Keep `.codex/` changes configuration-only unless the user explicitly asks to
  change Codex session policy.
- Route durable project-agent execution policy to
  `docs/adr/0016-aos-owned-agent-execution.md`, `ai-agents/`, or
  `scripts/aos_agents/` as appropriate.

## Verification

- For config-only edits, run `git diff --check`.
- For changes that affect the AOS-owned agent runner, use the nearest owning
  `AGENTS.md` and run its focused checks.

## Child DOX Index

- `.codex/agents/` is intentionally empty in active config.
