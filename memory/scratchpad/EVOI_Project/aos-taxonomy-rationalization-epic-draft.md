# AOS Taxonomy Rationalization Epic Draft

## Context

This draft came out of a live AOS perception test where `./aos see target
--json` gave structured target data, and we intentionally avoided looking at
pixels unless explicitly requested. That test exposed a broader question: before
classifying the EVOI project, AOS needs clearer names and boundaries for command
surfaces, reusable scripts, bespoke scripts, procedures, instructions,
protocols, techniques, recipes, playbooks, plugins, skills, workflows, wiki
knowledge, and schemas.

This file is provisional scratchpad material. It is not canonical repo doctrine,
not a GitHub issue, and not an EVOI implementation plan. Its purpose is to keep
the planning work from being trapped in chat so a later session can reconcile it
with the repo and GitHub issues.

## 2026-04-30 Issue Recheck

Current GitHub status checked through the GitHub connector:

- #129 `Epic: Agent control surface molecules and workflows`: owns `aos ops`,
  source-backed operator recipes, and the source-vs-wiki executable boundary.
  It remains open, but the first two implementation slices have landed:
  `runtime/status-snapshot`, mutating `canvas/window-level-smoke`,
  `owned_resources`, cleanup, and ops contract tests.
- #134 `Audit agent instruction hygiene and progressive disclosure`: overlaps
  strongly with taxonomy cleanup and remains open. It is the best existing
  home for instruction hygiene work unless a new taxonomy epic adopts it as a
  child.
- #160 `Dev workflow router and manifest-backed command surface`: completed;
  treat `aos dev classify`, `aos dev recommend`, `aos dev surface`, and
  `docs/reference/aos-dev-workflow-rules.json` as landed infrastructure, not as
  new work to reopen.
- #162 `Organize test harness files by composition, scope, and scenario`:
  remains open and owns test harness folder taxonomy.
- #156/#158 `Research Intake`: overlaps with EVOI only around target
  acquisition, intake modes, and source-pack/wiki promotion boundaries. It
  should not own the broader AOS artifact taxonomy.
- #163 `AOS-owned UI semantic inspect contracts`: closed as completed in PR
  #173. Treat semantic targets from `aos see capture --canvas <id> --xray` as
  landed contract evidence.
- #165 `Epic: AOS app accessibility surface contract`: closed as completed with
  child issues #166-#169. Treat `docs/recipes/aos-app-accessibility-surfaces.md`
  and the semantic target helper as landed guidance.

Reconciliation plan: create one new coordination epic only if the user wants
GitHub artifacts before repo docs. Link #129, #134, #162, #156, and #158 as
related work, and reference #160, #163, and #165 as completed dependencies.
Do not duplicate #129 ops implementation, #160 dev-router implementation, #162
test harness organization, or #156/#158 research-intake implementation.

## Refined Taxonomy Shape

Use AOS vocabulary as the source of truth. The taxonomy should answer "what
kind of artifact is this, who consumes it, and what makes it durable?" rather
than importing another project's conventions.

Candidate top-level artifact classes:

