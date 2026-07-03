@../AGENTS.md

# AI Agent Source Material

## Purpose

`ai-agents/` stores provider-neutral agent role material and provider-shaped
derivatives consumed by the AOS-owned runner.

## Ownership

- `ai-agents/agents/` owns provider-neutral role definitions.
- `ai-agents/providers/` owns provider-specific renderings of those roles.
- Active project-agent execution belongs to `./aos dev agents`, not native
  Codex custom-agent registration.

## Local Contracts

- Keep role intent provider-neutral unless a provider folder requires a concrete
  syntax.
- Treat provider TOML and prompt material as source for AOS execution, not as a
  live `.codex/agents` registry.
- Update roster or provider docs when role names, responsibilities, or model
  mappings change.

## Work Guidance

- Preserve clear role boundaries: architect, explorer, historian, implementer,
  operator, reviewer, steward, and validator.
- Do not add prompt-prefix role routing as a substitute for runner-owned role
  selection.

## Verification

- For runner-facing changes, use `bash tests/aos-agents-runner.sh`.
- For provider smoke coverage, use the focused `./aos dev agents` check named by
  the task or local docs.

## Child DOX Index

- `agents/` contains provider-neutral source material.
- `providers/` contains provider-shaped material.
