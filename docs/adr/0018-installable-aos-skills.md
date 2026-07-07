# ADR 0018: Installable AOS Skills Product Surface

**Status:** Accepted
**Date:** 2026-07-06

## Decision

AOS will expose first-class installable root skills for coding agents. The
product model is:

```text
small direct ./aos commands + manifest/help authority + installable skills that teach workflows
```

Skills are agent guidance packages. They are not a new execution substrate and
do not replace Recipes, Workflows, Work Records, provider roles, or wiki
plugins. Skills teach agents which direct `./aos` workflow to use, how to
validate it, when to dry-run, when to recapture, and when to stop.

The public command family will be `aos skills` with at least:

- `aos skills list --json`
- `aos skills check --target <target> --json`
- `aos skills install --target <target> [--dry-run] --json`

Exact command syntax remains owned by `./aos help --json` and source command
manifests. Skills may cite command families and workflow loops, but they should
send agents back to `./aos help <command> --json` for current argument shape.

## Product Boundaries

| Concept | Owner | Boundary |
| --- | --- | --- |
| Root Skill | `skills/<name>/SKILL.md` plus `skills/registry.json` | Installable agent guidance package. It may guide or wrap command use, but it is not a Recipe, Workflow, Run, or Work Record. |
| Wiki plugin | `wiki-seed/`, runtime wiki state, and `aos wiki` | Runtime wiki/plugin content. A plugin may contain `SKILL.md`, but it is not an installed root skill unless explicitly packaged through the root skill registry. |
| Provider role material | `ai-agents/` and AOS runner config | Agent-runner/provider execution configuration. It is not a root skill and must not recreate native Codex custom-agent registration. |
| Recipe | `recipes/`, recipe manifests, and `aos recipe` | Source-backed executable procedure with dry-run/run semantics. Skills may teach recipe use but do not become recipes. |
| Workflow | orchestration docs/schemas when implemented | Cross-recipe, agent, gate, retry, and evidence orchestration. A skill may describe how to choose a workflow but is not the workflow engine. |
| Guide or Playbook | `docs/guides/` and durable docs | Method guidance. It may be referenced by a skill without becoming executable. |
| Work Record | `aos work-record` and shared schemas | Durable proof/receipt for a run. Skills may teach how to inspect or repair records, but they do not emit proof by themselves. |

## Install Targets

Supported target names are:

| Target | Skill directory contract |
| --- | --- |
| `codex` | `${CODEX_HOME:-~/.codex}/skills` |
| `claude` | `${CLAUDE_HOME:-~/.claude}/skills` |
| `agents` | `${AOS_AGENTS_SKILLS_DIR:-~/.agents/skills}` |
| `path` | Explicit `--path <dir>` only. The path must canonicalize under the requested directory and must be used for tests or local override installs. |

Unknown targets fail closed. Implementations must not infer hidden aliases or
write into user-global skill trees unless the caller chose a target or explicit
path. Dry-run is the default development proof for new target logic.

## Installed Copy Ownership And Drift

AOS owns installed copies of AOS root skill packages. Installed copies should
carry a source manifest/digest so `aos skills check --json` can classify each
package as:

- `ok`
- `missing`
- `stale`
- `unmanaged`
- `unsupported_target`
- `blocked`

AOS must not overwrite existing user material unless it is an AOS-managed copy
or the caller passes an explicit safe replacement flag. Path traversal, symlink
escape, ambiguous roots, and unsupported targets fail closed.

## Playwright CLI Companion Boundary

AOS keeps its browser adapter. AOS owns durable browser flows through:

- `aos focus`
- `aos see capture browser:... --save`
- saved refs
- dry-run validation
- action envelopes
- Work Record evidence
- `aos show --anchor-browser`

Playwright CLI remains the direct escape hatch for browser primitives AOS does
not wrap, including tracing, video, tab management, reload/back/forward, upload,
select/check/uncheck, codegen, and arbitrary page eval.

AOS skills may detect or recommend upstream Playwright CLI skills. AOS must not
vendor, fork, or silently rewrite Playwright skill content. The AOS companion
surface reports Playwright CLI runtime status, can inspect a selected target for
Playwright-owned skill packages, and dry-runs the external
`playwright-cli install --skills` invocation through the existing AOS
Playwright runtime resolver. A non-dry-run companion install would need a later
explicit command surface.