| Class | Definition | Current homes | Notes |
| --- | --- | --- | --- |
| Primitive verb | Embodied AOS capability operated through the unified CLI and daemon. | `src/`, `ARCHITECTURE.md`, `docs/api/aos.md` | Canonical verbs remain `see`, `do`, `show`, `tell`, `listen`; `say` is sugar. |
| Command surface | Discoverable CLI command/form contract over primitives or operator layers. | command registry, `docs/api/aos.md`, `./aos help` | Includes `ready`, `status`, `ops`, `dev`, `wiki`, `inspect`, etc. |
| Source-backed operator recipe | Schema-backed executable operator unit that `aos ops` can list, explain, dry-run, and run. | `recipes/`, app/package `recipes/`, `shared/schemas/ops-*` | Executable behavior belongs in source, not only wiki prose. |
| Developer workflow rule | Manifest-backed recommendation for AOS developer actions after local changes. | `docs/reference/aos-dev-workflow-rules.json`, `shared/schemas/dev-workflow-rules.schema.json` | Recommends build/reload/test/ready paths; delegates runnable procedures to `ops` or tests. |
| Test harness artifact | Verification helper or scenario. | `tests/`, future `tests/lib/**`, `tests/scenarios/**` | #162 owns the folder taxonomy. |
| Instruction surface | Durable agent operating contract or local guidance. | `AGENTS.md`, subtree `AGENTS.md`, compatibility `CLAUDE.md` | Root stays compact; subtree files hold local detail. |
| Docs recipe | Reusable SOP or practice for humans/agents. | `docs/recipes/` | Prose guidance, not executable recipe. |
| Cross-tool contract | Consumer-facing API, schema, architecture, or shared packet contract. | `docs/api/`, `shared/schemas/`, `ARCHITECTURE.md` | Update when behavior crosses tools or consumers. |
| Runtime wiki knowledge | Runtime knowledge graph content and product/project memory. | `~/.config/aos/{mode}/wiki/`, `wiki-seed/` | Repo seed is rebuildable starter content; runtime wiki is first-class knowledge substrate. |
| Wiki plugin workflow | Runtime wiki workflow packaged as `SKILL.md` plus references/scripts. | `wiki-seed/plugins/**`, runtime wiki plugins | Distinct from local Codex skills and external skill suites. |
| App-local playbook | Product-specific operating guidance or domain knowledge for an app. | nearest app docs, app seed wiki namespace | May graduate to docs recipe, wiki plugin, or schema-backed surface only with explicit promotion rules. |
| Historical/compatibility surface | Retained old path, old provider filename, or legacy appendix. | `CLAUDE.md`, `_dev`, retired specs, legacy wiki content | Keep thin, marked, or scoped so agents do not treat it as live policy. |

Open naming collisions to settle:

- `recipe`: qualify as `ops recipe` for executable manifests and `docs recipe`
  for prose SOPs.
- `plugin`: qualify as `wiki plugin`, Codex/plugin app, or external skill suite
  when ambiguity matters.
- `skill`: reserve `agent skill` for portable agent instructions and `SKILL.md`
  inside `wiki plugin` when discussing the wiki bundle format.
- `workflow`: qualify as `developer workflow rule`, `wiki plugin workflow`,
  `ops recipe composition`, or product workflow.
- `playbook`: keep app-local/provisional until AOS deliberately defines a wiki
  playbook type.

## Epic Draft

Title: `Epic: AOS surface taxonomy and artifact rationalization`

Body:

```md
## Problem

AOS now has multiple agent-facing artifact types: primitive verbs, CLI command
surfaces, source-backed ops recipes, developer workflow rules, docs recipes,
test harness artifacts, app-local playbooks, wiki plugins, agent skills,
runtime wiki pages, schemas, protocols, API docs, and compatibility files.
These grew organically and now overlap in naming, placement, and purpose.

Before new work like EVOI is classified or promoted, AOS needs a clear taxonomy
and migration map so agents can tell whether an artifact is executable,
instructional, retrievable, schema-backed, app-local, runtime-owned, or
historical.

## Goal

Define and apply a compact AOS artifact taxonomy that makes the command surface,
docs, wiki, recipes, scripts, tests, skills, plugins, playbooks, schemas, and
workflow rules easier to classify and maintain.

## Non-goals

- Do not implement EVOI behavior in this epic.
- Do not rewrite all existing docs or move every file.
- Do not collapse runtime wiki, repo docs, and executable source manifests into
  one surface.
- Do not duplicate #129 operator-layer implementation work.
- Do not reopen completed #160, #163, or #165 implementation scope unless new
  evidence identifies a specific remaining gap.

## Child Issues

- [ ] Define canonical AOS artifact taxonomy and classification questions.
- [ ] Reconcile instruction and documentation surfaces.
- [ ] Classify executable and verification surfaces.
- [ ] Define runtime wiki, wiki plugin, and app-local playbook boundaries.
- [ ] Gate EVOI placement with a decision memo after taxonomy lands.

## Related Work

- #129 Agent control surface molecules and workflows
- #134 Audit agent instruction hygiene and progressive disclosure
- #162 Test harness file organization
- #156/#158 Research intake and capture modes
- #160 Dev workflow router and manifest-backed command surface (completed)
- #163/#165 Semantic inspect and app accessibility contracts (completed)

## Exit Criteria

- A canonical taxonomy doc exists, likely `docs/api/aos-taxonomy.md`, and is
  linked from the minimum required source-of-truth surfaces.
- Each major artifact type has a clear definition, source of truth, runtime
  behavior, and examples.
- Known naming collisions have recommended qualifiers or renames.
- Stale/high-risk docs are identified with a migration or deprecation path.
- EVOI has a clear next classification target, but remains unimplemented until
  explicitly started.
```

