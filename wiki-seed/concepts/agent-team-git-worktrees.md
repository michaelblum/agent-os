---
type: concept
name: Agent Team Git Worktrees
description: Orchestrator-led branch, worktree, GitHub, and cleanup coordination for agent-os development
tags: [agents, git, worktrees, github, governance]
---

# Agent Team Git Worktrees

Agent-team Git coordination is an AOS developer entry-path layer for repo work
that uses subagents, parallel implementation, branch handoff, pull requests, or
local worktree cleanup.

## Operating Model

Use an orchestrator-led model. The orchestrator owns GitHub state,
branch/worktree lifecycle, integration, and cleanup. Worker agents receive
bounded file scopes in dedicated worktrees and return changed paths plus
verification evidence.

Agent-created linked worktrees should live under `../agent-os-worktrees/` by
default, or under `$AOS_AGENT_WORKTREE_ROOT` when explicitly set. Start and end
orchestrated sessions with `scripts/agent-worktree-health`.

## AOS Alignment

This concept does not replace AOS primitives. Use `./aos ready` and
`./aos status` for runtime readiness, `see`/`do`/`show`/`tell`/`listen` for
runtime interaction, and `aos ops` for source-backed AOS operator recipes.

Git/worktree coordination belongs under the AOS developer path unless evidence
requires a pivot into testing, visual diagnostics, or user-input diagnostics.

## Source Of Truth

The canonical SOP is the repo recipe:

```text
docs/recipes/agent-team-git-worktrees.md
```

## Related

- [Runtime Modes](./runtime-modes.md)
- [Daemon Lifecycle](./daemon-lifecycle.md)
