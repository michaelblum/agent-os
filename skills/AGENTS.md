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

- During program `aos-sovereign-capability-substrate-v1`, ADR 0043 and
  `docs/dev/aos-sovereign-capability-authority-v1.json` own the target while
  registered skills continue to teach only current help/schema/implementation.
  Fixed browser grammar and other mapped absence guidance are burn-down
  baseline, not enduring product policy; do not teach unimplemented commands.
- Keep skill instructions executable and scoped to when the skill should be
  used.
- Do not encode project-wide invariants only inside a skill; mirror durable
  repo rules in the owning `AGENTS.md` or docs surface.
- Installable AOS skills must be registered, concise or explicitly split into
  references, and backed by docs/API/schema/test authority when they claim
  durable repo behavior.
- Installable skills inherit AOS ambient authority. They may teach optional
  previews, explicit caller-requested Gate input, and optional Work Record
  evidence, but must not turn them into permission prerequisites for ordinary
  actions or add default privacy/redaction policy.
- The Work Record skill may teach V1 evidence inspection, neutral planning,
  caller-outcome validation, and exact finalization only. It must not route a
  Gate answer into a Work Record attempt or teach a public repair executor.
- Root skill packages and registry rows describe only current packages. Delete
  superseded skills in the same change as their internal consumer migration;
  do not retain retired statuses, aliases, redirects, or tombstones.
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
  `aos-desktop-world-authoring/`, `aos-saved-workspace/`, `aos-canvas-vision/`, `aos-focus-sessions/`,
  `aos-browser/`, `aos-verification/`, `aos-operator-annotations/`,
  `aos-work-records/`, `aos-recipes/`, and
  `aos-command-surface-maintenance/` are the installable AOS root skill pack.
- `aos-maintainer-routing/`, `aos-repo-binary-build/`, and
  `aos-maintainer-orientation/` are retained local maintainer workflow skills
  backed by deterministic repo scripts; they are not installable AOS product
  skills.
- `caveman/`, `issue-hygiene-sweep/`, and `plan-retirement-audit/` are
  retained local helper skills outside the AOS installable skill product.
- `symphony-talent-design/` is private brand/design skill material and is not
  part of the AOS skill pack.
- Each direct child folder is a standalone skill package.
