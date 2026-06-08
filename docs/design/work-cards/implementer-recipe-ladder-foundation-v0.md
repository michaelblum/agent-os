# Work Card: Implementer Recipe Ladder Foundation V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: make source-backed recipes the executable composition ladder
  for repeated AOS command sequences, starting with Sigil startup and runtime
  cleanup, while collapsing confusing or under-used terminology and
  implementation that no longer earns its keep.
- Source artifact: Foreman/user planning on 2026-05-26 after PR #378 command
  surface extraction, especially the decision that reusable executable
  sequences should become the bridge from "start Sigil" to workflow-scale runs.
- Branch/output expectation: create or reuse
  `implementer/recipe-ladder-foundation-v0` from the required start ref. Commit and push
  the Implementer branch when verification passes. Do not open or merge a PR; Foreman
  will review and decide how this relates to PR #378.
- Stop conditions: complete, failed, manual_intervention, or product-direction blocker.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`

This work card exists on the feature branch. Do not reset to `origin/main` and
lose the instructions.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, prior implementation state, or live Sigil state. Read and
rediscover before editing.

## Goal

Make **recipe** the executable composition unit for reusable AOS sequences.

The design ladder should be:

- primitive: one raw AOS capability, such as `show create`, `ready`, or
  `service restart`;
- recipe block: one typed step inside a recipe, such as `aos_command`,
  repo-owned `shell`, `recipe_call`, `assert`, `cleanup`, and documented future
  `signal`, `gate`, `condition`, or `loop` blocks;
- recipe: parameterized, dry-runnable, executable composition of blocks;
- workflow: durable orchestration over recipes, agent goals, gates, retries, and
  evidence;
- playbook: method/guidance, not the primary execution substrate;
- work record: receipt of a real run.

The first concrete proof should make common Sigil/runtime startup chores
discoverable and reusable without requiring a human to remember a pile of
commands or scattered launch scripts.

## Product Direction

Favor the clean ladder over tradition. If old tests, scripts, docs, names, or
fixtures only preserve an implementation shape that becomes obsolete after this
coalesces, retire or rewrite them. Do not preserve aliases, shims, or stale
vocabulary unless there is an explicit external contract, release boundary, or
live consumer that cannot be moved in this round. When compatibility is kept,
write down the removal gate.

Employer Brand audit/report code should be treated as domain knowledge + data +
process + design that can later run on the recipe/workflow ladder. Do not keep
domain scripts solely because they predate the ladder. Do not port the whole
Employer Brand stack in this slice; classify the residue and convert only a
small, high-signal example if it naturally falls out of the recipe work.

## Read First

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `docs/adr/0009-recipe-playbook-workflow-as-three-distinct-artifacts.md`
- `docs/adr/0002-work-records-and-playbooks-are-distinct-artifacts.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/api/aos.md`, especially the `aos ops` section
- `docs/archive/superpowers/specs/2026-04-26-agent-control-surface-molecules-design.md`
- `scripts/aos-ops.mjs`
- `shared/schemas/ops-recipe.schema.json`
- `shared/schemas/ops-result.schema.json`
- `recipes/runtime/status-snapshot.json`
- `recipes/canvas/window-level-smoke.json`
- `apps/sigil/AGENTS.md`
- `scripts/aos-content-scope.sh`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `tests/lib/visual-harness.sh`, especially status-item/Sigil helpers
- `tests/ops-contract.sh`
- `tests/sigil-workbench-launch.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos help ops
./aos ops list --json
./aos dev recommend --json --paths \
  scripts/aos-ops.mjs,shared/schemas/ops-recipe.schema.json,shared/schemas/ops-result.schema.json,recipes/runtime/status-snapshot.json,recipes/canvas/window-level-smoke.json,apps/sigil/workbench/launch.sh,apps/sigil/agent-terminal/launch.sh,tests/ops-contract.sh,tests/sigil-workbench-launch.sh,tests/lib/visual-harness.sh
