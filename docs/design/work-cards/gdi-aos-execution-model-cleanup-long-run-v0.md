# GDI Work Card: AOS Execution Model Cleanup Long Run V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/379
- Prior taxonomy PR: https://github.com/michaelblum/agent-os/pull/380
- Prior canonical ADR: `docs/adr/0013-aos-execution-model-v0.md`
- Prior work cards:
  - `docs/design/work-cards/gdi-aos-execution-model-taxonomy-v0.md`
  - `docs/design/work-cards/gdi-aos-execution-model-playbook-contract-correction-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, or prior implementation state. Read and rediscover before
editing.

## Branch / Base

- `branch_from`: `origin/main`
- `required_start_ref`: latest `origin/gdi/aos-execution-model-cleanup-long-run-v0`
- This branch starts with this work card only. Keep the implementation on this
  branch unless Foreman redirects.
- Make reversible checkpoint commits as each checkpoint lands. A single long
  run is expected, but do not save one unreviewable final mega-commit.

## Goal

Finish the execution-model cleanup that ADR-0013 intentionally left as follow-up
work. Make the repo's current contract simple and hard to misread:

```text
Primitive -> Block -> Recipe -> Workflow -> Run -> Work Record
```

Supporting concepts must stay outside that ladder unless they are executable
execution-model artifacts:

```text
Guide/SOP
Gate / Signal / Checkpoint
Evidence / Trace
Capability Package
Skill
Plugin
Work Card
Dock / Docked Session
GitHub label metadata
```

The outcome should remove the live `docs/guides/` ambiguity, define how Skills
and Plugins relate to the ladder, harden or rename the transitional Playbook
Step vocabulary, and model browser capture plus Employer Brand as downstream
projections rather than taxonomy sources.

## Read First

- `AGENTS.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `ARCHITECTURE.md`
- `README.md`
- `docs/adr/0013-aos-execution-model-v0.md`
- `docs/adr/0002-work-records-and-playbooks-are-distinct-artifacts.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/api/aos.md`
- `docs/api/README.md`
- `docs/guides/README.md`
- `.docks/skills/README.md`
- `.docks/foreman/skills/session-transfer/SKILL.md`
- `wiki-seed/plugins/customize-with-agent/SKILL.md`
- `wiki-seed/plugins/customize-with-agent/references/skill-writing-guide.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `shared/schemas/aos-playbook-step-v0.schema.json`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-work-record-v0.schema.json`
- `shared/schemas/aos-supervised-run-v0.md`
- `docs/design/browser-capture-ladder-projection.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `docs/design/employer-brand-comparative-audit-workflow.md` if present
- `wiki-seed/concepts/employer-brand-workflow-map.md`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
gh issue view 379 --repo michaelblum/agent-os --json number,title,state,url,body,labels,comments
./aos recipe list --json
./aos help recipe --json
./aos help ops --json
```

Then inventory current vocabulary with focused searches:

```bash
find docs/guides -maxdepth 1 -type f | sort
rg -n "docs/guides/|documentation-only Recipe|Markdown Recipe|aos ops|ops recipe|Recipe Ladder|recipe ladder" CONTEXT.md CONTEXT-MAP.md README.md ARCHITECTURE.md docs shared recipes packages tests manifests wiki-seed
rg -n "aos-playbook-step|aos.playbook_step|playbook-step|Playbook Step|Playbook step|playbook_step|origin.kind.*playbook|\"playbook\"" shared tests packages docs recipes manifests wiki-seed
rg -n "Skill|Plugin|Capability Package|workflow plugin|SKILL.md|\\.codex-plugin|plugin.json" CONTEXT.md CONTEXT-MAP.md docs .docks wiki-seed scripts packages
rg -n "browser capture|browser-capture|Browser capture|Employer Brand|employer-brand" CONTEXT.md CONTEXT-MAP.md docs shared wiki-seed packages tests
```

## Checkpoint Discipline

Use small, reversible commits. Suggested checkpoints:

1. Guide/SOP migration.
2. Capability Package / Skill / Plugin taxonomy.
3. Playbook Step hard-cutover or explicitly blocked rename with removal gate.
4. Browser capture ladder projection.
5. Employer Brand decomposition.
6. Guardrail tests and final stale-reference cleanup.

Each checkpoint should pass `git diff --check` before you continue. Push the
branch when the full long run is complete, or earlier if the run must stop.

## Required Behavior

### Checkpoint 1: Guide/SOP Migration

Make `docs/guides/` the canonical home for Markdown guidance that is not an
executable AOS Recipe.

