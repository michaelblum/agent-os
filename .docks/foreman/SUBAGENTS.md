# Foreman Subagents

Foreman leads an extensible Codex native subagent team. This document describes
the team split, the registered roles, and the proof gate Foreman must use before
broad fan-out.

## Architecture: Two Layers

```text
.docks/                          <- AOS team layer, provider-agnostic
  foreman/AGENTS.md              <- Foreman role contract and launch persona
  gdi/AGENTS.md                  <- GDI role contract
  operator/AGENTS.md             <- Operator role contract

.codex/agents/                   <- native Codex subagent config roster
  gdi.toml                       <- spawnable GDI subagent config
  operator.toml                  <- spawnable Operator subagent config
  explorer.toml                  <- spawnable Explorer utility config
  validator.toml                 <- spawnable Validator utility config
  github-steward.toml            <- spawnable Git/GitHub hygiene utility config
  reviewer.toml                  <- spawnable review utility config
```

The `.docks/` tree is the AOS team layer. It owns role definitions, scripts,
skills, recovery helpers, and legacy terminal metadata. It is not the native
Codex agent config store.

Root `.codex/agents/` is the native Codex roster. Each TOML pins the role name,
description, model, reasoning effort, and short developer instructions. When a
subagent maps to a dock role, the TOML points back to that dock's canonical
`AGENTS.md` instead of duplicating the role contract.

Repo-root `.codex/config.toml` registers the native files with
`config_file = "agents/<role>.toml"`. The Foreman launch config at
`.docks/foreman/.codex/config.toml` registers those same root files with
`config_file = "../../../.codex/agents/<role>.toml"`. That keeps dock launch
as a team/persona/hooks entrypoint while keeping native Codex agent definitions
in the first-class project location.

## Registered Subagent Catalog

| Name | Model | Effort | Role |
|---|---|---|---|
| `gdi` | gpt-5.4-mini | low | Deterministic implementation worker |
| `operator` | gpt-5.4 | medium | Supervised HITL inspector |
| `explorer` | gpt-5.4-mini | low | Read-only codebase scanner |
| `validator` | gpt-5.4-mini | low | Bounded verification worker |
| `github-steward` | gpt-5.4-mini | low | Git/GitHub hygiene, readback, publication, merge/readback, and safe branch cleanup |
| `reviewer` | gpt-5.4 | medium | Assigned diff, PR, report, or completion-evidence review |

Foreman itself runs at `gpt-5.5 / xhigh` when launched from
`.docks/foreman` (see `.docks/foreman/.codex/config.toml`). That expensive
coordination posture is for Foreman only. Every subagent config must declare
its own `model` and `model_reasoning_effort`; cheap reconnaissance,
validation, and bounded execution roles must not silently inherit Foreman's
model or effort.

## Context Firewall

Foreman owns the read-first set. When drift risk exists, each non-trivial native
dispatch or explicit durable work card names current authority and known stale pools.

Authority order: live Git/GitHub/AOS facts; latest accepted issue/PR comments
and merged PRs; the active native dispatch or explicit durable work card;
ratified or dispatch-named design docs; older issues, docs, reports, and work
cards only when pulled forward by the current authority.

Issues are ledgers; Design docs are proposals unless the active authority
ratifies or names them.

GDI executes the assigned native prompt or explicit durable card. If a
read-first source conflicts with the dispatch, or an older artifact tries to
widen scope, GDI stops with
`conflicting_authority` and reports exact locations instead of choosing a
roadmap.

Explorer performs bounded read-only scans only. It returns paths, counts,
snippets, and raw facts; it does not interpret roadmaps, rank authority, or
decide follow-up work.

Validator performs bounded verification only. It runs named checks or inspects
named evidence, reports pass/fail facts, and does not edit files or decide next
work.

