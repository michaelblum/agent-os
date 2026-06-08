# Implementer Correction Card: AOS Execution Model Playbook Contract Cleanup V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/379
- PR under review: https://github.com/michaelblum/agent-os/pull/380
- Review finding: https://github.com/michaelblum/agent-os/pull/380#issuecomment-4559731106

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, or prior implementation state. Read and rediscover before
editing.

## Branch / Base

- `branch_from`: `origin/implementer/aos-execution-model-taxonomy-v0`
- `required_start_ref`: latest `origin/implementer/aos-execution-model-taxonomy-v0`
- Keep the correction on the existing PR branch.

## Goal

Remove the remaining official-doc contradiction where Playbook/Playbook Step is
still described as executable or replayable substrate after ADR-0013 reclassifies
Playbook as guidance and marks `aos.playbook_step` as a transitional V0 step
descriptor sketch.

The correction should make the repo tell one story:

- `Recipe` is the executable source-backed procedure layer.
- `Workflow` owns orchestration.
- `Run` is the execution instance.
- `Work Record` is the durable receipt.
- `Guide / Playbook` is method guidance.
- Existing `aos.playbook_step` schema/docs remain a transitional compatibility
  sketch for one gated step descriptor and evidence bridge, not a current
  instruction to build execution around Playbooks.

## Read First

- `docs/adr/0013-aos-execution-model-v0.md`
- `docs/adr/0002-work-records-and-playbooks-are-distinct-artifacts.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `CONTEXT.md`
- `shared/schemas/aos-playbook-step-v0.md`
- `shared/schemas/aos-supervised-run-v0.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-work-record-v0.schema.json`
- `shared/schemas/aos-supervised-run-v0.schema.json`
- `shared/schemas/aos-playbook-step-v0.schema.json`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=5
gh pr view 380 --repo michaelblum/agent-os --json number,title,state,url,headRefName,baseRefName,comments
```

Then search:

```bash
rg -n "reusable execution knowledge|Running a Playbook|run a Playbook|running a Playbook|Playbook step|Playbook Step|future Playbook|Playbook producers|Playbooks remain reusable execution|primary executable substrate" CONTEXT.md docs/adr shared/schemas
```

## Required Behavior

Resolve the review finding without broad renames:

- Update ADR-0002 so its still-active Work Record distinction no longer defines
  Playbook as a named replayable executable plan or says "Running a Playbook"
  emits a Work Record. Preserve the Work Record vs reusable/guidance distinction.
- Update `CONTEXT.md` flagged ambiguities that still refer to Playbook steps as
  executable step sequences or run-wide outcome producers. Use transitional
  step descriptor, gated harness, Workflow-gated run, or Work Record vocabulary
  where appropriate.
- Update `shared/schemas/aos-playbook-step-v0.md` to carry an explicit
  ADR-0013 supersession/transition note and avoid presenting Playbook Step as
  the preferred current executable substrate.
- Update `shared/schemas/aos-supervised-run-v0.md` and
  `shared/schemas/aos-work-record-v0.md` where they still say Playbook Steps or
  Playbook producers are reusable execution knowledge. Preserve existing schema
  IDs and fixture compatibility; clarify they are transitional compatibility
  producers/bridges until a future Block/Step/Harness rename.
- If `origin.kind: "playbook"` remains because the current schemas require or
  allow it, describe it as v0 compatibility, not new taxonomy direction.

## Hard Boundaries

- Do not rename schema IDs, fixture filenames, command names, environment
  variables, package paths, or JSON `type` values in this correction.
- Do not build or change runtime behavior.
- Do not implement browser capture, Employer Brand capture, replay, repair, or
  workflow engines.
- Do not rewrite historical reports or unrelated work cards.

## Verification

Run:

```bash
git diff --check
rg -n "reusable execution knowledge|Running a Playbook|run a Playbook|running a Playbook|Playbooks remain reusable execution" CONTEXT.md docs/adr shared/schemas
node --test tests/schemas/aos-work-record-v0.test.mjs
```

If schema docs are the only files changed, full recipe runtime tests are not
required for this correction. If JSON schemas or fixtures change, run the
focused schema tests for those changed contracts.

## Completion Report

Return:

- changed paths;
- exact wording strategy for the Playbook/Playbook Step transition;
- remaining intentional `playbook` terms and why they are compatibility-safe;
- verification commands and results;
- any follow-up needed for a future schema/type rename.
