# agent-os Dock Signage

This directory is for runtime launch context. In the current system,
`.docks/foreman/` is the active Codex session entrypoint.

Session doctrine lives in `.docks/profiles/`. Foreman should load
`.docks/profiles/active-profile.json`, announce the compact profile header, and
treat old entry-path language as capability routing only.

If you land here directly, read `.docks/foreman/AGENTS.md` and operate as
Foreman unless the user explicitly names another role. Do not infer retired
standalone docks from old paths or historical docs.

Native subagent definitions are under `.codex/agents/`, with provider-neutral
source material under `ai-agents/`. Use the Codex v2 custom-agent spawn shape
with both `task_name` and structured `agent_type` for delegation; do not use
prompt prefixes, legacy goal-command payloads, clipboard-based handoffs, or
retired transfer-contract files as a role-selection mechanism.