GitHub Steward performs routine Git/GitHub hygiene only. It reads branch, ref,
worktree, upstream, issue, PR, and check facts; uses `./aos dev gh` where
available; and mutates git or GitHub only when Foreman or the user assigns an
exact action or an authorized publication/hygiene flow. After work is accepted
or a PR merge is approved, the steward may execute routine push, PR
create/update, comment, merge/readback, obvious ledger-note, and safe
merged-branch cleanup steps end-to-end when its safety gates pass.

Reviewer performs assigned review only. It reviews named diffs, files, PRs,
reports, or completion evidence; returns findings first; and does not edit
files, mutate GitHub, choose product direction, or decide next slices.

## Routing Policy

Foreman is the decision owner and coordinator, not the default executor for
routine specialist chores. Use registered native subagent spawning when:

- The task has a bounded goal and a clear stop condition.
- You need parallel reconnaissance, validation, or bounded execution without
  filling Foreman's context window or spending Foreman's model/effort on the
  side task.
- You need GDI to execute deterministic implementation or validation work and
  report verification. Use a work-card pointer only when an explicit durable contract is already current, explicitly requested, or genuinely needed for a
  multi-session round.
- You need Operator to run a bounded supervised probe or capture-plan check.
- You need Validator to run named proof, test, or manifest checks without
  turning validation into implementation.
- You need GitHub Steward to do routine Git/GitHub readback, hygiene, or an
  authorized publication/hygiene flow without spending Foreman's context.
- You need Reviewer to do a routine acceptance or review pass over assigned
  evidence while Foreman remains the final decision owner.

If a registered role fits routine specialist work and the spawn tool exposes
`agent_type`, Foreman must use that role. Direct Foreman execution is limited to
tiny coordination edits, synthesis, routing judgment, or work where no
registered role fits. If the spawn surface does not expose `agent_type`, do not
spawn a default child or hide the fallback in the prompt; report a
subagent-runtime blocker unless the human explicitly authorizes fallback for
that specific flow.

Use the legacy terminal/AFK path only when:

- The work explicitly tests or repairs the legacy AFK terminal substrate.
- Native subagent role resolution is unavailable and the human explicitly
  authorizes fallback for the specific flow.
- The human explicitly asks for a separate supervised terminal session.

## How Foreman Spawns Subagents

Foreman must select the role with the spawn tool's `agent_type` field. Codex
resolves custom agents from native TOML configs under `.codex/agents/` and from
explicit `config_file` registrations in the active project `.codex`
configuration. The `name` field inside each agent config is the runtime
identity.

Do not rely on naming a role inside the child prompt. If the spawn tool
argument `agent_type` is omitted, Codex uses `default`, and the child can
inherit Foreman's model/effort.

There is no generic helper role. If a user asks for a helper, scanner, second
set of eyes, or lightweight pass, Foreman must translate that request to a
registered role before spawning: `explorer` for read-only reconnaissance,
`validator` for bounded verification, `github-steward` for routine Git/GitHub
hygiene and readback, `reviewer` for assigned review passes, `gdi` for
deterministic implementation, and `operator` for supervised live/HITL
inspection. The first spawn attempt must use the registered role; a blocked
generic/default spawn is a routing mistake, even if Foreman recovers by retrying
correctly.

Before broad fan-out, smoke one child. The visible spawn/status line and
SubagentStart/SubagentStop voice labels must identify the intended role
(`explorer`, `validator`, `github-steward`, `reviewer`, `gdi`, or `operator`),
not `default`, and the visible model/effort must match the native agent config.
If it says `default`, `Gibbs`, or inherits Foreman's `gpt-5.5 / xhigh`, stop
and fix role loading before continuing.

Foreman's `PreToolUse` hook blocks recognized spawn-tool calls that omit
`agent_type`, use `default`, or name an unregistered role. `SubagentStart`
cannot stop startup in current Codex; it is the second-line warning/TTS tripwire
for missing `agent_type`, `default`, `foreman`, `gibbs`, and roles that do not
map to a repo-root `.codex/agents/<role>.toml` file declaring the same `name`.
`SubagentStop` suppresses invalid-role voice lines so a bad child does not
produce misleading "Default stopped" feedback.

