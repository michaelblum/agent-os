# PR 378 Command Surface Source Contract Audit Long Run

## Tracker

- Draft PR: https://github.com/michaelblum/agent-os/pull/378
- Prior readiness card:
  `docs/design/work-cards/pr-378-command-surface-pr-readiness-long-run-v0.md`
- Current PR branch checkpoint:
  `b0275e5194edd8131a9462bcec66ebdb3308b469`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume parent-thread memory,
branch state, daemon state, or prior audit coverage. Rediscover state before
editing.

## Goal

Run a broad source-contract audit of PR #378 and fix high-confidence problems.
This is deliberately a long-run GDI round. The previous pass found stale
work-card TCC wording and stopped quickly; this round must go deeper into the
command surface source contracts before declaring no blockers.

The output should make Foreman able to answer: "Is the extracted command surface
internally coherent enough for human/PR review, and where are the remaining
review risks?"

## Branch / Base

- `branch_from: origin/feat/command-surface-extraction`
- `required_start_ref: origin/feat/command-surface-extraction`
- Work surface: `feat/command-surface-extraction`.
- Commit scoped checkpoints directly on this PR branch.
- Push `feat/command-surface-extraction` to origin after verification passes.
- Do not mutate `main`.
- Do not mark PR #378 ready, merge it, split it, or create new PRs.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/pr-378-command-surface-pr-readiness-long-run-v0.md`
- `docs/design/work-cards/pr-378-command-surface-source-contract-audit-long-run-v0.md`
- `docs/design/work-cards/command-surface-rearchitecture-long-goal-v0.md`
- `src/commands/operator.swift`
- `src/shared/external-command-dispatch.swift`
- `config/aos/external-commands.json`
- `config/aos/command-registry.json`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`
- `tests/help-contract.sh`

## Rediscover State

```bash
git fetch origin
git switch -C feat/command-surface-extraction origin/feat/command-surface-extraction
git status --short --branch
gh pr view 378 --repo michaelblum/agent-os --json number,title,state,isDraft,url,headRefName,baseRefName,mergeable,statusCheckRollup
./aos ready
./aos dev recommend --json
```

If live AOS readiness blocks the round, use the standard path:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Continue only if it reports ready. Do not loop on live readiness.

## Required Audit Coverage

Cover all four areas below. Do not stop after the first residue find unless it
is a hard blocker.

### 1. Swift Boundary And Fallback Audit

Answer with evidence:

- What Swift command behavior remains intentionally native/bootstrap?
- Are any migrated command families still active in Swift as compatibility
  fallbacks?
- Does `src/shared/external-command-dispatch.swift` still classify external
  routes and parser-owned missing args correctly?
- Are `__serve`, `__ready`, `__status`, and other private paths only reachable
  through expected wrappers?

Use source inspection plus tests. Fix high-confidence stale fallback or test
coverage issues.

### 2. Manifest / Registry Coherence Audit

Answer with evidence:

- Do external command manifest routes cover the registry paths they should?
- Are duplicate routes condition-gated and non-overlapping?
- Do help registry forms declare the flags/examples they use?
- Are there command families where parser behavior, manifest route, and help
  form disagree?

Prefer structured JSON inspection or existing tests over ad-hoc string checks.
Add or amend tests when the invariant matters.

### 3. Representative Command Family Audit

Pick a representative spread, not every tiny command:

- runtime/readiness/service;
- config;
- show/see/canvas or inspector;
- wiki;
- voice/tell/listen.

For each family, inspect the external script/parser, help form, and at least one
focused test. Fix obvious drift. Record remaining risk when inspection is
manual-only.

### 4. Residue And Governance Audit

Search for stale references that would mislead future GDI/Operator runs:

- old "human returns with ready" TCC relay language;
- old Swift command-source assumptions;
- old command examples that contradict the external surface;
- duplicated shell snippets that should use shared command helpers.

Fix high-confidence stale guidance. Avoid broad style-only doc rewrites.

## Hard Boundaries

- Do not implement unrelated feature work.
- Do not start toolkit architecture or UI refactors.
- Do not pursue every possible script abstraction; only fix command-surface
  correctness, contract drift, or clearly misleading residue.
- Do not use emergency service-wide TCC reset.
- Do not stop after only checking docs. This round must include source/manifest
  audit evidence.

## Checkpoint Strategy

Use a few meaningful commits rather than microscopic commits. Before every
commit:

```bash
git diff --check
git status --short --branch
```

Stage explicit paths only. Do not use `git add .`.

## Verification

Run tests according to touched areas. A final pass should include at least:

```bash
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/help-contract.sh
bash tests/runtime-external-commands.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/input-tap-readiness.sh
git diff --check
```

Add family-specific tests when you change a command family.

## Stop Conditions

Stop and report when:

- all four audit areas have evidence, high-confidence fixes are committed, final
  verification passes, and the branch is pushed;
- a real blocker needs Foreman/human judgment;
- live AOS/TCC readiness is blocked after the standard helper;
- continuing would become unrelated feature work or broad style cleanup.

## Completion Report

Use this shape:

```text
## Completion Report
- profile: long-run PR 378 source-contract audit
- branch: feat/command-surface-extraction
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/feat/command-surface-extraction SHA at start>
- pr: https://github.com/michaelblum/agent-os/pull/378
- commits_this_round: <n plus one-line list>
- tests_passed: <n>/<n with exact commands>
- live_readiness: <ready result or exact blocker>
- pushed: <yes/no, remote SHA if yes>
- audit_coverage:
  - swift_boundary: <evidence summary>
  - manifest_registry: <evidence summary>
  - representative_families: <families inspected and evidence>
  - residue_governance: <evidence summary>
- fixes_made: <none/list>
- merge_blockers: <none/list with files and evidence>
- review_risks: <none/list>
- action_required: <foreman_review|human_needed|block>
```

Do not self-accept PR #378. Foreman owns final acceptance and PR state.
