@../AGENTS.md

# Scripts

## Purpose

`scripts/` contains executable repo tooling behind `./aos`, developer workflow
commands, runtime helpers, wiki tools, and AOS-owned agent execution.

## Ownership

- `aos-*` scripts implement command-surface adapters and developer tooling.
- `lib/` owns shared JavaScript helpers for scripts.
- `aos_agents/` owns the AOS project-agent runner implementation.
- Native capability stays in `src/`; public schema contracts stay in
  `shared/schemas/`.

## Local Contracts

- Keep script behavior aligned with `./aos help`, manifests, schemas, and tests.
- Prefer structured JSON output for machine surfaces.
- Avoid direct daemon/socket/launchd bypasses unless the script is the sanctioned
  adapter for that lower-level operation.

## Work Guidance

- For shell scripts, preserve macOS Bash 3.2 compatibility.
- For Node scripts, use existing repo helper modules before inventing new
  parsing or routing conventions.

## Verification

- Run the focused test matching the command surface changed.
- For runner changes, use `bash tests/aos-agents-runner.sh` and
  `python3 -m py_compile scripts/aos_agents/runner.py`.
- For broad command routing changes, include `bash tests/help-contract.sh`,
  `bash tests/dev-workflow-router.sh`, and `git diff --check` when relevant.

## Child DOX Index

- `aos_agents/` contains the AOS-owned project-agent runner.
- `lib/` contains shared script helper modules.
- `lib/agent-workspace/AGENTS.md` owns saved perception workspace helpers,
  compact readback, saved-ref validation, and backend action dispatch.