## Child Issue Drafts

### 1. Define canonical AOS artifact taxonomy and classification questions

```md
## Scope

Create `docs/api/aos-taxonomy.md` or an equivalent canonical taxonomy doc after
approval. Start from live AOS vocabulary and define the classification questions
agents should answer before creating or moving an artifact.

Cover:

- primitive verbs and command surfaces
- source-backed ops recipes
- developer workflow rules
- tests, harness helpers, and scenarios
- docs recipes and instruction surfaces
- runtime wiki entities, concepts, and plugins
- app-local playbooks and app seed wiki docs
- agent skills and external plugin concepts
- protocols, schemas, API docs, and architecture docs
- historical and compatibility surfaces

## Deliverables

- `docs/api/aos-taxonomy.md`
- table: artifact type -> definition -> source of truth -> executable? ->
  indexed at runtime? -> consumer -> examples
- classification checklist for new artifacts
- glossary of qualifier rules for overloaded terms: recipe, plugin, skill,
  workflow, playbook

## Acceptance

Future agents can classify a new artifact without guessing whether it belongs in
docs, source, wiki, recipes, tests, skills, schemas, or app-local guidance.
```

### 2. Reconcile instruction and documentation surfaces

```md
## Scope

Refine current guidance surfaces without turning them into manuals. This is the
taxonomy implementation path for #134.

Inputs:

- `AGENTS.md`
- subtree `AGENTS.md` / `CLAUDE.md`
- `docs/recipes/`
- `docs/api/`
- app-local playbooks and seed wiki docs
- `wiki-seed/plugins/*/SKILL.md`
- local agent skills if present

## Relationship To #134

This issue either becomes the concrete implementation child for #134 or, if
broader taxonomy work fully subsumes #134, #134 should be updated/closed with a
pointer.

## Acceptance

- Bare terms like "recipe", "plugin", "skill", and "workflow" are qualified
  where ambiguity matters.
- Stale command shapes are removed, corrected, or moved to proper reference
  docs. Example risk found during recheck: `src/CLAUDE.md` still leads with
  raw `bash build.sh` despite root guidance preferring `./aos dev build`.
- Root guidance remains compact and provider-neutral.
```

### 3. Classify executable and verification surfaces

```md
## Scope

Separate executable artifacts from prose guidance.

Cover:

- `aos help` / command registry
- `recipes/*.json`
- reusable shell/node scripts
- bespoke scripts
- `tests/lib`, `tests/scenarios`, schema tests
- `docs/reference/aos-dev-workflow-rules.json`
- `./aos dev classify`, `./aos dev recommend`, and `./aos dev surface`

## Related

- #129 owns `aos ops` implementation.
- #160 is completed and should be treated as existing infrastructure.
- #162 owns test harness folder taxonomy.

## Acceptance

AOS has clear rules for when something becomes an ops recipe, test helper, app
script, developer workflow rule, docs recipe, or one-off local command.
```

### 4. Define runtime wiki, plugin, and playbook boundaries

```md
## Scope

Clarify the runtime knowledge layer.

Decide:

- whether `playbook` should become a first-class wiki type
- how wiki plugins relate to portable `SKILL.md` agent skills
- what belongs in `wiki-seed/` vs repo docs vs runtime-only wiki
- what belongs in app seed wiki namespaces such as `apps/sigil/seed/wiki/sigil/`
- what metadata is required for retrieval if playbooks become real

## Acceptance

- `wiki plugin` and `agent skill` are distinct terms.
- `wiki entity`, `wiki concept`, and `wiki plugin workflow` remain aligned with
  what `aos wiki reindex`, `list`, `graph`, `search`, and `invoke` actually
  index.
- Playbook remains app-local prose or gets a deliberate schema/directory
  convention.
- Runtime wiki promotion rules are documented.
```

### 5. EVOI placement decision memo

```md
## Scope

Do not implement EVOI yet. Use the taxonomy output to classify
`memory/scratchpad/EVOI_Project/playbook_prototype.md`.

Evaluate candidate homes:

- docs recipe
- wiki playbook
- portable agent skill
- Sigil operating mode
- schema-backed run-control policy
- ops recipe, only if deterministic and executable

## Acceptance

A short decision memo states what EVOI is, what it is not, which artifact type
should host v0, and what prerequisites must land before implementation.
```

## GitHub Coordination Plan After `docs/api/aos-taxonomy.md`

`docs/api/aos-taxonomy.md` now exists and is linked from `docs/api/README.md`,
root `AGENTS.md`, and `ARCHITECTURE.md`. The next GitHub move should avoid
creating a duplicate governance epic unless the user explicitly wants one. The
existing issues already cover most implementation lanes:

- #134 can own the instruction/documentation reconciliation pass.
- #129 can keep owning `aos ops`, source-backed operator recipes, and the
  executable source-vs-wiki boundary.
- #162 can keep owning test harness file organization.
- #156/#158 can keep owning research-intake source packs, target acquisition,
  and wiki promotion rules for intake artifacts.
- #160, #163, and #165 should be referenced only as completed dependencies.

Recommended issue action, if approved:

1. Add a top-level comment to #134:
   - link `docs/api/aos-taxonomy.md`
   - state that #134 should use the taxonomy as the audit vocabulary
   - call out initial audit targets: compatibility `CLAUDE.md` files, stale
     build guidance in `src/CLAUDE.md`, overloaded terms in docs/wiki/plugin
     guidance, and minimal root-doc links
   - avoid closing #134 until the audit pass actually lands
2. Add a small comment to #129:
   - link the taxonomy doc
   - clarify the naming split: `ops recipe` for executable manifests,
     `docs recipe` for prose SOPs, and `wiki plugin workflow` for runtime wiki
     workflow bundles
   - note that #129 should keep owning executable ops behavior rather than
     broader artifact taxonomy
3. Add a small comment to #162:
   - link the taxonomy doc
   - clarify that tests are classified as `test harness artifacts`
   - keep folder migration incremental and under #162
4. Do not comment on #156/#158 yet unless work starts on the EVOI placement
   decision memo or research-intake boundaries need an immediate taxonomy
   pointer.
5. Do not reopen or comment on #160/#163/#165 unless a concrete residual gap is
   found.

Alternative issue action:

- Create a new epic `Epic: AOS artifact taxonomy and rationalization` only if
  the user wants a separate umbrella for taxonomy follow-through. If created,
  keep it thin and make #134/#129/#162/#156/#158 related work rather than
  duplicating their scopes.

Recommended next approval prompt:

```text
Proceed with the lightweight GitHub coordination comments on #134, #129, and
#162, using `docs/api/aos-taxonomy.md` as the source of truth. Do not create a
new epic yet.
```

Posted 2026-04-30:

- #134 taxonomy audit vocabulary comment:
  https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356077348
- #129 ops/docs/wiki recipe naming split comment:
  https://github.com/michaelblum/agent-os/issues/129#issuecomment-4356077345
- #162 test harness artifact comment:
  https://github.com/michaelblum/agent-os/issues/162#issuecomment-4356077341

Follow-through in this doc-first pass:

- Added `docs/api/aos-taxonomy.md`.
- Linked it from `docs/api/README.md`, `AGENTS.md`, and `ARCHITECTURE.md`.
- Started the #134 audit pass by updating `src/CLAUDE.md` to lead with
  `./aos dev build --no-restart` and scope raw `bash build.sh` /
  `scripts/aos-after-build` as lower-level build-surface details.
- Continued the #134 audit pass by making tracked `CLAUDE.md` files
  compatibility pointers and moving local guidance into provider-neutral
  `AGENTS.md` files for `src/`, `src/browser/`, `packages/gateway/`, and
  `packages/toolkit/`. Root `AGENTS.md` now states that historical
  `CLAUDE.md` files are compatibility pointers, not local doctrine.
- Added `docs/design/README.md` and updated root/API/GitHub coordination docs
  so new provider-neutral AOS plans, specs, notes, and supporting design
  artifacts start under `docs/design/`. `docs/superpowers/` is now classified
  as legacy Superpowers-origin design history, not required orchestration for
  new AOS work.
- Posted #134 progress update for the provider-neutral guidance migration and
  `docs/design/` classification:
  https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356317440
- Trimmed migrated local guidance so it stays contract-oriented rather than
  becoming command reference:
  - `src/AGENTS.md` now points CLI details to `docs/api/aos.md` and keeps local
    build/readiness/source-map/command-contract rules.
  - `packages/toolkit/AGENTS.md` now keeps layer, placement, styling,
    accessibility, and verification boundaries while pointing API details to
    `docs/api/toolkit.md`.
  - `packages/gateway/AGENTS.md` now keeps adapter responsibilities, local
    workflow, and state boundaries while pointing consumer contracts to
    `docs/api/integration-broker.md`.
- Posted #134 follow-up for the local guidance trim:
  https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356337075

## Starter Prompt For Next Session

```text
We are in /Users/Michael/Code/agent-os on the existing branch
codex/sigil-aos-surfaces. Stay on this branch for now. The worktree may already
contain unrelated dirty changes. Do not reset, clean, move, commit, or edit
unrelated files without asking.

Continue AOS taxonomy and artifact rationalization follow-through.

Context:
- AOS must be sorted before EVOI is classified.
- Do not implement EVOI yet.
- Do not inspect pixels from the earlier mouse-target image/test unless
  explicitly asked.
- Preserve AOS vocabulary and provider-neutral framing.
- `AGENTS.md` is the canonical repo-wide agent contract. Tracked `CLAUDE.md`
  files are compatibility pointers only, not separate doctrine.
- External Matt Pocock skills, if useful, are review lenses only. Do not install
  them or impose their conventions on AOS.
- Current taxonomy scratchpad:
  `memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md`.

Completed in the prior pass:
- Added `docs/api/aos-taxonomy.md` and linked it from `docs/api/README.md`,
  `AGENTS.md`, and `ARCHITECTURE.md`.
- Added `docs/design/README.md` and updated repo docs so `docs/design/` is the
  provider-neutral home for new AOS plans, specs, notes, and supporting design
  artifacts. `docs/superpowers/` is classified as legacy Superpowers-origin
  design history.
- Migrated local guidance from tracked subtree `CLAUDE.md` files into
  provider-neutral `AGENTS.md` files for `src/`, `src/browser/`,
  `packages/gateway/`, and `packages/toolkit/`.
- Trimmed those local `AGENTS.md` files so they stay contract-oriented and point
  detailed API/command reference to the right durable docs.
- Updated `apps/sigil/AGENTS.md` only to replace a provider-specific API-client
  phrase with provider-neutral wording.
- Posted GitHub coordination comments:
  - #134 taxonomy audit vocabulary:
    https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356077348
  - #129 ops/docs/wiki recipe naming split:
    https://github.com/michaelblum/agent-os/issues/129#issuecomment-4356077345
  - #162 test harness artifact classification:
    https://github.com/michaelblum/agent-os/issues/162#issuecomment-4356077341
  - #134 provider-neutral guidance migration and `docs/design/` classification:
    https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356317440
  - #134 local guidance trim:
    https://github.com/michaelblum/agent-os/issues/134#issuecomment-4356337075

Issue ownership after recheck:
- #129 remains open and owns `aos ops`, source-backed operator recipes, and the
  executable source-vs-wiki boundary.
- #134 remains open and owns instruction/documentation hygiene. Do not close it
  yet; the Sigil local guidance audit is still pending.
- #156/#158 remain open and research-intake adjacent.
- #162 remains open and owns test harness taxonomy/folder migration.
- #160, #163, and #165 are closed/completed dependencies.

Known dirty-worktree boundaries:
- `docs/api/aos.md` was already dirty from unrelated work; do not touch it unless
  the user explicitly asks.
- Sigil/display/runtime files and model assets are dirty from unrelated work; do
  not touch them unless the user explicitly asks.
- Do not commit or stage changes without explicit approval.

Recommended next step:
1. Audit `apps/sigil/AGENTS.md` for local guidance bloat and source-of-truth
   drift. Keep Sigil-specific contracts in that file, but move or point command,
   API, and long-form product details to the appropriate durable docs.
2. Run `git diff --check` and a focused provider-specific wording scan over the
   files touched by that pass.
3. Post or prepare a concise #134 progress note only after the Sigil audit lands.

Stop for the user only if the Sigil audit exposes a real source-of-truth
trade-off, if GitHub issue edits are needed, or at a natural progress milestone.
```
