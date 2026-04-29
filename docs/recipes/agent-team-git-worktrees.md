# Recipe: Agent Team Git and Worktrees

Use this recipe when agent-os work involves agent teams, subagents, parallel
implementation, GitHub branches, pull requests, or cleanup of local worktrees.

The goal is a local-machine workflow where multiple agents can work in parallel
without corrupting each other's branches, leaving stale worktrees behind, or
turning GitHub into a process tax for the sole human owner.

## Strategy

Use an orchestrator-led model.

```text
human owner
  -> orchestrator agent
      -> creates/claims topic branch or worktree
      -> assigns bounded worker/reviewer tasks
      -> integrates changes
      -> owns GitHub/PR state
      -> owns cleanup
```

Worker agents should not independently create long-lived branches, push to
GitHub, merge, rebase shared branches, or delete worktrees. They work in the
worktree and file scope the orchestrator assigns, return changed paths and
verification evidence, and leave Git state coordination to the orchestrator.

The orchestrator remains accountable for final integration. Agent review can
raise the baseline, but the human owner and the orchestrator decide what is
ready to merge.

## Roles

| Role | Authority | Default workspace |
|---|---|---|
| Orchestrator | GitHub state, branch/worktree lifecycle, task split, integration, cleanup | Foreground checkout or coordination worktree |
| Worker | Bounded implementation in assigned paths | Dedicated topic worktree |
| Reviewer | Read-only review, bug finding, test-gap analysis | Current branch or disposable detached worktree |
| Runtime driver | AOS primitives and live UI verification | Current runtime checkout selected by orchestrator |

Use subagents when work is genuinely parallel: independent file scopes,
independent investigation questions, or review while the orchestrator continues
implementation. Do not spawn subagents just to re-read the same files or to
perform the immediate blocking task.

## Worktree Root

Use one predictable local root for agent-created worktrees:

```text
../agent-os-worktrees/
```

From the main checkout at `/Users/Michael/Code/agent-os`, that resolves to:

```text
/Users/Michael/Code/agent-os-worktrees/
```

Set `AOS_AGENT_WORKTREE_ROOT` only when a different local root is required.
Keeping all agent worktrees under one directory makes disk usage visible and
cleanup mechanical. `scripts/agent-worktree-health` derives the default root
from Git's main worktree, so it reports the same root from the main checkout or
any linked worktree.

## Branch Names

Use short, descriptive topic branches:

```text
codex/<topic>
owner/<topic>
agent/<topic>
```

Examples:

```text
codex/agent-team-github-governance
codex/supervised-run-harness
owner/sigil-visuals
```

Use one branch per active worktree. Git intentionally prevents the same branch
from being checked out in more than one worktree because a branch is a mutable
reference owned by one working copy at a time.

## Start SOP

1. Inspect current state:

```bash
git status --short --branch
git worktree list --porcelain
scripts/agent-worktree-health
```

2. If current dirty changes are unrelated, do not move or rewrite them. Create a
   separate worktree from the current HEAD or from the intended base.

3. Create a topic worktree from the main checkout or with an explicit root:

```bash
mkdir -p ../agent-os-worktrees
git worktree add -b codex/<topic> ../agent-os-worktrees/<topic> HEAD
```

4. In the new worktree, run the repo readiness gate if runtime work is needed:

```bash
./aos ready
```

5. State the operating path and the branch/worktree path before editing.

## Parallel Worker SOP

The orchestrator assigns each worker:

- worktree path
- branch name or detached-head status
- owned file/module scope
- task objective
- verification command(s)
- handoff format

Worker instructions should include:

```text
You are not alone in the codebase. Do not revert edits made by others. Stay in
your assigned files unless you find a blocker, and report that blocker before
expanding scope.
```

For multiple workers, keep write sets disjoint. If two workers need the same
file, sequence the work or make one worker read-only.

## Pulling and Updating

Before pulling or rebasing a topic branch:

1. Confirm the worktree is clean or the dirty files are intentionally part of
   the task.
2. Fetch first:

```bash
git fetch origin --prune
```

3. Prefer rebasing a private unpublished topic branch onto its base:

```bash
git rebase origin/main
```

4. Do not rebase a branch another active agent or open PR depends on unless the
   orchestrator has explicitly coordinated that change.

