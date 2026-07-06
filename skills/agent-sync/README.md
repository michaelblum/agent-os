# agent-sync

`agent-sync` is retired. This package remains only as a historical tombstone so
old references resolve to the current boundary instead of reviving the removed
native custom-agent sync path.

Do not run `$agent-sync`, `./aos agent-sync`, or any reconstructed script that
writes `multi_agent_v2`, `[agents]`, `[agents.<role>]`, `.codex/agents/*.toml`,
or `~/.codex/agents/*.toml` for agent-os.

Use `./aos dev agents` for project-agent execution. Codex-shaped role material
is preserved under `ai-agents/providers/codex/*.toml` for the AOS-owned runner,
not for user-global Codex native custom-agent registration.

Current authority:

- `docs/adr/0017-retire-codex-native-custom-agents.md`
- `.codex/AGENTS.md`
- `ai-agents/providers/codex/README.md`
- `scripts/agent-sync.sh`
