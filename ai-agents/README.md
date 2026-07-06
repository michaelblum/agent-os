# ai-agents/

Provider-neutral agent source material for agent-os.

This folder is the source catalog for who the agents are, what they do, what
model tier they use, and what their behavioral contracts are. It is not a Codex
folder, not a Claude folder, and not a Gemini folder. It is the human-readable,
VCS-tracked definition layer that provider adapters and the AOS-owned runner
draw from.

The current executable AOS runner role set is a narrower runtime allowlist owned
by `scripts/aos_agents/runner.py` and discoverable with:

```bash
./aos dev agents --runtime-info --json
```

Provider-shaped material may exist for source catalog or future roles that are
not currently executable by the runner.

```
ai-agents/
├── README.md          ← this file
├── roster.md          ← source catalog: names, roles, model tiers, routing rules
├── agents/            ← one .md definition file per agent (provider-agnostic)
│   ├── architect.md
│   ├── implementer.md
│   ├── explorer.md
│   ├── historian.md
│   ├── reviewer.md
│   ├── validator.md
│   ├── operator.md
│   └── steward.md
└── providers/
    ├── codex/         ← Codex-flavored role TOML consumed for enabled roles
    │   ├── SKILL.md   ← archive/runner contract; native sync is retired
    │   └── README.md
    ├── claude/        ← placeholder for Claude Code sync (not yet implemented)
    │   └── README.md
    └── gemini/        ← placeholder for Gemini sync (not yet implemented)
        └── README.md
```

---

## Why this is NOT under `.docks/`

`.docks/` is the **runtime execution layer** — each dock is a named working
context with an `AGENTS.md`, a Foreman config, and scripts that run *inside*
an active session. Docks are alive; they execute.

`ai-agents/` is **static definition data** - it describes who the agents are
and how provider-shaped role material is represented. It never executes. It has
more in common with `docs/` than with `.docks/`.

Mixing them would:
- Blur the dock concept for agents scanning `.docks/` for runtime context
- Make provider-agnostic content (Claude, Gemini) live under a folder whose
  name implies Codex's dock pattern
- Create confusion for any future contributor (human or agent) learning the
  codebase

The separation is intentional: **`.docks/` = runtime, `ai-agents/` = source definitions.**

---

## How it works

1. **Edit agent definitions here** (`ai-agents/agents/*.md`) - this is the
   source catalog for role, model tier, behavioral constraints, and routing
   criteria.
2. **Keep provider-specific material under `ai-agents/providers/<provider>/`.**
   The Codex-shaped TOML files under `ai-agents/providers/codex/` are preserved
   source material for AOS-owned runner roles and future provider work.
3. **Discover executable roles through `./aos dev agents --runtime-info --json`.**
   The runner allowlist, not the provider directory listing, decides what can
   execute today.
4. **Execute through `./aos dev agents`.** Do not sync agent-os roles into
   Codex global config, `~/.codex/agents`, repo `.codex/agents`, or native
   custom-agent registration.

## Adding a new agent

1. Create `ai-agents/agents/<name>.md` following the template in any existing
   agent file.
2. Add or update the matching provider-shaped material under
   `ai-agents/providers/codex/<name>.toml` if the role needs a Codex TOML
   shape.
3. Update the runner allowlist only when the role should become executable.
4. Verify with `./aos dev agents --runtime-info --json`.

## Updating an existing agent

1. Edit the relevant `ai-agents/agents/<name>.md`.
2. Update the provider-shaped material under `ai-agents/providers/codex/` when
   the runner-facing model, effort, sandbox, or instructions change.
3. Verify runner-facing TOML changes with
   `./aos dev agents --runtime-info --json`.

`./aos dev agents --self-test --json` is a parser/path smoke check. It is not
the executable runner role-set readback.

## Provider skill conventions

Each `providers/<provider>/SKILL.md` should describe:

- the provider-shaped material kept in git;
- whether it is active runner input or archival material;
- how to discover the currently executable runner role set;
- forbidden generated config outputs;
- provider-specific runtime environment variables.

The merge logic and behavioral contracts live once in `ai-agents/agents/` —
provider skills are thin translators, not duplicates.
