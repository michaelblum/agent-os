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
- `.docks/operator/` is the supervised human-in-the-loop execution and locator
  review session profile.

## Boundary

- A Dock is not a Workflow.
- A Docked Session may work on a Workflow, such as the Employer Brand
  Comparative Audit Workflow.
- GDI receives plain assigned implementation handoffs. Do not add `/goal` or
  addressee prefixes to clipboard payloads.
- Operator receives plain supervised instructions, so it can stop
  for clarification, visual confirmation, sign-off, or blockers instead of
  forcing autonomous goal completion.
- Operator is a docked role for bounded supervised page operation, locator
  review, selector approval, stop decisions, and capture-plan handoffs. It is
  not a replacement for GDI, Foreman, Verifier, or workflow-engine behavior.
- Do not create launchers that concatenate persona markdown into prompts. Use a
  direct dock root with `AGENTS.md` and `.codex/`.
- Do not write generated run state into `.docks/`.
