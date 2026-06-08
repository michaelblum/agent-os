# PR 378 Command Surface Readiness Long Run

## Tracker

- Draft PR: https://github.com/michaelblum/agent-os/pull/378
- Workstream: command surface rearchitecture.
- Source branch: `feat/command-surface-extraction`.
- Current published checkpoint when this card was written:
  `0c6e59b312dbb5d20f84b14dd4176c9f7b3f3271`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
PR, or prior implementation state. Read this card, rediscover local and remote
state, then work from evidence.

## Goal

Own a broad PR-readiness pass for PR #378. This is intentionally a long-run,
non-microscopic Implementer round: audit the published command-surface branch, fix
obvious in-scope correctness or contract issues, commit durable checkpoints,
push the updated PR branch, and return a merge-readiness report with remaining
risks.

The goal is not to discover one tiny task and stop. Keep advancing through the
defined audit areas until the branch is materially more reviewable or a hard
stop condition applies.

## Branch / Base

- `branch_from: origin/feat/command-surface-extraction`
- `required_start_ref: origin/feat/command-surface-extraction`
- Work surface: `feat/command-surface-extraction`.
- This card authorizes Implementer to work directly on the PR branch for this long-run
  round.
- Commit scoped checkpoints directly on `feat/command-surface-extraction`.
- Push `feat/command-surface-extraction` to origin after verification passes.
- Do not mutate `main`.
- Do not open, close, merge, or mark PR #378 ready for review. Foreman owns PR
  state after the round.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/command-surface-rearchitecture-long-prompt-v0.md`
- `docs/design/work-cards/pr-378-command-surface-pr-readiness-long-run-v0.md`
- PR #378 metadata and diff summary via `gh pr view 378 --repo michaelblum/agent-os`

## Rediscover State

Start with:

```bash
git fetch origin
git switch -C feat/command-surface-extraction origin/feat/command-surface-extraction
git status --short --branch
gh pr view 378 --repo michaelblum/agent-os --json number,title,state,isDraft,url,headRefName,baseRefName,mergeable,statusCheckRollup
./aos ready
./aos dev recommend --json
```

If `./aos ready`, live AOS verification, Accessibility, Input Monitoring, or an
inactive input-tap state blocks the assigned work, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Continue only if it reports ready. Do not retry live checks in loops.

## Audit And Correction Areas

Work through these areas as a broad pass. Fix in-scope problems when the fix is
clear and bounded; otherwise record the finding with evidence.

1. Command dispatch and manifest integrity.
   - External routes should be the source of truth for the extracted command
     surface.
   - Swift should keep only bootstrap/native primitives and should not retain
     active compatibility fallbacks for migrated command behavior.
   - Duplicate route conditions must be explicit and non-overlapping.

2. Help, parser, and error-contract drift.
   - Help registry forms, parser behavior, and tests should agree.
   - Invalid flags/positionals should classify deterministically.
   - JSON output shapes should be intentional and tested for the changed
     command families.

3. Runtime and readiness governance.
   - Repo-mode ownership must keep accepting the launchd service parent plus
     serving child daemon shape as consistent.
   - TCC/input-tap recovery should use the `finished` human relay contract:
     agent/session owns reset/setup/ready checks, human owns only macOS
     physical permission grant or regrant.
   - No hook or work-card path should tell the human to say `ready` for this
     recovery path.

4. Stale/ad-hoc residue.
   - Look for old command examples, dead compiled command references, stale
     docs, duplicated scripts, and one-off shell logic that now contradicts the
     external command surface.
   - Fix high-confidence residue in owned in-repo files. Do not rewrite broad
     docs just for style.

5. Verification shape.
   - Identify the smallest credible verification suite for PR #378.
   - Run focused deterministic tests after each meaningful correction.
   - Run a broader final deterministic pass when the branch stabilizes.

## Hard Boundaries

- Do not resume open-ended feature expansion beyond PR-readiness.
- Do not start a new architecture direction or toolkit refactor.
- Do not split PR #378 or create new PRs. You may recommend split strategy in
  the completion report.
- Do not perform emergency service-wide TCC reset.
- Do not mutate unrelated user files or generated artifacts.
- Do not keep searching indefinitely after the audit areas have been covered
  and no concrete blocker remains.
- Do not mark the draft PR ready for review or merge it.

## Checkpoint Strategy

Use scoped commits as recoverable checkpoints. Prefer a few meaningful commits
over microscopic one-line commits. Reasonable checkpoint classes:

- `fix(<area>): <contract correction>`
- `test(<area>): <coverage added>`
- `docs(<area>): <stale guidance cleanup>`
- `chore(<area>): <manifest or routing hygiene>`

Before each commit:

```bash
git diff --check
git status --short --branch
```

Stage only the explicit paths for the checkpoint. Do not use `git add .`.

## Verification

Run tests based on touched areas, then run a final suite that should include at
least:

```bash
bash tests/dock-hook-isolation.sh
bash tests/help-contract.sh
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/ready-ownership-mismatch.sh
bash tests/input-tap-readiness.sh
bash tests/runtime-external-commands.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
git diff --check
```

If command families are changed, add the focused tests for those families. If
live readiness is available and relevant, run one bounded live smoke through
`./aos ready --post-permission`; otherwise report the exact readiness blocker.

## Stop Conditions

Stop and report when one of these is true:

- the audit areas have been covered, in-scope fixes are committed, verification
  is green, and the branch has been pushed;
- a merge blocker needs human/Foreman judgment;
- live AOS/TCC readiness is blocked after the standard manual-intervention helper;
- continuing would require broad product direction, new feature work, PR
  splitting, or emergency permission reset.

## Completion Report

Use this shape:

```text
## Completion Report
- profile: long-run PR-readiness override on feat/command-surface-extraction
- branch: feat/command-surface-extraction
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/feat/command-surface-extraction SHA at start>
- pr: https://github.com/michaelblum/agent-os/pull/378
- files_changed_this_round: <n>
- commits_this_round: <n plus one-line list>
- tests_passed: <n>/<n with exact commands>
- live_readiness: <ready result or exact blocker>
- pushed: <yes/no, remote SHA if yes>
- merge_blockers: <none/list with files and evidence>
- review_risks: <none/list>
- suggested_split_strategy: <none/list, only if useful>
- stale_residue_found: <none/list>
- action_required: <foreman_review|manual_intervention|block>
```

Do not self-accept PR #378. Foreman reviews the report, branch diff, and test
evidence before choosing publication or correction follow-up.
