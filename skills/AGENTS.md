@../AGENTS.md

# Skills

## Purpose

`skills/` contains local root skill packages used by agents working in this
repo, plus the root skill registry for AOS installable skill productization.
Maintainer workflow skills may be retained local packages without becoming
part of the installable AOS desktop product pack.

## Ownership

- Each child folder owns its own `SKILL.md`, scripts, assets, examples, and
  templates.
- `registry.json` owns root skill inventory, installability status, target
  support, references, and durable backing for direct child skill packages.
- Repo behavior belongs in AGENTS/DOX, docs, scripts, or source code, not in a
  skill unless the behavior is specifically agent-tooling workflow.

## Local Contracts

- Keep skill instructions executable and scoped to when the skill should be
  used.
- Do not encode project-wide invariants only inside a skill; mirror durable
  repo rules in the owning `AGENTS.md` or docs surface.
- Installable AOS skills must be registered, concise or explicitly split into
  references, and backed by docs/API/schema/test authority when they claim
  durable repo behavior.
- Unknown install targets fail closed; writes to skill trees must go through the
  bounded `aos skills install --target ...` command surface.

## Work Guidance

## Verification

- Run any skill-local script or example check when modifying executable skill
  behavior.
- Run `node scripts/aos-skills-validate.mjs --json` and
  `node --test tests/aos-skills-registry.test.mjs` when modifying root skill
  registry metadata or root skill package contracts.
- Add `node --test tests/aos-skills-command.test.mjs` when modifying
  installability, target support, or planned install behavior.

## Child DOX Index

- `registry.json` indexes root skill packages, installability status, target
  support, references, and durable backing.
- `aos-core-orientation/`, `aos-runtime-readiness/`, `aos-desktop/`,
  `aos-toolkit-authoring/`, `aos-desktop-world-authoring/`,
  `aos-radial-menu-authoring/`, `aos-saved-workspace/`,
  `aos-canvas-vision/`, `aos-focus-sessions/`,
  `aos-browser/`, `aos-verification/`, `aos-operator-annotations/`,
  `aos-work-records/`, `aos-recipes/`, and
  `aos-command-surface-maintenance/` are the installable AOS root skill pack.
- `agent-sync/` is a fail-closed tombstone for ADR 0019. It must not
  sync Codex native custom agents, mutate `~/.codex/config.toml`, or recreate
  user-global agent registrations.
- `aos-agent-workspace/` is a retired tombstone for the broad saved workspace
  skill; installable guidance now lives in `aos-desktop/`,
  `aos-saved-workspace/`, `aos-canvas-vision/`, `aos-focus-sessions/`, and
  `aos-verification/`.
- `browser-adapter/` is a retired tombstone for the broad browser adapter
  skill; installable browser guidance now lives in `aos-browser/`.
- `aos-maintainer-routing/`, `aos-repo-binary-build/`, and
  `aos-maintainer-orientation/` are retained local maintainer workflow skills
  backed by deterministic repo scripts; they are not installable AOS product
  skills.
- `caveman/`, `issue-hygiene-sweep/`, and `plan-retirement-audit/` are
  retained local helper skills outside the AOS installable skill product.
- `symphony-talent-design/` is private brand/design skill material and is not
  part of the AOS skill pack.
- Each direct child folder is a standalone skill package.
