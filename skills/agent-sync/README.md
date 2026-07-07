# agent-sync

`agent-sync` is retired. This package remains only as a historical tombstone so
old references resolve to the current boundary instead of reviving the removed
native custom-agent sync path.

Do not run `$agent-sync`, `./aos agent-sync`, or any reconstructed script that
writes `multi_agent_v2`, `[agents]`, `[agents.<role>]`, `.codex/agents/*.toml`,
or `~/.codex/agents/*.toml` for agent-os.

Do not recreate project-agent role registration in AOS core. Historical
Codex-shaped role material has been archived outside the active repo tree, not
preserved as a user-global Codex native custom-agent registration source.

Current authority:

- `docs/adr/0017-retire-codex-native-custom-agents.md`
- `scripts/agent-sync.sh`
