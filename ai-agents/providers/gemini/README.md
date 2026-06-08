# providers/gemini/

Placeholder for Gemini agent sync.

**Not yet implemented.**

When implemented, this folder will contain:
- `SKILL.md` — the `$gemini-agent-sync` skill (Gemini CLI frontmatter)
- A sync script that reads `ai-agents/agents/*.md` and writes Gemini's
  agent config format

The source of truth for agent definitions remains `ai-agents/agents/` —
this folder adds only the Gemini-specific translation layer.

## Expected invocation

```bash
$gemini-agent-sync
./scripts/gemini-agent-sync.sh
```

See `ai-agents/README.md` for the full provider model.