## Root Skill Inventory

The registry source of truth is `skills/registry.json`.

| Skill | Status | Action |
| --- | --- | --- |
| `aos-core-orientation` | installable | First compact installable root skill. Teaches direct `./aos` entry posture and points to help/manifests/docs instead of duplicating command syntax. |
| `aos-runtime-readiness` | installable | Teaches readiness/status/doctor gates before live runtime work. |
| `aos-saved-workspace` | installable | Supersedes broad `aos-agent-workspace` for compact saved snapshot/ref observe-act-recapture loops. |
| `aos-browser` | installable | Supersedes broad `browser-adapter` for durable AOS browser refs/proof and explicit upstream Playwright CLI escape hatches. |
| `aos-operator-annotations` | installable | Teaches pending annotation list/read/consume/link behavior and safe consume-once boundaries. |
| `aos-work-records` | installable | Teaches Work Record read/verify/status/recovery and report-only defaults. |
| `aos-recipes` | installable | Teaches source-backed recipe list/explain/dry-run/run and keeps `aos ops` as compatibility wording. |
| `aos-command-surface-maintenance` | installable | Teaches source manifest/help/docs/test synchronization for command-surface edits. |
| `agent-sync` | retired | Keep tombstone. Do not install or recreate native Codex custom-agent sync. |
| `aos-agent-workspace` | needs_split | Keep covered by validator as broad local background; superseded for installable guidance by `aos-saved-workspace`. |
| `browser-adapter` | needs_split | Keep covered by validator as broad local background; superseded for installable guidance by `aos-browser`. |
| `caveman` | retained_local | Local communication compression skill, outside the AOS installable skill product. |
| `issue-hygiene-sweep` | retained_local | Repo/GitHub audit helper, outside the AOS installable skill product. |
| `plan-retirement-audit` | retained_local | Repo docs audit helper, outside the AOS installable skill product. |
| `symphony-talent-design` | private_ignored | Private brand/design skill, not part of the AOS skill pack. |

## Competing Surface Inventory

| Surface | Action |
| --- | --- |
| `aos ops` wording | Retain only as compatibility alias for `aos recipe` until the ADR 0013 removal gate is satisfied. |
| Markdown guides that say `Use this recipe` | Clean up in a terminology pass when they are not executable `aos recipe` packages. |
| Wiki `workflow` page-kind/plugin labels | Clarify as wiki registry/page-kind behavior, not AOS Execution Model Workflow execution, unless a migration becomes feasible. |
| `skills/aos-agent-workspace` | Keep as current local skill but classify as `needs_split` for installable packaging. |
| `skills/browser-adapter` | Keep as current local skill but classify as `needs_split` and supersede with `aos-browser`. |
| Downstream repo-local AOS wrapper facades | Demote in downstream docs during M6. Direct `./aos` plus installed skills is the target onboarding path. |
| Playwright CLI skill content | External companion only. Do not vendor into AOS source. |

Inventory commands used for the M0 baseline:

```bash
find skills -maxdepth 3 -type f -print | sort
rg -n "aos-agent-workspace|browser-adapter|aos ops|# Recipe:|playbook|workflow" \
  --glob '!docs/archive/**' --glob '!memory/**' --glob '!_dev/**' --glob '!*.json'
```

## Consequences

- `skills/registry.json` is the root skill registry.
- `scripts/aos-skills-validate.mjs` is the focused M1 validator.
- `aos skills list/check/install` is the public skill package surface; install
  supports both bounded writes and `--dry-run` planning.
- Installable AOS skill work must update registry status, backing references,
  validator coverage, and the relevant durable docs together.
- Broad root skills may exist temporarily as `needs_split`, but final
  installable skills must stay concise or explicitly split detailed references
  out of `SKILL.md`.
- `aos skills` command forms must synchronize source manifests, generated
  manifests, help, docs, and tests.
- Playwright CLI companion integration remains external and non-vendored; AOS
  only reports runtime/install state and dry-run install intent in this ADR.

## Verification

Changes to this product boundary should run:

```bash
node scripts/aos-skills-validate.mjs --json
node --test tests/aos-skills-registry.test.mjs
node --test tests/aos-skills-command.test.mjs
git diff --check
```

Command-surface changes should also run the command-manifest and help gates
named by `./aos dev recommend --json --paths ...`.
