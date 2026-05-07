# Recipe: Codex Dock Session Profiles

Use this recipe when a Codex session should adopt a role/persona-specific
profile without turning that role into an AOS Workflow.

A dock is just a launch root under `.docks/`. It may contain `AGENTS.md`,
`.codex/hooks.json`, local config, scripts, or notes that should apply only to
sessions launched from that directory.

## Launch A Dock

From the repo root:

```bash
cd .docks/gdi
codex
```

Or:

```bash
codex --cd .docks/gdi
```

Codex discovers the dock's instructions and `.codex` files through the normal
project-local discovery stack. Source edits, tests, and report artifacts still
belong in the real repo root unless the dock says otherwise.

## Current Docks

- `.docks/gdi/` is the Goal-Driven Implementation session profile.
- `.docks/foreman/` is the review/integration session profile.

## Boundary

- A Dock is not a Workflow.
- A Docked Session may work on a Workflow, such as the Employer Brand
  Comparative Audit Workflow.
- Do not create new launchers that concatenate persona markdown into prompts
  before first trying a direct dock root with `AGENTS.md` and `.codex/`.
- Do not write generated run state into `.docks/`.

## Legacy Compatibility

`.docks/gdi-foreman/`, `scripts/run-workflow.mjs`, and
`scripts/create-codex-workflow-hook-profile.mjs` are legacy compatibility
surfaces for the older GDI/foreman supervisor experiment. Their names and some
machine-readable fields still use `workflow` for compatibility, but new docs,
prompts, and skills should call that pattern a docked session supervisor, not an
AOS Workflow. When the legacy supervisor must be used, prefer the `--run-id`
alias over the older `--workflow-id` flag.
