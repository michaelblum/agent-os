# multi_agent_v2 Local Findings

Status: blocked for this branch by Codex CLI 0.138.0 encrypted tool
registration in the real Foreman dock. No runtime smoke was run. Proceeding
without subagents is required until the encrypted registration blocker is
resolved.

## Authority Layers Used

1. Observed local Foreman behavior: native delegation is currently blocked by
   encrypted tool registration.
2. Current local config and hooks:
   - `.codex/config.toml`
   - `~/.codex/config.toml`
   - `.codex/agents/*.toml`
   - `.docks/foreman/.codex/*`
   - `.docks/harness/*`
3. Codex docs/manual: background terminology only.

## Capability Questions

| Question | Finding |
| --- | --- |
| Does real Foreman `spawn_agent` expose and honor `agent_type`? | Unproven at runtime. Repo and Foreman configs register `[agents.<role>]`; hooks require structured `agent_type`; encrypted tool registration blocks live proof. |
| Does omitting `agent_type` still create a default/generic child? | Locally blocked by Foreman PreToolUse hook before spawn. Underlying CLI behavior remains unproven because live spawn is blocked. |
| Does project `agents.max_depth = 1` block grandchildren? | Unproven at runtime. Repo and Foreman config set `max_depth = 1`; default doctrine treats grandchildren as blocked until smoke proves otherwise. |
| If temporarily raised on this branch, can a child spawn a grandchild? | Not tested. Requires explicit experimental profile flag and manual Foreman smoke after encrypted registration is fixed. |
| How do `agents.max_threads` and `max_depth` interact? | Unproven. Local repo/Foreman config does not set `max_threads`; the hook isolation test historically rejects `max_threads` in repo/Foreman config. User config sets `max_depth = 2` globally, but project config narrows Foreman to `max_depth = 1`. |
| Do SubagentStart/SubagentStop hooks receive correct agent type, including nested cases? | Direct hook payload tests prove the runner consumes `agent_type` when present. Real nested hook payload behavior is unproven. |
| Do read-only custom-agent sandbox settings remain enforced? | Config declares read-only sandbox for explorer, validator, and operator. Runtime enforcement is unproven while encrypted registration blocks live child creation. |
| Can a future `historian` agent reliably use `codex-thread-workbench`? | Unproven. The local skill exists for Foreman, but child skill availability/inheritance has not been proven under `multi_agent_v2`. Historian must receive thread-workbench tasks only after a manual smoke verifies skill availability or the prompt includes a fallback. |

## Manual Smoke Required Before Nested Topology

Run only when `multi_agent_v2` encrypted registration is fixed and live smoke is
approved:

1. Spawn a direct `explorer` with `agent_type="explorer"` and confirm model,
   role instructions, hook `agent_type`, and read-only sandbox.
2. Attempt a spawn without `agent_type`; confirm Foreman hook blocks it before
   child creation.
3. With `agents.max_depth = 1`, ask a child to spawn a grandchild; confirm
   block reason and hook behavior.
4. On an experimental branch/profile only, raise depth and test a nested child;
   record `max_depth`, any thread limit, hook payloads, and sandbox behavior.
5. Spawn `historian` and ask it to list available skills or use
   `codex-thread-workbench`; record whether skill availability inherits.

Until all five pass, the supported topology is Foreman-orchestrated direct
subagents only.