Use the AOS gate for this instead of relying on memory. First generate the
native spawn contract:

```bash
./aos dev subagent plan --role explorer --prompt "reply exactly EXPLORER_AGENT_TYPE_SMOKE_OK" --json
```

After the smoke, capture the visible spawn/proof transcript and validate it:

```bash
./aos dev subagent validate-proof --role explorer --transcript-file /tmp/subagent-smoke.txt --json
```

If proof validation fails, do not fan out. The failed proof is the blocker.

## GitHub Steward Safety Gates

When Foreman or the user has authorized a publication, merge, or hygiene flow,
GitHub Steward owns the routine mechanics under live readback:

- before merge/delete, verify PR state, head, base, expected head commit when
  supplied, worktree cleanliness, branch/upstream state, and no unmerged
  local-only commits;
- after merge, delete the local and remote feature branch by default only when
  the PR is merged, the branch head matches the merged PR head or squash source
  head, and the worktree is clean;
- escalate failing required checks, unknown required-check policy, dirty
  worktree, unpublished local-only commits, force-push over unknown remote
  changes, deleting unmerged or unproven branch state, branch/head mismatch,
  local main divergence or reconciliation, non-obvious issue lifecycle changes,
  permissions/auth failure, and any operation that cannot be proven safe from
  live readback;
- do not touch local main unless explicitly assigned.

Tool argument: `agent_type=explorer`

Child prompt:
`find all files under src/ that import from aos-gesture-frame and return paths, import forms, and counts only.`

Tool argument: `agent_type=validator`

Child prompt:
`run bash tests/dock-hook-isolation.sh and report the pass/fail result and any exact failure line. Do not edit files.`

Tool argument: `agent_type=github-steward`

Child prompt:
`return a compact GitHub hygiene signal packet for the current branch. Do not mutate git or GitHub.`

Tool argument: `agent_type=reviewer`

Child prompt:
`review HEAD diff and return findings signal only. Do not edit files or mutate GitHub.`

Tool argument: `agent_type=gdi`

Child prompt:
`update .docks/gdi/AGENTS.md so GDI treats inline native prompts as the default dispatch; run bash tests/dock-hook-isolation.sh and report changed files plus verification.`

If an explicit durable work card is current, use a concise pointer instead:

Tool argument: `agent_type=gdi`

Child prompt (explicit durable-only work-card pointer):
`follow the instructions in docs/design/work-cards/input-event-v2-cutover-v0.md; start from origin/main.`

Tool argument: `agent_type=operator`

Child prompt:
`open https://localhost:3000/workbench and report whether the avatar compact control renders without error in the console. Stop immediately on any login or paywall gate.`

## What Subagents Inherit from Foreman

Do not rely on inheritance for role identity, model, or reasoning effort. Each
native agent config must pin those values.

The active Codex runtime still supplies the session's permissions, configured
tools, and project context. A child config may further constrain itself, such
as `explorer` using `sandbox_mode = "read-only"`. If a role needs a different
sandbox, model, effort, tool access, or skill configuration, declare it in that
role's native agent config instead of relying on Foreman's launch posture.

## Adding New Subagent Types

To add a new subagent:

1. Create `.codex/agents/<name>.toml` with `name`, `description`,
   `developer_instructions`, `model`, and `model_reasoning_effort`.
2. Register it from repo-root `.codex/config.toml` with
   `config_file = "agents/<name>.toml"`.
3. Register it from `.docks/foreman/.codex/config.toml` with
   `config_file = "../../../.codex/agents/<name>.toml"`.
4. Document it in this file's catalog table.
5. Smoke one spawn and verify the runtime identity and model/effort before
   using the role for fan-out.

If the new subagent maps to an existing dock, write the canonical role contract
in `.docks/<role>/AGENTS.md` first, then have the TOML
`developer_instructions` reference that file. Keep the native agent config
thin.
