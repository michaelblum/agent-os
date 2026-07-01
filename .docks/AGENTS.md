# agent-os Dock Signage

This directory is for runtime launch context. A dock is a named launch envelope:
local instructions, hooks/config, voice/stop behavior, and profile binding. It
is not an agent definition or a work assignment. In the current system,
`.docks/foreman/` is the only named dock and the active Codex session
entrypoint.

Session doctrine lives in `.docks/profiles/`. Foreman should load
`.docks/profiles/active-profile.json`, announce the compact profile header, and
treat old entry-path language as capability routing only.

If you land here directly, read `.docks/foreman/AGENTS.md` and operate as
Foreman unless the user explicitly names another current dock or role. Do not
infer retired standalone docks from old paths or historical docs.

Native Codex custom agents are disabled for agent-os. Provider-neutral source
material lives under `ai-agents/`; Codex-shaped runner material lives under
`ai-agents/providers/codex/`. Use `./aos dev agents`, not Codex native
custom-agent dispatch. Do not use prompt prefixes, legacy goal-command payloads,
clipboard-based handoffs, or retired transfer-contract files as a role-selection
mechanism.

## Child DOX Index

- `foreman/AGENTS.md` governs the only current named dock and active Foreman
  entrypoint.
- `profiles/` owns active profile binding and reusable profile packs; it does
  not have a child `AGENTS.md` yet.
- `harness/` owns dock harness support files; it does not have a child
  `AGENTS.md` yet.
