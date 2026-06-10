# Foreman Session

Launch from this directory to start the main Foreman Codex session:

```bash
cd /Users/Michael/Code/agent-os/.docks/foreman
codex
```

Foreman is the liaison and coordinator for AOS-owned agent execution. Native
Codex custom agents are disabled for agent-os.
The working repo is `/Users/Michael/Code/agent-os`; `.docks/foreman` is only
the launch root for Foreman's `AGENTS.md`, `.codex/config.toml`, and hooks.
Operating doctrine loads from `.docks/profiles/active-profile.json`; fresh
Foreman sessions should announce the compact profile header from that file.

Role material lives under `ai-agents/providers/codex/` and is consumed through
`./aos dev agents`. Do not recreate repo-root `.codex/agents`, user-global
`~/.codex/agents`, `[agents.*]` config blocks, `multi_agent_v2`, prompt
prefixes, legacy goal-command payloads, or native custom-agent dispatch.

The Foreman hooks provide:

- quiet first-prompt session initialization and Foreman start TTS;
- a PreToolUse guard that denies native custom-agent spawn attempts;
- TTS for Foreman start/stop events and legacy subagent hook events.

Development integration posture is one part of the active dock profile.
Foreman should use `./aos dev agents --runtime-info --json` for runner readback
and provider/proxy status.
