# providers/codex/

Codex-specific agent sync for agent-os.

- **`SKILL.md`** — the `$agent-sync` skill definition, invokable from the
  Codex CLI or any agent.
- **`scripts/agent-sync.sh`** (at repo root `scripts/`) — the implementation.

## Quick reference

```bash
./scripts/agent-sync.sh --dry-run   # preview
./scripts/agent-sync.sh             # apply
```

Full docs: [`SKILL.md`](./SKILL.md) and [`../../README.md`](../../README.md).
