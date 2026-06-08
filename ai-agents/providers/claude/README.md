# providers/claude/

Placeholder for Claude Code agent sync.

**Not yet implemented.**

When implemented, this folder will contain:
- `SKILL.md` — the `$claude-agent-sync` skill (Claude Code frontmatter)
- A sync script that reads `ai-agents/agents/*.md` and writes the Claude
  Code equivalent of agent config (likely `~/.claude/agents/*.md` or
  project-level `CLAUDE.md` agent blocks)

The source of truth for agent definitions remains `ai-agents/agents/` —
this folder adds only the Claude-specific translation layer.

## Expected invocation

```bash
$claude-agent-sync          # from Claude Code CLI
./scripts/claude-agent-sync.sh
```

See `ai-agents/README.md` for the full provider model.