Default target:

- Move the current role-neutral Markdown guidance out of `docs/guides/`.
- Prefer `docs/guides/` unless inspection finds an already-established better
  current path.
- Preserve useful file names when possible.
- Add or update `docs/guides/README.md` to define Guide/SOP scope.
- Update current docs, API references, context maps, ADR cross-references,
  active design notes, active work cards, manifests, and tests that refer to
  the moved files.
- Do not describe Markdown guidance as current Recipes.

Compatibility rule:

- Prefer no `docs/guides/` directory after the migration.
- If a temporary tombstone is truly needed, keep it to `docs/guides/README.md`
  only, include no reusable guidance content there, and state the exact removal
  gate. Treat that as a temporary compatibility exception, not the desired end
  state.
- Historical reports may preserve old paths only when the text is explicitly
  historical and not active guidance. If leaving one, make the reason obvious.

### Checkpoint 2: Capability Package / Skill / Plugin Taxonomy

Define packaging and activation concepts separately from the execution ladder.

Preferred contract:

- **Capability Package**: a distributable or activatable bundle that may contain
  guides, skills, plugins, commands, schemas, recipes, workflows, fixtures, UI,
  or evidence templates.
- **Skill**: agent-loadable guidance/capability instructions, usually a
  `SKILL.md` bundle. A Skill may guide or wrap execution, but it is not itself a
  Recipe, Workflow, Run, or Work Record.
- **Plugin**: installable or wiki/package capability extension. A Plugin may
  contain Skills and other assets. It is packaging, not an execution rung.
- **Guide/SOP**: repo-neutral human or agent guidance. It can be embedded in or
  referenced by a Skill or Plugin without becoming an executable Recipe.
- **Work Card**: coordination contract for a work slice. It can route work that
  creates or runs execution-model artifacts, but it is not itself a Workflow.
- **Dock / Docked Session**: persona/session isolation and routing context, not
  Workflow taxonomy.
- GitHub `area:`, `kind:`, `lane:` labels are governance/search metadata, not
  execution-model concepts.

Put this in an official place. Prefer a new ADR if the packaging taxonomy is
large enough; otherwise extend ADR-0013 with a clearly separate "Packaging and
Activation" section. Link it from `CONTEXT.md` and `CONTEXT-MAP.md`.

### Checkpoint 3: Playbook Step Hard-Cutover

Stop letting "Playbook Step" remain the live name for a transitional executable
descriptor if repo-owned callers can be updated in this run.

Default target:

- Rename the current `aos.playbook_step` schema/docs/fixtures/tests/runtime
  helpers to neutral Step Descriptor vocabulary.
- Preferred name: **AOS Step Descriptor V0**.
- Preferred JSON type: `aos.step_descriptor`.
- Preferred schema/file/fixture prefix: `aos-step-descriptor-v0`.
- Preferred ID prefix in fixtures: `step-descriptor:`.
- Rename helper/module/UI/test names away from Playbook Step where they are
  current repo-owned code, for example harness, workbench, capture bridge,
  prototype, fixture roots, and labels.
- Preserve behavior unless a test proves the old naming was coupled to a real
  external contract.

Work Record origin rule:

- Do not make Playbook the origin of a new execution-model Work Record unless
  you prove a live compatibility boundary requires it.
- Prefer migrating current fixtures and schemas away from `origin.kind:
  "playbook"` toward the correct current origin shape. If the correct origin is
  the gated harness or workflow rather than the descriptor, model that directly
  and cite the descriptor through `references[]`.
- If a `playbook` origin or JSON field must remain for compatibility, document
  the exact live consumer and removal gate in the same checkpoint. Do not leave
  it as an unexplained "future rename".

Hard boundary:

- Do not rename generic human guidance Playbooks into executable artifacts.
- Do not build a new workflow engine.
- Do not invent a second ladder term if Step Descriptor is sufficient.

### Checkpoint 4: Browser Capture Ladder Projection

Create or update a design note that models browser capture from first
principles on top of the execution model.

Required shape:

```text
target/app surface
-> control primitive
-> observation/capture/evidence block
-> reusable capture recipe
-> workflow orchestration with gates/retries
-> run
-> work record with evidence/trace
```

The note should identify existing relevant primitives, commands, recipes,
schema sketches, and toolkit/browser projection artifacts, but it should not
implement live website capture. Browser capture must be described as a
projection or capability family on top of AOS, not a taxonomy root.

### Checkpoint 5: Employer Brand Decomposition

Reclassify Employer Brand workflow art as downstream reference material and
extract its reusable constituents.

