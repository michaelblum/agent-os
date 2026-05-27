# GDI Work Card: AOS Execution Model Taxonomy V0

## Tracker

- GitHub epic: https://github.com/michaelblum/agent-os/issues/379
- Supersedes public-naming portions of: https://github.com/michaelblum/agent-os/issues/129
- Aligns affected planning in: https://github.com/michaelblum/agent-os/issues/140, https://github.com/michaelblum/agent-os/issues/149, https://github.com/michaelblum/agent-os/issues/158

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Branch / Base

- `branch_from`: `origin/main`
- `required_start_ref`: local branch `gdi/aos-execution-model-taxonomy-v0`
- This branch starts with this work card only. Keep implementation commits on this branch unless Foreman redirects.

## Goal

Make AOS Execution Model V0 an official, discoverable repo contract and clean the current documentation contradictions around Recipe, `aos recipe`, `aos ops`, Workflow, Playbook/Guide, Run, Work Record, evidence/trace, and gates/signals/checkpoints.

This is a taxonomy and contract-alignment slice. The goal is not to build new workflow engines, browser capture, Employer Brand automation, or schema migrations beyond what is needed to make the current repo language coherent.

## Read First

- `AGENTS.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `README.md`
- `ARCHITECTURE.md`
- `docs/api/aos.md`
- `docs/adr/0002-work-records-and-playbooks-are-distinct-artifacts.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/recipes/README.md`
- `shared/schemas/ops-recipe.schema.json`
- `shared/schemas/ops-result.schema.json`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `shared/schemas/aos-supervised-run-v0.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `wiki-seed/concepts/employer-brand-workflow-map.md`
- `recipes/canvas/window-level-smoke.json`
- `docs/dev/reports/recipe-ladder-foundation-v0.md`
- `docs/dev/reports/sigil-experience-boundary-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
gh issue view 379 --repo michaelblum/agent-os --json number,title,state,url,body,labels
gh issue view 129 --repo michaelblum/agent-os --json number,title,state,url,body,labels
gh issue view 140 --repo michaelblum/agent-os --json number,title,state,url,body,labels
```

Then audit current stale terms with focused searches. Start with:

```bash
rg -n "aos ops|ops recipes|ops recipe|Recipe Ladder|recipe ladder|documentation-only Recipes|docs/recipes|Playbook Step|workflow engine|browser capture|browser-capture|Employer Brand" CONTEXT.md CONTEXT-MAP.md README.md ARCHITECTURE.md docs shared recipes wiki-seed
```

## Required Behavior

### Canonical Contract

Create or update an official source that defines **AOS Execution Model V0**. Prefer a new ADR if that matches the existing ADR style after inspection.

The official contract should define:

- Primitive: one raw AOS capability/action.
- Block: one typed executable procedure step, such as `aos_command`, repo-owned `shell`, `assert`, `cleanup`, and future `gate`, `signal`, `condition`, `loop`, or `recipe_call`.
- Recipe: bounded, reusable, dry-runnable executable procedure made of blocks.
- Workflow: orchestration across recipes, agents, gates, retries, branches, human decisions, and evidence.
- Run: one execution instance.
- Work Record: durable receipt/proof of what happened.
- Evidence / Trace: proof material emitted by runs and work records; if trace is not yet implemented, mark it as planned or reserved, not active contract.
- Gate / Signal / Checkpoint: explicit control points for uncertainty, human approval, retry, branching, or lifecycle state.
- Guide / Playbook: method guidance that shapes judgment but does not itself execute.

Use **AOS Execution Model** as the formal term. It is fine to mention “execution ladder” as shorthand, but do not make that the canonical contract name.

### Recipe Ambiguity

Make the repo language stop treating documentation-only guidance and executable procedures as the same current concept.

Preferred direction:

- `Recipe` means executable source-backed procedure.
- Existing Markdown under `docs/recipes/` is transitional guidance/playbook material until it is rehomed or renamed.
- If the slice does not rename `docs/recipes/`, document the short-lived transition and create a follow-up work card or TODO entry with clear owner/scope.

### `aos recipe` / `aos ops`

Make current repo-owned docs say `aos recipe` is canonical. `aos ops` may remain only as a compatibility alias when describing current implementation, and any retained alias must include a removal gate.

At minimum audit and align:

- `CONTEXT.md`
- `docs/api/aos.md`
- `ARCHITECTURE.md`
- `docs/recipes/README.md`
- `recipes/canvas/window-level-smoke.json`
- current issue/work-card references only when they are current guidance rather than historical records.

Do not rewrite historical reports just to sanitize old words. If a report is historical, leave it or add a small supersession pointer only where it prevents current confusion.

### Capture / Employer Brand Boundary

Add explicit guidance that browser capture and Employer Brand artifacts are reference material or downstream projections, not the source of truth for the execution model.

The first-principles stack should be expressible as:

```text
target control primitive -> capture/evidence block -> reusable capture recipe -> workflow orchestration -> run -> work record + evidence
```

Do not implement that stack in this slice.

### Related Issue Alignment

Do not edit GitHub issues unless Foreman explicitly asks during the round. The epic and cross-link comments already exist. If you find another open issue that directly contradicts the taxonomy, report it in the completion note with the exact issue number and recommended comment/update.

## Scope

Owned layer: schema/API/docs/governance alignment.

Likely files:

- `docs/adr/*.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/api/aos.md`
- `ARCHITECTURE.md`
- `docs/recipes/README.md`
- `recipes/canvas/window-level-smoke.json`
- narrowly related schema docs only if terminology can be clarified without a breaking schema migration.

## Hard Boundaries

- Do not build browser-capture workflows.
- Do not resume Employer Brand capture, locator, report, export, or repair work.
- Do not rename `docs/recipes/` in this slice unless the existing docs make it clearly tiny and low-risk after inspection.
- Do not break `./aos ops` unless the implementation and tests prove all repo-owned callers have migrated and the compatibility alias has no live reason to remain.
- Do not rename schema IDs or environment variables in this slice unless the change is small, fully tested, and needed for the docs contract. Prefer follow-up cards for breaking schema/API migrations.
- Do not alter unrelated historical work cards.

## Verification

Run deterministic checks:

```bash
git diff --check
./aos recipe list --json
./aos recipe explain runtime/status-snapshot --json
./aos recipe dry-run canvas/window-level-smoke --json
./aos help recipe --json
./aos help ops --json
```

If implementation or schema files are changed, also run the focused tests that cover them. Start with:

```bash
bash tests/ops-contract.sh
```

If live readiness becomes relevant and `./aos ready` reports a repo-mode TCC/input-tap blocker, stop the live path and run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

This docs-first slice should not require live browser, canvas, or Employer Brand checks.

## Completion Report

Return a concise report with:

- changed paths;
- the official place where AOS Execution Model V0 is now defined;
- how Recipe ambiguity was resolved or what transition remains;
- stale `aos ops` / `docs/recipes` references fixed and any intentionally retained;
- exact verification commands and pass/fail results;
- any additional open issues found that still contradict the model;
- follow-up work cards recommended for schema rename, directory migration, capture ladder, or issue body cleanup.
