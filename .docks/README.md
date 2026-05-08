# Docks

Docks are repo-local Codex session roots for personas, roles, or alternate
session profiles.

A dock is not a Workflow. A Workflow is an AOS/domain Subject such as the
Employer Brand Comparative Audit. A dock is only a way to launch Codex with
role-local instructions, hooks, and config.

## Launch

Open a terminal in the dock directory and start Codex:

```bash
cd .docks/gdi
codex
```

Equivalent:

```bash
codex --cd .docks/gdi
```

Codex then discovers the dock's `AGENTS.md`, `.codex/hooks.json`, and any other
project-local configuration from that launch root. Source edits and tests still
belong in the real repo root unless the dock says otherwise.

Each dock owns its own hook scripts under `<dock>/hooks/`. Do not route dock
hooks through a shared `.docks/hooks/` script; role behavior should stay local
to the dock that installs it.

## Canonical Docks

- `gdi/` is the Goal-Driven Implementation role.
- `foreman/` is the integration/review and steering role.
