---
name: codex-agent-roster-archive
provider: codex
description: >
  Preserved Codex-flavored role TOML source for the AOS-owned agent runner.
  This material is not synced into Codex user config and must not register
  Codex native custom agents. The runner allowlist decides which TOML roles are
  currently executable.
source_of_truth: ai-agents/providers/codex/
active_execution_surface: ./aos dev agents
retired_script: scripts/agent-sync.sh
---

# Codex Role Material Archive

`ai-agents/providers/codex/*.toml` is preserved role material for the AOS-owned
agent runner. The files define role names, instructions, model, effort, and
sandbox posture in the Codex TOML shape, but they are not an active Codex
custom-agent registry and are not automatically executable just because a TOML
file exists.

## Current Contract

- `./aos dev agents` is the execution surface.
- `provider-sdk` is the default engine.
- The runner reads TOML files for roles enabled by its allowlist and can be
  pointed at an OpenAI-compatible proxy with provider environment variables.
- Use `./aos dev agents --runtime-info --json` to discover the current
  executable role set.
- `scripts/agent-sync.sh` is retired and intentionally exits non-zero.

## Forbidden Outputs

Do not recreate any of these for agent-os:

- `multi_agent_v2 = true`
- `[agents]` or `[agents.<role>]` blocks in Codex config files
- repo-root `.codex/agents/*.toml` as an active discovery surface
- user-global `~/.codex/agents/*.toml`
- native Codex custom-agent dispatch as routine execution

## Proxy Environment

Use these when the provider runner should call an OpenAI-compatible proxy:

```bash
AOS_AGENT_PROVIDER_BASE_URL=<proxy-url>
AOS_AGENT_PROVIDER_API_KEY=<proxy-key>
AOS_AGENT_PROVIDER_API=chat_completions
./aos dev agents --role explorer --task "inspect the active profile" --execute --json
```

`AOS_AGENT_PROVIDER_BASE_URL` and `AOS_AGENT_PROVIDER_API_KEY` override the
standard `OPENAI_BASE_URL` and `OPENAI_API_KEY` values for this runner only.
