# Docks

`.docks/foreman/` is the Codex launch directory for the main Foreman session.
Foreman is the liaison and orchestrator for the native Codex subagent team:
architect, implementer, reviewer, explorer, validator, operator, and steward.

Retired standalone dock directories such as `.docks/gdi/` and
`.docks/operator/` are not part of the current runtime. The old goal-command,
transfer-contract, clipboard-dispatch, and separate terminal handoff machinery
has been replaced by native Codex `spawn_agent` calls with structured
`agent_type`.

Agent definitions are not stored here:

- Provider-neutral source material lives under `ai-agents/`.
- Codex TOML agent configs live under `.codex/agents/`.
- `.docks/foreman/.codex/config.toml` is only the Foreman launch config.

The remaining Foreman hooks provide guardrails and TTS for Foreman/subagent
start and stop events. They do not dispatch subagents; dispatch belongs to the
Codex `spawn_agent` tool.
