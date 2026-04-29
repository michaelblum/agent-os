---
name: agent-team-git-worktrees
description: Use when coordinating agent teams, subagents, GitHub branches, pull requests, or local Git worktrees in agent-os; especially when acting as an orchestrator, assigning workers, creating topic worktrees, handing off branches, or cleaning stale worktrees.
---

# Agent Team Git Worktrees

This skill is a discovery shim for the agent-os orchestrator workflow. The
canonical SOP is `docs/recipes/agent-team-git-worktrees.md`; read it before
creating branches, delegating workers, pushing PRs, or cleaning worktrees.

## Core Rules

- Use an orchestrator-led model. The orchestrator owns GitHub state,
  branch/worktree lifecycle, integration, and cleanup.
- Worker agents receive bounded file scopes in dedicated worktrees and return
  changed paths plus verification evidence.
- Put agent-created worktrees under `../agent-os-worktrees/` unless
  `$AOS_AGENT_WORKTREE_ROOT` is explicitly set.
- Start and end orchestration with `scripts/agent-worktree-health`.
- Remove completed worktrees with `git worktree remove`, then run
  `git worktree prune`.
- Do not push, merge, rebase shared branches, or delete worktrees from a worker
  role unless the orchestrator explicitly assigned that Git task.

## Quick Start

```bash
scripts/agent-worktree-health
mkdir -p ../agent-os-worktrees
git worktree add -b codex/<topic> ../agent-os-worktrees/<topic> HEAD
```

Then state the active operating path, branch, and worktree path before editing:

```text
Operating path: agent/dev/orchestrator/worktree-coordination
Branch: codex/<topic>
Worktree: ../agent-os-worktrees/<topic>
```

For the full playbook, use:

```text
docs/recipes/agent-team-git-worktrees.md
```