Required behavior:

- Update the current Employer Brand workflow map or add a companion note that
  says Employer Brand does not define the AOS Execution Model.
- Map current Employer Brand material into execution-model and packaging terms:
  guides, skills/plugins, possible recipes, possible workflows, runs/work
  records, evidence templates, schemas, fixtures, and UI/report artifacts.
- Keep current Employer Brand artifacts useful as reference material.
- Do not resume live Employer Brand capture, locator repair, report generation,
  export, or evidence mutation.
- Do not add Employer Brand-specific behavior to generic browser capture or
  toolkit layers.

### Checkpoint 6: Guardrails

Add deterministic guardrails so this taxonomy does not drift back into lore.

At minimum, add a focused test or script that catches current-doc regressions
for these cases:

- `docs/guides/` is not used as the current home for reusable guidance unless
  only an explicit tombstone remains.
- Markdown guidance is not called an executable Recipe.
- `aos ops` is not described as the canonical public surface.
- Playbook/Playbook Step is not described as the current executable substrate.
- Browser capture and Employer Brand are not described as taxonomy sources.
- Skills and Plugins are packaging/activation concepts, not execution ladder
  rungs.

Prefer a small Node test under `tests/` if the repo already has similar
contract tests; otherwise use the nearest established deterministic contract
test pattern. Keep allowlists tight and documented.

## Scope

Owned layer: docs, ADRs, context, schema docs, schema/test naming, small
repo-owned helper/module renames when needed to remove current vocabulary drift,
and deterministic contract tests.

Likely files and areas:

- `docs/adr/*.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `README.md`
- `ARCHITECTURE.md`
- `docs/api/*.md`
- `docs/guides/`
- `docs/guides/` only as a temporary tombstone if needed
- `shared/schemas/*step*`
- `shared/schemas/*work-record*`
- `packages/toolkit/workbench/*playbook*`
- `packages/toolkit/components/playbook-workbench/`
- `tests/**/*playbook*`
- `docs/design/browser-capture-ladder-projection.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `wiki-seed/concepts/employer-brand-workflow-map.md`
- `wiki-seed/plugins/*/SKILL.md` only when taxonomy links are wrong or missing

## Hard Boundaries

- Do not resume live browser capture.
- Do not open live websites for Employer Brand work.
- Do not mutate Employer Brand capture manifests, source evidence, data bundles,
  locator repair patches, report outputs, or export artifacts.
- Do not build a new workflow engine, scheduler, replay engine, or plugin
  runtime.
- Do not make Skills or Plugins execution ladder rungs.
- Do not rewrite unrelated historical work cards solely to sanitize old words.
  Update current guidance and active references; leave historical records only
  with an obvious historical reason.
- Do not keep compatibility aliases, old schema names, old paths, or old
  vocabulary without an explicit live consumer, release boundary, or removal
  gate.

## Verification

Run deterministic checks after each checkpoint as appropriate, and run the full
final set before reporting:

```bash
git diff --check
./aos recipe list --json
./aos recipe explain runtime/status-snapshot --json
./aos recipe dry-run canvas/window-level-smoke --json
./aos help recipe --json
./aos help ops --json
bash tests/help-contract.sh
bash tests/ops-contract.sh
node --test tests/schemas/aos-work-record-v0.test.mjs
```

If Step Descriptor / Playbook Step files, schemas, fixtures, or toolkit helpers
change, also run the focused renamed or still-existing tests that cover them,
including the schema test, Work Record capture tests, harness tests, browser
prototype tests, and workbench tests after rediscovering their exact names.

If you add a terminology guardrail test, run it directly with `node --test`.

If `./aos ready` is needed for any bounded live check and it reports a repo-mode
TCC/input-tap blocker, stop the live path and run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then report `human_needed`. This long-run card should be able to complete with
deterministic checks only.

## Completion Report

Return a concise report with:

- profile, branch, head SHA, base SHA;
- checkpoint commits and what each one changed;
- changed paths grouped by checkpoint;
- final taxonomy decisions, especially Guide/SOP, Capability Package, Skill,
  Plugin, Step Descriptor, browser capture, and Employer Brand;
- any retained compatibility names, exact live consumer, and removal gate;
- exact verification commands and pass/fail results;
- live AOS readiness result or why live checks were skipped;
- local-only state, untracked/generated artifacts, or unrelated dirty files;
- open GitHub issues, docs, schemas, or work cards that still contradict the
  model after this run;
- whether the branch was pushed and whether it is ready for Foreman review.