```

If live AOS verification is needed and `./aos ready` reports a repo-mode
Accessibility, Input Monitoring, or inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Do not loop on permission repair.

## Required Behavior

### 1. Vocabulary and command surface consolidation

- Make `recipe` the canonical product noun for executable reusable sequences.
- Decide the smallest clean public command move:
  - preferred if cheap and coherent: add `./aos recipe list|explain|dry-run|run`
    backed by the existing ops engine, with `./aos ops` either hard-cut or kept
    as an explicit compatibility alias with a documented removal gate;
  - acceptable if the command churn is too broad for this round: keep `./aos
    ops` as the implementation command but update docs/help/source comments so
    it is clearly "the source-backed recipe surface", not a competing concept.
- Collapse confusing local terms where this slice touches them:
  - `ops recipe`, `operator recipe`, and `source-backed recipe` should not
    describe three different things;
  - `human checkpoint`, `decision gate`, `user signal`, and relay wording should
    be classified as `signal` or `gate` in docs/comments touched by this work.
- Preserve ADR distinctions:
  - recipe is executable reusable composition;
  - playbook is method/guidance;
  - workflow is orchestration graph;
  - work record is historical receipt.

### 2. Recipe engine block foundation

Extend the current source-backed recipe engine enough to represent reusable AOS
sequences that include more than one primitive command shape.

Minimum block set for this slice:

- existing AOS command steps continue to work unchanged;
- a typed `aos_command` block or backwards-compatible default for existing
  `command` steps;
- a repo-owned `shell` block for static script paths under the repo, with argv,
  cwd, timeout, stdout/stderr capture, and no inline arbitrary shell text;
- optional `recipe_call` if it is cheaper than duplicating runtime startup
  recipes, otherwise document it as the next block to implement;
- explicit cleanup/finally behavior remains intact;
- dry-run must remain side-effect-free and show the resolved plan.

If adding `signal`, `gate`, `condition`, or `loop` blocks is too much for this
round, reserve their schema vocabulary and document expected shape, but do not
fake execution support. The point is a solid ladder foundation, not a pretend
workflow engine.

### 3. Parameters and receipts

- Add the smallest parameter/default mechanism needed for reusable recipes,
  or explicitly prove existing `resources` substitution is enough for this
  round.
- Recipe dry-run JSON should be useful to agents: include block kind, resolved
  command/script, mutating classification, parameters/resources, owned
  resources, and cleanup plan.
- Recipe run JSON should remain schema-validated and should make mutations,
  cleanup, failures, and local-only live state obvious.
- If the result schema changes, update fixtures/tests/docs in the same slice.

### 4. Canonical runtime and Sigil recipes

Add high-value source-backed recipes. Names may shift if you find a better local
pattern, but keep the product vocabulary clear.

Required recipes:

- `runtime/clean-restart`: clean stale resources, restart/start repo daemon as
  needed, and verify readiness without encouraging permission-repair loops.
- `sigil/start`: branch-scoped content roots, status-item configuration,
  daemon readiness, avatar/workbench launch, and verification that the Sigil
  surfaces exist.
- `sigil/start-agent-terminal`: branch-scoped content roots, owned bridge
  restart/reuse through the existing Sigil Agent Terminal launcher, avatar
  ensure, and terminal surface verification.

These recipes must reuse existing implementation where it is still good:

- `scripts/aos-content-scope.sh`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`

But if those scripts encode duplicated root/status/launch policy, extract a
shared Sigil launch helper first and make scripts/recipes call that common
unit. The status-item configuration currently buried in
`tests/lib/visual-harness.sh` should move into an owned Sigil/runtime helper or
otherwise become reusable outside tests; test helpers should call the shared
path rather than owning product setup behavior.

### 5. Legacy script and test consolidation

Do a targeted audit of the touched surfaces:

