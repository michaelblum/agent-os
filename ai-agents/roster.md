# Agent Roster

Canonical seven-agent roster for agent-os.  This table is the authoritative
reference for names, roles, model tiers, and spawn intent.  Definitions are in
`ai-agents/agents/<name>.md`.

| Agent | Role | Model tier | Effort | Sandbox |
|---|---|---|---|---|
| **architect** | System design, decomposition, interface contracts, tradeoff analysis, RFC-style planning | Full (gpt-5.5 / claude-opus) | high | read-only |
| **implementer** | Focused, incremental code authoring and refactoring of well-scoped tasks | Mini (gpt-5.4-mini / claude-haiku) | low | workspace-write |
| **explorer** | Open-ended research, codebase spelunking, dependency audits, API surface surveys | Mini | low | read-only |
| **reviewer** | Code review, diff analysis, security, correctness, style, actionable PR feedback | Standard (gpt-5.4 / claude-sonnet) | medium | read-only |
| **validator** | Bounded verification — runs named checks, reports pass/fail facts, edits nothing | Mini | low | read-only |
| **operator** | Supervised HITL inspector — probes live surfaces, evaluates stop conditions | Standard | medium | workspace-write |
| **steward** | Routine Git/GitHub hygiene — reads refs/PRs, performs narrow explicitly-assigned mutations | Standard | medium | workspace-write |

## Dispatch rules (summary)

- **New feature or major refactor** → architect first, then implementer
- **Completed diff or PR** → reviewer, then validator
- **"Find all X" or wide scan** → explorer (returns raw findings only)
- **Live surface probe** → operator
- **Git hygiene / PR mechanics** → steward
- **Implementer blocked by TCC or native boundary** → stop, return blocker to Foreman

Full spawn criteria are in each agent's definition file.

## Retired agents

| Name | Replaced by | Notes |
|---|---|---|
| gdi | implementer | Same role, renamed for clarity and provider-neutrality |
| github-steward | steward | Shortened; provider-neutral name |