5. If a rebase/merge conflicts, stop and report the files. Do not guess through
   conflicts that cross ownership boundaries.

## PR and GitHub SOP

Use GitHub when it improves coordination, reviewability, or recovery.

- Use draft PRs for agent-generated work that needs inspection.
- Link the driving issue or plan in the PR body.
- Include verification evidence and unresolved risks.
- Keep PRs small enough to review. Split by contract boundary when possible.
- Prefer GitHub repository settings that delete head branches after PR merge,
  unless a branch is intentionally long-lived.
- Protect `main` with rulesets or branch protection if direct pushes become a
  recurring hazard. Rulesets are preferable when multiple independent policies
  need to layer.
- Use GitHub Actions concurrency groups for CI workflows where repeated pushes
  to the same branch should cancel stale in-progress runs.

The human owner is the final merge authority until further notice.

## Handoff SOP

When a worker finishes, it reports:

```text
Branch/worktree:
Changed paths:
Commits:
Verification:
Known risks:
Cleanup needed:
```

The orchestrator then:

1. Reviews the diff.
2. Runs or records the verification gate.
3. Integrates or requests a targeted follow-up.
4. Updates the issue/PR/plan if the result changes durable state.
5. Removes or marks the worktree for cleanup.

## Cleanup SOP

Run this at the start and end of orchestrated sessions:

```bash
scripts/agent-worktree-health
git worktree prune --dry-run
```

When a topic is merged, abandoned, or superseded:

1. Confirm the worktree is clean:

```bash
git -C ../agent-os-worktrees/<topic> status --short
```

2. Remove the linked worktree:

```bash
git worktree remove ../agent-os-worktrees/<topic>
```

3. Prune stale worktree metadata:

```bash
git worktree prune
```

4. Delete merged local branches with `git branch -d <branch>`. Use force-delete
   only when the branch is known to be disposable and the human has approved.

5. Delete the remote branch after merge when GitHub did not auto-delete it:

```bash
git push origin --delete <branch>
```

Do not manually `rm -rf` a worktree directory unless `git worktree remove`
cannot run. If a worktree was moved or manually deleted, use `git worktree
repair` or `git worktree prune` to repair or clear Git's administrative state.

## Disk Hygiene Rules

- All agent-created worktrees should live under `../agent-os-worktrees/`.
- Long-lived worktrees need an explicit reason and should be rare.
- Detached or disposable worktrees must be removed when their task finishes.
- Startup health checks should warn about prunable worktrees and high worktree
  counts, but cleanup remains an explicit orchestrator action.
- Do not vendor dependency caches into worktrees if the package manager can
  share cache globally.

## Entry Path Integration

Agent-team Git coordination is an AOS developer layer, not an app-runtime layer.
Use it when the active path includes repo writes, subagents, parallel work,
GitHub PRs, or long-running implementation.

Common operating paths:

```text
agent/dev/orchestrator
agent/dev/orchestrator/worktree-coordination
agent/dev/worker/topic-worktree
agent/dev/reviewer
agent/dev/testing/headed/real-input/hitl-sidecar
```

The orchestrator may backtrack from implementation into testing or diagnostics,
but it should keep branch/worktree ownership explicit while doing so.

## Sources

- Git worktrees support multiple linked working trees, one branch cannot safely
  be checked out in two worktrees at once, and stale worktree metadata is
  cleaned with `git worktree prune`: https://git-scm.com/docs/git-worktree
- Git branch deletion with `-d` requires the branch to be merged; force delete
  is a separate operation: https://git-scm.com/docs/git-branch
- Git garbage collection also prunes old worktree metadata according to
  `gc.worktreePruneExpire`: https://git-scm.com/docs/git-gc
- Codex app worktrees separate foreground local work from background worktrees
  and use disposable managed worktrees for parallel tasks:
  https://developers.openai.com/codex/app/worktrees
- Codex team guidance frames agents as delegated implementers/reviewers while
  engineers retain final ownership of review and merge:
  https://developers.openai.com/codex/guides/build-ai-native-engineering-team
- GitHub rulesets and protected branches guard integration branches:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GitHub can automatically delete head branches after PR merge:
  https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches
- GitHub Actions concurrency can cancel stale in-progress runs per branch or
  workflow: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