- `scripts/`
- `apps/sigil/*/launch.sh`
- `packages/toolkit/components/*/launch.sh` only where recipe patterns clearly
  apply;
- Employer Brand scripts only as classification examples, not a full migration.

Classify obvious residue as:

- primitive implementation;
- recipe block helper;
- source-backed recipe;
- workflow/domain fixture;
- dead or superseded implementation.

Delete, rewrite, or demote obsolete code/tests when the replacement is clear and
covered. Keep a concise report under `docs/dev/reports/` if there are remaining
large follow-up groups that should not be handled in this round.

### 6. Surface boundary

Do not build a TUI. AOS canvases, Agent Terminal, status-item/menu surfaces, and
signal surfaces are clients of the recipe/workflow ladder. They should not own
recipe semantics.

It is acceptable to add a tiny terminal convenience wrapper only if it delegates
to the same recipe engine and does not become a separate orchestration surface.

## Suggested Implementation Areas

Inspect first, then choose the cleanest layer. Likely areas:

- `scripts/aos-ops.mjs`
- `shared/schemas/ops-recipe.schema.json`
- `shared/schemas/ops-result.schema.json`
- `recipes/`
- `apps/sigil/recipes/`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- a new Sigil shared shell helper, if needed
- `tests/ops-contract.sh`
- `tests/sigil-workbench-launch.sh`
- `tests/lib/visual-harness.sh`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `docs/api/aos.md`
- ADR/design docs listed above, only where terminology becomes misleading

## Hard Boundaries / Non-Goals

- Do not build a TUI.
- Do not implement a full workflow scheduler, queue, or cross-session
  orchestration engine in this round.
- Do not run or automate external websites.
- Do not run live provider sessions, Codex/Claude agents, or AFK dispatches.
- Do not mutate GitHub state.
- Do not broaden into unrelated Sigil renderer redesign.
- Do not preserve old names solely because tests exist. If tests protect stale
  implementation rather than durable behavior, replace the tests.
- Do not delete valuable domain knowledge or fixture data just because its
  current script wrapper is weak. Separate content/process/design from old
  execution plumbing.

## Verification

Run the focused deterministic suite you choose from `./aos dev recommend`, plus
at minimum:

```bash
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/ops-contract.sh
git diff --check
```

If schemas change, run the schema tests that cover those files. If Sigil launch
helpers change, run:

```bash
bash -n apps/sigil/workbench/launch.sh
bash -n apps/sigil/agent-terminal/launch.sh
bash tests/sigil-workbench-launch.sh
```

If live AOS readiness passes, also run a bounded live smoke for the new recipe
path:

```bash
./aos ready --post-permission
./aos recipe dry-run sigil/start --json || ./aos ops dry-run sigil/start --json
./aos recipe run sigil/start --json || ./aos ops run sigil/start --json
./aos show list --json
```

If you intentionally keep `ops` as the only command and do not add `recipe`,
adjust the live smoke accordingly and state that decision in the report.

If live readiness is blocked by TCC/input tap, use the manual-intervention path above
and report the deterministic verification completed before the block.

## Completion Report

Report:

- branch, head SHA, base SHA, and whether pushed;
- concise vocabulary decision: `recipe` command added, `ops` retained/aliased,
  or `ops` clarified as implementation surface;
- files changed by category: engine/schema, recipes, Sigil helpers, docs,
  tests, deletions;
- recipes added and whether dry-run/run pass;
- scripts/tests deleted or rewritten because they were obsolete, with rationale;
- Employer Brand or other domain residue classified, if touched;
- exact verification commands and pass/fail results;
- live AOS smoke result or readiness blocker;
- remaining follow-up slices, especially full workflow graph/signal/gate/loop
  support if not implemented;
- any local-only state or generated artifacts Foreman must know about.

For reused Implementer CLI sessions, clear completed goal state with clear the stale prompt state
before retiring the session or starting unrelated work.
