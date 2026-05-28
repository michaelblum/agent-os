# AOS Execution Model V0

**Status:** Accepted
**Date:** 2026-05-27

## Decision

AOS uses **AOS Execution Model** as the canonical name for the execution
taxonomy that connects raw primitives, executable procedures, orchestration,
run receipts, and guidance material. "Execution ladder" may be used as
shorthand, but it is not the contract name.

The V0 model is:

1. **Primitive** - one raw AOS capability or action, such as `ready`, `status`,
   `see`, `do`, `show`, `tell`, `listen`, or `gate`.
2. **Block** - one typed executable procedure step. Current block kinds include
   `aos_command`, repo-owned `shell`, `assert`, and `cleanup`; `gate`,
   `signal`, `condition`, `loop`, and `recipe_call` are reserved until
   orchestration work needs them.
3. **Recipe** - a bounded, reusable, dry-runnable executable procedure made of
   blocks and discovered through `aos recipe`.
4. **Workflow** - orchestration across recipes, agents, gates, retries,
   branches, human decisions, and evidence.
5. **Run** - one execution instance of ad-hoc work, a recipe, a workflow, or a
   gated harness.
6. **Work Record** - the durable receipt/proof for one run, including intent,
   repairable execution map, claims, postconditions, evidence, verifier output,
   and health.
7. **Evidence / Trace** - proof material emitted by runs and referenced by Work
   Records. Evidence is active contract vocabulary. A general AOS trace schema
   is reserved until implemented; do not imply that trace capture is available
   beyond existing evidence records and local diagnostic traces.
8. **Gate / Signal / Checkpoint** - explicit control points for uncertainty,
   human approval, retry, branching, lifecycle state, or handoff.
9. **Guide / Playbook** - method guidance that shapes human or agent judgment
   but does not itself execute as the primary substrate.

## Naming Contract

`Recipe` now means source-backed executable procedure. Markdown Guides/SOPs
live under `docs/guides/`; they may guide a run, but they are not executable
Recipes and are not Work Record origins.

`aos recipe` is the canonical public command surface. `aos ops` remains only as
a compatibility alias for the current implementation. The removal gate for the
alias is: no repo docs, scripts, generated indexes, packaged resources, tests,
or known external callers require the old noun. Internal filenames and schema
IDs that still contain `ops` are compatibility names, not public taxonomy.

The existing `aos.playbook_step` schema remains a transitional V0 sketch for
one gated step descriptor. Its name is not precedent for making Playbook the
primary executable substrate; a future schema rename may align it with Block,
Step, or Harness vocabulary once producers harden.

## Packaging And Activation

Packaging and activation concepts sit outside the execution ladder unless a
contained artifact is itself executable:

- **Capability Package** - a distributable or activatable bundle that may
  contain Guides/SOPs, Skills, Plugins, commands, schemas, Recipes, Workflows,
  fixtures, UI, or evidence templates.
- **Skill** - agent-loadable guidance/capability instructions, usually a
  `SKILL.md` bundle. A Skill may guide or wrap execution, but it is not itself
  a Recipe, Workflow, Run, or Work Record.
- **Plugin** - an installable or wiki/package capability extension. A Plugin
  may contain Skills and other assets. It is packaging, not an execution rung.
- **Guide/SOP** - repo-neutral human or agent guidance. It can be embedded in
  or referenced by a Skill or Plugin without becoming an executable Recipe.
- **Work Card** - a coordination contract for a work slice. It can route work
  that creates or runs execution-model artifacts, but it is not itself a
  Workflow.
- **Dock / Docked Session** - persona/session isolation and routing context,
  not Workflow taxonomy.
- GitHub `area:`, `kind:`, and `lane:` labels are governance/search metadata,
  not execution-model concepts.

## Capture And Employer Brand Boundary

Browser capture and Employer Brand artifacts are reference material and
downstream projections, not the source of truth for the execution model.
Capture-oriented work should map onto the platform stack:

```text
target control primitive -> capture/evidence block -> reusable capture recipe -> workflow orchestration -> run -> work record + evidence
```

This ADR does not implement browser capture workflows, Employer Brand
collection, replay, repair, export, or schema migration. Those need separate
Workflow-gated slices.

## Consequences

- `CONTEXT.md`, `docs/api/aos.md`, `ARCHITECTURE.md`, schemas, and recipe
  manifests should describe current executable procedures as `aos recipe`.
- Historical reports may retain older `aos ops`, "ops recipe", and "recipe
  ladder" language when they are clearly historical; add supersession pointers
  only when needed to avoid current confusion.
- Work Records use executable origins (`recipe`, `workflow`, `playbook` only
  where the existing schema says so) and cite transitional Markdown guides in
  `references[]` with `relationship: "guided_by"`.
- Future work should split schema/file renames, capture ladder specialization,
  and GitHub issue body cleanup into exact follow-up cards instead of broad
  opportunistic rewrites.
