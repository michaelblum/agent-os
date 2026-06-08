# ai-agents/

Provider-neutral agent roster for agent-os.

This folder is the **single source of truth** for who the agents are, what
they do, what model tier they run on, and what their behavioral contracts are.
It is not a Codex folder, not a Claude folder, not a Gemini folder — it is the
human-readable, VCS-tracked definition layer that all providers sync *from*.

```
ai-agents/
├── README.md          ← this file
├── roster.md          ← canonical list: names, roles, model tiers, spawn rules
├── agents/            ← one .md definition file per agent (provider-agnostic)
│   ├── architect.md
│   ├── implementer.md
│   ├── explorer.md
│   ├── reviewer.md
│   ├── validator.md
│   ├── operator.md
│   └── steward.md
└── providers/
    ├── codex/         ← Codex-specific sync skill + generated .toml stubs
    │   ├── SKILL.md   ← $agent-sync skill (Codex frontmatter + points at agents/)
    │   └── README.md
    ├── claude/        ← placeholder for Claude Code sync (not yet implemented)
    │   └── README.md
    └── gemini/        ← placeholder for Gemini sync (not yet implemented)
        └── README.md
```

## How it works

1. **Edit agent definitions here** (`ai-agents/agents/*.md`) — this is the
   authoritative source for role, model tier, behavioral constraints, and
   spawn criteria.
2. **Run the provider sync skill** to push definitions into provider-native
   config formats:
   - Codex: `$agent-sync` or `./scripts/agent-sync.sh`
     → writes `~/.codex/agents/*.toml` + registers in `~/.codex/config.toml`
   - Claude: `$claude-agent-sync` (future)
   - Gemini: `$gemini-agent-sync` (future)
3. **Never hand-edit** `~/.codex/config.toml` agent blocks or
   `~/.codex/agents/*.toml` directly — those are outputs, not sources.

## Adding a new agent

1. Create `ai-agents/agents/<name>.md` following the template in any existing
   agent file.
2. Run `$agent-sync` (Codex) or the relevant provider skill.
3. Done — the agent is available to `spawn_agent` immediately.

## Updating an existing agent

1. Edit the relevant `ai-agents/agents/<name>.md`.
2. Run `$agent-sync` — it will detect the diff and update in-place.
   A timestamped backup of your global config is written automatically.

## Provider skill conventions

Each `providers/<provider>/SKILL.md` shares the same structure:
- Frontmatter with the provider's invocation token (e.g. `$agent-sync`)
- A pointer to `ai-agents/agents/` as the source of truth
- Provider-specific output format and file locations
- Provider-specific resilience notes

The merge logic and behavioral contracts live once in `ai-agents/agents/` —
provider skills are thin translators, not duplicates.
