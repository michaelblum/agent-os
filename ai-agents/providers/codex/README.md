# providers/codex/

Preserved Codex-flavored role material for the AOS-owned agent runner.

These TOML files are source material and should not be copied into Codex global
config. `./aos dev agents` reads the TOML for roles enabled by its runner
allowlist; the provider directory listing is not itself an executable role
registry. The old `$agent-sync` path is retired because it re-registers native
Codex custom agents.

Discover the currently executable role set from the runner:

```bash
./aos dev agents --runtime-info --json
```

Current execution path:

```bash
./aos dev agents --role explorer --task "inspect the active profile" --json
```

Proxy-backed execution:

```bash
AOS_AGENT_PROVIDER_BASE_URL=<proxy-url> \
AOS_AGENT_PROVIDER_API_KEY=<proxy-key> \
AOS_AGENT_PROVIDER_API=chat_completions \
./aos dev agents --role explorer --task "inspect the active profile" --execute --json
```

See [`SKILL.md`](./SKILL.md) and [`../../README.md`](../../README.md).
