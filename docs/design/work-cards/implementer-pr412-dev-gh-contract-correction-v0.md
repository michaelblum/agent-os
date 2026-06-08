# Implementer Correction Card: PR #412 Dev GH Contract Alignment

## Transfer Header

- Recipient: Implementer
- Transfer kind: correction round
- Source artifact: PR #412, "Expand dev gh GitHub control surface"
- Governing workstream: #407 governance/control-surface lane
- Single goal: make PR #412's `./aos dev gh` write boundary match its declared capability contract and add missing failure-path coverage.
- Branch/base:
  - branch_from: `origin/implementer/aos-broker-auto-repair-settlement-v0`
  - required_start_ref: `origin/implementer/aos-broker-auto-repair-settlement-v0`
  - work surface: current PR branch, not a new output branch
- Stop conditions: completed with evidence, failed with exact blocker, stalled only for missing branch/state, or misrouted if this card no longer matches PR #412.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, PR, or prior implementation state. Read and rediscover before
editing.

## Goal

Correct PR #412 so the external-write command allowlist is no broader than the
canonical capability manifest, and so new body-file failure paths are covered.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `scripts/aos-dev-gh.mjs`
- `docs/dev/agent-capabilities.json`
- `.docks/foreman/session metadata`
- implementer session metadata
- operator session metadata
- `tests/dev-workflow-router.sh`
- `tests/schemas/aos-agent-capability-manifest-v0.test.mjs`
- `tests/schemas/aos-dock-profile-v0.test.mjs`
- `docs/api/aos.md`

## Rediscover State

```bash
git status --short --branch
git branch --show-current
git log --oneline origin/main..HEAD
./aos dev gh pr view 412 --json
```

Preserve unrelated local dirty and untracked files. Do not reset, clean, switch
branches, or touch unrelated work cards/reports.

## Review Findings To Fix

### Required Before Merge: PR Merge Contract Gap

`scripts/aos-dev-gh.mjs` currently accepts and forwards `./aos dev gh pr merge`
flags that the `dev.github.pr_merge` capability does not declare:

- `--auto`
- `--delete-branch`

This is a blocker because `parseOptions` is an explicit allowlist and
`dev.github.pr_merge` is a Foreman-only `external_write` capability with
`audit: required`.

Take the smaller correction path: remove support for `--auto` and
`--delete-branch` from `pr merge`. Do not expand the manifest side effects for
this correction round. Keep these supported:

- required numeric PR number;
- exactly one of `--squash`, `--merge`, or `--rebase`;
- optional `--match-head-commit <sha>`;
- optional `--body-file <path>`.

Update `tests/dev-workflow-router.sh` so the successful fake-`gh` PR merge
case no longer uses `--delete-branch`, and add rejection coverage proving
`--auto` and `--delete-branch` are not accepted by `pr merge`.

### Required Before Merge: Missing Failure-Path Coverage

Add deterministic tests for the new `MISSING_BODY_FILE` paths:

- `./aos dev gh issue create --title ... --body-file <missing-path>`
- `./aos dev gh pr merge <number> --merge --body-file <missing-path>`

Assertions should confirm the command fails and stderr includes the expected
missing-body-file message or `MISSING_BODY_FILE` code, consistent with nearby
test style.

## Explicit Non-Goals

- Do not start #411.
- Do not add `pr create`, `pr ready`, `pr review`, `label create`, project
  mutations, or other GitHub operations.
- Do not add native, Swift, daemon, TCC, or rebuild work.
- Do not restructure the whole parser in this correction round.
- Do not change `requires_human_approval`; Foreman confirms `false` is the
  current policy for assigned Foreman-owned GitHub coordination writes.

## Follow-Up To Preserve, Not Implement Here

The review found a structural issue in `parseOptions`: mode booleans and
`listKind && !labelList` guards are growing into a shared god-parser. Preserve
this as a follow-up recommendation in the completion report. The future
follow-up must delete the mode booleans and guards, not merely move the same
coupling into a table.

## Verification

Run:

```bash
bash tests/dev-workflow-router.sh
node --test tests/schemas/aos-agent-capability-manifest-v0.test.mjs
node --test tests/schemas/aos-dock-profile-v0.test.mjs
git diff --check HEAD -- scripts/aos-dev-gh.mjs docs/dev/agent-capabilities.json .docks/foreman/session metadata implementer session metadata operator session metadata tests/dev-workflow-router.sh tests/schemas/aos-agent-capability-manifest-v0.test.mjs tests/schemas/aos-dock-profile-v0.test.mjs docs/api/aos.md docs/agents/issue-tracker.md
git show --check --stat --oneline HEAD
```

If you touch docs or manifests beyond the expected files, also run:

```bash
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
```

No live AOS verification is required for this deterministic script/schema
correction.

## Completion Report

Report:

- files changed;
- whether `--auto` and `--delete-branch` are now rejected by `pr merge`;
- exact new missing-body-file tests added;
- exact verification commands and pass/fail results;
- any unrelated dirty state you observed but did not touch;
- whether the parser restructure follow-up remains recommended.
