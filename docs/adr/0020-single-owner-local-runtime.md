# Single-Owner Local Runtime

**Status:** Accepted
**Date:** 2026-07-09

## Decision

The default local AOS runtime is a single-owner, one-screen runtime. For
agent-os specifically, agents must not create or use linked git worktrees as
parallel execution/code-change workspaces.

For a given runtime mode, `~/.config/aos/{repo|installed}` must be owned by one
daemon process and the primary checkout at a time.

The default runtime owner is the launchd-managed daemon. A foreground
`aos serve` daemon is allowed for development only when it runs under an
isolated `AOS_STATE_ROOT`, or when an explicit break-glass environment override
is set for a bounded local proof. A foreground dev daemon that owns the default
state root is a readiness blocker, even if the native broker can classify the
owner as internally consistent.

Agents must not use branch-scoped content roots, status-item URLs, foreground
daemon ownership, or linked git worktrees as the default way to parallelize
agent-os work. Runtime-coupled tests outside the primary checkout must isolate
runtime state with `AOS_STATE_ROOT`, or avoid the daemon/status-item/canvas
runtime entirely.

The active status-item experience should use stable active/canonical content
root names in the single-checkout workflow. Branch-scoped roots are reserved
only for explicit isolated runtime proofs under `AOS_STATE_ROOT` with
`AOS_CONTENT_ROOT_SCOPE=branch`, not for the active one-screen experience.

## Context

AOS is intentionally local and full-access: the daemon owns permissioned macOS
capabilities such as input taps, screen capture, canvases, content serving, and
the status item. Those capabilities are not a shared multi-tenant resource. When
multiple agents develop from multiple worktrees against the same default state
root, they can leave stale surfaces, wrong content-root mappings, or a
foreground dev daemon controlling the repo socket.

The symptom that forced this decision was pointer input degradation that stopped
after removing a full-desktop AOS surface and terminating a foreground
`./aos serve` owner in the default repo runtime. The daemon/socket facts were
not enough: the owner could be classified as `foreground_dev` and still be the
wrong owner for the shared local runtime.

## Consequences

- `aos ready` reports `daemon_foreground_dev_default` when the default runtime is
  owned by a foreground dev daemon.
- `aos clean --dry-run --json` reports `foreground_dev_owners`; `aos clean`
  cleans those owners before readiness or service start/restart.
- `--allow-start` may start or repair an absent runtime, but it does not bypass
  linked-worktree or cleanup-required ownership blockers.
- Isolated development daemons remain supported under explicit `AOS_STATE_ROOT`.
- Linked worktrees without `AOS_STATE_ROOT` report
  `agent_os_worktree_default_runtime` for live/default repo-runtime operations.
- Durable source, tests, ADRs, API docs, and guides own this policy. Notes under
  `docs/design/` are evidence or exploration until promoted here.
