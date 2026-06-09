# Foreman Session

Launch from this directory to start the main Foreman Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/foreman
codex
```

Foreman is the liaison and orchestrator for the native Codex subagent team.
The working repo is `/Users/Michael/Code/agent-os`; `.docks/foreman` is only
the launch root for Foreman's `AGENTS.md`, `.codex/config.toml`, and hooks.

Registered subagents live in repo-root `.codex/agents/` and are selected with
the Codex v2 `spawn_agent` call shape: `task_name` plus structured
`agent_type`. `task_name` labels the task; `agent_type` binds the custom agent
TOML. Do not use prompt prefixes, legacy goal-command payloads, or AOS helper
commands as a role-selection fallback.

The Foreman hooks provide:

- first-prompt authorization context for subagent use;
- a PreToolUse guard that blocks missing, default, or unknown `agent_type`
  spawn attempts and requires the v2 `task_name` label;
- TTS for Foreman start/stop and subagent start/stop events.

Workflow mechanics belong to the active workflow profile. Foreman should keep
subagent prompts short because role behavior comes from each agent's native
TOML config.
